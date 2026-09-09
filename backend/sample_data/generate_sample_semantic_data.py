#!/usr/bin/env python3
"""
generate_sample_semantic_data.py

Generates a sample "ticket conversation" export for the Sentiment Analysis
(RAG) tab, built from the SAME ticket numbers, short descriptions, and
assignment groups already sitting in an ITSM Dump file you've uploaded to
the Service Health Dashboard.

Why this matters: the Sentiment Analysis tab does retrieval-augmented
analysis over whatever ticket-conversation file you upload. If that file's
ticket numbers don't match the ITSM Dump, there's nothing for the two
datasets to connect on. This script reads your real ITSM Dump, and for
every ticket in it, fabricates a plausible back-and-forth conversation
between the end user and the TCS associate (Additional comments (end-user
view) + Work notes (internal view)) - so re-uploading the ITSM Dump AND the
file this script produces gives every ticket a matching conversation
thread.

The generated conversations deliberately vary in tone (positive / neutral /
negative / escalated-negative) using vocabulary the dashboard's built-in
sentiment scorer recognizes, so the Sentiment Analysis charts and AI insight
cards have something real to show instead of a flat, all-neutral corpus.

USAGE
-----
    # Point it at the exact same file you uploaded as your ITSM Dump:
    python generate_sample_semantic_data.py --input itsm_dump.xlsx

    # Or try it against this project's own sample ITSM data, right next to
    # this script (backend/sample_data/sample_tickets.csv):
    python generate_sample_semantic_data.py --input sample_tickets.csv

    # Optional flags:
    python generate_sample_semantic_data.py \\
        --input itsm_dump.xlsx \\
        --output semantic_conversations.xlsx \\
        --max-tickets 300 \\
        --seed 42

    # No ITSM file handy? Generate a fully synthetic standalone sample:
    python generate_sample_semantic_data.py --demo --output demo_conversations.xlsx

The output file's columns match exactly what the Sentiment Analysis upload
expects: Number, Short description, Assignment Group, Ticket Type,
First Assignment Group, Additional comments (end-user view),
Work notes (internal view).

Requires: pandas, openpyxl  (pip install pandas openpyxl)
"""

import argparse
import random
import sys
from datetime import datetime, timedelta

import pandas as pd

# ---------------------------------------------------------------------------
# Column detection for the ITSM Dump. Deliberately permissive/case-insensitive
# since real-world exports spell these slightly differently - mirrors (but
# doesn't depend on) the dashboard backend's own alias handling.
# ---------------------------------------------------------------------------

NUMBER_ALIASES = {"number", "ticket number", "incident number", "incident", "case", "case number", "ticket id"}
DESC_ALIASES = {"short description", "description", "summary"}
GROUP_ALIASES = {"assignment group", "queue", "group", "team"}
ASSIGNED_TO_ALIASES = {"assigned to", "assigned associate", "assignee", "assigned engineer"}
TYPE_ALIASES = {"type", "ticket type", "category", "channel"}
PRIORITY_ALIASES = {"priority"}

OUTPUT_COLUMNS = [
    "Number", "Short description", "Assignment Group", "Ticket Type",
    "First Assignment Group", "Additional comments (end-user view)",
    "Work notes (internal view)",
]

TICKET_TYPES = ["Incident", "Service Request", "Problem", "Change Request"]

ASSOCIATE_NAMES = [
    "Reshme ASWINITL", "John Jason", "Romeo Lisac", "Priya Nair", "Carlos Mendez",
    "Wei Zhang", "Fatima Haidari", "Daniel Osei",
]

USER_NAMES = [
    "Amy Chen", "Andrew Chen", "Linda Cox", "Tommy Gore", "David Kim",
    "Sara Ibrahim", "Marcus Webb", "Helena Ruiz", "Owen Blake", "Nadia Farouk",
]

CUSTOM_GROUPS = [
    "Billing Support", "Network Support", "Software Support", "Consumer Service",
    "ACME Support", "Service Desk",
]


def find_col(df: pd.DataFrame, aliases: set):
    for col in df.columns:
        if str(col).strip().lower() in aliases:
            return col
    return None


def load_itsm_dump(path: str) -> pd.DataFrame:
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path)
    if df.empty:
        raise ValueError(f"{path} contains no rows")
    return df


# ---------------------------------------------------------------------------
# Conversation templates. Vocabulary is chosen deliberately to overlap with
# the dashboard's lexicon-based sentiment scorer (_POSITIVE_WORDS /
# _NEGATIVE_WORDS in data_processing.py) so the resulting sentiment labels
# and charts are meaningfully distributed, not accidentally all-neutral.
# ---------------------------------------------------------------------------

USER_OPENERS = {
    "positive": [
        "Hi team, quick question about {topic} - hoping for a fast turnaround.",
        "Hello, I need help with {topic}. Not urgent, just checking in.",
        "Hi, could someone look into {topic} when you get a chance? Thanks in advance!",
    ],
    "neutral": [
        "Hello, I'm having an issue with {topic}. Please advise.",
        "Hi team, requesting assistance with {topic}.",
        "Good day, raising this ticket regarding {topic}.",
    ],
    "negative": [
        "Hi, this is the second time I'm reporting {topic}. It's really frustrating.",
        "Hello, {topic} has been broken for a while now and it's slowing my whole team down.",
        "I'm not happy about how long {topic} has been an issue. This is urgent.",
    ],
    "escalated_negative": [
        "This is unacceptable - {topic} has failed again and I've been waiting for days.",
        "I'm extremely frustrated. {topic} is still broken and nobody has responded. Please escalate.",
        "This is the worst support experience I've had. {topic} keeps failing and I'm furious about the delay.",
    ],
}

ASSOCIATE_ACK_NOTES = [
    "Acknowledged the request. Reviewing {topic} now and will update shortly.",
    "Picked up this ticket. Starting investigation into {topic}.",
    "Assigned to me. Checking logs and configuration related to {topic}.",
]

ASSOCIATE_PROGRESS_NOTES = {
    "positive": [
        "Root cause identified quickly. Applying the fix for {topic} now.",
        "Found a straightforward fix for {topic}. Deploying shortly.",
    ],
    "neutral": [
        "Investigation in progress on {topic}. Will provide an update within SLA.",
        "Gathering more details on {topic} before proceeding.",
    ],
    "negative": [
        "Investigation delayed due to dependency on another team for {topic}.",
        "Issue with {topic} is more complex than expected; still working on it.",
    ],
    "escalated_negative": [
        "Ticket was reassigned twice due to unclear ownership of {topic}. Escalating internally.",
        "Repeated attempts to resolve {topic} have failed. Escalating to L3 / senior engineer.",
    ],
}

USER_FOLLOWUPS = {
    "positive": [
        "That worked perfectly, thank you so much! Really appreciate the quick and professional help.",
        "Confirmed fixed on my end - excellent and fast service, thanks team!",
    ],
    "neutral": [
        "Okay, please keep me posted on {topic}.",
        "Understood, following up again if there's no update soon.",
    ],
    "negative": [
        "Still waiting and this delay is unacceptable. {topic} needs to be fixed today.",
        "I'm still not happy - {topic} is still broken and I've been ignored for too long.",
    ],
    "escalated_negative": [
        "This has failed again. I am furious - {topic} is critical and this is the worst support I've received.",
        "Completely unacceptable. Escalate this immediately, {topic} has been broken for far too long.",
    ],
}

ASSOCIATE_RESOLUTION_NOTES = {
    "positive": [
        "Resolved. Applied fix for {topic} and confirmed working with the end user. Closing ticket.",
        "Fix deployed and verified for {topic}. User confirmed satisfied. Marking resolved.",
    ],
    "neutral": [
        "Update applied for {topic}. Awaiting user confirmation before closing.",
        "Change implemented for {topic}. Monitoring for 24 hours before closure.",
    ],
    "negative": [
        "Fix for {topic} delayed again due to a failed deployment. Apologized to user for the poor experience.",
        "Workaround provided for {topic} but underlying issue remains unresolved.",
    ],
    "escalated_negative": [
        "Multiple failed attempts to resolve {topic}. User is angry and has requested management escalation.",
        "Critical issue with {topic} still unresolved after repeated escalation. SLA breached.",
    ],
}

TOPICS = [
    "the VPN connection", "the router configuration", "the billing invoice discrepancy",
    "the password reset request", "the email service outage", "the purchase order mismatch",
    "the laptop connectivity issue", "the instance upgrade", "the wifi access point",
    "the account password policy", "the network latency", "the software license renewal",
]

ARC_WEIGHTS = [("positive", 0.30), ("neutral", 0.30), ("negative", 0.25), ("escalated_negative", 0.15)]


def weighted_choice(rng: random.Random, weighted_options):
    total = sum(w for _, w in weighted_options)
    r = rng.uniform(0, total)
    upto = 0
    for option, weight in weighted_options:
        upto += weight
        if upto >= r:
            return option
    return weighted_options[-1][0]


def fmt_ts(dt: datetime) -> str:
    # DD-MM-YYYY HH:MM:SS, matching the journal-entry format ServiceNow
    # exports use and that the dashboard's timestamp parser expects.
    return dt.strftime("%d-%m-%Y %H:%M:%S")


def journal_block(dt: datetime, name: str, field_label: str, text: str) -> str:
    return f"{fmt_ts(dt)} - {name} ({field_label})\n{text}"


def build_conversation(rng: random.Random, associate: str, end_user: str, base_time: datetime):
    """Returns (additional_comments, work_notes, arc) - each a newest-first,
    blank-line-separated journal string, matching the ServiceNow export
    format shown in the sample screenshot."""
    arc = weighted_choice(rng, ARC_WEIGHTS)
    topic = rng.choice(TOPICS)
    t = base_time

    user_blocks = []
    work_blocks = []

    # Turn 1: user opens the ticket
    opener = rng.choice(USER_OPENERS[arc]).format(topic=topic)
    user_blocks.append((t, journal_block(t, end_user, "Additional comments (end-user view)", opener)))
    t += timedelta(minutes=rng.randint(5, 40))

    # Turn 2: associate acknowledges
    ack = rng.choice(ASSOCIATE_ACK_NOTES).format(topic=topic)
    work_blocks.append((t, journal_block(t, associate, "Work notes (internal view)", ack)))
    t += timedelta(minutes=rng.randint(30, 180))

    # Turn 3: associate progress note
    progress = rng.choice(ASSOCIATE_PROGRESS_NOTES[arc]).format(topic=topic)
    work_blocks.append((t, journal_block(t, associate, "Work notes (internal view)", progress)))
    t += timedelta(minutes=rng.randint(30, 240))

    # Turn 4: user follow-up
    followup = rng.choice(USER_FOLLOWUPS[arc]).format(topic=topic)
    user_blocks.append((t, journal_block(t, end_user, "Additional comments (end-user view)", followup)))
    t += timedelta(minutes=rng.randint(15, 120))

    # Turn 5: associate resolution/closing note
    resolution = rng.choice(ASSOCIATE_RESOLUTION_NOTES[arc]).format(topic=topic)
    work_blocks.append((t, journal_block(t, associate, "Work notes (internal view)", resolution)))

    # Newest-first within each column, matching the sample export's ordering.
    additional_comments = "\n\n".join(b for _, b in sorted(user_blocks, key=lambda x: x[0], reverse=True))
    work_notes = "\n\n".join(b for _, b in sorted(work_blocks, key=lambda x: x[0], reverse=True))
    return additional_comments, work_notes, arc


def build_rows_from_itsm(df: pd.DataFrame, rng: random.Random, max_tickets: int | None):
    number_col = find_col(df, NUMBER_ALIASES)
    if not number_col:
        raise ValueError(
            "Couldn't find a ticket-number column in the ITSM Dump. "
            f"Looked for one of: {sorted(NUMBER_ALIASES)}"
        )
    desc_col = find_col(df, DESC_ALIASES)
    group_col = find_col(df, GROUP_ALIASES)
    assigned_col = find_col(df, ASSIGNED_TO_ALIASES)
    type_col = find_col(df, TYPE_ALIASES)

    dedup = df.drop_duplicates(subset=[number_col])
    if max_tickets:
        dedup = dedup.head(max_tickets)

    rows = []
    now = datetime.now()
    for _, r in dedup.iterrows():
        number = r.get(number_col)
        if pd.isna(number) or str(number).strip() == "":
            continue
        number = str(number).strip()
        short_desc = str(r.get(desc_col)).strip() if desc_col and pd.notna(r.get(desc_col)) else "Support ticket"
        group = str(r.get(group_col)).strip() if group_col and pd.notna(r.get(group_col)) else rng.choice(CUSTOM_GROUPS)
        ticket_type = str(r.get(type_col)).strip() if type_col and pd.notna(r.get(type_col)) else rng.choice(TICKET_TYPES)
        associate = str(r.get(assigned_col)).strip() if assigned_col and pd.notna(r.get(assigned_col)) and str(r.get(assigned_col)).strip().lower() not in ("unassigned", "unknown", "") else rng.choice(ASSOCIATE_NAMES)
        end_user = rng.choice(USER_NAMES)

        base_time = now - timedelta(days=rng.randint(0, 60), hours=rng.randint(0, 23))
        additional_comments, work_notes, arc = build_conversation(rng, associate, end_user, base_time)

        # Simulate an escalation/reassignment for the worst-case arc, so the
        # "sentiment change after escalation" insight has something to find.
        first_group = group if arc != "escalated_negative" else rng.choice([g for g in CUSTOM_GROUPS if g != group] or CUSTOM_GROUPS)

        rows.append({
            "Number": number,
            "Short description": short_desc,
            "Assignment Group": group,
            "Ticket Type": ticket_type,
            "First Assignment Group": first_group,
            "Additional comments (end-user view)": additional_comments,
            "Work notes (internal view)": work_notes,
        })
    return rows


def build_demo_rows(rng: random.Random, count: int):
    rows = []
    now = datetime.now()
    for i in range(1, count + 1):
        number = f"INC{1000000 + i}"
        group = rng.choice(CUSTOM_GROUPS)
        ticket_type = rng.choice(TICKET_TYPES)
        associate = rng.choice(ASSOCIATE_NAMES)
        end_user = rng.choice(USER_NAMES)
        base_time = now - timedelta(days=rng.randint(0, 60), hours=rng.randint(0, 23))
        additional_comments, work_notes, arc = build_conversation(rng, associate, end_user, base_time)
        first_group = group if arc != "escalated_negative" else rng.choice([g for g in CUSTOM_GROUPS if g != group] or CUSTOM_GROUPS)
        rows.append({
            "Number": number,
            "Short description": f"Sample ticket #{i}",
            "Assignment Group": group,
            "Ticket Type": ticket_type,
            "First Assignment Group": first_group,
            "Additional comments (end-user view)": additional_comments,
            "Work notes (internal view)": work_notes,
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description="Generate sample Sentiment Analysis conversation data from an ITSM Dump")
    parser.add_argument("--input", help="Path to your ITSM Dump export (.xlsx or .csv)")
    parser.add_argument("--output", default="sample_sentiment_data.csv", help="Output path (.xlsx or .csv - format is chosen from the extension)")
    parser.add_argument("--max-tickets", type=int, default=None, help="Cap the number of tickets processed")
    parser.add_argument("--seed", type=int, default=42, help="Random seed, for reproducible output")
    parser.add_argument("--demo", action="store_true", help="Generate fully synthetic sample data instead of reading an ITSM Dump")
    parser.add_argument("--demo-count", type=int, default=150, help="Number of tickets to generate in --demo mode")
    args = parser.parse_args()

    if not args.demo and not args.input:
        parser.error("--input is required unless --demo is set")

    rng = random.Random(args.seed)

    if args.demo:
        rows = build_demo_rows(rng, args.demo_count)
    else:
        try:
            itsm_df = load_itsm_dump(args.input)
        except Exception as e:
            print(f"Failed to read ITSM Dump at {args.input}: {e}", file=sys.stderr)
            sys.exit(1)
        try:
            rows = build_rows_from_itsm(itsm_df, rng, args.max_tickets)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            sys.exit(1)

    if not rows:
        print("No ticket rows to write - nothing generated.", file=sys.stderr)
        sys.exit(1)

    out_df = pd.DataFrame(rows, columns=OUTPUT_COLUMNS)
    if str(args.output).lower().endswith(".csv"):
        out_df.to_csv(args.output, index=False)
    else:
        out_df.to_excel(args.output, index=False)
    print(f"Wrote {len(out_df)} ticket conversation(s) to {args.output}")
    print("Upload this file in AI -> Sentiment Analysis to populate the RAG corpus.")


if __name__ == "__main__":
    main()
