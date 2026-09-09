import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Integer, Float, Text
from sqlalchemy.orm import relationship
from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class SemanticTicketConversation(Base):
    """One ticket's full conversation record, imported from the RAG Semantic
    Analysis upload (Number, Short description, Assignment Group, Ticket
    Type, First Assignment Group, Additional comments (end-user view), Work
    notes (internal view)) - matches the columns exported straight out of
    ServiceNow. Every uploaded file's rows accumulate here (they are not tied
    to a single Dataset) so the RAG corpus grows across uploads, the same way
    TicketHistoryEvent accumulates across 'Individual Ticket History'
    uploads.

    sentiment/sentiment_score are the lexicon-based fallback score (see
    dp.analyze_sentiment) computed over the combined comments+work-notes text
    at ingest time, used for the dashboard's charts and as a cheap retrieval
    signal even when no AI provider is configured. last_activity_at is the
    latest timestamp parsed out of the journal-style comment/work-note text
    itself (e.g. '24-08-2026 19:01:23 - Name (Work notes (internal view))'),
    used to build the sentiment-trend-over-time chart."""
    __tablename__ = "semantic_ticket_conversations"

    id = Column(String, primary_key=True, default=gen_uuid)
    number = Column(String, nullable=False, index=True)
    short_description = Column(Text, nullable=True)
    assignment_group = Column(String, nullable=True)
    ticket_type = Column(String, nullable=True)
    first_assignment_group = Column(String, nullable=True)
    additional_comments = Column(Text, nullable=True)  # end-user view
    work_notes = Column(Text, nullable=True)  # internal view
    sentiment = Column(String, nullable=True)  # "Positive" | "Neutral" | "Negative"
    sentiment_score = Column(Float, nullable=True)  # -1.0 .. +1.0
    # A manually-associated sentiment set by any signed-in user from the
    # Incident detail page (one of the 5 SENTIMENT_BUCKETS), which - when
    # present - takes precedence over the auto-computed sentiment_score
    # everywhere a sentiment bucket is derived (trend chart, breakdown table,
    # KPIs, insights), so overriding it is reflected consistently across the
    # whole Sentiment Analysis feature instead of just on the one record.
    sentiment_override = Column(String, nullable=True)
    sentiment_override_by = Column(String, nullable=True)
    sentiment_override_at = Column(DateTime, nullable=True)
    last_activity_at = Column(DateTime, nullable=True)
    # Extra case-record fields (all optional on upload) purely so the
    # "Record details" table and breakdown charts can mirror the columns
    # shown on ServiceNow's own CSM sentiment dashboard - Contact, Company,
    # Channel, State, Priority, Assigned to - instead of only the RAG-corpus
    # fields above. Backfilled with realistic placeholders at ingest time
    # when a source file doesn't provide them.
    contact = Column(String, nullable=True)
    company = Column(String, nullable=True)
    channel = Column(String, nullable=True)
    state = Column(String, nullable=True)
    priority = Column(String, nullable=True)
    assigned_to = Column(String, nullable=True)
    # True when the uploaded conversation file itself explicitly supplied
    # this field for this row (rather than it being backfilled from the
    # canonical ticket dataset by Number, or synthesized as a last resort).
    # A resync against the ticket dataset never overwrites a field the
    # uploader actually provided - only these "not from the file" fields.
    company_is_uploaded = Column(Boolean, nullable=False, default=False)
    state_is_uploaded = Column(Boolean, nullable=False, default=False)
    priority_is_uploaded = Column(Boolean, nullable=False, default=False)
    assigned_to_is_uploaded = Column(Boolean, nullable=False, default=False)
    source_filename = Column(String, nullable=True)
    uploaded_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="associate")  # "admin", "sdm", or "associate"
    # "pending" until an Admin approves; "approved" can log in; "rejected" can never log in.
    # The very first user ever registered is auto-approved as Admin (bootstrap) - see auth.py.
    approval_status = Column(String, default="pending")
    organization = Column(String, nullable=True)
    # Which AI provider generates this user's insights/chat replies.
    # "ollama" (local, no data leaves the network) is the default for every
    # new account - cloud providers are an explicit per-user opt-in via
    # Settings -> AI Provider. See app.services.ai_providers.resolve_provider,
    # which falls back to settings.AI_DEFAULT_PROVIDER when this is null.
    ai_provider_preference = Column(String, default="ollama")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(String, primary_key=True, default=gen_uuid)
    token = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(String, primary_key=True, default=gen_uuid)
    token = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AssociateFeedback(Base):
    """Feedback an SDM (admin) leaves for an associate (the "Assigned To" name
    on tickets) - not tied to a single ticket, since feedback is often about a
    pattern across several tickets rather than one incident."""
    __tablename__ = "associate_feedback"

    id = Column(String, primary_key=True, default=gen_uuid)
    associate_name = Column(String, nullable=False, index=True)
    message = Column(String, nullable=False)
    given_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    acknowledged_at = Column(DateTime, nullable=True)

    given_by = relationship("User")


class Dataset(Base):
    """Metadata for every ticket file ever uploaded, so past uploads stay
    listed, switchable, and deletable rather than being silently replaced by
    whatever was uploaded most recently. The id here matches the on-disk
    Parquet filename in backend/storage/. This table is what makes historical
    uploads durable across a backend restart (unlike the in-memory 'currently
    active dataset' set, which is intentionally not persisted)."""
    __tablename__ = "datasets"

    id = Column(String, primary_key=True, default=gen_uuid)
    original_filename = Column(String, nullable=False)
    row_count = Column(Integer, nullable=False)
    uploaded_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Soft-delete: a deleted file moves to a recovery list instead of
    # vanishing immediately, in case someone unchecked/deleted the wrong one.
    deleted_at = Column(DateTime, nullable=True)

    uploaded_by = relationship("User")


class SavedFilterView(Base):
    """A named, reusable combination of Dashboard filters - saves re-picking
    the same six dropdowns every time someone wants the same slice of data."""
    __tablename__ = "saved_filter_views"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    filters_json = Column(String, nullable=False)  # serialized filter state
    created_at = Column(DateTime, default=datetime.utcnow)


class QueueDescription(Base):
    """Reference data: a brief description of the kind of tickets each queue
    (e.g. L1/L2/L3 Team, ABAP/FI/SD/MM Team) typically handles. One row per
    queue - re-uploading replaces the description for that queue name.
    Surfaced alongside a queue name in the ticket history dropdown."""
    __tablename__ = "queue_descriptions"

    id = Column(String, primary_key=True, default=gen_uuid)
    queue = Column(String, nullable=False, unique=True, index=True)
    description = Column(String, nullable=False)
    is_tcs_team = Column(Boolean, nullable=True)  # True=TCS, False=Non-TCS, None=unknown
    uploaded_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AssociateProfile(Base):
    """Links a User (role='associate') to the TCS team area they support -
    the same area names used in queue routing (ABAP, FI, SD, MM, or a
    non-TCS queue). Associates in the same team_area are each other's
    backup: LeaveRequest's approval rule below only lets one person per
    area be on approved Leave at a time, on overlapping dates, so an area
    never loses full coverage. Generalizes past exactly-two-people areas -
    any number of associates can share a team_area."""
    __tablename__ = "associate_profiles"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), unique=True, nullable=False)
    team_area = Column(String, nullable=False, index=True)

    user = relationship("User")


class LeaveRequest(Base):
    """An associate's request to be away (Leave) or work from home (WFH) for
    a date range. Starts 'pending' and has no effect on availability until
    an SDM/admin approves it via /associates/leave-requests/{id}/approve -
    that endpoint re-checks the same-team_area conflict rule at approval
    time (not just when the request was filed), since two pending requests
    can each look fine alone but conflict once both are approved. WFH has no
    such restriction - two associates in the same area can both WFH on the
    same days, since neither one becomes unavailable for tickets. Only Leave
    is capped at one approved person per area per overlapping date range."""
    __tablename__ = "leave_requests"

    id = Column(String, primary_key=True, default=gen_uuid)
    associate_user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    request_type = Column(String, nullable=False)  # "leave" or "wfh"
    date_from = Column(DateTime, nullable=False)
    date_to = Column(DateTime, nullable=False)
    reason = Column(String, nullable=True)
    status = Column(String, default="pending", index=True)  # pending, approved, rejected
    reviewed_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    associate = relationship("User", foreign_keys=[associate_user_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_user_id])


class TicketClassification(Base):
    """Manual SDM/associate override of a ticket's true type - User Request
    vs genuine Incident - keyed by ticket Number. The rule-based 'Suggested
    Type' engine in data_processing.py makes a first guess from the ticket's
    Short Description; once a person manually classifies a ticket one way or
    the other, that decision wins over the guess. User Request tickets are
    excluded from every backlog view, since a request-in-disguise was never
    really sitting in the incident queue.
    `similar_group_key` records what the ticket was grouped by when this
    classification was applied (the matched rule category, or "text-match"),
    so a later bulk-apply on the same group can be traced back."""
    __tablename__ = "ticket_classifications"

    id = Column(String, primary_key=True, default=gen_uuid)
    incident_number = Column(String, nullable=False, unique=True, index=True)
    ticket_type = Column(String, nullable=False)  # "incident" or "user_request"
    similar_group_key = Column(String, nullable=True)
    set_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    set_by = relationship("User")


class TicketHistoryEvent(Base):
    """One queue-movement row for a ticket, imported from the 'Individual
    Ticket History (Sentiment Analysis)' upload (Incident Number, Queue,
    Timestamp, Status, Assigned Associate, Time Spent, and an optional
    Comment/Notes column). A ticket typically has several of these as it
    moves between TCS/non-TCS queues - this is what powers the per-ticket
    history dropdown/timeline on the Tickets page and TCS-only SLA
    recalculation. Not tied to a specific Dataset, since this file is
    uploaded and re-uploaded independently of the main ITSM dump.

    comment/sentiment/sentiment_score are new columns added for sentiment
    analysis on the per-ticket comment text - NOTE: on an existing app.db
    created before this change, SQLAlchemy's create_all() won't retroactively
    add them to the already-existing table; delete/recreate app.db (or run a
    manual ALTER TABLE) to pick them up."""
    __tablename__ = "ticket_history_events"

    id = Column(String, primary_key=True, default=gen_uuid)
    incident_number = Column(String, nullable=False, index=True)
    queue = Column(String, nullable=True)
    timestamp = Column(DateTime, nullable=True)
    status = Column(String, nullable=True)
    assigned_associate = Column(String, nullable=True)
    time_spent_minutes = Column(Float, nullable=True)
    time_spent_raw = Column(String, nullable=True)  # original text, e.g. "2 hr 13 mins"
    comment = Column(Text, nullable=True)  # free-text note/comment for this movement, if provided
    sentiment = Column(String, nullable=True)  # "Positive" | "Neutral" | "Negative", derived from `comment`
    sentiment_score = Column(Float, nullable=True)  # -1.0 (very negative) .. +1.0 (very positive)
    uploaded_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatConversation(Base):
    """One AI Chatbot conversation thread, scoped to a single user. Title is
    derived from the first message so the history list is scannable without
    opening each thread."""
    __tablename__ = "chat_conversations"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False, default="New conversation")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship("ChatMessageRow", back_populates="conversation", cascade="all, delete-orphan", order_by="ChatMessageRow.created_at")


class ChatMessageRow(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=gen_uuid)
    conversation_id = Column(String, ForeignKey("chat_conversations.id"), nullable=False, index=True)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("ChatConversation", back_populates="messages")


class AgentRun(Base):
    """One AI Agent session - a single user instruction that the agent worked
    through autonomously, possibly calling several tools (querying tickets,
    classifying them, saving views...) before answering. Kept as its own row
    (rather than reusing ChatConversation) because an agent run has structure
    a plain chat transcript lacks: ordered steps, which tools ran, what they
    changed - an audit trail an SDM (or an auditor) can replay."""
    __tablename__ = "agent_runs"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    dataset_id = Column(String, nullable=True)  # comma-separated ids active during the run
    message = Column(String, nullable=False)  # the instruction that started it
    status = Column(String, default="running", index=True)  # running | completed | failed | max_iterations
    final_reply = Column(String, nullable=True)
    iterations = Column(Integer, default=0)
    provider = Column(String, nullable=True)
    error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    steps = relationship("AgentStep", back_populates="run", cascade="all, delete-orphan", order_by="AgentStep.step_index")


class AgentStep(Base):
    """One atomic move inside an AgentRun: either the model deciding to call
    a tool ("tool_call"), the executed outcome ("tool_result"), or its final
    answer to the user ("final"). Write-tool steps additionally carry
    affected_count so the UI can show exactly what the agent changed without
    parsing JSON blobs."""
    __tablename__ = "agent_steps"

    id = Column(String, primary_key=True, default=gen_uuid)
    run_id = Column(String, ForeignKey("agent_runs.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)
    kind = Column(String, nullable=False)  # "tool_call" | "tool_result" | "final"
    tool_name = Column(String, nullable=True, index=True)  # None for "final"
    is_write = Column(Boolean, default=False)  # True when this step mutated data
    arguments_json = Column(String, nullable=True)
    result_summary = Column(String, nullable=True)  # one-line human-readable outcome
    result_json = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    run = relationship("AgentRun", back_populates="steps")


class AITokenUsage(Base):
    """One row per AI provider call (an AI Insights generation, or a single
    chat turn) - the record behind the AI Token Analytics page. Kept as its
    own append-only table (not derived from ChatMessageRow) since Insights
    calls don't create chat messages at all, and because token/cost figures
    need to survive a conversation being deleted."""
    __tablename__ = "ai_token_usage"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    feature = Column(String, nullable=False, index=True)  # "insights" or "chat"
    provider = Column(String, nullable=False, index=True)  # "openai", "claude", "gemini", "groq"
    model = Column(String, nullable=False)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    estimated_cost_usd = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User")


class TicketFieldEdit(Base):
    """Audit log AND overlay source for direct field edits an SDM makes on
    one incident from the Incident Command Center (Priority / State /
    Assignment Group / Assigned To). Applied on top of the uploaded
    dataframe via ticket_classification.apply_all_overlays - exactly like
    TicketClassification - so the original uploaded CSV/Excel file is never
    touched, but every page that reads ticket data (dashboard, tickets
    list, command center) sees the edited value. Restricted server-side to
    tickets whose most recent queue-history event is a TCS-managed queue
    (see copilot.py's TCS-editable gate) - a ticket with no recorded queue
    history is never editable."""
    __tablename__ = "ticket_field_edits"

    id = Column(String, primary_key=True, default=gen_uuid)
    incident_number = Column(String, nullable=False, index=True)
    field_name = Column(String, nullable=False)
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    edited_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    edited_at = Column(DateTime, default=datetime.utcnow, index=True)

    edited_by = relationship("User")


class EmailLog(Base):
    """Every incident-update email the Command Center has attempted to
    send, whether or not it actually went out. Recorded either way so the
    SDM has a durable trail of "who was told what, when" even before real
    SMTP credentials are configured (status is 'not_configured' until then,
    'sent' or 'failed' once they are) - see app/services/email_service.py."""
    __tablename__ = "email_logs"

    id = Column(String, primary_key=True, default=gen_uuid)
    incident_number = Column(String, nullable=True, index=True)
    sender = Column(String, nullable=False)
    recipients = Column(String, nullable=False)  # comma-separated addresses
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String, nullable=False)  # "sent" | "failed" | "not_configured"
    error = Column(String, nullable=True)
    sent_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    sent_by = relationship("User")


class ServiceNowSyncLog(Base):
    """One row per pull from the connected ServiceNow instance into a local
    Dataset (see /servicenow/sync-incidents). Kept separate from the plain
    file-upload Dataset row so it's traceable which datasets came from a
    real ServiceNow instance vs. a manually uploaded CSV/Excel export, and
    so a failed sync attempt is still recorded (status='failed') rather
    than silently disappearing."""
    __tablename__ = "servicenow_sync_logs"

    id = Column(String, primary_key=True, default=gen_uuid)
    instance_url = Column(String, nullable=False)
    table = Column(String, nullable=False, default="incident")
    query = Column(String, nullable=True)  # sysparm_query used, for traceability
    dataset_id = Column(String, nullable=True)  # set on success, matches Dataset.id
    row_count = Column(Integer, nullable=True)
    status = Column(String, nullable=False)  # "success" | "failed"
    error = Column(String, nullable=True)
    synced_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    synced_by = relationship("User")


class ServiceNowAuditLog(Base):
    """Every attempt (successful or not) to write an AI-generated
    resolution/close note back onto a ServiceNow incident, via
    POST /servicenow/incidents/{sys_id}/resolution. This is the "Update
    local audit DB" step of the AI-agent integration and exists for the
    same reason EmailLog does: a durable record of who changed what, when,
    and with what result, independent of whether ServiceNow accepted the
    change - see the Pre-Production Security & Compliance Checklist item
    on auditing REST access."""
    __tablename__ = "servicenow_audit_logs"

    id = Column(String, primary_key=True, default=gen_uuid)
    incident_sys_id = Column(String, nullable=False, index=True)
    incident_number = Column(String, nullable=True, index=True)
    close_code = Column(String, nullable=True)
    close_notes = Column(Text, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    state = Column(String, nullable=True)
    ai_generated = Column(Boolean, default=False)
    ai_provider = Column(String, nullable=True)
    http_status = Column(Integer, nullable=True)
    status = Column(String, nullable=False)  # "success" | "failed"
    error = Column(String, nullable=True)
    performed_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    performed_by = relationship("User")
