import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_uploader
from app.services import data_processing as dp
from app.services import session_store

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _to_dict(r: models.Dataset, active_ids: set) -> dict:
    return {
        "id": r.id,
        "original_filename": r.original_filename,
        "row_count": r.row_count,
        "uploaded_by_name": r.uploaded_by.full_name if r.uploaded_by else "Unknown",
        "created_at": r.created_at,
        "is_active": r.id in active_ids,
        "file_missing": not os.path.exists(dp.dataset_path(r.id)),
    }


@router.get("")
async def list_datasets(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every non-deleted ticket file ever uploaded, newest first - the
    'Uploaded Data' page. See /datasets/deleted for the recovery list."""
    rows = (
        db.query(models.Dataset)
        .filter(models.Dataset.deleted_at.is_(None))
        .order_by(models.Dataset.created_at.desc())
        .all()
    )
    active_ids = set(session_store.get_active_dataset_ids())
    return [_to_dict(r, active_ids) for r in rows]


@router.get("/deleted")
async def list_deleted_datasets(
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Recently deleted files, recoverable via /restore."""
    rows = (
        db.query(models.Dataset)
        .filter(models.Dataset.deleted_at.isnot(None))
        .order_by(models.Dataset.deleted_at.desc())
        .all()
    )
    return [
        {**_to_dict(r, set()), "deleted_at": r.deleted_at}
        for r in rows
    ]


@router.post("/{dataset_id}/activate")
async def activate_dataset(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Adds a dataset to the active set (does NOT remove any others already
    active) - multiple files can be analyzed together. Toggle off with
    /deactivate."""
    record = db.query(models.Dataset).filter(models.Dataset.id == dataset_id, models.Dataset.deleted_at.is_(None)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not os.path.exists(dp.dataset_path(dataset_id)):
        raise HTTPException(status_code=404, detail="The underlying file for this dataset is missing on disk")

    session_store.add_active_dataset(dataset_id)
    return {"message": f"'{record.original_filename}' added to active analysis"}


@router.post("/{dataset_id}/deactivate")
async def deactivate_dataset(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    record = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Dataset not found")

    session_store.remove_active_dataset(dataset_id)
    return {"message": f"'{record.original_filename}' removed from active analysis"}


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Soft-delete: the file moves to a recovery list rather than vanishing
    immediately. The Parquet file on disk is kept so /restore works."""
    record = db.query(models.Dataset).filter(models.Dataset.id == dataset_id, models.Dataset.deleted_at.is_(None)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Dataset not found")

    record.deleted_at = datetime.utcnow()
    db.commit()
    session_store.clear_dataset_if_active(dataset_id)

    return {"message": f"'{record.original_filename}' moved to Recently Deleted"}


@router.post("/{dataset_id}/restore")
async def restore_dataset(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    record = db.query(models.Dataset).filter(models.Dataset.id == dataset_id, models.Dataset.deleted_at.isnot(None)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Deleted dataset not found")
    if not os.path.exists(dp.dataset_path(dataset_id)):
        raise HTTPException(status_code=404, detail="The underlying file for this dataset is missing on disk and cannot be restored")

    record.deleted_at = None
    db.commit()
    return {"message": f"'{record.original_filename}' restored"}


@router.delete("/{dataset_id}/permanent")
async def permanently_delete_dataset(
    dataset_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Actually removes the file and DB record - only reachable from the
    Recently Deleted list, as a second, explicit step."""
    record = db.query(models.Dataset).filter(models.Dataset.id == dataset_id, models.Dataset.deleted_at.isnot(None)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Deleted dataset not found")

    path = dp.dataset_path(dataset_id)
    if os.path.exists(path):
        os.remove(path)

    db.delete(record)
    db.commit()

    return {"message": f"'{record.original_filename}' permanently deleted"}
