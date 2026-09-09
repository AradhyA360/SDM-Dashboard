import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#security', label: 'Security' },
  { href: '#testimonials', label: 'Customers' },
  { href: '#contact', label: 'Contact' },
  { href: '#faq', label: 'FAQ' },
]

export default function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 12) }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? 'glass shadow-lg' : 'bg-transparent'}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 font-bold text-white">S</div>
          <span className="font-semibold text-white">Service Health Dashboard</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-slate-300 transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" className="text-sm font-medium text-slate-200 hover:text-white">Sign in</Link>
          <Link to="/register" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-transform hover:scale-105">
            Get started
          </Link>
        </div>

        <button onClick={() => setOpen((o) => !o)} className="text-white md:hidden">
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <div className="glass mx-4 mb-4 rounded-2xl p-5 md:hidden">
          <nav className="flex flex-col gap-4">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm font-medium text-slate-200">
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-4">
              <Link to="/login" className="text-sm font-medium text-slate-200">Sign in</Link>
              <Link to="/register" className="rounded-lg bg-white px-4 py-2 text-center text-sm font-semibold text-slate-900">
                Get started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
