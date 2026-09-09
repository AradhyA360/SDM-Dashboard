import requests

BASE = "http://127.0.0.1:8060"

# --- Admin bug fix verification: register a viewer, then promote via admin endpoint ---
requests.post(f"{BASE}/auth/register", json={
    "full_name": "SDM Admin", "email": "admin1@example.com", "password": "password123", "role": "admin"
})
login = requests.post(f"{BASE}/auth/login", json={"email": "admin1@example.com", "password": "password123", "remember_me": False})
admin_token = login.json()["access_token"]
admin_headers = {"Authorization": f"Bearer {admin_token}"}

requests.post(f"{BASE}/auth/register", json={
    "full_name": "Second Person", "email": "viewer1@example.com", "password": "password123", "role": "viewer"
})
users = requests.get(f"{BASE}/settings/users", headers=admin_headers).json()
second_user = next(u for u in users if u["email"] == "viewer1@example.com")
print("second user role before:", second_user["role"])

promote = requests.put(f"{BASE}/settings/users/{second_user['id']}/role", params={"role": "admin"}, headers=admin_headers)
print("promote status:", promote.status_code)

users_after = requests.get(f"{BASE}/settings/users", headers=admin_headers).json()
second_user_after = next(u for u in users_after if u["email"] == "viewer1@example.com")
print("second user role after:", second_user_after["role"])
assert second_user_after["role"] == "admin", "ADMIN BUG NOT FIXED"
admin_count = sum(1 for u in users_after if u["role"] == "admin")
print("total admins now:", admin_count)
assert admin_count == 2, "Should have 2 admins now"

# --- Upload + Datasets tracking ---
with open("sample_data/sample_tickets.csv", "rb") as f:
    upload1 = requests.post(f"{BASE}/upload", headers=admin_headers, files={"file": f})
dataset1_id = upload1.json()["dataset_id"]
print("upload1 OK:", upload1.json()["row_count"], "rows")

datasets = requests.get(f"{BASE}/datasets", headers=admin_headers).json()
print("datasets list count:", len(datasets))
assert len(datasets) == 1
assert datasets[0]["is_active"] == True
assert datasets[0]["original_filename"] == "sample_tickets.csv"

# upload a second file (reuse same CSV, simulating a second upload)
with open("sample_data/sample_tickets.csv", "rb") as f:
    upload2 = requests.post(f"{BASE}/upload", headers=admin_headers, files={"file": f})
dataset2_id = upload2.json()["dataset_id"]

datasets2 = requests.get(f"{BASE}/datasets", headers=admin_headers).json()
print("datasets list count after 2nd upload:", len(datasets2))
assert len(datasets2) == 2
active_now = next(d for d in datasets2 if d["is_active"])
assert active_now["id"] == dataset2_id, "second upload should now be active"

# activate the first dataset again
activate = requests.post(f"{BASE}/datasets/{dataset1_id}/activate", headers=admin_headers)
print("activate status:", activate.status_code, activate.json())
current = requests.get(f"{BASE}/dashboard/current-dataset", headers=admin_headers).json()
assert current["dataset_id"] == dataset1_id, "activate did not switch active dataset"

# delete the second dataset
delete = requests.delete(f"{BASE}/datasets/{dataset2_id}", headers=admin_headers)
print("delete status:", delete.status_code, delete.json())
datasets3 = requests.get(f"{BASE}/datasets", headers=admin_headers).json()
assert len(datasets3) == 1, "dataset should be gone after delete"

# --- Chart data: verify daily_trend is capped and no longer huge ---
dash = requests.get(f"{BASE}/dashboard", headers=admin_headers, params={"dataset_id": dataset1_id}).json()
print("daily_trend length:", len(dash["charts"]["daily_trend"]))
assert len(dash["charts"]["daily_trend"]) <= 30, "daily trend should be capped at 30 points"
print("daily_trend sample labels:", [d["name"] for d in dash["charts"]["daily_trend"][:3]])

print("\nALL ASSERTIONS PASSED")
