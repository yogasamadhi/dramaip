export default function BillingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">Billing</h1>
      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-500">MVP billing flow</div>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">Demo checkout is available from Pricing.</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The current backend creates a checkout placeholder. WeChat Pay and Alipay adapters can replace that
          endpoint without changing the client route.
        </p>
      </section>
    </main>
  )
}
