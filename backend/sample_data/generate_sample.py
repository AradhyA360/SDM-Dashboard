"""Generates a realistic sample_tickets.csv (~2000 rows) in the ServiceNow-style
schema this dashboard expects, for demoing without a real ITSM export.
Run with: python generate_sample.py
"""
import csv
import random
from datetime import datetime, timedelta

random.seed(7)

CATEGORIES = ["Payments", "Onboarding", "Reporting", "Reconciliation", "Trade Booking",
              "Risk Engine", "Settlements", "Compliance Checks", "Market Data", "User Access"]
PRIORITIES = ["P1", "P2", "P3", "P4"]
PRIORITY_WEIGHTS = [5, 15, 45, 35]
PRIORITY_SLA_HOURS = {"P1": 4, "P2": 48, "P3": 120, "P4": 240}
STATES = ["New", "In Progress", "On Hold", "Resolved", "Closed", "Cancelled"]
STATE_WEIGHTS = [10, 18, 12, 15, 40, 5]
TYPES = ["Incident", "Service Request", "Defect"]

COMPANIES = ["Northbridge Capital", "Meridian Asset Mgmt", "Solstice Bank", "Anchorpoint Securities",
             "Vantage Wealth", "Harborview Trust", "Crestline Investments"]
BUSINESS_SERVICES = ["TradeFlow Pro", "SettleNet", "ComplianceHub", "RiskGuard", "MarketPulse", "AccessManager"]
ASSIGNMENT_GROUPS = ["L1 Service Desk", "Payments L2 Support", "Core Banking L3", "Risk & Compliance Ops",
                     "Trade Support L2", "Access Management Team"]

# These are the only people permitted to work TCS SLA queues. Keep this
# roster explicit: queue history, backlog ownership, and sample ITSM records
# must never make it look as if a TCS resolver also staffs a non-TCS queue.
TCS_SLA_ASSOCIATES = ["Priya Sharma", "James Cole", "Wei Zhang", "Aisha Khan", "Liam O'Connor",
                      "Sofia Rossi", "Kenji Watanabe", "Maria Silva", "Daniel Cho", "Fatima Al-Sayed"]
NON_TCS_SLA_ASSOCIATES = ["Arjun Mehta", "Emily Carter", "Noah Williams", "Nadia Rahman", "Carlos Mendes",
                          "Hannah Lee", "Omar Siddiqui", "Chloe Martin", "Ethan Brooks", "Mei Tan"]
TCS_SLA_GROUPS = {"Risk & Compliance Ops", "Trade Support L2"}
CALLERS = ["Robert Hale", "Elena Petrova", "Michael Osei", "Grace Lin", "Thomas Nguyen",
           "Isabella Marchetti", "Samuel Okafor", "Anya Kowalski", "David Kim", "Laura Bianchi"]
MANAGERS = ["Rachel Adams", "Victor Nakamura", "Claire Dubois", "Omar Farouk"]
COUNTRIES = ["United States", "United Kingdom", "Singapore", "India", "Germany", "United Arab Emirates"]
LOCATIONS = ["New York, NY", "London, UK", "Singapore", "Bengaluru, IN", "Frankfurt, DE", "Dubai, UAE"]
MAIN_CONTACTS = ["Nathan Brooks", "Sara Whitfield", "Andre Lucas", "Priyanka Rao"]
PENDING_REASONS = ["Awaiting customer input", "Awaiting vendor fix", "Change window pending",
                   "Awaiting approval", "Root cause investigation", ""]
SHORT_DESCRIPTIONS = {
    "Payments": ["Payment batch failed to post", "Duplicate payment flagged", "Payment gateway timeout"],
    "Onboarding": ["New client account setup delayed", "KYC document upload failing", "Onboarding workflow stuck"],
    "Reporting": ["Daily P&L report not generated", "Report export returns blank file", "Scheduled report delayed"],
    "Reconciliation": ["Break in nostro reconciliation", "Recon job failed overnight", "Mismatch in trade recon"],
    "Trade Booking": ["Trade booking rejected by risk engine", "Trade amendment not syncing", "Booking screen unresponsive"],
    "Risk Engine": ["Risk limit breach not alerting", "Risk calculation timeout", "VaR report incorrect"],
    "Settlements": ["Settlement instruction failed", "SWIFT message rejected", "Settlement date mismatch"],
    "Compliance Checks": ["Compliance check flagged false positive", "Sanctions screening delayed", "Audit trail gap"],
    "Market Data": ["Market data feed dropped", "Stale pricing data", "Data vendor connectivity issue"],
    "User Access": ["Access request pending approval", "User locked out of application", "Role permissions incorrect"],
}

now_ref = datetime.now()
rows = []

for i in range(1, 2001):
    category = random.choice(CATEGORIES)
    priority = random.choices(PRIORITIES, weights=PRIORITY_WEIGHTS)[0]
    state = random.choices(STATES, weights=STATE_WEIGHTS)[0]

    # How long ago a ticket was opened depends on its state - a live dashboard
    # snapshot naturally has New/In Progress tickets skewed recent, while
    # Resolved/Closed/Cancelled tickets are spread across the whole history and
    # On Hold tickets are the ones most likely to have quietly aged.
    days_ago_range = {
        "New": (0, 3), "In Progress": (0, 20), "On Hold": (0, 100),
        "Resolved": (0, 110), "Closed": (0, 110), "Cancelled": (0, 110),
    }[state]
    days_ago = random.randint(*days_ago_range)
    opened = now_ref - timedelta(days=days_ago, hours=random.randint(0, 23), minutes=random.randint(0, 59))
    sla_hours = PRIORITY_SLA_HOURS[priority]
    sla_due = opened + timedelta(hours=sla_hours)
    assignment_date = opened + timedelta(hours=random.randint(0, 4))

    resolved_date = ""
    closed_date = ""
    if state in ("Resolved", "Closed"):
        # Skew resolution time so most tickets land within or just past the SLA
        # window, with a believable minority breaching it - not near-universal
        # breach, which would make every chart look the same shade of red.
        resolution_hours = random.triangular(0.25, sla_hours * 2.5, sla_hours * 0.55)
        resolved_dt = opened + timedelta(hours=resolution_hours)
        resolved_date = resolved_dt.strftime("%Y-%m-%d %H:%M")
        if state == "Closed":
            closed_dt = resolved_dt + timedelta(hours=random.randint(1, 48))
            closed_date = closed_dt.strftime("%Y-%m-%d %H:%M")
    elif state == "Cancelled":
        closed_dt = opened + timedelta(hours=random.randint(1, 24))
        closed_date = closed_dt.strftime("%Y-%m-%d %H:%M")

    pending_reason = random.choice(PENDING_REASONS) if state == "On Hold" else ""

    assignment_group = random.choice(ASSIGNMENT_GROUPS)
    associate_pool = TCS_SLA_ASSOCIATES if assignment_group in TCS_SLA_GROUPS else NON_TCS_SLA_ASSOCIATES
    assigned_to = random.choice(associate_pool)
    rows.append({
        "Number": f"INC00{10000 + i}",
        "Type": random.choice(TYPES),
        "State": state,
        "Priority": priority,
        "Category": category,
        "Short Description": random.choice(SHORT_DESCRIPTIONS[category]),
        "Assignment Group": assignment_group,
        "Assigned To": assigned_to,
        "Name": random.choice(CALLERS),
        "Opened": opened.strftime("%Y-%m-%d %H:%M"),
        "Associate Assignment Date": assignment_date.strftime("%Y-%m-%d %H:%M"),
        "SLA Due Date": sla_due.strftime("%Y-%m-%d %H:%M"),
        "Resolved Date": resolved_date,
        "Closed Date": closed_date,
        "Pending Reason": pending_reason,
        "Company": random.choice(COMPANIES),
        "Business Service": random.choice(BUSINESS_SERVICES),
        "Country": random.choice(COUNTRIES),
        "Main Contact Name": random.choice(MAIN_CONTACTS),
        "Manager": random.choice(MANAGERS),
        "Location": random.choice(LOCATIONS),
        "Updated By": random.choice(associate_pool),
    })

fieldnames = list(rows[0].keys())
with open("sample_tickets.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"Generated {len(rows)} rows -> sample_tickets.csv")
