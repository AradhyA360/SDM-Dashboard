import { motion } from 'framer-motion'
import CountUp from './CountUp'

export default function RadialGauge({ value = 0, size = 120, strokeWidth = 10, label }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  const offset = circumference * (1 - clamped / 100)

  const color = clamped >= 75 ? '#34d399' : clamped >= 50 ? '#fbbf24' : '#fb7185'

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            strokeWidth={strokeWidth} className="stroke-slate-100 dark:stroke-slate-800"
          />
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-bold" style={{ color }}>
            <CountUp value={clamped} />
          </span>
          <span className="text-[10px] font-medium text-slate-400">/ 100</span>
        </div>
      </div>
      {label && <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>}
    </div>
  )
}
