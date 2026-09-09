from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user
from app.services import ai_token_tracking as tracking

router = APIRouter(prefix="/ai-token-analytics", tags=["ai-token-analytics"])


def _build_filters(date_from: Optional[str], date_to: Optional[str], feature: Optional[str],
                    provider: Optional[str], model: Optional[str], user_id: Optional[str]) -> dict:
    filters = {"feature": feature, "provider": provider, "model": model, "user_id": user_id}
    if date_from:
        filters["date_from"] = datetime.combine(date.fromisoformat(date_from), datetime.min.time())
    if date_to:
        filters["date_to"] = datetime.combine(date.fromisoformat(date_to), datetime.min.time())
    return filters


@router.get("")
async def token_analytics(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    feature: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    user_id: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Everything the AI Token Analytics page needs in one call: summary
    KPIs, a daily trend, and breakdowns by feature/model/user."""
    filters = _build_filters(date_from, date_to, feature, provider, model, user_id)
    return {
        "summary": tracking.get_summary(db, current_user, filters),
        "usage_by_date": tracking.get_usage_by_date(db, current_user, filters),
        "usage_by_feature": tracking.get_usage_by_feature(db, current_user, filters),
        "usage_by_model": tracking.get_usage_by_model(db, current_user, filters),
        "usage_by_user": tracking.get_usage_by_user(db, current_user, filters),
        "usage_logs": tracking.get_usage_logs(db, current_user, filters),
        "filter_options": tracking.get_filter_options(db, current_user),
        "scope": "all" if current_user.role in ("admin", "sdm") else "self",
    }
