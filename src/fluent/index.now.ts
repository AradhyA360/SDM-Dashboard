/**
 * Fluent source for the ServiceNow-side half of the Service Health
 * Dashboard integration (the other half is the FastAPI backend in
 * /backend/app/routers/servicenow.py, which talks to this instance over
 * the Table API).
 *
 * This deliberately does NOT define an OAuth Application Registry
 * (oauth_entity) here - a client secret is something the platform
 * generates, not something that belongs in source-controlled code.
 * Create it by hand instead:
 *   System OAuth > Application Registry > New >
 *   "Create an OAuth API endpoint for external clients"
 * then copy the generated Client ID/Secret into the backend's .env as
 * SERVICENOW_OAUTH_CLIENT_ID / SERVICENOW_OAUTH_CLIENT_SECRET (never
 * commit real values - see .env.example). Full walkthrough in the
 * README's "ServiceNow Integration" section.
 */
import { Role, Property } from "@servicenow/sdk/core";

// Least-privilege role for the dashboard's integration account: enough to
// read/update incidents (itil) and nothing more. Grant this to a
// dedicated integration user - never point the dashboard at a personal
// admin account. See the Security Checklist in /backend for why.
export const integrationRole = Role({
  name: "x_yourco_snhealth.integration",
  description: "Least-privilege role for the Service Health Dashboard's ServiceNow integration user - read/update incidents only.",
  containsRoles: ["itil"],
});

// Non-secret, informational config only. Never put a client secret,
// password, or token in a Property - use the OAuth Application Registry
// (created manually, see above) or the backend's own .env for those.
export const dashboardBaseUrlProperty = Property({
  $id: "dashboard-base-url",
  name: "x_yourco_snhealth.dashboard_base_url",
  type: "string",
  value: "",
  description: "Base URL of the Service Health Dashboard backend that connects to this instance. Informational only.",
  roles: {
    read: ["admin", integrationRole],
    write: ["admin"],
  },
});
