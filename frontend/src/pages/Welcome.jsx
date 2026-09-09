import { Link } from 'react-router-dom'
import { ArrowRight, PlayCircle, Sparkles } from 'lucide-react'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import FeatureCarousel from '../components/marketing/FeatureCarousel'
import HowItWorks from '../components/marketing/HowItWorks'
import BuiltForSDMs from '../components/marketing/BuiltForSDMs'
import DataSecurity from '../components/marketing/DataSecurity'
import Testimonials from '../components/marketing/Testimonials'
import ContactSupport from '../components/marketing/ContactSupport'
import FAQ from '../components/marketing/FAQ'

export default function Welcome() {
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      <MarketingHeader />

      {/* Hero */}
      <section className="relative overflow-hidden pt-32">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="animate-mesh absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-brand-600/30 blur-3xl" />
          <div className="animate-mesh absolute -right-24 top-40 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/20 blur-3xl" style={{ animationDelay: '2s' }} />
          <div className="animate-mesh absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-emerald-500/10 blur-3xl" style={{ animationDelay: '4s' }} />
        </div>

        <div className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-16 text-center">
          <span className="glass mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-slate-300">
            <Sparkles size={13} className="text-brand-300" /> AI-Powered Executive Insights
          </span>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
            Executive-ready AMS health,
            <br className="hidden md:block" /> from raw tickets to AI insight
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-400">
            Upload an ITSM export. Get SLA breaches, workload, aging, and an AI-written executive
            summary — before the Friday status call, not during it.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/register" className="btn-primary flex items-center justify-center gap-2 px-6 py-3 text-base">
              Explore Now! <ArrowRight size={18} />
            </Link>
            <a href="#features" className="flex items-center justify-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-white/5">
              <PlayCircle size={18} /> See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Feature carousel */}
      <section id="features" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Features</p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">Everything a status call needs, already open</h2>
        </div>
        <FeatureCarousel />
      </section>

      <HowItWorks />
      <BuiltForSDMs />
      <div id="security"><DataSecurity /></div>
      <Testimonials />
      <div id="contact"><ContactSupport /></div>
      <FAQ />
      <MarketingFooter />
    </div>
  )
}
