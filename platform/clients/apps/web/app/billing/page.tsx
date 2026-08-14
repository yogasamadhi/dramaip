import { RequireAuth } from '../../components/RequireAuth'
import { BillingOverview } from '../../components/BillingOverview'

export default function BillingPage() {
  return (
    <RequireAuth>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold text-slate-950">账单与额度</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">查看订单状态、当期订阅、模型额度和最近用量。此环境仅允许模拟支付确认，不会产生真实扣款。</p>
        <div className="mt-8"><BillingOverview /></div>
      </main>
    </RequireAuth>
  )
}
