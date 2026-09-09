/**
 * Consistent section header used across pages to group KPI bands and chart
 * grids into named themes (e.g. "SLA Health", "Workload & Aging") instead of
 * one long undifferentiated wall of cards.
 */
export default function PageSection({ title, subtitle = null, action = null }) {
  return (
    <div className="pt-1">
      <div className="flex items-center gap-3">
        <h3 className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </h3>
        <div className="h-px flex-1 bg-slate-200/70 dark:bg-slate-700" />
        {action}
      </div>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}
