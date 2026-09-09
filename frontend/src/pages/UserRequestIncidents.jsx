import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { UserCog, Search, X, Users, ClipboardList, TrendingDown, ExternalLink } from 'lucide-react'
import api from '../services/api'
import FilterBar from '../components/FilterBar'
import KpiCard from '../components/KpiCard'
import { PriorityBadge, StateBadge } from '../components/Badges'

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
}
const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
}

const FILTER_BAR_KEYS = ['status', 'priority', 'module', 'customer', 'application', 'assignee', 'date_from', 'date_to']

export default function UserRequestIncidents() {
  const [datasetId, setDatasetId] = useState(null)
  const [summary, setSummary] = useState(null)
  const [tickets, setTickets] = useState([])
  const [requesters, setRequesters] = useState([])
  const [filterOptions, setFilterOptions] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAllRequesters, setShowAllRequesters] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const barFilters = useMemo(() => {
    const obj = {}
    for (const key of FILTER_BAR_KEYS) {
      const v = searchParams.get(key)
      if (v) obj[key] = v
    }
    return obj
  }, [searchParams])

  function updateFilterParam(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    navigate(`/user-requests?${next.toString()}`)
  }

  function clearFilterBarParams() {
    navigate('/user-requests')
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: current } = await api.get('/dashboard/current-dataset')
      const ids = current.dataset_ids?.join(',')
      if (!ids) {
        setLoading(false)
        return
      }
      setDatasetId(ids)
      const params = { dataset_id: ids }
      for (const key of FILTER_BAR_KEYS) {
        const v = searchParams.get(key)
        if (v) params[key] = v
      }
      const { data } = await api.get('/dashboard/user-requests', { params })
      setSummary(data.summary)
      setTickets(data.tickets || [])
      setRequesters(data.requesters || [])
      setFilterOptions(data.filter_options || {})
    } finally {
      setLoading(false)
    }
  }, [searchParams])

  useEffect(() => {
    load()
  }, [load])

  const filteredTickets = useMemo(() => {
    const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return tickets
    return tickets.filter((row) => {
      const haystack = [row.Number, row['Short Description'], row['Suggested Type'], row['Main Contact Name'], row['Assigned To']]
        .map((v) => String(v ?? '').toLowerCase())
      return terms.every((term) => haystack.some((h) => h.includes(term)))
    })
  }, [tickets, searchQuery])

  const visibleRequesters = showAllRequesters ? requesters : requesters.slice(0, 8)

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-16" />)}
      </div>
    )
  }

  if (!datasetId) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
        <UserCog size={36} className="text-slate-300" />
        <p className="text-lg font-semibold">No dataset uploaded yet</p>
        <Link to="/data?tab=upload" className="btn-primary mt-2">Go to Upload</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          User Requests Raised as Incidents
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Tickets that read like an access, data, report, or how-to request rather than a genuine service
          interruption &mdash; flagged automatically from the ticket description so they can be pulled out of the
          incident backlog.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Flagged as User Request"
            value={summary.flagged_count}
            icon={UserCog}
            accent="amber"
            progress={summary.flagged_pct}
            onClick={() => {
              const el = document.querySelector('[data-user-request-table]')
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />
          <KpiCard
            label="% of Total Incidents"
            value={summary.flagged_pct}
            suffix="%"
            icon={TrendingDown}
            accent="amber"
            onClick={() => {
              const el = document.querySelector('[data-user-request-table]')
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />
          <KpiCard
            label="Unique Requesters"
            value={requesters.length}
            icon={Users}
            accent="brand"
            onClick={() => {
              const el = document.querySelector('[data-requesters-section]')
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />
          <KpiCard
            label="Total Incidents"
            value={summary.total_incidents}
            icon={ClipboardList}
            accent="slate"
            onClick={() => navigate('/tickets')}
          />
        </div>
      )}

      <FilterBar
        filters={barFilters}
        filterOptions={filterOptions}
        onChange={updateFilterParam}
        onDateChange={updateFilterParam}
        onClear={clearFilterBarParams}
      />

      {requesters.length > 0 && (
        <div className="card p-5" data-requesters-section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Users size={15} className="text-brand-500" /> Frequently Raised By
            </p>
            {requesters.length > 8 && (
              <button
                onClick={() => setShowAllRequesters((v) => !v)}
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {showAllRequesters ? 'Show top 8' : `Show all ${requesters.length}`}
              </button>
            )}
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Users whose incidents most often turn out to be a service/access/data/how-to request &mdash; sorted by
            share of all {summary?.flagged_count ?? 0} flagged tickets.
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {visibleRequesters.map((r) => (
              <div key={r.name} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-700/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={r.name}>{r.name}</p>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    {r.percent}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-600">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(r.percent, 100)}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">{r.count} flagged ticket{r.count === 1 ? '' : 's'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tickets.length > 0 && (
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ticket number, description, requester, or type..."
            className="input-field pl-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {tickets.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          No tickets in the current view look like a user request in disguise.
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">No flagged tickets match your search.</div>
      ) : (
        <motion.div initial="hidden" animate="show" variants={gridVariants} className="card overflow-hidden" data-user-request-table>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
            <span>{filteredTickets.length} of {tickets.length} flagged ticket{tickets.length === 1 ? '' : 's'}. Click a row to open it in the full ticket list.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-700/50">
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Number</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Short Description</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Suggested Type</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Requester</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Priority</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">State</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Assigned To</th>
                  <th className="w-8 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((row) => (
                  <motion.tr
                    key={row.Number}
                    variants={rowVariants}
                    onClick={() => navigate(`/tickets?q=${encodeURIComponent(row.Number)}`)}
                    className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-brand-50/50 dark:border-slate-700/50 dark:hover:bg-brand-950/20"
                  >
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs font-semibold text-brand-700 dark:text-brand-400">{row.Number}</td>
                    <td className="px-5 py-3.5">
                      <span className="block max-w-[260px] truncate" title={row['Short Description']}>{row['Short Description']}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        {row['Suggested Type']}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5">{row['Main Contact Name']}</td>
                    <td className="px-5 py-3.5"><PriorityBadge value={row.Priority} /></td>
                    <td className="px-5 py-3.5"><StateBadge value={row.State} /></td>
                    <td className="whitespace-nowrap px-5 py-3.5">{row['Assigned To']}</td>
                    <td className="px-5 py-3.5 text-slate-300"><ExternalLink size={14} /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  )
}
