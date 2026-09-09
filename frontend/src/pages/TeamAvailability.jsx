import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../services/api'
import {
  Users, CalendarDays, Home, CheckCircle2, XCircle, Clock3, AlertTriangle, ShieldCheck,
} from 'lucide-react'

const STATUS_STYLES = {
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
}
const STATUS_ICON = { approved: CheckCircle2, pending: Clock3, rejected: XCircle }

// Roster + approval queue view for SDMs/admins: assign each associate to a
// team area, and review/approve or reject pending Leave/WFH requests. The
// same-area Leave conflict is flagged here, before the SDM even clicks
// Approve, so they don't have to hit the 409 to find out.
function ApprovalQueue() {
  const [associates, setAssociates] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [areaDraft, setAreaDraft] = useState({})

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [{ data: rosterData }, { data: reqData }] = await Promise.all([
        api.get('/associates'),
        api.get('/associates/leave-requests'),
      ])
      setAssociates(rosterData.associates)
      setRequests(reqData.requests)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load team availability data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function saveArea(userId) {
    const teamArea = (areaDraft[userId] || '').trim()
    if (!teamArea) return
    setBusyId(userId)
    try {
      await api.put(`/associates/${userId}/team-area`, { team_area: teamArea })
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to set team area')
    } finally {
      setBusyId(null)
    }
  }

  async function decide(id, action) {
    setBusyId(id)
    setError('')
    try {
      await api.post(`/associates/leave-requests/${id}/${action}`)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || `Failed to ${action} request`)
    } finally {
      setBusyId(null)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending').slice(0, 20)

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Roster + team area assignment */}
      <div className="card p-6">
        <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <Users size={16} /> Associate Roster
        </h3>
        <p className="mb-4 text-sm text-slate-500">
          Associates sharing the same team area are each other's backup - only one of them may be on approved Leave at a time.
        </p>
        <div className="space-y-2">
          {associates.length === 0 && (
            <p className="text-sm text-slate-400">No associate accounts yet.</p>
          )}
          {associates.map((a) => (
            <div
              key={a.user_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700"
            >
              <div>
                <p className="font-medium">{a.full_name}</p>
                <p className="text-xs text-slate-400">{a.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {a.today_status && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      a.today_status === 'wfh'
                        ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                    }`}
                  >
                    {a.today_status === 'wfh' ? <Home size={11} /> : <CalendarDays size={11} />}
                    {a.today_status === 'wfh' ? 'WFH today' : 'On Leave today'}
                  </span>
                )}
                <input
                  className="input-field !w-36 !py-1.5 text-xs"
                  placeholder={a.team_area || 'Team area'}
                  defaultValue={a.team_area || ''}
                  onChange={(e) => setAreaDraft((d) => ({ ...d, [a.user_id]: e.target.value }))}
                />
                <button
                  onClick={() => saveArea(a.user_id)}
                  disabled={busyId === a.user_id}
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending approval queue */}
      <div className="card p-6">
        <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <Clock3 size={16} /> Pending Requests
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              {pending.length}
            </span>
          )}
        </h3>
        <p className="mb-4 text-sm text-slate-500">
          Only after your approval does a request take effect - the associate sees it as verified on their profile.
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing waiting on review.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    {r.request_type === 'wfh' ? <Home size={15} className="text-slate-400" /> : <CalendarDays size={15} className="text-slate-400" />}
                    <span className="font-medium">{r.associate_name}</span>
                    <span className="text-slate-400">
                      {r.request_type === 'wfh' ? 'WFH' : 'Leave'} · {r.date_from} → {r.date_to}
                    </span>
                    {r.team_area && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        {r.team_area}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide(r.id, 'approve')}
                      disabled={busyId === r.id}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => decide(r.id, 'reject')}
                      disabled={busyId === r.id}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {r.reason && <p className="mt-1.5 text-xs text-slate-400">Reason: {r.reason}</p>}
                {r.conflict && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Conflicts with {r.conflict.associate_name}'s approved Leave ({r.conflict.date_from} → {r.conflict.date_to}) in the same area - approving this will be blocked until that's resolved.
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent decisions */}
      <div className="card p-6">
        <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <ShieldCheck size={16} /> Recent Decisions
        </h3>
        {decided.length === 0 ? (
          <p className="text-sm text-slate-400">No decisions made yet.</p>
        ) : (
          <div className="space-y-1.5">
            {decided.map((r) => {
              const StatusIcon = STATUS_ICON[r.status]
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {r.associate_name} · {r.request_type === 'wfh' ? 'WFH' : 'Leave'} · {r.date_from} → {r.date_to}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status]}`}>
                    <StatusIcon size={11} /> {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeamAvailability() {
  const { user } = useAuth()
  const canManage = user?.role === 'admin' || user?.role === 'sdm'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Team Availability</h2>
        <p className="mt-1 text-sm text-slate-500">
          {canManage
            ? 'Assign team areas and review Leave/WFH requests from associates.'
            : 'Submit and track your Leave/WFH requests from your Profile page.'}
        </p>
      </div>

      {canManage ? (
        <ApprovalQueue />
      ) : (
        <div className="card p-6 text-sm text-slate-500">
          Head to your <a href="/profile" className="font-medium text-brand-600 hover:underline">Profile page</a> to submit a Leave or WFH request and see its approval status.
        </div>
      )}
    </div>
  )
}
