import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Ticket,
  FolderOpen,
  CheckCircle2,
  ShieldCheck,
  Clock,
  Timer,
  Flame,
  X,
  SlidersHorizontal,
  ChevronDown,
  Info,
  PackageCheck,
  XCircle,
  Bookmark,
  BookmarkPlus,
  Download,
  Trash2,
  Layers,
  Smile,
  AlertTriangle,
  Bell,
  TrendingUp,
  Target,
  Users,
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import api from "../services/api";
import KpiCard from "../components/KpiCard";
import ChartCard from "../components/ChartCard";
import PageSection from "../components/PageSection";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { downloadCsv } from "../lib/csv";

const FILTER_KEYS = [
  "status",
  "priority",
  "module",
  "customer",
  "application",
  "assignee",
];
const DATE_FILTER_KEYS = ["date_from", "date_to"];
const DATE_FILTER_LABELS = { date_from: "From", date_to: "To" };

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

const PANEL_GUIDE = [
  [
    "Total / Open / Resolved / Closed",
    "Open = still active (New, In Progress, On Hold). Resolved = a fix was applied, pending confirmation. Closed = confirmed done. These are counted separately since they mean different things operationally.",
  ],
  [
    "SLA Compliant vs Non-Compliant",
    'Per priority SLA windows (P1: 4h, P2: 2 days, P3: 5 days, P4: 10 days), a ticket is Compliant if it was resolved on time, Non-Compliant ("breached") if it wasn\u2019t \u2014 or, if still open, if it has already blown past its due time.',
  ],
  [
    "SLA At Risk",
    "Still active, not yet breached, but due within the next 24 hours \u2014 your early-warning list before something becomes a breach.",
  ],
  [
    "CSAT Score",
    "A computed proxy (this dataset has no real survey data): full credit for tickets solved within SLA, half credit for tickets solved but late, no credit for tickets still open or cancelled.",
  ],
  [
    "Total Ticket Backlog per Month",
    "Of tickets that are still open today, which month were they originally opened in? This shows where backlog is actually piling up, not just how many tickets exist right now.",
  ],
  [
    "Ticket Backlog (sidebar)",
    "Per-associate breakdown of open tickets by age: 0-30 / 31-60 / 61-90 / 90+ days. Click an associate to see every ticket assigned to them.",
  ],
];

const NOTIFICATION_ICONS = {
  pending_approval: Info,
  at_risk: AlertTriangle,
  p1_breach: Flame,
  feedback: Bell,
};
const NOTIFICATION_STYLES = {
  pending_approval:
    "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  at_risk:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  p1_breach: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
  feedback:
    "bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400",
};
const PRIORITY_BAR_COLORS = {
  P1: "#f43f5e",
  P2: "#fb923c",
  P3: "#facc15",
  P4: "#34d399",
};

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [datasetId, setDatasetId] = useState(null);
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [savedFilters, setSavedFilters] = useState([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [notifications, setNotifications] = useState([]);
  // Executive Dashboard always shows TCS-team tickets only (Non-TCS-queue
  // tickets excluded). This was previously toggleable via a header button;
  // per SDM requirement, that toggle has been removed and the dashboard is
  // fixed to the TCS-only view for everyone.
  const [tcsOnly] = useState(true);
  const filterPanelRef = useRef(null);

  useEffect(() => {
    api
      .get("/saved-filters")
      .then(({ data }) => setSavedFilters(data))
      .catch(() => {});
    api
      .get("/notifications")
      .then(({ data }) => setNotifications(data.slice(0, 4)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target))
        setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const loadDashboard = useCallback(
    async (id, activeFilters, isRefresh = false, tcsOnlyOverride) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const params = {
          dataset_id: id,
          tcs_only: tcsOnlyOverride ?? tcsOnly,
        };
        Object.entries(activeFilters).forEach(([k, v]) => {
          if (!v || !v.length) return;
          params[k] = Array.isArray(v) ? v.join(",") : v;
        });
        const { data } = await api.get("/dashboard", { params });
        setData(data);
      } catch (err) {
        setError(err.response?.data?.detail || "Failed to load dashboard");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tcsOnly],
  );

  useEffect(() => {
    async function init() {
      try {
        const { data } = await api.get("/dashboard/current-dataset");
        const ids = data.dataset_ids?.join(",");
        if (ids) {
          setDatasetId(ids);
          await loadDashboard(ids, {});
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value ? [value] : undefined };
    setFilters(next);
    loadDashboard(datasetId, next, true);
  }

  function updateDateFilter(key, value) {
    const next = { ...filters, [key]: value || undefined };
    setFilters(next);
    loadDashboard(datasetId, next, true);
  }

  function removeFilter(key) {
    if (DATE_FILTER_KEYS.includes(key)) updateDateFilter(key, "");
    else updateFilter(key, "");
  }

  function clearAllFilters() {
    setFilters({});
    loadDashboard(datasetId, {}, true);
  }

  function goToAssociateTickets(assignee) {
    navigate(`/tickets?assignee=${encodeURIComponent(assignee)}`);
  }

  // KPI cards, pie slices, and bars all drill down to the ticket list, preserving
  // whatever filters are currently active on the dashboard and adding the
  // clicked metric's filter on top (e.g. clicking "P1 Tickets" -> priority=P1).
  function goToTickets(overrides = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (!v || !v.length) return;
      params.set(k, Array.isArray(v) ? v[0] : v);
    });
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    navigate(`/tickets?${params.toString()}`);
  }

  function goToTicketsByStatus(status) {
    goToTickets({ status, view: undefined });
  }

  function goToTicketsByPriority(priority) {
    goToTickets({ priority, view: undefined });
  }

  const SLA_PIE_VIEW = {
    Compliant: "sla_compliant",
    "Non-Compliant": "sla_breach",
  };
  function goToTicketsBySlaSlice(name) {
    goToTickets({ view: SLA_PIE_VIEW[name], status: undefined });
  }

  const CLOSED_RESOLVED_STATUS = { Resolved: "Resolved", Closed: "Closed" };
  function goToTicketsByClosedResolvedSlice(name) {
    goToTickets({ status: CLOSED_RESOLVED_STATUS[name], view: undefined });
  }

  function goToTicketsByModule(module) {
    goToTickets({ module });
  }

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([
      loadDashboard(datasetId, filters, true),
      api
        .get("/notifications")
        .then(({ data }) => setNotifications(data.slice(0, 4)))
        .catch(() => {}),
    ]);
  }

  // Backlog chart bars are labeled like "Jan 2026" (the month tickets were
  // originally opened in); turn that into a date range so the click lands on
  // exactly that month's still-open tickets.
  function goToTicketsByBacklogMonth(monthLabel) {
    const start = new Date(`1 ${monthLabel}`);
    if (Number.isNaN(start.getTime())) {
      goToTickets({
        view: "backlog",
        date_from: undefined,
        date_to: undefined,
      });
      return;
    }
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const fmt = (d) => d.toISOString().slice(0, 10);
    goToTickets({ view: "backlog", date_from: fmt(start), date_to: fmt(end) });
  }

  async function saveCurrentFilters() {
    if (!saveFilterName.trim()) return;
    const { data } = await api.post("/saved-filters", {
      name: saveFilterName.trim(),
      filters_json: JSON.stringify(filters),
    });
    setSavedFilters((prev) => [data, ...prev]);
    setSaveFilterName("");
    setSaveDialogOpen(false);
  }

  function applySavedFilter(sf) {
    const parsed = JSON.parse(sf.filters_json);
    setFilters(parsed);
    loadDashboard(datasetId, parsed, true);
    setFiltersOpen(true);
  }

  async function deleteSavedFilter(id, e) {
    e.stopPropagation();
    await api.delete(`/saved-filters/${id}`);
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));
  }

  function exportSummaryCsv() {
    if (!data) return;
    const rows = [
      { Metric: "Total Tickets", Value: data.kpis.total_tickets },
      { Metric: "Open Tickets", Value: data.kpis.open_tickets },
      { Metric: "Resolved Tickets", Value: data.kpis.resolved_tickets },
      { Metric: "Closed Tickets", Value: data.kpis.closed_tickets },
      { Metric: "SLA Compliant %", Value: data.kpis.sla_compliance_pct },
      { Metric: "SLA Non-Compliant %", Value: data.kpis.sla_breach_pct },
      { Metric: "SLA At Risk", Value: data.kpis.sla_at_risk },
      { Metric: "P1 Tickets", Value: data.kpis.p1_tickets },
      { Metric: "Avg Ticket Age (days)", Value: data.kpis.avg_ticket_age_days },
    ];
    downloadCsv("dashboard-summary.csv", ["Metric", "Value"], rows);
  }

  const activeFilterEntries = useMemo(
    () => Object.entries(filters).filter(([, v]) => v && v.length),
    [filters],
  );
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="skeleton h-8 w-56" />
          <div className="skeleton h-9 w-32" />
        </div>
        <div className="skeleton h-64" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-72" />
          ))}
        </div>
      </div>
    );
  }

  if (!datasetId || !data) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="card flex flex-col items-center justify-center gap-3 p-16 text-center"
      >
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <Ticket size={40} className="text-slate-300" />
        </motion.div>
        <p className="text-lg font-semibold">No dataset uploaded yet</p>
        <p className="max-w-sm text-sm text-slate-500">
          Upload an ITSM ticket export to populate your executive dashboard.
        </p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">
          Go to Upload
        </Link>
      </motion.div>
    );
  }

  const { kpis, charts, filter_options } = data;
  const firstName = user?.full_name?.split(" ")[0] || "there";

  // Derived, data-grounded "AI Executive Insights" teaser strip - computed
  // directly from the current KPIs/charts rather than an extra live AI call
  // on every dashboard load (that stays a deliberate action on the AI
  // Insights page). Each card links to where the SDM would actually act.
  const slaTrendDelta = (() => {
    const t = data.sla_trend || [];
    if (t.length < 2) return null;
    return (
      Math.round((t[t.length - 1].value - t[t.length - 2].value) * 10) / 10
    );
  })();
  const topModule = charts.module_distribution?.[0];
  const topAssignee = charts.assignee_workload?.[0];
  const overloadedCount = (charts.assignee_workload || []).filter(
    (a) =>
      a.value >
      (kpis.total_tickets /
        Math.max(charts.assignee_workload?.length || 1, 1)) *
        1.5,
  ).length;

  const insightCards = [
    slaTrendDelta !== null && {
      icon: TrendingUp,
      tone: slaTrendDelta >= 0 ? "emerald" : "rose",
      label: slaTrendDelta >= 0 ? "Improving Trend" : "Declining Trend",
      text: `SLA compliance ${slaTrendDelta >= 0 ? "improved" : "dropped"} by ${Math.abs(slaTrendDelta)}% vs the prior week.`,
      onClick: () =>
        document
          .getElementById("sla-trend-chart")
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    },
    topModule && {
      icon: Target,
      tone: "amber",
      label: "Focus Area",
      text: `${topModule.name} has the most tickets (${topModule.value}). Consider reviewing root causes.`,
      onClick: () => goToTicketsByModule(topModule.name),
    },
    {
      icon: Sparkles,
      tone: "brand",
      label: "AI Insights",
      text: "Generate a full narrative report with root causes, risks, and recommended actions.",
      onClick: () => navigate("/ai?tab=insights"),
    },
    topAssignee && {
      icon: Users,
      tone: "purple",
      label: "Associate Workload",
      text:
        overloadedCount > 0
          ? `${overloadedCount} associate${overloadedCount === 1 ? "" : "s"} carrying a disproportionate share of tickets. Review workload distribution.`
          : `${topAssignee.name} has the highest ticket count (${topAssignee.value}).`,
      onClick: () => navigate("/backlog"),
    },
  ].filter(Boolean);

  const insightTones = {
    emerald:
      "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
    amber:
      "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    brand:
      "bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400",
    purple:
      "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Welcome back, {firstName} {"\u{1F44B}"}
          </h1>
          <p className="text-sm text-slate-500">
            Here's what's happening across your services, Today {data.row_count}{" "}
            tickets matching current filters
            {refreshing && (
              <span className="ml-2 inline-block animate-pulse text-brand-500">
                {"\u00b7"} refreshing{"\u2026"}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportSummaryCsv}
            className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={() => setGuideOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <Info size={13} /> What am I looking at?
          </button>
          <button
            onClick={refreshAll}
            title="Refresh"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {guideOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              {PANEL_GUIDE.map(([title, desc]) => (
                <div key={title}>
                  <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                    {title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact collapsible filter bar - never overlaps chart content below it */}
      <div ref={filterPanelRef} className="sticky top-0 z-20 -mx-1">
        <div className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-2.5 shadow-soft backdrop-blur-md dark:border-slate-700 dark:bg-slate-800/95">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300"
            >
              <SlidersHorizontal size={15} />
              Filters
              {activeFilterEntries.length > 0 && (
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                  {activeFilterEntries.length}
                </span>
              )}
              <ChevronDown
                size={15}
                className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}
              />
            </button>

            {savedFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {savedFilters.map((sf) => (
                  <button
                    key={sf.id}
                    onClick={() => applySavedFilter(sf)}
                    className="group flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600 dark:border-slate-600 dark:text-slate-300"
                  >
                    <Bookmark size={11} /> {sf.name}
                    <span
                      onClick={(e) => deleteSavedFilter(sf.id, e)}
                      className="text-slate-300 hover:text-red-500"
                    >
                      <Trash2 size={11} />
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeFilterEntries.length > 0 && (
              <button
                onClick={() => setSaveDialogOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                <BookmarkPlus size={13} /> Save view
              </button>
            )}

            {activeFilterEntries.length > 0 && (
              <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                {activeFilterEntries.map(([key, val]) => (
                  <span
                    key={key}
                    className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                  >
                    {DATE_FILTER_KEYS.includes(key) && (
                      <span className="text-brand-400">
                        {DATE_FILTER_LABELS[key]}:
                      </span>
                    )}
                    {Array.isArray(val) ? val[0] : val}
                    <button
                      onClick={() => removeFilter(key)}
                      className="text-brand-400 hover:text-brand-700 dark:hover:text-brand-100"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <button
                  onClick={clearAllFilters}
                  className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          <AnimatePresence>
            {filtersOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-3 lg:grid-cols-6">
                  {FILTER_KEYS.map((key) => (
                    <select
                      key={key}
                      className="input-field py-1.5 text-xs"
                      onChange={(e) => updateFilter(key, e.target.value)}
                      value={filters[key]?.[0] || ""}
                    >
                      <option value="">All {key}</option>
                      {(filter_options[key] || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">
                      Opened From
                    </label>
                    <input
                      type="date"
                      className="input-field py-1.5 text-xs"
                      value={filters.date_from || ""}
                      max={filters.date_to || undefined}
                      onChange={(e) =>
                        updateDateFilter("date_from", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">
                      Opened To
                    </label>
                    <input
                      type="date"
                      className="input-field py-1.5 text-xs"
                      value={filters.date_to || ""}
                      min={filters.date_from || undefined}
                      onChange={(e) =>
                        updateDateFilter("date_to", e.target.value)
                      }
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Narrowing the date range also sharpens the trend charts below
                  — useful when a large dataset makes the daily view too dense
                  to read.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ===== Consolidated "everything at a glance" section ===== */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`glance-${filterKey}`}
          initial="hidden"
          animate="show"
          variants={gridVariants}
          className="space-y-6"
        >
          {/* Top KPI strip - ordered by how much SDM attention each one
              needs right now: P1s and SLA risk first, then backlog size,
              then the calmer totals/satisfaction numbers last. */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
          >
            <KpiCard
              label="P1 Tickets"
              value={kpis.p1_tickets}
              icon={Flame}
              accent="red"
              onClick={() => goToTicketsByPriority("P1")}
            />
            <KpiCard
              label="SLA Compliance"
              value={kpis.sla_compliance_pct}
              suffix="%"
              icon={ShieldCheck}
              accent="emerald"
              decimals={1}
              onClick={() =>
                goToTickets({ view: "sla_compliant", status: undefined })
              }
            />
            <KpiCard
              label="Backlog"
              value={kpis.backlog_tickets}
              icon={Layers}
              accent="amber"
              onClick={() =>
                goToTickets({ view: "backlog", status: undefined })
              }
            />
            <KpiCard
              label="Total Tickets"
              value={kpis.total_tickets}
              icon={Ticket}
              accent="brand"
              onClick={() => goToTickets()}
            />
            <KpiCard
              label="CSAT Score"
              value={kpis.csat_pct}
              suffix="%"
              icon={Smile}
              accent="emerald"
              decimals={1}
            />
          </motion.div>

          {/* Ticket Trend + Priority Donut + Alerts & Notifications */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 gap-4 xl:grid-cols-4"
          >
            <div className="xl:col-span-2">
              <ChartCard
                title="Ticket Trend"
                subtitle="New tickets opened vs. tickets resolved, per day"
                type="line"
                data={data.new_vs_resolved_trend}
                height={260}
                series={[
                  { dataKey: "opened", name: "New Tickets", color: "#6366f1" },
                  {
                    dataKey: "resolved",
                    name: "Resolved Tickets",
                    color: "#34d399",
                  },
                ]}
              />
            </div>
            <ChartCard
              title="Tickets by Priority"
              type="pie"
              data={charts.priority_distribution}
              height={260}
              onBarClick={goToTicketsByPriority}
              clickHint="Click a slice to view those tickets"
              centerValue={kpis.total_tickets.toLocaleString()}
              centerLabel="Total"
            />
            <div className="card flex flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <Bell size={15} /> Alerts & Notifications
                </p>
                <Link
                  to="/settings"
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  View All
                </Link>
              </div>
              {notifications.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-400">
                  Nothing needs your attention right now.
                </div>
              ) : (
                <div className="flex-1 space-y-3">
                  {notifications.map((n) => {
                    const Icon = NOTIFICATION_ICONS[n.type] || Info;
                    return (
                      <Link
                        key={n.id}
                        to={n.link || "#"}
                        className="flex items-start gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${NOTIFICATION_STYLES[n.type] || NOTIFICATION_STYLES.feedback}`}
                        >
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs leading-snug text-slate-600 dark:text-slate-300">
                            {n.message}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* Backlog Overview + Top Services + SLA Compliance Trend */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 gap-4 lg:grid-cols-3"
          >
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Backlog Overview
                </p>
                <Link
                  to="/backlog"
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  View All
                </Link>
              </div>
              <p className="font-mono text-2xl font-bold tabular-nums">
                {kpis.backlog_tickets.toLocaleString()}
              </p>
              <p className="mb-4 text-xs text-slate-400">
                Total Backlog
                {kpis.user_request_tickets > 0 && (
                  <>
                    {" "}
                    · {kpis.user_request_tickets.toLocaleString()} User Request
                    ticket
                    {kpis.user_request_tickets === 1 ? "" : "s"} excluded
                  </>
                )}
              </p>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                {(data.backlog_by_priority || []).map((p) => (
                  <button
                    key={p.name}
                    title={`${p.name}: ${p.value}`}
                    onClick={() => goToTicketsByPriority(p.name)}
                    style={{
                      width: `${kpis.backlog_tickets ? (p.value / kpis.backlog_tickets) * 100 : 0}%`,
                      background: PRIORITY_BAR_COLORS[p.name],
                    }}
                    className="h-full transition-opacity hover:opacity-80"
                  />
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                {(data.backlog_by_priority || []).map((p) => (
                  <button
                    key={p.name}
                    onClick={() => goToTicketsByPriority(p.name)}
                    className="flex w-full items-center justify-between text-xs hover:text-brand-600"
                  >
                    <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: PRIORITY_BAR_COLORS[p.name] }}
                      />{" "}
                      {p.name}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {p.value}{" "}
                      {kpis.backlog_tickets
                        ? `(${((p.value / kpis.backlog_tickets) * 100).toFixed(1)}%)`
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Top Services by Tickets
                </p>
                <Link
                  to="/analytics"
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  View All
                </Link>
              </div>
              <div className="space-y-3">
                {(charts.application_tickets || []).slice(0, 5).map((s) => {
                  const max = charts.application_tickets[0]?.value || 1;
                  return (
                    <button
                      key={s.name}
                      onClick={() => goToTickets({ application: s.name })}
                      className="block w-full text-left"
                    >
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate text-slate-600 dark:text-slate-300">
                          {s.name}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {s.value}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${(s.value / max) * 100}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
                {(!charts.application_tickets ||
                  charts.application_tickets.length === 0) && (
                  <p className="py-6 text-center text-xs text-slate-400">
                    No service data available.
                  </p>
                )}
              </div>
            </div>

            <div id="sla-trend-chart">
              <ChartCard
                title="SLA Compliance Trend"
                subtitle="Weekly, by ticket open date"
                type="line"
                data={data.sla_trend}
                height={230}
                allowTypeSwitch={false}
              />
            </div>
          </motion.div>

          {/* Recent P1 Tickets + AI Executive Insights */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <div className="card p-5 xl:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Recent P1 Tickets
                </p>
                <button
                  onClick={() => goToTicketsByPriority("P1")}
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  View All
                </button>
              </div>
              {(data.recent_p1_tickets || []).length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  No P1 tickets right now.
                </p>
              ) : (
                <div className="space-y-1">
                  {data.recent_p1_tickets.map((t) => (
                    <button
                      key={t.number}
                      onClick={() =>
                        navigate(`/tickets?q=${encodeURIComponent(t.number)}`)
                      }
                      className="flex w-full items-start gap-2.5 rounded-lg border-l-2 border-rose-400 bg-rose-50/40 p-2.5 text-left transition-colors hover:bg-rose-50 dark:bg-rose-950/10 dark:hover:bg-rose-950/20"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold text-rose-700 dark:text-rose-400">
                            {t.number}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {timeAgo(t.opened)}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-slate-600 dark:text-slate-300">
                          {t.short_description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5 xl:col-span-2">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <Sparkles size={15} /> AI Executive Insights
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {insightCards.map((c) => (
                  <button
                    key={c.label}
                    onClick={c.onClick}
                    className="group flex items-start gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/30 dark:border-slate-700 dark:hover:bg-brand-950/10"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${insightTones[c.tone]}`}
                    >
                      <c.icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {c.label}{" "}
                        <ArrowUpRight
                          size={11}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">
                        {c.text}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <Link
                to="/ai?tab=insights"
                className="btn-primary mt-4 flex w-fit items-center gap-1.5 text-xs"
              >
                View Detailed Insights <ArrowRight size={13} />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* ===== Detailed breakdown (all the underlying charts, grouped by theme) ===== */}
      <PageSection
        title="Detailed Breakdown"
        subtitle="Every underlying metric behind the summary above, grouped by theme."
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={filterKey}
          initial="hidden"
          animate="show"
          variants={gridVariants}
          className="space-y-6"
        >
          {/* Hero: Total Ticket Backlog per Month */}
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Total Ticket Backlog per Month"
              subtitle="Currently-open tickets, grouped by the month they were originally opened"
              type="bar"
              data={charts.monthly_backlog}
              height={220}
              onBarClick={goToTicketsByBacklogMonth}
              clickHint="Click a month to view that month's open backlog"
            />
          </motion.div>

          <PageSection
            title="Ticket Volume & Flow"
            subtitle="Where every ticket stands across its lifecycle."
          />

          {/* Core volume KPIs - Avg Ticket Age lives here so no metric is
              stranded alone on its own row */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
          >
            <KpiCard
              label="Total Tickets"
              value={kpis.total_tickets}
              icon={Ticket}
              accent="brand"
              onClick={() => goToTickets()}
            />
            <KpiCard
              label="Open Tickets"
              value={kpis.open_tickets}
              icon={FolderOpen}
              accent="amber"
              progress={(kpis.open_tickets / (kpis.total_tickets || 1)) * 100}
              onClick={() => goToTickets({ view: "open", status: undefined })}
            />
            <KpiCard
              label="Resolved Tickets"
              value={kpis.resolved_tickets}
              icon={PackageCheck}
              accent="slate"
              progress={
                (kpis.resolved_tickets / (kpis.total_tickets || 1)) * 100
              }
              onClick={() => goToTicketsByStatus("Resolved")}
            />
            <KpiCard
              label="Closed Tickets"
              value={kpis.closed_tickets}
              icon={CheckCircle2}
              accent="emerald"
              progress={(kpis.closed_tickets / (kpis.total_tickets || 1)) * 100}
              onClick={() => goToTicketsByStatus("Closed")}
            />
            <KpiCard
              label="Avg Ticket Age"
              value={kpis.avg_ticket_age_days}
              suffix=" days"
              icon={Clock}
              accent="slate"
              decimals={1}
            />
          </motion.div>

          <PageSection
            title="SLA Health"
            subtitle="Breach exposure, at-risk tickets, and urgency mix."
          />

          {/* SLA compliance KPIs */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            <KpiCard
              label="SLA Compliant"
              value={kpis.sla_compliance_pct}
              suffix="%"
              icon={ShieldCheck}
              accent="emerald"
              decimals={1}
              onClick={() =>
                goToTickets({ view: "sla_compliant", status: undefined })
              }
            />
            <KpiCard
              label="SLA Non-Compliant"
              value={kpis.sla_breach_pct}
              suffix="%"
              icon={XCircle}
              accent="red"
              decimals={1}
              onClick={() =>
                goToTickets({ view: "sla_breach", status: undefined })
              }
            />
            <KpiCard
              label="SLA At Risk"
              value={kpis.sla_at_risk}
              icon={Timer}
              accent="amber"
              onClick={() =>
                goToTickets({ view: "sla_at_risk", status: undefined })
              }
            />
            <KpiCard
              label="P1 Tickets"
              value={kpis.p1_tickets}
              icon={Flame}
              accent="red"
              progress={(kpis.p1_tickets / (kpis.total_tickets || 1)) * 100}
              onClick={() => goToTicketsByPriority("P1")}
            />
          </motion.div>

          <PageSection
            title="Resolution & Status Mix"
            subtitle="How tickets are closing out, and what's still sitting in each state."
          />

          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          >
            <ChartCard
              title="SLA Compliant vs Non-Compliant"
              type="pie"
              data={charts.sla_compliance}
              height={220}
              onBarClick={goToTicketsBySlaSlice}
              clickHint="Click a slice to view those tickets"
            />
            <ChartCard
              title="Resolved vs Closed"
              type="pie"
              data={charts.closed_vs_resolved}
              height={220}
              onBarClick={goToTicketsByClosedResolvedSlice}
              clickHint="Click a slice to view those tickets"
            />
            <ChartCard
              title="Ticket Status Distribution"
              type="pie"
              data={charts.status_distribution}
              height={220}
              onBarClick={goToTicketsByStatus}
              clickHint="Click a slice to view those tickets"
            />
            <ChartCard
              title="Priority Distribution (P1-P4)"
              type="pie"
              data={charts.priority_distribution}
              height={220}
              onBarClick={goToTicketsByPriority}
              clickHint="Click a slice to view those tickets"
            />
          </motion.div>

          <PageSection
            title="Workload & Aging"
            subtitle="Where the work concentrates and how long it has been open."
          />

          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <ChartCard
              title="Category-wise Tickets"
              type="bar"
              data={charts.module_distribution}
              onBarClick={goToTicketsByModule}
              clickHint="Click a bar to view those tickets"
            />
            <ChartCard
              title="Ticket Aging Distribution"
              type="bar"
              data={charts.aging_distribution}
            />
            <ChartCard
              title="Associate Workload"
              subtitle="Click an associate to see all of their tickets"
              type="bar"
              data={charts.assignee_workload}
              onBarClick={goToAssociateTickets}
              clickHint="Click a bar to view that associate's tickets"
            />
          </motion.div>

          <PageSection
            title="Daily Trend"
            subtitle="Volume of tickets opened each day across the filtered range."
          />

          <motion.div variants={itemVariants}>
            <ChartCard
              title="Daily Ticket Trend"
              type="line"
              data={charts.daily_trend}
              height={240}
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {saveDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setSaveDialogOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-card dark:bg-slate-800"
            >
              <p className="mb-1 flex items-center gap-2 text-lg font-semibold">
                <BookmarkPlus size={18} /> Save this filter view
              </p>
              <p className="mb-4 text-xs text-slate-400">
                One click to reapply this exact combination of filters later.
              </p>
              <input
                type="text"
                autoFocus
                value={saveFilterName}
                onChange={(e) => setSaveFilterName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrentFilters()}
                placeholder="e.g. P1s for Payments team"
                className="input-field"
              />
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setSaveDialogOpen(false)}
                  className="btn-secondary flex-1 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCurrentFilters}
                  disabled={!saveFilterName.trim()}
                  className="btn-primary flex-1 text-sm"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
