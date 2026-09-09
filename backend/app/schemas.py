from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, EmailStr, Field


# ---------- Auth ----------

class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=8)
    organization: Optional[str] = None
    # Admin is intentionally not selectable here - the only way to become Admin
    # is either being the very first person ever to register (auto-bootstrap,
    # see auth.py) or being promoted by an existing Admin from Settings.
    role: Literal["sdm", "associate"] = "associate"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class UserOut(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    role: str
    approval_status: str
    organization: Optional[str] = None
    ai_provider_preference: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    organization: Optional[str] = None
    ai_provider_preference: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=8)
    current_password: Optional[str] = None


# ---------- Settings / AI ----------

class ApiKeyRequest(BaseModel):
    provider: Literal["ollama", "openai", "gemini", "claude", "groq"]
    api_key: str = ""


class OllamaConfigRequest(BaseModel):
    base_url: Optional[str] = None
    model: Optional[str] = None


class AISummaryRequest(BaseModel):
    dataset_id: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatRequest(BaseModel):
    dataset_id: Optional[str] = None  # comma-separated dataset ids, or a single one
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: Optional[str] = None  # None starts a new conversation
    # Prior turns for context - kept short client-side and truncated again
    # server-side (see chat.py) to bound token usage as a conversation grows.
    # Only used as a fallback if conversation_id isn't provided; when a
    # conversation_id IS given, history is loaded from the database instead.
    history: List[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    provider: str
    conversation_id: str


class ChatRegenerateRequest(BaseModel):
    conversation_id: str
    dataset_id: Optional[str] = None


class ChatMessageOut(BaseModel):
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatConversationSummary(BaseModel):
    id: str
    title: str
    updated_at: datetime
    message_count: int


class ChatConversationDetail(BaseModel):
    id: str
    title: str
    updated_at: datetime
    messages: List[ChatMessageOut]


# ---------- Dashboard ----------

class DashboardFilters(BaseModel):
    dataset_id: str
    status: Optional[List[str]] = None
    priority: Optional[List[str]] = None
    module: Optional[List[str]] = None
    customer: Optional[List[str]] = None
    application: Optional[List[str]] = None
    assignee: Optional[List[str]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


# ---------- Feedback ----------

class FeedbackCreate(BaseModel):
    associate_name: str
    message: str = Field(min_length=1, max_length=2000)


class FeedbackOut(BaseModel):
    id: str
    associate_name: str
    message: str
    given_by_name: str
    created_at: datetime
    acknowledged_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------- Notifications ----------

class NotificationOut(BaseModel):
    id: str
    type: str  # "pending_approval" | "at_risk" | "feedback"
    message: str
    link: str
    created_at: datetime


# ---------- Saved Filter Views ----------

class SavedFilterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters_json: str


class SavedFilterOut(BaseModel):
    id: str
    name: str
    filters_json: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- ServiceNow integration ----------

class ServiceNowSyncRequest(BaseModel):
    # Raw sysparm_query fragment, e.g. "active=true^priority=1". Optional -
    # omitted means "pull the most recently updated incidents" (see router).
    query: Optional[str] = None
    limit: int = Field(default=500, ge=1, le=1000)


class ServiceNowResolutionRequest(BaseModel):
    close_notes: Optional[str] = None
    resolution_notes: Optional[str] = None
    close_code: Optional[str] = None
    state: Optional[str] = None  # ServiceNow incident state value, e.g. "6" (Resolved) or "7" (Closed)
    ai_generated: bool = False
    ai_provider: Optional[str] = None


class ServiceNowGenerateResolutionRequest(BaseModel):
    sys_id: str
    additional_instructions: Optional[str] = None
