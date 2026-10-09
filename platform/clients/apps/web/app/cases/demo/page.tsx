import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '../../../components/ui/Button'

export const metadata: Metadata = { title: '历史受控制作示例' }

const stages = [
  ['01', '说明示例范围', '历史展示描述 10 个镜头、故事设定、两名角色与三个场景；数量及流程说明不是当前安装清单或授权凭证。'],
  ['02', '查看素材覆盖', '角色正脸、转身、表情、姿态、服装和场景布局按槽位显示缺失、已采用、过期与锁定。'],
  ['03', '比较与局部 Retake', '展示不可变候选及局部变化的目标行为；示例数值不是实际模型质量或账单，未核验费用保持未知。'],
  ['04', '处理生产影响', '采用上游新版本后，相关参考锁、静帧、审片包与交付包自动标记过期。'],
  ['05', '审片与交付边界', '离线审片、媒体、字幕与剪辑工程各有自己的验收范围；本页不提供当前保存回执、完整媒体交付或外部剪辑器导入证明。'],
]

export default function DemoCasePage() {
  return (
    <main>
      <section className="border-b border-stone-200 bg-[#e9dfd1]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[.9fr_1.1fr] lg:px-8">
          <div>
            <p className="eyebrow">Historical controlled demonstration</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink">《雾港来信》<br />十镜头历史受控展示。</h1>
            <p className="mt-6 max-w-xl leading-7 text-stone-700">保留既有 Mock Provider 制作说明，不证明当前安装已包含此项目，也不代表当前三个智能引擎的真实输出。页面中的场景卡是示意，不是可播放成片；小说或无媒体改编不必经过这个流程。</p>
            <Link href="/download" className="mt-8 inline-block"><Button className="h-12 px-7">查看下载状态</Button></Link>
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
          <p className="text-sm text-stone-400">证据边界</p>
          <h2 className="mt-2 text-2xl font-semibold">本页未提供完整可核验授权凭证。</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-300">历史展示标签或许可元数据不当作文件来源、具体使用授权和公开许可已经核全的证明。本页没有实际账单、用户研究或发行回执，不作可发行或完整验收保证。</p>
        </section>
      </section>
    </main>
  )
}
