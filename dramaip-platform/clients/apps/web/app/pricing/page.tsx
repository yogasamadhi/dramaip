import { PricingPlans } from '../../components/PricingPlans'

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Pricing that follows production</p>
      <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight text-ink">本地创作始终自由，<br />按团队与交付需要升级。</h1>
      <p className="mt-5 max-w-3xl text-base leading-7 text-stone-600">
        Free 不限制本地项目。图片、音频、视频默认全部 BYOK，不计入平台文本额度，也不包装成套餐赠送量。
      </p>
      <PricingPlans />
    </main>
  )
}
