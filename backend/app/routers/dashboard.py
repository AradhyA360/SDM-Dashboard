from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models
from app.database import get_db
from app.deps import get_current_user
from app.services import data_processing as dp
from app.services import session_store
from app.routers.ticket_classification import apply_all_overlays, build_latest_queue_tcs_map

router = APIRouter(tags=["dashboard"])


def _with_classifications(df, db: Session):
    """Merges every DB-resident overlay (manual User Request/Incident
    classifications, TCS-queue-gated SLA breach recompute) onto the
    dataframe so every KPI, chart, and backlog view downstream reflects the
    SDM's actual calls and the current, correctly-gated breach status -
    not just the rule-based/upload-time guess. Kept as a thin wrapper
    (rather than renaming every call site below) around the single
    apply_all_overlays entry point shared by every other router."""
    return apply_all_overlays(df, db)


def _scoped_for_dashboard(df, db: Session, tcs_only: bool):
    """Every Executive Dashboard endpoint's standard prep: DB overlays, then
    (by default) drop tickets confirmed to be sitting in a Non-TCS queue, so
    the dashboard only ever represents the TCS team's own data. Pass
    tcs_only=False (a per-request opt-out, not a persisted setting) to see
    the unfiltered picture instead."""
    df = _with_classifications(df, db)
    if tcs_only:
        df = dp.filter_tcs_only(df, build_latest_queue_tcs_map(db))
    return df


def _split(v):
    return v.split(",") if v else None


def _build_filters(status, priority, module, customer, application, assignee, date_from, date_to, view=None, q=None):
    return {
        "status": _split(status), "priority": _split(priority), "module": _split(module),
        "customer": _split(customer), "application": _split(application), "assignee": _split(assignee),
        "date_from": date_from, "date_to": date_to, "view": view, "q": q,
    }


def _resolve_dataset_ids(dataset_id: str) -> list:
    """dataset_id may be a single id or a comma-separated list of several,
    e.g. from selecting multiple active files on the Uploaded Data page."""
    return [d.strip() for d in dataset_id.split(",") if d.strip()]


@router.get("/dashboard/current-dataset")
async def current_dataset(current_user: models.User = Depends(get_current_user)):
    ids = session_store.get_active_dataset_ids()
    return {"dataset_id": ids[0] if ids else None, "dataset_ids": ids}


@router.get("/dashboard")
async def get_dashboard(
    dataset_id: str,
    status: str | None = None,
    priority: str | None = None,
    module: str | None = None,
    customer: str | None = None,
    application: str | None = None,
    assignee: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    view: str | None = None,
    q: str | None = None,
    tcs_only: bool = True,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _scoped_for_dashboard(df, db, tcs_only)

    filters = _build_filters(status, priority, module, customer, application, assignee, date_from, date_to, view, q)
    filtered = dp.apply_filters(df, filters)

    return {
        "dataset_id": dataset_id,
        "tcs_only": tcs_only,
        "kpis": dp.compute_kpis(filtered),
        "charts": dp.compute_charts(filtered),
        "filter_options": dp.get_filter_options(df),
        "row_count": len(filtered),
        "new_vs_resolved_trend": dp.compute_new_vs_resolved_trend(filtered),
        "sla_trend": dp.compute_sla_trend(filtered),
        "backlog_by_priority": dp.compute_backlog_by_priority(filtered),
        "recent_p1_tickets": dp.get_recent_priority_tickets(filtered, "P1", limit=5),
    }


@router.get("/dashboard/backlog")
async def get_backlog(
    dataset_id: str,
    status: str | None = None,
    priority: str | None = None,
    module: str | None = None,
    customer: str | None = None,
    application: str | None = None,
    assignee: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = None,
    tcs_only: bool = True,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Currently-open, genuine-incident ticket backlog per associate (User
    Request tickets excluded), bucketed by ticket age (0-30 / 31-60 / 61-90 /
    90+ days). Accepts the same filters as the main dashboard/ticket list, so
    a filtered view carries through here too."""
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _scoped_for_dashboard(df, db, tcs_only)

    # Backlog is inherently scoped to open tickets - "view" isn't exposed as a
    # separate filter param here since that's already the whole point of this page.
    filters = _build_filters(status, priority, module, customer, application, assignee, date_from, date_to, None, q)
    filtered = dp.apply_filters(df, filters)

    return {
        "dataset_id": dataset_id,
        "tcs_only": tcs_only,
        "backlog": dp.compute_backlog_by_associate(filtered),
        "filter_options": dp.get_filter_options(df),
    }


@router.get("/dashboard/tickets")
async def get_tickets(
    dataset_id: str,
    status: str | None = None,
    priority: str | None = None,
    module: str | None = None,
    customer: str | None = None,
    application: str | None = None,
    assignee: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    view: str | None = None,
    q: str | None = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full ticket rows (every ServiceNow-style display column) for the
    associate/ticket drill-down table."""
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _with_classifications(df, db)

    filters = _build_filters(status, priority, module, customer, application, assignee, date_from, date_to, view, q)
    rows = dp.get_ticket_rows(df, filters)

    return {
        "dataset_id": dataset_id,
        "columns": dp.DISPLAY_COLUMNS,
        "rows": rows,
        "row_count": len(rows),
        "filter_options": dp.get_filter_options(df),
    }


@router.get("/dashboard/user-requests")
async def get_user_requests(
    dataset_id: str,
    status: str | None = None,
    priority: str | None = None,
    module: str | None = None,
    customer: str | None = None,
    application: str | None = None,
    assignee: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tickets flagged as a likely 'User Request in disguise of Incident',
    plus which requesters raise them most often - backs the AI Insights
    drill-down chart and the User Requests review page."""
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _with_classifications(df, db)

    filters = _build_filters(status, priority, module, customer, application, assignee, date_from, date_to, None, q)
    filtered_all = dp.apply_filters(df, filters)

    return {
        "dataset_id": dataset_id,
        "summary": dp.compute_user_request_summary(filtered_all),
        "columns": dp.USER_REQUEST_DISPLAY_COLUMNS,
        "tickets": dp.get_user_request_tickets(df, filters),
        "requesters": dp.compute_frequent_requesters(df, filters)["requesters"],
        "filter_options": dp.get_filter_options(df),
    }


def _load_queue_history_events(incident_number: str, db: Session) -> list:
    """Raw queue-movement rows for one ticket, enriched with each queue's
    description/TCS flag - shared by both the legacy history dropdown and
    the ticket-detail timeline so they can never disagree about what was
    uploaded."""
    events = (
        db.query(models.TicketHistoryEvent)
        .filter(models.TicketHistoryEvent.incident_number == incident_number)
        .order_by(models.TicketHistoryEvent.timestamp.asc())
        .all()
    )
    queue_names = {e.queue for e in events if e.queue}
    descriptions = {
        d.queue: d for d in db.query(models.QueueDescription).filter(models.QueueDescription.queue.in_(queue_names)).all()
    } if queue_names else {}

    return [
        {
            "queue": e.queue,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "status": e.status,
            "assigned_associate": e.assigned_associate,
            "time_spent_minutes": e.time_spent_minutes,
            "time_spent": e.time_spent_raw,
            "comment": e.comment,
            "sentiment": e.sentiment,
            "sentiment_score": e.sentiment_score,
            "queue_description": descriptions[e.queue].description if e.queue in descriptions else None,
            "is_tcs_team": descriptions[e.queue].is_tcs_team if e.queue in descriptions else None,
        }
        for e in events
    ]


@router.get("/tickets/{incident_number}/history")
async def get_ticket_history(
    incident_number: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Queue-movement timeline for one ticket, from the 'Historical Data of
    tickets' upload - powers the history dropdown on the Tickets page.
    Each event is enriched with its queue's description/TCS flag, if one
    was uploaded via the 'Queue Descriptions' option."""
    return {
        "incident_number": incident_number,
        "events": _load_queue_history_events(incident_number, db),
    }


@router.get("/tickets/{incident_number}/detail")
async def get_ticket_detail(
    incident_number: str,
    dataset_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Everything the dedicated per-ticket page needs: full properties plus
    ONE merged, correctly-ordered timeline (main-dump milestones + uploaded
    queue-movement events + an auto-close milestone where applicable) -
    the ServiceNow-style "single ticket" view called out in requirements,
    and the fix for the history dropdown showing a stale in-progress status
    on a ticket that's actually Closed."""
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _with_classifications(df, db)

    matches = df[df["Number"].astype(str) == str(incident_number)]
    if matches.empty:
        raise HTTPException(status_code=404, detail="Ticket not found in this dataset")
    row = matches.iloc[0]

    history_events = _load_queue_history_events(incident_number, db)
    effective_state = dp.compute_effective_state(row)

    return {
        "incident_number": incident_number,
        "properties": dp.get_ticket_detail_fields(row),
        "effective_state": effective_state,
        "timeline": dp.build_ticket_timeline(row, history_events),
    }


@router.get("/dashboard/sla-tcs-breakdown")
async def get_sla_tcs_breakdown(
    dataset_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """SLA breach percentage split by whether a ticket's MOST RECENT queue
    is TCS-owned (ABAP/FI/SD/MM) vs non-TCS/external (L1/L2/L3) - the same
    "latest queue" definition used to gate the sla_breached column itself
    (see recompute_sla_and_risk), so this breakdown's numbers always agree
    with the breach counts shown everywhere else on the dashboard."""
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _with_classifications(df, db)

    incident_tcs = build_latest_queue_tcs_map(db)

    return dp.compute_sla_tcs_breakdown(df, incident_tcs)


@router.get("/queue-descriptions")
async def list_queue_descriptions(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All uploaded queue reference descriptions, e.g. for a settings/reference view."""
    rows = db.query(models.QueueDescription).order_by(models.QueueDescription.queue.asc()).all()
    return {
        "queues": [
            {"queue": r.queue, "description": r.description, "is_tcs_team": r.is_tcs_team}
            for r in rows
        ]
    }


@router.get("/dashboard/search")
async def global_search(
    dataset_id: str,
    q: str,
    limit: int = 8,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Global multi-keyword search, used by the header search box. Returns a
    small preview list (default 8) plus a total match count so the UI can
    offer a 'view all N results' link through to the full ticket list."""
    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _with_classifications(df, db)

    if not q or not q.strip():
        return {"query": q, "results": [], "total": 0}

    matched_df = dp.apply_text_search(df, q)
    results = dp.search_tickets(df, q, limit=limit)

    return {"query": q, "results": results, "total": int(len(matched_df))}
