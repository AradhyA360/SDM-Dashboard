import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, ShieldAlert, Clock3, MessageSquareText } from 'lucide-react'
import api from '../services/api'

const ICONS = {
  pending_approval: Clock3,
  at_risk: ShieldAlert,
  feedback: MessageSquareText,
}

export default function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await api.get('/notifications')
        if (!cancelled) setItems(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 60_000) // light polling, no need for anything fancier here
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function go(link) {
    setOpen(false)
    navigate(link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
              <p className="text-sm font-semibold">Notifications</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="space-y-2 p-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12" />)}
                </div>
              ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">You're all caught up.</p>
              ) : (
                items.map((n) => {
                  const Icon = ICONS[n.type] || Bell
                  return (
                    <button
                      key={n.id}
                      onClick={() => go(n.link)}
                      className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/50"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs leading-snug text-slate-700 dark:text-slate-200">{n.message}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
