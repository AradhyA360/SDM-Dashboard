const TESTIMONIALS = [
  {
    quote: "We went from a Friday-afternoon spreadsheet scramble to a dashboard our execs check on their own. SLA breach conversations are shorter and less defensive now — the data just sits there, agreed on.",
    name: 'Priya Menon',
    role: 'Service Delivery Manager, AMS Operations',
  },
  {
    quote: "The AI summary caught a workload imbalance across our reconciliation team two weeks before it would've shown up in an SLA breach. That lead time is the whole point.",
    name: 'Daniel Cho',
    role: 'Head of Application Support',
  },
  {
    quote: "Upload, filter, done. Our associates never touch the raw ticket export, and I stopped fielding 'can you re-pull that chart' requests.",
    name: 'Fatima Al-Sayed',
    role: 'IT Service Delivery Lead',
  },
]

export default function Testimonials() {
  return (
    <section id="testimonials" className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Customers</p>
        <h2 className="mt-3 text-3xl font-bold text-white md:text-4xl">Trusted by teams who live in ticket queues</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {TESTIMONIALS.map((t, i) => (
          <figure key={i} className="glass flex flex-col justify-between rounded-2xl p-7">
            <blockquote className="text-sm leading-relaxed text-slate-200">"{t.quote}"</blockquote>
            <figcaption className="mt-6 border-t border-white/10 pt-4">
              <p className="text-sm font-semibold text-white">{t.name}</p>
              <p className="text-xs text-slate-400">{t.role}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
