import Link from 'next/link'
import { AccountDashboard } from '../../components/AccountDashboard'
import { RequireAuth } from '../../components/RequireAuth'
import { Button } from '../../components/ui/Button'

export default function AccountPage() {
  return (
    <RequireAuth>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">账号中心</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">管理当前权益、迁移日期、模型额度、订单和用量。</p>
          </div>
          <Link href="/account/team"><Button variant="secondary">团队与席位</Button></Link>
        </div>
        <div className="mt-8">
          <AccountDashboard />
        </div>
      </main>
    </RequireAuth>
  )
}
