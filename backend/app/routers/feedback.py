from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_user, require_uploader

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _to_out(r: models.AssociateFeedback) -> schemas.FeedbackOut:
    return schemas.FeedbackOut(
        id=r.id, associate_name=r.associate_name, message=r.message,
        given_by_name=r.given_by.full_name if r.given_by else "Unknown",
        created_at=r.created_at, acknowledged_at=r.acknowledged_at,
    )


@router.post("", response_model=schemas.FeedbackOut, status_code=201)
async def create_feedback(
    payload: schemas.FeedbackCreate,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    row = models.AssociateFeedback(
        associate_name=payload.associate_name,
        message=payload.message,
        given_by_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.get("", response_model=list[schemas.FeedbackOut])
async def list_feedback(
    associate_name: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.AssociateFeedback)
        .filter(models.AssociateFeedback.associate_name == associate_name)
        .order_by(models.AssociateFeedback.created_at.desc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/{feedback_id}/acknowledge", response_model=schemas.FeedbackOut)
async def acknowledge_feedback(
    feedback_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The associate a note is about can acknowledge it (marks it read), and
    so can the Admin/SDM who wrote it or any other Admin/SDM."""
    row = db.query(models.AssociateFeedback).filter(models.AssociateFeedback.id == feedback_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")

    is_subject = current_user.full_name.strip().lower() == row.associate_name.strip().lower()
    is_manager = current_user.role in ("admin", "sdm")
    if not (is_subject or is_manager):
        raise HTTPException(status_code=403, detail="You can only acknowledge feedback about yourself")

    row.acknowledged_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _to_out(row)
