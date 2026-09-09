import { useEffect, useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  PackageSearch,
  ArrowRight,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Layers,
  Users,
  Clock3,
  UserRound,
} from "lucide-react";
import api from "../services/api";
import FilterBar from "../components/FilterBar";
import KpiCard from "../components/KpiCard";
import ChartCard from "../components/ChartCard";
import PageSection from "../components/PageSection";

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};
const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

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

// Columns the table can be sorted by: the key in each backlog row plus the
// label shown in the header.
const SORT_COLUMNS = [
  ["assignee", "Associate"],
  ["bucket_0_30", "0-30 days"],
  ["bucket_31_60", "31-60 days"],
  ["bucket_61_90", "61-90 days"],
  ["bucket_90_plus", "90+ days"],
  ["total", "Total open"],
];

function bucketBarWidth(value, max) {
  if (!max) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

export default function Backlog() {
  const [datasetId, setDatasetId] = useState(null);
  const [backlog, setBacklog] = useState(null);
  const [filterOptions, setFilterOptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  // Table ordering: default to heaviest workload first, since an SDM opening
  // this page wants to know who is most loaded before anything else.
  const [sortKey, setSortKey] = useState("total");
  const [sortDir, setSortDir] = useState("desc");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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
    navigate(`/backlog?${next.toString()}`);
  }

  function clearFilterBarParams() {
    navigate("/backlog");
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Names read naturally A->Z; counts read naturally largest first.
      setSortDir(key === "assignee" ? "asc" : "desc");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: current } = await api.get("/dashboard/current-dataset");
      const ids = current.dataset_ids?.join(",");
      if (!ids) {
        setLoading(false);
        return;
      }
      setDatasetId(ids);
      const params = { dataset_id: ids };
      for (const key of FILTER_BAR_KEYS) {
        const v = searchParams.get(key);
        if (v) params[key] = v;
      }
      const { data } = await api.get("/dashboard/backlog", { params });
      setBacklog(data.backlog);
      setFilterOptions(data.filter_options || {});
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  // Multi-keyword search over associate name: every term must appear
  // somewhere in the name (handles typing the name in a different word
  // order, e.g. "Petrova Elena").
  const filteredBacklog = useMemo(() => {
    if (!backlog) return backlog;
    const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return backlog;
    return backlog.filter((row) => {
      const name = row.assignee.toLowerCase();
      return terms.every((term) => name.includes(term));
    });
  }, [backlog, searchQuery]);

  const sortedBacklog = useMemo(() => {
    if (!filteredBacklog || !sortKey) return filteredBacklog;
    return [...filteredBacklog].sort((a, b) => {
      if (sortKey === "assignee") {
        const cmp = String(a.assignee).localeCompare(
          String(b.assignee),
          undefined,
          {
            numeric: true,
          },
        );
        return sortDir === "asc" ? cmp : -cmp;
      }
      const diff = (b[sortKey] || 0) - (a[sortKey] || 0);
      return sortDir === "desc" ? diff : -diff;
    });
  }, [filteredBacklog, sortKey, sortDir]);

  // Aggregates for the snapshot band and the two summary charts, derived
  // client-side from the same rows the table shows (so filters apply).
  const backlogStats = useMemo(() => {
    if (!backlog?.length) return null;
    const sumBucket = (key) => backlog.reduce((s, b) => s + (b[key] || 0), 0);
    const totalOpen = backlog.reduce((s, b) => s + b.total, 0);
    const stale = sumBucket("bucket_61_90") + sumBucket("bucket_90_plus");
    return {
      totalOpen,
      associates: backlog.length,
      stale,
      stalePct: totalOpen ? Math.round((stale / totalOpen) * 1000) / 10 : 0,
      avgPerAssociate: totalOpen / backlog.length,
      buckets: [
        { name: "0-30 days", value: sumBucket("bucket_0_30") },
        { name: "31-60 days", value: sumBucket("bucket_31_60") },
        { name: "61-90 days", value: sumBucket("bucket_61_90") },
        { name: "90+ days", value: sumBucket("bucket_90_plus") },
      ],
      topAssociates: [...backlog]
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map((b) => ({ name: b.assignee, value: b.total })),
    };
  }, [backlog]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton h-16" />
        ))}
      </div>
    );
  }

  if (!datasetId) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
        <PackageSearch size={36} className="text-slate-300" />
        <p className="text-lg font-semibold">No dataset uploaded yet</p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">
          Go to Upload
        </Link>
      </div>
    );
  }

  const maxTotal = backlog?.length
    ? Math.max(...backlog.map((b) => b.total))
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          Open Work by Associate
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Currently-open tickets per associate, by how long they've been
          sitting. Click any column to re-sort the table; click a row to see
          every ticket.
        </p>
      </div>

      <FilterBar
        filters={barFilters}
        filterOptions={filterOptions}
        onChange={updateFilterParam}
        onDateChange={updateFilterParam}
        onClear={clearFilterBarParams}
        excludeKeys={["assignee"]}
      />

      {/* Snapshot band - totals across every associate in the current view */}
      {backlogStats && (
        <motion.div initial="hidden" animate="show" variants={gridVariants}>
          <PageSection
            title="Backlog Snapshot"
            subtitle="Aggregated from the currently-open tickets behind the table below."
          />
          <motion.div
            variants={rowVariants}
            className="grid grid-cols-2 gap-4 sm:grid-cols-4"
          >
            <KpiCard
              label="Total Open"
              value={backlogStats.totalOpen}
              icon={Layers}
              accent="brand"
            />
            <KpiCard
              label="Associates Loaded"
              value={backlogStats.associates}
              icon={Users}
              accent="slate"
            />
            <KpiCard
              label="Stale 61d+"
              value={backlogStats.stale}
              icon={Clock3}
              accent={backlogStats.stale > 0 ? "amber" : "emerald"}
              progress={backlogStats.stalePct}
            />
            <KpiCard
              label="Avg per Associate"
              value={backlogStats.avgPerAssociate}
              decimals={1}
              icon={UserRound}
              accent="emerald"
            />
          </motion.div>
        </motion.div>
      )}

      {/* Summary charts - where the backlog piles up by age and by person */}
      {backlogStats && (
        <motion.div initial="hidden" animate="show" variants={gridVariants}>
          <PageSection
            title="Aging & Load Distribution"
            subtitle="Where the backlog concentrates by ticket age and by associate."
          />
          <motion.div
            variants={rowVariants}
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <ChartCard
              title="Open Tickets by Age Bucket"
              type="bar"
              data={backlogStats.buckets}
              height={250}
            />
            <ChartCard
              title="Most Loaded Associates"
              subtitle="Top 10 by currently-open ticket count"
              type="bar"
              data={backlogStats.topAssociates}
              height={250}
              onBarClick={(name) =>
                navigate(`/tickets?assignee=${encodeURIComponent(name)}`)
              }
              clickHint="Click a bar to view that associate's tickets"
            />
          </motion.div>
        </motion.div>
      )}

      {backlog?.length > 0 && (
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by associate name — try multiple words..."
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
      )}

      {!backlog?.length ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          No open tickets in the current dataset — backlog is empty.
        </div>
      ) : filteredBacklog.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          No associates match your search.
        </div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={gridVariants}
          className="card overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
            <span>
              {sortedBacklog.length} of {backlog.length} associate
              {backlog.length === 1 ? "" : "s"} shown.
            </span>
            {(sortKey !== "total" || sortDir !== "desc") && (
              <button
                onClick={() => {
                  setSortKey("total");
                  setSortDir("desc");
                }}
                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Reset sort
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-700/50">
                  {SORT_COLUMNS.map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={`cursor-pointer select-none whitespace-nowrap px-5 py-3 font-medium transition-colors hover:text-slate-600 dark:hover:text-slate-200 ${
                        sortKey === key
                          ? "text-brand-600 dark:text-brand-400"
                          : ""
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {sortKey === key ? (
                          sortDir === "asc" ? (
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
                  ))}
                  <th className="w-8 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedBacklog.map((row) => (
                  <motion.tr
                    key={row.assignee}
                    variants={rowVariants}
                    onClick={() =>
                      navigate(
                        `/tickets?assignee=${encodeURIComponent(row.assignee)}`,
                      )
                    }
                    className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-brand-50/50 dark:border-slate-700/50 dark:hover:bg-brand-950/20"
                  >
                    <td className="whitespace-nowrap px-5 py-3.5 font-medium">
                      {row.assignee}
                    </td>
                    <td className="px-5 py-3.5">
                      <BucketCell
                        value={row.bucket_0_30}
                        max={maxTotal}
                        color="bg-emerald-400"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <BucketCell
                        value={row.bucket_31_60}
                        max={maxTotal}
                        color="bg-amber-400"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <BucketCell
                        value={row.bucket_61_90}
                        max={maxTotal}
                        color="bg-orange-500"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <BucketCell
                        value={row.bucket_90_plus}
                        max={maxTotal}
                        color="bg-rose-600"
                      />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono font-semibold tabular-nums">
                      {row.total}
                    </td>
                    <td className="px-5 py-3.5 text-slate-300">
                      <ArrowRight size={15} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function BucketCell({ value, max, color }) {
  if (!value)
    return (
      <span className="text-xs text-slate-300 dark:text-slate-600">
        &mdash;
      </span>
    );
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 font-mono text-xs tabular-nums">
        {value}
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${bucketBarWidth(value, max)}%` }}
        />
      </div>
    </div>
  );
}
