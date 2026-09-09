import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_uploader
from app.services import data_processing as dp
from app.services import ai_token_tracking as tracking
from app.services import ai_providers
from app.services import session_store
from app.routers.ticket_classification import apply_all_overlays

router = APIRouter(prefix="/semantic-analysis", tags=["semantic-analysis"])


# ---------------------------------------------------------------------------
# Cross-checking against the canonical ticket dataset (the same "Uploaded
# Data" selection the Dashboard/Analytics/Tickets pages use). Ticket numbers
# in a Sentiment Analysis conversation upload frequently overlap with
# numbers in that dataset (both commonly come from the same ITSM export),
# but the two are uploaded independently and don't automatically agree on
# Priority/State/Company/Assigned To - which is exactly what made this tab's
# "Important items" tiles able to disagree with the main Dashboard's. These
# helpers make the canonical dataset (when one is active) the source of
# truth for those structural fields, instead of a second, independent guess.
# ---------------------------------------------------------------------------

PRIORITY_LABEL_FROM_CANONICAL = {"P1": "1 - Critical", "P2": "2 - High", "P3": "3 - Moderate", "P4": "4 - Low"}
STATE_LABEL_FROM_CANONICAL = {
    "New": "New",
    "In Progress": "Open",
    "On Hold": "Awaiting Info",
    "Resolved": "Resolved",
    "Closed": "Closed",
    "Cancelled": "Cancelled",
}


def _load_canonical_index(db: Session) -> dict:
    """Looks up whatever ticket dataset is currently active on the
    Dashboard/Analytics/Tickets pages and, for every ticket Number it
    contains, returns the REAL Priority/State/Company/Assigned To/SLA-breach
    status that dataset carries - translated into the vocabulary this
    feature uses. Returns {} if no ticket dataset is currently active, so
    every caller has an explicit, checkable "nothing to cross-reference
    against right now" case rather than silently falling back to guesses."""
    dataset_ids = session_store.get_active_dataset_ids()
    if not dataset_ids:
        return {}
    try:
        df = dp.load_datasets(dataset_ids)
    except Exception:
        return {}
    if df is None or df.empty:
        return {}
    try:
        df = apply_all_overlays(df, db)
    except Exception:
        pass

    index = {}
    for _, row in df.iterrows():
        number = str(row.get("Number") or "").strip()
        if not number:
            continue
        raw_priority = str(row.get("Priority") or "").strip().upper()
        raw_state = str(row.get("State") or "").strip()
        sla_val = row.get("sla_breached")
        index[number] = {
            "priority": PRIORITY_LABEL_FROM_CANONICAL.get(raw_priority),
            "state": STATE_LABEL_FROM_CANONICAL.get(raw_state),
            "company": dp.clean_text(row.get("Company")),
            "assigned_to": dp.clean_text(row.get("Assigned To")),
            "contact": dp.clean_text(row.get("Main Contact Name")),
            "sla_breached": bool(sla_val) if sla_val is not None and sla_val == sla_val else None,
        }
    return index


# ---------------------------------------------------------------------------
# Upload: Excel/CSV export of ticket conversations between the end user and
# the TCS Associate (Number, Short Description, Assignment Group, Ticket
# Type, First Assignment Group, Additional Comments (end-user view), Work
# Notes (internal view)). Accumulates across uploads - this table IS the RAG
# corpus every other endpoint below reads from.
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_semantic_conversations(
    files: List[UploadFile] = File(...),
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files were provided")

    total_rows = 0
    per_file = []
    sentiment_counts = {"Positive": 0, "Neutral": 0, "Negative": 0}
    canonical = _load_canonical_index(db)
    canonical_matches = 0

    for file in files:
        content = await file.read()
        try:
            df = dp.load_semantic_file_to_df(file.filename, content)
        except ValueError as e:
            per_file.append({"filename": file.filename, "error": str(e), "rows_added": 0})
            continue

        rows = []
        for _, r in df.iterrows():
            number = dp.clean_text(r.get("Number"))
            if not number:
                continue
            short_desc = dp.clean_text(r.get("Short Description"))
            assignment_group = dp.clean_text(r.get("Assignment Group"))
            ticket_type = dp.clean_text(r.get("Ticket Type"))
            first_group = dp.clean_text(r.get("First Assignment Group"))
            comments = dp.clean_text(r.get("Additional Comments"))
            work_notes = dp.clean_text(r.get("Work Notes"))

            combined_text = " ".join(t for t in [short_desc, comments, work_notes] if t)
            sentiment_label, sentiment_score = dp.analyze_sentiment(combined_text)
            if sentiment_label:
                sentiment_counts[sentiment_label] = sentiment_counts.get(sentiment_label, 0) + 1

            last_activity = dp.extract_latest_journal_timestamp(comments, work_notes)

            # Contact/Company/Channel/State/Priority/Assigned To, in order of
            # trust: (1) the uploaded file's own value, if it has one - never
            # overridden; (2) the SAME ticket's real value in the currently
            # active ticket dataset, if this Number also appears there - so
            # this tab agrees with the Dashboard/Analytics/Tickets pages
            # about the same incident instead of guessing independently;
            # (3) only as a last resort, a deterministic synthetic
            # placeholder, purely so the Record details table isn't missing
            # columns ServiceNow's own case list always shows.
            cinfo = canonical.get(number)
            if cinfo:
                canonical_matches += 1
            synthesized = dp.synthesize_case_fields(number)

            file_company = dp.clean_text(r.get("Company"))
            file_state = dp.clean_text(r.get("State"))
            file_priority = dp.clean_text(r.get("Priority"))
            file_assigned_to = dp.clean_text(r.get("Assigned To"))
            file_contact = dp.clean_text(r.get("Contact"))
            file_channel = dp.clean_text(r.get("Channel"))

            contact = file_contact or (cinfo["contact"] if cinfo else None) or synthesized["contact"]
            company = file_company or (cinfo["company"] if cinfo else None) or synthesized["company"]
            channel = file_channel or synthesized["channel"]  # no channel concept in the ticket dataset
            state = file_state or (cinfo["state"] if cinfo else None) or synthesized["state"]
            priority = file_priority or (cinfo["priority"] if cinfo else None) or synthesized["priority"]
            assigned_to = file_assigned_to or (cinfo["assigned_to"] if cinfo else None) or synthesized["assigned_to"]

            rows.append(models.SemanticTicketConversation(
                number=number,
                short_description=short_desc,
                assignment_group=assignment_group,
                ticket_type=ticket_type,
                first_assignment_group=first_group,
                additional_comments=comments,
                work_notes=work_notes,
                sentiment=sentiment_label,
                sentiment_score=sentiment_score,
                last_activity_at=last_activity,
                contact=contact,
                company=company,
                channel=channel,
                state=state,
                priority=priority,
                assigned_to=assigned_to,
                company_is_uploaded=bool(file_company),
                state_is_uploaded=bool(file_state),
                priority_is_uploaded=bool(file_priority),
                assigned_to_is_uploaded=bool(file_assigned_to),
                source_filename=file.filename,
                uploaded_by_user_id=current_user.id,
            ))

        if rows:
            db.bulk_save_objects(rows)
            db.commit()
        total_rows += len(rows)
        per_file.append({"filename": file.filename, "rows_added": len(rows)})

    total_conversations = db.query(models.SemanticTicketConversation).count()

    return {
        "rows_added": total_rows,
        "per_file": per_file,
        "sentiment_breakdown_this_batch": sentiment_counts,
        "total_conversations_in_corpus": total_conversations,
        "canonical_ticket_matches_this_batch": canonical_matches,
        "canonical_ticket_dataset_active": bool(canonical),
    }


@router.get("/corpus-status")
def corpus_status(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """How much data the RAG corpus has, so the Semantic Analysis page can
    show an empty state instead of blank charts before anything is uploaded."""
    total = db.query(models.SemanticTicketConversation).count()
    files = (
        db.query(models.SemanticTicketConversation.source_filename)
        .distinct()
        .all()
    )
    return {
        "total_conversations": total,
        "files_uploaded": sorted({f[0] for f in files if f[0]}),
    }


@router.post("/resync-with-ticket-dataset")
def resync_with_ticket_dataset(
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Re-runs the canonical-ticket-dataset cross-check (see
    _load_canonical_index) against every already-uploaded incident in this
    corpus, so a ticket dataset that was activated or changed AFTER the
    Sentiment Analysis corpus was uploaded still gets picked up. Only ever
    overwrites a field the original conversation file didn't itself provide
    (never a value the uploader explicitly supplied) - a field that was
    synthesized because no canonical match existed yet will be replaced with
    the real value once one does; a field already sourced from the ticket
    dataset is refreshed in case that dataset's own data changed since."""
    canonical = _load_canonical_index(db)
    if not canonical:
        raise HTTPException(
            status_code=400,
            detail="No ticket dataset is currently active on the Dashboard/Analytics pages. "
                   "Activate one from the Data page, then resync.",
        )

    rows = db.query(models.SemanticTicketConversation).all()
    matched = 0
    updated = 0
    for r in rows:
        cinfo = canonical.get(r.number)
        if not cinfo:
            continue
        matched += 1
        changed = False
        if not r.company_is_uploaded and cinfo["company"] and r.company != cinfo["company"]:
            r.company = cinfo["company"]
            changed = True
        if not r.state_is_uploaded and cinfo["state"] and r.state != cinfo["state"]:
            r.state = cinfo["state"]
            changed = True
        if not r.priority_is_uploaded and cinfo["priority"] and r.priority != cinfo["priority"]:
            r.priority = cinfo["priority"]
            changed = True
        if not r.assigned_to_is_uploaded and cinfo["assigned_to"] and r.assigned_to != cinfo["assigned_to"]:
            r.assigned_to = cinfo["assigned_to"]
            changed = True
        if changed:
            updated += 1

    db.commit()
    return {"total_conversations": len(rows), "matched_to_ticket_dataset": matched, "records_updated": updated}


# ---------------------------------------------------------------------------
# Sentiment trend + breakdown - the deterministic (no AI provider needed)
# charts that mirror the ServiceNow "Sentiment trend" screenshots: a 5-bucket
# stacked trend-over-time chart and a breakdown table keyed by a selectable
# field (Assignment Group / Ticket Type / First Assignment Group - the
# closest equivalents we have to ServiceNow's Region/Agent/Account/Channel,
# since our data model doesn't carry those).
# ---------------------------------------------------------------------------

SENTIMENT_BUCKETS = ["Very negative", "Negative", "Neutral", "Positive", "Very positive"]

BREAKDOWN_FIELDS = {
    "assignment_group": lambda r: r.assignment_group or "Unassigned",
    "ticket_type": lambda r: r.ticket_type or "Unspecified",
    "first_assignment_group": lambda r: r.first_assignment_group or "Unassigned",
    "channel": lambda r: r.channel or "Unspecified",
    "priority": lambda r: r.priority or "Unspecified",
    "state": lambda r: r.state or "Unspecified",
}

# Cases whose priority puts them on an escalation path - used as the proxy
# for ServiceNow's "before escalation / after escalation" sentiment-change
# comparison, since our data model has no dedicated escalated_at field.
ESCALATED_PRIORITIES = {"1 - Critical", "2 - High"}

DATE_RANGE_DAYS = {"7d": 7, "30d": 30, "3m": 90, "6m": 182, "1y": 365}


def _bucket_for_score(score: Optional[float]) -> str:
    """Buckets a single sentiment score into the same 5 ServiceNow-style
    buckets used for the "Avg. Sentiment" column, rather than the plain
    3-way Positive/Neutral/Negative label stored on the row - the stacked
    trend chart and breakdown bars need the finer 5-way split to look/behave
    like the reference dashboard."""
    if score is None:
        return "Neutral"
    if score <= -0.5:
        return "Very negative"
    if score < -0.1:
        return "Negative"
    if score < 0.1:
        return "Neutral"
    if score < 0.5:
        return "Positive"
    return "Very positive"


def _sentiment_avg_label(scores: list) -> str:
    valid = [s for s in scores if s is not None]
    if not valid:
        return "Neutral"
    return _bucket_for_score(sum(valid) / len(valid))


def _empty_bucket_counts() -> dict:
    return {b: 0 for b in SENTIMENT_BUCKETS}


def _effective_bucket(r: "models.SemanticTicketConversation") -> str:
    """The single source of truth for "what sentiment bucket is this
    incident in" - a manually-associated sentiment (set by any user from the
    Incident detail page) always wins over the auto-computed score, and
    every chart/KPI/table on the Sentiment Analysis tab (and the Home
    widgets) derives its bucket through this function so a manual
    association is reflected everywhere consistently, with no risk of one
    view showing the auto value and another showing the override."""
    if r.sentiment_override in SENTIMENT_BUCKETS:
        return r.sentiment_override
    return _bucket_for_score(r.sentiment_score)


@router.get("/filter-options")
def filter_options(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Distinct values for the dashboard's filter bar - populated from
    whatever has actually been uploaded, so the filters never offer an
    option with zero matching conversations."""
    def distinct(col):
        return sorted({v[0] for v in db.query(col).distinct().all() if v[0]})

    return {
        "assignment_groups": distinct(models.SemanticTicketConversation.assignment_group),
        "ticket_types": distinct(models.SemanticTicketConversation.ticket_type),
        "first_assignment_groups": distinct(models.SemanticTicketConversation.first_assignment_group),
        "channels": distinct(models.SemanticTicketConversation.channel),
        "states": distinct(models.SemanticTicketConversation.state),
        "priorities": distinct(models.SemanticTicketConversation.priority),
    }


@router.get("/dashboard")
def semantic_dashboard(
    date_range: str = "6m",
    breakdown_by: str = "channel",
    assignment_group: Optional[str] = None,
    ticket_type: Optional[str] = None,
    channel: Optional[str] = None,
    priority: Optional[str] = None,
    state: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    breakdown_key = BREAKDOWN_FIELDS.get(breakdown_by, BREAKDOWN_FIELDS["channel"])

    query = db.query(models.SemanticTicketConversation)
    if assignment_group:
        query = query.filter(models.SemanticTicketConversation.assignment_group == assignment_group)
    if ticket_type:
        query = query.filter(models.SemanticTicketConversation.ticket_type == ticket_type)
    if channel:
        query = query.filter(models.SemanticTicketConversation.channel == channel)
    if priority:
        query = query.filter(models.SemanticTicketConversation.priority == priority)
    if state:
        query = query.filter(models.SemanticTicketConversation.state == state)
    all_rows = query.all()

    if not all_rows:
        return {
            "total_conversations": 0,
            "trend": [],
            "breakdown_by_group": [],
            "overall_sentiment_counts": _empty_bucket_counts(),
            "incidents_by_channel": [],
            "escalation_comparison": None,
            "ticket_dataset_active": bool(session_store.get_active_dataset_ids()),
        }

    # The trend chart only makes sense over rows that actually have a parsed
    # activity timestamp AND fall inside the requested window - but the
    # breakdown table and overall counts intentionally use the full,
    # unwindowed set, since a ticket with no parseable timestamp still
    # belongs in "how many total/negative conversations does this group
    # have", just not on a specific day of the trend line.
    days = DATE_RANGE_DAYS.get(date_range)
    if days is not None:
        cutoff = datetime.utcnow() - timedelta(days=days)
        trend_rows = [r for r in all_rows if r.last_activity_at is not None and r.last_activity_at >= cutoff]
    else:
        trend_rows = [r for r in all_rows if r.last_activity_at is not None]

    by_day = defaultdict(_empty_bucket_counts)
    for r in trend_rows:
        day = r.last_activity_at.date().isoformat()
        by_day[day][_effective_bucket(r)] += 1
    trend = [
        {"date": day, **counts, "total": sum(counts.values())}
        for day, counts in sorted(by_day.items())
    ]

    by_group_buckets = defaultdict(list)
    group_bucket_counts = defaultdict(_empty_bucket_counts)
    for r in all_rows:
        group = breakdown_key(r)
        by_group_buckets[group].append(_effective_bucket(r))
        group_bucket_counts[group][_effective_bucket(r)] += 1
    breakdown = [
        {
            "group": group,
            "avg_sentiment_label": Counter(buckets).most_common(1)[0][0] if buckets else "Neutral",
            "total_records": len(buckets),
            "counts": group_bucket_counts[group],
        }
        for group, buckets in sorted(by_group_buckets.items(), key=lambda kv: -len(kv[1]))
    ]

    overall_counts = _empty_bucket_counts()
    for r in all_rows:
        overall_counts[_effective_bucket(r)] += 1

    # Number of incidents by channel - counts + sentiment split per channel,
    # for a small grouped bar chart alongside the "Generated insights" row.
    channel_counts = defaultdict(_empty_bucket_counts)
    for r in all_rows:
        channel_counts[r.channel or "Unspecified"][_effective_bucket(r)] += 1
    incidents_by_channel = [
        {"channel": ch, "counts": counts, "total": sum(counts.values())}
        for ch, counts in sorted(channel_counts.items(), key=lambda kv: -sum(kv[1].values()))
    ]

    # Sentiment change after escalation - proxy comparison using High/Critical
    # priority rows as "escalated" vs everything else as "before escalation",
    # mirroring ServiceNow's before/after-escalation stacked comparison chart.
    escalated_counts = _empty_bucket_counts()
    non_escalated_counts = _empty_bucket_counts()
    for r in all_rows:
        bucket = _effective_bucket(r)
        if (r.priority or "") in ESCALATED_PRIORITIES:
            escalated_counts[bucket] += 1
        else:
            non_escalated_counts[bucket] += 1
    escalation_comparison = {
        "before_escalation": non_escalated_counts,
        "after_escalation": escalated_counts,
    } if sum(escalated_counts.values()) > 0 else None

    return {
        "total_conversations": len(all_rows),
        "trend": trend,
        "breakdown_by_group": breakdown,
        "overall_sentiment_counts": overall_counts,
        "incidents_by_channel": incidents_by_channel,
        "escalation_comparison": escalation_comparison,
        # Whether a ticket dataset is currently active on the Dashboard/
        # Analytics pages, i.e. whether Priority/State/Company/Assigned To
        # here can be (or have been) cross-checked against that canonical
        # source rather than resting on this corpus's own upload/synthesis.
        "ticket_dataset_active": bool(session_store.get_active_dataset_ids()),
    }


@router.get("/records")
def semantic_records(
    page: int = 1,
    page_size: int = 20,
    assignment_group: Optional[str] = None,
    ticket_type: Optional[str] = None,
    channel: Optional[str] = None,
    state: Optional[str] = None,
    priority: Optional[str] = None,
    sentiment: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Backs the "Record details" tab - a flat, filterable, paginated table
    of the uploaded conversations, mirroring the ServiceNow reference view's
    Case/Contact/Company/Channel/State/Priority/Assigned to/Sentiment
    columns alongside the trend chart."""
    page = max(1, page)
    page_size = max(1, min(page_size, 100))

    query = db.query(models.SemanticTicketConversation)
    if assignment_group:
        query = query.filter(models.SemanticTicketConversation.assignment_group == assignment_group)
    if ticket_type:
        query = query.filter(models.SemanticTicketConversation.ticket_type == ticket_type)
    if channel:
        query = query.filter(models.SemanticTicketConversation.channel == channel)
    if state:
        query = query.filter(models.SemanticTicketConversation.state == state)
    if priority:
        query = query.filter(models.SemanticTicketConversation.priority == priority)
    if sentiment:
        query = query.filter(models.SemanticTicketConversation.sentiment == sentiment)

    total = query.count()
    rows = (
        query.order_by(models.SemanticTicketConversation.last_activity_at.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "records": [_record_detail_dict(r) for r in rows],
    }


def _record_detail_dict(r: "models.SemanticTicketConversation") -> dict:
    """The single shape used by the records list, the record detail page,
    and the sentiment-association response - so every place in the UI that
    shows a record's sentiment is guaranteed to agree with the dashboard's
    charts (all derived through _effective_bucket)."""
    return {
        "number": r.number,
        "short_description": r.short_description,
        "assignment_group": r.assignment_group,
        "ticket_type": r.ticket_type,
        "first_assignment_group": r.first_assignment_group,
        "additional_comments": r.additional_comments,
        "work_notes": r.work_notes,
        "contact": r.contact or "(empty)",
        "company": r.company or "(empty)",
        "channel": r.channel or "(empty)",
        "state": r.state or "New",
        "priority": r.priority or "4 - Low",
        "assigned_to": r.assigned_to or "(empty)",
        "sentiment": _effective_bucket(r),
        "sentiment_score": r.sentiment_score,
        "sentiment_source": "manual" if r.sentiment_override in SENTIMENT_BUCKETS else "auto",
        "sentiment_associated_by": r.sentiment_override_by,
        "sentiment_associated_at": r.sentiment_override_at.isoformat() if r.sentiment_override_at else None,
        "last_activity_at": r.last_activity_at.isoformat() if r.last_activity_at else None,
    }


@router.get("/records/{number}")
def semantic_record_detail(
    number: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Backs the individual Incident detail page - every user who can see
    the Sentiment Analysis tab can open this, regardless of role."""
    row = (
        db.query(models.SemanticTicketConversation)
        .filter(models.SemanticTicketConversation.number == number)
        .order_by(models.SemanticTicketConversation.created_at.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    return _record_detail_dict(row)


class AssociateSentimentRequest(BaseModel):
    sentiment: str


@router.post("/records/{number}/sentiment")
def associate_sentiment(
    number: str,
    payload: AssociateSentimentRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lets ANY signed-in user manually associate a sentiment with a
    specific incident from its detail page - intentionally not gated behind
    require_uploader, since associating sentiment is a judgment call any
    team member reading the conversation should be able to make, not a
    data-management action. The override takes precedence over the
    auto-computed sentiment everywhere in the Sentiment Analysis feature
    (see _effective_bucket)."""
    sentiment = (payload.sentiment or "").strip()
    if sentiment not in SENTIMENT_BUCKETS:
        raise HTTPException(
            status_code=400,
            detail=f"sentiment must be one of: {', '.join(SENTIMENT_BUCKETS)}",
        )
    row = (
        db.query(models.SemanticTicketConversation)
        .filter(models.SemanticTicketConversation.number == number)
        .order_by(models.SemanticTicketConversation.created_at.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")

    row.sentiment_override = sentiment
    row.sentiment_override_by = current_user.full_name
    row.sentiment_override_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _record_detail_dict(row)


# ---------------------------------------------------------------------------
# RAG-generated insight cards - retrieval (pick the most informative
# excerpts out of the corpus) + generation (an AI provider narrates them
# into the same card shapes as ServiceNow's "Generated insights" row).
# ---------------------------------------------------------------------------

MAX_EXCERPTS_PER_SIDE = 12


def _excerpt_text(r: models.SemanticTicketConversation) -> str:
    parts = [p for p in [r.short_description, r.additional_comments, r.work_notes] if p]
    return " | ".join(parts)[:600]


def _build_rag_context(rows: list) -> str:
    negatives = sorted(
        [r for r in rows if r.sentiment_score is not None],
        key=lambda r: r.sentiment_score,
    )[:MAX_EXCERPTS_PER_SIDE]
    positives = sorted(
        [r for r in rows if r.sentiment_score is not None],
        key=lambda r: -r.sentiment_score,
    )[:MAX_EXCERPTS_PER_SIDE]

    group_negative_counts = Counter(
        (r.assignment_group or "Unassigned") for r in rows if _effective_bucket(r) in ("Negative", "Very negative")
    )
    top_negative_groups = group_negative_counts.most_common(5)

    def fmt(r):
        return f"[{r.number}] group={r.assignment_group or 'Unassigned'} sentiment={_effective_bucket(r)} :: {_excerpt_text(r)}"

    lines = ["RETRIEVED NEGATIVE EXCERPTS:"]
    lines += [fmt(r) for r in negatives] or ["None"]
    lines.append("\nRETRIEVED POSITIVE EXCERPTS:")
    lines += [fmt(r) for r in positives] or ["None"]
    lines.append("\nTOP ASSIGNMENT GROUPS BY NEGATIVE COUNT:")
    lines += [f"- {g}: {c}" for g, c in top_negative_groups] or ["None"]
    lines.append(f"\nTotal conversations in corpus: {len(rows)}")
    return "\n".join(lines)


def _driver_chart(rows: list, negative: bool, top_groups: Optional[list] = None) -> list:
    """Deterministic per-assignment-group 5-bucket sentiment breakdown, used
    to draw the small horizontal stacked bar chart under the Negative/Positive
    sentiment drivers cards. Always computed here from the real corpus
    (never from AI narrative text) so the chart's numbers can't drift from
    the rest of the dashboard - it groups by the same "assignment_group"
    field and _effective_bucket() the breakdown table and trend chart use.
    If top_groups is given (the group names already surfaced in
    top_reasons/top_negative_assignment_groups), the chart is restricted to
    those groups so the bars line up with the narrative bullets above them;
    otherwise it falls back to the top groups by negative/positive volume."""
    by_group = defaultdict(_empty_bucket_counts)
    for r in rows:
        by_group[r.assignment_group or "Unassigned"][_effective_bucket(r)] += 1

    if top_groups:
        names = [g for g in top_groups if g in by_group][:4]
    else:
        weight = (lambda c: c["Very negative"] + c["Negative"]) if negative else (lambda c: c["Positive"] + c["Very positive"])
        names = [g for g, _ in sorted(by_group.items(), key=lambda kv: -weight(kv[1]))[:4]]

    return [{"name": g, "counts": by_group[g], "total": sum(by_group[g].values())} for g in names]


def _fallback_insights(rows: list) -> dict:
    """Deterministic, no-AI-provider-required version of the insight cards -
    same shape as the AI-generated response, built purely from counts, so
    the tab still shows something useful before an AI provider is configured."""
    group_negative_counts = Counter(
        (r.assignment_group or "Unassigned") for r in rows if _effective_bucket(r) in ("Negative", "Very negative")
    )
    group_positive_counts = Counter(
        (r.assignment_group or "Unassigned") for r in rows if _effective_bucket(r) in ("Positive", "Very positive")
    )
    top_negative = group_negative_counts.most_common(5)
    top_positive = group_positive_counts.most_common(3)
    negatives = sorted([r for r in rows if r.sentiment_score is not None], key=lambda r: r.sentiment_score)[:3]
    positives = sorted([r for r in rows if r.sentiment_score is not None], key=lambda r: -r.sentiment_score)[:3]

    return {
        "negative_sentiment_drivers": {
            "summary": f"{sum(group_negative_counts.values())} conversations scored negative across {len(group_negative_counts)} assignment group(s).",
            "top_reasons": [f"{g}: {c} negative conversation(s)" for g, c in top_negative[:3]],
            "chart": _driver_chart(rows, negative=True, top_groups=[g for g, _ in top_negative[:4]]),
        },
        "positive_sentiment_drivers": {
            "summary": f"{sum(group_positive_counts.values())} conversations scored positive.",
            "top_reasons": [f"{g}: {c} positive conversation(s)" for g, c in top_positive],
            "chart": _driver_chart(rows, negative=False, top_groups=[g for g, _ in top_positive[:4]]),
        },
        "top_negative_assignment_groups": {
            "summary": "Ranked by negative conversation count." if top_negative else "No negative conversations found.",
            "groups": [{"name": g, "count": c} for g, c in top_negative],
        },
        "sentiment_change_after_escalation": "AI provider not configured - configure one in Settings to generate a narrative comparison.",
        "key_quotes": [
            {"number": r.number, "excerpt": (r.short_description or "")[:120], "sentiment": _effective_bucket(r)}
            for r in (negatives + positives) if r.short_description
        ][:3],
        "ai_generated": False,
    }


@router.post("/insights")
async def semantic_insights(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.SemanticTicketConversation).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No ticket conversations uploaded yet")

    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError:
        return _fallback_insights(rows)

    context = _build_rag_context(rows)
    try:
        result = await provider.generate_insights(context, system_prompt=ai_providers.SEMANTIC_ANALYSIS_SYSTEM_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    tracking.record_usage(db, current_user, "semantic_analysis", result["usage"], provider=provider_name)
    db.commit()

    insights = result["insights"]
    insights["ai_generated"] = True

    # The AI only narrates from a retrieved excerpt sample, so it can't be
    # trusted to also produce accurate chart numbers - always compute the
    # driver charts here from the full corpus via _effective_bucket, keyed
    # to the same group names the AI's own top_reasons/groups mention where
    # possible, so the narrative and the chart agree.
    negative_groups = [
        g["name"] for g in insights.get("top_negative_assignment_groups", {}).get("groups", [])
    ]
    insights.setdefault("negative_sentiment_drivers", {})["chart"] = _driver_chart(
        rows, negative=True, top_groups=negative_groups or None,
    )
    insights.setdefault("positive_sentiment_drivers", {})["chart"] = _driver_chart(rows, negative=False)

    return {"provider": provider_name, "insights": insights}


# ---------------------------------------------------------------------------
# RAG "ask a question" chat - retrieves the most relevant conversations via
# TF-IDF similarity, then asks the configured AI provider to answer grounded
# only in those retrieved excerpts.
# ---------------------------------------------------------------------------

class SemanticAskRequest(BaseModel):
    question: str


@router.post("/ask")
async def semantic_ask(
    payload: SemanticAskRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="A question is required")

    rows = db.query(models.SemanticTicketConversation).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No ticket conversations uploaded yet")

    try:
        provider_name, provider = ai_providers.resolve_provider(current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    documents = [_excerpt_text(r) for r in rows]
    vectors, idf = dp.build_tfidf_index(documents)
    matches = dp.tfidf_query(question, vectors, idf, top_k=8)

    if not matches:
        rag_context = "No retrieved excerpts matched this question closely enough in the uploaded ticket conversations."
        sources = []
    else:
        picked = [rows[i] for i, _score in matches]
        rag_context = "\n".join(
            f"[{r.number}] group={r.assignment_group or 'Unassigned'} sentiment={_effective_bucket(r)} :: {_excerpt_text(r)}"
            for r in picked
        )
        sources = [r.number for r in picked]

    try:
        result = await provider.chat(
            messages=[{"role": "user", "content": question}],
            data_context=(
                "The following are the ONLY retrieved ticket-conversation excerpts relevant to this "
                "question (RAG retrieval over the uploaded User<->TCS-Associate conversation corpus). "
                "Answer strictly from these excerpts and say so plainly if they don't cover the question:\n\n"
                + rag_context
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    tracking.record_usage(db, current_user, "semantic_analysis_chat", result["usage"], provider=provider_name)
    db.commit()

    return {"provider": provider_name, "answer": result["reply"], "sources": sources}


# ---------------------------------------------------------------------------
# Home dashboard widgets - mirrors the ServiceNow CSM/FSM workspace's Home
# page: "Important items" metric tiles, "My active cases" / "My team's
# cases" tables, and a "Performance" section with a Sentiment trend mini
# chart + Trending topics table. All computed live off the same
# SemanticTicketConversation corpus the Sentiment Analysis tab uses, since
# that's where Contact/Company/Channel/State/Priority/Assigned To live.
# ---------------------------------------------------------------------------

ACTIVE_STATES = {"New", "Open", "Awaiting Info"}
HIGH_PRIORITIES = {"1 - Critical", "2 - High"}


@router.get("/home-summary")
def home_summary(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Backs the Home page's 'Important items' tiles and 'Performance'
    section (Sentiment trend + Trending topics)."""
    rows = db.query(models.SemanticTicketConversation).all()
    if not rows:
        return {"has_data": False}

    now = datetime.utcnow()
    stale_cutoff = now - timedelta(days=3)

    active_rows = [r for r in rows if (r.state or "New") in ACTIVE_STATES]
    high_priority_cases = len([r for r in active_rows if (r.priority or "") in HIGH_PRIORITIES])

    # SLA breach status is genuinely time-sensitive (a ticket can cross its
    # due date between page loads), so - unlike Priority/State/Company/
    # Assigned To above, which are synced at upload/resync time - this is
    # always computed live against whatever ticket dataset is currently
    # active, rather than ever mirroring another tile's number. When no
    # ticket dataset is active (or none of these incidents match one), this
    # can't be authentically computed at all, so it's reported as
    # unavailable (null) instead of a guessed or duplicated figure.
    canonical = _load_canonical_index(db)
    if canonical:
        matched_active = [r for r in active_rows if r.number in canonical]
        sla_breached_or_due_today = sum(1 for r in matched_active if canonical[r.number]["sla_breached"])
        sla_metric_available = True
    else:
        sla_breached_or_due_today = None
        sla_metric_available = False

    cases_not_updated_3d = len([
        r for r in active_rows
        if not r.last_activity_at or r.last_activity_at < stale_cutoff
    ])
    # No case-task sub-object in this data model - "Awaiting Info" cases are
    # the closest proxy for open follow-up tasks sitting on someone's plate.
    case_tasks = len([r for r in active_rows if r.state == "Awaiting Info"])
    unassigned_cases = len([r for r in active_rows if not r.assigned_to])

    # Sentiment trend - simple daily-average line over the last 30 days
    # (rather than the stacked 5-bucket chart on the Sentiment Analysis tab
    # itself), matching the compact Home-page widget.
    # Score used for the mini trend line's y-position: the midpoint score of
    # the effective bucket when a manual sentiment association is present
    # (so an association immediately moves this line, matching the main
    # Sentiment Analysis tab), otherwise the row's own computed score.
    BUCKET_MIDPOINT = {"Very negative": -0.75, "Negative": -0.3, "Neutral": 0.0, "Positive": 0.3, "Very positive": 0.75}
    cutoff_30d = now - timedelta(days=30)
    by_day_scores = defaultdict(list)
    for r in rows:
        if not r.last_activity_at or r.last_activity_at < cutoff_30d:
            continue
        score = BUCKET_MIDPOINT[r.sentiment_override] if r.sentiment_override in SENTIMENT_BUCKETS else r.sentiment_score
        if score is not None:
            by_day_scores[r.last_activity_at.date().isoformat()].append(score)
    sentiment_trend = [
        {"date": day, "avg_score": sum(scores) / len(scores), "count": len(scores)}
        for day, scores in sorted(by_day_scores.items())
    ]

    # Trending topics - top assignment groups by recent volume, with an
    # open-vs-resolved split, standing in for ServiceNow's clustered "topic"
    # detection since this data model has no topic/cluster field.
    recent_rows = [r for r in rows if r.last_activity_at and r.last_activity_at >= cutoff_30d] or rows
    group_rows = defaultdict(list)
    for r in recent_rows:
        group_rows[r.assignment_group or "Uncategorized"].append(r)
    trending_topics = []
    for group, grows in sorted(group_rows.items(), key=lambda kv: -len(kv[1]))[:5]:
        resolved = len([r for r in grows if (r.state or "") in ("Resolved", "Closed")])
        trending_topics.append({
            "description": group,
            "total_records": len(grows),
            "open": len(grows) - resolved,
            "resolved": resolved,
        })

    return {
        "has_data": True,
        "important_items": {
            "high_priority_cases": high_priority_cases,
            "sla_breached_or_due_today": sla_breached_or_due_today,
            "sla_metric_available": sla_metric_available,
            "cases_not_updated_3d": cases_not_updated_3d,
            "case_tasks": case_tasks,
            "unassigned_cases": unassigned_cases,
        },
        "sentiment_trend": sentiment_trend,
        "trending_topics": trending_topics,
    }


def _case_row_dict(r: models.SemanticTicketConversation) -> dict:
    return {
        "number": r.number,
        "short_description": r.short_description,
        "company": r.company or "(empty)",
        "priority": r.priority or "4 - Low",
        "state": r.state or "New",
        "assigned_to": r.assigned_to or "(empty)",
        "last_activity_at": r.last_activity_at.isoformat() if r.last_activity_at else None,
    }


@router.get("/home-cases")
def home_cases(
    scope: str = "mine",
    page: int = 1,
    page_size: int = 6,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Backs 'My active incidents' (scope=mine: incidents actually assigned
    to me, and still active) and 'My team's incidents' (scope=team: every
    active incident in the corpus) on the Home page. 'Mine' intentionally
    checks ONLY the Assigned To field - it previously also matched anything
    the current user had ever uploaded, which meant whoever uploaded the
    corpus saw the entire team's incident count mislabeled as their own
    personal workload."""
    page = max(1, page)
    page_size = max(1, min(page_size, 50))

    query = db.query(models.SemanticTicketConversation).filter(
        models.SemanticTicketConversation.state.in_(ACTIVE_STATES)
        | models.SemanticTicketConversation.state.is_(None)
    )
    if scope == "mine":
        query = query.filter(models.SemanticTicketConversation.assigned_to == current_user.full_name)

    total = query.count()
    rows = (
        query.order_by(models.SemanticTicketConversation.last_activity_at.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "records": [_case_row_dict(r) for r in rows]}
