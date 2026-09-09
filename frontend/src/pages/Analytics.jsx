import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import api from "../services/api";
import ChartCard from "../components/ChartCard";
import KpiCard from "../components/KpiCard";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  Building2,
  Ticket,
  Clock3,
  Timer,
} from "lucide-react";
import RadialGauge from "../components/RadialGauge";
import PageSection from "../components/PageSection";

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

function findValue(arr, name) {
  if (!arr) return 0;
  const hit = arr.find((d) => d.name === name);
  return hit ? hit.value : 0;
}
function sumValues(arr) {
  if (!arr) return 0;
  return arr.reduce((s, d) => s + (d.value || 0), 0);
}

const SLA_COMPLIANCE_VIEW = {
  Compliant: "sla_compliant",
  "Non-Compliant": "sla_breach",
};
const SLA_RISK_VIEW = {
  Breached: "sla_breach",
  "At Risk": "sla_at_risk",
  Healthy: "sla_compliant",
};
const CLOSED_RESOLVED_STATUS = { Resolved: "Resolved", Closed: "Closed" };

export default function Analytics() {
  const [data, setData] = useState(null);
  const [slaTcs, setSlaTcs] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const goToTickets = useCallback(
    (overrides = {}) => {
      const params = new URLSearchParams();
      Object.entries(overrides).forEach(([k, v]) => {
        if (v != null && v !== "") params.set(k, v);
      });
      navigate(`/tickets?${params.toString()}`);
    },
    [navigate],
  );

  useEffect(() => {
    async function load() {
      try {
        const { data: current } = await api.get("/dashboard/current-dataset");
        const ids = current.dataset_ids?.join(",");
        if (!ids) {
          setLoading(false);
          return;
        }
        const { data } = await api.get("/dashboard", {
          params: { dataset_id: ids },
        });
        setData(data);
        const { data: breakdown } = await api.get(
          "/dashboard/sla-tcs-breakdown",
          { params: { dataset_id: ids } },
        );
        setSlaTcs(breakdown);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton h-64" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="card flex flex-col items-center justify-center gap-3 p-16 text-center"
      >
        <BarChart3 size={36} className="text-slate-300" />
        <p className="text-lg font-semibold">No data to analyze yet</p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">
          Go to Upload
        </Link>
      </motion.div>
    );
  }

  const { charts } = data;
  const totalTickets = sumValues(charts.priority_distribution);
  const compliant = findValue(charts.sla_compliance, "Compliant");
  const nonCompliant = findValue(charts.sla_compliance, "Non-Compliant");
  const compliancePct =
    compliant + nonCompliant
      ? Math.round((compliant / (compliant + nonCompliant)) * 100)
      : null;
  const breached = findValue(charts.sla_risk, "Breached");
  const atRisk = findValue(charts.sla_risk, "At Risk");
  const agingOver20 = findValue(charts.aging_distribution, "20d+");

  function goToTrendMonth(label) {
    const start = new Date(`1 ${label}`);
    if (Number.isNaN(start.getTime())) {
      goToTickets();
      return;
    }
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const fmt = (d) => d.toISOString().slice(0, 10);
    goToTickets({ date_from: fmt(start), date_to: fmt(end) });
  }

  function goToTrendWeek(label) {
    // Weekly labels vary; fall back to open list if unparseable
    const start = new Date(label);
    if (Number.isNaN(start.getTime())) {
      goToTickets();
      return;
    }
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d) => d.toISOString().slice(0, 10);
    goToTickets({ date_from: fmt(start), date_to: fmt(end) });
  }

  function goToUserRequestSlice(name) {
    const n = String(name || "").toLowerCase();
    if (n.includes("user request") || n.includes("request")) {
      navigate("/user-requests");
    } else {
      goToTickets();
    }
  }

  function goToSlaTcsSlice(name) {
    if (name === "Breached") goToTickets({ view: "sla_breach" });
    else goToTickets({ view: "sla_compliant" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          Service Health &amp; Workload Breakdowns
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Detailed breakdowns across categories, companies, business services,
          and time — including the same supporting charts shown on AI Insights.
          Click any chart segment to open matching tickets.
        </p>
      </div>

      <PageSection
        title="Health Snapshot"
        subtitle="Compliance, breach exposure, aging, and total volume in one glance. Click any stat to drill into matching tickets."
      />

      <div className="card flex flex-col items-center gap-6 p-6 sm:flex-row sm:justify-around">
        <RadialGauge
          value={compliancePct ?? 0}
          label="SLA Compliance"
          size={150}
        />
        <div className="grid w-full max-w-lg grid-cols-2 gap-x-8 gap-y-5">
          <SnapshotStat
            icon={ShieldAlert}
            tone="text-rose-500"
            label="SLA Breached"
            value={breached}
            onClick={() => goToTickets({ view: "sla_breach" })}
          />
          <SnapshotStat
            icon={Timer}
            tone="text-amber-500"
            label="At Risk"
            value={atRisk}
            onClick={() => goToTickets({ view: "sla_at_risk" })}
          />
          <SnapshotStat
            icon={Clock3}
            tone="text-slate-500"
            label="Aging 20d+"
            value={agingOver20}
            onClick={() => navigate("/backlog")}
          />
          <SnapshotStat
            icon={Ticket}
            tone="text-brand-500"
            label="Total Tickets"
            value={totalTickets}
            onClick={() => goToTickets()}
          />
        </div>
      </div>

      {slaTcs?.has_history && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div>
            <PageSection
              title="SLA Breach — TCS vs Non-TCS (External) Queues"
              subtitle="SLA compliance split by whether tickets transit a TCS-owned queue or stay in external L1/L2/L3 queues."
            />
            <p className="text-sm text-slate-500">
              Based on {slaTcs.tickets_with_history.toLocaleString()} ticket
              {slaTcs.tickets_with_history === 1 ? "" : "s"} with uploaded
              queue-movement history
              {slaTcs.tickets_without_history > 0 && (
                <>
                  {" "}
                  — {slaTcs.tickets_without_history.toLocaleString()} ticket
                  {slaTcs.tickets_without_history === 1 ? "" : "s"} with no
                  matching history file
                  {slaTcs.tickets_without_history === 1 ? "" : "s"} excluded
                </>
              )}
              .
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Overall SLA Breached"
              value={slaTcs.overall.breached_pct}
              suffix="%"
              decimals={1}
              icon={ShieldAlert}
              accent="red"
              onClick={() => goToTickets({ view: "sla_breach" })}
            />
            <KpiCard
              label="Breached under TCS Queues"
              value={slaTcs.tcs.breached_pct}
              suffix="%"
              decimals={1}
              icon={Building2}
              accent="amber"
              onClick={() => goToTickets({ view: "sla_breach" })}
            />
            <KpiCard
              label="Breached under Non-TCS (External) Queues"
              value={slaTcs.non_tcs.breached_pct}
              suffix="%"
              decimals={1}
              icon={ShieldCheck}
              accent="slate"
              onClick={() => goToTickets({ view: "sla_breach" })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ChartCard
              title="Overall — Breached vs Not Breached"
              type="pie"
              subtitle={`${slaTcs.overall.total.toLocaleString()} tickets`}
              data={[
                { name: "Breached", value: slaTcs.overall.breached },
                { name: "Not Breached", value: slaTcs.overall.not_breached },
              ]}
              onBarClick={goToSlaTcsSlice}
              clickHint="Click a slice to view those tickets"
            />
            <ChartCard
              title="TCS Queues — Breached vs Not Breached"
              type="pie"
              subtitle={`${slaTcs.tcs.total.toLocaleString()} tickets routed through a TCS queue (ABAP/FI/SD/MM)`}
              data={[
                { name: "Breached", value: slaTcs.tcs.breached },
                { name: "Not Breached", value: slaTcs.tcs.not_breached },
              ]}
              onBarClick={goToSlaTcsSlice}
              clickHint="Click a slice to view those tickets"
            />
            <ChartCard
              title="Non-TCS (External) Queues — Breached vs Not Breached"
              type="pie"
              subtitle={`${slaTcs.non_tcs.total.toLocaleString()} tickets kept entirely within L1/L2/L3`}
              data={[
                { name: "Breached", value: slaTcs.non_tcs.breached },
                { name: "Not Breached", value: slaTcs.non_tcs.not_breached },
              ]}
              onBarClick={goToSlaTcsSlice}
              clickHint="Click a slice to view those tickets"
            />
          </div>
        </motion.div>
      )}

      <div>
        <PageSection
          title="Service Health Overview"
          subtitle="The same resolution, priority, risk, aging, and request-vs-incident breakdowns shown to AI Insights."
        />
        <motion.div
          initial="hidden"
          animate="show"
          variants={gridVariants}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <motion.div variants={itemVariants}>
            <ChartCard
              title="SLA Compliant vs Non-Compliant"
              type="pie"
              data={charts.sla_compliance}
              height={220}
              onBarClick={(name) =>
                goToTickets({ view: SLA_COMPLIANCE_VIEW[name] })
              }
              clickHint="Click a slice to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Priority Distribution (P1-P4)"
              type="pie"
              data={charts.priority_distribution}
              height={220}
              onBarClick={(name) => goToTickets({ priority: name })}
              clickHint="Click a slice to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="SLA Risk (Breached / At Risk / Healthy)"
              type="pie"
              data={charts.sla_risk}
              height={220}
              onBarClick={(name) => goToTickets({ view: SLA_RISK_VIEW[name] })}
              clickHint="Click a slice to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Ticket Aging"
              type="bar"
              data={charts.aging_distribution}
              height={220}
              onBarClick={() => navigate("/backlog")}
              clickHint="Click a bar to open the backlog"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Resolved vs Closed"
              type="pie"
              data={charts.closed_vs_resolved}
              height={220}
              onBarClick={(name) =>
                goToTickets({ status: CLOSED_RESOLVED_STATUS[name] || name })
              }
              clickHint="Click a slice to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="User Requests Raised as Incidents"
              type="pie"
              data={charts.user_request_vs_incident}
              height={220}
              onBarClick={goToUserRequestSlice}
              clickHint="Click a segment to review these tickets"
            />
          </motion.div>
        </motion.div>
      </div>

      <div>
        <PageSection
          title="Category, Customer & Time Breakdowns"
          subtitle="Cross-sections by module, company, business service, and time, with click-through to matching tickets."
        />
        <motion.div
          initial="hidden"
          animate="show"
          variants={gridVariants}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Top Categories"
              type="bar"
              data={charts.top_modules}
              onBarClick={(name) => goToTickets({ module: name })}
              clickHint="Click a bar to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Pending Reasons"
              type="bar"
              data={charts.pending_reasons}
              onBarClick={(name) => goToTickets({ q: name })}
              clickHint="Click a bar to search tickets for that reason"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Company-wise Tickets"
              type="bar"
              data={charts.customer_tickets}
              onBarClick={(name) => goToTickets({ customer: name })}
              clickHint="Click a bar to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Business Service-wise Tickets"
              type="bar"
              data={charts.application_tickets}
              onBarClick={(name) => goToTickets({ application: name })}
              clickHint="Click a bar to view those tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Monthly Trend"
              type="line"
              data={charts.monthly_trend}
              onBarClick={goToTrendMonth}
              clickHint="Click a point to view that month's tickets"
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ChartCard
              title="Weekly Trend"
              type="line"
              data={charts.weekly_trend}
              onBarClick={goToTrendWeek}
              clickHint="Click a point to view that week's tickets"
            />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

// Compact clickable stat used in the Health Snapshot band - icon chip plus
// a big tabular number, drilling into the matching ticket list on click.
function SnapshotStat({ icon: Icon, tone, label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 text-left"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 transition-transform duration-200 group-hover:scale-105 dark:bg-slate-700/60 ${tone}`}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {Number(value ?? 0).toLocaleString()}
        </span>
        <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
      </span>
    </button>
  );
}
