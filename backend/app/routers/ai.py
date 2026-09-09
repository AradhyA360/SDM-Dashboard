from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas
from app.database import get_db
from app.deps import get_current_user
from app.services import data_processing as dp
from app.services import ai_token_tracking as tracking
from app.services import ai_providers
from app.routers.ticket_classification import apply_all_overlays

router = APIRouter(tags=["ai"])


@router.post("/generate-ai-summary")
async def generate_ai_summary(
    payload: schemas.AISummaryRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset_ids = [d.strip() for d in payload.dataset_id.split(",") if d.strip()]
    df = dp.load_datasets(dataset_ids)
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    # Merge manual User Request / Incident overrides so the AI's narrative
    # (backlog size, user-request counts, etc.) matches what the dashboard
    # itself is showing - without this, the AI summary would quote whatever
    # the rule-based guess said even after an SDM had corrected it.
    df = apply_all_overlays(df, db)

    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    kpis = dp.compute_kpis(df)
    context = dp.build_ai_context(df, kpis)

    try:
        result = await provider.generate_insights(context)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    tracking.record_usage(db, current_user, "insights", result["usage"], provider=provider_name)
    db.commit()

    return {"provider": provider_name, "insights": result["insights"]}
