import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  UploadCloud, FileSpreadsheet, Sparkles, RefreshCw, Send, MessageSquareText,
  ThumbsDown, ThumbsUp, Users2, ArrowUpRight, AlertCircle, ChevronLeft, ChevronRight,
  LineChart as LineIcon, Table2, Circle,
} from 'lucide-react'
import api from '../services/api'
import KpiCard from '../components/KpiCard'
import AIThinkingLoader from '../components/AIThinkingLoader'
import HomeIncidentWidgets from '../components/HomeIncidentWidgets'

const BUCKET_ORDER = ['Very negative', 'Negative', 'Neutral', 'Positive', 'Very positive']
const BUCKET_COLORS = {
  'Very negative': '#7f1d1d',
  Negative: '#ef4444',
  Neutral: '#cbd5e1',
  Positive: '#22c55e',
  'Very positive': '#166534',
}
const SENTIMENT_TONE = {
  'Very positive': 'text-emerald-600 dark:text-emerald-400',
  Positive: 'text-emerald-600 dark:text-emerald-400',
  Neutral: 'text-slate-500 dark:text-slate-400',
  Negative: 'text-rose-600 dark:text-rose-400',
  'Very negative': 'text-rose-700 dark:text-rose-300',
}

const DATE_RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
]

const BREAKDOWN_FIELD_OPTIONS = [
  { value: 'channel', label: 'Channel' },
  { value: 'assignment_group', label: 'Assignment Group' },
  { value: 'ticket_type', label: 'Ticket Type' },
  { value: 'first_assignment_group', label: 'First Assignment Group' },
  { value: 'priority', label: 'Priority' },
  { value: 'state', label: 'State' },
]

const PRIORITY_DOT = {
  '1 - Critical': '#e11d48',
  '2 - High': '#d97706',
  '3 - Moderate': '#a855f7',
  '4 - Low': '#16a34a',
}

const RECORDS_PAGE_SIZE = 10

/** RAG-based Sentiment Analysis tab, styled after ServiceNow's Now Assist
 * Sentiment Analysis dashboard: a filter bar, a Sentiment trend / Record
 * details tab toggle, a stacked 5-bucket sentiment trend chart with a
 * breakdown-by table alongside it, and AI-generated insight cards grounded
 * only in retrieved excerpts from what was uploaded. */
export default function SentimentAnalysis() {
  const [corpusStatus, setCorpusStatus] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(true)
  const [resyncing, setResyncing] = useState(false)
  const [resyncResult, setResyncResult] = useState(null)
  const [resyncError, setResyncError] = useState('')
  const fileInputRef = useRef(null)

  const [filterOptions, setFilterOptions] = useState({
    assignment_groups: [], ticket_types: [], first_assignment_groups: [], channels: [], states: [], priorities: [],
  })
  const [dateRange, setDateRange] = useState('6m')
  const [assignmentGroupFilter, setAssignmentGroupFilter] = useState('')
  const [ticketTypeFilter, setTicketTypeFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [breakdownBy, setBreakdownBy] = useState('channel')

  const [subTab, setSubTab] = useState('trend') // 'trend' | 'records'
  const [dashboard, setDashboard] = useState(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [dashboardRefreshedAt, setDashboardRefreshedAt] = useState(null)

  const [records, setRecords] = useState(null)
  const [recordsPage, setRecordsPage] = useState(1)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [recordsRefreshedAt, setRecordsRefreshedAt] = useState(null)

  const [insights, setInsights] = useState(null)
  const [insightsProvider, setInsightsProvider] = useState('')
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState('')

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const [answers, setAnswers] = useState([])

  const hasCorpus = (corpusStatus?.total_conversations || 0) > 0
  const filtersActive = Boolean(
    assignmentGroupFilter || ticketTypeFilter || channelFilter || priorityFilter || stateFilter || dateRange !== '6m',
  )

  async function loadCorpusStatus() {
    try {
      const { data } = await api.get('/semantic-analysis/corpus-status')
      setCorpusStatus(data)
      if (data.total_conversations > 0) setUploadOpen(false)
    } catch {
      // handled by empty state below
    }
  }

  async function loadFilterOptions() {
    try {
      const { data } = await api.get('/semantic-analysis/filter-options')
      setFilterOptions(data)
    } catch {
      // filters simply stay empty
    }
  }

  async function loadDashboard() {
    setLoadingDashboard(true)
    try {
      const { data } = await api.get('/semantic-analysis/dashboard', {
        params: {
          date_range: dateRange,
          breakdown_by: breakdownBy,
          assignment_group: assignmentGroupFilter || undefined,
          ticket_type: ticketTypeFilter || undefined,
          channel: channelFilter || undefined,
          priority: priorityFilter || undefined,
          state: stateFilter || undefined,
        },
      })
      setDashboard(data)
      setDashboardRefreshedAt(new Date())
    } catch {
      setDashboard(null)
    } finally {
      setLoadingDashboard(false)
    }
  }

  async function loadRecords(page) {
    setLoadingRecords(true)
    try {
      const { data } = await api.get('/semantic-analysis/records', {
        params: {
          page,
          page_size: RECORDS_PAGE_SIZE,
          assignment_group: assignmentGroupFilter || undefined,
          ticket_type: ticketTypeFilter || undefined,
          channel: channelFilter || undefined,
          priority: priorityFilter || undefined,
          state: stateFilter || undefined,
        },
      })
      setRecords(data)
      setRecordsRefreshedAt(new Date())
    } catch {
      setRecords(null)
    } finally {
      setLoadingRecords(false)
    }
  }

  useEffect(() => {
    loadCorpusStatus()
    loadFilterOptions()
  }, [])

  useEffect(() => {
    if (!hasCorpus) return
    if (subTab === 'trend') loadDashboard()
    else loadRecords(recordsPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCorpus, subTab, dateRange, breakdownBy, assignmentGroupFilter, ticketTypeFilter, channelFilter, priorityFilter, stateFilter, recordsPage])

  // The upload card's "ticket dataset active" badge needs dashboard data
  // even while viewing the Record details sub-tab (which otherwise only
  // fetches /records), so it always has something to show.
  useEffect(() => {
    if (hasCorpus && subTab !== 'trend' && !dashboard) loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCorpus])

  function clearFilters() {
    setDateRange('6m')
    setAssignmentGroupFilter('')
    setTicketTypeFilter('')
    setChannelFilter('')
    setPriorityFilter('')
    setStateFilter('')
    setRecordsPage(1)
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    setUploadError('')
    setUploadResult(null)
    try {
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))
      const { data } = await api.post('/semantic-analysis/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setUploadResult(data)
      await loadCorpusStatus()
      await loadFilterOptions()
      if (subTab === 'trend') loadDashboard()
      else loadRecords(recordsPage)
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function resyncWithTicketDataset() {
    setResyncing(true)
    setResyncError('')
    setResyncResult(null)
    try {
      const { data } = await api.post('/semantic-analysis/resync-with-ticket-dataset')
      setResyncResult(data)
      if (subTab === 'trend') loadDashboard()
      else loadRecords(recordsPage)
    } catch (err) {
      setResyncError(err.response?.data?.detail || 'Resync failed')
    } finally {
      setResyncing(false)
    }
  }

  async function generateInsights() {
    setInsightsLoading(true)
    setInsightsError('')
    try {
      const { data } = await api.post('/semantic-analysis/insights')
      setInsights(data.insights)
      setInsightsProvider(data.provider || '')
    } catch (err) {
      setInsightsError(err.response?.data?.detail || 'Failed to generate insights')
    } finally {
      setInsightsLoading(false)
    }
  }

  async function askQuestion(e) {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setAskError('')
    try {
      const { data } = await api.post('/semantic-analysis/ask', { question: q })
      setAnswers((prev) => [{ question: q, answer: data.answer, sources: data.sources || [] }, ...prev])
      setQuestion('')
    } catch (err) {
      setAskError(err.response?.data?.detail || 'Failed to answer question')
    } finally {
      setAsking(false)
    }
  }

  const trendData = useMemo(
    () => (dashboard?.trend || []).map((d) => ({ ...d, dateLabel: d.date?.slice(5) })),
    [dashboard],
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <Sparkles size={18} className="text-brand-500" /> Sentiment Analysis
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          RAG-based sentiment &amp; semantic analysis over uploaded User &harr; TCS Associate ticket conversations.
        </p>
      </div>

      {hasCorpus && <HomeIncidentWidgets />}

      {/* Upload - compact once the corpus has data, expandable to add more */}
      <div className="card p-5">
        <button
          onClick={() => setUploadOpen((o) => !o)}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <FileSpreadsheet size={16} /> Upload ticket conversation export (Excel / CSV)
          </div>
          <div className="text-xs text-slate-400">
            {hasCorpus
              ? `${corpusStatus.total_conversations.toLocaleString()} conversations indexed across ${corpusStatus.files_uploaded.length} file(s)`
              : 'No conversations uploaded yet'}
          </div>
        </button>
        {uploadOpen && (
          <>
            <label
              htmlFor="semantic-upload-input"
              className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-brand-700"
            >
              <UploadCloud size={26} className="text-brand-500" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {uploading ? 'Uploading…' : 'Click to choose file(s), or drag them here'}
              </span>
              <span className="text-xs text-slate-400">
                Expected columns: Number, Short description, Assignment Group, Ticket Type, First Assignment Group,
                Additional comments (end-user view), Work notes (internal view)
              </span>
              <input
                id="semantic-upload-input"
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={uploading}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>

            {uploadError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertCircle size={14} /> {uploadError}
              </div>
            )}
            {uploadResult && (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Added {uploadResult.rows_added} conversation(s). Corpus now has{' '}
                {uploadResult.total_conversations_in_corpus.toLocaleString()} total.
                {typeof uploadResult.canonical_ticket_matches_this_batch === 'number' && (
                  <> {uploadResult.canonical_ticket_dataset_active
                    ? `${uploadResult.canonical_ticket_matches_this_batch.toLocaleString()} of these matched an incident number in the active ticket dataset and now show its real Priority/State/Company/Assigned To.`
                    : 'No ticket dataset is currently active, so Priority/State/Company/Assigned To could not be cross-checked - activate one on the Data page, then use Resync below.'}</>
                )}
                {uploadResult.per_file?.some((f) => f.error) && (
                  <ul className="mt-1 list-disc pl-4 text-rose-600 dark:text-rose-400">
                    {uploadResult.per_file.filter((f) => f.error).map((f) => (
                      <li key={f.filename}>{f.filename}: {f.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {hasCorpus && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`h-2 w-2 rounded-full ${dashboard?.ticket_dataset_active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  <span className="text-slate-500 dark:text-slate-400">
                    {dashboard?.ticket_dataset_active
                      ? 'A ticket dataset is active - Priority/State/Company/Assigned To are cross-checked against it.'
                      : 'No ticket dataset is currently active on the Dashboard/Analytics pages.'}
                  </span>
                </div>
                <button
                  onClick={resyncWithTicketDataset}
                  disabled={resyncing}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                  title="Re-check every uploaded incident against whichever ticket dataset is currently active, without overwriting anything the conversation file itself provided"
                >
                  <RefreshCw size={13} className={resyncing ? 'animate-spin' : ''} />
                  Resync with ticket dataset
                </button>
              </div>
            )}
            {resyncError && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertCircle size={14} /> {resyncError}
              </div>
            )}
            {resyncResult && (
              <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Checked {resyncResult.total_conversations.toLocaleString()} incidents against the active ticket dataset:{' '}
                {resyncResult.matched_to_ticket_dataset.toLocaleString()} matched by number, {resyncResult.records_updated.toLocaleString()} had their
                Priority/State/Company/Assigned To updated to the real value.
              </div>
            )}
          </>
        )}
      </div>

      {!hasCorpus && !loadingDashboard && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-400">
          <MessageSquareText size={28} className="text-slate-300 dark:text-slate-600" />
          Upload a ticket conversation export above to see sentiment trends and generate insights.
        </div>
      )}

      {hasCorpus && (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill label="Date range" value={dateRange} options={DATE_RANGE_OPTIONS} onChange={setDateRange} />
            <FilterPill
              label="Assignment Group"
              value={assignmentGroupFilter}
              options={filterOptions.assignment_groups.map((g) => ({ value: g, label: g }))}
              onChange={(v) => { setAssignmentGroupFilter(v); setRecordsPage(1) }}
              allowEmpty
            />
            <FilterPill
              label="Ticket Type"
              value={ticketTypeFilter}
              options={filterOptions.ticket_types.map((t) => ({ value: t, label: t }))}
              onChange={(v) => { setTicketTypeFilter(v); setRecordsPage(1) }}
              allowEmpty
            />
            <FilterPill
              label="Channel"
              value={channelFilter}
              options={filterOptions.channels.map((c) => ({ value: c, label: c }))}
              onChange={(v) => { setChannelFilter(v); setRecordsPage(1) }}
              allowEmpty
            />
            <FilterPill
              label="Priority"
              value={priorityFilter}
              options={filterOptions.priorities.map((p) => ({ value: p, label: p }))}
              onChange={(v) => { setPriorityFilter(v); setRecordsPage(1) }}
              allowEmpty
            />
            <FilterPill
              label="State"
              value={stateFilter}
              options={filterOptions.states.map((s) => ({ value: s, label: s }))}
              onChange={(v) => { setStateFilter(v); setRecordsPage(1) }}
              allowEmpty
            />
            {filtersActive && (
              <button onClick={clearFilters} className="text-xs font-medium text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300">
                Clear all
              </button>
            )}
          </div>

          {/* Sentiment trend / Record details tab toggle */}
          <div className="inline-flex gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
            <SubTabButton active={subTab === 'trend'} onClick={() => setSubTab('trend')} icon={LineIcon} label="Sentiment trend" />
            <SubTabButton active={subTab === 'records'} onClick={() => setSubTab('records')} icon={Table2} label="Record details" />
          </div>

          {subTab === 'trend' && (
            <div className="space-y-4">
              <div className="card p-5">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sentiment trend</p>
                <p className="mb-3 text-xs text-slate-400">Number of conversations per day, by sentiment bucket</p>
                {trendData.length === 0 ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-slate-400">
                    No dated activity in this range
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={trendData} margin={{ bottom: 10, left: 4, right: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-700" vertical={false} />
                      <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={Math.ceil(trendData.length / 10)} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
                      <Tooltip content={<TrendTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" verticalAlign="top" height={28} />
                      {BUCKET_ORDER.map((b) => (
                        <Bar key={b} dataKey={b} name={b} stackId="sentiment" fill={BUCKET_COLORS[b]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card overflow-hidden p-0">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Sentiment breakdown by</span>
                  <select
                    value={breakdownBy}
                    onChange={(e) => setBreakdownBy(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {BREAKDOWN_FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-400 dark:bg-slate-900">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">
                          {BREAKDOWN_FIELD_OPTIONS.find((o) => o.value === breakdownBy)?.label || 'Group'}
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium">Avg. Sentiment</th>
                        <th className="px-4 py-2.5 text-left font-medium">Total records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboard?.breakdown_by_group || []).map((g) => (
                        <tr key={g.group} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="max-w-[280px] truncate px-4 py-2.5 text-slate-600 dark:text-slate-300" title={g.group}>{g.group}</td>
                          <td className={`px-4 py-2.5 font-medium ${SENTIMENT_TONE[g.avg_sentiment_label] || ''}`}>
                            {g.avg_sentiment_label}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-3">
                              <MiniStackedBar counts={g.counts} total={g.total_records} />
                              <span className="w-10 shrink-0 text-right text-slate-500">{g.total_records}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!dashboard?.breakdown_by_group || dashboard.breakdown_by_group.length === 0) && (
                        <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">No data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {subTab === 'records' && (
            <div className="card overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {(records?.total ?? 0).toLocaleString()}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {recordsRefreshedAt ? 'Last refreshed just now.' : ''}
                  </span>
                </div>
                <button
                  onClick={() => loadRecords(recordsPage)}
                  disabled={loadingRecords}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 dark:border-slate-700"
                  title="Refresh"
                >
                  <RefreshCw size={13} className={loadingRecords ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-400 dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">Incident</th>
                      <th className="px-4 py-2.5 text-left font-medium">Contact</th>
                      <th className="px-4 py-2.5 text-left font-medium">Company</th>
                      <th className="px-4 py-2.5 text-left font-medium">Channel</th>
                      <th className="px-4 py-2.5 text-left font-medium">State</th>
                      <th className="px-4 py-2.5 text-left font-medium">Priority</th>
                      <th className="px-4 py-2.5 text-left font-medium">Assigned to</th>
                      <th className="px-4 py-2.5 text-left font-medium">Updated</th>
                      <th className="px-4 py-2.5 text-left font-medium">Sentiment</th>
                      <th className="px-4 py-2.5 text-left font-medium">Sentiment Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingRecords && (
                      <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
                    )}
                    {!loadingRecords && (records?.records || []).map((r) => (
                      <tr key={r.number} className="border-t border-slate-100 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-900/40">
                        <td className="max-w-[260px] px-4 py-2.5">
                          <Link
                            to={`/sentiment-analysis/${encodeURIComponent(r.number)}`}
                            className="block truncate font-medium text-brand-600 hover:underline dark:text-brand-400"
                            title={r.short_description}
                          >
                            {r.short_description || '(no description)'}
                          </Link>
                          <p className="font-mono text-[11px] text-slate-400">{r.number}</p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {r.contact === '(empty)' ? <span className="text-slate-300 dark:text-slate-600">(empty)</span> : r.contact}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {r.company === '(empty)' ? <span className="text-slate-300 dark:text-slate-600">(empty)</span> : r.company}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.channel}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.state}</td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                            <Circle size={7} fill={PRIORITY_DOT[r.priority] || '#94a3b8'} strokeWidth={0} />
                            {r.priority}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {r.assigned_to === '(empty)' ? <span className="text-slate-300 dark:text-slate-600">(empty)</span> : r.assigned_to}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{r.last_activity_at ? r.last_activity_at.slice(0, 16).replace('T', ' ') : '--'}</td>
                        <td className={`px-4 py-2.5 font-medium ${SENTIMENT_TONE[r.sentiment] || ''}`}>
                          {r.sentiment}
                          {r.sentiment_source === 'manual' && (
                            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400" title={`Associated by ${r.sentiment_associated_by || 'a user'}`}>
                              manual
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300 dark:text-slate-600">--</td>
                      </tr>
                    ))}
                    {!loadingRecords && (!records?.records || records.records.length === 0) && (
                      <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">No records</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {records && records.total > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400 dark:border-slate-800">
                  <span>
                    Showing {(recordsPage - 1) * RECORDS_PAGE_SIZE + 1}-{Math.min(recordsPage * RECORDS_PAGE_SIZE, records.total)} of {records.total.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setRecordsPage((p) => Math.max(1, p - 1))}
                      disabled={recordsPage <= 1}
                      className="rounded-lg border border-slate-200 p-1 disabled:opacity-30 dark:border-slate-700"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={() => setRecordsPage((p) => (p * RECORDS_PAGE_SIZE < records.total ? p + 1 : p))}
                      disabled={recordsPage * RECORDS_PAGE_SIZE >= records.total}
                      className="rounded-lg border border-slate-200 p-1 disabled:opacity-30 dark:border-slate-700"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {subTab === 'trend' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <KpiCard label="Positive conversations" value={(dashboard?.overall_sentiment_counts?.Positive || 0) + (dashboard?.overall_sentiment_counts?.['Very positive'] || 0)} accent="emerald" icon={ThumbsUp} />
              <KpiCard label="Neutral conversations" value={dashboard?.overall_sentiment_counts?.Neutral || 0} accent="slate" icon={Users2} />
              <KpiCard label="Negative conversations" value={(dashboard?.overall_sentiment_counts?.Negative || 0) + (dashboard?.overall_sentiment_counts?.['Very negative'] || 0)} accent="red" icon={ThumbsDown} />
            </div>
          )}

          {/* Generated insights - horizontally scrollable row, ServiceNow-style */}
          <div className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <Sparkles size={16} className="text-brand-500" /> Generated insights
              </div>
              <button
                onClick={generateInsights}
                disabled={insightsLoading}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {insightsLoading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {insights ? 'Regenerate' : 'Generate'}
              </button>
            </div>

            {insightsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertCircle size={14} /> {insightsError}
              </div>
            )}

            {insightsLoading && (
              <div className="mt-4">
                <AIThinkingLoader />
              </div>
            )}

            {!insightsLoading && insights && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <InsightCard title="Negative sentiment drivers" tone="rose">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{insights.negative_sentiment_drivers?.summary}</p>
                    <BulletList items={insights.negative_sentiment_drivers?.top_reasons} />
                    {insights.negative_sentiment_drivers?.chart?.length > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                        <DriverChart data={insights.negative_sentiment_drivers.chart} />
                      </div>
                    )}
                  </InsightCard>

                  <InsightCard title="Positive sentiment drivers" tone="emerald">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{insights.positive_sentiment_drivers?.summary}</p>
                    <BulletList items={insights.positive_sentiment_drivers?.top_reasons} />
                    {insights.positive_sentiment_drivers?.chart?.length > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                        <DriverChart data={insights.positive_sentiment_drivers.chart} />
                      </div>
                    )}
                  </InsightCard>

                  <InsightCard title="Top negative assignment groups" tone="amber">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{insights.top_negative_assignment_groups?.summary}</p>
                    <ul className="mt-2 space-y-1.5">
                      {(insights.top_negative_assignment_groups?.groups || []).map((g) => (
                        <li key={g.name} className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-slate-600 dark:text-slate-300">{g.name}</span>
                          <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">{g.count}</span>
                        </li>
                      ))}
                      {(!insights.top_negative_assignment_groups?.groups || insights.top_negative_assignment_groups.groups.length === 0) && (
                        <li className="py-4 text-center text-sm text-slate-400">No negative conversations found.</li>
                      )}
                    </ul>
                  </InsightCard>

                  <InsightCard title="Sentiment change after escalation" tone="slate">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{insights.sentiment_change_after_escalation}</p>
                    {dashboard?.escalation_comparison && (
                      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                        <EscalationChart comparison={dashboard.escalation_comparison} />
                      </div>
                    )}
                  </InsightCard>

                  {insights.key_quotes?.length > 0 && (
                    <InsightCard title="Representative incidents" tone="brand">
                      <ul className="mt-1 space-y-2">
                        {insights.key_quotes.map((q, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className={`mt-0.5 shrink-0 font-mono text-xs ${SENTIMENT_TONE[q.sentiment] || 'text-slate-400'}`}>
                              [{q.sentiment}]
                            </span>
                            <span className="text-slate-600 dark:text-slate-300">
                              <Link to={`/sentiment-analysis/${encodeURIComponent(q.number)}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                                {q.number}
                              </Link>: {q.excerpt}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </InsightCard>
                  )}

                  {dashboard?.incidents_by_channel?.length > 0 && (
                    <InsightCard title="Number of incidents by channel" tone="slate">
                      <ChannelIncidentsChart data={dashboard.incidents_by_channel} />
                    </InsightCard>
                  )}
                </div>

                {!insights.ai_generated && (
                  <p className="mt-3 text-xs text-slate-400">
                    Showing count-based insights - configure an AI provider in Settings for narrative, RAG-generated insights instead.
                  </p>
                )}
                {insights.ai_generated && insightsProvider && (
                  <p className="mt-3 text-xs text-slate-400">Generated by {insightsProvider}.</p>
                )}
              </motion.div>
            )}
          </div>

          {/* Ask a question - RAG chat over the uploaded corpus */}
          <div className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <MessageSquareText size={16} className="text-brand-500" /> Ask about these conversations
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Retrieves the most relevant uploaded conversations for your question and answers grounded only in them.
            </p>
            <form onSubmit={askQuestion} className="mt-3 flex items-center gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Why are Billing Support tickets trending negative?"
                className="input-field flex-1"
                disabled={asking}
              />
              <button type="submit" disabled={asking || !question.trim()} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-sm">
                {asking ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </form>
            {askError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertCircle size={14} /> {askError}
              </div>
            )}
            {answers.length > 0 && (
              <div className="mt-4 space-y-3">
                {answers.map((a, i) => (
                  <div key={i} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{a.question}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{a.answer}</p>
                    {a.sources.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-400">
                        Sources:
                        {a.sources.map((s) => (
                          <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">{s}</span>
                        ))}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function FilterPill({ label, value, options, onChange, allowEmpty = false }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
    >
      {allowEmpty && <option value="">{label}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SubTabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-brand-500 text-white'
          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  )
}

function MiniStackedBar({ counts, total }) {
  if (!total) return <div className="h-2 w-24 rounded-full bg-slate-100 dark:bg-slate-800" />
  return (
    <div className="flex h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      {BUCKET_ORDER.map((b) => {
        const width = ((counts?.[b] || 0) / total) * 100
        if (!width) return null
        return <div key={b} style={{ width: `${width}%`, background: BUCKET_COLORS[b] }} title={`${b}: ${counts[b]}`} />
      })}
    </div>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0)
  return (
    <div className="glass-light rounded-xl px-3.5 py-2.5 shadow-card">
      <p className="mb-1 text-xs font-medium text-slate-400">{label} &middot; {total} total</p>
      {payload.filter((p) => p.value).map((p, i) => (
        <p key={i} className="flex items-center gap-2 font-mono text-xs font-semibold" style={{ color: p.color }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

function InsightCard({ title, tone = 'slate', children }) {
  const tones = {
    rose: 'border-rose-100 dark:border-rose-900/40',
    emerald: 'border-emerald-100 dark:border-emerald-900/40',
    amber: 'border-amber-100 dark:border-amber-900/40',
    slate: 'border-slate-100 dark:border-slate-800',
    brand: 'border-brand-100 dark:border-brand-900/40',
  }
  return (
    <div className={`rounded-xl border ${tones[tone] || tones.slate} p-5`}>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {title} <ArrowUpRight size={13} className="text-slate-300" />
      </div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function DriverChart({ data }) {
  const chartData = data.map((d) => ({ label: d.name, ...d.counts, total: d.total }))
  const height = Math.max(120, chartData.length * 42)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip content={<TrendTooltip />} />
        {BUCKET_ORDER.map((b) => (
          <Bar key={b} dataKey={b} name={b} stackId="driver" fill={BUCKET_COLORS[b]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function EscalationChart({ comparison }) {
  const data = [
    { label: 'Before escalation', ...comparison.before_escalation },
    { label: 'After escalation', ...comparison.after_escalation },
  ]
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip content={<TrendTooltip />} />
        {BUCKET_ORDER.map((b) => (
          <Bar key={b} dataKey={b} name={b} stackId="escalation" fill={BUCKET_COLORS[b]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function ChannelIncidentsChart({ data }) {
  const chartData = data.slice(0, 6).map((d) => ({ label: d.channel, ...d.counts, total: d.total }))
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip content={<TrendTooltip />} />
        {BUCKET_ORDER.map((b) => (
          <Bar key={b} dataKey={b} name={b} stackId="channel" fill={BUCKET_COLORS[b]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function BulletList({ items }) {
  if (!items?.length) return null
  return (
    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-300">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  )
}
