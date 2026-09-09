# Simple in-memory store for per-user session data (API keys, active datasets).
# Intentionally NOT persisted to disk or database - cleared on server restart,
# and API keys are only ever held for the current process lifetime/session.

_api_keys: dict[str, dict[str, str]] = {}
# The set of datasets currently being analyzed together, org-wide (not
# per-user) - matches the existing "global" behavior from before multi-dataset
# support, just extended from a single id to a set of ids.
_active_dataset_ids: set[str] = set()

# Org-wide override for the locally-hosted Ollama server's base_url/model, so
# an SDM can point the app at a different Ollama instance or model from the
# Settings page - without editing app.config.settings.OLLAMA_BASE_URL /
# OLLAMA_MODEL (env vars) and restarting the backend, which was the previous
# only way and is what made "changing AI provider" so time-consuming. Kept
# org-wide (like the active dataset set above) rather than per-user, since
# Ollama itself is typically one shared instance the whole team points at.
_ollama_override: dict[str, str] = {}


def get_ollama_override() -> dict:
    return dict(_ollama_override)


def set_ollama_override(base_url: str | None = None, model: str | None = None) -> None:
    if base_url:
        _ollama_override["base_url"] = base_url
    if model:
        _ollama_override["model"] = model


def clear_ollama_override() -> None:
    _ollama_override.clear()


def set_api_key(user_id: str, provider: str, api_key: str) -> None:
    _api_keys.setdefault(user_id, {})[provider] = api_key


def get_api_key(user_id: str, provider: str) -> str | None:
    return _api_keys.get(user_id, {}).get(provider)


def clear_api_key(user_id: str, provider: str | None = None) -> None:
    if provider is None:
        _api_keys.pop(user_id, None)
    else:
        _api_keys.get(user_id, {}).pop(provider, None)


def list_configured_providers(user_id: str) -> list[str]:
    return list(_api_keys.get(user_id, {}).keys())


def get_active_dataset_ids() -> list[str]:
    return list(_active_dataset_ids)


def add_active_dataset(dataset_id: str) -> None:
    """Adds a dataset to the active set without removing any others - lets
    several uploads be analyzed together instead of one replacing another."""
    _active_dataset_ids.add(dataset_id)


def remove_active_dataset(dataset_id: str) -> None:
    _active_dataset_ids.discard(dataset_id)


def set_active_datasets(dataset_ids: list[str]) -> None:
    """Replaces the whole active set at once - used by the Uploaded Data
    page's multi-select checkboxes."""
    global _active_dataset_ids
    _active_dataset_ids = set(dataset_ids)


def clear_dataset_if_active(dataset_id: str) -> None:
    """Called when a dataset is deleted - drop it from the active set if it
    was part of it."""
    _active_dataset_ids.discard(dataset_id)
