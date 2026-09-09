import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { BarChart2, LineChart as LineIcon, AreaChart as AreaIcon, PieChart as PieIcon } from 'lucide-react'

const COLORS = ['#818cf8', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#c084fc', '#f472b6', '#a3e635', '#94a3b8', '#38bdf8']

const TYPE_ICONS = { bar: BarChart2, line: LineIcon, area: AreaIcon, pie: PieIcon }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-light rounded-xl px-3.5 py-2.5 shadow-card">
      {label && <p className="mb-1 text-xs font-medium text-slate-400">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 font-mono text-sm font-semibold" style={{ color: p.color || p.fill }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {p.name}: {p.value?.toLocaleString?.() ?? p.value}
        </p>
      ))}
    </div>
  )
}

export default function ChartCard({ title, type = 'bar', data = [], height = 280, allowTypeSwitch = true, onBarClick = null, subtitle = null, clickHint = 'Click a segment to view those tickets', series = null, centerLabel = null, centerValue = null }) {
  const availableTypes = useMemo(() => {
    if (series) return ['line']
    if (type === 'pie') return ['pie', 'bar']
    if (type === 'line') return ['line', 'area', 'bar']
    return ['bar', 'line', 'area']
  }, [type, series])

  const [activeType, setActiveType] = useState(type)
  const [activeIndex, setActiveIndex] = useState(null)
  const hasData = data && data.length > 0
  const isLong = data.length > 8
  // Defense in depth against overlapping axis labels: however many points come
  // in, only show roughly 8 evenly-spaced ticks - the label formatting and any
  // upstream data capping (e.g. daily trend limited to 30 days server-side)
  // are the primary fix, this just guarantees the chart can never overflow.
  const lineTickInterval = data.length > 8 ? Math.ceil(data.length / 8) - 1 : 0

  function truncateLabel(v) {
    const s = String(v)
    return s.length > 16 ? `${s.slice(0, 15)}\u2026` : s
  }

  return (
    <div className="card group relative overflow-hidden p-5 animate-fade-in-up">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        {allowTypeSwitch && hasData && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 opacity-70 transition-opacity hover:opacity-100 group-hover:opacity-100 dark:bg-slate-700">
            {availableTypes.map((t) => {
              const Icon = TYPE_ICONS[t]
              return (
                <button
                  key={t}
                  onClick={() => setActiveType(t)}
                  className={`rounded-md p-1.5 transition-colors ${
                    activeType === t ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-600 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600'
                  }`}
                  title={t}
                >
                  <Icon size={13} />
                </button>
              )
            })}
          </div>
        )}
      </div>
      {subtitle && <p className="mb-3 text-xs text-slate-400">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}

      {!hasData ? (
        <div style={{ height }} className="flex items-center justify-center text-sm text-slate-400">
          No data available
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={height}>
            {series ? (
              <LineChart data={data} margin={{ bottom: 28, left: 4, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-700" vertical={false} />
                <XAxis
                  dataKey="name" tick={{ fontSize: 11 }} interval={lineTickInterval} tickFormatter={truncateLabel}
                  tickLine={false} axisLine={false} angle={-35} textAnchor="end" height={60}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" verticalAlign="top" height={28} />
                {series.map((s) => (
                  <Line
                    key={s.dataKey}
                    type="monotone" dataKey={s.dataKey} name={s.name} stroke={s.color} strokeWidth={2.5}
                    dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: s.color, stroke: '#fff', strokeWidth: 2 }}
                    animationDuration={700}
                  />
                ))}
              </LineChart>
            ) : activeType === 'pie' ? (
            <PieChart>
              <defs>
                {COLORS.map((c, i) => (
                  <radialGradient key={i} id={`pieGrad${i}`} cx="35%" cy="35%" r="65%">
                    <stop offset="0%" stopColor={c} stopOpacity={1} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.75} />
                  </radialGradient>
                ))}
              </defs>
              <Pie
                data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={height / 5.5} outerRadius={height / 2.6} paddingAngle={3}
                onMouseEnter={(_, i) => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onClick={onBarClick ? (entry) => onBarClick(entry.name) : undefined}
              >
                {data.map((d, i) => (
                  <Cell
                    key={i}
                    fill={`url(#pieGrad${i % COLORS.length})`}
                    stroke="none"
                    style={{
                      filter: activeIndex === i ? 'drop-shadow(0 0 8px rgba(129,140,248,0.5))' : 'none',
                      opacity: activeIndex === null || activeIndex === i ? 1 : 0.45,
                      transform: activeIndex === i ? 'scale(1.03)' : 'scale(1)',
                      transformOrigin: 'center',
                      cursor: onBarClick ? 'pointer' : undefined,
                    }}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            </PieChart>
          ) : activeType === 'area' ? (
            <AreaChart data={data} margin={{ bottom: 28, left: 4, right: 4 }}>
              <defs>
                <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-700" vertical={false} />
              <XAxis
                dataKey="name" tick={{ fontSize: 11 }} interval={lineTickInterval} tickFormatter={truncateLabel}
                tickLine={false} axisLine={false} angle={-35} textAnchor="end" height={60}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2.5} fill="url(#areaFill)" animationDuration={700}
                activeDot={onBarClick ? { r: 6, cursor: 'pointer', onClick: (_, i) => { const pt = data[i?.index ?? i]; if (pt?.name != null) onBarClick(pt.name) } } : { r: 6 }}
              />
            </AreaChart>
          ) : activeType === 'line' ? (
            <LineChart data={data} margin={{ bottom: 28, left: 4, right: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-700" vertical={false} />
              <XAxis
                dataKey="name" tick={{ fontSize: 11 }} interval={lineTickInterval} tickFormatter={truncateLabel}
                tickLine={false} axisLine={false} angle={-35} textAnchor="end" height={60}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2.5}
                dot={{ r: 3, fill: '#6366f1', strokeWidth: 0, cursor: onBarClick ? 'pointer' : undefined }}
                activeDot={{
                  r: 6, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2,
                  cursor: onBarClick ? 'pointer' : undefined,
                  onClick: onBarClick ? (_, payload) => {
                    const idx = payload?.index
                    const pt = typeof idx === 'number' ? data[idx] : null
                    if (pt?.name != null) onBarClick(pt.name)
                  } : undefined,
                }}
                onClick={onBarClick ? (entry) => { if (entry?.name != null) onBarClick(entry.name) } : undefined}
                style={onBarClick ? { cursor: 'pointer' } : undefined}
                animationDuration={700}
              />
            </LineChart>
          ) : (
            <BarChart data={data} layout={isLong ? 'vertical' : 'horizontal'} barCategoryGap={isLong ? 6 : 14} margin={{ bottom: isLong ? 0 : 28, left: 4, right: 4 }}>
              <defs>
                {COLORS.map((c, i) => (
                  <linearGradient key={i} id={`barGrad${i}`} x1="0" y1="0" x2={isLong ? '1' : '0'} y2={isLong ? '0' : '1'}>
                    <stop offset="0%" stopColor={c} stopOpacity={1} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.65} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-700" horizontal={!isLong} vertical={isLong} />
              {isLong ? (
                <>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={112} tickLine={false} axisLine={false} tickFormatter={truncateLabel} interval={0} />
                </>
              ) : (
                <>
                  <XAxis
                    dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={truncateLabel} interval={0} angle={-35} textAnchor="end" height={60}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
                </>
              )}
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(129,140,248,0.08)' }} />
              <Bar
                dataKey="value" radius={isLong ? [0, 6, 6, 0] : [6, 6, 0, 0]} animationDuration={700}
                onMouseEnter={(_, i) => setActiveIndex(i)} onMouseLeave={() => setActiveIndex(null)}
                onClick={onBarClick ? (entry) => onBarClick(entry.name) : undefined}
                style={onBarClick ? { cursor: 'pointer' } : undefined}
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={`url(#barGrad${i % COLORS.length})`}
                    style={{ opacity: activeIndex === null || activeIndex === i ? 1 : 0.4, transition: 'opacity 0.2s' }}
                  />
                ))}
              </Bar>
            </BarChart>
          )}
          </ResponsiveContainer>
          {!series && (type === 'pie') && activeType === 'pie' && centerValue !== null && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="font-mono text-2xl font-bold tabular-nums">{centerValue}</p>
              {centerLabel && <p className="text-xs text-slate-400">{centerLabel}</p>}
            </div>
          )}
        </div>
      )}
      {onBarClick && hasData && (
        <p className="mt-2 text-center text-[11px] text-slate-400">{clickHint}</p>
      )}
    </div>
  )
}
