import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '../../components/ui/Button'
import { PRODUCT_POSITIONING } from '../../lib/product-positioning'

export const metadata: Metadata = { title: '小说与改编创作案例' }

export default function CasesPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Story, screenplay, production</p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink">一个故事，不止一种完成方式。</h1>
      <p className="mt-6 max-w-3xl leading-7 text-stone-600">{PRODUCT_POSITIONING.category}。小说稿件可以独立完成，改编是你选择的下一步，媒体是可选出口。示例不冒充真实模型或用户验证。</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <article className="rounded-3xl border border-stone-200 bg-white p-8">
          <p className="text-xs font-medium text-rust">作者编写的虚构示例 · 目标流程</p>
          <h2 className="mt-4 text-2xl font-semibold text-ink">独立小说：两章稿件与认知记忆</h2>
          <p className="mt-4 text-sm leading-7 text-stone-600">《最后一班渡船》的两章作者展示稿可单独查看并下载TXT，不要求进入改编或制作视频；不是完整小说、真实模型运行或实际投稿回执。</p>
          <Link href="/cases/story" className="mt-6 inline-block"><Button>查看独立小说展示稿</Button></Link>
        </article>
        <article className="rounded-3xl border border-stone-200 bg-white p-8">
          <p className="text-xs font-medium text-rust">作者编写的虚构示例 · 非真实模型验证</p>
          <h2 className="mt-4 text-2xl font-semibold text-ink">改编展示稿：从取舍到完整首集</h2>
          <p className="mt-4 text-sm leading-7 text-stone-600">同一故事的诊断、两种策略、三集季纲、完整首集三场剧本、六镜头表与结构化JSON一起展示来源及新增内容。没有成片、实际采用、授权或费用证明。</p>
          <Link href="/cases/story#adaptation" className="mt-6 inline-block"><Button variant="secondary">查看完整改编展示稿</Button></Link>
        </article>
        <article className="rounded-3xl border border-stone-200 bg-white p-8">
          <p className="text-xs font-medium text-rust">历史受控展示 · Mock Provider</p>
          <h2 className="mt-4 text-2xl font-semibold text-ink">《雾港来信》：十镜头制作样片</h2>
          <p className="mt-4 text-sm leading-7 text-stone-600">保留镜头候选、生产影响、离线审片与交付的历史说明，不保证当前安装包含此项目。示例不证明真实 AI 成片、完整授权、外部剪辑器导入或正式 GA。</p>
          <Link href="/cases/demo" className="mt-6 inline-block"><Button variant="secondary">查看制作样片</Button></Link>
        </article>
      </div>
    </main>
  )
}
