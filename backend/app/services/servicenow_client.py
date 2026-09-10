"""
Thin async client for the ServiceNow Table API (/api/now/table/...), used to
pull incidents into this dashboard and to write AI-generated resolution
notes back onto the incident they came from.

Follows the same "degrade safely, never guess" pattern as email_service.py:
every public function checks settings.SERVICENOW_INSTANCE_URL first and
returns a structured {"configured": False, ...} result instead of raising
a confusing connection error when the integration hasn't been set up yet.

Security notes (see the project's Pre-Production Security & Compliance
Checklist):
    - Basic Auth is the default for straightforward local/PDI setup. OAuth 2.0
        (password grant) is available as an explicit opt-in for shared or
        production-facing connections.
  - Credentials/tokens are read from environment variables (app/config.py)
    and are never logged or persisted to disk. The OAuth access token is
    cached in-process only, and re-fetched once it's within 60s of expiry.
  - close_code is always validated against the instance's own choice list
    (falling back to a static default set) before a PATCH is attempted, so
    a bad value fails fast client-side instead of corrupting the ticket.
  - Every PATCH attempt - success or failure - is meant to be written to
    ServiceNowAuditLog by the caller (see app/routers/servicenow.py), for
    the same reason EmailLog exists: a durable "who changed what, when"
    trail even when the call itself failed.
"""
import time
from typing import Optional

import httpx

from app.config import settings

_TOKEN_CACHE = {"access_token": None, "expires_at": 0.0}


class ServiceNowNotConfigured(Exception):
    pass


class ServiceNowAPIError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"ServiceNow API error ({status_code}): {detail}")


def is_configured() -> bool:
    return bool(settings.SERVICENOW_INSTANCE_URL)


def _base_url() -> str:
    return settings.SERVICENOW_INSTANCE_URL.rstrip("/")


def base_url() -> str:
    """Public accessor for the configured instance URL, for callers that
    just need it for display/logging (e.g. tagging a synced Dataset)."""
    return _base_url()


async def _get_oauth_token(client: httpx.AsyncClient) -> str:
    now = time.time()
    if _TOKEN_CACHE["access_token"] and _TOKEN_CACHE["expires_at"] - now > 60:
        return _TOKEN_CACHE["access_token"]

    if not (settings.SERVICENOW_OAUTH_CLIENT_ID and settings.SERVICENOW_OAUTH_CLIENT_SECRET
            and settings.SERVICENOW_USERNAME and settings.SERVICENOW_PASSWORD):
        raise ServiceNowNotConfigured(
            "SERVICENOW_AUTH_MODE=oauth requires SERVICENOW_OAUTH_CLIENT_ID, "
            "SERVICENOW_OAUTH_CLIENT_SECRET, SERVICENOW_USERNAME and SERVICENOW_PASSWORD."
        )

    resp = await client.post(
        f"{_base_url()}/oauth_token.do",
        data={
            "grant_type": "password",
            "client_id": settings.SERVICENOW_OAUTH_CLIENT_ID,
            "client_secret": settings.SERVICENOW_OAUTH_CLIENT_SECRET,
            "username": settings.SERVICENOW_USERNAME,
            "password": settings.SERVICENOW_PASSWORD,
        },
    )
    if resp.status_code != 200:
        raise ServiceNowAPIError(resp.status_code, resp.text[:500])

    data = resp.json()
    token = data["access_token"]
    _TOKEN_CACHE["access_token"] = token
    _TOKEN_CACHE["expires_at"] = now + int(data.get("expires_in", 1800))
    return token


async def _client_kwargs() -> dict:
    """Auth kwargs/headers to merge into an httpx call, based on
    SERVICENOW_AUTH_MODE. Raises ServiceNowNotConfigured with an actionable
    message rather than silently falling back to an unauthenticated call -
    every custom endpoint on the instance should require authentication
    (see Security Checklist item #2), and this client is no exception."""
    mode = (settings.SERVICENOW_AUTH_MODE or "basic").lower()
    if mode == "oauth":
        async with httpx.AsyncClient(timeout=20) as token_client:
            token = await _get_oauth_token(token_client)
        return {"headers": {"Authorization": f"Bearer {token}"}}
    if mode == "basic":
        if not (settings.SERVICENOW_USERNAME and settings.SERVICENOW_PASSWORD):
            raise ServiceNowNotConfigured(
                "SERVICENOW_AUTH_MODE=basic requires SERVICENOW_USERNAME and SERVICENOW_PASSWORD."
            )
        return {"auth": (settings.SERVICENOW_USERNAME, settings.SERVICENOW_PASSWORD)}
    raise ServiceNowNotConfigured(f"Unknown SERVICENOW_AUTH_MODE '{mode}' - use 'oauth' or 'basic'.")


async def test_connection() -> dict:
    """Cheap reachability + auth check: fetches 1 row from the configured
    table. Never returns credentials/tokens - only status."""
    if not is_configured():
        return {"configured": False, "reachable": False,
                "detail": "SERVICENOW_INSTANCE_URL is not set."}
    try:
        auth_kwargs = await _client_kwargs()
    except ServiceNowNotConfigured as e:
        return {"configured": True, "reachable": False, "detail": str(e)}

    url = f"{_base_url()}/api/now/table/{settings.SERVICENOW_TABLE}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params={"sysparm_limit": 1}, **auth_kwargs)
    except httpx.HTTPError as e:
        return {"configured": True, "reachable": False, "detail": f"Connection failed: {e}"}

    if resp.status_code == 200:
        return {"configured": True, "reachable": True, "auth_mode": settings.SERVICENOW_AUTH_MODE,
                "table": settings.SERVICENOW_TABLE, "instance": _base_url()}
    return {"configured": True, "reachable": False, "detail": resp.text[:300],
            "status_code": resp.status_code}


async def get_close_code_choices() -> list:
    """Pulls the live choice list for incident.close_code from
    sys_choice, so validation matches this specific instance rather than a
    hardcoded guess (Security Checklist item #7). Falls back to
    settings.SERVICENOW_DEFAULT_CLOSE_CODES if the instance can't be
    reached, so callers always get something to validate against."""
    if not is_configured():
        return list(settings.SERVICENOW_DEFAULT_CLOSE_CODES)
    try:
        auth_kwargs = await _client_kwargs()
        url = f"{_base_url()}/api/now/table/sys_choice"
        params = {
            "sysparm_query": f"name={settings.SERVICENOW_TABLE}^element=close_code",
            "sysparm_fields": "value,label",
            "sysparm_limit": 50,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params, **auth_kwargs)
        if resp.status_code == 200:
            rows = resp.json().get("result", [])
            labels = [r["label"] for r in rows if r.get("label")]
            if labels:
                return labels
    except Exception:
        pass
    return list(settings.SERVICENOW_DEFAULT_CLOSE_CODES)


async def list_incidents(query: Optional[str] = None, fields: Optional[list] = None, limit: int = 500) -> list:
    """GET a page of records from the configured table.
    `query` is a raw sysparm_query string (e.g. 'active=true^priority=1') -
    build it server-side only, never pass through unsanitized user text."""
    if not is_configured():
        raise ServiceNowNotConfigured("SERVICENOW_INSTANCE_URL is not set.")
    auth_kwargs = await _client_kwargs()
    url = f"{_base_url()}/api/now/table/{settings.SERVICENOW_TABLE}"
    params = {"sysparm_limit": min(limit, 1000), "sysparm_display_value": "true"}
    if query:
        params["sysparm_query"] = query
    if fields:
        params["sysparm_fields"] = ",".join(fields)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, params=params, **auth_kwargs)
    if resp.status_code != 200:
        raise ServiceNowAPIError(resp.status_code, resp.text[:500])
    return resp.json().get("result", [])


async def get_incident(sys_id: str) -> dict:
    if not is_configured():
        raise ServiceNowNotConfigured("SERVICENOW_INSTANCE_URL is not set.")
    auth_kwargs = await _client_kwargs()
    url = f"{_base_url()}/api/now/table/{settings.SERVICENOW_TABLE}/{sys_id}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, params={"sysparm_display_value": "true"}, **auth_kwargs)
    if resp.status_code != 200:
        raise ServiceNowAPIError(resp.status_code, resp.text[:500])
    return resp.json().get("result", {})


async def patch_incident(sys_id: str, payload: dict) -> dict:
    """PATCH /api/now/table/{table}/{sys_id}. Caller is responsible for
    validating close_code beforehand (see get_close_code_choices) and for
    writing the outcome to ServiceNowAuditLog - this function only talks to
    the API and raises ServiceNowAPIError on a non-2xx response so the
    caller can log the failure with the real status/detail."""
    if not is_configured():
        raise ServiceNowNotConfigured("SERVICENOW_INSTANCE_URL is not set.")
    auth_kwargs = await _client_kwargs()
    url = f"{_base_url()}/api/now/table/{settings.SERVICENOW_TABLE}/{sys_id}"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    headers.update(auth_kwargs.pop("headers", {}))
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(url, json=payload, headers=headers, **auth_kwargs)
    if resp.status_code not in (200, 201):
        raise ServiceNowAPIError(resp.status_code, resp.text[:500])
    return resp.json().get("result", {})


# Maps this dashboard's canonical EXPECTED_COLUMNS (app/services/data_processing.py)
# to ServiceNow's own incident table field names, so a sync pulls straight
# into the same schema the rest of the app already understands.
FIELD_MAP = {
    "Number": "number",
    "Opened": "opened_at",
    "Short Description": "short_description",
    "Category": "category",
    "Priority": "priority",
    "State": "state",
    "Name": "caller_id",
    "Assignment Group": "assignment_group",
    "Assigned To": "assigned_to",
    "Company": "company",
    "Business Service": "business_service",
    "Country": "location",
    "Main Contact Name": "caller_id",
    "Manager": "u_manager",
    "Location": "location",
    "Updated By": "sys_updated_by",
    "Associate Assignment Date": "sys_updated_on",
    "SLA Due Date": "sla_due",
    "Resolved Date": "resolved_at",
    "Closed Date": "closed_at",
    "Pending Reason": "u_pending_reason",
    "Type": "contact_type",
}


def map_incident_to_row(sn_record: dict) -> dict:
    """Converts one ServiceNow incident record (display values) into a row
    keyed by this dashboard's canonical column names."""
    row = {}
    for display_col, sn_field in FIELD_MAP.items():
        val = sn_record.get(sn_field)
        if isinstance(val, dict):
            val = val.get("display_value")
        row[display_col] = val
    row["sys_id"] = sn_record.get("sys_id")
    return row
