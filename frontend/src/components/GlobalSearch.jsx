import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2, ArrowRight, TicketX } from "lucide-react";
import api from "../services/api";
import { PriorityBadge, StateBadge, SlaStateBadge } from "./Badges";

const DEBOUNCE_MS = 300;

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [noDataset, setNoDataset] = useState(false);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target))
        setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Resolved fresh on every search rather than cached from mount - the
  // header persists across route changes, so a dataset uploaded/switched
  // after this component first mounted would otherwise leave a stale (or
  // null) id and the search would never work.
  async function resolveDatasetId() {
    try {
      const { data } = await api.get("/dashboard/current-dataset");
      return data.dataset_ids?.length ? data.dataset_ids.join(",") : null;
    } catch {
      return null;
    }
  }

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const datasetId = await resolveDatasetId();
    if (requestId !== requestIdRef.current) return; // superseded by a newer search
    if (!datasetId) {
      setNoDataset(true);
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setNoDataset(false);
    try {
      const { data } = await api.get("/dashboard/search", {
        params: { dataset_id: datasetId, q, limit: 8 },
      });
      if (requestId !== requestIdRef.current) return; // stale response, a newer search superseded it
      setResults(data.results || []);
      setTotal(data.total || 0);
    } catch {
      if (requestId === requestIdRef.current) {
        setResults([]);
        setTotal(0);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  function onChange(e) {
    const v = e.target.value;
    setQuery(v);
    setActiveIndex(-1);
    if (!open) setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(v), DEBOUNCE_MS);
  }

  function goToAllResults(q) {
    setOpen(false);
    navigate(`/tickets?q=${encodeURIComponent(q)}`);
  }

  function goToResult(r) {
    setOpen(false);
    navigate(`/tickets?q=${encodeURIComponent(r.number)}`);
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setTotal(0);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open) return;
    const rowCount = results.length;
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && results[activeIndex])
        goToResult(results[activeIndex]);
      else if (query.trim()) goToAllResults(query);
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={query}
          onChange={onChange}
          onFocus={() => query.trim() && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Spotlight Search"
          className="input-field w-full py-2 pl-9 pr-8 text-sm"
        />
        {loading ? (
          <Loader2
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
          />
        ) : query ? (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <AnimatePresence>
        {open && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 z-40 mt-2 max-h-[28rem] overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800"
          >
            {noDataset ? (
              <p className="p-4 text-center text-sm text-slate-400">
                Upload a dataset first to search tickets.
              </p>
            ) : loading && results.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-400">
                Searching…
              </p>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <TicketX size={22} className="text-slate-300" />
                <p className="text-sm text-slate-400">
                  No tickets match "{query}"
                </p>
              </div>
            ) : (
              <>
                <ul>
                  {results.map((r, i) => (
                    <li key={r.number + i}>
                      <button
                        onClick={() => goToResult(r)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-2.5 text-left transition-colors last:border-0 dark:border-slate-700/60 ${
                          activeIndex === i
                            ? "bg-brand-50/70 dark:bg-brand-950/30"
                            : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-400">
                              {r.number}
                            </span>
                            <PriorityBadge value={r.priority} />
                            <StateBadge value={r.status} />
                            <SlaStateBadge value={r.sla_state} />
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-200">
                            {r.short_description}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">
                            {r.service}{" "}
                            {r.service && r.assigned_to ? "\u00b7" : ""}{" "}
                            {r.assigned_to}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => goToAllResults(query)}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-xs font-medium text-brand-600 hover:bg-brand-50/60 dark:border-slate-700 dark:text-brand-400 dark:hover:bg-brand-950/20"
                >
                  View all {total} result{total === 1 ? "" : "s"}{" "}
                  <ArrowRight size={12} />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
