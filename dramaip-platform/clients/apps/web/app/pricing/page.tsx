const plans = [
  { name: 'Free', quota: '10K tokens / month', price: '0' },
  { name: 'Basic', quota: '500K tokens / month', price: 'TBD' },
  { name: 'Pro', quota: '2M tokens / month', price: 'TBD' },
  { name: 'Premium', quota: '10M tokens / month', price: 'TBD' },
]

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">Pricing</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        {plans.map((plan) => (
          <section key={plan.name} className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-2 text-sm text-slate-600">{plan.quota}</p>
            <p className="mt-6 text-2xl font-semibold">{plan.price}</p>
          </section>
        ))}
      </div>
    </main>
  )
}
