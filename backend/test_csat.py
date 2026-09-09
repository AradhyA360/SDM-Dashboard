import requests
BASE = "http://127.0.0.1:8070"
requests.post(f"{BASE}/auth/register", json={"full_name": "Admin", "email": "a@example.com", "password": "password123", "role": "admin"})
login = requests.post(f"{BASE}/auth/login", json={"email": "a@example.com", "password": "password123", "remember_me": False})
token = login.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}
with open("sample_data/sample_tickets.csv", "rb") as f:
    upload = requests.post(f"{BASE}/upload", headers=headers, files={"file": f})
dataset_id = upload.json()["dataset_id"]
dash = requests.get(f"{BASE}/dashboard", headers=headers, params={"dataset_id": dataset_id}).json()
assert "csat_pct" in dash["kpis"], "csat_pct missing from API response"
print("csat_pct via API:", dash["kpis"]["csat_pct"])
print("ALL GOOD")
