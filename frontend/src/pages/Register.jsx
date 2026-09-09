import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    full_name: '', email: '', password: '', confirm: '', organization: '', role: 'associate',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError('Passwords do not match')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      await register({
        full_name: form.full_name, email: form.email, password: form.password,
        organization: form.organization, role: form.role,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50 p-6 dark:from-slate-900 dark:to-slate-800">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">Join your team's service health dashboard.</p>

        {success ? (
          <div className="mt-6 flex items-start gap-2.5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <Clock size={16} className="mt-0.5 shrink-0" />
            <span>Account created! An Admin needs to review and approve your request before you can sign in. Redirecting to the sign-in page…</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Full name</label>
              <input required className="input-field" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input type="email" required className="input-field" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Password</label>
                <input type="password" required className="input-field" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="min. 8 chars" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Confirm</label>
                <input type="password" required className="input-field" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} placeholder="repeat" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Organization</label>
              <input className="input-field" value={form.organization} onChange={(e) => update('organization', e.target.value)} placeholder="Acme Corp" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Role</label>
              <select className="input-field" value={form.role} onChange={(e) => update('role', e.target.value)}>
                <option value="associate">Associate — view dashboards, backlog & insights</option>
                <option value="sdm">SDM — upload data, manage backlog & feedback</option>
              </select>
            </div>
            <div className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 dark:bg-slate-700/60 dark:text-slate-400">
              New accounts need Admin approval before they can sign in — this is a security step, not a bug. An Admin will review your request from their Settings page.
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
