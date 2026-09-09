from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models

# Approximate public per-token pricing, in USD per 1,000 tokens, as of this
# codebase's knowledge cutoff. These are estimates for the Token Analytics
# page's "estimated cost" figures, not billing-accurate - actual provider
# invoices are the source of truth. Update here if a provider changes
# pricing or a new model is added to ai_providers.py.
MODEL_PRICING = {
    ("openai", "gpt-4o-mini"): {"input": 0.00015, "output": 0.0006},
    ("claude", "claude-sonnet-4-6"): {"input": 0.003, "output": 0.015},
    ("gemini", "gemini-2.0-flash"): {"input": 0.0001, "output": 0.0004},
    ("groq", "openai/gpt-oss-120b"): {"input": 0.00015, "output": 0.0006},
    ("groq", "openai/gpt-oss-20b"): {"input": 0.000075, "output": 0.0003},
    ("groq", "qwen/qwen3.6-27b"): {"input": 0.0001, "output": 0.0003},
    # Kept for historical usage rows recorded before this model was retired -
    # new calls no longer use it (see GroqProvider.MODEL_CANDIDATES).
    ("groq", "llama-3.3-70b-versatile"): {"input": 0.00059, "output": 0.00079},
}
DEFAULT_PRICING = {"input": 0.001, "output": 0.002}


def estimate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    # Ollama runs locally - there's no per-token bill, ever, regardless of
    # which local model was used. Special-cased ahead of the MODEL_PRICING
    # lookup so it can never fall through to DEFAULT_PRICING and report a
    # nonzero cost for something that cost nothing.
    if provider == "ollama":
        return 0.0
    pricing = MODEL_PRICING.get((provider, model), DEFAULT_PRICING)
    cost = (input_tokens / 1000) * pricing["input"] + (output_tokens / 1000) * pricing["output"]
    return round(cost, 6)


def record_usage(db: Session, user: models.User, feature: str, usage: dict, provider: Optional[str] = None) -> models.AITokenUsage:
    """Persists one AI provider call's token usage. `usage` is the dict
    returned by a BaseAIProvider call: {"model", "input_tokens",
    "output_tokens", "total_tokens"}. Caller is responsible for db.commit()
    (or letting an existing commit in the same request pick it up).

    Pass `provider` explicitly whenever the caller already resolved it (via
    ai_providers.resolve_provider) - that's the provider that actually
    served the request. Falling back to user.ai_provider_preference is only
    for callers that haven't been updated yet, and even then defaults to
    the server's actual default provider rather than hardcoding "openai" -
    otherwise every user who never touched Settings (i.e. everyone on the
    Ollama default) would have their usage mis-logged as OpenAI."""
    from app.config import settings

    resolved_provider = provider or getattr(user, "ai_provider_preference", None) or settings.AI_DEFAULT_PROVIDER
    model = usage.get("model", "unknown")
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    row = models.AITokenUsage(
        user_id=user.id,
        feature=feature,
        provider=resolved_provider,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        estimated_cost_usd=estimate_cost(resolved_provider, model, input_tokens, output_tokens),
    )
    db.add(row)
    return row


def _base_query(db: Session, user: models.User, filters: dict):
    q = db.query(models.AITokenUsage)

    # Associates only ever see their own usage; admins/SDMs see everyone's
    # unless they've picked a specific user in the filter bar.
    if user.role not in ("admin", "sdm"):
        q = q.filter(models.AITokenUsage.user_id == user.id)
    elif filters.get("user_id"):
        q = q.filter(models.AITokenUsage.user_id == filters["user_id"])

    if filters.get("date_from"):
        q = q.filter(models.AITokenUsage.created_at >= filters["date_from"])
    if filters.get("date_to"):
        q = q.filter(models.AITokenUsage.created_at < filters["date_to"] + timedelta(days=1))
    if filters.get("feature"):
        q = q.filter(models.AITokenUsage.feature == filters["feature"])
    if filters.get("provider"):
        q = q.filter(models.AITokenUsage.provider == filters["provider"])
    if filters.get("model"):
        q = q.filter(models.AITokenUsage.model == filters["model"])
    return q


def get_summary(db: Session, user: models.User, filters: dict) -> dict:
    q = _base_query(db, user, filters)
    row = q.with_entities(
        func.count(models.AITokenUsage.id),
        func.coalesce(func.sum(models.AITokenUsage.input_tokens), 0),
        func.coalesce(func.sum(models.AITokenUsage.output_tokens), 0),
        func.coalesce(func.sum(models.AITokenUsage.total_tokens), 0),
        func.coalesce(func.sum(models.AITokenUsage.estimated_cost_usd), 0.0),
    ).first()
    requests, input_tokens, output_tokens, total_tokens, cost = row
    model_count = q.with_entities(func.count(func.distinct(models.AITokenUsage.model))).scalar() or 0
    provider_count = q.with_entities(func.count(func.distinct(models.AITokenUsage.provider))).scalar() or 0
    top_model = (
        q.with_entities(models.AITokenUsage.provider, models.AITokenUsage.model, func.sum(models.AITokenUsage.total_tokens).label("tokens"))
        .group_by(models.AITokenUsage.provider, models.AITokenUsage.model)
        .order_by(func.sum(models.AITokenUsage.total_tokens).desc())
        .first()
    )
    return {
        "requests": int(requests or 0),
        "input_tokens": int(input_tokens or 0),
        "output_tokens": int(output_tokens or 0),
        "total_tokens": int(total_tokens or 0),
        "estimated_cost_usd": round(float(cost or 0), 4),
        "avg_tokens_per_request": round(total_tokens / requests, 1) if requests else 0.0,
        "active_models": int(model_count),
        "active_providers": int(provider_count),
        "top_model": f"{top_model[0]} / {top_model[1]}" if top_model else "—",
    }


def get_usage_by_date(db: Session, user: models.User, filters: dict) -> list:
    q = _base_query(db, user, filters)
    day = func.date(models.AITokenUsage.created_at)
    rows = (
        q.with_entities(
            day.label("day"), func.sum(models.AITokenUsage.input_tokens),
            func.sum(models.AITokenUsage.output_tokens), func.sum(models.AITokenUsage.total_tokens),
            func.count(models.AITokenUsage.id), func.sum(models.AITokenUsage.estimated_cost_usd),
        )
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [
        {"date": str(d), "input_tokens": int(i or 0), "output_tokens": int(o or 0),
         "tokens": int(t or 0), "requests": int(r or 0), "cost_usd": round(float(c or 0), 4)}
        for d, i, o, t, r, c in rows
    ]


def get_usage_logs(db: Session, user: models.User, filters: dict, limit: int = 100) -> list:
    """Recent provider calls for auditability. Content/prompts are deliberately
    never recorded here: usage observability must not expose ticket data."""
    q = _base_query(db, user, filters)
    if user.role in ("admin", "sdm"):
        q = q.outerjoin(models.User, models.AITokenUsage.user_id == models.User.id)
        rows = q.with_entities(models.AITokenUsage, models.User.full_name).order_by(models.AITokenUsage.created_at.desc()).limit(limit).all()
        return [_usage_log(row, name) for row, name in rows]
    return [_usage_log(row, None) for row in q.order_by(models.AITokenUsage.created_at.desc()).limit(limit).all()]


def _usage_log(row: models.AITokenUsage, user_name: Optional[str]) -> dict:
    return {
        "id": row.id, "timestamp": row.created_at.isoformat(), "feature": row.feature,
        "provider": row.provider, "model": row.model, "input_tokens": int(row.input_tokens or 0),
        "output_tokens": int(row.output_tokens or 0), "total_tokens": int(row.total_tokens or 0),
        "estimated_cost_usd": round(float(row.estimated_cost_usd or 0), 6), "user_name": user_name,
    }


def get_usage_by_feature(db: Session, user: models.User, filters: dict) -> list:
    q = _base_query(db, user, filters)
    rows = (
        q.with_entities(models.AITokenUsage.feature, func.sum(models.AITokenUsage.total_tokens), func.count(models.AITokenUsage.id))
        .group_by(models.AITokenUsage.feature)
        .all()
    )
    label = {"insights": "AI Insights", "chat": "AI Chatbot"}
    return [{"name": label.get(f, f), "value": int(t or 0), "requests": int(c or 0)} for f, t, c in rows]


def get_usage_by_model(db: Session, user: models.User, filters: dict) -> list:
    q = _base_query(db, user, filters)
    rows = (
        q.with_entities(models.AITokenUsage.provider, models.AITokenUsage.model, func.sum(models.AITokenUsage.total_tokens), func.count(models.AITokenUsage.id))
        .group_by(models.AITokenUsage.provider, models.AITokenUsage.model)
        .all()
    )
    return [{"name": f"{p} / {m}", "provider": p, "model": m, "value": int(t or 0), "requests": int(c or 0)} for p, m, t, c in rows]


def get_usage_by_user(db: Session, user: models.User, filters: dict) -> list:
    """Only meaningful for admin/sdm - associates are already scoped to
    themselves in _base_query, so this would just return one row for them."""
    if user.role not in ("admin", "sdm"):
        return []
    q = _base_query(db, user, filters)
    rows = (
        q.join(models.User, models.AITokenUsage.user_id == models.User.id)
        .with_entities(models.User.full_name, func.sum(models.AITokenUsage.total_tokens), func.count(models.AITokenUsage.id))
        .group_by(models.User.full_name)
        .order_by(func.sum(models.AITokenUsage.total_tokens).desc())
        .all()
    )
    return [{"name": n, "value": int(t or 0), "requests": int(c or 0)} for n, t, c in rows]


def get_filter_options(db: Session, user: models.User) -> dict:
    base = db.query(models.AITokenUsage)
    if user.role not in ("admin", "sdm"):
        base = base.filter(models.AITokenUsage.user_id == user.id)
    providers = [r[0] for r in base.with_entities(models.AITokenUsage.provider).distinct().all()]
    models_ = [r[0] for r in base.with_entities(models.AITokenUsage.model).distinct().all()]
    features = [r[0] for r in base.with_entities(models.AITokenUsage.feature).distinct().all()]
    users = []
    if user.role in ("admin", "sdm"):
        users = [
            {"id": r[0], "name": r[1]}
            for r in base.join(models.User, models.AITokenUsage.user_id == models.User.id)
            .with_entities(models.User.id, models.User.full_name).distinct().all()
        ]
    return {"providers": sorted(providers), "models": sorted(models_), "features": sorted(features), "users": users}
