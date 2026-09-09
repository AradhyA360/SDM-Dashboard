import { Mail, MessageCircle, Clock, LifeBuoy } from 'lucide-react'

export default function ContactSupport() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-24">
      <div className="glass grid gap-8 rounded-3xl p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Support</p>
          <h2 className="mt-3 text-3xl font-bold text-white">Spotted a data discrepancy?</h2>
          <p className="mt-3 max-w-md text-slate-400">
            If a number on your dashboard doesn't match what you're seeing in your ITSM tool —
            a miscounted SLA breach, a ticket in the wrong backlog bucket, anything — reach out
            directly. Data integrity issues get priority.
          </p>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <p className="flex items-center gap-2.5"><Mail size={16} className="text-brand-400" /> support@servicehealth-dashboard.example</p>
            <p className="flex items-center gap-2.5"><MessageCircle size={16} className="text-brand-400" /> Internal Slack: #service-health-dashboard</p>
            <p className="flex items-center gap-2.5"><Clock size={16} className="text-brand-400" /> Typical response time: same business day</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center sm:w-56">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <LifeBuoy size={24} />
          </div>
          <p className="mt-3 font-semibold text-white">Support Team</p>
          <p className="text-xs text-slate-400">Data accuracy questions, escalations & access requests</p>
        </div>
      </div>
    </section>
  )
}
