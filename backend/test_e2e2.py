import requests

BASE = "http://127.0.0.1:8051"

requests.post(f"{BASE}/auth/register", json={
    "full_name": "SDM Admin", "email": "sdm4@example.com", "password": "password123", "role": "admin"
})
login = requests.post(f"{BASE}/auth/login", json={"email": "sdm4@example.com", "password": "password123", "remember_me": False})
token = login.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

with open("sample_data/sample_tickets.csv", "rb") as f:
    upload = requests.post(f"{BASE}/upload", headers=headers, files={"file": f})
dataset_id = upload.json()["dataset_id"]
print("upload OK, rows:", upload.json()["row_count"])

dash = requests.get(f"{BASE}/dashboard", headers=headers, params={"dataset_id": dataset_id}).json()
print("KPI keys:", sorted(dash["kpis"].keys()))
assert "health_score" not in dash["kpis"], "health_score should be removed"
assert "sla_compliance_pct" in dash["kpis"]
assert "resolved_tickets" in dash["kpis"] and "closed_tickets" in dash["kpis"]
print("chart keys:", sorted(dash["charts"].keys()))
assert "monthly_backlog" in dash["charts"]
assert "sla_compliance" in dash["charts"]
assert "closed_vs_resolved" in dash["charts"]

dash_p1 = requests.get(f"{BASE}/dashboard", headers=headers, params={"dataset_id": dataset_id, "priority": "P1"}).json()
print("P1-filtered row count:", dash_p1["row_count"], "== KPI total:", dash_p1["kpis"]["total_tickets"])
assert dash_p1["row_count"] == dash_p1["kpis"]["total_tickets"]

backlog = requests.get(f"{BASE}/dashboard/backlog", headers=headers, params={"dataset_id": dataset_id}).json()
assignee = backlog["backlog"][0]["assignee"]
print("backlog associate:", assignee, backlog["backlog"][0])

tickets = requests.get(f"{BASE}/dashboard/tickets", headers=headers, params={"dataset_id": dataset_id, "assignee": assignee}).json()
print("tickets for associate:", tickets["row_count"], "columns:", tickets["columns"])
assert len(tickets["columns"]) == 18
row = tickets["rows"][0]
assert row["Assigned To"] == assignee
print("sample ticket row:", row)

fb = requests.post(f"{BASE}/feedback", headers=headers, json={"associate_name": assignee, "message": "Solid week on P1 turnaround."})
print("feedback create:", fb.status_code)
fb_list = requests.get(f"{BASE}/feedback", headers=headers, params={"associate_name": assignee}).json()
print("feedback list:", fb_list)

print("\nALL ASSERTIONS PASSED")
