import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Files, CheckCircle2, Trash2, AlertTriangle, UploadCloud, Search, X, Layers, Undo2, Archive, ChevronDown } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
}
const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
}

export default function Datasets() {
  const { user } = useAuth()
  const canManage = user?.role === 'admin' || user?.role === 'sdm'
  const [datasets, setDatasets] = useState([])
  const [deletedDatasets, setDeletedDatasets] = useState([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredDatasets = useMemo(() => {
    if (!searchQuery.trim()) return datasets
    const q = searchQuery.trim().toLowerCase()
    return datasets.filter((ds) => ds.original_filename.toLowerCase().includes(q) || ds.uploaded_by_name.toLowerCase().includes(q))
  }, [datasets, searchQuery])

  const activeCount = datasets.filter((d) => d.is_active).length

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/datasets')
      setDatasets(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load uploaded files')
    } finally {
      setLoading(false)
    }
  }

  async function loadDeleted() {
    if (!canManage) return
    try {
      const { data } = await api.get('/datasets/deleted')
      setDeletedDatasets(data)
    } catch {
      // non-critical - the trash panel just stays empty
    }
  }

  useEffect(() => {
    load()
    loadDeleted()
  }, [])

  async function toggleActive(ds) {
    setBusyId(ds.id)
    setError('')
    try {
      const action = ds.is_active ? 'deactivate' : 'activate'
      await api.post(`/datasets/${ds.id}/${action}`)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update this file')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(ds) {
    const confirmed = window.confirm(`Move "${ds.original_filename}" to Recently Deleted? You can restore it later.`)
    if (!confirmed) return
    setBusyId(ds.id)
    setError('')
    try {
      await api.delete(`/datasets/${ds.id}`)
      await load()
      await loadDeleted()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete this file')
    } finally {
      setBusyId(null)
    }
  }

  async function restore(ds) {
    setBusyId(ds.id)
    setError('')
    try {
      await api.post(`/datasets/${ds.id}/restore`)
      await load()
      await loadDeleted()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to restore this file')
    } finally {
      setBusyId(null)
    }
  }

  async function permanentlyDelete(ds) {
    const confirmed = window.confirm(`Permanently delete "${ds.original_filename}"? This cannot be undone.`)
    if (!confirmed) return
    setBusyId(ds.id)
    setError('')
    try {
      await api.delete(`/datasets/${ds.id}/permanent`)
      await loadDeleted()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to permanently delete this file')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Active &amp; Archived Datasets
          </h2>
          <p className="mt-1 text-sm text-slate-500">Check the files you want included in your analysis — combine several at once, or just pick one.</p>
        </div>
        {canManage && (
          <Link to="/data?tab=upload" className="btn-primary flex items-center gap-2 text-sm">
            <UploadCloud size={15} /> Upload New File
          </Link>
        )}
      </div>

      {datasets.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
          <Layers size={15} />
          {activeCount === 0 ? 'No files are currently active' : `${activeCount} file${activeCount === 1 ? '' : 's'} active — dashboards, backlog, and tickets are combining ${activeCount === 1 ? 'it' : 'them'} together`}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {datasets.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
          <Files size={36} className="text-slate-300" />
          <p className="text-lg font-semibold">No files uploaded yet</p>
          {canManage ? (
            <Link to="/data?tab=upload" className="btn-primary mt-2">Go to Upload</Link>
          ) : (
            <p className="text-sm text-slate-400">An admin needs to upload a ticket export first.</p>
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by filename or uploader..."
              className="input-field pl-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {filteredDatasets.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-400">No uploaded files match your search.</div>
          ) : (
            <motion.div initial="hidden" animate="show" variants={gridVariants} className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-700/50">
                      {canManage && <th className="w-10 px-5 py-3" />}
                      <th className="whitespace-nowrap px-5 py-3 font-medium">File</th>
                      <th className="whitespace-nowrap px-5 py-3 font-medium">Rows</th>
                      <th className="whitespace-nowrap px-5 py-3 font-medium">Uploaded By</th>
                      <th className="whitespace-nowrap px-5 py-3 font-medium">Uploaded At</th>
                      <th className="whitespace-nowrap px-5 py-3 font-medium">Status</th>
                      {canManage && <th className="whitespace-nowrap px-5 py-3 font-medium text-right">Delete</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDatasets.map((ds) => (
                      <motion.tr
                        key={ds.id}
                        variants={rowVariants}
                        className={`border-b border-slate-50 transition-colors dark:border-slate-700/50 ${ds.is_active ? 'bg-brand-50/40 dark:bg-brand-950/10' : 'hover:bg-slate-50/60 dark:hover:bg-slate-700/30'}`}
                      >
                        {canManage && (
                          <td className="px-5 py-3.5">
                            <input
                              type="checkbox"
                              checked={ds.is_active}
                              disabled={busyId === ds.id || ds.file_missing}
                              onChange={() => toggleActive(ds)}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                          </td>
                        )}
                        <td className="whitespace-nowrap px-5 py-3.5 font-medium">{ds.original_filename}</td>
                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs tabular-nums text-slate-500">{ds.row_count}</td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-slate-500">{ds.uploaded_by_name}</td>
                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-slate-500">{new Date(ds.created_at).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-5 py-3.5">
                          {ds.is_active ? (
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                              <CheckCircle2 size={12} /> Active
                            </span>
                          ) : ds.file_missing ? (
                            <span className="flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                              <AlertTriangle size={12} /> File missing
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Inactive</span>
                          )}
                        </td>
                        {canManage && (
                          <td className="whitespace-nowrap px-5 py-3.5 text-right">
                            <button
                              onClick={() => remove(ds)}
                              disabled={busyId === ds.id}
                              className="text-slate-400 hover:text-red-500 disabled:opacity-50"
                              title="Delete this file"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </>
      )}

      {canManage && deletedDatasets.length > 0 && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setTrashOpen((o) => !o)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Archive size={15} /> Recently Deleted
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-700">
                {deletedDatasets.length}
              </span>
            </span>
            <ChevronDown size={15} className={`text-slate-400 transition-transform ${trashOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {trashOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden border-t border-slate-100 dark:border-slate-700"
              >
                <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                  {deletedDatasets.map((ds) => (
                    <div key={ds.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-500 line-through decoration-slate-300">{ds.original_filename}</p>
                        <p className="text-xs text-slate-400">
                          {ds.row_count} rows &middot; deleted {new Date(ds.deleted_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => restore(ds)}
                          disabled={busyId === ds.id}
                          className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                        >
                          <Undo2 size={13} /> Restore
                        </button>
                        <button
                          onClick={() => permanentlyDelete(ds)}
                          disabled={busyId === ds.id}
                          className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
                        >
                          <Trash2 size={13} /> Delete Forever
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
