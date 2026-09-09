import { Bot, Sparkles } from 'lucide-react'
import SdmCopilot from './SdmCopilot'
import AIChat from './AIChat'

// One top-level AI tab for the SDM briefing and conversational assistant.
// Incident Command Center intentionally remains a separate top-level tab so
// its workflow is never hidden inside this combined surface.
export default function SdmWorkspace() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl2 border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-white p-5 dark:border-brand-900/50 dark:from-brand-950/30 dark:via-slate-800 dark:to-slate-800">
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300"><Sparkles size={16} /> SDM Copilot</p>
        <h2 className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">Your daily delivery briefing and data-aware assistant.</h2>
        <p className="mt-1 text-sm text-slate-500">Review service risk, then ask follow-up questions in the same workspace.</p>
      </div>
      <SdmCopilot />
      <div className="border-t border-slate-200 pt-6 dark:border-slate-700">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><Bot size={16} className="text-brand-500" /> Ask Chatbot</p>
        <AIChat />
      </div>
    </div>
  )
}
