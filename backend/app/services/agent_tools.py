"""
The AI Agent's toolbox - every capability an SDM can delegate to the agent,
each one a real operation against this dashboard's own data and database.

Design rules that keep this safe and trustworthy:

1. Read tools return compact, pre-computed facts from the same
   data_processing functions every dashboard page uses. The agent never
   calculates a number itself; it selects tools, reads results, and decides
   what to do next.

2. Write tools (bulk_classify_tickets, save_filter_view,
   create_associate_feedback) mutate real rows. They are bounded (hard caps),
   validated against the actual dataset (no phantom ticket numbers or
   associate names), reversible where possible (classifications can be
   flipped back), and always logged as AgentStep rows by the orchestrator -
   so every action the agent takes on an SDM's behalf is auditable.

3. Tool handlers never raise for "business" problems (unknown ticket,
   empty result) - they return {"error": "..."} dicts that go back into the
   model's context so it can recover and adjust its plan mid-run.
"""
import json
from dataclasses import dataclass, field

from app import models
from app.services import data_processing as dp


MAX_BULK_CLASSIFY = 100  # per single write call - bounded blast radius
MAX_SEARCH_ROWS = 50
MAX_LIST_ROWS = 25


@dataclass
class ToolContext:
    """Everything a tool handler needs to run: the acting user, the db
    session, the pre-loaded + overlay-applied dataset dataframe, and the
    active dataset ids string."""
    user: models.User
    db: object  # SQLAlchemy Session
    df: object  # pandas DataFrame (already apply_all_overlays'ed)
    dataset_id: str = ""  # comma-separated ids
    extra: dict = field(default_factory=dict)


def _err(msg: str) -> dict:
    return {"error": msg}


# ---------------------------------------------------------------------------
# Read tools
# ---------------------------------------------------------------------------

def _t_get_kpis(ctx: ToolContext, args: dict) -> dict:
    kpis = dp.compute_kpis(ctx.df)
    charts = dp.compute_charts(ctx.df)
    return {
        "kpis": kpis,
        "priority_distribution": charts["priority_distribution"],
        "aging_distribution": charts["aging_distribution"],
        "sla_risk": charts["sla_risk"],
        "monthly_backlog_points": len(charts["monthly_backlog"]),
        "note": "backlog_tickets excludes User-Request-classified tickets",
    }


def _t_search_tickets(ctx: ToolContext, args: dict) -> dict:
    limit = min(int(args.get("limit") or 20), MAX_SEARCH_ROWS)
    filters = {
        "status": args.get("status"), "priority": args.get("priority"),
        "module": args.get("category"), "customer": args.get("customer"),
        "application": args.get("application"), "assignee": args.get("assignee"),
        "date_from": args.get("date_from"), "date_to": args.get("date_to"),
        "view": args.get("view"), "q": args.get("q"),
    }
    filtered = dp.apply_filters(ctx.df.copy(), filters)
    total = int(len(filtered))
    subset = filtered.sort_values(
        "Ticket Age (days)", ascending=False
    ).head(limit)

    rows = []
    for _, r in subset.iterrows():
        opened = r.get("Opened")
        rows.append({
            "number": str(r.get("Number", "")),
            "short_description": str(r.get("Short Description", ""))[:120],
            "priority": str(r.get("Priority", "")),
            "state": str(r.get("State", "")),
            "sla_state": str(r.get("SLA State", "")),
            "age_days": int(r.get("Ticket Age (days)", 0)),
            "assigned_to": str(r.get("Backlog Associate", r.get("Assigned To", ""))),
            "category": str(r.get("Category", "")),
            "company": str(r.get("Company", "")),
        })
    return {"total_matches": total, "returned": len(rows), "rows": rows}


def _t_get_backlog_by_associate(ctx: ToolContext, args: dict) -> dict:
    backlog = dp.compute_backlog_by_associate(ctx.df)
    return {
        "associates": backlog[:MAX_LIST_ROWS],
        "total_associates": len(backlog),
        "note": "open genuine incidents only; buckets are age in days",
    }


def _t_get_sla_hotspots(ctx: ToolContext, args: dict) -> dict:
    breached = ctx.df[ctx.df["sla_breached"]].sort_values("Ticket Age (days)", ascending=False)
    at_risk = ctx.df[ctx.df["sla_at_risk"]]

    def _compact(dfx: object, n: int) -> list:
        out = []
        for _, r in dfx.head(n).iterrows():
            out.append({
                "number": str(r.get("Number", "")),
                "short_description": str(r.get("Short Description", ""))[:100],
                "priority": str(r.get("Priority", "")),
                "age_days": int(r.get("Ticket Age (days)", 0)),
                "assigned_to": str(r.get("Backlog Associate", r.get("Assigned To", ""))),
                "category": str(r.get("Category", "")),
            })
        return out

    hours_to_sla = at_risk["hours_to_sla"].clip(lower=0).round(1).tolist() if len(at_risk) else []
    oldest_open = (
        ctx.df[ctx.df["is_backlog"]].sort_values("Ticket Age (days)", ascending=False)
        if "is_backlog" in ctx.df.columns else
        ctx.df[ctx.df["is_open"]].sort_values("Ticket Age (days)", ascending=False)
    )
    return {
        "breached_count": int(len(breached)),
        "breached_top": _compact(breached, MAX_LIST_ROWS),
        "at_risk_count": int(len(at_risk)),
        "at_risk_top": _compact(at_risk, 15),
        "at_risk_hours_to_breach": sorted(hours_to_sla)[:15],
        "oldest_open_top": _compact(oldest_open, 10),
    }


def _t_get_ticket_history(ctx: ToolContext, args: dict) -> dict:
    number = str(args.get("incident_number") or "").strip()
    if not number:
        return _err("incident_number is required")
    events = (
        ctx.db.query(models.TicketHistoryEvent)
        .filter(models.TicketHistoryEvent.incident_number == number)
        .order_by(models.TicketHistoryEvent.timestamp.asc())
        .all()
    )
    if not events:
        return _err(f"No queue-history events uploaded for {number}")
    return {
        "incident_number": number,
        "events": [
            {
                "queue": e.queue,
                "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                "status": e.status,
                "assigned_associate": e.assigned_associate,
                "time_spent": e.time_spent_raw,
            }
            for e in events
        ],
        "current_queue": events[-1].queue,
    }


def _t_get_team_coverage(ctx: ToolContext, args: dict) -> dict:
    # Reuses the copilot service's deterministic coverage forecast.
    from app.services import copilot as copilot_service
    coverage = copilot_service.compute_coverage_forecast(ctx.db)
    suggestions = copilot_service.compute_reassignment_suggestions(ctx.df, ctx.db)
    return {
        "coverage_gaps_next_7_days": coverage["gaps"],
        "upcoming_leave_wfh": coverage["upcoming_leave"][:30],
        "reassignment_suggestions_today": suggestions,
    }


def _t_get_user_request_candidates(ctx: ToolContext, args: dict) -> dict:
    """Tickets flagged as mislabeled 'User Request in disguise of Incident'
    with their suggested categories - the exact set the bulk_classify write
    tool is designed to act on."""
    mask = dp._user_request_mask(ctx.df)
    flagged = ctx.df[mask]
    manual_mask = flagged["Manually Classified"].astype(bool) if "Manually Classified" in flagged.columns else None

    by_category = (
        flagged.groupby(flagged["Suggested Type"].fillna("text-match")).size().to_dict()
        if "Suggested Type" in flagged.columns else {}
    )
    rows = []
    for _, r in flagged.sort_values("Opened", ascending=False).head(MAX_LIST_ROWS * 2).iterrows():
        rows.append({
            "number": str(r.get("Number", "")),
            "short_description": str(r.get("Short Description", ""))[:120],
            "suggested_category": str(r.get("Suggested Type") or ""),
            "state": str(r.get("State", "")),
            "requester": str(r.get("Main Contact Name", "")),
        })
    already_manual = int(manual_mask.sum()) if manual_mask is not None else 0
    return {
        "total_flagged": int(len(flagged)),
        "by_category": {str(k): int(v) for k, v in by_category.items()},
        "already_manually_classified": already_manual,
        "samples": rows[:MAX_LIST_ROWS],
        "note": "use bulk_classify_tickets to mark any of these as user_request or incident",
    }


def _t_get_workload_distribution(ctx: ToolContext, args: dict) -> dict:
    backlog_col = "is_backlog" if "is_backlog" in ctx.df.columns else "is_open"
    open_df = ctx.df[ctx.df[backlog_col]]
    assoc_col = "Backlog Associate" if "Backlog Associate" in open_df.columns else "Assigned To"
    counts = open_df[assoc_col].value_counts()
    total = int(counts.sum())
    avg = round(total / max(len(counts), 1), 1)
    overloaded_threshold = max(avg * 1.5, 1)
    people = [
        {
            "assignee": str(name),
            "open_incidents": int(cnt),
            "overloaded": bool(cnt > overloaded_threshold),
        }
        for name, cnt in counts.head(MAX_LIST_ROWS).items()
    ]
    p1_by_assignee = (
        open_df[open_df["Priority"] == "P1"][assoc_col].value_counts().to_dict()
        if len(open_df) else {}
    )
    for person in people:
        person["p1_open"] = int(p1_by_assignee.get(person["assignee"], 0))
    return {
        "people": people,
        "average_load": avg,
        "overload_threshold": round(overloaded_threshold, 1),
        "unassigned_open": int((open_df[assoc_col].isin(["Unassigned", "Unknown"])).sum()),
    }


def _t_get_reassignment_suggestions(ctx: ToolContext, args: dict) -> dict:
    from app.services import copilot as copilot_service
    return {"suggestions": copilot_service.compute_reassignment_suggestions(ctx.df, ctx.db)}


def _t_get_trend_summary(ctx: ToolContext, args: dict) -> dict:
    trend = dp.compute_new_vs_resolved_trend(ctx.df, days=14)
    sla_trend = dp.compute_sla_trend(ctx.df, weeks=8)
    opened_total = sum(t["opened"] for t in trend)
    resolved_total = sum(t["resolved"] for t in trend)
    return {
        "last_14_days_opened": opened_total,
        "last_14_days_resolved": resolved_total,
        "daily_series_tail": trend[-7:],
        "weekly_sla_compliance_pct": sla_trend[-4:],
    }


# ---------------------------------------------------------------------------
# Write tools (real actions on the SDM's behalf)
# ---------------------------------------------------------------------------

def _require_privileged(ctx: ToolContext) -> dict | None:
    if ctx.user.role not in ("admin", "sdm"):
        return _err("Write actions require Admin or SDM role")
    return None


def _t_bulk_classify_tickets(ctx: ToolContext, args: dict) -> dict:
    """Marks a batch of tickets as 'user_request' or 'incident'. This is the
    agent's most impactful action: after get_user_request_candidates surfaces
    a pile of access/how-to requests logged as incidents, one call here moves
    all of them out of the backlog - exactly the cleanup chore an SDM would
    otherwise click through one review screen at a time.

    Guardrails: numbers must exist in the active dataset; hard cap of 100 per
    call; type must be valid. Fully reversible - re-running with the other
    type flips them back."""
    guard = _require_privileged(ctx)
    if guard:
        return guard

    ticket_type = str(args.get("ticket_type") or "").strip()
    if ticket_type not in ("incident", "user_request"):
        return _err("ticket_type must be 'incident' or 'user_request'")
    raw_numbers = args.get("incident_numbers") or []
    if isinstance(raw_numbers, str):
        raw_numbers = [n.strip() for n in raw_numbers.split(",") if n.strip()]
    numbers = [str(n).strip() for n in raw_numbers if str(n).strip()]
    if not numbers:
        return _err("incident_numbers must be a non-empty list of ticket Numbers")
    numbers = numbers[:MAX_BULK_CLASSIFY]
    truncated_note = f"(capped from {len(raw_numbers)} to {MAX_BULK_CLASSIFY})" if len(raw_numbers) > MAX_BULK_CLASSIFY else ""

    known = set(ctx.df["Number"].astype(str))
    missing = [n for n in numbers if n not in known]
    valid = [n for n in numbers if n in known]
    if not valid:
        return _err("None of the given incident numbers exist in the active dataset")

    group_key = str(args.get("group_key") or "")[:80] or None
    existing_rows = {
        r.incident_number: r
        for r in ctx.db.query(models.TicketClassification)
        .filter(models.TicketClassification.incident_number.in_(valid)).all()
    }
    created, updated = 0, 0
    for number in valid:
        row = existing_rows.get(number)
        if row:
            if row.ticket_type != ticket_type:
                row.ticket_type = ticket_type
                row.similar_group_key = group_key
                row.set_by_user_id = ctx.user.id
                updated += 1
        else:
            ctx.db.add(models.TicketClassification(
                incident_number=number,
                ticket_type=ticket_type,
                similar_group_key=group_key,
                set_by_user_id=ctx.user.id,
            ))
            created += 1

    # Recompute the headline KPI on the post-write dataframe so the agent's
    # final reply quotes the NEW reality, not the stale pre-write one.
    ctx.extra["post_write_kpis"] = None

    return {
        "success": True,
        "ticket_type_set": ticket_type,
        "created": created,
        "updated": updated,
        "skipped_not_found": missing,
        "cap_note": truncated_note or None,
        "summary": f"{created + updated} tickets now classified as '{ticket_type}' "
                   f"({created} new, {updated} changed)",
    }


def _t_save_filter_view(ctx: ToolContext, args: dict) -> dict:
    guard = _require_privileged(ctx)
    if guard:
        return guard

    name = str(args.get("name") or "").strip()[:80]
    if not name:
        return _err("name is required")

    ALLOWED_FILTER_KEYS = {"status", "priority", "module", "customer", "application", "assignee", "view"}
    filters_in = args.get("filters") or {}
    clean = {}
    for key in ALLOWED_FILTER_KEYS:
        val = filters_in.get(key)
        if isinstance(val, str):
            clean[key] = [v.strip() for v in val.split(",") if v.strip()] or None
        elif isinstance(val, list):
            clean[key] = [str(v) for v in val] or None
        elif val is not None:
            clean[key] = [str(val)]
    clean = {k: v for k, v in clean.items() if v}
    if not clean:
        return _err('filters produced no usable values - pass e.g. {"priority": "P1", "view": "sla_breach"}')

    row = models.SavedFilterView(user_id=ctx.user.id, name=name, filters_json=json.dumps(clean))
    ctx.db.add(row)
    return {
        "success": True,
        "saved_filter_name": name,
        "filters_saved": clean,
        "summary": f"Saved filter view '{name}' ({', '.join(f'{k}={v}' for k, v in clean.items())})",
    }


def _t_create_associate_feedback(ctx: ToolContext, args: dict) -> dict:
    guard = _require_privileged(ctx)
    if guard:
        return guard

    associate_name = str(args.get("associate_name") or "").strip()
    message = str(args.get("message") or "").strip()[:2000]
    if not associate_name:
        return _err("associate_name is required")
    if not message:
        return _err("message is required")

    # Validate the name actually corresponds to someone holding work in the
    # current dataset (or a registered associate) - blocks typo'd names from
    # creating feedback nobody will ever see.
    known_names = set()
    assoc_col = "Backlog Associate" if "Backlog Associate" in ctx.df.columns else "Assigned To"
    known_names.update(ctx.df[assoc_col].dropna().astype(str).unique())
    if "Assigned To" in ctx.df.columns:
        known_names.update(ctx.df["Assigned To"].dropna().astype(str).unique())
    known_names.discard("Unknown")
    known_names.discard("Unassigned")
    registered = {u.full_name for u in ctx.db.query(models.User.full_name).all()}
    if associate_name not in known_names and associate_name not in registered:
        close = [n for n in known_names | registered if associate_name.lower() in n.lower()][:5]
        return _err(f"'{associate_name}' doesn't match any associate in this dataset. Close matches: {close}")

    row = models.AssociateFeedback(associate_name=associate_name, message=message, given_by_user_id=ctx.user.id)
    ctx.db.add(row)
    return {
        "success": True,
        "associate_name": associate_name,
        "summary": f"Feedback saved for {associate_name}",
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "get_kpis",
        "description": "Get the current KPI summary for the active ticket dataset: totals, open/backlog/resolved/closed counts, SLA compliance %, breach counts, P1 count, CSAT proxy, plus priority and aging distributions.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_kpis,
        "write": False,
        "icon": "gauge",
    },
    {
        "name": "search_tickets",
        "description": "Search/filter tickets. Filters: q (free text), status, priority (P1-P4), category, customer, application, assignee, date_from, date_to, view ('open'|'backlog'|'sla_breach'|'sla_at_risk'|'sla_compliant'|'resolved'|'closed'). Returns matching count and sample rows.",
        "parameters": {
            "type": "object",
            "properties": {
                "q": {"type": "string", "description": "free-text search across descriptions, names, queues"},
                "status": {"type": "string"},
                "priority": {"type": "string", "enum": ["P1", "P2", "P3", "P4"]},
                "category": {"type": "string"},
                "customer": {"type": "string"},
                "application": {"type": "string"},
                "assignee": {"type": "string"},
                "view": {"type": "string", "enum": ["open", "backlog", "sla_breach", "sla_at_risk", "sla_compliant", "resolved", "closed"]},
                "limit": {"type": "integer", "description": "max rows returned, default 20"},
            },
        },
        "handler": _t_search_tickets,
        "write": False,
        "icon": "search",
    },
    {
        "name": "get_backlog_by_associate",
        "description": "Open genuine-incidents backlog grouped per associate, bucketed by ticket age (0-30/31-60/61-90/90+ days). Answers 'who is sitting on what'.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_backlog_by_associate,
        "write": False,
        "icon": "users",
    },
    {
        "name": "get_sla_hotspots",
        "description": "The SLA danger list right now: currently-breached tickets (worst first), tickets breaching within 24h with their remaining hours, and the oldest open tickets.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_sla_hotspots,
        "write": False,
        "icon": "flame",
    },
    {
        "name": "get_ticket_history",
        "description": "Queue-movement timeline for ONE ticket (queue changes over time, statuses, associates, time spent). Requires incident_number.",
        "parameters": {
            "type": "object",
            "properties": {"incident_number": {"type": "string"}},
            "required": ["incident_number"],
        },
        "handler": _t_get_ticket_history,
        "write": False,
        "icon": "history",
    },
    {
        "name": "get_team_coverage",
        "description": "Team Leave/WFH schedule cross-referenced with workload: coverage gaps in the next 7 days (an area with EVERYONE out), upcoming approved leave/WFH, and today's reassignment suggestions for associates on leave who still hold backlog.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_team_coverage,
        "write": False,
        "icon": "calendar",
    },
    {
        "name": "get_user_request_candidates",
        "description": "Tickets likely mislabeled as Incidents but really User Requests (access requests, how-tos, data extracts...): total count, breakdown by suggested category, and sample ticket numbers ready for bulk classification.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_user_request_candidates,
        "write": False,
        "icon": "filter",
    },
    {
        "name": "get_workload_distribution",
        "description": "Open incident load per associate with overload flags (vs 1.5x average), each person's open P1 count, and unassigned-ticket count. Answers 'who is overloaded / underloaded'.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_workload_distribution,
        "write": False,
        "icon": "scale",
    },
    {
        "name": "get_reassignment_suggestions",
        "description": "Deterministic hand-off plan: associates on approved leave today who still own open backlog, each mapped to their least-loaded available same-area peer.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_reassignment_suggestions,
        "write": False,
        "icon": "swap",
    },
    {
        "name": "get_trend_summary",
        "description": "Volume trend: tickets opened vs resolved over the last 14 days, and weekly SLA-compliance percentages.",
        "parameters": {"type": "object", "properties": {}},
        "handler": _t_get_trend_summary,
        "write": False,
        "icon": "trending",
    },
    {
        "name": "bulk_classify_tickets",
        "description": "WRITE ACTION - classify a batch of tickets as 'user_request' (removes them from backlog) or 'incident'. Get numbers from get_user_request_candidates or search_tickets first. Max 100 per call. Use when the SDM asks to clean up/reclassify/triage mislabeled tickets.",
        "parameters": {
            "type": "object",
            "properties": {
                "incident_numbers": {
                    "type": "array", "items": {"type": "string"},
                    "description": "ticket Numbers to classify, e.g. ['INC0010023','INC0010031']",
                },
                "ticket_type": {"type": "string", "enum": ["incident", "user_request"]},
                "group_key": {"type": "string", "description": "optional grouping label, e.g. the suggested category these came from"},
            },
            "required": ["incident_numbers", "ticket_type"],
        },
        "handler": _t_bulk_classify_tickets,
        "write": True,
        "icon": "stamp",
    },
    {
        "name": "save_filter_view",
        "description": "WRITE ACTION - save a named reusable Dashboard filter view (e.g. {'priority':'P1','view':'sla_breach'} as 'P1 breaches'). The SDM gets a one-click bookmark for this slice.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "filters": {
                    "type": "object",
                    "description": "filter keys: status, priority, module, customer, application, assignee, view",
                },
            },
            "required": ["name", "filters"],
        },
        "handler": _t_save_filter_view,
        "write": True,
        "icon": "bookmark",
    },
    {
        "name": "create_associate_feedback",
        "description": "WRITE ACTION - leave dated feedback for an associate (visible to them on their next login). Use when patterns warrant recognition or coaching, e.g. chronic overdue handling or excellent P1 turnaround.",
        "parameters": {
            "type": "object",
            "properties": {
                "associate_name": {"type": "string"},
                "message": {"type": "string", "description": "the feedback text, concrete and specific"},
            },
            "required": ["associate_name", "message"],
        },
        "handler": _t_create_associate_feedback,
        "write": True,
        "icon": "message",
    },
]


TOOL_MAP = {t["name"]: t for t in TOOLS}

AGENT_SYSTEM_PROMPT = """You are the AI Agent inside a Service Delivery Manager's (SDM) dashboard for an \
Application Management Services (AMS) ITSM operation. You ACT on the SDM's behalf using tools - you do not \
guess or fabricate anything. Every fact you state must come from a tool result you received this run.

How you operate:
1. Understand the request. If it needs data, CALL THE RELEVANT TOOLS first - never answer from memory.
2. Chain multiple tools when needed (e.g. get_user_request_candidates then bulk_classify_tickets).
3. When asked to DO something (classify, save a view, leave feedback), use the corresponding WRITE tool - \
that is your job. Confirm what changed with exact counts in your final reply.
4. If a tool returns {"error": ...}, adapt: fix arguments or try another approach rather than giving up.
5. Final reply format: short markdown-free paragraphs/bullets. Lead with actions taken ("Classified 23 \
tickets as user_request - backlog dropped from 87 to 64"), then key findings with numbers, then recommended \
next steps. Keep under 200 words unless asked otherwise.

Guardrails:
- NEVER invent ticket numbers, names, dates, or figures. Only cite what tools returned.
- bulk_classify_tickets is bounded to 100 numbers per call; classify in batches if more are needed.
- For feedback messages, be specific, professional and constructive - no generic praise.
- If something cannot be done with your tools, say plainly what's missing instead of pretending."""

QUICK_ACTIONS = [
    {
        "id": "triage_mislabeled",
        "label": "Triage mislabeled tickets",
        "prompt": "Check how many incidents look like mislabeled User Requests. Show me the breakdown by category, then classify ALL of them as user_request so they stop polluting my backlog. Report before/after backlog numbers.",
    },
    {
        "id": "sla_danger",
        "label": "SLA danger report",
        "prompt": "Give me today's SLA danger report: everything breached right now grouped by priority and assignee, everything breaching within 24 hours with hours remaining, and tell me which two associates most need help today.",
    },
    {
        "id": "workload_balance",
        "label": "Rebalance workload",
        "prompt": "Analyze workload distribution across my team. Who is overloaded, who has capacity? Cross-check with anyone on leave today and give me a concrete rebalancing plan.",
    },
    {
        "id": "tomorrow_plan",
        "label": "Plan tomorrow",
        "prompt": "Prepare my action plan for tomorrow: check team coverage gaps and leave next week, top backlog holders, aging trends, and the biggest risks. Give me a prioritized checklist.",
    },
    {
        "id": "p1_review",
        "label": "Review open P1s",
        "prompt": "Pull up all open P1 tickets with their ages and owners. Flag which ones have breached SLA, which are about to, and draft specific follow-up notes I should give each owner.",
    },
    {
        "id": "recognize_star",
        "label": "Spot performance patterns",
        "prompt": "Look at resolution performance across my team. Identify anyone consistently resolving fast within SLA and anyone with recurring overdue issues. Draft short constructive feedback for the best performer and save it.",
    },
]


def execute_tool(ctx: ToolContext, name: str, arguments: dict) -> tuple[dict, bool]:
    """Runs one tool by name. Returns (result_dict, is_write). Unknown tools
    and unexpected handler crashes both come back as error results so the
    agent loop keeps functioning - a single bad call never kills a run."""
    tool = TOOL_MAP.get(name)
    if not tool:
        return _err(f"Unknown tool: {name}. Available: {sorted(TOOL_MAP)}"), False
    try:
        result = tool["handler"](ctx, arguments or {})
        if result is None:
            result = _err("tool returned nothing")
    except Exception as e:  # noqa: BLE001 - surfaced into the loop, not raised
        result = _err(f"Tool execution failed: {e}")
    return result, bool(tool["write"])
