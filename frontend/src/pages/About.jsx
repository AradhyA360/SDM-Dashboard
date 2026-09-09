import { Info, Sparkles, ShieldCheck, BarChart3 } from 'lucide-react'

export default function About() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          About This Dashboard
        </h2>
        <p className="mt-1 text-sm text-slate-500">Executive Service Health Dashboard — v1.0.0</p>
      </div>

      <div className="card space-y-4 p-6 text-sm text-slate-600 dark:text-slate-300">
        <p>
          This dashboard helps Service Delivery Managers monitor the health of Application
          Management Services (AMS) by converting raw ITSM ticket exports into executive-ready
          KPIs, charts, and AI-generated insights.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col items-start gap-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
            <BarChart3 size={18} className="text-brand-500" />
            <p className="font-medium text-slate-800 dark:text-slate-100">KPIs & Charts</p>
            <p className="text-xs text-slate-500">SLA breaches, aging, workload, and trend analysis.</p>
          </div>
          <div className="flex flex-col items-start gap-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
            <Sparkles size={18} className="text-brand-500" />
            <p className="font-medium text-slate-800 dark:text-slate-100">AI Insights</p>
            <p className="text-xs text-slate-500">Bring your own OpenAI, Gemini, or Claude key.</p>
          </div>
          <div className="flex flex-col items-start gap-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
            <ShieldCheck size={18} className="text-brand-500" />
            <p className="font-medium text-slate-800 dark:text-slate-100">Role-based Access</p>
            <p className="text-xs text-slate-500">Admin, SDM & Associate roles, with approval-gated sign-up.</p>
          </div>
        </div>
        <p className="text-xs text-slate-400">Built with FastAPI, SQLAlchemy, React, Tailwind CSS, and Recharts.</p>
      </div>
    </div>
  )
}
