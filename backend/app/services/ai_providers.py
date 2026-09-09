import json
import re
from abc import ABC, abstractmethod
import httpx

from app.config import settings
from app.services import session_store


def _openai_tool_messages(messages: list) -> list:
    """Converts the agent loop's normalized internal message format into the
    OpenAI chat-completions message shape, which Groq mirrors. Used by the
    OpenAI and Groq providers' chat_with_tools so both render tool calls and
    tool results identically:
      - assistant with tool_calls -> {"role":"assistant", content, tool_calls:
        [{id, type:"function", function:{name, arguments(JSON string)}}]}
      - tool result -> {"role":"tool", tool_call_id, content}
      - everything else passes through as-is."""
    out = []
    for m in messages:
        if m["role"] == "tool":
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
        elif m["role"] == "assistant" and m.get("tool_calls"):
            out.append({
                "role": "assistant",
                "content": m.get("content") or "",
                "tool_calls": [
                    {"id": tc["id"], "type": "function",
                     "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                    for tc in m["tool_calls"]
                ],
            })
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


def _openai_tool_specs(tools: list) -> list:
    return [
        {"type": "function", "function": {
            "name": t["name"], "description": t["description"], "parameters": t["parameters"],
        }}
        for t in tools
    ]

SYSTEM_PROMPT = """You are an expert Service Delivery analyst writing for busy Service Delivery Managers (SDMs).
Given ticket KPIs and context for an AMS operation, return structured JSON with these exact keys (all arrays of strings):
executive_summary, root_cause_analysis, top_risks, bottlenecks, workload_imbalance, sla_risk_explanation,
recommended_actions, management_summary, next_week_prediction.

Hard rules for every field:
- Maximum 3 bullets per array. Prefer 2 when the data is thin.
- Each bullet is ONE short sentence (max ~25 words). No paragraphs.
- Lead with a concrete number from the provided context (counts, %, days, names of modules/associates).
- Say what the SDM should care about or do — not generic advice.
- Do NOT invent figures, names, or events missing from the context.
- Do NOT include any overall health score or "out of 100" rating.

Example style: "SLA breach is 18% (42 tickets) — focus P1/P2 aging over 7 days first."
Respond with ONLY valid JSON, no markdown fences, no preamble."""

# Deliberately short - this is a chat assistant, not a report generator, and
# keeping the system prompt terse plus a low max_tokens on every provider call
# below is the main lever for keeping per-message cost down.
CHAT_SYSTEM_PROMPT = """You are a helpful assistant embedded in a Service Delivery dashboard for an \
Application Management Services (AMS) team. You'll be given a compact summary of the currently \
uploaded ticket data as context - use it to answer questions about tickets, SLAs, backlog, or \
associates when relevant. You can also answer general questions unrelated to the data. Be concise \
and direct. If the context doesn't contain something the person asked about, say so plainly instead \
of guessing or inventing numbers."""

# Powers the SDM Copilot briefing (routers/copilot.py). Deliberately different
# from SYSTEM_PROMPT above: every number in the context this prompt receives
# (backlog counts, coverage gaps, reassignment candidates) was already
# computed deterministically in Python before the model ever sees it - the
# model's job is ONLY to prioritize and narrate what's already true, never to
# calculate or invent a number itself. That split is what keeps this feature
# trustworthy enough for an SDM to act on directly.
SDM_COPILOT_SYSTEM_PROMPT = """You are an AI Copilot for a Service Delivery Manager (SDM), embedded in \
their dashboard. You will be given a pre-computed, already-accurate briefing packet: ticket KPIs, \
SLA/backlog hotspots, and - uniquely - today's and this week's team Leave/WFH schedule cross-referenced \
against open ticket ownership and coverage per team area.

Your ONLY job is to prioritize and narrate what's already in the packet into a same-day action plan. \
Return structured JSON with these exact keys:
- headline: ONE sentence, the single most important thing for the SDM to know right now.
- priority_actions: array of up to 5 objects {"title": short imperative string, "detail": one sentence \
with a concrete number from the packet, "urgency": "high"|"medium"|"low"}. Order by urgency.
- coverage_watch: array of up to 4 short sentences about team-area coverage risk THIS WEEK, each citing \
the specific area, date, and who's out - ONLY if the packet's coverage_gaps or upcoming_leave sections \
are non-empty, otherwise return an empty array.
- reassignment_calls: array of up to 4 short sentences recommending a specific reassignment ONLY if the \
packet's reassignment_suggestions section lists one - name both associates and the ticket count.
- good_news: array of up to 2 short sentences highlighting genuinely positive movement in the packet \
(e.g. falling backlog, high CSAT) - if nothing stands out, return an empty array. Never fabricate positivity.

Hard rules:
- NEVER invent a number, name, date, or ticket that is not literally present in the packet you were given.
- Every sentence must be traceable to a specific fact in the packet - no generic SDM advice.
- If a section of the packet is empty or says "none", the corresponding output array MUST be empty too.
- Keep every string under 30 words.
Respond with ONLY valid JSON, no markdown fences, no preamble."""


# Powers the Semantic Analysis tab (routers/semantic_analysis.py). The
# "context" this prompt receives is a RAG packet: only the retrieved
# excerpts from the uploaded User<->TCS-Associate conversation files (the
# most negative-scoring, most positive-scoring, and per-group breakdowns),
# never the whole corpus - deliberately mirroring the "Generated insights"
# cards on ServiceNow's own Sentiment Analysis dashboard (Negative sentiment
# drivers / Positive sentiment drivers / Top negative assignment groups /
# Sentiment change after escalation / Number of cases by channel).
SEMANTIC_ANALYSIS_SYSTEM_PROMPT = """You are an expert Customer Service analyst performing Retrieval-Augmented \
semantic analysis over a set of retrieved excerpts from real ticket conversations between end users and \
support associates (their Additional Comments and Work Notes). You were given ONLY the most relevant/most \
extreme excerpts, not the full ticket volume - treat every count you cite as describing that retrieved sample.

Return structured JSON with these exact keys:
- negative_sentiment_drivers: {"summary": one sentence, "top_reasons": array of up to 3 short bullets}
- positive_sentiment_drivers: {"summary": one sentence, "top_reasons": array of up to 3 short bullets}
- top_negative_assignment_groups: {"summary": one sentence, "groups": array of up to 5 {"name": string, "count": int}}
- sentiment_change_after_escalation: one or two sentences describing whether escalated tickets read more negative
  afterward, citing specifics from the excerpts - or "No qualifying escalations found in the retrieved excerpts."
  if none are present.
- key_quotes: array of up to 3 {"number": ticket number string, "excerpt": a short paraphrase (never a verbatim
  quote) of what that ticket's conversation shows, "sentiment": "Positive"|"Negative"}

Hard rules:
- Only use tickets/numbers/reasons literally present in the excerpts you were given - never invent a ticket
  number, name, or count.
- Paraphrase excerpt content in your own words; do not reproduce the source text verbatim.
- Keep every bullet under 20 words.
- If a section has nothing to report from the given excerpts, return it with empty arrays/a neutral one-line
  summary rather than fabricating content.
Respond with ONLY valid JSON, no markdown fences, no preamble."""


class BaseAIProvider(ABC):
    def __init__(self, api_key: str):
        self.api_key = api_key

    @abstractmethod
    async def generate_insights(self, data_context: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
        """Returns {"insights": dict, "usage": {"model", "input_tokens", "output_tokens", "total_tokens"}}.
        system_prompt defaults to the standard SDM-insights prompt but can be
        swapped out (e.g. by the SDM Copilot) for a differently-focused one
        while reusing the exact same JSON-mode plumbing per provider."""
        ...

    @abstractmethod
    async def chat(self, messages: list, data_context: str) -> dict:
        """Returns {"reply": str, "usage": {"model", "input_tokens", "output_tokens", "total_tokens"}}.
        messages is a list of {"role": "user"|"assistant", "content": str} in
        chronological order. data_context is prepended once as part of the
        system prompt, not repeated per message - callers should also keep
        messages short (see the /chat endpoint, which caps history
        server-side) to keep token usage down on every turn."""
        ...

    @abstractmethod
    async def validate_key(self) -> None:
        """Raise an exception with a clear message if the key is invalid. Must NOT depend
        on the model returning valid JSON - only on the API call succeeding."""
        ...

    @staticmethod
    def _parse_json(text: str) -> dict:
        cleaned = text.strip()
        # Some Groq reasoning models occasionally leak internal control
        # tokens (e.g. "<|return|>", "<|end|>") into the content string even
        # when reasoning is meant to be hidden - strip anything that looks
        # like one before touching fences/braces.
        cleaned = re.sub(r"<\|[a-zA-Z_]+\|>", "", cleaned).strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:]
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1:
                return json.loads(cleaned[start:end + 1])
            raise

    @staticmethod
    def _raise_for_status(resp: httpx.Response, provider_label: str) -> None:
        if resp.status_code == 401 or resp.status_code == 403:
            raise ValueError(f"{provider_label} rejected the API key (unauthorized). Double-check the key.")
        if resp.status_code == 429:
            raise ValueError(f"{provider_label} rate limit or quota exceeded for this key.")
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise ValueError(f"{provider_label} returned {resp.status_code}: {detail}")

    @staticmethod
    def _usage(model: str, input_tokens: int, output_tokens: int) -> dict:
        input_tokens = int(input_tokens or 0)
        output_tokens = int(output_tokens or 0)
        return {
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }

    @staticmethod
    def _safe_json(text) -> dict:
        """Parse a tool-call arguments string (or already-dict) into a dict.
        Never raises - a malformed args string becomes {"_raw": text} so the
        agent still gets something to work with instead of a dead call."""
        if isinstance(text, dict):
            return text
        if isinstance(text, str):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"_raw": text}
        return text or {}

    @abstractmethod
    async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict:
        """Agentic tool-calling turn. `messages` uses the loop's normalized
        OpenAI-style format (see services/agent.py); `tools` is a list of
        {"name", "description", "parameters"} JSON-schema tool definitions.

        Returns {"content": str|None, "tool_calls":
        [{"id", "name", "arguments": dict}], "usage": {...}}. `content` is the
        direct answer when the model chose not to call a tool; `tool_calls`
        drives the agent's next iteration. Implementations must convert
        normalized messages into the provider's native tool-accepting shape
        and parse the provider's tool-call responses back into that shape."""
        ...


class OpenAIProvider(BaseAIProvider):
    async def validate_key(self) -> None:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            self._raise_for_status(resp, "OpenAI")

    async def generate_insights(self, data_context: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
        model = "gpt-4o-mini"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": data_context},
                    ],
                    "temperature": 0.4,
                    "max_tokens": 1200,
                },
            )
            self._raise_for_status(resp, "OpenAI")
            body = resp.json()
            content = body["choices"][0]["message"]["content"]
            usage = body.get("usage", {})
            return {
                "insights": self._parse_json(content),
                "usage": self._usage(model, usage.get("prompt_tokens"), usage.get("completion_tokens")),
            }

    async def chat(self, messages: list, data_context: str) -> dict:
        model = "gpt-4o-mini"
        system = f"{CHAT_SYSTEM_PROMPT}\n\nCURRENT TICKET DATA CONTEXT:\n{data_context}"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "system", "content": system}, *messages],
                    "temperature": 0.4,
                    "max_tokens": 500,
                },
            )
            self._raise_for_status(resp, "OpenAI")
            body = resp.json()
            usage = body.get("usage", {})
            return {
                "reply": body["choices"][0]["message"]["content"].strip(),
                "usage": self._usage(model, usage.get("prompt_tokens"), usage.get("completion_tokens")),
            }

    async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict:
        """OpenAI native function calling. The normalized message format maps
        one-to-one onto the OpenAI wire format (see _openai_tool_messages), so
        this is mostly a thin payload - the parsing of tool_calls back into
        {"id","name","arguments"} is the part that needs care."""
        model = "gpt-4o-mini"
        payload_messages = [{"role": "system", "content": system}, *_openai_tool_messages(messages)]
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": model,
                    "messages": payload_messages,
                    "tools": _openai_tool_specs(tools),
                    "temperature": 0.2,
                    "max_tokens": 1500,
                },
            )
            self._raise_for_status(resp, "OpenAI")
            body = resp.json()
            msg = body["choices"][0]["message"]
            usage = body.get("usage", {})
            return {
                "content": msg.get("content"),
                "tool_calls": [
                    {"id": tc["id"], "name": tc["function"]["name"],
                     "arguments": self._safe_json(tc["function"].get("arguments") or "{}")}
                    for tc in msg.get("tool_calls") or []
                ],
                "usage": self._usage(model, usage.get("prompt_tokens"), usage.get("completion_tokens")),
            }


class ClaudeProvider(BaseAIProvider):
    async def validate_key(self) -> None:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 8,
                    "messages": [{"role": "user", "content": "Reply with OK."}],
                },
            )
            self._raise_for_status(resp, "Claude")

    async def generate_insights(self, data_context: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
        model = "claude-sonnet-4-6"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 1200,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": data_context}],
                },
            )
            self._raise_for_status(resp, "Claude")
            body = resp.json()
            content = body["content"][0]["text"]
            usage = body.get("usage", {})
            return {
                "insights": self._parse_json(content),
                "usage": self._usage(model, usage.get("input_tokens"), usage.get("output_tokens")),
            }

    async def chat(self, messages: list, data_context: str) -> dict:
        model = "claude-sonnet-4-6"
        system = f"{CHAT_SYSTEM_PROMPT}\n\nCURRENT TICKET DATA CONTEXT:\n{data_context}"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 500,
                    "system": system,
                    "messages": messages,
                },
            )
            self._raise_for_status(resp, "Claude")
            body = resp.json()
            usage = body.get("usage", {})
            return {
                "reply": body["content"][0]["text"].strip(),
                "usage": self._usage(model, usage.get("input_tokens"), usage.get("output_tokens")),
            }

    async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict:
        """Anthropic tool_use blocks. Conversion notes:
        - Assistant tool-calls become a content array of text + tool_use blocks
          (multiple tool calls are legal and all stay on the same turn).
        - Tool results MUST be delivered as a user message whose content is a
          list of tool_result blocks. Consecutive tool results are merged into
          one user turn so Claude sees them as a single batch - the agent loop
          can emit several tool calls per iteration."""
        model = "claude-sonnet-4-6"
        native_tools = [
            {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
            for t in tools
        ]
        native_msgs = []
        for m in messages:
            if m["role"] == "tool":
                block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}
                prev = native_msgs[-1] if native_msgs else None
                if prev and prev["role"] == "user" and isinstance(prev.get("content"), list) \
                        and prev["content"] and prev["content"][0].get("type") == "tool_result":
                    prev["content"].append(block)
                else:
                    native_msgs.append({"role": "user", "content": [block]})
            elif m["role"] == "assistant" and m.get("tool_calls"):
                blocks = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": m["content"]})
                for tc in m["tool_calls"]:
                    blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["arguments"]})
                native_msgs.append({"role": "assistant", "content": blocks})
            else:
                native_msgs.append({"role": m["role"], "content": m["content"]})

        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 2000,
                    "system": system,
                    "tools": native_tools,
                    "messages": native_msgs,
                },
            )
            self._raise_for_status(resp, "Claude")
            body = resp.json()
            usage = body.get("usage", {})
            blocks = body.get("content", [])
            return {
                "content": "".join(b.get("text", "") for b in blocks if b.get("type") == "text") or None,
                "tool_calls": [
                    {"id": b["id"], "name": b["name"], "arguments": b.get("input") or {}}
                    for b in blocks if b.get("type") == "tool_use"
                ],
                "usage": self._usage(model, usage.get("input_tokens"), usage.get("output_tokens")),
            }


class GeminiProvider(BaseAIProvider):
    async def validate_key(self) -> None:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}",
            )
            self._raise_for_status(resp, "Gemini")

    async def generate_insights(self, data_context: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
        model = "gemini-2.0-flash"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}",
                json={
                    "contents": [{"parts": [{"text": f"{system_prompt}\n\n{data_context}"}]}],
                    "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1200},
                },
            )
            self._raise_for_status(resp, "Gemini")
            body = resp.json()
            content = body["candidates"][0]["content"]["parts"][0]["text"]
            usage = body.get("usageMetadata", {})
            return {
                "insights": self._parse_json(content),
                "usage": self._usage(model, usage.get("promptTokenCount"), usage.get("candidatesTokenCount")),
            }

    async def chat(self, messages: list, data_context: str) -> dict:
        model = "gemini-2.0-flash"
        system = f"{CHAT_SYSTEM_PROMPT}\n\nCURRENT TICKET DATA CONTEXT:\n{data_context}"
        # Gemini uses "model" instead of "assistant" and a different message shape.
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
        ]
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}",
                json={
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": contents,
                    "generationConfig": {"temperature": 0.4, "maxOutputTokens": 500},
                },
            )
            self._raise_for_status(resp, "Gemini")
            body = resp.json()
            usage = body.get("usageMetadata", {})
            return {
                "reply": body["candidates"][0]["content"]["parts"][0]["text"].strip(),
                "usage": self._usage(model, usage.get("promptTokenCount"), usage.get("candidatesTokenCount")),
            }

    async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict:
        """Gemini function declarations. Tool calls arrive as functionCall
        parts on a model turn; results are sent back as functionResponse
        parts on a user turn. Gemini rejects several JSON-Schema keywords
        (additionalProperties, default, nullable) in the parameters - the
        agent registry keeps its schemas minimal for exactly this reason, and
        we defensively strip anything unsupported here."""
        model = "gemini-2.0-flash"
        declarations = [self._strip_schema(t["parameters"]) for t in tools]

        contents = []
        for m in messages:
            if m["role"] == "tool":
                try:
                    parsed = json.loads(m["content"])
                except Exception:
                    parsed = {"result": m["content"]}
                contents.append({
                    "role": "user",
                    "parts": [{"functionResponse": {"name": m["name"], "response": {"result": parsed}}}],
                })
            elif m["role"] == "assistant" and m.get("tool_calls"):
                parts = []
                if m.get("content"):
                    parts.append({"text": m["content"]})
                for tc in m["tool_calls"]:
                    parts.append({"functionCall": {"name": tc["name"], "args": tc["arguments"]}})
                contents.append({"role": "model", "parts": parts})
            else:
                role = "user" if m["role"] == "user" else "model"
                contents.append({"role": role, "parts": [{"text": m["content"]}]})

        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}",
                json={
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": contents,
                    "tools": [{"function_declarations": declarations}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2000},
                },
            )
            self._raise_for_status(resp, "Gemini")
            body = resp.json()
            usage = body.get("usageMetadata", {})
            parts = body["candidates"][0]["content"].get("parts", [])
            return {
                "content": "".join(p.get("text", "") for p in parts if "text" in p) or None,
                "tool_calls": [
                    {"id": f"gc_{i}", "name": p["functionCall"]["name"], "arguments": p["functionCall"].get("args") or {}}
                    for i, p in enumerate(parts) if "functionCall" in p
                ],
                "usage": self._usage(model, usage.get("promptTokenCount"), usage.get("candidatesTokenCount")),
            }

    @staticmethod
    def _strip_schema(schema: dict) -> dict:
        """Removes JSON-Schema keywords Gemini's function declarations reject,
        so a shared minimal schema can back all providers."""
        out = {}
        for k, v in (schema or {}).items():
            if k in ("additionalProperties", "default", "nullable"):
                continue
            if isinstance(v, dict) and k in ("properties", "items"):
                out[k] = GeminiProvider._strip_schema(v)
            elif isinstance(v, list) and k == "enum":
                out[k] = v
            else:
                out[k] = v
        return out


class GroqProvider(BaseAIProvider):
    """Groq uses an OpenAI-compatible chat completions API, served over their own
    low-latency inference infrastructure. Groq periodically deprecates/retires
    specific models (llama-3.3-70b-versatile and llama-3.1-8b-instant were both
    retired), and different keys/plans can have different models enabled, so
    rather than hard-coding one model we try a small fallback chain in order
    and move to the next candidate if a given model is unavailable for this
    key/account - "any key picked from Groq works well" without per-key setup."""

    # Ordered most-to-least capable. openai/gpt-oss-120b is Groq's own
    # recommended replacement for the retired llama-3.3-70b-versatile.
    MODEL_CANDIDATES = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"]
    DEFAULT_MODEL = MODEL_CANDIDATES[0]

    # gpt-oss-120b/20b and qwen3.6 are reasoning models: before writing the
    # actual answer they spend tokens on hidden chain-of-thought, and that
    # comes out of the same max_tokens budget as the answer itself. Left at
    # Groq's default ("medium"/"default") reasoning effort, a low max_tokens
    # can get eaten entirely by reasoning, leaving the JSON answer truncated
    # - which Groq's own response_format=json_object validator then rejects
    # with a 400 "json_validate_failed" (and an empty failed_generation,
    # since nothing complete was produced). Dropping reasoning effort to the
    # lowest supported value per model leaves more of the budget for the
    # actual JSON. gpt-oss models take low/medium/high; qwen3.6 takes
    # none/default.
    REASONING_EFFORT = {
        "openai/gpt-oss-120b": "low",
        "openai/gpt-oss-20b": "low",
        "qwen/qwen3.6-27b": "none",
    }

    async def validate_key(self) -> None:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            self._raise_for_status(resp, "Groq")

    @staticmethod
    def _is_json_validate_failed(resp: httpx.Response) -> bool:
        try:
            return resp.json().get("error", {}).get("code") == "json_validate_failed"
        except Exception:
            return False

    async def _chat_completion_with_fallback(self, client: httpx.AsyncClient, build_payload) -> tuple[dict, str]:
        """Tries each candidate model in order. A 400/404 is normally treated
        as "this model isn't available for this key/account" and we move on;
        401/403/429 are key-level problems and fail immediately since no
        model will help.

        One exception: Groq's own structured-output validator (used when
        response_format=json_object/json_schema) intermittently 400s with
        "json_validate_failed" even for a fully-available model - it's a
        flaky generation failure, not an availability problem, and retrying
        the SAME model once resolves it the large majority of the time. Only
        after a same-model retry also fails do we treat it like any other
        400 and move to the next candidate."""
        last_error = None
        for model in self.MODEL_CANDIDATES:
            for attempt in range(2):
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=build_payload(model),
                )
                if resp.status_code in (401, 403, 429):
                    self._raise_for_status(resp, "Groq")
                if resp.status_code in (400, 404):
                    last_error = resp
                    if resp.status_code == 400 and self._is_json_validate_failed(resp) and attempt == 0:
                        continue  # transient - retry this same model once
                    break
                self._raise_for_status(resp, "Groq")
                return resp.json(), model
        # Every candidate was rejected (or failed json validation twice) - surface the last error.
        self._raise_for_status(last_error, "Groq")
        raise ValueError("Groq: no supported model available for this API key.")

    async def generate_insights(self, data_context: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
        def build_payload(model: str) -> dict:
            return {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": data_context},
                ],
                "temperature": 0.4,
                # Reasoning tokens come out of this same budget (see
                # REASONING_EFFORT above) - 1200 was tight enough that the
                # JSON answer could get truncated before it was ever
                # written, which is what was producing the
                # json_validate_failed 400s. 2200 leaves comfortable room
                # for both the (now-reduced) reasoning and the full
                # 9-field JSON object.
                "max_tokens": 2200,
                "response_format": {"type": "json_object"},
                "reasoning_effort": self.REASONING_EFFORT.get(model, "low"),
            }

        async with httpx.AsyncClient(timeout=60) as client:
            body, model = await self._chat_completion_with_fallback(client, build_payload)
            content = body["choices"][0]["message"]["content"]
            usage = body.get("usage", {})
            return {
                "insights": self._parse_json(content),
                "usage": self._usage(model, usage.get("prompt_tokens"), usage.get("completion_tokens")),
            }

    async def chat(self, messages: list, data_context: str) -> dict:
        system = f"{CHAT_SYSTEM_PROMPT}\n\nCURRENT TICKET DATA CONTEXT:\n{data_context}"

        def build_payload(model: str) -> dict:
            return {
                "model": model,
                "messages": [{"role": "system", "content": system}, *messages],
                "temperature": 0.4,
                "max_tokens": 500,
            }

        async with httpx.AsyncClient(timeout=60) as client:
            body, model = await self._chat_completion_with_fallback(client, build_payload)
            usage = body.get("usage", {})
            return {
                "reply": body["choices"][0]["message"]["content"].strip(),
                "usage": self._usage(model, usage.get("prompt_tokens"), usage.get("completion_tokens")),
            }

    async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict:
        """Groq is OpenAI-compatible, so the normalized message format and
        function specs translate directly onto its chat completions API via
        the fallback model chain (the same availability handling as
        generate_insights/chat)."""
        def build_payload(model: str) -> dict:
            return {
                "model": model,
                "messages": [{"role": "system", "content": system}, *_openai_tool_messages(messages)],
                "tools": _openai_tool_specs(tools),
                "temperature": 0.2,
                "max_tokens": 2000,
                "reasoning_effort": self.REASONING_EFFORT.get(model, "low"),
            }

        async with httpx.AsyncClient(timeout=90) as client:
            body, model = await self._chat_completion_with_fallback(client, build_payload)
            msg = body["choices"][0]["message"]
            usage = body.get("usage", {})
            return {
                "content": msg.get("content"),
                "tool_calls": [
                    {"id": tc["id"], "name": tc["function"]["name"],
                     "arguments": self._safe_json(tc["function"].get("arguments") or "{}")}
                    for tc in msg.get("tool_calls") or []
                ],
                "usage": self._usage(model, usage.get("prompt_tokens"), usage.get("completion_tokens")),
            }


class OllamaProvider(BaseAIProvider):
    """Talks to a locally-hosted Ollama server instead of a cloud API. This
    is the security-motivated option: ticket data, prompts, and generated
    insights never leave the machine/network Ollama runs on - nothing is
    sent to OpenAI, Anthropic, Google, or Groq. Ignores self.api_key
    entirely (Ollama's local API takes no key); base_url/model come from
    app.config.settings.OLLAMA_BASE_URL / OLLAMA_MODEL by default, but an
    org-wide override set from Settings -> AI Provider takes precedence over
    those (see session_store.get_ollama_override) - constructor kwargs win
    over both, mainly for tests."""

    def __init__(self, api_key: str = "", base_url: str | None = None, model: str | None = None):
        super().__init__(api_key)
        from app.services import session_store
        override = session_store.get_ollama_override()
        self.base_url = (base_url or override.get("base_url") or settings.OLLAMA_BASE_URL).rstrip("/")
        self.model = model or override.get("model") or settings.OLLAMA_MODEL

    async def validate_key(self) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/tags")
            except httpx.ConnectError:
                raise ValueError(
                    f"Cannot reach Ollama at {self.base_url}. Make sure 'ollama serve' is running "
                    "(or the Ollama desktop app is open), or check OLLAMA_BASE_URL in the backend's .env."
                )
            self._raise_for_status(resp, "Ollama")
            names = [m.get("name", "") for m in resp.json().get("models", [])]
            if not any(n == self.model or n.startswith(self.model + ":") for n in names):
                raise ValueError(
                    f"Ollama is reachable but the model '{self.model}' hasn't been pulled yet. "
                    f"Run: ollama pull {self.model}"
                )

    async def _post_chat(self, payload: dict) -> dict:
        """Shared HTTP/error-handling core for every Ollama /api/chat call.
        Takes the FULL request payload (model/messages/stream/options/...)
        so callers that need extra fields (e.g. chat_with_tools's `tools`
        array) can add them before posting, instead of being forced through
        a messages-list-only helper that would silently re-wrap their whole
        payload as if it were the messages array (that mistake is what
        previously produced Ollama's "cannot unmarshal object into Go
        struct field ChatRequest.messages of type []api.Message" error)."""
        async with httpx.AsyncClient(timeout=180) as client:
            try:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)
            except httpx.ConnectError:
                raise ValueError(
                    f"Cannot reach Ollama at {self.base_url}. Make sure 'ollama serve' is running."
                )
            except httpx.ReadTimeout:
                raise ValueError(
                    "Ollama took too long to respond - the model may still be loading into memory "
                    "on first use, or your hardware may be too slow for this model size. Try again "
                    "in a moment, or switch to a smaller model."
                )
            if resp.status_code == 404:
                raise ValueError(f"Ollama model '{self.model}' isn't available. Run: ollama pull {self.model}")
            self._raise_for_status(resp, "Ollama")
            return resp.json()

    async def _chat(self, messages: list, json_mode: bool) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.4},
        }
        if json_mode:
            payload["format"] = "json"
        return await self._post_chat(payload)

    async def generate_insights(self, data_context: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": data_context},
        ]
        body = await self._chat(messages, json_mode=True)
        content = body["message"]["content"]
        return {
            "insights": self._parse_json(content),
            "usage": self._usage(self.model, body.get("prompt_eval_count"), body.get("eval_count")),
        }

    async def chat(self, messages: list, data_context: str) -> dict:
        system = f"{CHAT_SYSTEM_PROMPT}\n\nCURRENT TICKET DATA CONTEXT:\n{data_context}"
        body = await self._chat([{"role": "system", "content": system}, *messages], json_mode=False)
        return {
            "reply": body["message"]["content"].strip(),
            "usage": self._usage(self.model, body.get("prompt_eval_count"), body.get("eval_count")),
        }

    async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict:
        """Ollama's /api/chat accepts an OpenAI-style `tools` array and returns
        message.tool_calls. If the locally-running model doesn't support tool
        calling it simply answers in content instead, and the agent loop falls
        through to the final-reply path - so this degrades gracefully rather
        than erroring on a model that wasn't pulled for agents."""
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if tools:
            payload["tools"] = [
                {"type": "function", "function": {
                    "name": t["name"], "description": t["description"], "parameters": t["parameters"],
                }}
                for t in tools
            ]
        body = await self._post_chat(payload)
        msg = body.get("message", {})
        tool_calls = []
        for i, tc in enumerate(msg.get("tool_calls") or []):
            fn = tc.get("function", {})
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                args = self._safe_json(args)
            tool_calls.append({"id": tc.get("id") or f"oc_{i}", "name": fn.get("name"), "arguments": args})
        return {
            "content": msg.get("content"),
            "tool_calls": tool_calls,
            "usage": self._usage(self.model, body.get("prompt_eval_count"), body.get("eval_count")),
        }


# Every other provider needs a per-user API key stored via /settings/api-key;
# Ollama runs locally and needs none.
PROVIDERS_REQUIRING_API_KEY = {"openai", "claude", "gemini", "groq"}


def get_provider(name: str, api_key: str) -> BaseAIProvider:
    providers = {
        "ollama": OllamaProvider,
        "openai": OpenAIProvider,
        "claude": ClaudeProvider,
        "gemini": GeminiProvider,
        "groq": GroqProvider,
    }
    if name not in providers:
        raise ValueError(f"Unknown AI provider: {name}")
    return providers[name](api_key)


def resolve_provider(user) -> tuple[str, BaseAIProvider]:
    """Single source of truth for 'which AI provider does this user use,
    and is it actually ready to call right now' - every AI endpoint
    (insights, chat, regenerate) goes through this instead of each
    re-implementing the default-provider-and-key-check logic separately,
    which is exactly the kind of duplication that earlier caused different
    pages to disagree with each other. Raises ValueError (callers turn this
    into an HTTP 400) if a key-requiring provider has no key configured."""
    provider_name = user.ai_provider_preference or settings.AI_DEFAULT_PROVIDER
    api_key = ""
    if provider_name in PROVIDERS_REQUIRING_API_KEY:
        api_key = session_store.get_api_key(user.id, provider_name)
        if not api_key:
            raise ValueError(
                f"No API key configured for provider '{provider_name}'. Add one in Settings, "
                "or switch your AI Provider to Ollama (local, no key needed)."
            )
    return provider_name, get_provider(provider_name, api_key)
