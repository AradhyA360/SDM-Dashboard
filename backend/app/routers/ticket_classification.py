from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_uploader
from app.services import data_processing as dp

router = APIRouter(prefix="/tickets", tags=["ticket-classification"])

VALID_TYPES = ("incident", "user_request")


def _resolve_dataset_ids(dataset_id: str) -> list:
    return [d.strip() for d in dataset_id.split(",") if d.strip()]


def load_classification_overrides(db: Session) -> dict:
    """Number -> "incident" | "user_request" for every ticket that has ever
    been manually classified. Merged onto the rule-based guess wherever a
    dataframe needs an Effective Type (dashboard, backlog, tickets list,
    user-requests page)."""
    rows = db.query(models.TicketClassification).all()
    return {r.incident_number: r.ticket_type for r in rows}


def _latest_queue_events(db: Session) -> dict:
    """Number -> most recent TicketHistoryEvent (by timestamp) for that
    ticket. Shared groundwork for both build_latest_queue_tcs_map and
    build_latest_queue_associate_map below, so they can never disagree
    about which event counts as "latest" for a given ticket."""
    events = (
        db.query(models.TicketHistoryEvent)
        .filter(models.TicketHistoryEvent.queue.isnot(None))
        .order_by(models.TicketHistoryEvent.timestamp.asc())
        .all()
    )
    latest: dict[str, models.TicketHistoryEvent] = {}
    for e in events:
        if not e.incident_number:
            continue
        # Rows are ordered oldest-to-newest, so the last write for a given
        # incident is always its most recent queue - including rows with a
        # null timestamp, which sort first and get correctly overwritten by
        # any dated row that follows.
        latest[e.incident_number] = e
    return latest


def build_latest_queue_tcs_map(db: Session) -> dict:
    """Number -> True/False, based on each ticket's MOST RECENT
    queue-history event and that queue's TCS/Non-TCS classification. A
    ticket with no history rows, or whose latest queue has no uploaded
    classification, is left out of the map entirely - recompute_sla_and_risk
    treats a missing entry as "not a TCS queue", so breach status never
    shows for a ticket we can't actually confirm is routed through a TCS
    queue right now."""
    latest = _latest_queue_events(db)
    queue_names = {e.queue for e in latest.values()}
    tcs_by_queue = {
        d.queue: d.is_tcs_team
        for d in db.query(models.QueueDescription).filter(models.QueueDescription.queue.in_(queue_names)).all()
    } if queue_names else {}

    return {
        number: tcs_by_queue[e.queue]
        for number, e in latest.items()
        if e.queue in tcs_by_queue and tcs_by_queue[e.queue] is not None
    }


def build_latest_queue_associate_map(db: Session) -> dict:
    """Number -> the associate name recorded on that ticket's MOST RECENT
    queue-history event (whichever queue - TCS or non-TCS - it's currently
    sitting in). Used to make the Backlog page attribute a ticket to the
    associate actually holding it in its current queue, rather than always
    falling back to the main ITSM dump's single "Assigned To" field, which
    only reflects TCS-side ownership. A ticket with no queue history, or
    whose latest event has no associate recorded, is left out of the map -
    callers fall back to "Assigned To" for those."""
    latest = _latest_queue_events(db)
    return {number: e.assigned_associate for number, e in latest.items() if e.assigned_associate}


def latest_ticket_field_edits(db: Session) -> dict:
    """Number -> {field_name: newest applied value}, from every SDM field
    edit made in the Incident Command Center. Rows are walked oldest-to-
    newest per (incident_number, field_name) so a later edit always wins
    over an earlier one, same pattern as _latest_queue_events above."""
    rows = (
        db.query(models.TicketFieldEdit)
        .order_by(models.TicketFieldEdit.edited_at.asc())
        .all()
    )
    out: dict = {}
    for r in rows:
        out.setdefault(r.incident_number, {})[r.field_name] = r.new_value
    return out


def apply_ticket_field_edits(df, edits_by_number: dict):
    """Overlays SDM-made field edits onto the dataframe - the same
    non-destructive pattern as apply_ticket_classifications: the uploaded
    file on disk never changes, but every reader of this dataframe (the
    Command Center itself, the dashboard, the tickets list) sees the
    edited value from here on."""
    if not edits_by_number:
        return df
    df = df.copy()
    numbers = df["Number"].astype(str)
    for number, fields in edits_by_number.items():
        mask = numbers == number
        if not mask.any():
            continue
        for field, value in fields.items():
            if field in df.columns:
                df.loc[mask, field] = value
    return df


def apply_all_overlays(df, db: Session):
    """Single entry point for every DB-resident overlay a ticket dataframe
    needs before it's used for anything - manual User Request/Incident
    classifications, the TCS-queue-gated SLA breach recompute, the
    queue-history-based Backlog Associate column, and SDM field edits made
    from the Incident Command Center. Every router that reads ticket data
    calls this one function instead of separately assembling the same
    calls, so a rule change here (like the TCS-queue breach gating)
    automatically reaches every page - the exact kind of single-source-of-
    truth fix this dataset has needed before, when pages disagreed about
    ticket classification counts."""
    df = dp.apply_ticket_classifications(df, load_classification_overrides(db))
    df = dp.recompute_sla_and_risk(df, build_latest_queue_tcs_map(db))
    df = dp.apply_backlog_associate(df, build_latest_queue_associate_map(db))
    df = apply_ticket_field_edits(df, latest_ticket_field_edits(db))
    return df


@router.get("/classifications")
async def list_classifications(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.TicketClassification).order_by(models.TicketClassification.updated_at.desc()).all()
    return {
        "classifications": [
            {
                "incident_number": r.incident_number,
                "ticket_type": r.ticket_type,
                "similar_group_key": r.similar_group_key,
                "set_by": r.set_by.full_name if r.set_by else "Unknown",
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    }


@router.post("/{incident_number}/classify")
async def classify_ticket(
    incident_number: str,
    payload: dict,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Sets (or changes) one ticket's true type. Also looks for other
    tickets that look like the same kind of thing and returns them as
    `similar_candidates`, so the caller can immediately follow up with
    POST /tickets/classify-bulk to apply the same call to all of them,
    rather than the SDM having to repeat this one ticket at a time."""
    ticket_type = payload.get("ticket_type")
    dataset_id = payload.get("dataset_id")
    if ticket_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"ticket_type must be one of {VALID_TYPES}")
    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id is required")

    df = dp.load_datasets(_resolve_dataset_ids(dataset_id))
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if incident_number not in set(df["Number"].astype(str)):
        raise HTTPException(status_code=404, detail="Ticket not found in this dataset")

    existing = db.query(models.TicketClassification).filter(
        models.TicketClassification.incident_number == incident_number
    ).first()

    already_classified = {r.incident_number for r in db.query(models.TicketClassification.incident_number).all()}
    similar = dp.find_similar_tickets_for_classification(df, incident_number, already_classified)

    if existing:
        existing.ticket_type = ticket_type
        existing.similar_group_key = similar["group_key"]
        existing.set_by_user_id = current_user.id
    else:
        db.add(models.TicketClassification(
            incident_number=incident_number,
            ticket_type=ticket_type,
            similar_group_key=similar["group_key"],
            set_by_user_id=current_user.id,
        ))
    db.commit()

    return {
        "incident_number": incident_number,
        "ticket_type": ticket_type,
        "similar_candidates": similar["candidates"],
        "similar_count": len(similar["candidates"]),
        "group_key": similar["group_key"],
    }


@router.post("/classify-bulk")
async def classify_tickets_bulk(
    payload: dict,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Applies one ticket_type to a whole list of incident numbers in one
    shot - what the UI calls after the SDM confirms "yes, send all of
    these to User Request too" from the similar_candidates prompt."""
    incident_numbers = payload.get("incident_numbers") or []
    ticket_type = payload.get("ticket_type")
    group_key = payload.get("group_key")
    if ticket_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"ticket_type must be one of {VALID_TYPES}")
    if not incident_numbers:
        return {"updated_count": 0}

    existing_rows = {
        r.incident_number: r
        for r in db.query(models.TicketClassification).filter(
            models.TicketClassification.incident_number.in_(incident_numbers)
        ).all()
    }
    updated = 0
    for number in incident_numbers:
        row = existing_rows.get(number)
        if row:
            row.ticket_type = ticket_type
            row.similar_group_key = group_key
        else:
            db.add(models.TicketClassification(
                incident_number=number,
                ticket_type=ticket_type,
                similar_group_key=group_key,
                set_by_user_id=current_user.id,
            ))
        updated += 1
    db.commit()
    return {"updated_count": updated}
