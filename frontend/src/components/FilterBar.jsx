import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SlidersHorizontal, ChevronDown, X } from 'lucide-react'

const FILTER_KEYS = ['status', 'priority', 'module', 'customer', 'application', 'assignee']
const FILTER_LABELS = {
  status: 'Status', priority: 'Priority', module: 'Category',
  customer: 'Company', application: 'Business Service', assignee: 'Assigned To',
}

/**
 * The same status/priority/category/company/service/assignee + date-range
 * filter bar used on the Dashboard, generalized so any ticket-list page
 * (All Tickets, Ticket Backlog, ...) can drop it in. The page owns the
 * actual filter state (usually URL search params) and passes it down -
 * this component is just the UI plus change callbacks.
 */
export default function FilterBar({ filters, filterOptions = {}, onChange, onDateChange, onClear, excludeKeys = [] }) {
  const [open, setOpen] = useState(false)
  const keys = useMemo(() => FILTER_KEYS.filter((k) => !excludeKeys.includes(k)), [excludeKeys])

  const activeEntries = useMemo(
    () => [
      ...keys.filter((k) => filters[k]).map((k) => [k, filters[k]]),
      ...(filters.date_from ? [['date_from', filters.date_from]] : []),
      ...(filters.date_to ? [['date_to', filters.date_to]] : []),
    ],
    [filters, keys]
  )

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/50"
        >
          <SlidersHorizontal size={13} /> Filters
          <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {activeEntries.length > 0 && (
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {activeEntries.map(([key, val]) => (
              <span key={key} className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                {(key === 'date_from' || key === 'date_to') && <span className="text-brand-400">{key === 'date_from' ? 'From' : 'To'}:</span>}
                {val}
                <button onClick={() => (key === 'date_from' || key === 'date_to' ? onDateChange(key, '') : onChange(key, ''))} className="text-brand-400 hover:text-brand-700 dark:hover:text-brand-100">
                  <X size={11} />
                </button>
              </span>
            ))}
            <button onClick={onClear} className="text-xs font-medium text-slate-400 underline hover:text-slate-600">
              Clear all
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-3 lg:grid-cols-6">
              {keys.map((key) => (
                <select
                  key={key}
                  className="input-field py-1.5 text-xs"
                  onChange={(e) => onChange(key, e.target.value)}
                  value={filters[key] || ''}
                >
                  <option value="">All {FILTER_LABELS[key]}</option>
                  {(filterOptions[key] || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">Opened From</label>
                <input
                  type="date"
                  className="input-field py-1.5 text-xs"
                  value={filters.date_from || ''}
                  max={filters.date_to || undefined}
                  onChange={(e) => onDateChange('date_from', e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase text-slate-400">Opened To</label>
                <input
                  type="date"
                  className="input-field py-1.5 text-xs"
                  value={filters.date_to || ''}
                  min={filters.date_from || undefined}
                  onChange={(e) => onDateChange('date_to', e.target.value)}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
