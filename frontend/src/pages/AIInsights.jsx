import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, RefreshCw, Copy, Download, AlertCircle, FileText, Search, ShieldAlert, Blocks,
  Users, Timer, ListChecks, Briefcase, TrendingUp, Check, Ticket, ShieldCheck, Clock3,
  Gauge, Target, AlertTriangle,
} from 'lucide-react'
import api from '../services/api'
import { Link, useNavigate } from 'react-router-dom'
import AIThinkingLoader from '../components/AIThinkingLoader'
import ChartCard from '../components/ChartCard'
import KpiCard from '../components/KpiCard'

/** Short AI callout sections — SDM-oriented decision themes */
const SECTIONS = [
  ['executive_summary', 'Snapshot', FileText],
  ['top_risks', 'Risks', ShieldAlert],
  ['bottlenecks', 'Bottlenecks', Blocks],
  ['workload_imbalance', 'Workload', Users],
  ['sla_risk_explanation', 'SLA Focus', Timer],
  ['recommended_actions', 'Actions', ListChecks],
  ['next_week_prediction', 'Outlook', TrendingUp],
  ['root_cause_analysis', 'Root causes', Search],
  ['management_summary', 'For leadership', Briefcase],
]

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
}
const cardVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
}

function sumValues(arr) {
  return (arr || []).reduce((acc, d) => acc + (d.value || 0), 0)
}
function findValue(arr, name) {
  return (arr || []).find((d) => d.name === name)?.value ?? 0
}

/** Traffic-light tone for a decision factor */
function factorTone(status) {
  if (status === 'critical') return { ring: 'ring-rose-200 dark:ring-rose-900', bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', label: 'Critical' }
  if (status === 'watch') return { ring: 'ring-amber-200 dark:ring-amber-900', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Watch' }
  return { ring: 'ring-emerald-200 dark:ring-emerald-900', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Healthy' }
}

export default function AIInsights() {
  const [datasetId, setDatasetId] = useState(null)
  const [insights, setInsights] = useState(null)
  const [provider, setProvider] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [initializing, setInitializing] = useState(true)
  const [justCopied, setJustCopied] = useState(false)
  const [expandedSections, setExpandedSections] = useState({})
  const [charts, setCharts] = useState(null)
  const [kpis, setKpis] = useState(null)
  const [userRequestInfo, setUserRequestInfo] = useState(null)
  const navigate = useNavigate()
  const BULLET_PREVIEW_COUNT = 2

  function toggleExpanded(key) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    async function init() {
      const { data } = await api.get('/dashboard/current-dataset')
      const ids = data.dataset_ids?.join(',')
      setDatasetId(ids || null)
      if (ids) {
        try {
          const { data: dash } = await api.get('/dashboard', { params: { dataset_id: ids } })
          setCharts(dash.charts)
          setKpis(dash.kpis)
        } catch {
          // supporting visuals only
        }
        try {
          const { data: ur } = await api.get('/dashboard/user-requests', { params: { dataset_id: ids } })
          setUserRequestInfo({ summary: ur.summary, requesters: ur.requesters?.slice(0, 5) || [] })
        } catch {
          // optional
        }
      }
      setInitializing(false)
    }
    init()
  }, [])

  async function generate() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/generate-ai-summary', { dataset_id: datasetId })
      setInsights(data.insights)
      setProvider(data.provider)
      setExpandedSections({})
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate insights')
    } finally {
      setLoading(false)
    }
  }

  function buildText() {
    return SECTIONS.map(([key, label]) => {
      const val = insights[key]
      if (val === undefined || val === null) return null
      const body = Array.isArray(val) ? val.map((v) => `• ${v}`).join('\n') : val
      return `${label}\n${body}`
    }).filter(Boolean).join('\n\n')
  }

  function copyAll() {
    if (!insights) return
    navigator.clipboard.writeText(buildText())
    setJustCopied(true)
    setTimeout(() => setJustCopied(false), 1800)
  }

  function downloadText() {
    if (!insights) return
    const blob = new Blob([buildText()], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ai-insights.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  /** SDM decision factors — computed from live KPIs/charts, not AI prose */
  const decisionFactors = useMemo(() => {
    if (!kpis && !charts) return []
    const slaPct = kpis?.sla_compliance_pct ?? null
    const breach = kpis?.sla_breached ?? findValue(charts?.sla_risk, 'Breached')
    const atRisk = kpis?.sla_at_risk ?? findValue(charts?.sla_risk, 'At Risk')
    const open = kpis?.open_tickets ?? 0
    const total = kpis?.total_tickets ?? sumValues(charts?.priority_distribution)
    const p1 = kpis?.p1_tickets ?? findValue(charts?.priority_distribution, 'P1')
    const aging20 = findValue(charts?.aging_distribution, '20d+')
    const avgAge = kpis?.avg_ticket_age_days ?? 0
    const urPct = userRequestInfo?.summary?.flagged_pct ?? 0
    const urCount = userRequestInfo?.summary?.flagged_count ?? 0

    // Workload concentration: share of open work on top associate
    const workload = charts?.assignee_workload || []
    const topLoad = workload[0]?.value ?? 0
    const loadTotal = sumValues(workload) || 1
    const topShare = Math.round((topLoad / loadTotal) * 100)

    return [
      {
        key: 'sla',
        title: 'SLA compliance',
        value: slaPct != null ? `${slaPct}%` : '—',
        detail: `${breach} breached · ${atRisk} at risk (≤24h)`,
        status: slaPct == null ? 'watch' : slaPct >= 85 ? 'ok' : slaPct >= 70 ? 'watch' : 'critical',
        onClick: () => navigate('/tickets?view=sla_breach'),
        icon: ShieldCheck,
      },
      {
        key: 'p1',
        title: 'P1 pressure',
        value: String(p1),
        detail: total ? `${Math.round((p1 / total) * 100)}% of all tickets` : 'Highest priority',
        status: p1 === 0 ? 'ok' : p1 <= 5 ? 'watch' : 'critical',
        onClick: () => navigate('/tickets?priority=P1'),
        icon: AlertTriangle,
      },
      {
        key: 'aging',
        title: 'Aging 20d+',
        value: String(aging20),
        detail: `Avg age ${avgAge} days · ${open} still open`,
        status: aging20 === 0 ? 'ok' : aging20 <= 10 ? 'watch' : 'critical',
        onClick: () => navigate('/backlog'),
        icon: Clock3,
      },
      {
        key: 'workload',
        title: 'Workload skew',
        value: `${topShare}%`,
        detail: workload[0] ? `Top: ${workload[0].name} (${topLoad} tickets)` : 'No open assignee data',
        status: topShare <= 25 ? 'ok' : topShare <= 40 ? 'watch' : 'critical',
        onClick: () => navigate('/backlog'),
        icon: Users,
      },
      {
        key: 'ur',
        title: 'User requests in incidents',
        value: urPct ? `${urPct}%` : '0%',
        detail: `${urCount} tickets look like access/data/how-to`,
        status: urPct < 10 ? 'ok' : urPct < 25 ? 'watch' : 'critical',
        onClick: () => navigate('/user-requests'),
        icon: Target,
      },
      {
        key: 'open',
        title: 'Open backlog',
        value: String(open),
        detail: total ? `${Math.round((open / total) * 100)}% of volume still open` : 'Current open tickets',
        status: open === 0 ? 'ok' : open / Math.max(total, 1) < 0.25 ? 'watch' : 'critical',
        onClick: () => navigate('/tickets?view=open'),
        icon: Ticket,
      },
    ]
  }, [kpis, charts, userRequestInfo, navigate])

  if (initializing) return <div className="skeleton h-64" />

  if (!datasetId) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
        <Sparkles size={36} className="text-slate-300" />
        <p className="text-lg font-semibold">No dataset available</p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">Go to Upload</Link>
      </motion.div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Decision factors &amp; AI brief
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Live stats that drive SDM calls — plus a short AI brief grounded in those numbers.
          </p>
        </div>
        <div className="flex gap-2">
          {insights && (
            <>
              <button onClick={copyAll} className="btn-secondary flex items-center gap-2 text-sm">
                {justCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                {justCopied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={downloadText} className="btn-secondary flex items-center gap-2 text-sm"><Download size={14} /> Download</button>
            </>
          )}
          <button onClick={generate} disabled={loading} className="btn-primary flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {insights ? 'Regenerate brief' : 'Generate AI brief'}
          </button>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            {error}
            {error.toLowerCase().includes('api key') && (
              <> — <Link to="/settings" className="underline">add one in Settings</Link>.</>
            )}
          </div>
        </motion.div>
      )}

      {/* ——— Decision factor scorecards (always on, no AI needed) ——— */}
      {decisionFactors.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Gauge size={13} /> Deciding factors
          </p>
          <motion.div initial="hidden" animate="show" variants={gridVariants} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {decisionFactors.map((f) => {
              const tone = factorTone(f.status)
              const Icon = f.icon
              return (
                <motion.button
                  key={f.key}
                  type="button"
                  variants={cardVariants}
                  onClick={f.onClick}
                  className={`card flex flex-col gap-2 p-4 text-left ring-1 transition-shadow hover:shadow-lg ${tone.ring}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 ${tone.text}`}>
                        <Icon size={15} />
                      </span>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{f.title}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.text} bg-slate-50 dark:bg-slate-800`}>
                      {tone.label}
                    </span>
                  </div>
                  <p className="font-mono text-2xl font-bold tabular-nums">{f.value}</p>
                  <p className="text-xs text-slate-500">{f.detail}</p>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className={`h-full rounded-full ${tone.bar}`} style={{ width: f.status === 'critical' ? '85%' : f.status === 'watch' ? '55%' : '30%' }} />
                  </div>
                </motion.button>
              )
            })}
          </motion.div>
        </div>
      )}

      {/* ——— Histogram-style decision charts (unique focus, not full Deep Analytics clone) ——— */}
      {charts && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Target size={13} /> Where attention goes
          </p>
          <motion.div initial="hidden" animate="show" variants={gridVariants} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <motion.div variants={cardVariants}>
              <ChartCard
                title="SLA risk stack"
                type="bar"
                data={charts.sla_risk}
                height={220}
                onBarClick={(name) => {
                  const map = { Breached: 'sla_breach', 'At Risk': 'sla_at_risk', Healthy: 'sla_compliant' }
                  navigate(`/tickets?view=${map[name] || ''}`)
                }}
                clickHint="Click a bar to open those tickets"
              />
            </motion.div>
            <motion.div variants={cardVariants}>
              <ChartCard
                title="Ticket aging histogram"
                type="bar"
                data={charts.aging_distribution}
                height={220}
                onBarClick={() => navigate('/backlog')}
                clickHint="Click to open backlog by age"
              />
            </motion.div>
            <motion.div variants={cardVariants}>
              <ChartCard
                title="Priority mix"
                type="pie"
                data={charts.priority_distribution}
                height={220}
                onBarClick={(name) => navigate(`/tickets?priority=${encodeURIComponent(name)}`)}
                clickHint="Click a slice for that priority"
              />
            </motion.div>
            <motion.div variants={cardVariants}>
              <ChartCard
                title="Open workload by associate"
                type="bar"
                data={(charts.assignee_workload || []).slice(0, 8)}
                height={220}
                onBarClick={(name) => navigate(`/tickets?assignee=${encodeURIComponent(name)}`)}
                clickHint="Click a bar for that associate’s tickets"
              />
            </motion.div>
            <motion.div variants={cardVariants}>
              <ChartCard
                title="Category volume (bottleneck lens)"
                type="bar"
                data={charts.top_modules}
                height={220}
                onBarClick={(name) => navigate(`/tickets?module=${encodeURIComponent(name)}`)}
                clickHint="Click a bar for that category"
              />
            </motion.div>
            <motion.div variants={cardVariants}>
              <ChartCard
                title="User request vs real incident"
                type="pie"
                data={charts.user_request_vs_incident}
                height={220}
                onBarClick={(name) => {
                  const n = String(name || '').toLowerCase()
                  if (n.includes('request')) navigate('/user-requests')
                  else navigate('/tickets')
                }}
                clickHint="Click to review the list"
              />
            </motion.div>
          </motion.div>
        </div>
      )}

      {userRequestInfo?.summary?.flagged_count > 0 && (
        <button
          type="button"
          onClick={() => navigate('/user-requests')}
          className="card flex w-full cursor-pointer flex-wrap items-center justify-between gap-4 border-l-4 border-l-amber-400 p-4 text-left transition-shadow hover:shadow-lg"
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert size={15} className="text-amber-500" />
              {userRequestInfo.summary.flagged_pct}% of incidents read as user requests
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {userRequestInfo.summary.flagged_count} tickets · top requesters:{' '}
              {(userRequestInfo.requesters || []).map((r) => `${r.name} (${r.percent}%)`).join(', ') || '—'}
            </p>
          </div>
          <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Review →</span>
        </button>
      )}

      <AnimatePresence>{loading && <AIThinkingLoader />}</AnimatePresence>

      {!insights && !loading && !error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="card flex flex-col items-center justify-center gap-3 p-12 text-center text-slate-500"
        >
          <Sparkles size={28} className="text-brand-300" />
          <p className="text-sm">
            Stats above are live from your data. Click <span className="font-medium text-slate-700 dark:text-slate-200">Generate AI brief</span> for short, number-backed callouts only.
          </p>
        </motion.div>
      )}

      {/* ——— Compact AI brief (short bullets, not essays) ——— */}
      {insights && !loading && (
        <motion.div initial="hidden" animate="show" variants={gridVariants} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">AI brief</p>
            {provider && (
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                via {provider}
              </span>
            )}
            <span className="text-[11px] text-slate-400">Short bullets with numbers — expand a section only if needed</span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {SECTIONS.map(([key, label, Icon]) => {
              const val = insights[key]
              if (val === undefined || val === null) return null
              const items = Array.isArray(val) ? val : [String(val)]
              const showAll = expandedSections[key]
              const visible = showAll ? items : items.slice(0, BULLET_PREVIEW_COUNT)
              return (
                <motion.div
                  key={key}
                  variants={cardVariants}
                  className="card border-l-4 border-l-brand-500 p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400">
                      <Icon size={14} />
                    </span>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
                    <span className="ml-auto font-mono text-[10px] text-slate-300">{items.length}</span>
                  </div>
                  <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    {visible.map((v, i) => (
                      <li key={i} className="flex gap-2 leading-snug">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                  {items.length > BULLET_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      className="mt-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {showAll ? 'Show less' : `+${items.length - BULLET_PREVIEW_COUNT} more`}
                    </button>
                  )}
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      )}
    </div>
  )
}
