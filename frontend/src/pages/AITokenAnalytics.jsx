import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Coins, Hash, ArrowDownToLine, ArrowUpFromLine, DollarSign, Gauge, SlidersHorizontal, ChevronDown, X, Server, Cpu, Search, Activity } from 'lucide-react'
import api from '../services/api'
import KpiCard from '../components/KpiCard'
import ChartCard from '../components/ChartCard'

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
}

const FEATURE_LABELS = { insights: 'AI Insights', chat: 'AI Chatbot' }

export default function AITokenAnalytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [logSearch, setLogSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: resp } = await api.get('/ai-token-analytics', { params: filters })
      setData(resp)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load token analytics')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    load()
  }, [load])

  function updateFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value || undefined }))
  }
  function clearFilters() {
    setFilters({})
  }

  const activeFilterEntries = useMemo(() => Object.entries(filters).filter(([, v]) => v), [filters])

  const tokenTrend = useMemo(
    () => (data?.usage_by_date || []).map((d) => ({ name: d.date, input: d.input_tokens, output: d.output_tokens })),
    [data]
  )
  const requestTrend = useMemo(() => (data?.usage_by_date || []).map((d) => ({ name: d.date, value: d.requests })), [data])
  const efficiencyTrend = useMemo(
    () => (data?.usage_by_date || []).map((d) => ({ name: d.date, value: d.requests ? Math.round(d.tokens / d.requests) : 0 })),
    [data]
  )
  const visibleLogs = useMemo(() => (data?.usage_logs || []).filter((log) => {
    const needle = logSearch.trim().toLowerCase()
    return !needle || [log.feature, log.provider, log.model, log.user_name].filter(Boolean).join(' ').toLowerCase().includes(needle)
  }), [data, logSearch])

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-24" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-64" />)}
        </div>
      </div>
    )
  }

  const summary = data?.summary || {}
  const filterOptions = data?.filter_options || { providers: [], models: [], features: [], users: [] }
  const showUserBreakdown = data?.scope === 'all'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          Token Usage &amp; Cost
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {showUserBreakdown ? 'Groq-style request observability across every user and AI feature.' : 'Groq-style request observability for your AI activity.'}
        </p>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/50"
          >
            <SlidersHorizontal size={13} /> Filters
            <ChevronDown size={13} className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>
          {activeFilterEntries.length > 0 && (
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {activeFilterEntries.map(([key, val]) => (
                <span key={key} className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                  {val}
                  <button onClick={() => updateFilter(key, '')} className="text-brand-400 hover:text-brand-700 dark:hover:text-brand-100">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <button onClick={clearFilters} className="text-xs font-medium text-slate-400 underline hover:text-slate-600">Clear all</button>
            </div>
          )}
        </div>

        {filtersOpen && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 dark:border-slate-700 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">From</label>
              <input type="date" className="input-field py-1.5 text-xs" value={filters.date_from || ''} onChange={(e) => updateFilter('date_from', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">To</label>
              <input type="date" className="input-field py-1.5 text-xs" value={filters.date_to || ''} onChange={(e) => updateFilter('date_to', e.target.value)} />
            </div>
            <div><label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">Operation</label><select className="input-field py-1.5 text-xs" value={filters.feature || ''} onChange={(e) => updateFilter('feature', e.target.value)}>
              <option value="">All Features</option>
              {filterOptions.features.map((f) => <option key={f} value={f}>{FEATURE_LABELS[f] || f}</option>)}
            </select></div>
            <div><label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">Provider</label><select className="input-field py-1.5 text-xs" value={filters.provider || ''} onChange={(e) => updateFilter('provider', e.target.value)}>
              <option value="">All Providers</option>
              {filterOptions.providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></div>
            <div><label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">Model</label><select className="input-field py-1.5 text-xs" value={filters.model || ''} onChange={(e) => updateFilter('model', e.target.value)}>
              <option value="">All Models</option>
              {filterOptions.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></div>
            {showUserBreakdown && (
              <div><label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">User</label><select className="input-field py-1.5 text-xs" value={filters.user_id || ''} onChange={(e) => updateFilter('user_id', e.target.value)}>
                <option value="">All Users</option>
                {filterOptions.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select></div>
            )}
          </div>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {!summary.requests ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
          <Coins size={36} className="text-slate-300" />
          <p className="text-lg font-semibold">No AI usage recorded yet</p>
          <p className="text-sm text-slate-400">Token usage will show up here after you run AI Insights or use the AI Chatbot.</p>
          <Link to="/ai?tab=insights" className="btn-primary mt-2">Try AI Insights</Link>
        </div>
      ) : (
        <>
          <motion.div initial="hidden" animate="show" variants={gridVariants} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Requests" value={summary.requests} icon={Hash} accent="brand" />
            <KpiCard label="Input Tokens" value={summary.input_tokens} icon={ArrowDownToLine} accent="slate" />
            <KpiCard label="Output Tokens" value={summary.output_tokens} icon={ArrowUpFromLine} accent="slate" />
            <KpiCard label="Total Tokens" value={summary.total_tokens} icon={Coins} accent="amber" />
            <KpiCard label="Avg Tokens/Request" value={summary.avg_tokens_per_request} icon={Gauge} accent="emerald" decimals={1} />
            <KpiCard label="Estimated Cost" value={`$${(summary.estimated_cost_usd ?? 0).toFixed(4)}`} icon={DollarSign} accent="emerald" />
            <KpiCard label="Active Models" value={summary.active_models} icon={Cpu} accent="brand" />
            <KpiCard label="Providers" value={summary.active_providers} icon={Server} accent="slate" />
          </motion.div>
          <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3.5 text-xs text-slate-500">
            <span className="font-medium text-slate-700 dark:text-slate-200">Most-used model</span><span className="rounded bg-brand-50 px-2 py-1 font-mono text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">{summary.top_model}</span>
            <span>Output share: {summary.total_tokens ? Math.round((summary.output_tokens / summary.total_tokens) * 100) : 0}%</span>
            <span>Input/output ratio: {summary.output_tokens ? (summary.input_tokens / summary.output_tokens).toFixed(2) : '—'}</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Cost is an estimate based on approximate public per-token pricing for each provider/model, not a billing-accurate figure.
          </p>

          <motion.div initial="hidden" animate="show" variants={gridVariants} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <motion.div variants={itemVariants} className="md:col-span-2">
              <ChartCard
                title="Token throughput"
                subtitle="Input and output tokens per day"
                type="line"
                data={tokenTrend}
                height={240}
                allowTypeSwitch={false}
                series={[{ dataKey: 'input', name: 'Input tokens', color: '#818cf8' }, { dataKey: 'output', name: 'Output tokens', color: '#34d399' }]}
                onBarClick={(dateLabel) => {
                  if (dateLabel) setFilters((f) => ({ ...f, date_from: dateLabel, date_to: dateLabel }))
                }}
                clickHint="Click a point to filter to that day"
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <ChartCard title="Request volume" subtitle="Provider calls per day" type="bar" data={requestTrend} allowTypeSwitch={false} />
            </motion.div>
            <motion.div variants={itemVariants}>
              <ChartCard
                title="Token efficiency"
                subtitle="Average tokens consumed per request"
                type="area"
                data={efficiencyTrend}
                allowTypeSwitch={false}
                onBarClick={(dateLabel) => {
                  if (dateLabel) setFilters((f) => ({ ...f, date_from: dateLabel, date_to: dateLabel }))
                }}
                clickHint="Click a point to filter to that day"
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <ChartCard
                title="Usage by Feature"
                type="pie"
                data={data.usage_by_feature}
                onBarClick={(name) => {
                  const reverse = Object.fromEntries(Object.entries(FEATURE_LABELS).map(([k, v]) => [v, k]))
                  updateFilter('feature', reverse[name] || name)
                }}
                clickHint="Click a slice to filter by feature"
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <ChartCard
                title="Usage by Model / Provider"
                type="bar"
                data={data.usage_by_model}
                onBarClick={(name) => {
                  const row = (data.usage_by_model || []).find((r) => r.name === name)
                  if (row?.provider || row?.model) {
                    setFilters((f) => ({ ...f, provider: row.provider || undefined, model: row.model || undefined }))
                  } else if (name && name.includes(' / ')) {
                    const [prov, mod] = name.split(' / ')
                    setFilters((f) => ({ ...f, provider: prov || undefined, model: mod || undefined }))
                  }
                }}
                clickHint="Click a bar to filter by provider/model"
              />
            </motion.div>
            {showUserBreakdown && data.usage_by_user?.length > 0 && (
              <motion.div variants={itemVariants} className="md:col-span-2">
                <ChartCard
                  title="Usage by User"
                  type="bar"
                  data={data.usage_by_user}
                  onBarClick={(name) => {
                    const u = (filterOptions.users || []).find((x) => x.name === name)
                    if (u?.id) updateFilter('user_id', String(u.id))
                  }}
                  clickHint="Click a bar to filter by user"
                />
              </motion.div>
            )}
          </motion.div>
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-700">
              <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Activity size={16} className="text-brand-500" /> Request logs</h3><p className="mt-0.5 text-xs text-slate-400">Most recent 100 calls. Prompts and ticket content are never stored here.</p></div>
              <div className="relative"><Search size={14} className="absolute left-2.5 top-2 text-slate-400" /><input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} className="input-field w-52 py-1.5 pl-8 text-xs" placeholder="Search model or feature" /></div>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-800/70"><tr><th className="px-4 py-3">Timestamp</th>{showUserBreakdown && <th className="px-3 py-3">User</th>}<th className="px-3 py-3">Operation</th><th className="px-3 py-3">Provider / model</th><th className="px-3 py-3 text-right">Input</th><th className="px-3 py-3 text-right">Output</th><th className="px-3 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Cost</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{visibleLogs.map((log) => <tr key={log.id} className="text-slate-600 transition-colors hover:bg-brand-50/40 dark:text-slate-300 dark:hover:bg-brand-900/10"><td className="whitespace-nowrap px-4 py-3.5 text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>{showUserBreakdown && <td className="px-3 py-3.5">{log.user_name || '—'}</td>}<td className="px-3 py-3.5"><span className="rounded-full bg-brand-50 px-2 py-1 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{FEATURE_LABELS[log.feature] || log.feature}</span></td><td className="px-3 py-3.5"><p className="font-medium">{log.provider}</p><p className="max-w-[11rem] truncate font-mono text-[10px] text-slate-400" title={log.model}>{log.model}</p></td><td className="px-3 py-3.5 text-right font-mono">{log.input_tokens.toLocaleString()}</td><td className="px-3 py-3.5 text-right font-mono">{log.output_tokens.toLocaleString()}</td><td className="px-3 py-3.5 text-right font-mono font-semibold">{log.total_tokens.toLocaleString()}</td><td className="px-4 py-3.5 text-right font-mono">${log.estimated_cost_usd.toFixed(6)}</td></tr>)}{visibleLogs.length === 0 && <tr><td colSpan={showUserBreakdown ? 8 : 7} className="px-4 py-10 text-center text-sm text-slate-400">No request logs match the current filters.</td></tr>}</tbody></table></div>
          </div>
        </>
      )}
    </div>
  )
}
