import { AccountDashboard } from '../../components/AccountDashboard'
import { RequireAuth } from '../../components/RequireAuth'

export default function AccountPage() {
  return (
    <RequireAuth>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold text-slate-950">账号中心</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          管理资料、订阅、模型额度余额、订单和用量记录。
        </p>
        <div className="mt-8">
          <AccountDashboard />
        </div>
      </main>
    </RequireAuth>
  )
}
