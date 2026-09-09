import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, UploadCloud, Sparkles, BarChart3, Settings, Info, LogOut, Moon, Sun, X,
  PackageSearch, Ticket, Files, Clock3, MessageCircle, UserRound, Coins, UserCog, CalendarDays, Lightbulb,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { ROLE_BADGE_STYLES, roleLabel } from '../lib/roles'
import api from '../services/api'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/data', label: 'ITSM Data', icon: Files },
      { to: '/tickets', label: 'All Tickets', icon: Ticket },
      { to: '/backlog', label: 'Ticket Backlog', icon: PackageSearch },
      { to: '/user-requests', label: 'User Requests', icon: UserCog },
      { to: (user) => `/tickets?assignee=${encodeURIComponent(user?.full_name || '')}`, label: 'My Tickets', icon: UserRound },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/ai', label: 'AI', icon: Sparkles },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings, showPendingBadge: true },
      { to: '/team-availability', label: 'Team Availability', icon: CalendarDays },
      { to: '/about', label: 'About', icon: Info },
    ],
  },
]

export default function Sidebar({ open = false, onClose = () => {} }) {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (user?.role === 'admin') {
      api.get('/settings/pending-users').then(({ data }) => setPendingCount(data.length)).catch(() => {})
    }
  }, [user])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = (user?.full_name || '?')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
      {/* Mobile scrim */}
      {open && (
        <div onClick={onClose} className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 transform flex-col border-r border-slate-200 bg-white transition-transform duration-300 dark:border-slate-700 dark:bg-slate-800 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white font-bold">S</div>
            <div>
              <p className="text-sm font-semibold leading-tight">Service Health Dashboard</p>
              <p className="text-xs text-slate-400 leading-tight">Executive View</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 lg:hidden">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) => !item.allowedRoles || item.allowedRoles.includes(user?.role))
            if (visibleItems.length === 0) return null
            return (
              <div key={group.label}>
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const resolvedTo = typeof item.to === 'function' ? item.to(user) : item.to
                    return (
                    <NavLink
                      key={item.label}
                      to={resolvedTo}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'
                        }`
                      }
                    >
                      <item.icon size={18} />
                      <span className="flex-1">{item.label}</span>
                      {item.showPendingBadge && pendingCount > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                          <Clock3 size={10} /> {pendingCount}
                        </span>
                      )}
                    </NavLink>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        <button
          onClick={toggle}
          className="mx-3 mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          {dark ? 'Light Mode' : 'Dark Mode'}
        </button>

        <div className="border-t border-slate-100 p-3 dark:border-slate-700">
          <NavLink to="/profile" onClick={onClose} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-700">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.full_name}</p>
              <p className="truncate text-xs text-slate-400">{user?.email}</p>
            </div>
          </NavLink>
          <div className="mt-1.5 px-2">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE_STYLES[user?.role] || ''}`}>
              {roleLabel(user?.role)}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
    </>
  )
}
