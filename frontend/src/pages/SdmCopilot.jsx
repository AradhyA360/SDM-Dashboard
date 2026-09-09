import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Sparkles, RefreshCw, AlertTriangle, ArrowRightLeft, CalendarClock, ThumbsUp,
  Flame, Gauge, Layers, Smile, ShieldAlert, Files, Info,
} from 'lucide-react'
import api from '../services/api'

const URGENCY_STYLES = {
  high: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30',
  medium: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30',
  low: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60',
}
const URGENCY_DOT = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
}

function StatChip({ icon: Icon, label, value, accent }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accent}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="font-mono text-lg font-bold tabular-nums leading-none">{value}</p>
        <p className="mt-1 text-xs text-slate-400">{label}</p>
      </div>
    </div>
  )
}

export default function SdmCopilot() {
  const [datasetId, setDatasetId] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [loading, setLoading] = useState(false)
  const [briefing, setBriefing] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function init() {
      const { data } = await api.get('/dashboard/current-dataset')
      const ids = data.dataset_ids?.join(',')
      setDatasetId(ids || null)
      setInitializing(false)
      if (ids) generate(ids)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function generate(idsOverride) {
    const ids = idsOverride || datasetId
    if (!ids) return
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/copilot/briefing', { params: { dataset_id: ids } })
      setBriefing(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate briefing')
    } finally {
      setLoading(false)
    }
  }

  if (initializing) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-40" />
      </div>
    )
  }

  if (!datasetId) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
        <Files size={36} className="text-slate-300" />
        <p className="text-lg font-semibold">No active dataset</p>
        <p className="text-sm text-slate-400">Upload or activate a ticket export first.</p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">Go to Upload</Link>
      </div>
    )
  }

  const facts = briefing?.facts
  const narrative = briefing?.narrative

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            <Sparkles size={20} className="text-brand-500" /> SDM Copilot
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Your same-day action plan - backlog, SLA risk, and today's team coverage, cross-referenced automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {briefing?.provider && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              via {briefing.provider}
            </span>
          )}
          <button onClick={() => generate()} disabled={loading} className="btn-primary flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {briefing ? 'Refresh Briefing' : 'Generate Briefing'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            {error}
            {error.toLowerCase().includes('api key') && (
              <> — <Link to="/settings" className="underline">check Settings</Link>.</>
            )}
          </div>
        </div>
      )}

      {loading && !briefing && (
        <div className="card flex flex-col items-center gap-3 p-16 text-center text-sm text-slate-400">
          <Sparkles size={28} className="animate-pulse text-brand-400" />
          Cross-referencing backlog with today's coverage…
        </div>
      )}

      {facts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip icon={Layers} label="Backlog (excl. requests)" value={facts.kpis.backlog_tickets} accent="bg-amber-100 text-amber-600 dark:bg-amber-900/40" />
          <StatChip icon={Flame} label="P1 Tickets" value={facts.kpis.p1_tickets} accent="bg-red-100 text-red-600 dark:bg-red-900/40" />
          <StatChip icon={Gauge} label="SLA Compliance" value={`${facts.kpis.sla_compliance_pct}%`} accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40" />
          <StatChip icon={Smile} label="CSAT" value={`${facts.kpis.csat_pct}%`} accent="bg-sky-100 text-sky-600 dark:bg-sky-900/40" />
        </div>
      )}

      {narrative && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="card flex items-start gap-3 border-brand-200 bg-brand-50/60 p-5 dark:border-brand-900/50 dark:bg-brand-950/20">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-brand-500" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{narrative.headline}</p>
          </div>

          {narrative.priority_actions?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <ShieldAlert size={15} /> Priority Actions
              </p>
              <div className="space-y-2">
                {narrative.priority_actions.map((a, i) => (
                  <div key={i} className={`card flex items-start gap-2.5 border p-3.5 ${URGENCY_STYLES[a.urgency] || URGENCY_STYLES.low}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[a.urgency] || URGENCY_DOT.low}`} />
                    <div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{a.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {narrative.coverage_watch?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <CalendarClock size={15} /> Coverage Watch (Next 7 Days)
              </p>
              <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-700">
                {narrative.coverage_watch.map((c, i) => (
                  <p key={i} className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">{c}</p>
                ))}
              </div>
            </div>
          )}

          {narrative.reassignment_calls?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <ArrowRightLeft size={15} /> Suggested Reassignments
              </p>
              <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-700">
                {narrative.reassignment_calls.map((r, i) => (
                  <p key={i} className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">{r}</p>
                ))}
              </div>
            </div>
          )}

          {narrative.good_news?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <ThumbsUp size={15} /> Good News
              </p>
              <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-700">
                {narrative.good_news.map((g, i) => (
                  <p key={i} className="px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-400">{g}</p>
                ))}
              </div>
            </div>
          )}

          {facts && (facts.coverage_gaps.length > 0 || facts.reassignment_suggestions.length > 0) && (
            <div className="card p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                <Info size={13} /> Source facts (every claim above traces back to these)
              </p>
              <div className="space-y-1 text-xs text-slate-500">
                {facts.coverage_gaps.map((g, i) => (
                  <p key={`gap-${i}`}>
                    {g.date} · {g.team_area} area fully out: {g.associates_out.join(', ')}
                  </p>
                ))}
                {facts.reassignment_suggestions.map((r, i) => (
                  <p key={`re-${i}`}>
                    {r.from_associate} ({r.from_backlog_count} tickets, {r.team_area}, on Leave) → {r.to_associate} ({r.to_current_backlog_count} tickets currently)
                  </p>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
