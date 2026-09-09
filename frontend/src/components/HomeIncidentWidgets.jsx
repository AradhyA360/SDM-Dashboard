import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { RefreshCw, Circle } from 'lucide-react'
import api from '../services/api'

const PRIORITY_DOT = {
  '1 - Critical': '#e11d48',
  '2 - High': '#d97706',
  '3 - Moderate': '#a855f7',
  '4 - Low': '#16a34a',
}

const STATE_BADGE = {
  New: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  Open: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400',
  'Awaiting Info': 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
}

const SENTIMENT_Y_TICKS = ['Very negative', 'Negative', 'Neutral', 'Positive', 'Very positive']

function scoreToLabel(score) {
  if (score <= -0.5) return 'Very negative'
  if (score < -0.1) return 'Negative'
  if (score < 0.1) return 'Neutral'
  if (score < 0.5) return 'Positive'
  return 'Very positive'
}

/** Home-style widgets mirroring ServiceNow's CSM/FSM Home workspace:
 * "Important items" metric tiles, "My active incidents" / "My team's
 * incidents" tables, and a "Performance" section (Sentiment trend +
 * Trending topics) - all sourced from the Sentiment Analysis incident
 * corpus and rendered at the top of the Sentiment Analysis tab itself.
 * Renders nothing while that corpus is empty (parent gates this behind
 * hasCorpus too, but the guard stays here in case this is ever reused
 * elsewhere). Cases (CS) and Incidents (INC) refer to the same underlying
 * record here - this feature always presents them as "Incidents". */
export default function HomeIncidentWidgets() {
  const [summary, setSummary] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [myIncidents, setMyIncidents] = useState(null)
  const [teamIncidents, setTeamIncidents] = useState(null)
  const [loadingIncidents, setLoadingIncidents] = useState(true)

  async function load() {
    setLoadingSummary(true)
    setLoadingIncidents(true)
    try {
      const { data } = await api.get('/semantic-analysis/home-summary')
      setSummary(data)
    } catch {
      setSummary(null)
    } finally {
      setLoadingSummary(false)
    }
    try {
      const [{ data: mine }, { data: team }] = await Promise.all([
        api.get('/semantic-analysis/home-cases', { params: { scope: 'mine', page_size: 6 } }),
        api.get('/semantic-analysis/home-cases', { params: { scope: 'team', page_size: 6 } }),
      ])
      setMyIncidents(mine)
      setTeamIncidents(team)
    } catch {
      setMyIncidents(null)
      setTeamIncidents(null)
    } finally {
      setLoadingIncidents(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (!loadingSummary && !summary?.has_data) return null

  const items = summary?.important_items

  const trendData = (summary?.sentiment_trend || []).map((d) => ({
    dateLabel: d.date?.slice(5),
    score: d.avg_score,
    label: scoreToLabel(d.avg_score),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Important items</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Check these metrics to see the most important items to work on.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <ImportantItemTile label="High-priority incidents" value={items?.high_priority_cases} loading={loadingSummary} />
          <ImportantItemTile
            label="SLA breached or due today"
            value={items?.sla_breached_or_due_today}
            loading={loadingSummary}
            unavailable={!loadingSummary && items && !items.sla_metric_available}
            unavailableHint="No ticket dataset is currently active to check real SLA due dates against - activate one on the Data page, then use Resync on the Sentiment Analysis tab."
          />
          <ImportantItemTile label="Incidents not updated in >3d" value={items?.cases_not_updated_3d} loading={loadingSummary} />
          <ImportantItemTile label="Incident tasks" value={items?.case_tasks} loading={loadingSummary} />
          <ImportantItemTile label="Unassigned incidents" value={items?.unassigned_cases} loading={loadingSummary} />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Incidents</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Track your active incidents and the incidents your team is working on.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <IncidentTable
            title="My active incidents"
            total={myIncidents?.total}
            records={myIncidents?.records}
            loading={loadingIncidents}
            onRefresh={load}
          />
          <IncidentTable
            title="My team's incidents"
            total={teamIncidents?.total}
            records={teamIncidents?.records}
            loading={loadingIncidents}
            onRefresh={load}
            showAssignedTo
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Performance</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          See how you're doing when it comes to customer satisfaction, quality of work, and speed.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sentiment trend</p>
            </div>
            <p className="mb-3 text-xs text-slate-400">Number of incidents in the last 30 days</p>
            {trendData.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-slate-100 dark:stroke-slate-800" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={Math.ceil(trendData.length / 8)} />
                  <YAxis
                    domain={[-1, 1]}
                    ticks={[-1, -0.5, 0, 0.5, 1]}
                    tickFormatter={(v) => SENTIMENT_Y_TICKS[Math.round((v + 1) * 2)]}
                    tick={{ fontSize: 10 }}
                    width={78}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(v, _n, p) => [p.payload.label, 'Sentiment']}
                    labelFormatter={(l) => l}
                    contentStyle={{ fontSize: 12, borderRadius: 10 }}
                  />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Trending topics</p>
            </div>
            <p className="mb-3 text-xs text-slate-400">Top {summary?.trending_topics?.length || 0} trending topics in the last 30 days</p>
            <div className="space-y-3">
              {(summary?.trending_topics || []).map((t) => {
                const openPct = t.total_records ? (t.open / t.total_records) * 100 : 0
                return (
                  <div key={t.description}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-600 dark:text-slate-300" title={t.description}>{t.description}</span>
                      <span className="shrink-0 font-mono font-medium text-slate-500">{t.total_records}</span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="bg-brand-400" style={{ width: `${openPct}%` }} title={`Open: ${t.open}`} />
                      <div className="bg-rose-400" style={{ width: `${100 - openPct}%` }} title={`Resolved: ${t.resolved}`} />
                    </div>
                  </div>
                )
              })}
              {(!summary?.trending_topics || summary.trending_topics.length === 0) && !loadingSummary && (
                <p className="py-6 text-center text-sm text-slate-400">No data available</p>
              )}
              {summary?.trending_topics?.length > 0 && (
                <div className="flex items-center gap-3 pt-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Circle size={7} fill="#60a5fa" strokeWidth={0} /> Open</span>
                  <span className="flex items-center gap-1"><Circle size={7} fill="#fb7185" strokeWidth={0} /> Resolved</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ImportantItemTile({ label, value, loading, unavailable = false, unavailableHint = '' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      {loading ? (
        <div className="skeleton mt-2 h-7 w-14" />
      ) : unavailable ? (
        <p className="mt-1 font-mono text-2xl font-bold text-slate-300 dark:text-slate-600" title={unavailableHint}>
          N/A
        </p>
      ) : (
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {(value ?? 0).toLocaleString()}
        </p>
      )}
    </div>
  )
}

function IncidentTable({ title, total, records, loading, onRefresh, showAssignedTo = false }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {(total ?? 0).toLocaleString()}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg p-1 text-slate-400 hover:text-slate-600 disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-400 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Number</th>
              <th className="px-4 py-2 text-left font-medium">Short description</th>
              <th className="px-4 py-2 text-left font-medium">Account</th>
              <th className="px-4 py-2 text-left font-medium">Priority</th>
              <th className="px-4 py-2 text-left font-medium">State</th>
              {showAssignedTo && <th className="px-4 py-2 text-left font-medium">Assigned to</th>}
              <th className="px-4 py-2 text-left font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={showAssignedTo ? 7 : 6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && (records || []).map((r) => (
              <tr key={r.number} className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-4 py-2 font-mono">
                  <Link to={`/sentiment-analysis/${encodeURIComponent(r.number)}`} className="text-brand-600 hover:underline dark:text-brand-400">
                    {r.number}
                  </Link>
                </td>
                <td className="max-w-[220px] truncate px-4 py-2 text-slate-600 dark:text-slate-300" title={r.short_description}>{r.short_description}</td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {r.company === '(empty)' ? <span className="text-slate-300 dark:text-slate-600">(empty)</span> : r.company}
                </td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <Circle size={7} fill={PRIORITY_DOT[r.priority] || '#94a3b8'} strokeWidth={0} />
                    {r.priority}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_BADGE[r.state] || 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                    {r.state}
                  </span>
                </td>
                {showAssignedTo && (
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {r.assigned_to === '(empty)' ? <span className="text-slate-300 dark:text-slate-600">(empty)</span> : r.assigned_to}
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-2 text-slate-500">{r.last_activity_at ? r.last_activity_at.slice(0, 16).replace('T', ' ') : '--'}</td>
              </tr>
            ))}
            {!loading && (!records || records.length === 0) && (
              <tr><td colSpan={showAssignedTo ? 7 : 6} className="px-4 py-6 text-center text-slate-400">No incidents</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {total > (records?.length || 0) && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400 dark:border-slate-800">
          +{(total - (records?.length || 0)).toLocaleString()} more - see the Record details tab below
        </div>
      )}
    </div>
  )
}
