from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine
from app.routers import auth, upload, dashboard, ai, settings_router, feedback, datasets, chat, notifications, saved_filters, ai_token_analytics, ticket_classification, associates, copilot, semantic_analysis, servicenow

Base.metadata.create_all(bind=engine)


def _migrate_add_missing_columns():
    """create_all only creates brand-new tables, so an existing app.db from
    before a model gained new columns (e.g. semantic_ticket_conversations'
    contact/company/channel/state/priority/assigned_to) never gets them.
    This adds any column the model declares but the live table is missing -
    safe to run every startup since it's a no-op once columns exist."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_cols:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))


def _ensure_sample_sentiment_data():
    """The sample_data/ folder ships a handful of ready-to-upload demo
    files (sample_tickets.csv, sample_ticket_history.csv, ...) alongside the
    scripts that generated them. sample_sentiment_data.csv - the Sentiment
    Analysis tab's demo conversation export, built from sample_tickets.csv
    so the two demo datasets share ticket numbers - is one of them. This
    regenerates it on startup if it's ever missing (fresh clone that dropped
    generated files, etc.) so it's always there next to the backend server,
    same as the other sample inputs. Best-effort: never blocks startup."""
    sample_dir = Path(__file__).resolve().parent.parent / "sample_data"
    itsm_path = sample_dir / "sample_tickets.csv"
    out_path = sample_dir / "sample_sentiment_data.csv"
    script_path = sample_dir / "generate_sample_semantic_data.py"
    if out_path.exists() or not itsm_path.exists() or not script_path.exists():
        return
    try:
        subprocess.run(
            [sys.executable, str(script_path), "--input", str(itsm_path), "--output", str(out_path), "--seed", "42"],
            check=True, capture_output=True, timeout=60,
        )
    except Exception:
        pass


_migrate_add_missing_columns()
_ensure_sample_sentiment_data()

app = FastAPI(title=settings.APP_NAME, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {str(exc)}"})


app.include_router(auth.router)
app.include_router(upload.router)
app.include_router(dashboard.router)
app.include_router(ai.router)
app.include_router(settings_router.router)
app.include_router(feedback.router)
app.include_router(datasets.router)
app.include_router(chat.router)
app.include_router(notifications.router)
app.include_router(saved_filters.router)
app.include_router(ai_token_analytics.router)
app.include_router(ticket_classification.router)
app.include_router(associates.router)
app.include_router(copilot.router)
app.include_router(semantic_analysis.router)
app.include_router(servicenow.router)


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
