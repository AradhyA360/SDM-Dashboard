import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

const MESSAGES = [
  'Reading ticket patterns…',
  'Cross-checking SLA timers…',
  'Weighing engineer workload…',
  'Spotting recurring bottlenecks…',
  'Drafting the executive summary…',
  'Scoring overall health…',
]

export default function AIThinkingLoader() {
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setMsgIndex((i) => (i + 1) % MESSAGES.length), 1400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="card flex flex-col items-center justify-center gap-5 overflow-hidden p-16 text-center">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-400 to-fuchsia-500 opacity-30 blur-xl"
          animate={{ scale: [1, 1.3, 1], opacity: [0.25, 0.45, 0.25] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border-2 border-brand-400/40"
            style={{ width: '100%', height: '100%' }}
            animate={{ scale: [0.6, 1.4], opacity: [0.6, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: i * 0.6 }}
          />
        ))}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg"
        >
          <Sparkles size={24} />
        </motion.div>
      </div>

      <div className="h-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={msgIndex}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="font-mono text-sm text-slate-500 dark:text-slate-400"
          >
            {MESSAGES[msgIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}
