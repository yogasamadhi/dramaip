import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '../../../components/ui/Button'

export const metadata: Metadata = { title: '内置样片案例' }

const stages = [
  ['01', '建立生产基线', '虚构短剧《雾港来信》含 10 个镜头、故事设定、两名角色、三个场景与全部许可记录。'],
  ['02', '查看素材覆盖', '角色正脸、转身、表情、姿态、服装和场景布局按槽位显示缺失、已采用、过期与锁定。'],
  ['03', '比较与局部 Retake', '在不可变候选之间比较；只修改表情或构图，原结果、成本和输入指纹全部保留。'],
  ['04', '处理生产影响', '采用上游新版本后，相关参考锁、静帧、审片包与交付包自动标记过期。'],
  ['05', '审片与交付', '生成免登录离线审片包，并从同一时间线清单导出媒体、字幕和剪辑工程。'],
]

export default function DemoCasePage() {
  return (
    <main>
      <section className="border-b border-stone-200 bg-[#e9dfd1]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[.9fr_1.1fr] lg:px-8">
          <div>
            <p className="eyebrow">Built-in production case</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink">《雾港来信》<br />从十个镜头看完整生产闭环。</h1>
            <p className="mt-6 max-w-xl leading-7 text-stone-700">这不是预渲染宣传片，而是随桌面端安装的可编辑项目。所有生成步骤明确标注 Mock Provider，结果确定、离线可复现。</p>
            <Link href="/download" className="mt-8 inline-block"><Button className="h-12 px-7">在桌面端体验</Button></Link>
          </div>
          <div className="grid grid-cols-2 gap-3 self-end">
            <div className="aspect-[4/5] rounded-[28px] bg-gradient-to-b from-[#47616a] to-[#151a1b] p-5 text-sm text-white">SH_003<br /><span className="text-white/60">码头 · 雨夜</span></div>
            <div className="mt-16 aspect-[4/5] rounded-[28px] bg-gradient-to-b from-[#b96b48] to-[#30201b] p-5 text-sm text-white">SH_007<br /><span className="text-white/60">信件 · 反转</span></div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-20 lg:px-8">
        <div className="space-y-4">
          {stages.map(([number, title, description]) => (
            <article key={number} className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-7 sm:grid-cols-[72px_220px_1fr] sm:items-start">
              <div className="font-mono text-rust">{number}</div>
              <h2 className="text-xl font-semibold text-ink">{title}</h2>
              <p className="text-sm leading-7 text-stone-600">{description}</p>
            </article>
          ))}
        </div>
        <section className="mt-14 rounded-3xl bg-ink p-8 text-white">
          <p className="text-sm text-stone-400">样片许可</p>
          <h2 className="mt-2 text-2xl font-semibold">完全虚构，不含第三方 IP。</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-300">角色、场景、文字、位图和音轨均附自有或可再分发许可元数据。复制样片后成为普通本地项目。</p>
        </section>
      </section>
    </main>
  )
}
