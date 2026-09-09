import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, Moon, Sun, ChevronDown, User, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { ROLE_BADGE_STYLES, roleLabel } from '../lib/roles'
import NotificationsBell from './NotificationsBell'
import GlobalSearch from './GlobalSearch'

const PAGE_META = {
  '/dashboard': { title: 'Executive Dashboard', subtitle: 'Live SLA, aging, and workload at a glance' },
  '/data': { title: 'ITSM Data', subtitle: 'Upload new files and manage previously uploaded ones' },
  '/backlog': { title: 'Ticket Backlog', subtitle: 'Open tickets per associate, by age' },
  '/tickets': { title: 'Tickets', subtitle: 'Full ticket detail and associate feedback' },
  '/user-requests': { title: 'User Requests', subtitle: 'Incidents that look like access, data, report, or how-to requests' },
  '/team-availability': { title: 'Team Availability', subtitle: 'Associate leave/WFH requests and approvals' },
  '/ai': { title: 'AI', subtitle: 'Copilot briefing, insights, chatbot, and usage - powered by whichever provider you choose in Settings' },
  '/analytics': { title: 'Deep Analytics', subtitle: 'Breakdowns across modules, customers, and time' },
  '/settings': { title: 'Settings', subtitle: 'AI providers and user management' },
  '/profile': { title: 'Profile', subtitle: 'Your account details and preferences' },
  '/about': { title: 'About', subtitle: 'What this dashboard does and how it works' },
}

export default function AppHeader({ onMenuClick }) {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const meta = PAGE_META[location.pathname] || { title: 'Service Health Dashboard', subtitle: '' }

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const initials = (user?.full_name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 px-4 py-3.5 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/80 sm:px-6 md:px-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onMenuClick} className="text-slate-500 lg:hidden">
            <Menu size={22} />
          </button>
          <div className="min-w-0">
            <motion.h1
              key={meta.title}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
              className="truncate text-lg font-bold sm:text-xl"
            >
              {meta.title}
            </motion.h1>
            {meta.subtitle && <p className="hidden truncate text-xs text-slate-400 sm:block">{meta.subtitle}</p>}
          </div>
        </div>

        <div className="hidden flex-1 justify-center px-4 md:flex">
          <GlobalSearch />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationsBell />
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            aria-label="Toggle theme"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 sm:pl-1 sm:pr-2.5"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-semibold text-white">
                {initials}
              </div>
              <span className="hidden text-sm font-medium sm:inline">{user?.full_name}</span>
              <ChevronDown size={14} className={`hidden text-slate-400 transition-transform sm:inline ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
                    <p className="truncate text-sm font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs text-slate-400">{user?.email}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_BADGE_STYLES[user?.role] || 'bg-slate-100 text-slate-500 dark:bg-slate-700'}`}>
                      {roleLabel(user?.role)}
                    </span>
                  </div>
                  <Link to="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                    <User size={15} /> Profile
                  </Link>
                  <Link to="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                    <SettingsIcon size={15} /> Settings
                  </Link>
                  <button onClick={handleLogout} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
                    <LogOut size={15} /> Logout
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="mt-3 md:hidden">
        <GlobalSearch />
      </div>
    </header>
  )
}
