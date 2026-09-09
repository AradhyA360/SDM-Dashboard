import { UploadCloud, Cpu, SlidersHorizontal, Sparkles } from 'lucide-react'

const STEPS = [
  {
    icon: UploadCloud,
    title: 'Upload your export',
    desc: 'Drop in a CSV or Excel pull from your ITSM tool — ServiceNow, Jira, Zendesk, whatever you already use.',
  },
  {
    icon: Cpu,
    title: 'We do the cleanup',
    desc: 'Dates get parsed, ticket age and SLA breach/at-risk status get computed, missing columns get handled — no schema wrangling.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Filter to what matters',
    desc: 'Slice by module, customer, priority, or engineer in one click. Every KPI and chart updates together.',
  },
  {
    icon: Sparkles,
    title: 'Get the AI summary',
    desc: 'Root causes, risks, workload imbalance, and a next-week prediction — written from your own data.',
  },
]

export default function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">How it works</p>
        <h2 className="mt-3 text-3xl font-bold text-white md:text-4xl">From CSV export to executive summary, in minutes</h2>
      </div>

      <div className="relative grid gap-6 md:grid-cols-4">
        <div className="absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent md:block" />
        {STEPS.map((step, i) => (
          <div key={i} className="glass relative flex flex-col items-center rounded-2xl p-6 text-center">
            <span className="absolute -top-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white shadow-lg">
              {i + 1}
            </span>
            <div className="mt-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <step.icon size={24} />
            </div>
            <h3 className="mt-4 font-semibold text-white">{step.title}</h3>
            <p className="mt-2 text-sm text-slate-400">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
