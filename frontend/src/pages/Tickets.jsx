import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  Fragment,
} from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ticket,
  MessageSquarePlus,
  Send,
  X,
  Clock,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Smile,
  Search,
  Download,
  CheckCheck,
  History,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  Columns3,
  Rows3,
  Tag,
  AlertTriangle,
} from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { StateBadge, PriorityBadge, AtRiskBadge } from "../components/Badges";
import FilterBar from "../components/FilterBar";
import { downloadCsv } from "../lib/csv";

const COLUMN_LABELS = {
  Number: "Number",
  Opened: "Opened",
  "Short Description": "Short Description",
  Category: "Category",
  Priority: "Priority",
  State: "State",
  Name: "Name",
  "Assignment Group": "Assignment Group",
  "Assigned To": "Assigned To",
  Company: "Company",
  "Business Service": "Business Service",
  Country: "Country",
  "Main Contact Name": "Main Contact Name",
  Manager: "Manager",
  Location: "Location",
  "Updated By": "Updated By",
  "Associate Assignment Date": "Associate Assignment Date",
  "At Risk": "At Risk",
  "Effective Type": "Ticket Type",
  "Manually Classified": "Manually Set",
};

// Matches backend PRIORITY_SLA_HOURS in data_processing.py - the fixed SLA
// window per priority, used below to recalculate SLA status from TCS-queue
// active time only (Open/In progress time inside a TCS-owned queue), rather
// than the wall-clock Opened->Resolved SLA used elsewhere in the app.
const PRIORITY_SLA_HOURS = { P1: 4, P2: 48, P3: 120, P4: 240 };
const AT_RISK_THRESHOLD_PCT = 80; // >=80% of the TCS SLA window consumed, not yet breached

// Query params -> what dp._build_filters/apply_filters accepts on the backend.
const DRILLDOWN_PARAMS = [
  "status",
  "priority",
  "module",
  "customer",
  "application",
  "assignee",
  "date_from",
  "date_to",
  "view",
  "q",
];

// Human-readable label for each drill-down param/value combo, used to build
// the page title and the "why am I seeing this" filter chips.
const VIEW_LABELS = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
  backlog: "Backlog (currently open)",
  sla_compliant: "SLA Compliant",
  sla_breach: "SLA Non-Compliant",
  sla_at_risk: "SLA At Risk",
  solved: "Solved (Resolved or Closed)",
};
const PARAM_LABELS = {
  status: "Status",
  priority: "Priority",
  module: "Category",
  customer: "Company",
  application: "Business Service",
  assignee: "Assigned To",
  date_from: "From",
  date_to: "To",
  view: "View",
  q: "Search",
};

// Params the FilterBar dropdowns write directly (distinct from `view`/`q`,
// which are set by KPI/chart drill-down and the search box respectively).
const FILTER_BAR_KEYS = [
  "status",
  "priority",
  "module",
  "customer",
  "application",
  "assignee",
  "date_from",
  "date_to",
];

// Columns shown when "Concise view" is on - just enough to triage at a
// glance. Every other column moves into the per-row "All fields" panel
// (see the expanded-row section below) instead of disappearing.
const CONCISE_COLUMNS = [
  "Number",
  "Opened",
  "Short Description",
  "Priority",
  "State",
  "Assigned To",
  "At Risk",
  "Effective Type",
];

export default function Tickets() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const assignee = searchParams.get("assignee") || "";
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "sdm";

  const barFilters = useMemo(() => {
    const obj = {};
    for (const key of FILTER_BAR_KEYS) {
      const v = searchParams.get(key);
      if (v) obj[key] = v;
    }
    return obj;
  }, [searchParams]);

  function updateFilterParam(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(`/tickets?${next.toString()}`);
  }

  function clearFilterBarParams() {
    const next = new URLSearchParams(searchParams);
    FILTER_BAR_KEYS.forEach((k) => next.delete(k));
    navigate(`/tickets?${next.toString()}`);
  }

  const activeDrilldown = useMemo(() => {
    const entries = [];
    for (const key of DRILLDOWN_PARAMS) {
      const v = searchParams.get(key);
      if (!v) continue;
      const label = key === "view" ? VIEW_LABELS[v] || v : v;
      entries.push([key, label]);
    }
    return entries;
  }, [searchParams]);

  function removeDrilldownParam(key) {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    navigate(`/tickets?${next.toString()}`);
  }

  const pageTitle = useMemo(() => {
    if (activeDrilldown.length === 0) return "All Tickets";
    if (activeDrilldown.length === 1 && activeDrilldown[0][0] === "assignee") {
      return `Tickets Assigned to ${activeDrilldown[0][1]}`;
    }
    if (activeDrilldown.length === 1 && activeDrilldown[0][0] === "q") {
      return `Search results for "${activeDrilldown[0][1]}"`;
    }
    return activeDrilldown.map(([, label]) => label).join(" \u00b7 ");
  }, [activeDrilldown]);

  const [datasetId, setDatasetId] = useState(null);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [associateCsat, setAssociateCsat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");

  // Concise view: shrink the outer table to a handful of columns. Every
  // column still lives in each row's expandable "All fields" panel, laid
  // out as a wrapping grid so nothing there needs its own scrollbar.
  const [conciseView, setConciseView] = useState(true);
  const displayColumns = useMemo(
    () =>
      conciseView
        ? columns.filter((c) => CONCISE_COLUMNS.includes(c))
        : columns,
    [columns, conciseView],
  );

  const [expandedTicket, setExpandedTicket] = useState(null);
  const [historyByTicket, setHistoryByTicket] = useState({});
  const [historyLoading, setHistoryLoading] = useState(null);
  const [historyError, setHistoryError] = useState({});

  // Measures the visible width of the horizontally-scrolling table wrapper,
  // so the expanded queue-history panel (see tableScrollRef usage further
  // down) can be pinned to exactly that width and stay fully on screen,
  // completely static, no matter how far the outer ticket table - which
  // always shows every column - is scrolled left/right.
  const tableScrollRef = useRef(null);
  const [scrollViewWidth, setScrollViewWidth] = useState(null);
  useEffect(() => {
    function measure() {
      if (tableScrollRef.current)
        setScrollViewWidth(tableScrollRef.current.clientWidth);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  async function toggleTicketHistory(number) {
    if (!number) return;
    if (expandedTicket === number) {
      setExpandedTicket(null);
      return;
    }
    setExpandedTicket(number);
    if (historyByTicket[number] || historyLoading === number) return;
    setHistoryLoading(number);
    try {
      const { data } = await api.get(
        `/tickets/${encodeURIComponent(number)}/history`,
      );
      setHistoryByTicket((prev) => ({ ...prev, [number]: data.events || [] }));
      setHistoryError((prev) => ({ ...prev, [number]: null }));
    } catch (err) {
      setHistoryError((prev) => ({
        ...prev,
        [number]: err.response?.data?.detail || "Could not load history",
      }));
    } finally {
      setHistoryLoading(null);
    }
  }

  function formatHistoryTimestamp(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatTimeSpent(ev) {
    if (ev.time_spent) return ev.time_spent;
    if (ev.time_spent_minutes != null) {
      const h = Math.floor(ev.time_spent_minutes / 60);
      const m = Math.round(ev.time_spent_minutes % 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    return "—";
  }

  function formatMinutes(mins) {
    if (mins == null || Number.isNaN(mins)) return "—";
    const total = Math.round(mins);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Recalculates SLA status for one ticket from its queue-movement history,
  // per TCS SLA rules: only time spent Open/In progress inside a TCS-owned
  // queue (ABAP/FI/SD/MM) counts toward the clock. Non-TCS/external queue
  // time (L1/L2/L3) and Hold time never count. Mirrors the amber/red/blue
  // shading already used on the history table below.
  function computeTcsSlaStats(priority, events) {
    if (!events || events.length === 0) return null;
    let totalMinutes = 0;
    let tcsActiveMinutes = 0;
    let nonTcsMinutes = 0;
    let otherMinutes = 0; // TCS queue time that isn't Open/In progress (e.g. Hold), or unclassified queues

    for (const ev of events) {
      const mins = ev.time_spent_minutes ?? 0;
      totalMinutes += mins;
      const statusKey = (ev.status || "").toLowerCase();
      const isSlaActive =
        ev.is_tcs_team === true &&
        (statusKey === "open" || statusKey === "in progress");
      if (isSlaActive) {
        tcsActiveMinutes += mins;
      } else if (ev.is_tcs_team === false) {
        nonTcsMinutes += mins;
      } else {
        otherMinutes += mins;
      }
    }

    const slaTargetMinutes = (PRIORITY_SLA_HOURS[priority] ?? 240) * 60;
    const pctOfSla = slaTargetMinutes
      ? (tcsActiveMinutes / slaTargetMinutes) * 100
      : 0;
    const status =
      tcsActiveMinutes >= slaTargetMinutes
        ? "Breached"
        : pctOfSla >= AT_RISK_THRESHOLD_PCT
          ? "At Risk"
          : "Not Breached";

    return {
      totalMinutes,
      tcsActiveMinutes,
      nonTcsMinutes,
      otherMinutes,
      slaTargetMinutes,
      pctOfSla: Math.min(pctOfSla, 999),
      tcsPctOfTotal: totalMinutes ? (tcsActiveMinutes / totalMinutes) * 100 : 0,
      nonTcsPctOfTotal: totalMinutes ? (nonTcsMinutes / totalMinutes) * 100 : 0,
      status,
    };
  }

  function handleSort(col) {
    if (sortColumn === col) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        // third click clears the sort, back to the original Opened-desc order
        setSortColumn(null);
        setSortDirection("asc");
      }
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  }

  // Multi-keyword search across the currently-loaded page of rows: every
  // term must match somewhere (AND across terms, OR across columns per
  // term) - same semantics as the backend's global search, just scoped to
  // what's already on screen instead of round-tripping to the server.
  const searchedRows = useMemo(() => {
    const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return rows;
    return rows.filter((row) => {
      const haystacks = columns.map((col) =>
        String(row[col] ?? "").toLowerCase(),
      );
      return terms.every((term) => haystacks.some((h) => h.includes(term)));
    });
  }, [rows, columns, searchQuery]);

  const sortedRows = useMemo(() => {
    if (!sortColumn) return searchedRows;
    const copy = [...searchedRows];
    copy.sort((a, b) => {
      const av = String(a[sortColumn] ?? "");
      const bv = String(b[sortColumn] ?? "");
      const cmp = av.localeCompare(bv, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [searchedRows, sortColumn, sortDirection]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: current } = await api.get("/dashboard/current-dataset");
      const ids = current.dataset_ids?.join(",");
      if (!ids) {
        setLoading(false);
        return;
      }
      setDatasetId(ids);
      const params = { dataset_id: ids };
      for (const key of DRILLDOWN_PARAMS) {
        const v = searchParams.get(key);
        if (v) params[key] = v;
      }
      const { data } = await api.get("/dashboard/tickets", { params });
      setColumns(data.columns);
      setRows(data.rows);
      setFilterOptions(data.filter_options || {});

      // Customer Satisfaction is scoped to a specific associate, not the whole
      // dashboard - only fetch/show it once we know which associate this is.
      if (assignee) {
        const { data: dash } = await api.get("/dashboard", { params });
        setAssociateCsat(dash.kpis);
      } else {
        setAssociateCsat(null);
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [assignee, searchParams]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Manual User Request / Incident classification. `classifyingNumber` is
  // whichever row currently has a request in flight (disables its buttons).
  // `similarPrompt` holds the "apply this to N similar tickets too?" prompt
  // returned by the backend right after a single ticket is classified -
  // null when there's nothing to confirm.
  const [classifyingNumber, setClassifyingNumber] = useState(null);
  const [similarPrompt, setSimilarPrompt] = useState(null);
  const [bulkApplying, setBulkApplying] = useState(false);

  function applyLocalType(numbers, ticketType) {
    const set = new Set(numbers);
    setRows((prev) =>
      prev.map((r) =>
        set.has(r.Number)
          ? { ...r, "Effective Type": ticketType, "Manually Classified": true }
          : r,
      ),
    );
  }

  async function classifyTicket(number, ticketType) {
    if (!datasetId) return;
    setClassifyingNumber(number);
    try {
      const { data } = await api.post(
        `/tickets/${encodeURIComponent(number)}/classify`,
        { ticket_type: ticketType, dataset_id: datasetId },
      );
      applyLocalType([number], ticketType);
      if (data.similar_candidates && data.similar_candidates.length > 0) {
        setSimilarPrompt({
          number,
          ticketType,
          candidates: data.similar_candidates,
          groupKey: data.group_key,
        });
      }
    } catch (err) {
      setError(
        err.response?.data?.detail || "Failed to update ticket type",
      );
    } finally {
      setClassifyingNumber(null);
    }
  }

  async function applySimilarPrompt() {
    if (!similarPrompt) return;
    setBulkApplying(true);
    try {
      await api.post("/tickets/classify-bulk", {
        incident_numbers: similarPrompt.candidates,
        ticket_type: similarPrompt.ticketType,
        group_key: similarPrompt.groupKey,
      });
      applyLocalType(similarPrompt.candidates, similarPrompt.ticketType);
      setSimilarPrompt(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to bulk-apply ticket type");
    } finally {
      setBulkApplying(false);
    }
  }

  const loadFeedback = useCallback(async () => {
    if (!assignee) return;
    setFeedbackLoading(true);
    try {
      const { data } = await api.get("/feedback", {
        params: { associate_name: assignee },
      });
      setFeedbackHistory(data);
    } finally {
      setFeedbackLoading(false);
    }
  }, [assignee]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  async function submitFeedback() {
    if (!feedbackMessage.trim()) return;
    setFeedbackSubmitting(true);
    try {
      await api.post("/feedback", {
        associate_name: assignee,
        message: feedbackMessage.trim(),
      });
      setFeedbackMessage("");
      await loadFeedback();
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  async function acknowledgeFeedback(id) {
    await api.post(`/feedback/${id}/acknowledge`);
    await loadFeedback();
  }

  function exportCsv() {
    const filenameSafe = assignee
      ? assignee.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
      : "all";
    downloadCsv(`tickets-${filenameSafe}.csv`, columns, sortedRows);
  }

  const isSubject =
    assignee &&
    user?.full_name?.trim().toLowerCase() === assignee.trim().toLowerCase();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-96" />
      </div>
    );
  }

  if (!datasetId) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
        <Ticket size={36} className="text-slate-300" />
        <p className="text-lg font-semibold">No dataset uploaded yet</p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">
          Go to Upload
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {similarPrompt && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
          <AlertTriangle
            size={16}
            className="shrink-0 text-amber-500 dark:text-amber-400"
          />
          <p className="flex-1 text-amber-800 dark:text-amber-200">
            Found <strong>{similarPrompt.candidates.length}</strong> other
            ticket
            {similarPrompt.candidates.length === 1 ? "" : "s"} that look like
            the same kind of thing as {similarPrompt.number}. Send all of
            them to{" "}
            <strong>
              {similarPrompt.ticketType === "user_request"
                ? "User Request"
                : "Incident"}
            </strong>{" "}
            too?
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={applySimilarPrompt}
              disabled={bulkApplying}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {bulkApplying
                ? "Applying…"
                : `Apply to all ${similarPrompt.candidates.length}`}
            </button>
            <button
              onClick={() => setSimilarPrompt(null)}
              disabled={bulkApplying}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:text-amber-200"
            >
              No, just this one
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            {pageTitle}
          </h2>
          {activeDrilldown.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {activeDrilldown.map(([key, label]) => (
                <span
                  key={key}
                  className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                >
                  <span className="text-brand-400">{PARAM_LABELS[key]}:</span>{" "}
                  {label}
                  <button
                    onClick={() => removeDrilldownParam(key)}
                    className="text-brand-400 hover:text-brand-700 dark:hover:text-brand-100"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <Link
                to="/tickets"
                className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
              >
                Clear all
              </Link>
            </div>
          )}
          <p className="mt-1 text-sm text-slate-500">
            {sortedRows.length} of {rows.length} ticket
            {rows.length === 1 ? "" : "s"}
            {searchQuery ? " matching your search" : " matching this view"}
          </p>
        </div>
        <div className="flex gap-2">
          {activeDrilldown.length === 0 && (
            <p className="text-xs text-slate-400">
              Tip: click any KPI card, chart, or associate on the Dashboard to
              filter here.
            </p>
          )}
          {sortedRows.length > 0 && (
            <button
              onClick={() => setConciseView((v) => !v)}
              className="btn-secondary flex items-center gap-2 text-sm"
              title="Show fewer columns in the table; every field stays available per-row by expanding it"
            >
              {conciseView ? <Rows3 size={14} /> : <Columns3 size={14} />}
              {conciseView ? "Full View" : "Concise View"}
            </button>
          )}
          {sortedRows.length > 0 && (
            <button
              onClick={exportCsv}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Download size={14} /> Export CSV
            </button>
          )}
          {assignee && canManage && (
            <button
              onClick={() => setFeedbackOpen(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <MessageSquarePlus size={15} /> Give Feedback
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <FilterBar
        filters={barFilters}
        filterOptions={filterOptions}
        onChange={updateFilterParam}
        onDateChange={updateFilterParam}
        onClear={clearFilterBarParams}
      />

      {assignee && associateCsat && (
        <div className="card flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <Smile size={20} />
          </div>
          <div>
            <p className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold">
                {associateCsat.csat_pct}%
              </span>
              <span className="text-sm font-medium text-slate-500">
                Customer Satisfaction (est.) for {assignee}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Full credit for tickets solved within SLA, half credit for tickets
              solved but past SLA, against all {associateCsat.total_tickets}{" "}
              assigned tickets. Not a real survey score.
            </p>
          </div>
        </div>
      )}

      {assignee && feedbackHistory.length > 0 && (
        <div className="card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-400">
            <MessageSquarePlus size={15} /> Feedback History for {assignee}
          </p>
          <div className="space-y-3">
            {feedbackHistory.map((f) => (
              <div
                key={f.id}
                className={`rounded-lg p-3.5 text-sm ${f.acknowledged_at ? "bg-slate-50 dark:bg-slate-700/60" : "bg-brand-50/60 dark:bg-brand-950/20"}`}
              >
                <p className="text-slate-700 dark:text-slate-200">
                  {f.message}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock size={11} /> {f.given_by_name} {"\u00b7"}{" "}
                    {new Date(f.created_at).toLocaleString()}
                  </p>
                  {f.acknowledged_at ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCheck size={12} /> Acknowledged
                    </span>
                  ) : isSubject || canManage ? (
                    <button
                      onClick={() => acknowledgeFeedback(f.id)}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      <CheckCheck size={12} /> Mark as read
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search across every column — try multiple keywords, e.g. P1 payment gateway"
          className="input-field pl-9"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {sortedRows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          {searchQuery
            ? "No tickets match your search."
            : "No tickets match this view."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
            <span>
              Click any column name to sort — click again to reverse, a third
              click resets it.{" "}
              {conciseView
                ? "Concise view: click a row to see every field for that ticket without scrolling."
                : "Scroll right for every column, or switch to Concise View."}
            </span>
            {sortColumn && (
              <button
                onClick={() => setSortColumn(null)}
                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Reset sort
              </button>
            )}
          </div>
          <div className="overflow-x-auto" ref={tableScrollRef}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-700/50">
                  <th className="sticky top-0 w-8 px-2 py-3"></th>
                  {displayColumns.map((col) => {
                    const isSorted = sortColumn === col;
                    return (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className={`sticky top-0 cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium transition-colors hover:text-slate-600 dark:hover:text-slate-200 first:sticky first:left-0 first:z-10 first:bg-slate-50/95 dark:first:bg-slate-700/95 ${isSorted ? "text-brand-600 dark:text-brand-400" : ""}`}
                      >
                        <span className="flex items-center gap-1">
                          {COLUMN_LABELS[col] || col}
                          {isSorted ? (
                            sortDirection === "asc" ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ChevronsUpDown
                              size={12}
                              className="text-slate-300 dark:text-slate-600"
                            />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => {
                  const number = row.Number;
                  const isExpanded = expandedTicket === number;
                  const events = historyByTicket[number];
                  return (
                    <Fragment key={number || i}>
                      <tr
                        onClick={() => toggleTicketHistory(number)}
                        className={`cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50/60 dark:border-slate-700/50 dark:hover:bg-slate-700/30 ${isExpanded ? "bg-slate-50/80 dark:bg-slate-700/40" : ""}`}
                      >
                        <td className="px-2 py-3 text-slate-400">
                          {isExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </td>
                        {displayColumns.map((col) => (
                          <td
                            key={col}
                            className={`whitespace-nowrap px-4 py-3 ${col === "Number" ? "sticky left-0 z-10 bg-white font-mono text-xs font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-400" : ""}`}
                            title={
                              typeof row[col] === "string" &&
                              row[col].length > 20
                                ? row[col]
                                : undefined
                            }
                          >
                            {col === "Number" ? (
                              <Link
                                to={`/tickets/${encodeURIComponent(row[col])}${datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ""}`}
                                onClick={(e) => e.stopPropagation()}
                                className="underline decoration-dotted underline-offset-2 hover:text-brand-800 dark:hover:text-brand-300"
                                title={`Open ${row[col]}`}
                              >
                                {row[col]}
                              </Link>
                            ) : col === "State" ? (
                              <StateBadge value={row[col]} />
                            ) : col === "Priority" ? (
                              <PriorityBadge value={row[col]} />
                            ) : col === "At Risk" ? (
                              <AtRiskBadge value={row[col]} />
                            ) : col === "Effective Type" ? (
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  row[col] === "user_request"
                                    ? "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                    : "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                                }`}
                              >
                                {row[col] === "user_request"
                                  ? "User Request"
                                  : "Incident"}
                              </span>
                            ) : col === "Opened" ||
                              col === "Associate Assignment Date" ? (
                              <span className="font-mono text-xs text-slate-500">
                                {row[col]}
                              </span>
                            ) : col === "Short Description" ? (
                              <span className="block max-w-[220px] truncate">
                                {row[col]}
                              </span>
                            ) : (
                              <span className="max-w-[160px] truncate">
                                {row[col]}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-slate-50 bg-slate-50/50 dark:border-slate-700/50 dark:bg-slate-900/30">
                          {/* p-0 on the cell itself - the real padding lives on the sticky
                              inner wrapper below, since the <td> spans the full width of
                              the outer table, which always shows every column. */}
                          <td
                            colSpan={displayColumns.length + 1}
                            className="p-0"
                          >
                            {/* Pinned to the left edge of the horizontally-scrolling table
                                wrapper and capped to its visible width, so this panel - and
                                every one of its own columns - stays fully on screen no matter
                                where the outer ticket table is scrolled to. */}
                            <div
                              className="sticky left-0 max-w-full px-6 py-4"
                              style={
                                scrollViewWidth
                                  ? { width: scrollViewWidth }
                                  : undefined
                              }
                            >
                              {conciseView && (
                                <div className="mb-4">
                                  <div className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                    <Columns3 size={13} /> All fields for{" "}
                                    {number}
                                  </div>
                                  {/* Wrapping key/value grid, not a wide table - every column is
                                    visible at once with no horizontal scrollbar, unlike the
                                    concise outer table above. */}
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white p-3.5 sm:grid-cols-3 md:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/60">
                                    {columns.map((col) => (
                                      <div key={col} className="min-w-0">
                                        <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">
                                          {COLUMN_LABELS[col] || col}
                                        </p>
                                        <div
                                          className="mt-0.5 truncate text-xs font-medium text-slate-700 dark:text-slate-200"
                                          title={
                                            row[col] != null && row[col] !== ""
                                              ? String(row[col])
                                              : undefined
                                          }
                                        >
                                          {col === "State" ? (
                                            <StateBadge value={row[col]} />
                                          ) : col === "Priority" ? (
                                            <PriorityBadge value={row[col]} />
                                          ) : col === "At Risk" ? (
                                            <AtRiskBadge value={row[col]} />
                                          ) : col === "Effective Type" ? (
                                            row[col] === "user_request"
                                              ? "User Request"
                                              : "Incident"
                                          ) : col === "Manually Classified" ? (
                                            row[col] ? "Yes" : "No"
                                          ) : row[col] != null &&
                                            row[col] !== "" ? (
                                            String(row[col])
                                          ) : (
                                            "—"
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {canManage && (
                                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/60">
                                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                    <Tag size={13} /> True Type:
                                  </span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    Currently{" "}
                                    <strong className="text-slate-700 dark:text-slate-200">
                                      {row["Effective Type"] === "user_request"
                                        ? "User Request"
                                        : "Incident"}
                                    </strong>
                                    {row["Manually Classified"]
                                      ? " (manually set)"
                                      : row["Suggested Type"]
                                        ? " (auto-detected)"
                                        : ""}
                                  </span>
                                  <div className="ml-auto flex gap-2">
                                    <button
                                      disabled={
                                        classifyingNumber === number ||
                                        row["Effective Type"] === "incident"
                                      }
                                      onClick={() =>
                                        classifyTicket(number, "incident")
                                      }
                                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                                    >
                                      Mark as Incident
                                    </button>
                                    <button
                                      disabled={
                                        classifyingNumber === number ||
                                        row["Effective Type"] ===
                                          "user_request"
                                      }
                                      onClick={() =>
                                        classifyTicket(number, "user_request")
                                      }
                                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                                    >
                                      Mark as User Request
                                    </button>
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                <History size={13} /> Queue history for {number}
                              </div>
                              {historyLoading === number ? (
                                <p className="text-xs text-slate-400">
                                  Loading history…
                                </p>
                              ) : historyError[number] ? (
                                <p className="text-xs text-red-500">
                                  {historyError[number]}
                                </p>
                              ) : !events || events.length === 0 ? (
                                <p className="text-xs text-slate-400">
                                  No queue-movement history has been uploaded
                                  for this ticket yet.
                                </p>
                              ) : (
                                <div className="w-full">
                                  {/* table-fixed + colgroup: total width is always 100% of the
                                    sticky wrapper above, so this never needs its own
                                    horizontal scrollbar - long values truncate with a
                                    title tooltip instead of pushing the table wider. */}
                                  <table className="w-full table-fixed border-collapse text-left text-xs">
                                    <colgroup>
                                      <col className="w-[12%]" />
                                      <col className="w-[16%]" />
                                      <col className="w-[19%]" />
                                      <col className="w-[13%]" />
                                      <col className="w-[22%]" />
                                      <col className="w-[18%]" />
                                    </colgroup>
                                    <thead>
                                      <tr className="bg-slate-50 dark:bg-slate-700/50">
                                        <th className="truncate border border-slate-200 px-3 py-2 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                                          Incident
                                        </th>
                                        <th className="truncate border border-slate-200 px-3 py-2 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                                          Queue
                                        </th>
                                        <th className="truncate border border-slate-200 px-3 py-2 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                                          Timestamp
                                        </th>
                                        <th className="truncate border border-slate-200 px-3 py-2 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                                          Status
                                        </th>
                                        <th className="truncate border border-slate-200 px-3 py-2 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                                          Assigned Person
                                        </th>
                                        <th className="truncate border border-slate-200 px-3 py-2 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                                          Time Spent
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {events.map((ev, idx) => {
                                        const statusKey = (
                                          ev.status || ""
                                        ).toLowerCase();
                                        // Mirrors the SLA-calc note in the change request: only TCS-queue time
                                        // while Open/In progress counts toward SLA (amber), Hold pauses the
                                        // clock (red) and Closed ends it (green). Non-TCS queue time never
                                        // counts, so its Queue cell is flagged blue instead of shading status/time.
                                        const slaCell =
                                          statusKey === "hold"
                                            ? "bg-red-100 font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300"
                                            : statusKey === "closed"
                                              ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                              : ev.is_tcs_team &&
                                                  (statusKey === "open" ||
                                                    statusKey === "in progress")
                                                ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                                : "";
                                        return (
                                          <tr key={idx}>
                                            {idx === 0 && (
                                              <td
                                                rowSpan={events.length}
                                                title={number}
                                                className="truncate border border-slate-200 bg-white px-3 py-2 align-top font-mono text-xs font-semibold text-brand-700 dark:border-slate-600 dark:bg-slate-800 dark:text-brand-400"
                                              >
                                                {number}
                                              </td>
                                            )}
                                            <td
                                              title={
                                                [ev.queue, ev.queue_description]
                                                  .filter(Boolean)
                                                  .join(" — ") || undefined
                                              }
                                              className={`truncate border border-slate-200 px-3 py-2 dark:border-slate-600 ${ev.is_tcs_team === false ? "bg-blue-100 font-medium text-blue-900 dark:bg-blue-950/40 dark:text-blue-300" : ""}`}
                                            >
                                              {ev.queue || "—"}
                                            </td>
                                            <td className="truncate whitespace-nowrap border border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-500 dark:border-slate-600">
                                              {formatHistoryTimestamp(
                                                ev.timestamp,
                                              )}
                                            </td>
                                            <td
                                              className={`truncate border border-slate-200 px-3 py-2 dark:border-slate-600 ${slaCell}`}
                                            >
                                              {ev.status || "—"}
                                            </td>
                                            <td
                                              title={
                                                ev.assigned_associate ||
                                                "Unassigned"
                                              }
                                              className="truncate border border-slate-200 px-3 py-2 dark:border-slate-600"
                                            >
                                              {ev.assigned_associate ||
                                                "Unassigned"}
                                            </td>
                                            <td
                                              className={`truncate border border-slate-200 px-3 py-2 dark:border-slate-600 ${slaCell}`}
                                            >
                                              {formatTimeSpent(ev)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {!historyLoading &&
                                !historyError[number] &&
                                events &&
                                events.length > 0 &&
                                (() => {
                                  const stats = computeTcsSlaStats(
                                    row.Priority,
                                    events,
                                  );
                                  if (!stats) return null;
                                  const statusStyles = {
                                    Breached:
                                      "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
                                    "At Risk":
                                      "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
                                    "Not Breached":
                                      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
                                  };
                                  const StatusIcon =
                                    stats.status === "Breached"
                                      ? ShieldAlert
                                      : stats.status === "At Risk"
                                        ? ShieldQuestion
                                        : ShieldCheck;
                                  return (
                                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
                                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                          <Timer size={13} /> TCS SLA Timing
                                          (Priority {row.Priority || "—"},{" "}
                                          {PRIORITY_SLA_HOURS[row.Priority] ??
                                            240}
                                          h window)
                                        </p>
                                        <span
                                          className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusStyles[stats.status]}`}
                                        >
                                          <StatusIcon size={12} />{" "}
                                          {stats.status}
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        <div>
                                          <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                            TCS SLA Time Consumed
                                          </p>
                                          <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            {formatMinutes(
                                              stats.tcsActiveMinutes,
                                            )}
                                          </p>
                                          <p className="text-[10px] text-slate-400">
                                            of{" "}
                                            {formatMinutes(
                                              stats.slaTargetMinutes,
                                            )}{" "}
                                            window
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                            % of TCS SLA Window
                                          </p>
                                          <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            {stats.pctOfSla.toFixed(1)}%
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                            Total Time Consumed (all queues)
                                          </p>
                                          <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            {formatMinutes(stats.totalMinutes)}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                            TCS Share of Total Time
                                          </p>
                                          <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            {stats.tcsPctOfTotal.toFixed(1)}%
                                          </p>
                                          <p className="text-[10px] text-slate-400">
                                            Non-TCS:{" "}
                                            {stats.nonTcsPctOfTotal.toFixed(1)}%
                                          </p>
                                        </div>
                                      </div>
                                      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                                        <div
                                          className={`h-full rounded-full ${stats.status === "Breached" ? "bg-red-500" : stats.status === "At Risk" ? "bg-amber-500" : "bg-emerald-500"}`}
                                          style={{
                                            width: `${Math.min(stats.pctOfSla, 100)}%`,
                                          }}
                                        />
                                      </div>
                                      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                                        Only Open/In progress time inside a
                                        TCS-owned queue (ABAP/FI/SD/MM, amber
                                        rows above) counts toward this SLA clock
                                        — Hold pauses it, Non-TCS/external queue
                                        time (blue rows) never counts.
                                      </p>
                                    </div>
                                  );
                                })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {feedbackOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setFeedbackOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card dark:bg-slate-800"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-semibold">Feedback for {assignee}</p>
                <button
                  onClick={() => setFeedbackOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>
              <textarea
                className="input-field min-h-[120px] resize-none"
                placeholder="e.g. Great turnaround on P1s this week, but a few reconciliation tickets sat in On Hold longer than expected..."
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
              />
              <button
                onClick={submitFeedback}
                disabled={feedbackSubmitting || !feedbackMessage.trim()}
                className="btn-primary mt-4 flex w-full items-center justify-center gap-2"
              >
                <Send size={14} />{" "}
                {feedbackSubmitting ? "Sending\u2026" : "Send Feedback"}
              </button>
              {feedbackLoading
                ? null
                : feedbackHistory.length > 0 && (
                    <p className="mt-3 text-center text-xs text-slate-400">
                      {feedbackHistory.length} previous note
                      {feedbackHistory.length === 1 ? "" : "s"} on file for this
                      associate
                    </p>
                  )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
