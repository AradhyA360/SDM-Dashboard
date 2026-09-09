# Executive Service Health Dashboard

An AI-powered, ServiceNow-style dashboard for Service Delivery Managers to monitor Application
Management Services (AMS) health — upload ITSM ticket exports, get instant KPIs and charts,
track SLA compliance by P1-P4 priority, drill into any associate's ticket backlog, leave them
feedback, and generate AI executive insights (bring your own OpenAI / Gemini / Claude / Groq key).

Full-stack project: **FastAPI + SQLAlchemy + SQLite** backend, **React + Vite + Tailwind** frontend,
with JWT authentication, a 3-tier approval-gated role system (Admin / SDM / Associate), and a
pluggable AI provider layer.

---

## Project Structure

```
service-health-dashboard/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app entrypoint
│   │   ├── config.py          # Settings (env-driven)
│   │   ├── database.py        # SQLAlchemy engine/session
│   │   ├── models.py          # User, RefreshToken, PasswordResetToken, AssociateFeedback
│   │   ├── schemas.py         # Pydantic request/response models
│   │   ├── security.py        # bcrypt hashing + JWT
│   │   ├── deps.py            # auth dependencies (get_current_user, require_admin)
│   │   ├── routers/
│   │   │   ├── auth.py            # register/login/refresh/logout/forgot/reset/profile
│   │   │   ├── upload.py          # CSV/Excel upload (admin only)
│   │   │   ├── dashboard.py       # KPIs + charts + filters + backlog + ticket rows
│   │   │   ├── ai.py              # AI insight generation
│   │   │   ├── settings_router.py # API key mgmt + admin user mgmt
│   │   │   └── feedback.py        # SDM -> associate feedback
│   │   └── services/
│   │       ├── data_processing.py # pandas cleaning, KPI/chart aggregation, backlog-by-associate
│   │       ├── ai_providers.py    # BaseAIProvider / OpenAI / Gemini / Claude / Groq
│   │       └── session_store.py   # in-memory, session-only API key storage
│   ├── sample_data/
│   │   ├── generate_sample.py     # generates sample_tickets.csv (~150 rows, full schema below)
│   │   └── sample_tickets.csv
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/
    ├── src/
    │   ├── pages/          # Welcome, Login, Register, Forgot/ResetPassword, Dashboard,
    │   │                   # Upload, Backlog, Tickets, AIInsights, Analytics, Settings,
    │   │                   # Profile, About
    │   ├── components/     # Sidebar, AppHeader, AppFooter, Layout, ProtectedRoute,
    │   │                   # KpiCard, ChartCard, RadialGauge, CountUp, AIThinkingLoader, Badges
    │   ├── components/marketing/  # public landing page sections
    │   ├── context/        # AuthContext, ThemeContext
    │   └── services/api.js # axios instance with auto refresh-token interceptor
    ├── package.json
    └── vite.config.js
```

---

## Requirements

- Python 3.10+ (avoid brand-new versions like 3.14 until wheels for pandas/etc. catch up — see note below)
- Node.js 18+

---

## Backend Setup

```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env            # then edit SECRET_KEY to a long random string

uvicorn app.main:app --reload --port 8000
```

The API will be live at `http://127.0.0.1:8000`. Interactive docs: `http://127.0.0.1:8000/docs`
(requires internet access to load Swagger UI's CSS/JS from a CDN — if that's blocked on your
network, use `/redoc` instead or just call `/health` to confirm the server is up).

A SQLite file `app.db` is created automatically on first run — no separate DB setup needed.
To use PostgreSQL later, just change `DATABASE_URL` in `.env`.

> **Note on Python versions:** pandas and a few other dependencies may not have prebuilt
> wheels for very new Python releases yet, which forces pip to compile from source (needs a
> C compiler, especially painful on Windows). If `pip install -r requirements.txt` fails with
> a `meson`/`vswhere.exe`/build error, use Python 3.11 or 3.12 for the venv instead.

### Generate the sample dataset (optional)

```bash
cd backend/sample_data
python3 generate_sample.py
```

This regenerates `sample_tickets.csv` (~150 rows, dates anchored to "now" so it always looks
like a fresh snapshot) that you can upload from the Upload page to try the dashboard immediately.

---

## MySQL Setup (optional — SQLite is the default and needs no setup)

The backend uses SQLAlchemy, so switching from SQLite to MySQL is just a connection string
change — no code changes, no migration tooling needed for a fresh database. This is what lets
the app track upload history (the **Uploaded Data** page), users, refresh tokens, and associate
feedback in MySQL instead of a local file, which matters once more than one person needs to see
the same history or you want it to survive the backend's working directory being wiped.

### 1. Install MySQL

- **macOS:** `brew install mysql && brew services start mysql`
- **Ubuntu/Debian:** `sudo apt install mysql-server && sudo systemctl start mysql`
- **Windows:** download the installer from [dev.mysql.com/downloads/installer](https://dev.mysql.com/downloads/installer/) and run it (choose "Server only" if you don't need Workbench)
- **Or skip local install entirely:** use a managed MySQL (PlanetScale, AWS RDS, Azure Database for MySQL, etc.) — steps 2 onward are the same, just point at the managed host.

### 2. Create the database and a dedicated user

Connect as root (`mysql -u root -p`) and run:

```sql
CREATE DATABASE service_health_dashboard CHARACTER SET utf8mb4;
CREATE USER 'service_health_user'@'localhost' IDENTIFIED BY 'your-strong-password-here';
GRANT ALL PRIVILEGES ON service_health_dashboard.* TO 'service_health_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Using a dedicated user (rather than root) means the app's blast radius is limited to this one
database if a credential ever leaks.

### 3. Point the backend at it

The MySQL driver (`PyMySQL`) is already in `requirements.txt`, so no extra install step. In
`backend/.env`, comment out the SQLite line and set:

```bash
DATABASE_URL=mysql+pymysql://service_health_user:your-strong-password-here@localhost:3306/service_health_dashboard
```

Adjust host/port if MySQL isn't running locally on the default port, and remember to URL-encode
any special characters in the password (e.g. `@` becomes `%40`).

### 4. Start the backend as normal

```bash
uvicorn app.main:app --reload --port 8000
```

SQLAlchemy creates all the tables (`users`, `refresh_tokens`, `password_reset_tokens`,
`associate_feedback`, `datasets`) automatically on first startup — same as it does for SQLite,
just against MySQL this time. No manual `CREATE TABLE` statements needed.

### 5. Verify it's actually using MySQL

```bash
mysql -u service_health_user -p service_health_dashboard -e "SHOW TABLES;"
```

You should see all five tables listed. Register a user through the app and re-run the query
against the `users` table to confirm rows are landing in MySQL, not a leftover `app.db` file.

### What still isn't in MySQL

Uploaded ticket data itself stays cached as Parquet files under `backend/storage/` regardless of
which database you use — only the _metadata about_ each upload (filename, row count, who
uploaded it, when) lives in the database. And AI provider API keys, by design, never touch any
database at all — they live in server memory for the current session only (see Notes & Scope
below).

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` requests to
`http://127.0.0.1:8000`, so make sure the backend is running first.

---

## Ticket Data Schema

Upload a CSV or Excel export with these columns (ServiceNow-style naming). Missing columns are
handled gracefully — the dashboard fills in sensible defaults rather than failing, and header
matching is case/whitespace-insensitive with legacy aliases for the older schema
(`Ticket ID`→`Number`, `Open Date`→`Opened`, `Status`→`State`, `Module`→`Category`,
`Customer Name`→`Company`, `Application Name`→`Business Service`, `Assigned Engineer`→`Assigned To`).

| Column                         | Notes                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `Number`                       | Ticket ID, e.g. `INC0010023`. Auto-generated if absent.                                                     |
| `Type`                         | Incident / Service Request / Defect                                                                         |
| `State`                        | New / In Progress / On Hold / Resolved / Closed / Cancelled                                                 |
| `Priority`                     | `P1` / `P2` / `P3` / `P4` — SLA windows are fixed: **P1 = 4 hours, P2 = 2 days, P3 = 5 days, P4 = 10 days** |
| `Category`                     | e.g. Payments, Settlements, Reporting                                                                       |
| `Short Description`            | Free text                                                                                                   |
| `Assignment Group`             | Team name                                                                                                   |
| `Assigned To`                  | The associate/engineer working the ticket                                                                   |
| `Name`                         | Caller / requester name                                                                                     |
| `Opened`                       | When the ticket was raised                                                                                  |
| `Associate Assignment Date`    | When it was assigned to the associate                                                                       |
| `SLA Due Date`                 | If omitted, computed automatically from `Opened` + the priority's SLA window                                |
| `Resolved Date`                | When marked Resolved (may differ from Closed Date)                                                          |
| `Closed Date`                  | When fully Closed                                                                                           |
| `Pending Reason`               | Free text, typically set when State = On Hold                                                               |
| `Company`                      | Client/customer company                                                                                     |
| `Business Service`             | Application/service impacted                                                                                |
| `Country`, `Location`          | Where the caller/associate is based                                                                         |
| `Main Contact Name`, `Manager` | Additional account context                                                                                  |
| `Updated By`                   | Last person to touch the ticket                                                                             |

---

## ServiceNow Integration

The backend can connect directly to a ServiceNow instance — including a free
Personal Developer Instance (PDI) — to pull incidents in as a normal dataset
and to write AI-generated resolution/close notes back onto the incident they
came from. It's off by default: every `/servicenow/*` endpoint checks that
`SERVICENOW_INSTANCE_URL` is set before doing anything.

### Phase 1 — Get a ServiceNow instance

1. Go to [developer.servicenow.com](https://developer.servicenow.com) and sign up.
2. Request an instance (**Request Instance**), pick the latest release, and wait a few minutes.
3. You'll get a URL like `https://devXXXXX.service-now.com` — for this project that's
   **`https://dev375971.service-now.com`** — plus an admin username/password. Save both securely.
4. PDIs get reclaimed after ~10 days of inactivity, so log in periodically once you're using it.
   Incident Management is pre-activated by default — no extra setup needed there.

### Phase 2 — Configure this backend

Copy `.env.example` to `.env` in `backend/` and fill in:

```bash
SERVICENOW_INSTANCE_URL=https://dev375971.service-now.com
SERVICENOW_TABLE=incident
SERVICENOW_AUTH_MODE=oauth   # default — "basic" is available for quick local testing only
SERVICENOW_OAUTH_CLIENT_ID=...
SERVICENOW_OAUTH_CLIENT_SECRET=...
SERVICENOW_USERNAME=...
SERVICENOW_PASSWORD=...
```

**OAuth 2.0 is the default and recommended mode** — this is what the Security Checklist for this
integration calls for on anything beyond a quick local test:

1. On the instance, go to **System OAuth → Application Registry → New → Create an OAuth API
   endpoint for external clients**. Note the generated Client ID/Secret.
2. Fill in `SERVICENOW_OAUTH_CLIENT_ID`, `SERVICENOW_OAUTH_CLIENT_SECRET`, plus
   `SERVICENOW_USERNAME`/`SERVICENOW_PASSWORD` (used for the password grant — ideally a dedicated
   integration account with the `x_yourco_snhealth.integration` role from the Fluent app below,
   not a personal admin login). The backend fetches and caches the access token in memory only —
   it's never written to disk or logged, and is refreshed automatically before it expires.
3. Restart the backend, then check `GET /servicenow/status` (Admin only) to confirm it's
   reachable — this never returns credentials or tokens, only status.
4. If this backend runs behind a corporate firewall/proxy, make sure outbound access to the
   instance URL is whitelisted.

Need to fall back to Basic Auth for a quick local test instead? Set `SERVICENOW_AUTH_MODE=basic`
and just fill in `SERVICENOW_USERNAME`/`SERVICENOW_PASSWORD` — skip the OAuth Application Registry
step above.

### Fluent app — making this repo pickable by the ServiceNow IDE

This repo also includes a small **ServiceNow Fluent SDK** app at its root (`now.config.json`,
`package.json`, `tsconfig.json`, `src/fluent/`) — the ServiceNow-side companion to the FastAPI
backend above. Cloning this repo from **ServiceNow IDE → Git: Clone** (or Studio's "Import from
source control") requires `now.config.json` and `package.json` in the repo's base directory; this
is what makes the clone succeed instead of failing with "No fluent app found".

It currently defines:

- **`integrationRole`** — a least-privilege role (`x_yourco_snhealth.integration`, containing only
  `itil`) to grant the dedicated integration account from Phase 2, instead of using a personal
  admin login.
- **`dashboardBaseUrlProperty`** — a non-secret system property recording where the dashboard
  backend lives. Nothing secret is ever defined here — the OAuth Application Registry (client
  ID/secret) is created by hand in Phase 2 above on purpose, since a client secret is something
  the platform generates, not something that belongs in source-controlled code.

The placeholder `scope` (`x_yourco_snhealth`) and `scopeId` (32 zeros) in `now.config.json` need to
become real before you can build/install this against `dev375971`:

```bash
npm install
npx @servicenow/sdk auth --add https://dev375971.service-now.com --type oauth --alias dev375971
npx @servicenow/sdk init   # run inside this directory; pick a real scope, e.g. x_<your-vendor-prefix>_snhealth
```

`init` detects the existing project and updates `scope`/`scopeId` in `now.config.json` to match
what it creates on the instance (don't hand-edit a `scopeId` yourself — it must match a real
`sys_scope` record). If you rename the scope away from `x_yourco_snhealth`, also update the
`x_yourco_snhealth.*` names inside `src/fluent/index.now.ts` and the property name in Phase 2's
`.env` note to match. Once that's done:

```bash
npm run build              # compiles src/fluent into dist/app
npm run install:instance   # installs it onto dev375971
```

### Phase 3 — Pull incidents in / push resolutions back

- `POST /servicenow/sync-incidents` — pulls incidents from ServiceNow (optionally filtered with a
  `sysparm_query` string, e.g. `active=true^priority=1`) and stores them as a Dataset, exactly like
  a manual CSV/Excel upload. The rest of the app (dashboard, tickets list, command center) works
  the same either way.
- `GET /servicenow/incidents/{sys_id}` — live detail for one incident.
- `POST /servicenow/incidents/{sys_id}/generate-resolution` — drafts a resolution/close note with
  your configured AI provider (Settings → AI Provider) from that incident's live data. This only
  returns a draft; it does not write anything.
- `POST /servicenow/incidents/{sys_id}/resolution` — writes `close_notes` / `resolution_notes` /
  `close_code` / `state` back onto the incident (PATCH). `close_code` is validated against the
  instance's own live choice list first (`GET /servicenow/close-codes`), so an invalid value is
  rejected here instead of silently failing on ServiceNow's side.
- `GET /servicenow/audit-log` — every push attempt, successful or not, for traceability.

Both sync and resolution-push are restricted to Admin/SDM accounts, same as file uploads.

### Security notes

- OAuth 2.0 is the default mode — only fall back to Basic Auth for quick local testing.
- Use a dedicated integration account with only the roles it needs (`itil` is enough to read/update
  incidents) rather than a personal admin login.
- Never commit real credentials — `.env` is gitignored; only `.env.example` (with blank secrets)
  is checked in.
- `close_code` and `state` are always validated against the instance's own choice list before a
  write is attempted.
- Every resolution push, successful or failed, is written to the `servicenow_audit_logs` table.
- If you're testing against real customer ticket data rather than a PDI's sample data, make sure
  any required data-access/compliance approvals are in place first, and mask/anonymize PII before
  using it in any non-production test.

---

## Using the App

1. **Register** an account — choose the **Admin** role to be able to upload data and give
   associate feedback (Viewers can only view dashboards/insights). Additional people can also be
   promoted to Admin later from **Settings → User Management** (Make Admin / Make Viewer buttons)
   — you don't need to register as Admin to eventually become one.
2. **Login**.
3. Go to **Upload Data** (Admin only) and upload `sample_tickets.csv`, or your own ITSM export
   matching the schema above.
4. Go to **Uploaded Data** to see every file ever uploaded — filename, row count, uploader, and
   timestamp — switch back to an older upload with **Activate**, or remove one with **Delete**
   (Admin only for both actions).
5. View the **Dashboard**: total ticket backlog per month, Open/Resolved/Closed counts (kept
   separate on purpose), SLA Compliant vs Non-Compliant percentage, SLA At Risk, P1 tickets, and
   a "What am I looking at?" panel explaining every KPI in plain English. Filter by
   status/priority/category/company/business service/assignee.
6. Go to **Ticket Backlog** to see open tickets per associate, bucketed by age (0-30 / 31-60 /
   61-90 / 90+ days) — click any associate to open their full ticket list.
7. On the **Tickets** page (reached via Backlog, the Dashboard's Associate Workload chart, or
   directly), see every ServiceNow-style column for a ticket, click any column header to sort by
   it (click again to reverse, a third click resets), and — as an Admin — leave dated,
   attributed **feedback** for that associate.
8. Go to **Settings** and paste an API key for OpenAI, Gemini, Claude, or Groq (kept only for
   your current server session — never written to disk or database).
9. Go to **AI Insights** and click **Generate Insights** for an AI-written executive summary,
   root cause analysis, risks, recommendations, and a next-week prediction — shown alongside real
   supporting charts (SLA compliance, priority distribution) from your actual ticket data, not
   just prose.
10. **Analytics** has deeper breakdowns (top categories, pending reasons, company/business-service
    distribution, monthly trend).
11. **Profile** lets you update your name, organization, AI provider preference, and password.

---

## Notes & Scope

- **Password reset emails**: this project doesn't wire up an SMTP/email service. The
  `forgot-password` endpoint returns the reset token directly in the response for local/dev use
  (clearly marked `dev_reset_token`) — swap this for a real email provider before production use.
- **AI provider keys** are stored in an in-memory dict on the backend process, scoped per user,
  and cleared on server restart — by design, so keys are never persisted.
- **Dataset storage**: uploaded datasets are cached as Parquet files under `backend/storage/`.
  This is a lightweight approach suited to a single-team/demo deployment; swap for object storage
  (S3, etc.) for multi-tenant production use.
- **Associate feedback** is stored in SQLite (`associate_feedback` table), keyed by the
  associate's name as it appears on tickets — if an associate's name is spelled differently
  across uploads, feedback history won't automatically merge.
- **SLA compliance** is computed from the fixed P1-P4 windows against each ticket's actual
  resolution (or, for still-open tickets, against right now) — cancelled tickets are excluded
  since an SLA can't be "missed" on a withdrawn ticket.
- The chart library covers 15+ chart types across the Dashboard and Analytics pages — `ChartCard.jsx`
  is a generic bar/line/area/pie component with click-through support, so adding more is a matter
  of adding another `<ChartCard />` with a new dataset.
- Security implemented: bcrypt password hashing, JWT access tokens + rotating refresh tokens,
  role-based route guards (backend + frontend), input validation via Pydantic, parameterized
  SQL via SQLAlchemy ORM (no raw SQL / injection surface), CORS configuration. For a real
  production deployment, also add HTTPS termination, rate limiting, and a secrets manager for
  `SECRET_KEY`.
