import Link from 'next/link'
import { ServiceStatus } from '../components/ServiceStatus'
import { Button } from '../components/ui/Button'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
      <nav className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="text-lg font-semibold">DramaIP</div>
        <div className="flex gap-3">
          <Link href="/pricing" className="text-sm text-slate-700">
            Pricing
          </Link>
          <Link href="/login" className="text-sm text-slate-700">
            Login
          </Link>
        </div>
      </nav>

      <section className="grid flex-1 content-center gap-8 py-20 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-brand-700">
            AI drama creation platform
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-tight text-slate-950">
            Turn long-form stories into production-ready short drama IP.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Desktop-first creation, cloud subscription, token quotas, and a mobile idea
            capture flow designed for serious creators.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/download">
              <Button>Download desktop</Button>
            </Link>
            <Link href="/pricing">
              <Button variant="secondary">View pricing</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4">
          <ServiceStatus />
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Platform scope</div>
            <div className="mt-4 grid gap-3 text-sm text-slate-700">
              <div>Desktop studio: local-first professional workspace</div>
              <div>Web: website, subscription, account center</div>
              <div>Mobile: lightweight idea capture</div>
              <div>Services: auth, billing, quota, AI gateway</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
