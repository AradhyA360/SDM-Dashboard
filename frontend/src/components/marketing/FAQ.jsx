import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const FAQS = [
  {
    q: 'What ticket data can I upload?',
    a: 'A CSV or Excel export from your ITSM tool with columns like Ticket ID, Status, Priority, Module, Assigned Engineer, Open/SLA/Closed dates, Pending Reason, Customer, and Application. Missing columns are handled gracefully — the dashboard fills in sensible defaults rather than failing.',
  },
  {
    q: 'Which AI providers are supported?',
    a: 'OpenAI, Google Gemini, Anthropic Claude, and Groq. You bring your own API key, it is stored only for your current session, and you can switch providers at any time from Settings.',
  },
  {
    q: "What's the difference between Admin, SDM, and Associate roles?",
    a: 'Admin is the superuser — approves new accounts, manages roles, uploads data, and does everything SDM can. SDM can upload ticket data, manage backlog, and leave associate feedback. Associate can view dashboards, backlog, and AI insights (with their own API key) but cannot upload data or manage anything. New SDM and Associate accounts require Admin approval before they can sign in.',
  },
  {
    q: 'Is my API key ever stored permanently?',
    a: "No. Keys live only in server memory for your active session and are cleared on restart. They're never written to the database or logged.",
  },
  {
    q: 'Can I filter the dashboard by team, customer, or module?',
    a: 'Yes — every chart and KPI respects the active filters for status, priority, module, customer, application, and assignee, so you can slice the same dataset from whichever angle a conversation needs.',
  },
]

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
      <div className="mb-12 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">FAQ</p>
        <h2 className="mt-3 text-3xl font-bold text-white md:text-4xl">Questions, answered</h2>
      </div>

      <div className="space-y-3">
        {FAQS.map((item, i) => {
          const isOpen = openIndex === i
          return (
            <div key={i} className="glass overflow-hidden rounded-2xl">
              <button
                onClick={() => setOpenIndex(isOpen ? -1 : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="font-medium text-white">{item.q}</span>
                <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <div
                className="grid transition-all duration-300"
                style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <p className="px-6 pb-5 text-sm leading-relaxed text-slate-300">{item.a}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
