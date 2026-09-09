import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import require_uploader, get_current_user
from app.services import data_processing as dp
from app.services import ai_providers
from app.services import copilot as copilot_service
from app.services import ai_token_tracking as tracking
from app.services import email_service
from app.routers.ticket_classification import apply_all_overlays, build_latest_queue_tcs_map

router = APIRouter(prefix="/copilot", tags=["copilot"])

# Fields an SDM can edit directly from the Incident Command Center. Kept
# deliberately narrow to the fields that actually drive routing/urgency -
# not a general-purpose ticket editor - and gated (see _require_tcs_editable
# below) to tickets whose most recent queue-history event is a TCS-managed
# queue, per the SDM requirement that these edits never touch a client-
# owned queue's tickets.
EDITABLE_FIELDS = ["Priority", "State", "Assignment Group", "Assigned To"]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _require_tcs_editable(incident_number: str, db: Session):
    """Raises 403 unless this incident's most recent recorded queue-history
    event is a TCS-managed queue. A ticket with no queue history at all is
    never editable - we simply don't know which team owns it right now."""
    tcs_map = build_latest_queue_tcs_map(db)
    if tcs_map.get(incident_number) is not True:
        raise HTTPException(
            status_code=403,
            detail=(
                "Field edits are restricted to tickets currently routed through a TCS-managed "
                "queue. This incident has no recorded TCS queue assignment."
            ),
        )


@router.get("/incident-command-center")
async def get_incident_command_center(
    dataset_id: str,
    incident_number: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Return a safe, evidence-first AI work plan for one active incident.

    Reassignment/priority/state edits are NOT part of this response - they
    remain deliberate actions the SDM takes explicitly via
    PATCH /copilot/incidents/{number}/fields, gated to TCS-managed queues.
    """
    dataset_ids = [d.strip() for d in dataset_id.split(",") if d.strip()]
    df = dp.load_datasets(dataset_ids)
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = apply_all_overlays(df, db)
    try:
        plan = copilot_service.investigate_incident(df, incident_number, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    number = plan["incident"]["number"]
    tcs_map = build_latest_queue_tcs_map(db)
    is_tcs = tcs_map.get(number) is True
    plan["field_edit_access"] = {
        "editable": is_tcs,
        "editable_fields": EDITABLE_FIELDS if is_tcs else [],
        "reason": None if is_tcs else (
            "This incident has no recorded TCS-managed queue assignment, so direct field "
            "edits aren't available here - upload queue history/description data, or make "
            "the change directly in the ITSM system."
        ),
    }
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "plan": plan,
    }


@router.patch("/incidents/{incident_number}/fields")
async def edit_incident_field(
    incident_number: str,
    payload: dict,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Directly edits one field on one incident - Priority, State,
    Assignment Group, or Assigned To - from the Command Center. This is a
    real, persisted change: it's recorded as a TicketFieldEdit and layered
    onto the dataframe by apply_all_overlays from this point on, so the
    dashboard, tickets list, and this same Command Center all reflect it
    immediately. Restricted to TCS-managed-queue incidents (see
    _require_tcs_editable) - the underlying uploaded CSV/Excel file is
    never rewritten; this is an auditable overlay, exactly like manual
    ticket classification."""
    dataset_id = payload.get("dataset_id")
    field = payload.get("field")
    value = (payload.get("value") or "").strip()
    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id is required")
    if field not in EDITABLE_FIELDS:
        raise HTTPException(status_code=400, detail=f"field must be one of {EDITABLE_FIELDS}")
    if not value:
        raise HTTPException(status_code=400, detail="value is required")

    dataset_ids = [d.strip() for d in dataset_id.split(",") if d.strip()]
    df = dp.load_datasets(dataset_ids)
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = apply_all_overlays(df, db)
    matches = df[df["Number"].astype(str).str.lower() == incident_number.strip().lower()]
    if matches.empty:
        raise HTTPException(status_code=404, detail="Incident not found in the active dataset")

    _require_tcs_editable(incident_number, db)

    old_value = matches.iloc[0].get(field)
    old_value = None if old_value is None or str(old_value).lower() in ("nan", "none") else str(old_value)

    db.add(models.TicketFieldEdit(
        incident_number=incident_number,
        field_name=field,
        old_value=old_value,
        new_value=value,
        edited_by_user_id=current_user.id,
    ))
    db.commit()

    return {
        "incident_number": incident_number,
        "field": field,
        "old_value": old_value,
        "new_value": value,
        "edited_by": current_user.full_name,
        "edited_at": datetime.utcnow().isoformat(),
    }


@router.get("/incidents/{incident_number}/edit-history")
async def get_incident_edit_history(
    incident_number: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.TicketFieldEdit)
        .filter(models.TicketFieldEdit.incident_number == incident_number)
        .order_by(models.TicketFieldEdit.edited_at.desc())
        .all()
    )
    return {
        "edits": [
            {
                "field": r.field_name,
                "old_value": r.old_value,
                "new_value": r.new_value,
                "edited_by": r.edited_by.full_name if r.edited_by else "Unknown",
                "edited_at": r.edited_at.isoformat() if r.edited_at else None,
            }
            for r in rows
        ]
    }


@router.post("/incidents/{incident_number}/send-email")
async def send_incident_email(
    incident_number: str,
    payload: dict,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Sends (or, until SMTP is configured, safely logs) an incident-update
    email with an explicit sender and one or more recipient addresses that
    the SDM types in directly here - no dependency on any assignee/contact
    email data being present in the uploaded dataset. Every attempt is
    recorded in EmailLog regardless of outcome, so there's always a durable
    record of what was communicated about this incident and when."""
    sender = (payload.get("sender") or "").strip()
    recipients = [r.strip() for r in (payload.get("recipients") or []) if r and r.strip()]
    subject = (payload.get("subject") or "").strip()
    body = payload.get("body") or ""

    if not sender or not EMAIL_RE.match(sender):
        raise HTTPException(status_code=400, detail="A valid sender email address is required")
    if not recipients:
        raise HTTPException(status_code=400, detail="At least one recipient email address is required")
    invalid = [r for r in recipients if not EMAIL_RE.match(r)]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid recipient address(es): {', '.join(invalid)}")
    if not subject:
        raise HTTPException(status_code=400, detail="A subject is required")
    if not body.strip():
        raise HTTPException(status_code=400, detail="An email body is required")

    result = email_service.send_email(sender, recipients, subject, body)

    log = models.EmailLog(
        incident_number=incident_number,
        sender=sender,
        recipients=", ".join(recipients),
        subject=subject,
        body=body,
        status=result["status"],
        error=result.get("error"),
        sent_by_user_id=current_user.id,
    )
    db.add(log)
    db.commit()

    return {
        "status": result["status"],
        "error": result.get("error"),
        "sender": sender,
        "recipients": recipients,
        "sent_at": log.created_at.isoformat(),
    }


@router.get("/incidents/{incident_number}/email-history")
async def get_incident_email_history(
    incident_number: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.EmailLog)
        .filter(models.EmailLog.incident_number == incident_number)
        .order_by(models.EmailLog.created_at.desc())
        .all()
    )
    return {
        "emails": [
            {
                "sender": r.sender,
                "recipients": r.recipients.split(", ") if r.recipients else [],
                "subject": r.subject,
                "status": r.status,
                "error": r.error,
                "sent_by": r.sent_by.full_name if r.sent_by else "Unknown",
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.get("/briefing")
async def get_briefing(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """The SDM Copilot's daily briefing: a same-day action plan that cross-
    references ticket backlog/SLA data with the team's Leave/WFH schedule -
    something neither the ticketing side nor the availability side can see
    on its own. Every figure in the response is computed deterministically
    in Python (see services/copilot.py); the AI provider (Ollama by
    default) only prioritizes and narrates those already-accurate facts
    into plain language - it never calculates or invents a number."""
    dataset_ids = [d.strip() for d in dataset_id.split(",") if d.strip()]
    df = dp.load_datasets(dataset_ids)
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = apply_all_overlays(df, db)

    kpis = dp.compute_kpis(df)
    backlog_by_priority = dp.compute_backlog_by_priority(df)
    backlog_by_associate = dp.compute_backlog_by_associate(df)
    user_request_summary = dp.compute_user_request_summary(df)

    coverage = copilot_service.compute_coverage_forecast(db)
    reassignments = copilot_service.compute_reassignment_suggestions(df, db)

    context = copilot_service.build_copilot_context(
        kpis, backlog_by_priority, backlog_by_associate, user_request_summary, coverage, reassignments,
    )

    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = await provider.generate_insights(context, system_prompt=ai_providers.SDM_COPILOT_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    tracking.record_usage(db, current_user, "copilot_briefing", result["usage"], provider=provider_name)
    db.commit()

    return {
        "provider": provider_name,
        "generated_at": datetime.utcnow().isoformat(),
        "narrative": result["insights"],
        # Raw, pre-computed facts too - the frontend renders these directly
        # (coverage calendar, reassignment cards) rather than only trusting
        # the model's prose, and an evaluator can verify every claim in the
        # narrative against these numbers.
        "facts": {
            "kpis": kpis,
            "coverage_gaps": coverage["gaps"],
            "upcoming_leave": coverage["upcoming_leave"],
            "reassignment_suggestions": reassignments,
            "top_backlog": sorted(backlog_by_associate, key=lambda a: a["total"], reverse=True)[:5],
        },
    }
