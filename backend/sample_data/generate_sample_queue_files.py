"""
Generates two sample files that plug straight into the 'Historical Data of
Tickets' and 'Queue Descriptions' upload options:

  - sample_ticket_history.csv    (Incident Number, Queue, Timestamp, Status,
                                   Assigned Associate, Time Spent)
  - sample_queue_descriptions.csv (Queue, Description, TCS)

Both are generated together, from a single run, so the incident numbers in
the history file always match real tickets in sample_tickets.csv (the
existing ITSM dump sample) and the queue names in the history file always
match the queues described in the queue-descriptions file. Re-run this
whenever sample_tickets.csv changes to regenerate both in sync.

Usage:
    python3 generate_sample_queue_files.py
"""
import csv
import os
import random
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TICKETS_CSV = os.path.join(HERE, "sample_tickets.csv")
HISTORY_OUT = os.path.join(HERE, "sample_ticket_history.csv")
QUEUE_DESC_OUT = os.path.join(HERE, "sample_queue_descriptions.csv")

random.seed(42)

# Non-TCS teams triage/investigate first; TCS teams are the specialist queues
# a ticket eventually lands in. Matches the naming convention used throughout
# the SDM dashboard change request.
QUEUES = [
    {
        "name": "L1 Team",
        "tcs": False,
        "description": "First point of contact triage, basic troubleshooting, and ticket categorization before any specialist routing.",
    },
    {
        "name": "L2 Team",
        "tcs": False,
        "description": "Deeper technical investigation for issues escalated from L1 that need more diagnosis.",
    },
    {
        "name": "L3 Team",
        "tcs": False,
        "description": "Highest-tier non-TCS escalation, root cause analysis, and complex cross-system issues.",
    },
    {
        "name": "ABAP Team",
        "tcs": True,
        "description": "SAP ABAP custom development, code-level fixes, and program debugging.",
    },
    {
        "name": "FI Team",
        "tcs": True,
        "description": "Finance module configuration, GL/AP/AR issues, and financial reporting fixes.",
    },
    {
        "name": "SD Team",
        "tcs": True,
        "description": "Sales and Distribution module support, order-to-cash issues, and pricing configuration.",
    },
    {
        "name": "MM Team",
        "tcs": True,
        "description": "Materials Management module support, procurement, and inventory issues.",
    },
    # Assignment groups used in the sample ITSM ticket dump — each gets its own
    # unique description so the upload is not limited to the 7 routing queues.
    {
        "name": "L1 Service Desk",
        "tcs": False,
        "description": "Front-line service desk handling password resets, access requests, and initial incident logging for all business units.",
    },
    {
        "name": "Payments L2 Support",
        "tcs": False,
        "description": "Second-line support for payment rails, batch posting failures, SWIFT rejections, and payment-gateway timeouts.",
    },
    {
        "name": "Core Banking L3",
        "tcs": False,
        "description": "Third-line core-banking specialists for account setup delays, onboarding workflows, and ledger posting defects.",
    },
    {
        "name": "Risk & Compliance Ops",
        "tcs": True,
        "description": "Risk engine, sanctions screening, KYC document flows, and compliance false-positive investigations.",
    },
    {
        "name": "Trade Support L2",
        "tcs": True,
        "description": "Trade booking, amendment sync, market-data feeds, and post-trade reconciliation support.",
    },
    {
        "name": "Access Management Team",
        "tcs": False,
        "description": "Role provisioning, lockout recovery, permission corrections, and joiner/mover/leaver access changes.",
    },
]
NON_TCS_QUEUES = [q for q in QUEUES if not q["tcs"]]
TCS_QUEUES = [q for q in QUEUES if q["tcs"]]

# Hardcoded description generator (not a schema-only upload). Every queue
# name gets an auto-written, <=2-line description built from its team-type
# and a naming-convention guess (ABAP/FI/SD/MM => TCS specialist queue,
# L1/L2/L3 or "service desk" => non-TCS triage queue). This runs for ANY
# queue name found in the ticket history, not just the 13 catalogued above,
# so a queue that only shows up in someone's ITSM dump still gets a real,
# short description instead of a blank row.
_TCS_SPECIALTY_HINTS = {
    "abap": "SAP ABAP custom development and code-level fixes.",
    "fi": "Finance module configuration, GL/AP/AR issues, and reporting fixes.",
    "sd": "Sales and Distribution support, order-to-cash issues, and pricing configuration.",
    "mm": "Materials Management support, procurement, and inventory issues.",
}


def generate_queue_description(queue_name: str, is_tcs: bool) -> str:
    """Writes a fresh, <=2-line description for a queue name, using only its
    name and TCS/non-TCS flag - no external schema file required."""
    name_lower = queue_name.lower()
    if is_tcs:
        for hint, blurb in _TCS_SPECIALTY_HINTS.items():
            if hint in name_lower.split() or name_lower.startswith(hint):
                return f"TCS specialist queue for {queue_name}. {blurb}"
        return f"TCS specialist team handling {queue_name} escalations and domain-specific fixes."
    if any(tier in name_lower for tier in ("l1", "service desk", "front")):
        return f"Non-TCS front-line queue. First point of contact for {queue_name} triage and initial logging."
    if "l2" in name_lower:
        return f"Non-TCS second-line queue. Deeper investigation for {queue_name} issues escalated from L1."
    if "l3" in name_lower:
        return f"Non-TCS third-line queue. Root-cause analysis for the hardest {queue_name} escalations."
    return f"Non-TCS support queue handling {queue_name} tickets before any TCS specialist routing."


# Two permanently disjoint rosters. Do not infer these by alternating names
# from the ticket export: that was the source of TCS SLA associates appearing
# under non-TCS queues. The TCS roster is the agreed SLA roster; names in the
# non-TCS pool deliberately do not overlap it.
TCS_SLA_ASSOCIATES = ["Priya Sharma", "James Cole", "Wei Zhang", "Aisha Khan", "Liam O'Connor",
                      "Sofia Rossi", "Kenji Watanabe", "Maria Silva", "Daniel Cho", "Fatima Al-Sayed"]
NON_TCS_SLA_ASSOCIATES = ["Arjun Mehta", "Emily Carter", "Noah Williams", "Nadia Rahman", "Carlos Mendes",
                          "Hannah Lee", "Omar Siddiqui", "Chloe Martin", "Ethan Brooks", "Mei Tan"]

# By default, every ticket in sample_tickets.csv gets its own history trail
# (pass a smaller number as a CLI arg for a quick test run, e.g.
# `python3 generate_sample_queue_files.py 50`).
NUM_SAMPLE_TICKETS = None  # None = all tickets


def random_time_spent():
    """Occasionally phrase it as '2 hr 13 mins', '2hr 05 mins', or bare
    minutes like '15mins' - mirrors the mixed formatting in the source data
    so the parser's flexibility keeps getting exercised."""
    minutes = random.choice([10, 15, 17, 35, 45, 45, 60, 75, 90, 125, 133])
    hours, rem = divmod(minutes, 60)
    style = random.choice(["spaced", "tight", "bare"])
    if hours == 0:
        return f"{rem}mins" if style == "bare" else f"{rem} mins"
    if style == "tight":
        return f"{hours}hr {rem:02d} mins"
    return f"{hours} hr {rem} mins"


def build_history_rows(incident_numbers, opened_lookup, owner_lookup, tcs_associates, non_tcs_associates):
    rows = []
    for incident in incident_numbers:
        # Anchor each ticket's queue trail to when it was actually opened
        # (per the ITSM dump), rather than clustering every ticket into one
        # arbitrary window - keeps timestamps plausible across all 2000 rows.
        opened = opened_lookup.get(incident)
        base = opened or datetime(2026, 8, 10, 9, 0, 0)
        start = base + timedelta(minutes=random.randint(5, 90))
        t = start
        # A ticket bounces through 1-2 non-TCS queues, then 1 TCS queue,
        # ending Open / In progress / Hold / Closed - same shape as the PDF's
        # worked example (INC0010022).
        non_tcs_hops = random.sample(NON_TCS_QUEUES, k=random.choice([1, 2]))
        tcs_queue = random.choice(TCS_QUEUES)

        # The associate already on record as "Assigned To" for this ticket in
        # sample_tickets.csv - used to bias the queue trail so the same person
        # tends to keep working their own ticket, instead of the trail and
        # the ITSM dump naming two unrelated people for the same incident.
        # Bias only applies within the matching TCS/non-TCS pool - a TCS-team
        # associate never gets biased onto a non-TCS hop or vice versa, so the
        # two rosters never mix.
        owner = owner_lookup.get(incident)

        def pool_pick(pool, owner_weight):
            """Mostly the ticket's own assignee if they belong to this pool,
            occasionally a hand-off to someone else in the SAME pool -
            never crosses into the other team's roster."""
            if owner and owner in pool and random.random() < owner_weight:
                return owner
            others = [a for a in pool if a != owner] or pool
            return random.choice(others)

        # No unassigned step is ever tagged "NA" - a queue hop that hasn't
        # been picked up yet is left blank, matching how a real ITSM export
        # represents "not yet assigned" (an empty cell, not a literal string).
        for q in non_tcs_hops:
            rows.append([incident, q["name"], t.isoformat(), "Open", "", random_time_spent()])
            t += timedelta(minutes=random.randint(10, 30))
            # Triage hops (L1/L2/L3) are less often the ticket owner - more
            # realistic that first-line triage is handled by whoever's free.
            rows.append([incident, q["name"], t.isoformat(), "In progress", pool_pick(non_tcs_associates, owner_weight=0.25), random_time_spent()])
            t += timedelta(minutes=random.randint(15, 60))

        final_status = random.choices(
            ["Open", "In progress", "Hold", "Closed"], weights=[2, 3, 2, 3]
        )[0]
        rows.append([incident, tcs_queue["name"], t.isoformat(), "Open", "", random_time_spent()])
        t += timedelta(minutes=random.randint(10, 30))
        # The specialist TCS queue is where the ticket's own assignee is most
        # likely to be doing the work.
        rows.append([incident, tcs_queue["name"], t.isoformat(), "In progress", pool_pick(tcs_associates, owner_weight=0.7), random_time_spent()])
        if final_status in ("Hold", "Closed"):
            t += timedelta(minutes=random.randint(15, 60))
            associate = pool_pick(tcs_associates, owner_weight=0.7)
            time_spent = "" if final_status == "Closed" else random_time_spent()
            rows.append([incident, tcs_queue["name"], t.isoformat(), final_status, associate, time_spent])
    return rows


def main():
    if not os.path.exists(TICKETS_CSV):
        raise SystemExit(f"Expected {TICKETS_CSV} to exist - run this from backend/sample_data/")

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else NUM_SAMPLE_TICKETS

    with open(TICKETS_CSV, newline="") as f:
        tickets_rows = list(csv.DictReader(f))
    all_numbers = [row["Number"] for row in tickets_rows if row.get("Number")]
    if limit is not None:
        all_numbers = random.sample(all_numbers, k=min(limit, len(all_numbers)))
    incident_numbers = sorted(all_numbers)
    def parse_opened(value):
        try:
            return datetime.fromisoformat(str(value))
        except (TypeError, ValueError):
            return None

    opened_lookup = {row["Number"]: parse_opened(row.get("Opened")) for row in tickets_rows}

    # Queue staffing is governed by the fixed roster above. Owner matching is
    # only a within-pool preference in build_history_rows; it can never put a
    # TCS name on a non-TCS hop (or the reverse).
    tcs_associates = TCS_SLA_ASSOCIATES
    non_tcs_associates = NON_TCS_SLA_ASSOCIATES
    owner_lookup = {row["Number"]: row.get("Assigned To", "") for row in tickets_rows if row.get("Number")}

    history_rows = build_history_rows(incident_numbers, opened_lookup, owner_lookup, tcs_associates, non_tcs_associates)
    with open(HISTORY_OUT, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Incident Number", "Queue", "Timestamp", "Status", "Assigned Associate", "Time Spent"])
        last_incident = None
        for row in history_rows:
            incident, *rest = row
            # Leave Incident Number blank after the first row per ticket,
            # matching the PDF's own sample layout (relies on the uploader's
            # forward-fill).
            writer.writerow([incident if incident != last_incident else "", *rest])
            last_incident = incident

    # Queue descriptions are hardcoded + generated here in Python (not read
    # from an externally-uploaded schema-only file) - every queue that shows
    # up in the history file above gets a real, <=2-line description, even
    # ones outside the 13 catalogued in QUEUES.
    queues_in_history = sorted({row[1] for row in history_rows})
    catalog_by_name = {q["name"]: q for q in QUEUES}
    with open(QUEUE_DESC_OUT, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Queue", "Description", "TCS"])
        for name in queues_in_history:
            cataloged = catalog_by_name.get(name)
            is_tcs = cataloged["tcs"] if cataloged else any(h in name.lower() for h in ("abap", "fi", "sd", "mm", "risk", "trade"))
            description = cataloged["description"] if cataloged else generate_queue_description(name, is_tcs)
            writer.writerow([name, description, "TCS" if is_tcs else "Non TCS"])

    print(f"Wrote {len(history_rows)} history rows across {len(incident_numbers)} incidents -> {HISTORY_OUT}")
    print(f"Wrote {len(queues_in_history)} queue descriptions -> {QUEUE_DESC_OUT}")
    print(f"TCS associates ({len(tcs_associates)}):", ", ".join(tcs_associates))
    print(f"Non-TCS associates ({len(non_tcs_associates)}):", ", ".join(non_tcs_associates))
    print("Sample incidents:", ", ".join(incident_numbers[:10]), "..." if len(incident_numbers) > 10 else "")


if __name__ == "__main__":
    main()
