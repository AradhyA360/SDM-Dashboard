"""
Endpoints that connect this dashboard to a ServiceNow instance:

  GET  /servicenow/status               - reachability + auth mode (admin)
  GET  /servicenow/close-codes           - valid close_code choices for the connected instance
  POST /servicenow/sync-incidents        - pull incidents in as a normal Dataset
  GET  /servicenow/incidents/{sys_id}    - fetch one incident's live detail
  POST /servicenow/incidents/{sys_id}/generate-resolution  - draft an AI resolution note (no write yet)
  POST /servicenow/incidents/{sys_id}/resolution           - write the resolution back (PATCH)

Every write endpoint (sync, resolution push) is restricted to
admin/SDM (require_uploader) - the same bar as uploading a ticket file -
since both pull in or change ticket data that everyone else's dashboard
view depends on. Every attempt to write back to ServiceNow, successful or
not, is recorded in ServiceNowAuditLog per the integration's security
checklist.
"""
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_admin, require_uploader
from app.services import data_processing as dp
from app.services import servicenow_client as sn
from app.services import session_store
from app.services import ai_providers
from app.services import ai_token_tracking as tracking

router = APIRouter(prefix="/servicenow", tags=["servicenow"])


@router.get("/status")
async def servicenow_status(current_user: models.User = Depends(require_admin)):
    """Reachability + auth-mode check. Never returns credentials or tokens -
    only whether the instance is configured/reachable, so this is safe to
    surface on a Settings page."""
    return await sn.test_connection()


@router.get("/close-codes")
async def servicenow_close_codes(current_user: models.User = Depends(get_current_user)):
    return {"close_codes": await sn.get_close_code_choices()}


@router.post("/sync-incidents")
async def sync_incidents(
    payload: schemas.ServiceNowSyncRequest,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Pulls incidents from the connected ServiceNow instance and stores
    them as a Dataset exactly like a manual CSV/Excel upload does - so the
    rest of the app (dashboard, tickets list, command center) doesn't need
    to know or care whether a dataset came from a file or from ServiceNow
    directly. Every attempt (success or failure) is recorded in
    ServiceNowSyncLog."""
    if not sn.is_configured():
        raise HTTPException(
            status_code=400,
            detail="ServiceNow isn't configured on this backend yet. Set SERVICENOW_INSTANCE_URL "
                   "(and auth settings) in the backend's .env, then restart the server.",
        )

    try:
        records = await sn.list_incidents(query=payload.query, limit=payload.limit)
    except sn.ServiceNowNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except sn.ServiceNowAPIError as e:
        db.add(models.ServiceNowSyncLog(
            instance_url=settings.SERVICENOW_INSTANCE_URL, table=settings.SERVICENOW_TABLE,
            query=payload.query, status="failed", error=e.detail, synced_by_user_id=current_user.id,
        ))
        db.commit()
        raise HTTPException(status_code=502, detail=f"ServiceNow returned an error: {e.detail}")

    if not records:
        db.add(models.ServiceNowSyncLog(
            instance_url=settings.SERVICENOW_INSTANCE_URL, table=settings.SERVICENOW_TABLE,
            query=payload.query, row_count=0, status="success", synced_by_user_id=current_user.id,
        ))
        db.commit()
        return {"row_count": 0, "message": "ServiceNow returned no matching incidents."}

    rows = [sn.map_incident_to_row(r) for r in records]
    raw_df = pd.DataFrame(rows).drop(columns=["sys_id"], errors="ignore")

    df, report = dp.clean_dataframe(raw_df)
    dataset_id = dp.save_dataset(df)
    session_store.add_active_dataset(dataset_id)

    db.add(models.Dataset(
        id=dataset_id,
        original_filename=f"servicenow:{settings.SERVICENOW_TABLE}@{sn.base_url()}",
        row_count=len(df),
        uploaded_by_user_id=current_user.id,
    ))
    db.add(models.ServiceNowSyncLog(
        instance_url=settings.SERVICENOW_INSTANCE_URL, table=settings.SERVICENOW_TABLE,
        query=payload.query, dataset_id=dataset_id, row_count=len(df),
        status="success", synced_by_user_id=current_user.id,
    ))
    db.commit()

    return {
        "dataset_id": dataset_id,
        "row_count": len(df),
        "columns": dp.DISPLAY_COLUMNS,
        "preview": dp.get_ticket_rows(df, limit=10),
        "validation_report": report,
    }


@router.get("/incidents/{sys_id}")
async def get_incident(sys_id: str, current_user: models.User = Depends(get_current_user)):
    if not sn.is_configured():
        raise HTTPException(status_code=400, detail="ServiceNow isn't configured on this backend yet.")
    try:
        record = await sn.get_incident(sys_id)
    except sn.ServiceNowNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except sn.ServiceNowAPIError as e:
        raise HTTPException(status_code=e.status_code if e.status_code in (404,) else 502, detail=e.detail)
    if not record:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"sys_id": sys_id, "raw": record, "mapped": sn.map_incident_to_row(record)}


def _incident_context(record: dict) -> str:
    def val(field):
        v = record.get(field)
        if isinstance(v, dict):
            v = v.get("display_value")
        return v or ""

    return (
        f"Incident: {val('number')}\n"
        f"Short description: {val('short_description')}\n"
        f"Priority: {val('priority')}\n"
        f"Category: {val('category')}\n"
        f"Assignment group: {val('assignment_group')}\n"
        f"Work notes: {val('work_notes')}\n"
        f"Additional comments: {val('comments')}\n"
    )


@router.post("/incidents/{sys_id}/generate-resolution")
async def generate_resolution(
    sys_id: str,
    payload: schemas.ServiceNowGenerateResolutionRequest,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Drafts a resolution/close note with this user's configured AI
    provider from the incident's live ServiceNow data. Deliberately does
    NOT write anything back - it only returns a draft for a person to
    review and edit, which then gets pushed via POST .../resolution as a
    separate, explicit step. Matches Phase 3 steps 1-2 of the AI Agent
    Integration guide (fetch incident, then have the LLM generate notes)."""
    if not sn.is_configured():
        raise HTTPException(status_code=400, detail="ServiceNow isn't configured on this backend yet.")
    try:
        record = await sn.get_incident(sys_id)
    except sn.ServiceNowNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except sn.ServiceNowAPIError as e:
        raise HTTPException(status_code=502, detail=e.detail)

    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    context = _incident_context(record)
    prompt = (
        "Write a concise, professional incident resolution note for the ticket described below. "
        "Cover what the root cause appears to be and what action resolved it, in 2-4 sentences, "
        "suitable to paste directly into a ServiceNow close_notes/resolution_notes field."
    )
    if payload.additional_instructions:
        prompt += f"\n\nAdditional instructions from the requester: {payload.additional_instructions}"

    try:
        result = await provider.chat([{"role": "user", "content": prompt}], data_context=context)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    tracking.record_usage(db, current_user, "servicenow_resolution", result["usage"], provider=provider_name)
    db.commit()

    return {"provider": provider_name, "draft_resolution_notes": result["reply"]}


@router.post("/incidents/{sys_id}/resolution")
async def push_resolution(
    sys_id: str,
    payload: schemas.ServiceNowResolutionRequest,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Writes close_notes/resolution_notes/close_code/state back onto the
    incident (PATCH). close_code, if provided, is validated against the
    instance's own live choice list first - Security Checklist item #7 -
    so an invalid value is rejected here instead of corrupting the ticket
    or getting silently ignored by ServiceNow. Every attempt, successful or
    not, is written to ServiceNowAuditLog."""
    if not sn.is_configured():
        raise HTTPException(status_code=400, detail="ServiceNow isn't configured on this backend yet.")

    if payload.close_code:
        valid_codes = await sn.get_close_code_choices()
        if payload.close_code not in valid_codes:
            raise HTTPException(
                status_code=400,
                detail=f"'{payload.close_code}' isn't a valid close_code for this instance. "
                       f"Valid values: {', '.join(valid_codes)}",
            )

    patch_body = {k: v for k, v in {
        "close_notes": payload.close_notes,
        "resolution_notes": payload.resolution_notes,
        "close_code": payload.close_code,
        "state": payload.state,
    }.items() if v is not None}

    if not patch_body:
        raise HTTPException(status_code=400, detail="Provide at least one field to update.")

    audit = models.ServiceNowAuditLog(
        incident_sys_id=sys_id,
        close_code=payload.close_code,
        close_notes=payload.close_notes,
        resolution_notes=payload.resolution_notes,
        state=payload.state,
        ai_generated=payload.ai_generated,
        ai_provider=payload.ai_provider,
        performed_by_user_id=current_user.id,
        status="pending",
    )

    try:
        result = await sn.patch_incident(sys_id, patch_body)
    except sn.ServiceNowNotConfigured as e:
        audit.status, audit.error = "failed", str(e)
        db.add(audit)
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    except sn.ServiceNowAPIError as e:
        audit.status, audit.error, audit.http_status = "failed", e.detail, e.status_code
        db.add(audit)
        db.commit()
        raise HTTPException(status_code=502, detail=f"ServiceNow rejected the update: {e.detail}")

    audit.status = "success"
    audit.http_status = 200
    audit.incident_number = result.get("number", {}).get("display_value") if isinstance(result.get("number"), dict) else result.get("number")
    db.add(audit)
    db.commit()

    return {"status": "success", "sys_id": sys_id, "updated_fields": list(patch_body.keys()),
            "incident": sn.map_incident_to_row(result)}


@router.get("/audit-log")
async def servicenow_audit_log(
    incident_sys_id: str | None = None,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Traceability trail of every resolution push attempted from this
    dashboard, newest first - the "Update local audit DB" step of the
    integration guide."""
    q = db.query(models.ServiceNowAuditLog)
    if incident_sys_id:
        q = q.filter(models.ServiceNowAuditLog.incident_sys_id == incident_sys_id)
    rows = q.order_by(models.ServiceNowAuditLog.created_at.desc()).limit(200).all()
    return [{
        "id": r.id,
        "incident_sys_id": r.incident_sys_id,
        "incident_number": r.incident_number,
        "close_code": r.close_code,
        "state": r.state,
        "ai_generated": r.ai_generated,
        "ai_provider": r.ai_provider,
        "status": r.status,
        "http_status": r.http_status,
        "error": r.error,
        "performed_by": r.performed_by.full_name if r.performed_by else None,
        "created_at": r.created_at,
    } for r in rows]
