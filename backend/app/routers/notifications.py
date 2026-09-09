from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_user
from app.services import data_processing as dp
from app.services import session_store

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[schemas.NotificationOut])
async def get_notifications(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Role-appropriate notifications, built entirely from data that already
    exists elsewhere in the app - nothing fabricated, just surfaced proactively
    instead of requiring someone to go look for it."""
    items = []

    if current_user.role == "admin":
        pending = (
            db.query(models.User)
            .filter(models.User.approval_status == "pending")
            .order_by(models.User.created_at.asc())
            .limit(10)
            .all()
        )
        for u in pending:
            items.append(schemas.NotificationOut(
                id=f"pending-{u.id}", type="pending_approval",
                message=f"{u.full_name} ({u.role.upper()}) is waiting for approval",
                link="/settings", created_at=u.created_at,
            ))

    if current_user.role in ("admin", "sdm"):
        active_ids = session_store.get_active_dataset_ids()
        if active_ids:
            df = dp.load_datasets(active_ids)
            if df is not None:
                kpis = dp.compute_kpis(df)
                p1_breached = int((df["sla_breached"] & (df["Priority"] == "P1")).sum())
                if p1_breached > 0:
                    items.append(schemas.NotificationOut(
                        id="p1-breach-summary", type="p1_breach",
                        message=f"{p1_breached} P1 ticket{'s' if p1_breached != 1 else ''} {'are' if p1_breached != 1 else 'is'} at risk of or in SLA breach",
                        link="/tickets?priority=P1&view=sla_breach", created_at=datetime.utcnow(),
                    ))
                if kpis["sla_at_risk"] > 0:
                    items.append(schemas.NotificationOut(
                        id="at-risk-summary", type="at_risk",
                        message=f"{kpis['sla_at_risk']} ticket{'s' if kpis['sla_at_risk'] != 1 else ''} at risk of breaching SLA within 24 hours",
                        link="/dashboard", created_at=datetime.utcnow(),
                    ))

    # Unacknowledged feedback addressed to this person (match by name, since
    # feedback is stored against the "Assigned To" name rather than a user id).
    unread_feedback = (
        db.query(models.AssociateFeedback)
        .filter(
            models.AssociateFeedback.associate_name.ilike(current_user.full_name.strip()),
            models.AssociateFeedback.acknowledged_at.is_(None),
        )
        .order_by(models.AssociateFeedback.created_at.desc())
        .limit(10)
        .all()
    )
    for f in unread_feedback:
        items.append(schemas.NotificationOut(
            id=f"feedback-{f.id}", type="feedback",
            message=f"New feedback from {f.given_by.full_name if f.given_by else 'your manager'}",
            link=f"/tickets?assignee={f.associate_name}", created_at=f.created_at,
        ))

    items.sort(key=lambda n: n.created_at, reverse=True)
    return items
