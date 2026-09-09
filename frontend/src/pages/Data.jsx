import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UploadCloud, Files } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import UploadPanel from './Upload'
import ManagePanel from './Datasets'

// Combines the old separate "Upload Data" and "Uploaded Data" pages into one
// tabbed view - same two components, same functionality, just one sidebar
// entry and one place to find them instead of two.
export default function Data() {
  const { user } = useAuth()
  const canUpload = user?.role === 'admin' || user?.role === 'sdm'
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [tab, setTab] = useState(
    requestedTab === 'manage' || (requestedTab !== 'upload' && !canUpload) ? 'manage' : 'upload',
  )

  function switchTab(next) {
    setTab(next)
    setSearchParams(next === 'upload' ? {} : { tab: next }, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {canUpload && (
          <button
            onClick={() => switchTab('upload')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === 'upload'
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <UploadCloud size={15} /> Upload Data
          </button>
        )}
        <button
          onClick={() => switchTab('manage')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === 'manage'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Files size={15} /> Uploaded Files
        </button>
      </div>

      {tab === 'upload' && canUpload ? <UploadPanel /> : <ManagePanel />}
    </div>
  )
}
