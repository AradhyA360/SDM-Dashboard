import { useEffect, useState } from 'react'
import {
  AlertTriangle, Bot, CheckCircle2, Clipboard, Clock3, Lock, Mail, Pencil, Search,
  Send, Sparkles, Workflow, History, Loader2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../services/api'

const urgencyClass = {
  critical: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  high: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  standard: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
}

const FIELD_OPTIONS = {
  Priority: ['P1', 'P2', 'P3', 'P4'],
  State: ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Cancelled'],
}

// Maps the PATCH endpoint's field name to the plan.incident key it should
// optimistically update, so the header card reflects an edit immediately
// without waiting on a full re-investigate round trip.
const fieldKeyMap = {
  Priority: 'priority',
  State: 'state',
  'Assignment Group': 'assignment_group',
  'Assigned To': 'assigned_to',
}

const EMAIL_STATUS_COPY = {
  sent: { tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400', label: 'Sent' },
  not_configured: { tone: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400', label: 'Logged (SMTP not configured yet)' },
  failed: { tone: 'text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400', label: 'Failed' },
}

export default function IncidentCommandCenter() {
  const { user } = useAuth()
  const [datasetId, setDatasetId] = useState(null)
  const [incidentNumber, setIncidentNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const [editHistory, setEditHistory] = useState([])
  const [fieldEdits, setFieldEdits] = useState({})
  const [savingField, setSavingField] = useState(null)
  const [fieldError, setFieldError] = useState('')

  const [emailHistory, setEmailHistory] = useState([])
  const [emailForm, setEmailForm] = useState({ sender: '', recipients: '', subject: '', body: '' })
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailResult, setEmailResult] = useState(null)
  const [emailError, setEmailError] = useState('')

  useEffect(() => {
    api.get('/dashboard/current-dataset').then(({ data }) => setDatasetId(data.dataset_ids?.join(',') || null)).catch(() => setError('Could not load the active dataset.'))
  }, [])

  async function investigate(event) {
    event?.preventDefault()
    if (!datasetId || !incidentNumber.trim()) return
    setLoading(true)
    setError('')
    setEmailResult(null)
    setFieldError('')
    try {
      const { data } = await api.get('/copilot/incident-command-center', { params: { dataset_id: datasetId, incident_number: incidentNumber.trim() } })
      setPlan(data.plan)
      setFieldEdits({})
      setEmailForm({
        sender: user?.email || '',
        recipients: (data.plan.follow_up?.recipients || []).map((r) => r.email).join(', '),
        subject: data.plan.follow_up?.subject || '',
        body: data.plan.follow_up?.body || data.plan.stakeholder_update || '',
      })
      await Promise.all([loadEditHistory(data.plan.incident.number), loadEmailHistory(data.plan.incident.number)])
    } catch (err) {
      setPlan(null)
      setError(err.response?.data?.detail || 'The incident investigation could not be created.')
    } finally { setLoading(false) }
  }

  async function loadEditHistory(number) {
    try {
      const { data } = await api.get(`/copilot/incidents/${encodeURIComponent(number)}/edit-history`)
      setEditHistory(data.edits || [])
    } catch { setEditHistory([]) }
  }

  async function loadEmailHistory(number) {
    try {
      const { data } = await api.get(`/copilot/incidents/${encodeURIComponent(number)}/email-history`)
      setEmailHistory(data.emails || [])
    } catch { setEmailHistory([]) }
  }

  async function saveField(field) {
    const value = (fieldEdits[field] ?? '').trim()
    if (!value || !plan) return
    setSavingField(field)
    setFieldError('')
    try {
      await api.patch(`/copilot/incidents/${encodeURIComponent(plan.incident.number)}/fields`, {
        dataset_id: datasetId, field, value,
      })
      setPlan((p) => ({ ...p, incident: { ...p.incident, [fieldKeyMap[field]]: value } }))
      setFieldEdits((f) => ({ ...f, [field]: '' }))
      await loadEditHistory(plan.incident.number)
    } catch (err) {
      setFieldError(err.response?.data?.detail || `Could not update ${field}.`)
    } finally { setSavingField(null) }
  }

  async function sendEmail(event) {
    event.preventDefault()
    if (!plan) return
    setSendingEmail(true)
    setEmailError('')
    setEmailResult(null)
    try {
      const recipients = emailForm.recipients.split(',').map((r) => r.trim()).filter(Boolean)
      const { data } = await api.post(`/copilot/incidents/${encodeURIComponent(plan.incident.number)}/send-email`, {
        sender: emailForm.sender.trim(),
        recipients,
        subject: emailForm.subject.trim(),
        body: emailForm.body,
      })
      setEmailResult(data)
      await loadEmailHistory(plan.incident.number)
    } catch (err) {
      setEmailError(err.response?.data?.detail || 'The email could not be sent.')
    } finally { setSendingEmail(false) }
  }

  async function copyUpdate() {
    await navigator.clipboard.writeText(plan.stakeholder_update)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Bot size={21} className="text-brand-500" /> Incident Command Center</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">Paste an incident number to turn the active export into an evidence-backed resolution runbook — SLA clock, comparable resolved work, ownership, escalation, in-place field edits, and a real update email, all in one place.</p>
      </div>

      <form onSubmit={investigate} className="card flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input value={incidentNumber} onChange={(e) => setIncidentNumber(e.target.value)} placeholder="Incident number, e.g. INC0012345" className="input w-full pl-10" aria-label="Incident number" /></div>
        <button disabled={loading || !datasetId || !incidentNumber.trim()} className="btn-primary flex items-center justify-center gap-2"><Sparkles size={16} />{loading ? 'Building runbook…' : 'Investigate incident'}</button>
      </form>
      {!datasetId && <p className="text-sm text-amber-600">Activate a ticket dataset in Data before investigating incidents.</p>}
      {error && <div className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle size={17} className="shrink-0" />{error}</div>}

      {plan && <div className="space-y-4">
        <div className={`rounded-xl border p-5 ${urgencyClass[plan.triage.urgency] || urgencyClass.standard}`}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider opacity-70">{plan.triage.urgency} priority response</p><h3 className="mt-1 text-lg font-bold">{plan.incident.number} · {plan.incident.description}</h3><p className="mt-1 text-sm opacity-80">{plan.incident.priority} · {plan.incident.state} · Owner: {plan.incident.assigned_to}</p></div><div className="rounded-lg bg-white/60 px-3 py-2 text-sm font-semibold dark:bg-slate-950/20"><Clock3 size={15} className="mr-1 inline" />{plan.triage.sla_status}</div></div>
          <p className="mt-4 text-sm font-medium">Escalation guardrail: {plan.triage.escalation_rule}</p>
        </div>

        {/* Quick incident actions - real, persisted field edits, TCS-queue gated */}
        <section className="card p-5">
          <h3 className="flex items-center gap-2 font-semibold"><Pencil size={16} className="text-brand-500" /> Quick incident actions</h3>
          {plan.field_edit_access?.editable ? (
            <>
              <p className="mt-1 text-xs text-slate-400">Changes are applied immediately and reflected across the dashboard, tickets list, and this runbook. Every change is logged below.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {plan.field_edit_access.editable_fields.map((field) => (
                  <div key={field}>
                    <label className="mb-1 block text-xs font-medium text-slate-500">{field}</label>
                    <div className="flex gap-2">
                      {FIELD_OPTIONS[field] ? (
                        <select
                          value={fieldEdits[field] ?? ''}
                          onChange={(e) => setFieldEdits((f) => ({ ...f, [field]: e.target.value }))}
                          className="input flex-1"
                        >
                          <option value="">Change {field}…</option>
                          {FIELD_OPTIONS[field].map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input
                          value={fieldEdits[field] ?? ''}
                          onChange={(e) => setFieldEdits((f) => ({ ...f, [field]: e.target.value }))}
                          placeholder={`New ${field}…`}
                          className="input flex-1"
                        />
                      )}
                      <button
                        onClick={() => saveField(field)}
                        disabled={!fieldEdits[field]?.trim() || savingField === field}
                        className="btn-secondary shrink-0 px-3 text-xs"
                      >
                        {savingField === field ? <Loader2 size={13} className="animate-spin" /> : 'Apply'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {fieldError && <p className="mt-3 text-xs text-rose-600">{fieldError}</p>}
            </>
          ) : (
            <p className="mt-2 flex items-start gap-2 text-sm text-slate-500"><Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />{plan.field_edit_access?.reason}</p>
          )}

          {editHistory.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500"><History size={13} /> Edit history</p>
              <ul className="space-y-1.5">
                {editHistory.map((e, i) => (
                  <li key={i} className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{e.field}</span>: {e.old_value || '—'} → <span className="font-medium text-slate-700 dark:text-slate-300">{e.new_value}</span>
                    {' '}<span className="text-slate-400">by {e.edited_by}{e.edited_at ? ` · ${e.edited_at.slice(0, 16).replace('T', ' ')}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-5"><h3 className="flex items-center gap-2 font-semibold"><Workflow size={17} className="text-brand-500" /> Recommended next actions</h3><div className="mt-4 space-y-4">{plan.recommended_actions.map((action, index) => <div key={action.id} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{index + 1}</span><div><p className="text-sm font-medium">{action.title} <span className="font-normal text-slate-400">· {action.owner}</span></p><p className="mt-0.5 text-sm text-slate-500">{action.detail}</p></div></div>)}</div></section>

          {/* Send update email - explicit sender/recipient fields typed here, no dependency on any contact-email data in the dataset */}
          <section className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-semibold"><Send size={17} className="text-brand-500" /> Send update email</h3>
              <button onClick={copyUpdate} className="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-xs"><Clipboard size={13} />{copied ? 'Copied' : 'Copy update'}</button>
            </div>
            <form onSubmit={sendEmail} className="mt-3 space-y-2.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
                <input required type="email" value={emailForm.sender} onChange={(e) => setEmailForm((f) => ({ ...f, sender: e.target.value }))} placeholder="you@company.com" className="input w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">To (comma-separated)</label>
                <input required value={emailForm.recipients} onChange={(e) => setEmailForm((f) => ({ ...f, recipients: e.target.value }))} placeholder="assignee@company.com, manager@company.com" className="input w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Subject</label>
                <input required value={emailForm.subject} onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))} className="input w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Message</label>
                <textarea required value={emailForm.body} onChange={(e) => setEmailForm((f) => ({ ...f, body: e.target.value }))} rows={5} className="input w-full resize-y" />
              </div>
              <button disabled={sendingEmail} className="btn-primary flex w-full items-center justify-center gap-2 text-sm">
                {sendingEmail ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                {sendingEmail ? 'Sending…' : 'Send email'}
              </button>
              {emailError && <p className="text-xs text-rose-600">{emailError}</p>}
              {emailResult && (
                <p className={`rounded-lg px-3 py-2 text-xs font-medium ${EMAIL_STATUS_COPY[emailResult.status]?.tone || 'bg-slate-50 text-slate-600'}`}>
                  {EMAIL_STATUS_COPY[emailResult.status]?.label || emailResult.status}
                  {emailResult.status !== 'sent' && emailResult.error ? ` — ${emailResult.error}` : ''}
                </p>
              )}
            </form>
            {emailHistory.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
                <p className="mb-2 text-xs font-medium text-slate-500">Sent from this incident</p>
                <ul className="space-y-1.5">
                  {emailHistory.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${EMAIL_STATUS_COPY[e.status]?.tone || 'bg-slate-100 text-slate-500'}`}>{EMAIL_STATUS_COPY[e.status]?.label || e.status}</span>
                      <span className="text-slate-600 dark:text-slate-300">{e.subject}</span>
                      <span className="text-slate-400">to {e.recipients.join(', ')} · {e.created_at ? e.created_at.slice(0, 16).replace('T', ' ') : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <section className="card p-5"><h3 className="font-semibold">Comparable resolved incidents</h3><p className="mt-1 text-xs text-slate-400">Use these as investigation leads; validate the root cause before applying any change.</p>{plan.similar_incidents.length ? <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">{plan.similar_incidents.map((item) => <div key={item.number} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><span className="font-mono font-semibold text-brand-600">{item.number}</span><p className="mt-1 text-slate-500">{item.description}</p></div><span className="h-fit rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-700">{item.similarity_pct}% signal</span></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No sufficiently similar resolved incidents were found in the active export.</p>}</section>

        {plan.movement_history.length > 0 && <section className="card p-5"><h3 className="font-semibold">Recent routing history</h3><div className="mt-3 flex flex-wrap gap-2">{plan.movement_history.map((move, index) => <span key={`${move.timestamp}-${index}`} className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{move.queue} · {move.status} · {move.assigned_to}</span>)}</div></section>}
        <p className="flex items-start gap-2 text-xs text-slate-400"><CheckCircle2 size={14} className="mt-0.5 shrink-0" />{plan.evidence_note} Field edits and emails above are real, logged actions the SDM takes explicitly — nothing here changes an incident automatically.</p>
      </div>}
    </div>
  )
}
