import { Link } from 'react-router-dom'

export default function AppFooter() {
  return (
    <footer className="mt-12 border-t border-slate-200 px-4 py-6 text-xs text-slate-400 dark:border-slate-700 sm:px-6 md:px-10">
      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p>&copy; {new Date().getFullYear()} Service Health Dashboard &mdash; built for Service Delivery Managers.</p>
        <div className="flex items-center gap-4">
          <Link to="/about" className="hover:text-slate-600 dark:hover:text-slate-300">About</Link>
          <Link to="/settings" className="hover:text-slate-600 dark:hover:text-slate-300">Settings</Link>
        </div>
      </div>
    </footer>
  )
}
