import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import CountUp from './CountUp'

export default function KpiCard({ label, value, icon: Icon, accent = 'brand', suffix = '', decimals = 0, progress = null, onClick = null }) {
  const accents = {
    brand: 'from-brand-500 to-brand-700',
    red: 'from-rose-500 to-rose-700',
    amber: 'from-amber-500 to-amber-600',
    emerald: 'from-emerald-500 to-emerald-700',
    slate: 'from-slate-500 to-slate-700',
  }
  const barColors = {
    brand: 'bg-brand-500', red: 'bg-rose-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', slate: 'bg-slate-500',
  }

  const isNumeric = typeof value === 'number'
  const clickable = typeof onClick === 'function'

  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      whileTap={clickable ? { scale: 0.98 } : undefined}
      onClick={onClick || undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      title={clickable ? `View ${label} tickets` : undefined}
      className={`card group relative overflow-hidden p-5 ${clickable ? 'cursor-pointer transition-shadow hover:shadow-lg hover:ring-1 hover:ring-brand-200 dark:hover:ring-brand-800' : ''}`}
    >
      <div className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${accents[accent]} opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20`} />

      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
            {isNumeric ? <CountUp value={value} decimals={decimals} /> : value}
            {suffix}
          </p>
        </div>
        {Icon && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${accents[accent]} text-white shadow-sm transition-transform duration-300 group-hover:scale-110`}>
            <Icon size={18} />
          </div>
        )}
      </div>

      {progress !== null && (
        <div className="mt-3.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <motion.div
              className={`h-full rounded-full ${barColors[accent]}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{progress.toFixed(0)}% of total tickets</p>
        </div>
      )}

      {clickable && (
        <ArrowUpRight size={13} className="absolute right-3 bottom-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600" />
      )}
    </motion.div>
  )
}
