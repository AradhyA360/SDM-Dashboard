import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Clock3, User, Building2, Layers, MapPin, AlertTriangle,
  CheckCircle2, Circle, PauseCircle, XCircle, Lock,
} from 'lucide-react'
import api from '../services/api'
import { StateBadge, PriorityBadge, SlaStateBadge } from '../components/Badges'

const STATE_ICONS = {
  new: Circle,
  'in progress': Clock3,
  'on hold': PauseCircle,
  resolved: CheckCircle2,
  closed: Lock,
  cancelled: XCircle,
}

function TimelineIcon({ state }) {
  const Icon = STATE_ICONS[(state || '').toLowerCase()] || Circle
  return <Icon size={16} />
}

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const PROPERTY_GROUPS = [
  {
    title: 'Overview',
    icon: Layers,
    fields: [
      ['Short Description', 'Description'],
      ['Category', 'Category'],
      ['Type', 'Type'],
      ['Pending Reason', 'Pending Reason'],
    ],
  },
  {
    title: 'People',
    icon: User,
    fields: [
      ['Name', 'Caller'],
      ['Assignment Group', 'Assignment Group'],
      ['Assigned To', 'Assigned To'],
      ['Main Contact Name', 'Main Contact'],
      ['Manager', 'Manager'],
      ['Updated By', 'Last Updated By'],
    ],
  },
  {
    title: 'Account',
    icon: Building2,
    fields: [
      ['Company', 'Company'],
      ['Business Service', 'Business Service'],
      ['Country', 'Country'],
      ['Location', 'Location'],
    ],
  },
  {
    title: 'Dates & SLA',
    icon: Clock3,
    fields: [
      ['Opened', 'Opened'],
      ['Associate Assignment Date', 'Assigned On'],
      ['SLA Due Date', 'SLA Due'],
      ['Resolved Date', 'Resolved On'],
      ['Closed Date', 'Closed On'],
      ['Ticket Age (days)', 'Ticket Age (days)'],
    ],
  },
]

export default function TicketDetail() {
  const { number } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        let datasetId = searchParams.get('dataset_id')
        if (!datasetId) {
          const { data: cur } = await api.get('/dashboard/current-dataset')
          datasetId = cur.dataset_ids?.join(',')
        }
        if (!datasetId) {
          setError('No dataset is active. Upload or activate one from the Data page first.')
          return
        }
        const { data } = await api.get(`/tickets/${encodeURIComponent(number)}/detail`, {
          params: { dataset_id: datasetId },
        })
        setData(data)
      } catch (err) {
        setError(err.response?.data?.detail || 'Could not load this ticket')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [number, searchParams])

  if (loading) {
    return <div className="p-6 text-sm text-slate-400">Loading ticket {number}&hellip;</div>
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

  const { properties, effective_state: effectiveState, timeline } = data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-600">
            <ArrowLeft size={13} /> Back to tickets
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-brand-700 dark:text-brand-400">{number}</h1>
            <StateBadge value={effectiveState?.effective_state || properties.State} />
            <PriorityBadge value={properties.Priority} />
            <SlaStateBadge value={properties['SLA State']} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{properties['Short Description']}</p>
        </div>
        <Link to={`/tickets?q=${encodeURIComponent(number)}`} className="btn-secondary text-xs">
          View in Ticket List
        </Link>
      </div>

      {effectiveState?.auto_closed && (
        <div className="card flex items-center gap-2 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Lock size={15} />
          This incident was resolved and had no further activity for 5 days, so it was auto-closed per
          policy on {formatDateTime(effectiveState.auto_close_at)} - even though the source export still
          shows it as "Resolved".
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {PROPERTY_GROUPS.map((group) => (
          <div key={group.title} className="card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <group.icon size={15} /> {group.title}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {group.fields.map(([key, label]) => {
                const raw = properties[key]
                const isDate = ['Opened', 'Associate Assignment Date', 'SLA Due Date', 'Resolved Date', 'Closed Date'].includes(key)
                const display = raw === null || raw === undefined || raw === '' ? '\u2014' : (isDate ? formatDateTime(raw) : raw)
                return (
                  <div key={key} className="col-span-2 flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5 dark:border-slate-700/60 last:border-0">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
                    <dd className="text-right text-slate-700 dark:text-slate-200">{display}</dd>
                  </div>
                )
              })}
            </dl>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <MapPin size={15} /> Progress History
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-400">No history recorded for this incident yet.</p>
        ) : (
          <ol className="relative space-y-6 border-l border-slate-200 pl-6 dark:border-slate-700">
            {timeline.map((event, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[calc(1.5rem+7px)] flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-brand-600 ring-4 ring-white dark:bg-brand-900/60 dark:text-brand-300 dark:ring-slate-800">
                  <TimelineIcon state={event.state} />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{event.label}</p>
                  {event.state && <StateBadge value={event.state} />}
                  {event.source === 'auto-close' && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                      Auto
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{formatDateTime(event.timestamp)}</p>
                {event.detail && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{event.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
