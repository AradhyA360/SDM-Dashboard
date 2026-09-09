import { Link } from 'react-router-dom'

export default function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-black/20">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white">S</div>
              <span className="font-semibold text-white">Service Health Dashboard</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-slate-400">
              Executive-ready AMS ticket health, from raw ITSM export to AI-generated insight.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Product</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><a href="#security" className="hover:text-white">Security</a></li>
              <li><a href="#testimonials" className="hover:text-white">Customers</a></li>
              <li><a href="#contact" className="hover:text-white">Contact</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Account</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              <li><Link to="/login" className="hover:text-white">Sign in</Link></li>
              <li><Link to="/register" className="hover:text-white">Create account</Link></li>
              <li><Link to="/forgot-password" className="hover:text-white">Reset password</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Built with</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              <li>FastAPI &amp; SQLAlchemy</li>
              <li>React &amp; Tailwind CSS</li>
              <li>Recharts</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-slate-500 md:flex-row">
          <p>&copy; {new Date().getFullYear()} Service Health Dashboard. All rights reserved.</p>
          <p>Built for Service Delivery Managers who live in ticket queues.</p>
        </div>
      </div>
    </footer>
  )
}
