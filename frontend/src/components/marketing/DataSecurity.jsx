import { Lock, KeyRound, UserCog, Database } from 'lucide-react'

const ITEMS = [
  { icon: Lock, title: 'Passwords, hashed', desc: 'bcrypt password hashing throughout \u2014 plaintext passwords are never stored or logged.' },
  { icon: KeyRound, title: 'Your AI key, your session', desc: 'API keys for OpenAI, Gemini, Claude, or Groq live in memory for your session only \u2014 never written to disk or database.' },
  { icon: UserCog, title: 'Role-based access', desc: 'Admin, SDM, and Associate roles, with new accounts requiring Admin approval before they can sign in \u2014 enforced on the server, not just hidden in the UI.' },
  { icon: Database, title: 'Your data stays yours', desc: 'Ticket data is processed to compute KPIs and build AI context \u2014 raw ticket-level rows are never sent to an AI provider, only aggregated summaries.' },
]

export default function DataSecurity() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Data &amp; Security</p>
        <h2 className="mt-3 text-3xl font-bold text-white md:text-4xl">How we handle your ticket data</h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map((item) => (
          <div key={item.title} className="glass rounded-2xl p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-brand-300">
              <item.icon size={20} />
            </div>
            <h3 className="mt-4 font-semibold text-white">{item.title}</h3>
            <p className="mt-2 text-sm text-slate-400">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
