import { PricingPlans } from '../../components/PricingPlans'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '小说、剧本与交付套餐' }

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Pricing that follows your story</p>
      <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight text-ink">本地创作始终自由，<br />按团队与交付需要升级。</h1>
      <p className="mt-5 max-w-3xl text-base leading-7 text-stone-600">
        小说规划、连续写作、稿件与投稿成果有独立价值；改编用户关注分集剧本、连续性与专业交付。按实际需要选择创作资源、审阅交换和可选团队协作，不要求小说作者先改编或制作视频。下面比较的是当前服务端返回的平台权益，不是 Desktop 本地功能的授权表；套餐名称不保证文学质量或发行就绪。媒体生成费用与平台文本额度分开，具体模型接入、格式、容量与席位以实际权益为准。
      </p>
      <PricingPlans />
    </main>
  )
}
