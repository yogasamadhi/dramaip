import { PricingPlans } from '../../components/PricingPlans'

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">套餐</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        面向创作者的月度模型额度套餐，无需自行维护模型密钥。
      </p>
      <PricingPlans />
    </main>
  )
}
