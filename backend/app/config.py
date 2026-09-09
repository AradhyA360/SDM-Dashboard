import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    APP_NAME: str = "Executive Service Health Dashboard"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-change-me-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./app.db")
    CORS_ORIGINS: list = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # AI provider defaults. Ollama runs locally - no ticket data or prompts
    # ever leave this machine/network for it, unlike the cloud providers
    # below - so it's the default every new user starts on. Cloud providers
    # (OpenAI/Claude/Gemini/Groq) remain available as an explicit opt-in per
    # user via Settings -> AI Provider, for when local hardware can't keep up
    # or a stronger model is wanted for a specific task.
    AI_DEFAULT_PROVIDER: str = os.getenv("AI_DEFAULT_PROVIDER", "ollama")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "gpt-oss:120b-cloud")

    # SMTP for the Incident Command Center's "send update email" action.
    # Deliberately unset by default - no email server is available yet - so
    # every send attempt is safely logged (EmailLog, status="not_configured")
    # rather than failing loudly. Once real SMTP credentials exist, set
    # these env vars and sends start actually going out with no code change.
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_USE_TLS: bool = os.getenv("SMTP_USE_TLS", "true").lower() != "false"

    # --- ServiceNow integration -------------------------------------------
    # Connects this dashboard to a ServiceNow instance (e.g. a free Personal
    # Developer Instance from developer.servicenow.com) so incidents can be
    # pulled in via the Table API and AI-generated resolution notes can be
    # written back to the same incident. Deliberately unset by default -
    # every endpoint in app/routers/servicenow.py checks
    # settings.SERVICENOW_INSTANCE_URL before doing anything and returns a
    # clear "not configured" response instead of failing with a confusing
    # connection error. See .env.example for the two supported auth modes.
    SERVICENOW_INSTANCE_URL: str = os.getenv("SERVICENOW_INSTANCE_URL", "")  # e.g. https://dev375971.service-now.com
    SERVICENOW_TABLE: str = os.getenv("SERVICENOW_TABLE", "incident")

    # "oauth" (recommended, and the default) or "basic". Basic Auth is kept
    # only because ServiceNow PDIs support it out of the box for fast local
    # testing - the Security Checklist for this integration calls for
    # OAuth 2.0 on any production-facing connection.
    SERVICENOW_AUTH_MODE: str = os.getenv("SERVICENOW_AUTH_MODE", "oauth")

    # Basic Auth credentials (POC only - never commit real values).
    SERVICENOW_USERNAME: str = os.getenv("SERVICENOW_USERNAME", "")
    SERVICENOW_PASSWORD: str = os.getenv("SERVICENOW_PASSWORD", "")

    # OAuth 2.0 (System OAuth > Application Registry on the instance),
    # password grant - matches the flow in the "Phase 2: API Connectivity"
    # setup guide. The access token itself is never persisted to disk; it's
    # cached in memory only for its lifetime (see servicenow_client.py).
    SERVICENOW_OAUTH_CLIENT_ID: str = os.getenv("SERVICENOW_OAUTH_CLIENT_ID", "")
    SERVICENOW_OAUTH_CLIENT_SECRET: str = os.getenv("SERVICENOW_OAUTH_CLIENT_SECRET", "")

    # Fallback close_code choices, used only if this backend can't reach the
    # instance's own sys_choice list for the incident.close_code field (see
    # /servicenow/close-codes). Kept in sync with ServiceNow's OOTB defaults.
    SERVICENOW_DEFAULT_CLOSE_CODES: list = [
        "Solved (Permanently)",
        "Solved (Work Around)",
        "Solved (Not Reproducible)",
        "Not Solved (Not Reproducible)",
        "Not Solved (Too Costly)",
        "Closed/Resolved by Caller",
    ]


settings = Settings()
