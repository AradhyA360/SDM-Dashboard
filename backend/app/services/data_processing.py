import difflib
import io
import math
import os
import random
import re
import uuid
from datetime import datetime
from typing import Optional

import pandas as pd
import numpy as np

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

# Canonical ServiceNow-style column names. These are what the cleaned dataframe
# always has, and what the ticket drill-down table displays column-for-column.
EXPECTED_COLUMNS = [
    "Number", "Opened", "Short Description", "Category", "Priority", "State",
    "Name", "Assignment Group", "Assigned To", "Company", "Business Service",
    "Country", "Main Contact Name", "Manager", "Location", "Updated By",
    "Associate Assignment Date", "SLA Due Date", "Resolved Date", "Closed Date",
    "Pending Reason", "Type",
]

# Backward-compatible aliases so older exports (or the previous version of the
# sample dataset) still map onto the current schema instead of silently losing data.
LEGACY_ALIASES = {
    "ticket id": "Number",
    "open date": "Opened",
    "status": "State",
    "module": "Category",
    "customer name": "Company",
    "application name": "Business Service",
    "assigned engineer": "Assigned To",
}

DATE_COLUMNS = ["Opened", "Associate Assignment Date", "SLA Due Date", "Resolved Date", "Closed Date"]
TEXT_COLUMNS = [
    "Short Description", "Category", "Priority", "State", "Name", "Assignment Group",
    "Assigned To", "Company", "Business Service", "Country", "Main Contact Name",
    "Manager", "Location", "Updated By", "Pending Reason", "Type",
]

# Fixed SLA windows per priority, in hours. Used to fill in a missing SLA Due Date
# and to drive the SLA compliance calculation consistently.
PRIORITY_SLA_HOURS = {"P1": 4, "P2": 48, "P3": 120, "P4": 240}
PRIORITY_WEIGHT = {"p1": 4, "p2": 3, "p3": 2, "p4": 1}

DONE_STATES = {"resolved", "closed", "cancelled"}

# Columns shown, in order, on the ticket drill-down table.
DISPLAY_COLUMNS = [
    "Number", "Opened", "Short Description", "Category", "Priority", "State",
    "Name", "Assignment Group", "Assigned To", "Company", "Business Service",
    "Country", "Main Contact Name", "Manager", "Location", "Updated By",
    "Associate Assignment Date", "At Risk", "Effective Type", "Manually Classified",
]


def dataset_path(dataset_id: str) -> str:
    return os.path.join(STORAGE_DIR, f"{dataset_id}.parquet")


def load_file_to_df(filename: str, content: bytes) -> pd.DataFrame:
    buf = io.BytesIO(content)
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(buf)
    elif filename.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(buf)
    else:
        raise ValueError("Unsupported file type. Please upload a .csv or .xlsx file.")
    return df


def clean_dataframe(df: pd.DataFrame) -> tuple:
    """Returns (cleaned_df, report) where report is a dict describing every
    auto-correction made, so the Upload page can show exactly what got
    defaulted or fixed instead of silently changing the data underneath the
    person who uploaded it."""
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    report = {"missing_columns": [], "invalid_priority_count": 0, "invalid_state_count": 0,
              "missing_sla_due_count": 0, "auto_generated_numbers": 0}

    # Case/whitespace-insensitive header matching, plus legacy alias support, so
    # near-miss or older-schema headers don't silently disappear.
    canonical_lookup = {c.lower(): c for c in EXPECTED_COLUMNS}
    canonical_lookup.update(LEGACY_ALIASES)
    rename_map = {}
    for col in df.columns:
        canonical = canonical_lookup.get(col.strip().lower())
        if canonical and canonical != col:
            rename_map[col] = canonical
    if rename_map:
        df = df.rename(columns=rename_map)

    for date_col in DATE_COLUMNS:
        if date_col in df.columns:
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        else:
            df[date_col] = pd.NaT
            report["missing_columns"].append(date_col)

    for text_col in TEXT_COLUMNS:
        if text_col in df.columns:
            df[text_col] = df[text_col].fillna("Unknown").astype(str).str.strip()
        else:
            df[text_col] = "Unknown"
            report["missing_columns"].append(text_col)

    if "Number" not in df.columns:
        df["Number"] = [f"INC00{10000 + i}" for i in range(len(df))]
        report["auto_generated_numbers"] = len(df)
        report["missing_columns"].append("Number")
    if "Short Description" in df.columns:
        df["Short Description"] = df["Short Description"].replace("Unknown", "No description provided")

    # Auto-reject duplicate tickets. Two layers: (1) the same ticket Number
    # showing up more than once (a straight re-import/dump overlap), and (2)
    # no Number collision but everything else about the ticket matches - same
    # customer, same description text, same open timestamp - which is what a
    # ticket logged twice under two different Numbers looks like. Both are
    # dropped (keeping the first occurrence) rather than surfaced for review,
    # since a duplicate contributes nothing but inflated counts.
    before_number_dedupe = len(df)
    df = df.drop_duplicates(subset=["Number"], keep="first")
    report["duplicate_number_count"] = before_number_dedupe - len(df)

    before_content_dedupe = len(df)
    dup_key = (
        df["Company"].astype(str).str.lower().str.strip() + "||"
        + df["Short Description"].astype(str).str.lower().str.strip() + "||"
        + df["Opened"].astype(str)
    )
    df = df[~dup_key.duplicated(keep="first")]
    report["duplicate_content_count"] = before_content_dedupe - len(df)
    report["duplicate_rejected_count"] = report["duplicate_number_count"] + report["duplicate_content_count"]

    # Normalize priority to P1-P4; anything unrecognized falls back to P4 (lowest
    # urgency) rather than silently dropping the ticket from priority-based views.
    df["Priority"] = df["Priority"].str.upper().str.strip()
    invalid_priority_mask = ~df["Priority"].isin(PRIORITY_SLA_HOURS.keys())
    report["invalid_priority_count"] = int(invalid_priority_mask.sum())
    df.loc[invalid_priority_mask, "Priority"] = "P4"

    # Normalize state to the six ServiceNow-style values; unrecognized values fall
    # back to "New" so a ticket is never silently excluded from open/active counts.
    valid_states = {"new", "in progress", "on hold", "resolved", "closed", "cancelled"}
    state_title = df["State"].str.strip()
    invalid_state_mask = ~state_title.str.lower().isin(valid_states)
    report["invalid_state_count"] = int(invalid_state_mask.sum())
    df["State"] = np.where(~invalid_state_mask, state_title.str.title(), "New")

    # A "New" ticket hasn't been picked up by anyone yet - by definition it
    # can't also show up as assigned to an associate. Some source dumps carry
    # a stale "Assigned To" value from before the ticket was reset/reopened
    # to New; that's what was making the dashboard show a ticket as both
    # New AND assigned. Clear it so New tickets are always unassigned.
    new_but_assigned_mask = (df["State"] == "New") & (~df["Assigned To"].isin(["Unknown", "Unassigned", ""]))
    report["new_tickets_unassigned_count"] = int(new_but_assigned_mask.sum())
    df.loc[df["State"] == "New", "Assigned To"] = "Unassigned"
    # A stale "Associate Assignment Date" carried the same problem one step
    # further: even after Assigned To above was cleared to "Unassigned", the
    # leftover assignment date made build_ticket_timeline() fabricate an
    # "In Progress / Assigned to an associate" milestone for a ticket the
    # dashboard elsewhere reports as unassigned. Clear it alongside Assigned
    # To so a New/unassigned ticket can't also read as In Progress.
    if "Associate Assignment Date" in df.columns:
        df.loc[df["State"] == "New", "Associate Assignment Date"] = pd.NaT

    now = pd.Timestamp(datetime.utcnow())

    # SLA Due Date is ALWAYS computed from the ticket's own Opened
    # (creation) date + its priority's SLA window - never trusted from
    # whatever an "SLA Due Date" column in the raw upload says, even when
    # one is present. A per-ticket due date that drifted from a different
    # anchor (e.g. last update, a reassignment) would make the "Overall SLA
    # breach count" inconsistent across tickets; anchoring strictly to
    # Opened is what "calculated from the ticket creation date" means and
    # keeps every ticket's due date on the same basis.
    report["missing_sla_due_count"] = int(df["SLA Due Date"].isna().sum())
    sla_hours = df["Priority"].map(PRIORITY_SLA_HOURS).fillna(240)
    df["SLA Due Date"] = df["Opened"] + pd.to_timedelta(sla_hours, unit="h")

    state_lower = df["State"].str.lower()
    df["is_resolved"] = state_lower == "resolved"
    df["is_closed"] = state_lower == "closed"
    df["is_cancelled"] = state_lower == "cancelled"
    df["is_done"] = state_lower.isin(DONE_STATES)
    df["is_open"] = ~df["is_done"]

    # The moment a ticket stopped being "active" - closed date if it exists,
    # otherwise resolved date, otherwise (still open) right now. Persisted as
    # its own column (not just a local var) since the New vs Resolved trend
    # chart needs to group tickets by when they were actually resolved.
    completion_date = df["Closed Date"].where(df["Closed Date"].notna(), df["Resolved Date"])
    df["Resolution Date"] = completion_date
    effective_check = completion_date.where(completion_date.notna(), now)

    df["Ticket Age (days)"] = (effective_check - df["Opened"]).dt.days.clip(lower=0)
    df["Ticket Age (days)"] = df["Ticket Age (days)"].fillna(0).astype(int)

    # SLA is not applicable to cancelled tickets - they were withdrawn, not missed.
    # "Breached" only ever applies to a ticket that is STILL UNRESOLVED - a
    # ticket that was eventually resolved/closed (even late) is not shown as
    # breached; it simply isn't compliant either (see sla_compliant below).
    # This baseline doesn't yet know which tickets are routed through a TCS
    # queue - that gating is applied at query time in recompute_sla_and_risk,
    # once the uploaded queue-history data is available; this is the
    # fallback used only when that overlay hasn't run (e.g. direct tests).
    df["sla_applicable"] = ~df["is_cancelled"]
    df["sla_breached"] = df["sla_applicable"] & df["is_open"] & df["SLA Due Date"].notna() & (now > df["SLA Due Date"])
    df["sla_compliant"] = df["sla_applicable"] & ~df["sla_breached"]

    df["hours_to_sla"] = (df["SLA Due Date"] - now).dt.total_seconds() / 3600.0
    df["sla_at_risk"] = df["is_open"] & (~df["sla_breached"]) & df["hours_to_sla"].between(0, 24)
    df["At Risk"] = np.where(df["sla_at_risk"], "Yes", "No")

    # Human-readable SLA state label, mainly for global search ("SLA breached",
    # "at risk", etc. as free-text search terms) and for showing SLA state in
    # search results without the client having to re-derive it from booleans.
    df["SLA State"] = np.select(
        [df["sla_breached"], df["sla_at_risk"], df["sla_compliant"]],
        ["Breached", "At Risk", "Compliant"],
        default="N/A",
    )

    df["priority_weight"] = df["Priority"].str.lower().map(PRIORITY_WEIGHT).fillna(1)
    age_score = (df["Ticket Age (days)"].fillna(0) / (df["Ticket Age (days)"].max() or 1)) * 40
    breach_score = df["sla_breached"].astype(int) * 40
    risk_score = (df["priority_weight"] / 4 * 20) + age_score + breach_score
    df["risk_score"] = risk_score.clip(0, 100).round(1)

    report["missing_columns"] = sorted(set(report["missing_columns"]))
    report["row_count"] = len(df)
    return df, report


def save_dataset(df: pd.DataFrame) -> str:
    dataset_id = str(uuid.uuid4())
    df.to_parquet(dataset_path(dataset_id))
    return dataset_id


def load_dataset(dataset_id: str) -> Optional[pd.DataFrame]:
    path = dataset_path(dataset_id)
    if not os.path.exists(path):
        return None
    return pd.read_parquet(path)


def load_datasets(dataset_ids: list) -> Optional[pd.DataFrame]:
    """Combines multiple uploaded files into one dataframe for a single
    analysis pass. Rows keep a Source Dataset column so it's possible to tell
    which upload a ticket came from - useful since ticket Numbers aren't
    guaranteed unique across separate files."""
    frames = []
    for did in dataset_ids:
        df = load_dataset(did)
        if df is not None:
            df = df.copy()
            df["Source Dataset"] = did
            frames.append(df)
    if not frames:
        return None
    return pd.concat(frames, ignore_index=True)


FILTER_COLUMN_MAP = {
    "status": "State", "priority": "Priority", "module": "Category",
    "customer": "Company", "application": "Business Service", "assignee": "Assigned To",
}


# KPI/chart "drill-down" views that aren't a plain column match - each is a
# boolean mask already computed in clean_dataframe. Used by the `view` filter
# so a KPI card or chart segment can deep-link straight to the matching
# ticket list (e.g. clicking "SLA Non-Compliant" -> view=sla_breach).
VIEW_MASKS = {
    "open": "is_open",
    "resolved": "is_resolved",
    "closed": "is_closed",
    "cancelled": "is_cancelled",
    "backlog": "is_backlog",  # currently-open, genuine-incident tickets = the backlog (User Requests excluded)
    "sla_compliant": "sla_compliant",
    "sla_breach": "sla_breached",
    "sla_non_compliant": "sla_breached",
    "sla_at_risk": "sla_at_risk",
    "solved": None,  # handled specially below (resolved OR closed)
}


def apply_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
    out = df.copy()
    for key, col in FILTER_COLUMN_MAP.items():
        values = filters.get(key)
        if values:
            out = out[out[col].isin(values)]
    date_from = filters.get("date_from")
    date_to = filters.get("date_to")
    if date_from:
        out = out[out["Opened"] >= pd.Timestamp(date_from)]
    if date_to:
        out = out[out["Opened"] <= pd.Timestamp(date_to)]

    view = filters.get("view")
    if view:
        if view == "solved":
            out = out[out["is_resolved"] | out["is_closed"]]
        else:
            mask_col = VIEW_MASKS.get(view)
            if mask_col:
                out = out[out[mask_col]]

    query = filters.get("q")
    if query and query.strip():
        out = apply_text_search(out, query)
    return out


def filter_tcs_only(df: pd.DataFrame, incident_tcs: Optional[dict] = None) -> pd.DataFrame:
    """Drops tickets CONFIRMED to be currently sitting in a Non-TCS queue
    (incident_tcs[number] is False), which is what the Executive Dashboard
    should show by default - SDMs manage the TCS side of the queue, so
    tickets that have moved on to an external/Non-TCS team aren't "our"
    data anymore.

    A ticket with no entry in incident_tcs (no queue-history uploaded for
    it, or its latest queue has no TCS/Non-TCS classification yet) is kept
    rather than dropped: we can't confirm it's Non-TCS, and most datasets
    won't have queue-history uploaded at all, so treating "unknown" the
    same as "confirmed Non-TCS" would empty the whole dashboard for anyone
    who hasn't uploaded that second file. Only a *positive* Non-TCS
    determination removes a ticket."""
    if len(df) == 0 or not incident_tcs:
        return df
    is_confirmed_non_tcs = df["Number"].map(incident_tcs) == False  # noqa: E712 (need False, not falsy/NaN)
    return df[~is_confirmed_non_tcs]


def apply_text_search(df: pd.DataFrame, query: str) -> pd.DataFrame:
    """Multi-keyword AND-across-terms/OR-across-fields text search, used both
    to filter the main ticket list (?q=...) and to power the global search
    dropdown's underlying match set."""
    terms = [t for t in query.strip().split() if t]
    if not terms:
        return df
    combined = pd.Series(True, index=df.index)
    for term in terms:
        if term.lower() in SEARCH_STOPWORDS:
            continue
        alias = SEARCH_TERM_ALIASES.get(term.lower())
        combined = combined & _term_mask(df, alias if alias else term)
    return df[combined]


def compute_kpis(df: pd.DataFrame) -> dict:
    total = len(df)
    resolved = int(df["is_resolved"].sum())
    closed = int(df["is_closed"].sum())
    cancelled = int(df["is_cancelled"].sum())
    open_ = int(df["is_open"].sum())
    sla_applicable = int(df["sla_applicable"].sum())
    sla_compliant = int(df["sla_compliant"].sum())
    sla_breached = int(df["sla_breached"].sum())
    sla_at_risk = int(df["sla_at_risk"].sum())
    avg_age = float(df["Ticket Age (days)"].mean()) if total else 0.0
    p1 = int((df["Priority"] == "P1").sum())

    # Customer Satisfaction Rating: a computed proxy, not a real survey score
    # (this dataset has no actual customer feedback in it). Full credit for
    # tickets solved (Resolved or Closed) within their SLA window, half credit
    # for tickets that were solved but missed SLA, against every ticket
    # assigned - a ticket that's still open or was cancelled earns no credit.
    solved_mask = df["is_resolved"] | df["is_closed"]
    solved_within_sla = int((solved_mask & df["sla_compliant"]).sum())
    solved_without_sla = int((solved_mask & df["sla_breached"]).sum())
    csat_pct = round((solved_within_sla + 0.5 * solved_without_sla) / total * 100, 1) if total else 0.0

    # Backlog = open AND a genuine incident. A ticket manually or
    # automatically classified as a User Request never counts toward
    # backlog, even while it's technically still "open" in the ITSM system.
    backlog_col = "is_backlog" if "is_backlog" in df.columns else "is_open"
    backlog_tickets = int(df[backlog_col].sum())
    user_request_tickets = int(df["Is User Request"].sum()) if "Is User Request" in df.columns else 0

    return {
        "total_tickets": total,
        "open_tickets": open_,
        "backlog_tickets": backlog_tickets,
        "user_request_tickets": user_request_tickets,
        "resolved_tickets": resolved,
        "closed_tickets": closed,
        "cancelled_tickets": cancelled,
        "sla_compliant": sla_compliant,
        "sla_breached": sla_breached,
        "sla_at_risk": sla_at_risk,
        "sla_compliance_pct": round(sla_compliant / sla_applicable * 100, 1) if sla_applicable else 0.0,
        "sla_breach_pct": round(sla_breached / sla_applicable * 100, 1) if sla_applicable else 0.0,
        "avg_ticket_age_days": round(avg_age, 1),
        "p1_tickets": p1,
        "solved_within_sla": solved_within_sla,
        "solved_without_sla": solved_without_sla,
        "csat_pct": csat_pct,
    }


# ---------------------------------------------------------------------------
# "User Request in disguise of Incident" detection.
#
# Many SAP ITSM tickets get logged as Incidents even though they're really a
# service/access/data/how-to request - nothing is actually broken. Detecting
# these lets an SDM discard them from the true incident count instead of
# counting them against team performance. This is a rule-based first pass
# (checked in order, first match wins) built directly from the phrase
# patterns that show up in these tickets; associates can correct any
# individual call from the "User Requests" review list.
# ---------------------------------------------------------------------------
USER_REQUEST_RULES = [
    # --- Access / authorization ---
    ("please help me get access", "Access / Authorization Request"),
    ("unable to access", "Access / Authorization Request"),
    ("please give access", "Access / Authorization Request"),
    ("please give me access", "Access / Authorization Request"),
    ("access request", "Access / Authorization Request"),
    ("user locked out", "Access / Authorization Request"),
    ("locked out of", "Access / Authorization Request"),
    ("please create sap access", "User Onboarding / Access Request"),
    ("new employee has joined", "User Onboarding / Access Request"),
    ("please assign", "Access / Organizational Assignment"),
    # --- Role / permissions ---
    ("please add the required", "Role Modification Request"),
    ("role permissions", "Role Modification Request"),
    ("permissions incorrect", "Role Modification Request"),
    ("permission", "Role Modification Request"),
    # --- Master data / creation ---
    ("please extend", "Master Data / Creation Request"),
    ("material is not available", "Master Data / Creation Request"),
    ("please create", "Master Data / Creation Request"),
    ("please change", "Master Data Change Request"),
    # --- Data correction ---
    ("is incorrect", "Data Correction Request"),
    ("incorrect", "Data Correction Request"),
    ("please correct", "Data Correction Request"),
    ("please update", "Data Correction Request"),
    # --- Report / extraction ---
    ("report is not available", "Report / Data Extraction Request"),
    ("please extract", "Report / Data Extraction Request"),
    ("list of open", "Report / Data Extraction Request"),
    ("please provide", "Report / Data Extraction Request"),
    ("report not generated", "Report / Data Extraction Request"),
    ("report export", "Report / Data Extraction Request"),
    ("scheduled report", "Report / Data Extraction Request"),
    ("p&l report", "Report / Data Extraction Request"),
    ("var report", "Report / Data Extraction Request"),
    # --- Guidance / how-to ---
    ("unable to create", "User Guidance / Assistance Request"),
    ("please help me process", "User Guidance / Assistance Request"),
    ("please assist", "User Guidance / Assistance Request"),
    ("how can i", "How-To / Transaction Guidance"),
    ("how do i", "How-To / Transaction Guidance"),
    ("please guide", "How-To / Transaction Guidance"),
    # --- Service / change / config ---
    ("needs to run every", "Service / Change Request"),
    ("please schedule", "Service / Change Request"),
    ("please add a new approval", "Configuration Change Request"),
    ("please advise", "Business Process Clarification"),
    ("which sap transaction", "Business Process Clarification"),
]


def classify_ticket_type(short_description: str) -> Optional[str]:
    """Returns the suggested user-request category if the description matches
    a known user-request phrasing pattern, otherwise None (treated as a
    genuine incident)."""
    if not short_description or not isinstance(short_description, str):
        return None
    desc = short_description.lower()
    for phrase, category in USER_REQUEST_RULES:
        if phrase in desc:
            return category
    return None


def _user_request_mask(df: pd.DataFrame) -> pd.Series:
    """Single source of truth for "is this ticket a User Request" - used by
    the User Requests page, its summary KPIs, and the dashboard's
    user-request-vs-incident chart. MUST read the same "Is User Request"
    column that backlog/KPI math reads (built by apply_ticket_classifications,
    which folds in manual SDM overrides on top of the rule-based guess) -
    recomputing the rule-based guess here directly, like this used to do,
    is what caused a manual reclassification to change backlog counts but
    NOT the flagged-tickets numbers elsewhere: two different code paths
    disagreeing about the same ticket's type. If classifications haven't
    been merged onto this dataframe yet (caller forgot to), fall back to the
    rule-based guess so this doesn't hard-crash - but every caller in
    dashboard.py is expected to have called apply_ticket_classifications
    first."""
    if len(df) == 0:
        return pd.Series([], dtype=bool)
    if "Is User Request" in df.columns:
        return df["Is User Request"]
    categories = df["Short Description"].map(classify_ticket_type)
    return categories.notna()


# ---------------------------------------------------------------------------
# Manual ticket classification (User Request vs true Incident).
#
# `classify_ticket_type` above is a rule-based first guess. An SDM/associate
# can override that guess per ticket via the /tickets/{number}/classify
# endpoint - the override always wins. "Effective Type" is what every other
# computation (backlog, KPIs, charts) should read: it's the override where
# one exists, otherwise the rule-based guess, otherwise "incident" by
# default (a ticket with no matching phrase pattern is treated as a genuine
# incident unless someone says otherwise).
# ---------------------------------------------------------------------------

def apply_ticket_classifications(df: pd.DataFrame, overrides: Optional[dict] = None) -> pd.DataFrame:
    """`overrides` maps ticket Number -> "incident" | "user_request" (manual
    SDM decisions, loaded from the ticket_classifications table). Adds:
      - Suggested Type: the rule-based guess (category string, or None)
      - Effective Type: "incident" or "user_request" after overrides
      - Is User Request: bool, True when Effective Type == "user_request"
      - Manually Classified: bool, True when an override exists for the row
    Every ticket ends up with an Effective Type - this is what backlog and
    KPI math should filter on, not the raw Suggested Type guess."""
    df = df.copy()
    if len(df) == 0:
        df["Suggested Type"] = pd.Series([], dtype=object)
        df["Effective Type"] = pd.Series([], dtype=object)
        df["Is User Request"] = pd.Series([], dtype=bool)
        df["Manually Classified"] = pd.Series([], dtype=bool)
        return df

    suggested = df["Short Description"].map(classify_ticket_type)
    df["Suggested Type"] = suggested
    rule_based = np.where(suggested.notna(), "user_request", "incident")

    overrides = overrides or {}
    override_series = df["Number"].map(overrides)
    df["Manually Classified"] = override_series.notna()
    effective = override_series.where(override_series.notna(), rule_based)
    df["Effective Type"] = effective
    df["Is User Request"] = df["Effective Type"] == "user_request"
    # Backlog = currently open AND a genuine incident. A ticket classified as
    # a User Request never counts toward backlog, even while it's still open.
    if "is_open" in df.columns:
        df["is_backlog"] = df["is_open"] & (~df["Is User Request"])
    return df


# ---------------------------------------------------------------------------
# SLA breach re-gating (query-time overlay, applied via
# routers/ticket_classification.py:apply_all_overlays on every read - "this
# rule should be applicable everywhere").
#
# Two corrections on top of clean_dataframe's baseline sla_breached:
#   1. Freshness: clean_dataframe computes sla_breached once, at upload
#      time, using "now" as of that moment. A ticket uploaded as
#      not-yet-breached stays "not breached" forever afterwards unless the
#      file is re-uploaded, even as real time passes its due date. This
#      recomputes against the CURRENT time on every read.
#   2. TCS-queue gating: "Breached" only ever applies to a ticket that is
#      BOTH still unresolved AND currently sitting in a TCS-owned queue
#      (ABAP/FI/SD/MM). A ticket that's overdue but currently parked in a
#      non-TCS/external queue (L1/L2/L3), or whose queue routing isn't
#      known at all, is never shown as breached - only TCS queues are held
#      to the formal SLA commitment this dashboard tracks.
# ---------------------------------------------------------------------------

def recompute_sla_and_risk(df: pd.DataFrame, latest_queue_is_tcs: Optional[dict] = None) -> pd.DataFrame:
    """`latest_queue_is_tcs` maps ticket Number -> True/False/None, built
    from each ticket's MOST RECENT queue-history event (None = no history
    uploaded, or the queue has no TCS/Non-TCS classification yet - treated
    as NOT a TCS queue, so an unclassified ticket never shows as breached
    by default rather than risking a false positive)."""
    df = df.copy()
    if len(df) == 0:
        return df

    latest_queue_is_tcs = latest_queue_is_tcs or {}
    is_tcs_queue = df["Number"].map(latest_queue_is_tcs).fillna(False).astype(bool)
    df["Is TCS Queue"] = is_tcs_queue

    now = pd.Timestamp(datetime.utcnow())
    # Age needs to stay fresh for open tickets (time keeps passing) but stay
    # fixed for closed/resolved ones (age when it was actually resolved,
    # already correct and shouldn't drift with "now").
    fresh_age_for_open = (now - df["Opened"]).dt.days.clip(lower=0)
    df["Ticket Age (days)"] = df["Ticket Age (days)"].where(~df["is_open"], fresh_age_for_open).fillna(0).astype(int)

    df["sla_breached"] = (
        df["sla_applicable"] & df["is_open"] & is_tcs_queue
        & df["SLA Due Date"].notna() & (now > df["SLA Due Date"])
    )
    df["sla_compliant"] = df["sla_applicable"] & ~df["sla_breached"]

    df["hours_to_sla"] = (df["SLA Due Date"] - now).dt.total_seconds() / 3600.0
    df["sla_at_risk"] = df["is_open"] & (~df["sla_breached"]) & df["hours_to_sla"].between(0, 24)
    df["At Risk"] = np.where(df["sla_at_risk"], "Yes", "No")

    df["SLA State"] = np.select(
        [df["sla_breached"], df["sla_at_risk"], df["sla_compliant"]],
        ["Breached", "At Risk", "Compliant"],
        default="N/A",
    )

    age_denominator = df["Ticket Age (days)"].max() or 1
    age_score = (df["Ticket Age (days)"].fillna(0) / age_denominator) * 40
    breach_score = df["sla_breached"].astype(int) * 40
    risk_score = (df["priority_weight"] / 4 * 20) + age_score + breach_score
    df["risk_score"] = risk_score.clip(0, 100).round(1)

    return df


def find_similar_tickets_for_classification(
    df: pd.DataFrame, incident_number: str, already_classified: Optional[set] = None, limit: int = 200
) -> dict:
    """After a person manually classifies one ticket, finds the other
    tickets that look like the same kind of thing, so the UI can ask
    "apply this to all N of these too?" instead of making them repeat the
    same call one ticket at a time.

    Matching is two-tiered: if the classified ticket's description hit one
    of the rule-based phrase patterns, every other unclassified ticket that
    hits the *same* pattern is a match (highest-confidence grouping). If it
    didn't match any rule, falls back to free-text similarity against that
    one ticket's Short Description."""
    already_classified = already_classified or set()
    row = df[df["Number"] == incident_number]
    if row.empty:
        return {"group_key": None, "candidates": []}

    desc = str(row.iloc[0].get("Short Description", ""))
    candidates_df = df[(df["Number"] != incident_number) & (~df["Number"].isin(already_classified))]

    category = classify_ticket_type(desc)
    if category:
        cat_series = candidates_df["Short Description"].map(classify_ticket_type)
        matches = candidates_df[cat_series == category]
        group_key = category
    else:
        def _similar(other_desc):
            return difflib.SequenceMatcher(None, desc.lower(), str(other_desc).lower()).ratio() >= 0.6
        matches = candidates_df[candidates_df["Short Description"].map(_similar)]
        group_key = "text-match"

    numbers = matches["Number"].astype(str).head(limit).tolist()
    return {"group_key": group_key, "candidates": numbers, "total_matches": int(len(matches))}


USER_REQUEST_DISPLAY_COLUMNS = DISPLAY_COLUMNS + ["Suggested Type"]


def get_user_request_tickets(df: pd.DataFrame, filters: Optional[dict] = None, limit: int = 5000) -> list:
    """Full rows for every ticket flagged as a possible user-request-in-
    disguise, for the review/drill-down list. Uses the same "Is User
    Request" column (rule-based guess + manual overrides merged) as
    everywhere else - previously this recomputed the rule-based guess from
    scratch and ignored manual overrides entirely, which is why marking a
    ticket Incident/User Request here didn't change the count shown on this
    same page."""
    out = apply_filters(df, filters or {})
    if len(out) == 0:
        return []
    mask = _user_request_mask(out)
    flagged = out[mask].copy()
    if "Suggested Type" not in flagged.columns:
        flagged["Suggested Type"] = flagged["Short Description"].map(classify_ticket_type)
    flagged = flagged.sort_values("Opened", ascending=False).head(limit)

    rows = []
    for _, r in flagged.iterrows():
        row = {}
        for col in USER_REQUEST_DISPLAY_COLUMNS:
            if col in DATE_COLUMNS:
                val = r.get(col)
                row[col] = val.strftime("%Y-%m-%d %H:%M") if pd.notna(val) else ""
            else:
                row[col] = r.get(col, "")
        rows.append(row)
    return rows


def compute_frequent_requesters(df: pd.DataFrame, filters: Optional[dict] = None, top: Optional[int] = None) -> dict:
    """Requesters (by Main Contact Name) who most often raise tickets that
    get flagged as user-request-in-disguise, with what share of all flagged
    tickets each of them accounts for."""
    out = apply_filters(df, filters or {})
    mask = _user_request_mask(out)
    flagged = out[mask]
    total_flagged = int(len(flagged))
    if total_flagged == 0:
        return {"total_flagged": 0, "requesters": []}
    counts = flagged["Main Contact Name"].value_counts()
    if top:
        counts = counts.head(top)
    requesters = [
        {"name": str(name), "count": int(cnt), "percent": round(cnt / total_flagged * 100, 1)}
        for name, cnt in counts.items()
    ]
    return {"total_flagged": total_flagged, "requesters": requesters}


def compute_user_request_summary(df: pd.DataFrame) -> dict:
    """Headline numbers for the User Requests (Incidents) view: how many of
    all incidents look like a mislabeled service/access/data request."""
    total = int(len(df))
    flagged = int(_user_request_mask(df).sum())
    return {
        "total_incidents": total,
        "flagged_count": flagged,
        "genuine_count": total - flagged,
        "flagged_pct": round(flagged / total * 100, 1) if total else 0.0,
    }


def _counts(df: pd.DataFrame, col: str, top: Optional[int] = None) -> list:
    vc = df[col].value_counts()
    if top:
        vc = vc.head(top)
    return [{"name": str(k), "value": int(v)} for k, v in vc.items()]


def compute_charts(df: pd.DataFrame) -> dict:
    charts = {
        "status_distribution": _counts(df, "State"),
        "priority_distribution": _counts(df, "Priority"),
        "module_distribution": _counts(df, "Category"),
        "top_modules": _counts(df, "Category", top=8),
        "pending_reasons": _counts(df[df["Pending Reason"] != "Unknown"], "Pending Reason", top=8),
        "assignee_workload": _counts(df, "Assigned To", top=10),
        "customer_tickets": _counts(df, "Company", top=10),
        "application_tickets": _counts(df, "Business Service", top=10),
    }

    # Aging buckets
    bins = [-1, 2, 5, 10, 20, 10_000]
    labels = ["0-2d", "3-5d", "6-10d", "11-20d", "20d+"]
    aging = pd.cut(df["Ticket Age (days)"].fillna(0), bins=bins, labels=labels).value_counts()
    charts["aging_distribution"] = [{"name": str(k), "value": int(v)} for k, v in aging.reindex(labels).items()]

    # SLA risk (operational lens: breached / at-risk / healthy right now)
    charts["sla_risk"] = [
        {"name": "Breached", "value": int(df["sla_breached"].sum())},
        {"name": "At Risk", "value": int(df["sla_at_risk"].sum())},
        {"name": "Healthy", "value": int(len(df) - df["sla_breached"].sum() - df["sla_at_risk"].sum())},
    ]

    # SLA compliance (outcome lens: of tickets SLA applies to, compliant vs not)
    charts["sla_compliance"] = [
        {"name": "Compliant", "value": int(df["sla_compliant"].sum())},
        {"name": "Non-Compliant", "value": int(df["sla_breached"].sum())},
    ]

    # Closed vs Resolved - explicitly separate, since they mean different things
    charts["closed_vs_resolved"] = [
        {"name": "Resolved", "value": int(df["is_resolved"].sum())},
        {"name": "Closed", "value": int(df["is_closed"].sum())},
    ]

    # User Request (Incidents) / Total Incidents - how many "incidents" are
    # really a mislabeled service/access/data/how-to request. Drives the
    # drill-down list + frequent-requester insights on the User Requests page.
    ur_summary = compute_user_request_summary(df)
    charts["user_request_vs_incident"] = [
        {"name": "Genuine Incidents", "value": ur_summary["genuine_count"]},
        {"name": "User Request (Disguised)", "value": ur_summary["flagged_count"]},
    ]

    # Trends (ticket volume opened per period). Daily is capped to the most
    # recent 30 days - an uncapped daily series can span 100+ points, which
    # overflows the chart's x-axis with unreadable, overlapping date labels.
    # Weekly/Monthly already cover the longer view.
    if df["Opened"].notna().any():
        daily = df.dropna(subset=["Opened"]).set_index("Opened").resample("D").size().tail(30)
        weekly = df.dropna(subset=["Opened"]).set_index("Opened").resample("W").size().tail(26)
        monthly = df.dropna(subset=["Opened"]).set_index("Opened").resample("ME").size()
        charts["daily_trend"] = [{"name": d.strftime("%b %d"), "value": int(v)} for d, v in daily.items()]
        charts["weekly_trend"] = [{"name": d.strftime("%b %d"), "value": int(v)} for d, v in weekly.items()]
        charts["monthly_trend"] = [{"name": d.strftime("%b %Y"), "value": int(v)} for d, v in monthly.items()]
    else:
        charts["daily_trend"] = charts["weekly_trend"] = charts["monthly_trend"] = []

    # Total ticket backlog per month: of tickets still open today (and not a
    # User Request in disguise), which month were they opened in? Shows where
    # the true-incident backlog is actually accumulating.
    backlog_col = "is_backlog" if "is_backlog" in df.columns else "is_open"
    backlog_df = df[df[backlog_col]].dropna(subset=["Opened"])
    if len(backlog_df):
        monthly_backlog = backlog_df.set_index("Opened").resample("ME").size()
        charts["monthly_backlog"] = [
            {"name": d.strftime("%b %Y"), "value": int(v)} for d, v in monthly_backlog.items()
        ]
    else:
        charts["monthly_backlog"] = []

    return charts


PRIORITY_ORDER = ["P1", "P2", "P3", "P4"]


def compute_new_vs_resolved_trend(df: pd.DataFrame, days: int = 14) -> list:
    """Daily count of tickets opened vs tickets resolved (Closed Date, or
    Resolved Date if never formally closed) - the two-line 'Ticket Trend'
    chart on the consolidated dashboard. Both series share one date axis
    covering the most recent `days`, even if a given day has only one side.

    The window is anchored to the latest *Opened* date rather than the union
    of both series' dates. Resolution timestamps can (and routinely do) fall
    later than the most recent ticket intake, since older tickets keep
    getting resolved after new-ticket volume has tapered off. Anchoring on
    the union's tail let those trailing resolutions push the whole window
    past the last day any ticket was actually opened, which made the "New
    Tickets" line render as a flat zero even though open activity existed
    just outside that pushed-out window.
    """
    opened = df.dropna(subset=["Opened"]).set_index("Opened").resample("D").size()
    resolved = df.dropna(subset=["Resolution Date"]).set_index("Resolution Date").resample("D").size()
    if opened.empty and resolved.empty:
        return []
    end = opened.index.max() if not opened.empty else resolved.index.max()
    idx = pd.date_range(end=end, periods=days, freq="D")
    opened = opened.reindex(idx, fill_value=0)
    resolved = resolved.reindex(idx, fill_value=0)
    return [
        {"name": d.strftime("%b %d"), "opened": int(o), "resolved": int(r)}
        for d, o, r in zip(idx, opened, resolved)
    ]


def compute_sla_trend(df: pd.DataFrame, weeks: int = 8) -> list:
    """Weekly SLA compliance %, cohorted by the week a ticket was opened -
    same definition as the headline SLA Compliance KPI, just tracked over
    time instead of as a single snapshot."""
    applicable = df[df["sla_applicable"]].dropna(subset=["Opened"])
    if applicable.empty:
        return []
    grouped = applicable.set_index("Opened").resample("W")
    out = []
    for week_end, group in list(grouped)[-weeks:]:
        if group.empty:
            continue
        pct = round(group["sla_compliant"].sum() / len(group) * 100, 1)
        out.append({"name": week_end.strftime("%b %d"), "value": float(pct)})
    return out


def compute_backlog_by_priority(df: pd.DataFrame) -> list:
    """Currently-open, genuine-incident tickets by priority (User Requests
    excluded) - feeds the Backlog Overview priority-mix bar on the
    consolidated dashboard. Always reports all four priorities (zero-filled)
    so the mix bar has a consistent legend."""
    backlog_col = "is_backlog" if "is_backlog" in df.columns else "is_open"
    open_df = df[df[backlog_col]]
    counts = open_df["Priority"].value_counts()
    return [{"name": p, "value": int(counts.get(p, 0))} for p in PRIORITY_ORDER]


def get_recent_priority_tickets(df: pd.DataFrame, priority: str = "P1", limit: int = 5) -> list:
    """Most recently opened tickets at a given priority - feeds the 'Recent
    P1 Tickets' panel. Returns the same compact shape as global search
    results so the frontend can reuse one row renderer."""
    subset = df[df["Priority"] == priority].dropna(subset=["Opened"]).sort_values("Opened", ascending=False).head(limit)
    return [
        {
            "number": r.get("Number", ""),
            "short_description": r.get("Short Description", ""),
            "priority": r.get("Priority", ""),
            "status": r.get("State", ""),
            "opened": r["Opened"].isoformat() if pd.notna(r.get("Opened")) else None,
            "assigned_to": r.get("Assigned To", ""),
        }
        for _, r in subset.iterrows()
    ]


def apply_backlog_associate(df: pd.DataFrame, latest_queue_associate: Optional[dict] = None) -> pd.DataFrame:
    """Adds a "Backlog Associate" column: the person actually holding a
    ticket in its current queue, per the uploaded queue-history data, when
    that's known - falling back to the main ITSM dump's "Assigned To" only
    when no queue-history event exists for that ticket.

    This matters because "Assigned To" is a single flat field on the main
    ticket dump and, in practice, reflects TCS-side ownership - a ticket
    that has moved on to (or stayed in) a non-TCS/external queue should
    show up on the Backlog page under whoever is actually holding it in
    that non-TCS queue (a name from the separate, non-overlapping non-TCS
    associate pool - see generate_sample_queue_files.py), not silently
    re-attributed to its original TCS assignee."""
    df = df.copy()
    if len(df) == 0:
        df["Backlog Associate"] = pd.Series([], dtype=object)
        return df
    latest_queue_associate = latest_queue_associate or {}
    from_history = df["Number"].map(latest_queue_associate)
    df["Backlog Associate"] = from_history.where(from_history.notna(), df["Assigned To"])
    return df


def compute_backlog_by_associate(df: pd.DataFrame) -> list:
    """Currently-open, genuine-incident tickets per associate (User Requests
    excluded), bucketed by ticket age. This is the dataset behind the Ticket
    Backlog page and answers 'who is sitting on what'. Groups by "Backlog
    Associate" (queue-history-aware - see apply_backlog_associate) when
    available, falling back to the flat "Assigned To" field for datasets
    with no queue-history overlay applied (e.g. direct tests)."""
    backlog_col = "is_backlog" if "is_backlog" in df.columns else "is_open"
    open_df = df[df[backlog_col]]
    if open_df.empty:
        return []

    assoc_col = "Backlog Associate" if "Backlog Associate" in open_df.columns else "Assigned To"
    bins = [-1, 30, 60, 90, 100_000]
    labels = ["0_30", "31_60", "61_90", "90_plus"]
    bucketed = pd.cut(open_df["Ticket Age (days)"], bins=bins, labels=labels)

    grouped = open_df.groupby([open_df[assoc_col], bucketed], observed=False).size().unstack(fill_value=0)
    grouped = grouped.reindex(columns=labels, fill_value=0)
    grouped["total"] = grouped.sum(axis=1)
    grouped = grouped.sort_values("total", ascending=False)

    return [
        {
            "assignee": assignee,
            "bucket_0_30": int(row["0_30"]),
            "bucket_31_60": int(row["31_60"]),
            "bucket_61_90": int(row["61_90"]),
            "bucket_90_plus": int(row["90_plus"]),
            "total": int(row["total"]),
        }
        for assignee, row in grouped.iterrows()
    ]


def get_ticket_rows(df: pd.DataFrame, filters: Optional[dict] = None, limit: int = 2000) -> list:
    """Full ticket rows for the drill-down table, formatted for display."""
    out = apply_filters(df, filters or {})
    out = out.sort_values("Opened", ascending=False).head(limit)

    rows = []
    for _, r in out.iterrows():
        row = {}
        for col in DISPLAY_COLUMNS:
            if col in DATE_COLUMNS:
                val = r.get(col)
                row[col] = val.strftime("%Y-%m-%d %H:%M") if pd.notna(val) else ""
            else:
                row[col] = r.get(col, "")
        rows.append(row)
    return rows


def get_ticket_detail_fields(row: pd.Series) -> dict:
    """Every field the dedicated ticket-detail page shows for one ticket's
    "Properties" panel - a superset of DISPLAY_COLUMNS (adds the free-text
    and SLA fields that table view leaves out for space)."""
    fields = DISPLAY_COLUMNS + ["Short Description", "Pending Reason", "SLA Due Date",
                                 "Resolved Date", "Closed Date", "SLA State", "Ticket Age (days)"]
    out = {}
    for col in dict.fromkeys(fields):  # de-dupe, preserve order
        val = row.get(col)
        if col in DATE_COLUMNS or col == "Resolution Date":
            out[col] = val.strftime("%Y-%m-%d %H:%M") if pd.notna(val) else None
        elif isinstance(val, (np.integer,)):
            out[col] = int(val)
        elif isinstance(val, (np.floating,)):
            out[col] = None if pd.isna(val) else float(val)
        elif isinstance(val, (np.bool_, bool)):
            out[col] = bool(val)
        elif isinstance(val, str):
            out[col] = val
        else:
            out[col] = None if pd.isna(val) else val
    return out


def compute_effective_state(row: pd.Series) -> dict:
    """The ticket's true current state, applying the auto-close rule that a
    static "State" column from an export can't reflect on its own: an
    incident sitting at Resolved for 5+ days with no Closed Date is
    auto-closed by policy, so the dashboard should show it as Closed even
    though the raw upload still says Resolved. Returns the raw state
    alongside the effective one so the UI can label an auto-close as such
    rather than pretending the source data said "Closed" outright."""
    state = row.get("State")
    resolved_date = row.get("Resolved Date")
    closed_date = row.get("Closed Date")
    now = pd.Timestamp(datetime.utcnow())

    auto_closed = False
    auto_close_at = None
    effective_state = state
    if state == "Resolved" and pd.notna(resolved_date) and pd.isna(closed_date):
        auto_close_at = resolved_date + pd.Timedelta(days=5)
        if now >= auto_close_at:
            effective_state = "Closed"
            auto_closed = True

    return {
        "raw_state": state,
        "effective_state": effective_state,
        "auto_closed": auto_closed,
        "auto_close_at": auto_close_at.isoformat() if auto_close_at is not None else None,
    }


def build_ticket_timeline(row: pd.Series, history_events: Optional[list] = None) -> list:
    """Merges the main dump's own lifecycle milestones (Opened / Assigned /
    Resolved / Closed, plus an auto-close if applicable) with the
    separately-uploaded queue-movement log into ONE chronologically sorted
    timeline for the ticket-detail page and the Tickets-page history
    dropdown.

    This is what keeps a Closed ticket from ever appearing to still be "In
    Progress": the queue-history log is uploaded independently of the main
    ITSM dump and can lag behind it, so its own last row is not trustworthy
    as "the current status" on its own. Milestones derived straight from the
    main dump's Resolved Date/Closed Date always take their rightful place
    at the end of the sorted timeline instead."""
    history_events = history_events or []
    events = []

    opened = row.get("Opened")
    if pd.notna(opened):
        events.append({
            "timestamp": opened, "state": "New", "label": "Incident created",
            "detail": f"Raised by {row.get('Name') or 'Unknown'}" + (
                f" - assigned to {row.get('Assignment Group')}" if row.get("Assignment Group") not in (None, "", "Unknown") else ""
            ),
            "source": "milestone",
        })

    assign_date = row.get("Associate Assignment Date")
    assigned_to = row.get("Assigned To")
    is_actually_assigned = assigned_to not in (None, "", "Unknown", "Unassigned")
    # Only surface an "In Progress" assignment milestone when there is a real
    # assignee. An assignment date with no assignee (e.g. a stale date left
    # over from before the ticket was reset to New/Unassigned) must never be
    # rendered as "Assigned to an associate" - that is what previously let a
    # ticket show as Unassigned and In Progress at the same time.
    if pd.notna(assign_date) and is_actually_assigned:
        events.append({
            "timestamp": assign_date, "state": "In Progress",
            "label": f"Assigned to {assigned_to}",
            "detail": None, "source": "milestone",
        })

    for e in history_events:
        ts = e.get("timestamp")
        if not ts:
            continue
        ts = pd.Timestamp(ts)
        label = f"Moved to {e.get('queue')}" if e.get("queue") else "Queue update"
        events.append({
            "timestamp": ts,
            "state": e.get("status"),
            "label": label,
            "detail": ", ".join(filter(None, [
                f"Associate: {e['assigned_associate']}" if e.get("assigned_associate") else None,
                f"Time spent: {e['time_spent']}" if e.get("time_spent") else None,
                f'Comment: "{e["comment"]}"' if e.get("comment") else None,
            ])) or None,
            "source": "queue-event",
            "is_tcs_team": e.get("is_tcs_team"),
            "sentiment": e.get("sentiment"),
            "sentiment_score": e.get("sentiment_score"),
        })

    resolved_date = row.get("Resolved Date")
    if pd.notna(resolved_date):
        events.append({
            "timestamp": resolved_date, "state": "Resolved", "label": "Marked Resolved",
            "detail": None, "source": "milestone",
        })

    closed_date = row.get("Closed Date")
    effective = compute_effective_state(row)
    if pd.notna(closed_date):
        events.append({
            "timestamp": closed_date, "state": "Closed", "label": "Closed",
            "detail": None, "source": "milestone",
        })
    elif effective["auto_closed"]:
        auto_close_at = pd.Timestamp(effective["auto_close_at"])
        # Only trust the auto-close if nothing in the real queue-history log
        # happened after that point - a later event (e.g. a reopen) means
        # the ticket didn't just sit untouched, so the synthetic milestone
        # would be misleading rather than helpful.
        later_real_event = any(
            e.get("timestamp") and pd.Timestamp(e["timestamp"]) > auto_close_at for e in history_events
        )
        if not later_real_event:
            events.append({
                "timestamp": auto_close_at, "state": "Closed",
                "label": "Auto-closed (5 days after resolution)",
                "detail": "No further activity was recorded after resolution, so this incident was "
                          "automatically closed per policy.",
                "source": "auto-close",
            })

    events.sort(key=lambda e: e["timestamp"])
    for e in events:
        e["timestamp"] = e["timestamp"].isoformat()
    return events


def get_filter_options(df: pd.DataFrame) -> dict:
    return {
        "status": sorted(df["State"].unique().tolist()),
        "priority": sorted(df["Priority"].unique().tolist()),
        "module": sorted(df["Category"].unique().tolist()),
        "customer": sorted(df["Company"].unique().tolist()),
        "application": sorted(df["Business Service"].unique().tolist()),
        "assignee": sorted(df["Assigned To"].unique().tolist()),
    }


# Columns checked by global search, in priority order (used both for the
# substring pass and to report which field(s) a hit matched on).
SEARCH_COLUMNS = [
    "Number", "Short Description", "Category", "Priority", "State", "SLA State",
    "Assigned To", "Assignment Group", "Company", "Business Service", "Name",
    "Country", "Main Contact Name", "Manager", "Location", "Pending Reason",
    "Type", "At Risk",
]

# A few natural-language aliases people type that don't literally appear in
# any column value, mapped onto the value(s) they mean - lets a term like
# "breached" or "p1" line up with "Breached" / "P1" even with the label
# formatted differently, and lets multi-word SLA phrasing ("sla breached")
# resolve via its two individual terms.
SEARCH_TERM_ALIASES = {
    "breach": "Breached", "breached": "Breached", "atrisk": "At Risk",
    "compliant": "Compliant", "healthy": "Compliant",
}

# Words that qualify a search ("SLA breached", "P1 ticket") but don't
# literally appear in any field value themselves - skipped rather than
# treated as a term that has to match, so they don't zero out results.
SEARCH_STOPWORDS = {"sla", "ticket", "tickets", "incident", "incidents"}


def _term_mask(df: pd.DataFrame, term: str) -> pd.Series:
    """Rows where `term` appears (case-insensitive substring) in any search
    column. Falls back to a fuzzy close-match per column when nothing
    substring-matches, so small typos (e.g. "gatway") still find results."""
    term_lower = term.lower()
    mask = pd.Series(False, index=df.index)
    for col in SEARCH_COLUMNS:
        if col not in df.columns:
            continue
        mask = mask | df[col].astype(str).str.lower().str.contains(term_lower, regex=False, na=False)
    if mask.any():
        return mask

    # Fuzzy fallback: compare the term against both full cell values and the
    # individual words within them (so a typo like "Northbrige" still finds
    # "Northbridge Capital"), and accept close matches (typo-tolerant).
    for col in SEARCH_COLUMNS:
        if col not in df.columns:
            continue
        col_values = df[col].astype(str)
        vocab = set(col_values.unique().tolist())
        for v in list(vocab):
            vocab.update(v.split())
        close = difflib.get_close_matches(term, vocab, n=5, cutoff=0.75)
        if close:
            pattern = "|".join(re.escape(c) for c in close)
            mask = mask | col_values.str.contains(pattern, case=False, regex=True, na=False)
    return mask


def search_tickets(df: pd.DataFrame, query: str, limit: int = 25) -> list:
    """Multi-keyword search: every term must match (AND across terms, OR
    across fields per term), so 'database P1' finds tickets that mention
    'database' somewhere AND are Priority P1, not just either one."""
    terms = [t for t in query.strip().split() if t]
    if not terms:
        return []

    combined = pd.Series(True, index=df.index)
    for term in terms:
        if term.lower() in SEARCH_STOPWORDS:
            continue
        alias = SEARCH_TERM_ALIASES.get(term.lower())
        search_term = alias if alias else term
        term_mask = _term_mask(df, search_term)
        combined = combined & term_mask

    matches = df[combined]
    if matches.empty:
        return []

    matches = matches.head(limit)
    term_lowers = [SEARCH_TERM_ALIASES.get(t.lower(), t).lower() for t in terms]

    results = []
    for _, r in matches.iterrows():
        matched_fields = []
        for col in SEARCH_COLUMNS:
            if col not in matches.columns:
                continue
            val = str(r.get(col, "")).lower()
            if any(tl in val for tl in term_lowers):
                matched_fields.append(col)
        results.append({
            "number": r.get("Number", ""),
            "short_description": r.get("Short Description", ""),
            "priority": r.get("Priority", ""),
            "status": r.get("State", ""),
            "sla_state": r.get("SLA State", ""),
            "service": r.get("Business Service", ""),
            "assigned_to": r.get("Assigned To", ""),
            "company": r.get("Company", ""),
            "matched_fields": matched_fields[:4],
        })
    return results


def build_ai_context(df: pd.DataFrame, kpis: dict) -> str:
    oldest = df[df["is_open"]].sort_values("Ticket Age (days)", ascending=False).head(5)
    oldest_lines = [
        f"- {r['Number']} ({r['Priority']}, {r['Category']}): {int(r['Ticket Age (days)'])} days old, state {r['State']}, assigned to {r['Assigned To']}"
        for _, r in oldest.iterrows()
    ]
    workload = df[df["is_open"]]["Assigned To"].value_counts().head(5)
    workload_lines = [f"- {name}: {count} open tickets" for name, count in workload.items()]
    pending = df[df["Pending Reason"] != "Unknown"]["Pending Reason"].value_counts().head(5)
    pending_lines = [f"- {name}: {count} tickets" for name, count in pending.items()]

    context = f"""
KPI SUMMARY:
- Total tickets: {kpis['total_tickets']}
- Open: {kpis['open_tickets']} | Resolved: {kpis['resolved_tickets']} | Closed: {kpis['closed_tickets']}
- SLA compliance: {kpis['sla_compliance_pct']}% compliant, {kpis['sla_breach_pct']}% breached
- SLA at risk (due within 24h, not yet breached): {kpis['sla_at_risk']}
- Average ticket age: {kpis['avg_ticket_age_days']} days
- P1 (highest priority) tickets: {kpis['p1_tickets']}

OLDEST OPEN TICKETS:
{chr(10).join(oldest_lines) if oldest_lines else 'None'}

TOP ENGINEER OPEN WORKLOAD:
{chr(10).join(workload_lines) if workload_lines else 'None'}

TOP PENDING REASONS:
{chr(10).join(pending_lines) if pending_lines else 'None'}
""".strip()
    return context


# ---------------------------------------------------------------------------
# Ticket queue-movement history (the separate "Historical Data of tickets"
# upload: Incident Number, Queue, Timestamp, Status, Assigned Associate,
# Time Spent). Distinct from the main ITSM dump - this feeds the per-ticket
# history dropdown on the Tickets page, and later, TCS-only SLA recalculation.
# ---------------------------------------------------------------------------

HISTORY_COLUMN_ALIASES = {
    "incident number": "Incident Number", "incident": "Incident Number", "number": "Incident Number",
    "ticket": "Incident Number", "ticket number": "Incident Number", "incident no": "Incident Number",
    "queue": "Queue", "assigned queue": "Queue", "team": "Queue",
    "timestamp": "Timestamp", "time": "Timestamp", "date": "Timestamp",
    "status": "Status", "state": "Status",
    "assigned associate": "Assigned Associate", "assigned person": "Assigned Associate",
    "assignee": "Assigned Associate", "associate": "Assigned Associate",
    "time spent": "Time Spent", "timespent": "Time Spent", "duration": "Time Spent",
    "comment": "Comment", "comments": "Comment", "notes": "Comment", "note": "Comment",
    "work notes": "Comment", "customer comment": "Comment", "ticket comment": "Comment",
}

HISTORY_REQUIRED_COLUMNS = ["Incident Number", "Queue", "Timestamp", "Status", "Assigned Associate", "Time Spent"]
# Comment is optional (unlike the columns above, which are always present even
# if empty) - most queue-movement rows won't have one, and sentiment analysis
# only runs on rows that do.
HISTORY_OPTIONAL_COLUMNS = ["Comment"]

# Small hand-built lexicon rather than an external NLP dependency/model
# download - good enough to flag clearly positive/negative ticket comments
# ("customer is furious", "great job, thanks!") for an SDM to skim, without
# needing an AI provider configured just to upload a file.
_POSITIVE_WORDS = {
    "thanks", "thank", "great", "excellent", "resolved", "appreciate", "appreciated",
    "good", "quick", "fast", "helpful", "happy", "satisfied", "smooth", "perfect",
    "awesome", "pleased", "efficient", "professional", "wonderful", "impressed",
}
_NEGATIVE_WORDS = {
    "angry", "frustrated", "furious", "unacceptable", "delay", "delayed", "escalate",
    "escalated", "poor", "bad", "worst", "disappointed", "disappointing", "complaint",
    "complaining", "unhappy", "annoyed", "urgent", "critical", "failed", "failing",
    "ignored", "waiting", "slow", "rude", "useless", "broken", "again",
}
_NEGATIONS = {"not", "no", "never", "n't", "without"}


def analyze_sentiment(text: Optional[str]) -> tuple:
    """Lightweight lexicon-based sentiment scorer for a ticket comment/note.
    Returns (label, score) where label is Positive/Neutral/Negative and score
    is -1.0..+1.0. Not a substitute for a real NLP model, but good enough to
    flag clearly positive/negative comments for an SDM without requiring an
    AI provider to be configured just to upload a file. A word immediately
    preceded by a negation ("not happy") flips its polarity."""
    if not text or not str(text).strip() or str(text).strip().lower() in ("nan", "none"):
        return None, None
    words = re.findall(r"[a-z']+", str(text).lower())
    if not words:
        return "Neutral", 0.0
    score = 0
    for i, w in enumerate(words):
        polarity = 1 if w in _POSITIVE_WORDS else (-1 if w in _NEGATIVE_WORDS else 0)
        if polarity == 0:
            continue
        if i > 0 and words[i - 1] in _NEGATIONS:
            polarity = -polarity
        score += polarity
    normalized = max(-1.0, min(1.0, score / max(3, len(words) ** 0.5)))
    label = "Positive" if normalized > 0.15 else ("Negative" if normalized < -0.15 else "Neutral")
    return label, round(normalized, 2)


def _normalize_history_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename = {}
    for col in df.columns:
        key = str(col).strip().lower()
        if key in HISTORY_COLUMN_ALIASES:
            rename[col] = HISTORY_COLUMN_ALIASES[key]
        else:
            # exact-case match against the canonical names
            for canon in HISTORY_REQUIRED_COLUMNS:
                if key == canon.lower():
                    rename[col] = canon
                    break
    df = df.rename(columns=rename)
    for col in HISTORY_REQUIRED_COLUMNS + HISTORY_OPTIONAL_COLUMNS:
        if col not in df.columns:
            df[col] = None
    return df


def parse_time_spent_to_minutes(raw) -> Optional[float]:
    """Parses free-text durations like '2 hr 13 mins', '45 mins', '2hr 05
    mins', '15mins' into total minutes. Returns None if nothing parseable."""
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return None
    text = str(raw).strip().lower()
    if not text or text in ("na", "n/a", "-"):
        return None
    hours = 0.0
    minutes = 0.0
    h_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)", text)
    if h_match:
        hours = float(h_match.group(1))
    m_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)", text)
    if m_match:
        minutes = float(m_match.group(1))
    if not h_match and not m_match:
        # bare number - assume minutes
        num_match = re.search(r"(\d+(?:\.\d+)?)", text)
        if num_match:
            minutes = float(num_match.group(1))
        else:
            return None
    return round(hours * 60 + minutes, 1)


def load_history_file_to_df(filename: str, content: bytes) -> pd.DataFrame:
    """Loads and normalizes the 'Historical Data of tickets' upload into the
    canonical column set, with Timestamp parsed to datetime and Time Spent
    parsed to minutes (original text preserved alongside it)."""
    raw_df = load_file_to_df(filename, content)
    if raw_df.empty:
        raise ValueError("Uploaded file contains no rows")
    df = _normalize_history_columns(raw_df)
    if df["Incident Number"].isna().all():
        raise ValueError(
            "Couldn't find an Incident Number column. Expected columns: "
            + ", ".join(HISTORY_REQUIRED_COLUMNS)
        )
    df["Incident Number"] = df["Incident Number"].ffill()  # PDF sample leaves it blank after the first row per ticket
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
    df["Time Spent Raw"] = df["Time Spent"]
    df["Time Spent Minutes"] = df["Time Spent"].apply(parse_time_spent_to_minutes)
    return df


# ---------------------------------------------------------------------------
# Queue descriptions (the third Upload option): a brief description of what
# each queue handles, plus whether it's a TCS or non-TCS team - e.g. L1/L2/L3
# Team are non-TCS; ABAP/FI/SD/MM Team are TCS. Used as reference context
# alongside a ticket's queue-movement history, and later for TCS-only SLA math.
# ---------------------------------------------------------------------------

QUEUE_DESC_COLUMN_ALIASES = {
    "queue": "Queue", "team": "Queue", "queue name": "Queue",
    "description": "Description", "desc": "Description", "brief description": "Description",
    "tcs": "TCS", "is tcs": "TCS", "team type": "TCS", "tcs/non-tcs": "TCS",
    "is tcs team": "TCS", "tcs team": "TCS", "is_tcs_team": "TCS",
}

QUEUE_DESC_REQUIRED_COLUMNS = ["Queue", "Description"]

NON_TCS_HINTS = ("non tcs", "non-tcs", "l1", "l2", "l3")
TCS_HINTS = ("tcs sd", "tcs fi", "abap", "sd team", "fi team", "mm team", "tcs team")


def _normalize_queue_desc_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename = {}
    for col in df.columns:
        key = str(col).strip().lower()
        if key in QUEUE_DESC_COLUMN_ALIASES:
            rename[col] = QUEUE_DESC_COLUMN_ALIASES[key]
    df = df.rename(columns=rename)
    for col in QUEUE_DESC_REQUIRED_COLUMNS:
        if col not in df.columns:
            df[col] = None
    if "TCS" not in df.columns:
        df["TCS"] = None
    return df


def infer_is_tcs_team(queue_name: str, explicit=None) -> Optional[bool]:
    """Best-effort TCS/non-TCS classification. An explicit column value wins;
    otherwise falls back to name matching against the known team naming
    convention (L1/L2/L3 = non-TCS; ABAP/FI/SD/MM = TCS)."""
    if explicit is not None and str(explicit).strip() != "" and str(explicit).lower() != "nan":
        val = str(explicit).strip().lower()
        if val in ("tcs", "true", "yes", "1"):
            return True
        if val in ("non tcs", "non-tcs", "false", "no", "0"):
            return False
    name = str(queue_name or "").strip().lower()
    if any(h in name for h in NON_TCS_HINTS):
        return False
    if any(h in name for h in TCS_HINTS):
        return True
    return None


def load_queue_descriptions_file_to_df(filename: str, content: bytes) -> pd.DataFrame:
    raw_df = load_file_to_df(filename, content)
    if raw_df.empty:
        raise ValueError("Uploaded file contains no rows")
    df = _normalize_queue_desc_columns(raw_df)
    df = df.dropna(subset=["Queue"])
    if df.empty:
        raise ValueError(
            "Couldn't find a Queue column. Expected columns: " + ", ".join(QUEUE_DESC_REQUIRED_COLUMNS)
        )
    df["Queue"] = df["Queue"].astype(str).str.strip()
    df["Description"] = df["Description"].fillna("").astype(str).str.strip()
    df["Is TCS Team"] = df.apply(lambda r: infer_is_tcs_team(r["Queue"], r.get("TCS")), axis=1)
    return df


# ---------------------------------------------------------------------------
# SLA breach breakdown by TCS vs Non-TCS (external) queue routing. Joins the
# main ITSM dump's per-ticket SLA outcome (sla_breached, already computed in
# clean_dataframe) against the uploaded queue-movement history, classified by
# whether a ticket was ever routed through a TCS-owned queue (ABAP/FI/SD/MM)
# vs stayed entirely within non-TCS/external queues (L1/L2/L3).
# ---------------------------------------------------------------------------

def _sla_bucket(bucket_df: pd.DataFrame) -> dict:
    total = int(len(bucket_df))
    breached = int(bucket_df["sla_breached"].sum()) if total else 0
    not_breached = total - breached
    return {
        "total": total,
        "breached": breached,
        "not_breached": not_breached,
        "breached_pct": round(breached / total * 100, 1) if total else 0.0,
        "not_breached_pct": round(not_breached / total * 100, 1) if total else 0.0,
    }


def compute_sla_tcs_breakdown(df: pd.DataFrame, incident_tcs: dict) -> dict:
    """`incident_tcs` maps Number -> True (ever touched a TCS queue), False
    (only non-TCS/external queues seen), for every incident that has at
    least one queue-movement history row with a known TCS classification.
    Tickets with no matching history (or only unclassified queues) are
    reported separately since there's nothing to bucket them by."""
    if not incident_tcs:
        return {
            "has_history": False,
            "tickets_with_history": 0,
            "tickets_without_history": int(len(df)),
            "overall": _sla_bucket(df.iloc[0:0]),
            "tcs": _sla_bucket(df.iloc[0:0]),
            "non_tcs": _sla_bucket(df.iloc[0:0]),
        }

    sub = df[df["Number"].isin(incident_tcs.keys())].copy()
    sub["is_tcs_routed"] = sub["Number"].map(incident_tcs)

    return {
        "has_history": True,
        "tickets_with_history": int(len(sub)),
        "tickets_without_history": int(len(df) - len(sub)),
        "overall": _sla_bucket(sub),
        "tcs": _sla_bucket(sub[sub["is_tcs_routed"] == True]),  # noqa: E712
        "non_tcs": _sla_bucket(sub[sub["is_tcs_routed"] == False]),  # noqa: E712
    }


# ---------------------------------------------------------------------------
# RAG-based Semantic Analysis: ingests the raw User<->TCS-Associate ticket
# conversation export (Number, Short description, Assignment Group, Ticket
# Type, First Assignment Group, Additional comments (end-user view), Work
# notes (internal view)) that feeds the Semantic Analysis tab under AI. This
# is deliberately parallel to the queue-movement history section above:
# lexicon-based sentiment is scored at ingest time (no AI provider required
# just to upload and see charts), and the free-text fields are what the RAG
# retrieval step later searches over for the AI-generated insight cards and
# the "ask a question" chat.
# ---------------------------------------------------------------------------

SEMANTIC_COLUMN_ALIASES = {
    "number": "Number", "ticket": "Number", "ticket number": "Number", "incident": "Number",
    "incident number": "Number", "case": "Number", "case number": "Number",
    "short description": "Short Description", "description": "Short Description", "summary": "Short Description",
    "assignment group": "Assignment Group", "queue": "Assignment Group", "group": "Assignment Group",
    "ticket type": "Ticket Type", "type": "Ticket Type",
    "first assignment group": "First Assignment Group", "initial assignment group": "First Assignment Group",
    "additional comments (end-user view)": "Additional Comments", "additional comments": "Additional Comments",
    "customer comments": "Additional Comments", "end-user comments": "Additional Comments",
    "comments": "Additional Comments",
    "work notes (internal view)": "Work Notes", "work notes": "Work Notes",
    "internal notes": "Work Notes", "agent notes": "Work Notes",
    # Case-record fields mirroring ServiceNow CSM's own case list/dashboard
    # columns (Contact, Company, Channel, State, Priority, Assigned to).
    "contact": "Contact", "caller": "Contact", "customer": "Contact", "requested by": "Contact",
    "company": "Company", "account": "Company",
    "channel": "Channel", "source": "Channel",
    "state": "State", "status": "State",
    "priority": "Priority",
    "assigned to": "Assigned To", "assignee": "Assigned To", "owner": "Assigned To",
}

SEMANTIC_REQUIRED_COLUMNS = ["Number", "Short Description", "Assignment Group", "Additional Comments", "Work Notes"]
SEMANTIC_OPTIONAL_CASE_COLUMNS = ["Contact", "Company", "Channel", "State", "Priority", "Assigned To"]

# Matches a journal-style entry prefix as exported by ServiceNow, e.g.
# "24-08-2026 19:01:23 - Reshme ASWINITL (Work notes (internal view))" -
# used to find the most recent activity timestamp embedded in the free text
# so the sentiment-trend-over-time chart has something to plot against.
_JOURNAL_TIMESTAMP_RE = re.compile(r"(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})")


def _normalize_semantic_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename = {}
    for col in df.columns:
        key = str(col).strip().lower()
        if key in SEMANTIC_COLUMN_ALIASES:
            rename[col] = SEMANTIC_COLUMN_ALIASES[key]
    df = df.rename(columns=rename)
    for col in SEMANTIC_REQUIRED_COLUMNS + ["Ticket Type", "First Assignment Group"] + SEMANTIC_OPTIONAL_CASE_COLUMNS:
        if col not in df.columns:
            df[col] = None
    return df


# ---------------------------------------------------------------------------
# Case-record field synthesis: most ticket-conversation exports won't carry
# Contact/Company/Channel/State/Priority/Assigned To at all - real ServiceNow
# case lists have plenty of "(empty)" cells for these too (unassigned,
# anonymous web submissions, etc). Rather than leave the "Record details"
# table looking sparse, deterministically fill in whatever a given row's
# file didn't provide, seeded on the ticket number so the same ticket always
# gets the same synthesized values across re-uploads.
# ---------------------------------------------------------------------------

_CHANNELS = (["Web"] * 9 + ["Phone"] * 4 + ["Email"] * 4 + ["Chat"] * 2 + ["Social"] + ["Alert"])
_STATES = (["New"] * 17 + ["Open"] * 2 + ["Awaiting Info"])
_PRIORITIES = (["4 - Low"] * 13 + ["3 - Moderate"] * 4 + ["2 - High"] * 2 + ["1 - Critical"])
_CONTACT_NAMES = [
    "Amy Pascal", "Andrew Chen", "Amy Chen", "Linda Cox", "Tommy Gore",
    "Priya Nair", "Marcus Webb", "Sofia Ramirez", "Daniel Kim", "Grace Okafor",
]
_COMPANY_NAMES = [
    "Avid Corporation", "Boxeo", "Diagonal Inc.", "Spark Technologies", "Cambrian",
    "Advances Super Computing",
]
_AGENT_NAMES = ["John Jason", "Romeo Lisac", "Nina Patel", "Carlos Mendez"]


def _seeded_choice(seed_key: str, salt: str, options: list, empty_weight: int = 0):
    """Deterministic pick from `options`, optionally biased to return None
    `empty_weight` times out of (empty_weight + 1) - mirrors how sparsely
    populated these columns are in a real ServiceNow case list."""
    rng = random.Random(f"{seed_key}:{salt}")
    if empty_weight and rng.randint(0, empty_weight) != empty_weight:
        return None
    return rng.choice(options)


def synthesize_case_fields(number: str) -> dict:
    """Deterministic placeholder Contact/Company/Channel/State/Priority/
    Assigned To for a ticket number, used to backfill whatever columns an
    uploaded file didn't include."""
    return {
        "contact": _seeded_choice(number, "contact", _CONTACT_NAMES, empty_weight=3),
        "company": _seeded_choice(number, "company", _COMPANY_NAMES, empty_weight=6),
        "channel": _seeded_choice(number, "channel", _CHANNELS),
        "state": _seeded_choice(number, "state", _STATES),
        "priority": _seeded_choice(number, "priority", _PRIORITIES),
        "assigned_to": _seeded_choice(number, "assigned_to", _AGENT_NAMES, empty_weight=4),
    }


def load_semantic_file_to_df(filename: str, content: bytes) -> pd.DataFrame:
    """Loads and normalizes one Semantic Analysis conversation export (CSV or
    Excel) into the canonical column set. Raises ValueError with a message
    naming the expected columns if a Number column can't be found."""
    raw_df = load_file_to_df(filename, content)
    if raw_df.empty:
        raise ValueError("Uploaded file contains no rows")
    df = _normalize_semantic_columns(raw_df)
    if df["Number"].isna().all() or (df["Number"].astype(str).str.strip() == "").all():
        raise ValueError(
            "Couldn't find a Number/Ticket column. Expected columns: "
            + ", ".join(SEMANTIC_REQUIRED_COLUMNS)
        )
    return df


def extract_latest_journal_timestamp(*texts: Optional[str]):
    """Scans the given free-text fields for embedded 'DD-MM-YYYY HH:MM:SS'
    journal entries and returns the latest one found, or None. Falls back to
    None (never raises) on unparseable text - callers treat a ticket with no
    parseable timestamp as simply not plottable on the trend chart, not as
    an error."""
    latest = None
    for text in texts:
        if not text:
            continue
        for match in _JOURNAL_TIMESTAMP_RE.findall(str(text)):
            try:
                ts = datetime.strptime(match, "%d-%m-%Y %H:%M:%S")
            except ValueError:
                continue
            if latest is None or ts > latest:
                latest = ts
    return latest


def clean_text(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", "(empty)"):
        return None
    return s


# ---- Minimal TF-IDF retrieval (no extra ML dependency) ---------------------
# Deliberately hand-rolled rather than pulling in scikit-learn, matching the
# project's existing preference (see analyze_sentiment's docstring) for
# small, dependency-free building blocks over an external NLP library, given
# the corpus size (one SDM's uploaded ticket conversations) this is meant for.

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been", "to",
    "of", "in", "on", "for", "with", "this", "that", "it", "as", "at", "by", "from", "we",
    "you", "i", "your", "our", "has", "have", "had", "will", "would", "can", "could", "not",
    "please", "thanks", "thank", "regards", "hi", "dear", "team",
}


def _tokenize(text: str) -> list:
    return [w for w in re.findall(r"[a-z']+", text.lower()) if len(w) > 2 and w not in _STOPWORDS]


def build_tfidf_index(documents: list):
    """documents: list of raw text strings. Returns (vectors, idf) where
    vectors is a list of {token: tf_idf_weight} dicts, one per document, and
    idf is the {token: idf_weight} map - both needed to score a new query
    against the same corpus in `tfidf_query`."""
    tokenized = [_tokenize(doc) for doc in documents]
    doc_count = len(tokenized) or 1
    df_counts: dict = {}
    for tokens in tokenized:
        for tok in set(tokens):
            df_counts[tok] = df_counts.get(tok, 0) + 1
    idf = {tok: math.log(doc_count / (1 + count)) + 1 for tok, count in df_counts.items()}

    vectors = []
    for tokens in tokenized:
        tf: dict = {}
        for tok in tokens:
            tf[tok] = tf.get(tok, 0) + 1
        vec = {tok: (count / max(len(tokens), 1)) * idf.get(tok, 0) for tok, count in tf.items()}
        vectors.append(vec)
    return vectors, idf


def _cosine(a: dict, b: dict) -> float:
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[t] * b[t] for t in common)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def tfidf_query(query: str, vectors: list, idf: dict, top_k: int = 8) -> list:
    """Scores `query` against a corpus already indexed by build_tfidf_index,
    returning [(doc_index, score), ...] for the top_k best matches (score >
    0 only), highest first. This is the retrieval half of the RAG pipeline -
    only these top matches (not the whole corpus) get sent to the AI
    provider as context for a grounded answer."""
    tokens = _tokenize(query)
    tf: dict = {}
    for tok in tokens:
        tf[tok] = tf.get(tok, 0) + 1
    q_vec = {tok: (count / max(len(tokens), 1)) * idf.get(tok, 0) for tok, count in tf.items()}
    scored = [(i, _cosine(q_vec, v)) for i, v in enumerate(vectors)]
    scored = [(i, s) for i, s in scored if s > 0]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]
