from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_user

router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])


@router.get("", response_model=list[schemas.SavedFilterOut])
async def list_saved_filters(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.SavedFilterView)
        .filter(models.SavedFilterView.user_id == current_user.id)
        .order_by(models.SavedFilterView.created_at.desc())
        .all()
    )
    return rows


@router.post("", response_model=schemas.SavedFilterOut, status_code=201)
async def create_saved_filter(
    payload: schemas.SavedFilterCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = models.SavedFilterView(user_id=current_user.id, name=payload.name, filters_json=payload.filters_json)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{filter_id}")
async def delete_saved_filter(
    filter_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(models.SavedFilterView)
        .filter(models.SavedFilterView.id == filter_id, models.SavedFilterView.user_id == current_user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved filter not found")
    db.delete(row)
    db.commit()
    return {"message": "Saved filter deleted"}
