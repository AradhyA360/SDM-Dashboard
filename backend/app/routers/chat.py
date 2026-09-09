import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import require_uploader
from app.services import data_processing as dp
from app.services import ai_token_tracking as tracking
from app.services import ai_providers
from app.services import agent_tools
from app.routers.ticket_classification import apply_all_overlays

router = APIRouter(tags=["chat"])

# Only the most recent turns are sent to the model - a chat that runs long
# shouldn't mean every subsequent message re-bills for the entire transcript.
MAX_HISTORY_MESSAGES = 6
MAX_AGENT_STEPS = 4
READ_ONLY_TOOLS = [tool for tool in agent_tools.TOOLS if not tool["write"]]

DATA_GROUNDED_SYSTEM = """You are the SDM Ticket Intelligence assistant. Answer ONLY about the active ticket dataset and its operational implications for an SDM. You MUST call one or more data tools before every answer. Every ticket number, name, date, count, SLA statement, and recommendation must be grounded in the tool results from this turn. Do not answer general-knowledge questions, invent details, or make up root causes. If the active data cannot answer the question, say exactly what data is missing and suggest the relevant SDM next step. Keep the answer concise: findings first, then a specific SDM action."""


def _title_from_message(message: str) -> str:
    title = message.strip().splitlines()[0]
    return title[:60] + ("…" if len(title) > 60 else "")


def _add_usage(total: dict, usage: dict) -> dict:
    total["model"] = usage.get("model") or total.get("model", "unknown")
    total["input_tokens"] += int(usage.get("input_tokens") or 0)
    total["output_tokens"] += int(usage.get("output_tokens") or 0)
    total["total_tokens"] += int(usage.get("total_tokens") or 0)
    return total


async def _run_data_grounded_agent(provider, messages: list, tool_context: agent_tools.ToolContext) -> dict:
    """Run a bounded, read-only tool loop for factual SDM chat answers.

    The previous free-form chat only saw a tiny summary, so a model could
    drift into generic advice. This loop lets it query the actual active
    dataset for each question and makes all dashboard facts traceable.
    """
    working_messages = list(messages)
    usage = {"model": "unknown", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    system = DATA_GROUNDED_SYSTEM
    used_tool = False

    for _ in range(MAX_AGENT_STEPS):
        result = await provider.chat_with_tools(working_messages, READ_ONLY_TOOLS, system)
        _add_usage(usage, result.get("usage") or {})
        tool_calls = result.get("tool_calls") or []
        if not tool_calls:
            reply = (result.get("content") or "").strip()
            if reply and used_tool:
                return {"reply": reply, "usage": usage}
            break

        working_messages.append({
            "role": "assistant", "content": result.get("content") or "", "tool_calls": tool_calls,
        })
        for call in tool_calls[:4]:
            tool_result, _ = agent_tools.execute_tool(tool_context, call.get("name"), call.get("arguments") or {})
            used_tool = True
            working_messages.append({
                "role": "tool", "tool_call_id": call.get("id"), "content": json.dumps(tool_result, default=str),
            })

    return {
        "reply": "I could not complete a data-grounded answer from the active dataset. Please try a narrower ticket, SLA, backlog, or associate question.",
        "usage": usage,
    }


@router.post("/chat", response_model=schemas.ChatResponse)
async def chat(
    payload: schemas.ChatRequest,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # The agent reads compact, targeted slices through read-only tools rather
    # than receiving raw ticket rows in its prompt.
    df = None
    if payload.dataset_id:
        dataset_ids = [d.strip() for d in payload.dataset_id.split(",") if d.strip()]
        df = dp.load_datasets(dataset_ids)
        if df is not None:
            # Same merge as the dashboard/AI-summary endpoints, so the chat
            # assistant's numbers agree with what the person is looking at.
            df = apply_all_overlays(df, db)

    # Load or create the conversation this message belongs to.
    conversation = None
    if payload.conversation_id:
        conversation = (
            db.query(models.ChatConversation)
            .filter(models.ChatConversation.id == payload.conversation_id, models.ChatConversation.user_id == current_user.id)
            .first()
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation:
        # Use the real stored history for this conversation, not whatever the
        # client happened to send - the database is the source of truth.
        prior = conversation.messages[-MAX_HISTORY_MESSAGES:]
        history = [{"role": m.role, "content": m.content} for m in prior]
    else:
        conversation = models.ChatConversation(user_id=current_user.id, title=_title_from_message(payload.message))
        db.add(conversation)
        db.flush()  # assigns conversation.id without committing yet
        history = [{"role": m.role, "content": m.content} for m in payload.history[-MAX_HISTORY_MESSAGES:]]

    messages = [*history, {"role": "user", "content": payload.message}]
    if df is None:
        result = {"reply": "Activate a ticket dataset before using the SDM chatbot. It only provides evidence-based answers from the active ticket data.", "usage": None}
    else:
        try:
            tool_context = agent_tools.ToolContext(user=current_user, db=db, df=df, dataset_id=payload.dataset_id)
            result = await _run_data_grounded_agent(provider, messages, tool_context)
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=502, detail=f"AI provider error: {e}")
    reply = result["reply"]

    db.add(models.ChatMessageRow(conversation_id=conversation.id, role="user", content=payload.message))
    db.add(models.ChatMessageRow(conversation_id=conversation.id, role="assistant", content=reply))
    if result.get("usage"):
        tracking.record_usage(db, current_user, "chat", result["usage"], provider=provider_name)
    db.commit()

    return schemas.ChatResponse(reply=reply, provider=provider_name, conversation_id=conversation.id)


@router.post("/chat/regenerate", response_model=schemas.ChatResponse)
async def regenerate(
    payload: schemas.ChatRegenerateRequest,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Drops the last assistant reply in a conversation and asks the same
    question again - handy when the first answer wasn't useful."""
    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    conversation = (
        db.query(models.ChatConversation)
        .filter(models.ChatConversation.id == payload.conversation_id, models.ChatConversation.user_id == current_user.id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs = conversation.messages
    if not msgs or msgs[-1].role != "assistant":
        raise HTTPException(status_code=400, detail="Nothing to regenerate yet")

    last_assistant = msgs[-1]
    prior = [m for m in msgs[:-1]]
    if not prior or prior[-1].role != "user":
        raise HTTPException(status_code=400, detail="Nothing to regenerate yet")

    df = None
    if payload.dataset_id:
        dataset_ids = [d.strip() for d in payload.dataset_id.split(",") if d.strip()]
        df = dp.load_datasets(dataset_ids)
        if df is not None:
            # Same merge as the dashboard/AI-summary endpoints, so the chat
            # assistant's numbers agree with what the person is looking at.
            df = apply_all_overlays(df, db)

    history = [{"role": m.role, "content": m.content} for m in prior[-(MAX_HISTORY_MESSAGES + 1):-1]]
    last_user_message = prior[-1].content
    messages = [*history, {"role": "user", "content": last_user_message}]

    if df is None:
        result = {"reply": "Activate a ticket dataset before using the SDM chatbot. It only provides evidence-based answers from the active ticket data.", "usage": None}
    else:
        try:
            tool_context = agent_tools.ToolContext(user=current_user, db=db, df=df, dataset_id=payload.dataset_id or "")
            result = await _run_data_grounded_agent(provider, messages, tool_context)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI provider error: {e}")
    reply = result["reply"]

    db.delete(last_assistant)
    db.add(models.ChatMessageRow(conversation_id=conversation.id, role="assistant", content=reply))
    if result.get("usage"):
        tracking.record_usage(db, current_user, "chat", result["usage"], provider=provider_name)
    db.commit()

    return schemas.ChatResponse(reply=reply, provider=provider_name, conversation_id=conversation.id)


@router.get("/chat/conversations", response_model=list[schemas.ChatConversationSummary])
async def list_conversations(
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    conversations = (
        db.query(models.ChatConversation)
        .filter(models.ChatConversation.user_id == current_user.id)
        .order_by(models.ChatConversation.updated_at.desc())
        .all()
    )
    return [
        schemas.ChatConversationSummary(
            id=c.id, title=c.title, updated_at=c.updated_at, message_count=len(c.messages)
        )
        for c in conversations
    ]


@router.get("/chat/conversations/{conversation_id}", response_model=schemas.ChatConversationDetail)
async def get_conversation(
    conversation_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(models.ChatConversation)
        .filter(models.ChatConversation.id == conversation_id, models.ChatConversation.user_id == current_user.id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return schemas.ChatConversationDetail(
        id=conversation.id, title=conversation.title, updated_at=conversation.updated_at,
        messages=[schemas.ChatMessageOut.model_validate(m) for m in conversation.messages],
    )


@router.delete("/chat/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(models.ChatConversation)
        .filter(models.ChatConversation.id == conversation_id, models.ChatConversation.user_id == current_user.id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conversation)
    db.commit()
    return {"message": "Conversation deleted"}
