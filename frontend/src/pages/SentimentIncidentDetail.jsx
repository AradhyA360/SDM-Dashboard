import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, Circle, RefreshCw, CheckCircle2, MessageSquareText,
  ClipboardList, User, Building2, Radio,
} from 'lucide-react'
import api from '../services/api'

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
const PRIORITY_DOT = {
  '1 - Critical': '#e11d48',
  '2 - High': '#d97706',
  '3 - Moderate': '#a855f7',
  '4 - Low': '#16a34a',
}

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Individual Incident detail page for a Sentiment Analysis record. Every
 * signed-in user (not just admins/SDMs) can associate a sentiment here -
 * associating sentiment is a judgment call about a conversation, not a
 * data-management action, so it isn't gated behind the uploader role the
 * way uploading a new corpus file is. The override this sets becomes the
 * sentiment shown everywhere else on the Sentiment Analysis tab (trend
 * chart, breakdown table, insights) via the backend's _effective_bucket. */
export default function SentimentIncidentDetail() {
  const { number } = useParams()
  const navigate = useNavigate()
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedSentiment, setSelectedSentiment] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/semantic-analysis/records/${encodeURIComponent(number)}`)
      setRecord(data)
      setSelectedSentiment(data.sentiment)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load this incident')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number])

  async function associateSentiment() {
    if (!selectedSentiment || selectedSentiment === record?.sentiment) return
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const { data } = await api.post(`/semantic-analysis/records/${encodeURIComponent(number)}/sentiment`, {
        sentiment: selectedSentiment,
      })
      setRecord(data)
      setSaved(true)
    } catch (err) {
      setSaveError(err.response?.data?.detail || 'Failed to associate sentiment')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-400">Loading incident {number}&hellip;</div>
  }

  if (error) {
    return (
      <div className="space-y-4 p-2">
        <button onClick={() => navigate(-1)} className="btn-secondary flex items-center gap-1.5 text-sm">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="card flex items-center gap-2 p-4 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle size={16} /> {error}
        </div>
      </div>
    )
  }

  if (!record) return null

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate(-1)} className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft size={13} /> Back to incidents
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-brand-700 dark:text-brand-400">{record.number}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {record.state}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Circle size={7} fill={PRIORITY_DOT[record.priority] || '#94a3b8'} strokeWidth={0} />
            {record.priority}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{record.short_description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <ClipboardList size={15} /> Overview
          </p>
          <dl className="space-y-2 text-sm">
            <Field label="Assignment Group" value={record.assignment_group} />
            <Field label="Ticket Type" value={record.ticket_type} />
            <Field label="First Assignment Group" value={record.first_assignment_group} />
            <Field label="Channel" value={record.channel} />
            <Field label="Last Activity" value={formatDateTime(record.last_activity_at)} />
          </dl>
        </div>

        <div className="card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <User size={15} /> People &amp; Account
          </p>
          <dl className="space-y-2 text-sm">
            <Field label="Contact" value={record.contact} icon={User} />
            <Field label="Company" value={record.company} icon={Building2} />
            <Field label="Assigned To" value={record.assigned_to} />
          </dl>
        </div>
      </div>

      {(record.additional_comments || record.work_notes) && (
        <div className="card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <MessageSquareText size={15} /> Conversation
          </p>
          {record.additional_comments && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Additional Comments (end-user view)</p>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                {record.additional_comments}
              </p>
            </div>
          )}
          {record.work_notes && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Work Notes (internal view)</p>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                {record.work_notes}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="card p-5">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Radio size={15} /> Sentiment
        </p>
        <p className="mb-4 text-xs text-slate-400">
          Current sentiment: <span className={`font-semibold ${SENTIMENT_TONE[record.sentiment] || ''}`}>{record.sentiment}</span>
          {record.sentiment_source === 'manual' ? (
            <> &middot; manually associated by {record.sentiment_associated_by || 'a user'} on {formatDateTime(record.sentiment_associated_at)}</>
          ) : (
            <> &middot; auto-computed from the conversation text{record.sentiment_score != null ? ` (score ${record.sentiment_score.toFixed(2)})` : ''}</>
          )}
        </p>

        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Associate sentiment</p>
        <p className="mb-3 text-xs text-slate-400">
          Any team member can set the sentiment for this incident based on their own read of the conversation.
          Doing so overrides the auto-computed sentiment everywhere on this dashboard.
        </p>
        <div className="flex flex-wrap gap-2">
          {BUCKET_ORDER.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => { setSelectedSentiment(b); setSaved(false) }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedSentiment === b
                  ? 'border-transparent text-white'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
              }`}
              style={selectedSentiment === b ? { background: BUCKET_COLORS[b] } : undefined}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: BUCKET_COLORS[b] }} />
              {b}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={associateSentiment}
            disabled={saving || !selectedSentiment || selectedSentiment === record.sentiment}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-40"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Associate sentiment
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={13} /> Saved
            </span>
          )}
        </div>
        {saveError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
            <AlertTriangle size={14} /> {saveError}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }) {
  const isEmpty = !value || value === '(empty)'
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5 dark:border-slate-700/60 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-right ${isEmpty ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>
        {isEmpty ? '(empty)' : value}
      </dd>
    </div>
  )
}
