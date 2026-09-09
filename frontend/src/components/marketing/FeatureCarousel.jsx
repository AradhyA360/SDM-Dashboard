import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, BarChart3, Sparkles, ShieldCheck, UploadCloud } from 'lucide-react'

const FEATURES = [
  {
    icon: BarChart3,
    tag: 'Live Dashboards',
    title: 'Every KPI that matters, updating as tickets move',
    desc: 'SLA breaches, aging, workload, and trend lines refresh the moment new data lands — filter by module, customer, or engineer in one click.',
  },
  {
    icon: Sparkles,
    tag: 'AI Insights',
    title: 'An executive summary written for you, not by you',
    desc: 'Root cause analysis, risk callouts, and a next-week prediction — generated from your own ticket data using the AI provider you choose.',
  },
  {
    icon: UploadCloud,
    tag: 'Upload & Go',
    title: 'Drop in a CSV export, walk away with a dashboard',
    desc: 'No schema wrangling. Point it at your ITSM export and the cleanup, aging math, and SLA logic run automatically.',
  },
  {
    icon: ShieldCheck,
    tag: 'Role-based Access',
    title: 'Admin, SDM, and Associate — each sees exactly what they need',
    desc: 'New accounts wait for Admin approval before they can sign in, so the whole team gets the right level of access without touching production data.',
  },
]

export default function FeatureCarousel() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const next = useCallback(() => setIndex((i) => (i + 1) % FEATURES.length), [])
  const prev = () => setIndex((i) => (i - 1 + FEATURES.length) % FEATURES.length)

  useEffect(() => {
    if (paused) return
    const id = setInterval(next, 4500)
    return () => clearInterval(id)
  }, [paused, next])

  const feature = FEATURES[index]

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="glass relative overflow-hidden rounded-3xl p-8 md:p-12"
    >
      <div key={index} className="animate-slide-fade grid gap-8 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-card">
          <feature.icon size={28} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-300">{feature.tag}</p>
          <h3 className="mt-2 text-2xl font-bold text-white md:text-3xl">{feature.title}</h3>
          <p className="mt-3 max-w-xl text-slate-300">{feature.desc}</p>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <div className="flex gap-2">
          {FEATURES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to feature ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-brand-400' : 'w-1.5 bg-white/20'}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={prev} className="rounded-full border border-white/15 p-2 text-white transition-colors hover:bg-white/10">
            <ChevronLeft size={16} />
          </button>
          <button onClick={next} className="rounded-full border border-white/15 p-2 text-white transition-colors hover:bg-white/10">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
