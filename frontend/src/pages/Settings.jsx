import { useEffect, useState } from 'react'
import { KeyRound, CheckCircle2, Trash2, PlugZap, Users, UserX, UserCheck2, UserMinus2, Clock3, ShieldCheck, XCircle, RefreshCw, Server, BookOpen } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { ROLE_LABELS, ROLE_BADGE_STYLES, roleLabel } from '../lib/roles'

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI (GPT)' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'claude', label: 'Anthropic Claude' },
  { id: 'groq', label: 'Groq (GPT-OSS)' },
]

export default function Settings() {
  const { user, updateUserLocal } = useAuth()
  const [provider, setProvider] = useState(
    PROVIDERS.some((p) => p.id === user?.ai_provider_preference) ? user.ai_provider_preference : 'openai',
  )
  const [apiKey, setApiKey] = useState('')
  const [configured, setConfigured] = useState([])
  const [status, setStatus] = useState('')
  const [testing, setTesting] = useState(false)
  const [users, setUsers] = useState([])
  const [pendingUsers, setPendingUsers] = useState([])
  const [userActionError, setUserActionError] = useState('')
  const [ollama, setOllama] = useState(null)
  const [ollamaLoading, setOllamaLoading] = useState(true)
  const [ollamaBaseUrlInput, setOllamaBaseUrlInput] = useState('')
  const [ollamaModelInput, setOllamaModelInput] = useState('')
  const [ollamaEditing, setOllamaEditing] = useState(false)
  const [ollamaValidating, setOllamaValidating] = useState(false)
  const [ollamaValidateResult, setOllamaValidateResult] = useState(null)
  const [ollamaSaving, setOllamaSaving] = useState(false)
  const [ollamaConfigMsg, setOllamaConfigMsg] = useState('')
  const [queueDescriptions, setQueueDescriptions] = useState([])
  const [queueDescLoading, setQueueDescLoading] = useState(true)
  const [queueDescFile, setQueueDescFile] = useState(null)
  const [queueDescUploading, setQueueDescUploading] = useState(false)
  const [queueDescResult, setQueueDescResult] = useState(null)
  const [queueDescError, setQueueDescError] = useState('')
  const canManageUploads = user?.role === 'admin' || user?.role === 'sdm'

  const isOllamaActive = (user?.ai_provider_preference || 'ollama') === 'ollama'

  async function loadOllamaStatus() {
    setOllamaLoading(true)
    try {
      const { data } = await api.get('/settings/ollama/status')
      setOllama(data)
      setOllamaBaseUrlInput(data.base_url || '')
      setOllamaModelInput(data.configured_model || '')
    } catch {
      setOllama(null)
    } finally {
      setOllamaLoading(false)
    }
  }

  async function handleValidateOllama() {
    setOllamaValidating(true)
    setOllamaValidateResult(null)
    setOllamaConfigMsg('')
    try {
      const { data } = await api.post('/settings/ollama/validate', {
        base_url: ollamaBaseUrlInput || null,
        model: ollamaModelInput || null,
      })
      setOllamaValidateResult(data)
    } catch (err) {
      setOllamaValidateResult({ reachable: false, error: err.response?.data?.detail || 'Validation failed' })
    } finally {
      setOllamaValidating(false)
    }
  }

  async function handleSaveOllamaConfig() {
    setOllamaSaving(true)
    setOllamaConfigMsg('')
    try {
      await api.put('/settings/ollama/config', {
        base_url: ollamaBaseUrlInput || null,
        model: ollamaModelInput || null,
      })
      setOllamaConfigMsg('Saved — this takes effect immediately, no restart needed.')
      setOllamaEditing(false)
      setOllamaValidateResult(null)
      await loadOllamaStatus()
    } catch (err) {
      setOllamaConfigMsg(err.response?.data?.detail || 'Failed to save')
    } finally {
      setOllamaSaving(false)
    }
  }

  async function handleResetOllamaConfig() {
    setOllamaSaving(true)
    setOllamaConfigMsg('')
    try {
      await api.delete('/settings/ollama/config')
      setOllamaConfigMsg('Reverted to the default configuration.')
      setOllamaEditing(false)
      setOllamaValidateResult(null)
      await loadOllamaStatus()
    } catch (err) {
      setOllamaConfigMsg(err.response?.data?.detail || 'Failed to reset')
    } finally {
      setOllamaSaving(false)
    }
  }

  async function loadQueueDescriptions() {
    setQueueDescLoading(true)
    try {
      const { data } = await api.get('/queue-descriptions')
      setQueueDescriptions(data.queues || [])
    } catch {
      setQueueDescriptions([])
    } finally {
      setQueueDescLoading(false)
    }
  }

  async function handleQueueDescUpload() {
    if (!queueDescFile) return
    setQueueDescUploading(true)
    setQueueDescError('')
    try {
      const formData = new FormData()
      formData.append('file', queueDescFile)
      const { data } = await api.post('/upload/queue-descriptions', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setQueueDescResult(data)
      setQueueDescFile(null)
      await loadQueueDescriptions()
    } catch (err) {
      setQueueDescError(err.response?.data?.detail || 'Upload failed')
    } finally {
      setQueueDescUploading(false)
    }
  }

  useEffect(() => {
    api.get('/settings/api-key/status').then(({ data }) => setConfigured(data.configured_providers))
    loadOllamaStatus()
    loadQueueDescriptions()
    if (user?.role === 'admin') {
      loadUsers()
      loadPendingUsers()
    }
  }, [user])

  async function loadUsers() {
    try {
      const { data } = await api.get('/settings/users')
      setUsers(data)
    } catch {
      // silently ignore - non-admins simply won't see the panel at all
    }
  }

  async function loadPendingUsers() {
    try {
      const { data } = await api.get('/settings/pending-users')
      setPendingUsers(data)
    } catch {
      // ignore for non-admins
    }
  }

  async function setActiveProvider(p) {
    const { data } = await api.put('/auth/me', { ai_provider_preference: p })
    updateUserLocal(data)
  }

  async function saveKey() {
    if (!apiKey) return
    setStatus('')
    try {
      await api.post('/settings/api-key', { provider, api_key: apiKey })
      setConfigured((c) => [...new Set([...c, provider])])
      setApiKey('')
      await setActiveProvider(provider)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  async function clearKey(p) {
    await api.delete(`/settings/api-key/${p}`)
    setConfigured((c) => c.filter((x) => x !== p))
  }

  async function testConnection() {
    if (!apiKey) return
    setTesting(true)
    setStatus('')
    try {
      await api.post('/settings/api-key/test', { provider, api_key: apiKey })
      setStatus('tested-ok')
    } catch {
      setStatus('tested-fail')
    } finally {
      setTesting(false)
    }
  }

  async function changeRole(targetUser, nextRole) {
    setUserActionError('')
    if (targetUser.id === user.id && nextRole !== 'admin') {
      const confirmed = window.confirm("You're about to remove your own Admin access. Continue?")
      if (!confirmed) return
    }
    try {
      await api.put(`/settings/users/${targetUser.id}/role`, null, { params: { role: nextRole } })
      await loadUsers()
    } catch (err) {
      setUserActionError(err.response?.data?.detail || 'Failed to update role')
    }
  }

  async function deactivateUser(targetUser) {
    setUserActionError('')
    const confirmed = window.confirm(`Deactivate ${targetUser.full_name}? They'll no longer be able to sign in.`)
    if (!confirmed) return
    try {
      await api.delete(`/settings/users/${targetUser.id}`)
      await loadUsers()
    } catch (err) {
      setUserActionError(err.response?.data?.detail || 'Failed to deactivate user')
    }
  }

  async function approveUser(id) {
    setUserActionError('')
    try {
      await api.post(`/settings/users/${id}/approve`)
      await loadPendingUsers()
      await loadUsers()
    } catch (err) {
      setUserActionError(err.response?.data?.detail || 'Failed to approve user')
    }
  }

  async function rejectUser(id) {
    setUserActionError('')
    const confirmed = window.confirm('Reject this account request? They will not be able to sign in.')
    if (!confirmed) return
    try {
      await api.post(`/settings/users/${id}/reject`)
      await loadPendingUsers()
    } catch (err) {
      setUserActionError(err.response?.data?.detail || 'Failed to reject user')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          AI Providers &amp; User Management
        </h2>
        <p className="mt-1 text-sm text-slate-500">Configure API keys, review pending accounts, and manage access.</p>
      </div>
<div>
        <p className="text-sm text-slate-500">Configure your AI provider. Keys are kept only for your current session and never exposed.</p>
      </div>

      {/* Ollama - local, default, no data leaves the network */}
      <div className="card p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Server size={16} /> Ollama (Local) — Default
          </p>
          {!isOllamaActive && (
            <button
              onClick={() => setActiveProvider('ollama')}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Set as active provider
            </button>
          )}
          {isOllamaActive && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
              Active
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Runs entirely on your own network - ticket data and prompts never go to an external API. This is the recommended, secure-by-default option.
        </p>

        {ollamaLoading ? (
          <p className="text-sm text-slate-400">Checking Ollama connection…</p>
        ) : ollama?.reachable ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <ShieldCheck size={15} /> Reachable at <code className="text-xs">{ollama.base_url}</code>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {ollama.model_installed ? (
                <CheckCircle2 size={15} className="text-emerald-500" />
              ) : (
                <XCircle size={15} className="text-red-500" />
              )}
              Model <code className="text-xs">{ollama.configured_model}</code>{' '}
              {ollama.model_installed ? 'is installed' : 'is NOT pulled yet'}
            </div>
            {!ollama.model_installed && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                Run <code>ollama pull {ollama.configured_model}</code> on the machine hosting Ollama, then refresh below.
              </p>
            )}
            {ollama.models?.length > 0 && (
              <p className="text-xs text-slate-400">
                Installed models: {ollama.models.join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <XCircle size={15} /> Not reachable at <code className="text-xs">{ollama?.base_url}</code>
            </div>
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
              Make sure <code>ollama serve</code> is running (or the Ollama desktop app is open) on the machine
              set as <code>OLLAMA_BASE_URL</code> in the backend's <code>.env</code>. See the setup steps below.
            </p>
          </div>
        )}
        <button
          onClick={loadOllamaStatus}
          className="btn-secondary mt-4 flex items-center gap-2 text-sm"
        >
          <RefreshCw size={14} /> Refresh Status
        </button>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-700">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Connection Settings</p>
            {!ollamaEditing && (
              <button
                onClick={() => setOllamaEditing(true)}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Change server or model
              </button>
            )}
          </div>

          {!ollamaEditing ? (
            <p className="text-xs text-slate-400">
              {ollama?.is_override
                ? 'Using a custom server/model set from this page.'
                : "Using the backend's default .env configuration."}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Point the app at a different Ollama server or model, and test it before saving — no editing
                <code className="mx-1">.env</code> or restarting the backend required.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Base URL</label>
                  <input
                    type="text"
                    value={ollamaBaseUrlInput}
                    onChange={(e) => setOllamaBaseUrlInput(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Model</label>
                  <input
                    type="text"
                    value={ollamaModelInput}
                    onChange={(e) => setOllamaModelInput(e.target.value)}
                    placeholder="llama3.1"
                    className="input-field text-sm"
                  />
                </div>
              </div>

              {ollamaValidateResult && (
                <div
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                    ollamaValidateResult.reachable
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                  }`}
                >
                  {ollamaValidateResult.reachable ? <ShieldCheck size={14} className="mt-0.5" /> : <XCircle size={14} className="mt-0.5" />}
                  <span>
                    {ollamaValidateResult.reachable
                      ? `Reachable. ${ollamaValidateResult.model_installed ? 'Model is installed.' : `Model NOT pulled yet — run "ollama pull ${ollamaModelInput || ollama?.configured_model}".`}`
                      : `Not reachable${ollamaValidateResult.error ? `: ${ollamaValidateResult.error}` : ''}`}
                  </span>
                </div>
              )}

              {ollamaConfigMsg && <p className="text-xs text-slate-500">{ollamaConfigMsg}</p>}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleValidateOllama}
                  disabled={ollamaValidating}
                  className="btn-secondary flex items-center gap-1.5 text-xs"
                >
                  <PlugZap size={13} /> {ollamaValidating ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSaveOllamaConfig}
                  disabled={ollamaSaving}
                  className="btn-primary text-xs"
                >
                  {ollamaSaving ? 'Saving…' : 'Save & Use This'}
                </button>
                {ollama?.is_override && (
                  <button
                    onClick={handleResetOllamaConfig}
                    disabled={ollamaSaving}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    Revert to default
                  </button>
                )}
                <button
                  onClick={() => {
                    setOllamaEditing(false)
                    setOllamaValidateResult(null)
                    setOllamaBaseUrlInput(ollama?.base_url || '')
                    setOllamaModelInput(ollama?.configured_model || '')
                  }}
                  className="text-xs font-medium text-slate-400 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cloud providers - secondary, explicit opt-in, each needs its own key */}
      <div className="card p-6">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold"><KeyRound size={16} /> Cloud Providers (Secondary — Requires API Key)</p>
        <p className="mb-4 text-sm text-slate-500">
          Optional. Use a cloud model instead of Ollama for a specific task - keep in mind ticket data leaves your network for these.
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          <select className="input-field" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input
            type="password" className="input-field md:col-span-2" placeholder="Paste your API key"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={saveKey} className="btn-primary text-sm">Save Key</button>
          <button onClick={testConnection} disabled={testing} className="btn-secondary flex items-center gap-2 text-sm">
            <PlugZap size={14} /> {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {status === 'saved' && <p className="mt-3 text-sm text-emerald-600">Key saved and set as your active provider.</p>}
        {status === 'error' && <p className="mt-3 text-sm text-red-600">Failed to save key.</p>}
        {status === 'tested-ok' && <p className="mt-3 text-sm text-emerald-600">Connection successful.</p>}
        {status === 'tested-fail' && <p className="mt-3 text-sm text-red-600">Connection failed — check your key.</p>}

        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium uppercase text-slate-400">Configured providers</p>
          {configured.length === 0 && <p className="text-sm text-slate-400">None configured yet.</p>}
          {configured.map((p) => {
            const isActive = user?.ai_provider_preference === p
            return (
              <div key={p} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-700">
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-500" /> {p}
                  {isActive && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      Active
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  {!isActive && (
                    <button onClick={() => setActiveProvider(p)} className="text-xs font-medium text-brand-600 hover:underline">
                      Use this
                    </button>
                  )}
                  <button onClick={() => clearKey(p)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {canManageUploads && (
        <div className="card p-6">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <BookOpen size={16} /> Queue / TCS Team Mapping
          </p>
          <p className="mb-4 text-sm text-slate-500">
            One-time reference config, not a routine ticket upload — moved here from the Upload page since
            it's used to classify existing queues as TCS or Non-TCS, not to bring in new ticket data. Upload a
            file with one row per queue (Queue, Description, Is TCS Team) to add or refresh entries.
          </p>

          {queueDescLoading ? (
            <p className="text-xs text-slate-400">Loading current mapping…</p>
          ) : queueDescriptions.length > 0 ? (
            <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 font-medium text-slate-500">Queue</th>
                    <th className="px-3 py-2 font-medium text-slate-500">Description</th>
                    <th className="px-3 py-2 font-medium text-slate-500">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {queueDescriptions.map((q) => (
                    <tr key={q.queue} className="border-t border-slate-100 dark:border-slate-700/60">
                      <td className="px-3 py-1.5 font-mono">{q.queue}</td>
                      <td className="px-3 py-1.5 text-slate-500">{q.description}</td>
                      <td className="px-3 py-1.5">
                        {q.is_tcs_team === true ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">TCS</span>
                        ) : q.is_tcs_team === false ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Non-TCS</span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mb-4 text-xs text-slate-400">No queues mapped yet — the Executive Dashboard's TCS-only filter treats every ticket as included until you upload this.</p>
          )}

          {queueDescError && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
              <XCircle size={14} /> {queueDescError}
            </div>
          )}
          {queueDescResult && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              <CheckCircle2 size={14} /> {queueDescResult.queues_covered} queue{queueDescResult.queues_covered === 1 ? '' : 's'} updated.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setQueueDescFile(e.target.files[0] || null)}
              className="text-xs"
            />
            <button
              onClick={handleQueueDescUpload}
              disabled={!queueDescFile || queueDescUploading}
              className="btn-primary text-xs"
            >
              {queueDescUploading ? 'Uploading…' : 'Upload Mapping'}
            </button>
          </div>
        </div>
      )}

      {user?.role === 'admin' && (
        <>
          {userActionError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">{userActionError}</div>
          )}

          {pendingUsers.length > 0 && (
            <div className="card border-amber-200 p-6 dark:border-amber-900">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                <Clock3 size={16} /> Pending Approval Requests
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  {pendingUsers.length}
                </span>
              </p>
              <p className="mb-4 text-xs text-slate-400">New SDM and Associate accounts wait here until an Admin reviews them.</p>
              <div className="space-y-2">
                {pendingUsers.map((u) => (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
                    <div>
                      <p className="text-sm font-medium">{u.full_name} <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE_STYLES[u.role]}`}>{roleLabel(u.role)}</span></p>
                      <p className="text-xs text-slate-500">{u.email} {u.organization ? `\u00b7 ${u.organization}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => approveUser(u.id)} className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:underline">
                        <UserCheck2 size={14} /> Approve
                      </button>
                      <button onClick={() => rejectUser(u.id)} className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:underline">
                        <UserMinus2 size={14} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-6">
            <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Users size={16} /> User Management</p>
            <p className="mb-4 text-xs text-slate-400">Change anyone's role between Admin, SDM, and Associate right from here.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Organization</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-50 dark:border-slate-700/50">
                      <td className="whitespace-nowrap py-2.5 pr-4 font-medium">{u.full_name}{u.id === user.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}</td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{u.email}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_STYLES[u.role]}`}>
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{u.organization || '—'}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center justify-end gap-3">
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value)}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
                          >
                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => deactivateUser(u)}
                            disabled={u.id === user.id}
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-400"
                            title={u.id === user.id ? "You can't deactivate your own account" : 'Deactivate user'}
                          >
                            <UserX size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
