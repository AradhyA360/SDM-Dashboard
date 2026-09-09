import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Send, Bot, User, AlertCircle, Trash2, MessageCircle, Plus, PanelLeftClose, PanelLeftOpen, RotateCw,
} from 'lucide-react'
import api from '../services/api'

const SUGGESTIONS = [
  'How many tickets are currently breaching SLA?',
  'Which associate has the biggest backlog right now?',
  'Show the open P1 incidents with owners and SLA status',
]

function Bubble({ role, content, canRegenerate, onRegenerate, regenerating }) {
  const isUser = role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isUser ? 'bg-slate-700 text-white' : 'bg-gradient-to-br from-brand-500 to-brand-700 text-white'}`}>
        {isUser ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div className="max-w-[75%]">
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
            isUser
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100'
          }`}
        >
          {content}
        </div>
        {canRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-brand-600 disabled:opacity-50 dark:hover:text-brand-400"
          >
            <RotateCw size={11} className={regenerating ? 'animate-spin' : ''} /> {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
      </div>
    </motion.div>
  )
}

export default function AIChat() {
  const [datasetId, setDatasetId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [initializing, setInitializing] = useState(true)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    api.get('/dashboard/current-dataset').then(({ data }) => {
      setDatasetId(data.dataset_ids?.join(',') || null)
      setInitializing(false)
    })
  }, [])

  const loadConversations = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const { data } = await api.get('/chat/conversations')
      setConversations(data)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function openConversation(id) {
    setError('')
    setActiveConversationId(id)
    const { data } = await api.get(`/chat/conversations/${id}`)
    setMessages(data.messages.map((m) => ({ role: m.role, content: m.content })))
    inputRef.current?.focus()
  }

  function startNewChat() {
    setActiveConversationId(null)
    setMessages([])
    setError('')
    inputRef.current?.focus()
  }

  async function deleteConversation(id, e) {
    e.stopPropagation()
    const confirmed = window.confirm('Delete this conversation? This cannot be undone.')
    if (!confirmed) return
    await api.delete(`/chat/conversations/${id}`)
    if (activeConversationId === id) startNewChat()
    await loadConversations()
  }

  async function sendMessage(text) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setError('')
    const userMsg = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setSending(true)
    try {
      const history = nextMessages.slice(-6, -1)
      const { data } = await api.post('/chat', {
        dataset_id: datasetId,
        message: trimmed,
        conversation_id: activeConversationId,
        history,
      })
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
      if (!activeConversationId) {
        setActiveConversationId(data.conversation_id)
        await loadConversations()
      } else {
        // bump the conversation's updated_at / message_count in the sidebar without a full refetch flicker
        loadConversations()
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to get a response')
    } finally {
      setSending(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    sendMessage(input)
  }

  async function handleRegenerate() {
    if (!activeConversationId || regenerating) return
    setError('')
    setRegenerating(true)
    try {
      const { data } = await api.post('/chat/regenerate', {
        conversation_id: activeConversationId,
        dataset_id: datasetId,
      })
      setMessages((m) => [...m.slice(0, -1), { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  if (initializing) return <div className="skeleton h-[70vh]" />

  return (
    <div className="flex h-[calc(100vh-160px)] gap-4">
      {/* Chat history panel */}
      <AnimatePresence initial={false}>
        {historyOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }} animate={{ width: 260, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="card hidden shrink-0 flex-col overflow-hidden md:flex"
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-3 dark:border-slate-700">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <MessageCircle size={13} /> Chat History
              </p>
              <button onClick={() => setHistoryOpen(false)} className="text-slate-400 hover:text-slate-600">
                <PanelLeftClose size={15} />
              </button>
            </div>
            <button
              onClick={startNewChat}
              className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600"
            >
              <Plus size={14} /> New Chat
            </button>
            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              {historyLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-9" />)}
                </div>
              ) : conversations.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-slate-400">No conversations yet</p>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={`group flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${
                      activeConversationId === c.id
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span className="truncate">{c.title}</span>
                    <button
                      onClick={(e) => deleteConversation(c.id, e)}
                      className="shrink-0 text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {!historyOpen && (
              <button onClick={() => setHistoryOpen(true)} className="hidden text-slate-400 hover:text-slate-600 md:block">
                <PanelLeftOpen size={18} />
              </button>
            )}
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                Ask Your SDM Ticket Assistant
              </h2>
              <p className="mt-1 text-sm text-slate-500">Evidence-based answers from the active ticket data: SLA, incidents, backlog, owners, and SDM actions.</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={startNewChat} className="btn-secondary flex items-center gap-2 text-sm">
              <Plus size={14} /> New Chat
            </button>
          )}
        </div>

        {!datasetId && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            No dataset is currently active. <Link to="/data?tab=manage" className="underline">Activate one</Link> to ask evidence-based SDM questions.
          </div>
        )}

        <div className="card flex flex-1 flex-col overflow-hidden p-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                  <Bot size={22} />
                </div>
                <p className="text-sm text-slate-400">Ask about the active ticket data. Every response is grounded in dashboard evidence.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((m, i) => {
                  const isLastAssistant = m.role === 'assistant' && i === messages.length - 1
                  return (
                    <Bubble
                      key={i} role={m.role} content={m.content}
                      canRegenerate={isLastAssistant && !!activeConversationId && !sending}
                      onRegenerate={handleRegenerate}
                      regenerating={regenerating}
                    />
                  )
                })}
              </AnimatePresence>
            )}

            {sending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                  <Bot size={15} />
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-700">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="border-t border-red-100 bg-red-50 px-5 py-2.5 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              {error}
              {error.toLowerCase().includes('api key') && (
                <> — <Link to="/settings" className="underline">add one in Settings</Link>.</>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-slate-100 p-3 dark:border-slate-700">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about incidents, SLA, backlog, or an associate..."
              className="input-field flex-1"
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()} className="btn-primary flex h-10 w-10 shrink-0 items-center justify-center p-0">
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
