import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkles, Lightbulb, Coins, Bot, ScanSearch } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import SdmWorkspace from './SdmWorkspace'
import AIInsightsPanel from './AIInsights'
import AITokenAnalyticsPanel from './AITokenAnalytics'
import IncidentCommandCenter from './IncidentCommandCenter'
import SentimentAnalysis from './SentimentAnalysis'

// One sidebar entry for everything AI-related, instead of four. Which
// provider actually does the work (Ollama locally, or an external model via
// an API key) is chosen once in Settings -> AI Provider and applies to every
// tab here automatically - nothing on this page picks a provider itself.
export default function AI() {
  const { user } = useAuth()
  const canUsePrivileged = user?.role === 'admin' || user?.role === 'sdm'
  const [searchParams, setSearchParams] = useSearchParams()
  // 'semantic-analysis' kept as an alias so old bookmarked/shared links
  // (?tab=semantic-analysis) still land on the now-renamed Sentiment
  // Analysis tab instead of falling back to the default tab.
  const requestedRaw = searchParams.get('tab')
  const requested = requestedRaw === 'semantic-analysis' ? 'sentiment-analysis' : requestedRaw
  const defaultTab = canUsePrivileged ? 'copilot' : 'insights'
  const [tab, setTab] = useState(
    ['copilot', 'command-center', 'sentiment-analysis', 'insights', 'usage'].includes(requested)
      ? (requested === 'copilot' || requested === 'command-center') && !canUsePrivileged
        ? defaultTab
        : requested
      : defaultTab,
  )

  function switchTab(next) {
    setTab(next)
    setSearchParams(next === defaultTab ? {} : { tab: next }, { replace: true })
  }

  const TABS = [
    { id: 'copilot', label: 'SDM Copilot', icon: Sparkles, privileged: true },
    { id: 'command-center', label: 'Incident Command Center', icon: Bot, privileged: true },
    { id: 'sentiment-analysis', label: 'Sentiment Analysis', icon: ScanSearch },
    { id: 'insights', label: 'AI Insights', icon: Lightbulb },
    { id: 'usage', label: 'Usage & Cost', icon: Coins },
  ].filter((t) => !t.privileged || canUsePrivileged)

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'copilot' && canUsePrivileged && <SdmWorkspace />}
      {tab === 'command-center' && canUsePrivileged && <IncidentCommandCenter />}
      {tab === 'sentiment-analysis' && <SentimentAnalysis />}
      {tab === 'insights' && <AIInsightsPanel />}
      {tab === 'usage' && <AITokenAnalyticsPanel />}
    </div>
  )
}

