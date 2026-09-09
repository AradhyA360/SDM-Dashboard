const STATE_STYLES = {
  'new': 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  'in progress': 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  'on hold': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  'resolved': 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
  'closed': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  'cancelled': 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
}

const PRIORITY_STYLES = {
  'p1': 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900',
  'p2': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  'p3': 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  'p4': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

export function StateBadge({ value }) {
  const key = (value || '').toLowerCase()
  const cls = STATE_STYLES[key] || 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {value}
    </span>
  )
}

export function PriorityBadge({ value }) {
  const key = (value || '').toLowerCase()
  const cls = PRIORITY_STYLES[key] || PRIORITY_STYLES.p4
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold font-mono ${cls}`}>
      {value}
    </span>
  )
}

const SLA_STATE_STYLES = {
  'breached': 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  'at risk': 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
  'compliant': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
}

export function SlaStateBadge({ value }) {
  const key = (value || '').toLowerCase()
  if (key === 'n/a' || !value) return <span className="text-xs text-slate-300 dark:text-slate-600">&mdash;</span>
  const cls = SLA_STATE_STYLES[key] || 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {value}
    </span>
  )
}

export function AtRiskBadge({ value }) {
  const isYes = value === 'Yes' || value === true
  if (!isYes) return <span className="text-xs text-slate-300 dark:text-slate-600">&mdash;</span>
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
      At Risk
    </span>
  )
}
