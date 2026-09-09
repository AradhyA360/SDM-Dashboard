import { PackageSearch, MessageSquareText, ShieldCheck, Users } from 'lucide-react'

const ITEMS = [
  {
    icon: PackageSearch,
    title: 'Ticket Backlog by associate',
    desc: 'See exactly who is sitting on what — open tickets broken down by age (0-30, 31-60, 61-90, 90+ days) per associate, one click from a name to their full ticket list.',
  },
  {
    icon: ShieldCheck,
    title: 'SLA compliance you can defend',
    desc: 'P1-P4 priority tiers with fixed SLA windows (4h / 2d / 5d / 10d), and a clear Compliant vs Non-Compliant split — no ambiguity going into a status call.',
  },
  {
    icon: Users,
    title: 'Resolved vs Closed, kept separate',
    desc: 'A Resolved ticket and a Closed ticket mean different things operationally. This dashboard never collapses them into one number.',
  },
  {
    icon: MessageSquareText,
    title: 'Feedback loop built in',
    desc: 'Leave feedback directly on an associate\u2019s ticket view — recognition or coaching notes, logged with a timestamp, visible the next time you look them up.',
  },
]

export default function BuiltForSDMs() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Built for SDMs</p>
        <h2 className="mt-3 text-3xl font-bold text-white md:text-4xl">Made for the person who owns the status call</h2>
        <p className="mx-auto mt-4 max-w-2xl text-slate-400">
          Not a generic BI tool retrofitted for tickets — every panel here answers a question a
          Service Delivery Manager actually gets asked.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.title} className="glass flex gap-4 rounded-2xl p-6">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <item.icon size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-white">{item.title}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
