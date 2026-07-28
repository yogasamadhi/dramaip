import type { Metadata } from 'next'
import { RequireAuth } from '../../../components/RequireAuth'
import { TeamManagement } from '../../../components/TeamManagement'

export const metadata: Metadata = { title: '团队与席位' }

export default function TeamPage() {
  return (
    <RequireAuth>
      <main className="mx-auto max-w-5xl px-5 py-16 lg:px-8">
        <p className="eyebrow">Workspace administration</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink">团队、邀请与席位</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600">Studio 的 5 席包含 owner；邀请一次性、可撤销且有限期。外部审片人不占席位。</p>
        <div className="mt-10"><TeamManagement /></div>
      </main>
    </RequireAuth>
  )
}
