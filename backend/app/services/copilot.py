"""
SDM Copilot analytics - the cross-reference between ticket backlog and team
Leave/WFH schedules that neither system can see on its own. Every number
here is computed in plain Python from the same dataframes and DB rows every
other page already uses; the LLM only ever narrates these pre-computed
facts (see SDM_COPILOT_SYSTEM_PROMPT in ai_providers.py) - it never invents
or recalculates a number itself. That split is what keeps the feature
trustworthy enough to act on directly.
"""
from datetime import datetime, timedelta
import re
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from app import models

FORECAST_DAYS = 7


def _clean_value(value, fallback="Not available"):
    """Turn pandas missing values into safe API strings."""
    if value is None or str(value).lower() in {"nan", "nat", "none", "unknown", ""}:
        return fallback
    return str(value)


def investigate_incident(df, incident_number: str, db: Session) -> dict:
    """Build a deterministic, immediately-actionable incident runbook.

    This is intentionally a *tool-using agent foundation*, rather than a
    chatbot that guesses at a fix: it reads the active ticket data, searches
    comparable resolved work, checks the SLA clock and ticket movement history,
    then returns a proposed plan for a human to approve.  Each recommendation
    identifies its evidence so an associate can move quickly without blindly
    trusting a model.
    """
    matches = df[df["Number"].astype(str).str.lower() == incident_number.strip().lower()]
    if matches.empty:
        raise ValueError("Incident not found in the active dataset")
    ticket = matches.iloc[0]

    priority = _clean_value(ticket.get("Priority"), "P4")
    state = _clean_value(ticket.get("State"), "New")
    description = _clean_value(ticket.get("Short Description"), "No description provided")
    assignee = _clean_value(ticket.get("Assigned To"), "Unassigned")
    category = _clean_value(ticket.get("Category"))
    service = _clean_value(ticket.get("Business Service"))
    is_breached = bool(ticket.get("sla_breached", False))
    at_risk = bool(ticket.get("sla_at_risk", False))
    hours = ticket.get("hours_to_sla")
    try:
        hours = float(hours)
    except (TypeError, ValueError):
        hours = None

    if is_breached:
        urgency, sla_status = "critical", "SLA breached — begin recovery and stakeholder update now"
    elif priority == "P1" or (hours is not None and hours <= 4):
        urgency, sla_status = "critical", f"{max(hours or 0, 0):.1f} hours remaining to SLA"
    elif at_risk or (hours is not None and hours <= 24):
        urgency, sla_status = "high", f"{max(hours or 0, 0):.1f} hours remaining to SLA"
    else:
        urgency, sla_status = "standard", "Within the current SLA window"

    # Find finished tickets with the strongest description/category signal.
    candidates = df[(df["Number"].astype(str) != str(ticket["Number"])) & df.get("is_done", False)].copy()
    description_lower = description.lower()
    def similarity(row):
        text_score = SequenceMatcher(None, description_lower, _clean_value(row.get("Short Description"), "").lower()).ratio()
        category_bonus = 0.22 if _clean_value(row.get("Category"), "").lower() == category.lower() else 0
        service_bonus = 0.10 if _clean_value(row.get("Business Service"), "").lower() == service.lower() else 0
        return text_score + category_bonus + service_bonus
    if not candidates.empty:
        candidates["_similarity"] = candidates.apply(similarity, axis=1)
        candidates = candidates.sort_values("_similarity", ascending=False).head(3)
    similar = [{
        "number": _clean_value(row.get("Number")),
        "description": _clean_value(row.get("Short Description")),
        "state": _clean_value(row.get("State")),
        "assigned_to": _clean_value(row.get("Assigned To")),
        "similarity_pct": int(round(float(row.get("_similarity", 0)) * 100)),
    } for _, row in candidates.iterrows() if float(row.get("_similarity", 0)) >= 0.28]

    history = db.query(models.TicketHistoryEvent).filter(
        models.TicketHistoryEvent.incident_number == str(ticket["Number"])
    ).order_by(models.TicketHistoryEvent.timestamp.desc()).limit(6).all()
    movements = [{
        "queue": _clean_value(event.queue), "status": _clean_value(event.status),
        "assigned_to": _clean_value(event.assigned_associate),
        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
    } for event in history]

    actions = [
        {"id": "validate", "title": "Validate impact and reproduce", "detail": "Confirm affected users, business impact, error message, and the last known-good time.", "owner": assignee},
        {"id": "evidence", "title": "Gather resolution evidence", "detail": "Review the related tickets below and attach relevant logs, timestamps, and screenshots before changing the service.", "owner": assignee},
    ]
    if urgency == "critical":
        actions.insert(0, {"id": "swarm", "title": "Start an incident swarm", "detail": "Engage the service owner/on-call now; do not wait for the next update cycle.", "owner": "SDM + service owner"})
    if assignee in {"Unassigned", "Unknown", "Not available"}:
        actions.insert(0, {"id": "assign", "title": "Assign an accountable resolver", "detail": "Route to the owning support group and name a resolver before investigation continues.", "owner": "SDM"})
    actions.append({"id": "communicate", "title": "Send a time-boxed update", "detail": "State impact, current action, owner, and next update time. Keep a dated incident timeline.", "owner": assignee})

    # Email is deliberately prepared, not sent by the API. The SDM gets a
    # reviewed draft in their own mail client and remains in control of the
    # recipient and final wording.
    assignee_user = next((u for u in db.query(models.User).filter(models.User.is_active == True).all()  # noqa: E712
                          if u.full_name.strip().lower() == assignee.strip().lower()), None)
    requester = _clean_value(ticket.get("Main Contact Name"))
    recipient_options = []
    if assignee_user:
        recipient_options.append({"label": f"Assigned resolver — {assignee_user.full_name}", "email": assignee_user.email})

    next_update = "30 minutes" if urgency == "critical" else "60 minutes" if urgency == "high" else "End of current investigation step"
    escalation = (
        "Escalate immediately if impact expands, a workaround is unavailable, or the service owner is not engaged."
        if urgency == "critical" else
        "Escalate if evidence is incomplete after the next investigation step or the SLA reaches the risk window."
    )
    return {
        "incident": {"number": _clean_value(ticket.get("Number")), "description": description, "priority": priority,
                     "state": state, "category": category, "business_service": service, "assigned_to": assignee,
                     "risk_score": float(ticket.get("risk_score", 0) or 0), "sla_due_date": _clean_value(ticket.get("SLA Due Date"))},
        "triage": {"urgency": urgency, "sla_status": sla_status, "next_update": next_update, "escalation_rule": escalation},
        "recommended_actions": actions,
        "similar_incidents": similar,
        "movement_history": movements,
        "stakeholder_update": f"{ticket['Number']} ({priority}): We are investigating {description}. Owner: {assignee}. Current status: {state}. Next update: within {next_update}.",
        "follow_up": {
            "subject": f"Action required: {ticket['Number']} — {priority} incident follow-up",
            "body": (
                f"Hello {assignee},\n\nPlease take ownership of {ticket['Number']}: {description}.\n\n"
                f"Required next step: {actions[0]['title']}.\nSLA status: {sla_status}.\n"
                f"Please update the incident timeline and confirm your next action within {next_update}.\n\nThanks,\nService Delivery Management"
            ),
            "recipients": recipient_options,
            "requester_name": requester,
        },
        "evidence_note": "Recommendations are calculated from the active ticket export and imported ticket history. Similarity is a prioritisation signal, not proof of the same root cause.",
    }


def _associate_areas(db: Session) -> dict:
    """user_id -> team_area, for every associate who has one assigned."""
    return {p.user_id: p.team_area for p in db.query(models.AssociateProfile).all()}


def _approved_requests_in_window(db: Session, start: datetime, end: datetime):
    return (
        db.query(models.LeaveRequest)
        .filter(
            models.LeaveRequest.status == "approved",
            models.LeaveRequest.date_from <= end,
            models.LeaveRequest.date_to >= start,
        )
        .all()
    )


def compute_coverage_forecast(db: Session, days: int = FORECAST_DAYS) -> dict:
    """For each of the next `days` days, and each team_area that has at
    least one associate, works out who's on approved Leave, who's on
    approved WFH, and who's fully available. A day where EVERY associate in
    an area is on Leave (WFH doesn't count - they're still working) is a
    coverage gap: that area's tickets would have no one to fall back on.

    Returns {"gaps": [...], "upcoming_leave": [...]}. `upcoming_leave` lists
    every approved Leave/WFH day even where it isn't (yet) a full gap, so
    the briefing can still flag "half the MM team is out Thursday" as a
    watch-item before it becomes a hard gap."""
    areas = _associate_areas(db)
    if not areas:
        return {"gaps": [], "upcoming_leave": []}

    area_members: dict[str, list[str]] = {}
    for user_id, area in areas.items():
        area_members.setdefault(area, []).append(user_id)

    today = datetime.utcnow().date()
    window_start = datetime.combine(today, datetime.min.time())
    window_end = window_start + timedelta(days=days)
    requests = _approved_requests_in_window(db, window_start, window_end)

    names = {u.id: u.full_name for u in db.query(models.User).filter(models.User.role == "associate").all()}

    gaps = []
    upcoming_leave = []
    for day_offset in range(days):
        day = today + timedelta(days=day_offset)
        day_start = datetime.combine(day, datetime.min.time())
        day_end = datetime.combine(day, datetime.max.time())

        leave_today = {
            r.associate_user_id
            for r in requests
            if r.request_type == "leave" and r.date_from <= day_end and r.date_to >= day_start
        }
        wfh_today = {
            r.associate_user_id
            for r in requests
            if r.request_type == "wfh" and r.date_from <= day_end and r.date_to >= day_start
        }

        for area, members in area_members.items():
            out_today = [m for m in members if m in leave_today]
            if not out_today:
                continue
            for user_id in out_today:
                upcoming_leave.append({
                    "team_area": area,
                    "date": day.isoformat(),
                    "associate_name": names.get(user_id, "Unknown"),
                    "type": "leave",
                })
            if len(out_today) >= len(members):
                gaps.append({
                    "team_area": area,
                    "date": day.isoformat(),
                    "associates_out": [names.get(u, "Unknown") for u in out_today],
                })

        for user_id in wfh_today:
            area = areas.get(user_id)
            if area:
                upcoming_leave.append({
                    "team_area": area,
                    "date": day.isoformat(),
                    "associate_name": names.get(user_id, "Unknown"),
                    "type": "wfh",
                })

    return {"gaps": gaps, "upcoming_leave": upcoming_leave}


def compute_reassignment_suggestions(df, db: Session) -> list:
    """For every associate on approved Leave TODAY who still owns open
    backlog tickets, suggests handing that backlog to their least-loaded
    same-team_area peer who is available today (not also on Leave). Purely
    a suggestion for the SDM to action manually - this never reassigns
    anything itself."""
    areas = _associate_areas(db)
    if not areas or len(df) == 0:
        return []

    today = datetime.utcnow().date()
    day_start = datetime.combine(today, datetime.min.time())
    day_end = datetime.combine(today, datetime.max.time())
    on_leave_today = {
        r.associate_user_id
        for r in _approved_requests_in_window(db, day_start, day_end)
        if r.request_type == "leave" and r.date_from <= day_end and r.date_to >= day_start
    }
    if not on_leave_today:
        return []

    users = {u.id: u for u in db.query(models.User).filter(models.User.role == "associate").all()}
    name_to_id = {u.full_name: uid for uid, u in users.items()}

    backlog_col = "is_backlog" if "is_backlog" in df.columns else "is_open"
    backlog_df = df[df[backlog_col]]
    backlog_by_name = backlog_df["Assigned To"].value_counts().to_dict()

    area_members: dict[str, list[str]] = {}
    for user_id, area in areas.items():
        area_members.setdefault(area, []).append(user_id)

    suggestions = []
    for user_id in on_leave_today:
        area = areas.get(user_id)
        if not area:
            continue
        full_name = users[user_id].full_name if user_id in users else None
        own_backlog = backlog_by_name.get(full_name, 0)
        if own_backlog == 0:
            continue
        peers = [m for m in area_members.get(area, []) if m != user_id and m not in on_leave_today]
        if not peers:
            continue
        peer_loads = [(p, backlog_by_name.get(users[p].full_name, 0)) for p in peers if p in users]
        if not peer_loads:
            continue
        peer_id, peer_load = min(peer_loads, key=lambda x: x[1])
        suggestions.append({
            "from_associate": full_name,
            "from_backlog_count": int(own_backlog),
            "to_associate": users[peer_id].full_name,
            "to_current_backlog_count": int(peer_load),
            "team_area": area,
        })
    return suggestions


def build_copilot_context(kpis: dict, backlog_by_priority: list, backlog_by_associate: list,
                           user_request_summary: dict, coverage: dict, reassignments: list) -> str:
    """Assembles the deterministic briefing packet the LLM narrates. Every
    line is a fact already computed above or elsewhere in data_processing.py
    - nothing here is a guess."""
    lines = ["=== SDM DAILY BRIEFING PACKET (all figures pre-computed, do not recalculate) ==="]

    lines.append(f"\nTotal tickets: {kpis.get('total_tickets', 0)}")
    lines.append(f"Open tickets: {kpis.get('open_tickets', 0)}")
    lines.append(f"Backlog (open, genuine incidents only): {kpis.get('backlog_tickets', 0)}")
    lines.append(f"User Request tickets (excluded from backlog): {kpis.get('user_request_tickets', 0)}")
    lines.append(f"P1 tickets: {kpis.get('p1_tickets', 0)}")
    lines.append(f"SLA compliance: {kpis.get('sla_compliance_pct', 0)}%")
    lines.append(f"CSAT: {kpis.get('csat_pct', 0)}%")

    lines.append("\nBacklog by priority:")
    for p in backlog_by_priority:
        lines.append(f"  {p['name']}: {p['value']}")

    top_backlog = sorted(backlog_by_associate, key=lambda a: a.get("total", 0), reverse=True)[:5]
    lines.append("\nTop 5 associates by backlog size:")
    if top_backlog:
        for a in top_backlog:
            lines.append(f"  {a.get('assignee', 'Unknown')}: {a.get('total', 0)} tickets")
    else:
        lines.append("  none")

    lines.append(f"\nUser Requests flagged: {user_request_summary.get('flagged_count', 0)} "
                  f"({user_request_summary.get('flagged_pct', 0)}% of total)")

    lines.append("\nCoverage gaps (next 7 days - EVERY associate in the area out on Leave that day):")
    if coverage["gaps"]:
        for g in coverage["gaps"]:
            lines.append(f"  {g['date']}: {g['team_area']} area - ALL OUT ({', '.join(g['associates_out'])})")
    else:
        lines.append("  none")

    lines.append("\nUpcoming Leave/WFH (next 7 days):")
    if coverage["upcoming_leave"]:
        for u in coverage["upcoming_leave"][:15]:
            lines.append(f"  {u['date']}: {u['associate_name']} ({u['team_area']}) - {u['type']}")
    else:
        lines.append("  none")

    lines.append("\nReassignment suggestions (associate on Leave today, still owns open backlog):")
    if reassignments:
        for r in reassignments:
            lines.append(
                f"  {r['from_associate']} ({r['from_backlog_count']} tickets, on Leave, {r['team_area']}) "
                f"-> suggest {r['to_associate']} (currently {r['to_current_backlog_count']} tickets)"
            )
    else:
        lines.append("  none")

    return "\n".join(lines)
