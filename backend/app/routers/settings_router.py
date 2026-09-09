from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.services import session_store

router = APIRouter(prefix="/settings", tags=["settings"])

# Providers a person can pick from in Settings -> AI Provider. Kept here
# (rather than only in ai_providers.py) so the frontend has one place to ask
# "what's selectable" without also pulling in every provider's httpx logic.
AI_PROVIDER_OPTIONS = [
    {"id": "ollama", "label": "Ollama (Local)", "requires_key": False,
     "note": "Runs on your own network - no ticket data leaves it. Default."},
    {"id": "openai", "label": "OpenAI", "requires_key": True, "note": "Cloud - requires an API key."},
    {"id": "claude", "label": "Claude (Anthropic)", "requires_key": True, "note": "Cloud - requires an API key."},
    {"id": "gemini", "label": "Gemini (Google)", "requires_key": True, "note": "Cloud - requires an API key."},
    {"id": "groq", "label": "Groq", "requires_key": True, "note": "Cloud - requires an API key."},
]


@router.get("/ai-providers")
async def list_ai_providers(current_user: models.User = Depends(get_current_user)):
    """Every selectable AI provider, plus which one this user currently has
    set (falling back to the server-wide default when they haven't chosen)."""
    return {
        "providers": AI_PROVIDER_OPTIONS,
        "current": current_user.ai_provider_preference or settings.AI_DEFAULT_PROVIDER,
        "default": settings.AI_DEFAULT_PROVIDER,
    }


@router.get("/ollama/status")
async def ollama_status(current_user: models.User = Depends(get_current_user)):
    """Pings the currently-configured Ollama server (org override if one is
    set, else the env-var default) and lists what models are already
    pulled, so the Settings page can show "reachable / not reachable" and
    "model X is/isn't installed" without the person needing to open a
    terminal to check."""
    from app.services.ai_providers import OllamaProvider

    provider = OllamaProvider()
    result = await _probe_ollama(provider.base_url, provider.model)
    result["is_override"] = bool(session_store.get_ollama_override())
    return result


async def _probe_ollama(base_url: str, model: str) -> dict:
    result = {"base_url": base_url, "configured_model": model, "reachable": False, "models": []}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base_url.rstrip('/')}/api/tags")
        if resp.status_code == 200:
            result["reachable"] = True
            result["models"] = [m.get("name") for m in resp.json().get("models", [])]
            result["model_installed"] = any(
                n == model or n.startswith(model + ":") for n in result["models"]
            )
    except Exception as e:
        result["error"] = str(e)
    return result


@router.post("/ollama/validate")
async def validate_ollama(payload: schemas.OllamaConfigRequest, current_user: models.User = Depends(get_current_user)):
    """Tests a base_url/model combination WITHOUT saving it, so an SDM can
    check "does this actually work" before committing to a switch - this is
    the validation step that was missing and made changing Ollama settings
    such a time-consuming trial-and-error process (edit .env, restart the
    server, try a request, repeat)."""
    base_url = payload.base_url or settings.OLLAMA_BASE_URL
    model = payload.model or settings.OLLAMA_MODEL
    return await _probe_ollama(base_url, model)


@router.put("/ollama/config")
async def set_ollama_config(payload: schemas.OllamaConfigRequest, current_user: models.User = Depends(get_current_user)):
    """Saves a new Ollama base_url/model as the org-wide active configuration
    - takes effect immediately for every subsequent AI request, no backend
    restart needed."""
    if not payload.base_url and not payload.model:
        raise HTTPException(status_code=400, detail="Provide at least a base_url or a model")
    session_store.set_ollama_override(base_url=payload.base_url, model=payload.model)
    from app.services.ai_providers import OllamaProvider
    provider = OllamaProvider()
    return {"message": "Ollama configuration updated", "base_url": provider.base_url, "model": provider.model}


@router.delete("/ollama/config")
async def reset_ollama_config(current_user: models.User = Depends(get_current_user)):
    """Clears any override, reverting to the .env-configured defaults."""
    session_store.clear_ollama_override()
    from app.services.ai_providers import OllamaProvider
    provider = OllamaProvider()
    return {"message": "Reverted to default Ollama configuration", "base_url": provider.base_url, "model": provider.model}


@router.post("/api-key")
async def save_api_key(payload: schemas.ApiKeyRequest, current_user: models.User = Depends(get_current_user)):
    session_store.set_api_key(current_user.id, payload.provider, payload.api_key)
    return {"message": f"{payload.provider} API key saved for this session"}


@router.delete("/api-key/{provider}")
async def clear_api_key(provider: str, current_user: models.User = Depends(get_current_user)):
    session_store.clear_api_key(current_user.id, provider)
    return {"message": f"{provider} API key cleared"}


@router.get("/api-key/status")
async def api_key_status(current_user: models.User = Depends(get_current_user)):
    return {"configured_providers": session_store.list_configured_providers(current_user.id)}


@router.post("/api-key/test")
async def test_api_key(payload: schemas.ApiKeyRequest):
    from app.services.ai_providers import get_provider
    try:
        provider = get_provider(payload.provider, payload.api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        await provider.validate_key()
        return {"success": True, "message": "Connection successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}")


# ---------- Admin: user management ----------

@router.get("/users", response_model=list[schemas.UserOut])
async def list_users(current_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    """Approved users only - use /settings/pending-users for the approval queue."""
    return db.query(models.User).filter(models.User.approval_status == "approved").all()


@router.get("/pending-users", response_model=list[schemas.UserOut])
async def list_pending_users(current_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    return (
        db.query(models.User)
        .filter(models.User.approval_status == "pending")
        .order_by(models.User.created_at.asc())
        .all()
    )


@router.post("/users/{user_id}/approve")
async def approve_user(
    user_id: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.approval_status = "approved"
    db.commit()
    return {"message": f"{user.full_name} approved and can now sign in"}


@router.post("/users/{user_id}/reject")
async def reject_user(
    user_id: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.approval_status = "rejected"
    db.commit()
    return {"message": f"{user.full_name}'s request was rejected"}


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str, role: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if role not in ("admin", "sdm", "associate"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'sdm', or 'associate'")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = role
    db.commit()
    return {"message": "Role updated"}


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"message": "User deactivated"}
