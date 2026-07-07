export default function BillingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">计费</h1>
      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-500">计费流程</div>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">可在套餐页使用模拟支付完成订单。</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          开发和测试环境使用模拟支付服务商。后续接入微信支付或支付宝时，可复用同一套订单与订阅状态机，
          不需要改变客户端路由。
        </p>
      </section>
    </main>
  )
}
