import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../services/api'
import { ROLE_BADGE_STYLES, roleLabel } from '../lib/roles'
import { CalendarDays, Home, CheckCircle2, XCircle, Clock3 } from 'lucide-react'

const REQUEST_STATUS_STYLES = {
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
}
const STATUS_ICON = { approved: CheckCircle2, pending: Clock3, rejected: XCircle }

function MyLeaveRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ request_type: 'leave', date_from: '', date_to: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/associates/leave-requests/mine')
      setRequests(data.requests)
    } catch {
      // no-op - profile page still renders without this section
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.date_from || !form.date_to) {
      setError('Please choose both a start and end date.')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/associates/leave-requests', form)
      setForm({ request_type: 'leave', date_from: '', date_to: '', reason: '' })
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card p-6">
      <h3 className="mb-1 text-base font-semibold text-slate-800 dark:text-slate-100">
        Leave &amp; WFH Requests
      </h3>
      <p className="mb-4 text-sm text-slate-500">
        Submit a request below - it only takes effect once your SDM approves it. Approved requests show as verified here.
      </p>

      <form onSubmit={submit} className="mb-5 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Type</label>
          <select
            className="input-field"
            value={form.request_type}
            onChange={(e) => setForm((f) => ({ ...f, request_type: e.target.value }))}
          >
            <option value="leave">Leave</option>
            <option value="wfh">Work From Home</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Reason (optional)</label>
          <input
            className="input-field"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="e.g. Family event"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">From</label>
          <input
            type="date"
            className="input-field"
            value={form.date_from}
            onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">To</label>
          <input
            type="date"
            className="input-field"
            value={form.date_to}
            onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-400">Loading your requests…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-slate-400">You haven't submitted any Leave or WFH requests yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const StatusIcon = STATUS_ICON[r.status] || Clock3
            const TypeIcon = r.request_type === 'wfh' ? Home : CalendarDays
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700"
              >
                <div className="flex items-center gap-2">
                  <TypeIcon size={15} className="text-slate-400" />
                  <span className="font-medium">
                    {r.request_type === 'wfh' ? 'Work From Home' : 'Leave'}
                  </span>
                  <span className="text-slate-400">
                    {r.date_from} → {r.date_to}
                  </span>
                  {r.reason && <span className="text-slate-400">· {r.reason}</span>}
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${REQUEST_STATUS_STYLES[r.status]}`}
                >
                  <StatusIcon size={11} />
                  {r.status === 'approved'
                    ? 'Verified'
                    : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Profile() {
  const { user, updateUserLocal } = useAuth()
  const [fullName, setFullName] = useState(user?.full_name || '')
  const [organization, setOrganization] = useState(user?.organization || '')
  const [aiProvider, setAiProvider] = useState(user?.ai_provider_preference || 'openai')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [status, setStatus] = useState('')

  async function handleSave(e) {
    e.preventDefault()
    setStatus('')
    try {
      const payload = { full_name: fullName, organization, ai_provider_preference: aiProvider }
      if (newPassword) {
        payload.new_password = newPassword
        payload.current_password = currentPassword
      }
      const { data } = await api.put('/auth/me', payload)
      updateUserLocal(data)
      setNewPassword('')
      setCurrentPassword('')
      setStatus('saved')
    } catch (err) {
      setStatus(err.response?.data?.detail || 'Failed to update profile')
    }
  }

  const initials = (user?.full_name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          Your Account
        </h2>
        <p className="mt-1 text-sm text-slate-500">Update your personal details and preferences.</p>
      </div>

      <div className="card p-6">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">
            {initials}
          </div>
          <div>
            <p className="font-semibold">{user?.full_name}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE_STYLES[user?.role] || 'bg-slate-100 text-slate-500 dark:bg-slate-700'}`}>
              {roleLabel(user?.role)}
            </span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {status === 'saved' && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              Profile updated successfully.
            </div>
          )}
          {status && status !== 'saved' && (
            <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{status}</div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium">Full name</label>
            <input className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organization</label>
            <input className="input-field" value={organization} onChange={(e) => setOrganization(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">AI Provider Preference</label>
            <select className="input-field" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
              <option value="groq">Groq</option>
            </select>
          </div>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
            <p className="mb-3 text-sm font-medium">Change password</p>
            <div className="grid grid-cols-2 gap-3">
              <input type="password" placeholder="Current password" className="input-field" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              <input type="password" placeholder="New password" className="input-field" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
          </div>

          <button type="submit" className="btn-primary">Save Changes</button>
        </form>
      </div>

      {user?.role === 'associate' && <MyLeaveRequests />}
    </div>
  )
}
