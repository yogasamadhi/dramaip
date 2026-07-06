import { PricingPlans } from '../../components/PricingPlans'

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">Pricing</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Monthly token plans for creators who do not want to manage their own model API keys.
      </p>
      <PricingPlans />
    </main>
  )
}
