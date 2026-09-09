import os
import math
import pandas as pd
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import require_uploader
from app.services import data_processing as dp
from app.services import session_store
from app.routers.ticket_classification import apply_all_overlays

router = APIRouter(tags=["upload"])

SAMPLE_CSV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "sample_data", "sample_tickets.csv"
)


def _process_and_store(filename: str, content: bytes, current_user, db: Session):
    try:
        raw_df = dp.load_file_to_df(filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if raw_df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file contains no rows")

    df, report = dp.clean_dataframe(raw_df)
    dataset_id = dp.save_dataset(df)
    session_store.add_active_dataset(dataset_id)

    db.add(models.Dataset(
        id=dataset_id,
        original_filename=filename,
        row_count=len(df),
        uploaded_by_user_id=current_user.id,
    ))
    db.commit()

    preview = dp.get_ticket_rows(df, limit=10)

    return {
        "dataset_id": dataset_id,
        "row_count": len(df),
        "columns": dp.DISPLAY_COLUMNS,
        "preview": preview,
        "validation_report": report,
    }


@router.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    content = await file.read()
    return _process_and_store(file.filename, content, current_user, db)


@router.post("/upload/demo")
async def upload_demo_dataset(
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Loads the bundled sample dataset server-side, no file transfer needed -
    lets a brand-new Admin/SDM explore the whole app before uploading anything
    real of their own."""
    if not os.path.exists(SAMPLE_CSV_PATH):
        raise HTTPException(status_code=404, detail="No demo dataset is bundled with this deployment")
    with open(SAMPLE_CSV_PATH, "rb") as f:
        content = f.read()
    return _process_and_store("demo_sample_tickets.csv", content, current_user, db)


@router.post("/upload/history")
async def upload_ticket_history(
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Ingests the 2nd (and now last) Upload option: 'Individual Ticket
    History (Sentiment Analysis)' - the per-queue movement log (Incident
    Number, Queue, Timestamp, Status, Assigned Associate, Time Spent), plus
    an optional Comment/Notes column that gets scored for sentiment on the
    way in. Stored separately from the main ITSM dump so it accumulates
    across uploads instead of replacing the active dataset; this is what
    feeds the ticket-detail timeline and the ticket history dropdown on the
    Tickets page."""
    content = await file.read()
    try:
        df = dp.load_history_file_to_df(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    def _row_key(incident, queue, ts, status, associate):
        return (incident, queue, ts.isoformat() if ts is not None else None, status, associate)

    def _clean(val, blank_values=("nan", "na")):
        if val in (None, ""):
            return None
        s = str(val).strip()
        return None if not s or s.lower() in blank_values else s

    candidates = []
    seen_in_batch = set()
    rows_with_comment = 0
    sentiment_counts = {"Positive": 0, "Neutral": 0, "Negative": 0}
    for _, r in df.iterrows():
        incident = r.get("Incident Number")
        if incident is None or (isinstance(incident, float) and math.isnan(incident)) or str(incident).strip() == "":
            continue
        incident = str(incident).strip()
        ts_raw = r.get("Timestamp")
        ts = ts_raw.to_pydatetime() if pd.notna(ts_raw) else None
        queue = _clean(r.get("Queue"))
        status = _clean(r.get("Status"))
        associate = _clean(r.get("Assigned Associate"))
        comment = _clean(r.get("Comment"))

        # Same movement (same ticket, same queue, same timestamp, same
        # status, same associate) appearing twice - whether duplicated
        # within this file itself, or because the file overlaps with one
        # already uploaded - is the same event recorded twice, not two
        # real queue movements. Skip it rather than storing it again; this
        # is what was causing a ticket's queue-history timeline to show the
        # same row repeated once per redundant upload.
        key = _row_key(incident, queue, ts, status, associate)
        if key in seen_in_batch:
            continue
        seen_in_batch.add(key)

        sentiment_label, sentiment_score = dp.analyze_sentiment(comment)
        if comment:
            rows_with_comment += 1
        if sentiment_label:
            sentiment_counts[sentiment_label] = sentiment_counts.get(sentiment_label, 0) + 1

        candidates.append((key, models.TicketHistoryEvent(
            incident_number=incident,
            queue=queue,
            timestamp=ts,
            status=status,
            assigned_associate=associate,
            time_spent_minutes=(None if r.get("Time Spent Minutes") is None or (isinstance(r.get("Time Spent Minutes"), float) and math.isnan(r.get("Time Spent Minutes"))) else float(r.get("Time Spent Minutes"))),
            time_spent_raw=_clean(r.get("Time Spent Raw")),
            comment=comment,
            sentiment=sentiment_label,
            sentiment_score=sentiment_score,
            uploaded_by_user_id=current_user.id,
        )))

    if not candidates:
        raise HTTPException(status_code=400, detail="No valid rows with an Incident Number were found")

    incidents_in_batch = {k[0] for k, _ in candidates}
    existing = (
        db.query(
            models.TicketHistoryEvent.incident_number,
            models.TicketHistoryEvent.queue,
            models.TicketHistoryEvent.timestamp,
            models.TicketHistoryEvent.status,
            models.TicketHistoryEvent.assigned_associate,
        )
        .filter(models.TicketHistoryEvent.incident_number.in_(incidents_in_batch))
        .all()
    )
    existing_keys = {_row_key(i, q, t, s, a) for i, q, t, s, a in existing}

    rows = [obj for key, obj in candidates if key not in existing_keys]
    skipped_duplicates = len(candidates) - len(rows)

    if not rows:
        return {
            "incidents_covered": 0,
            "rows_added": 0,
            "duplicate_rows_skipped": skipped_duplicates,
            "message": "Every row in this file was already on file - nothing new to add.",
        }

    db.bulk_save_objects(rows)
    db.commit()

    incidents_covered = sorted({r.incident_number for r in rows})
    return {
        "row_count": len(rows),
        "incidents_covered": len(incidents_covered),
        "sample_incidents": incidents_covered[:10],
        "duplicate_rows_skipped": skipped_duplicates,
        "rows_with_comment": rows_with_comment,
        "sentiment_breakdown": sentiment_counts,
    }


@router.post("/upload/queue-descriptions")
async def upload_queue_descriptions(
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Ingests the queue reference/TCS-mapping config (L1/L2/L3 Team =
    non-TCS; ABAP/FI/SD/MM Team = TCS, etc.) - lives on the Settings page as
    a one-time admin config, not as one of the two Upload page options,
    since it's reference data rather than a ticket data dump. Upserts by
    queue name, so re-uploading refreshes existing descriptions rather than
    duplicating them."""
    content = await file.read()
    try:
        df = dp.load_queue_descriptions_file_to_df(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    queues = []
    for _, r in df.iterrows():
        queue_name = str(r["Queue"]).strip()
        if not queue_name:
            continue
        is_tcs = r.get("Is TCS Team")
        if isinstance(is_tcs, float) and math.isnan(is_tcs):
            is_tcs = None
        existing = db.query(models.QueueDescription).filter(models.QueueDescription.queue == queue_name).first()
        if existing:
            existing.description = r["Description"]
            existing.is_tcs_team = is_tcs
            existing.uploaded_by_user_id = current_user.id
        else:
            db.add(models.QueueDescription(
                queue=queue_name,
                description=r["Description"],
                is_tcs_team=is_tcs,
                uploaded_by_user_id=current_user.id,
            ))
        queues.append(queue_name)

    if not queues:
        raise HTTPException(status_code=400, detail="No valid rows with a Queue name were found")

    db.commit()

    return {
        "row_count": len(queues),
        "queues_covered": len(set(queues)),
        "queues": sorted(set(queues)),
    }


@router.post("/analyze")
async def analyze_dataset(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    df = dp.load_dataset(dataset_id)
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = apply_all_overlays(df, db)
    kpis = dp.compute_kpis(df)
    return {"dataset_id": dataset_id, "kpis": kpis, "row_count": len(df)}
