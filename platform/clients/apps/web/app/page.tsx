import Link from 'next/link'
import { Button } from '../components/ui/Button'
import { ADAPTATION_JOURNEY, NOVEL_JOURNEY, PRODUCT_POSITIONING } from '../lib/product-positioning'

export default function HomePage() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-stone-200">
        <div className="studio-grid absolute inset-0 opacity-70" />
        <div className="relative mx-auto grid min-h-[690px] max-w-7xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-8">
          <div>
            <p className="eyebrow">{PRODUCT_POSITIONING.brand} · {PRODUCT_POSITIONING.promise}</p>
            <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.08] tracking-[-.045em] text-ink sm:text-6xl">
              从小说到分集剧本，<br />让故事走向短剧。
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-stone-600">{PRODUCT_POSITIONING.category}。{PRODUCT_POSITIONING.description}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/download"><Button className="h-12 px-7">查看桌面端下载状态</Button></Link>
              <Link href="/cases"><Button className="h-12 px-7" variant="secondary">了解小说与改编路径</Button></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-500">
              <span>作品默认本地保存</span><span>小说可独立完成</span><span>媒体生成可选 · BYOK</span>
            </div>
          </div>

          <aside aria-label="改编创作路径示意" className="relative rounded-[28px] border border-stone-300 bg-white p-6 shadow-studio">
            <p className="text-xs font-medium text-rust">从原著到试制 · 创作路径示意</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">先把故事讲好，再投入制作。</h2>
            <ol className="mt-6 space-y-3">
              {ADAPTATION_JOURNEY.map((stage, index) => (
                <li key={stage.title} className="flex gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <span className="font-mono text-sm text-rust">0{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink">{stage.title}</h3>
                      <span className="text-xs text-stone-500">{stage.state}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-stone-600">{stage.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-xs leading-6 text-stone-500">独立改编诊断、整季方案与统一试制包仍按优化计划分阶段验收。这是目标路径，不是已完成任务、真实模型结果或成片质量证明。</p>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <p className="eyebrow">Story first</p>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-ink">{PRODUCT_POSITIONING.novelHeadline}</h2>
        <p className="mt-5 max-w-3xl leading-7 text-stone-600">小说写作不是改编的临时输入。人物、大纲、正文、事实记忆和作者风格共同发展为可继续创作的故事母本，也可以独立形成稿件与投稿成果。</p>
        <ol className="mt-10 grid gap-4 md:grid-cols-5">
          {NOVEL_JOURNEY.map((stage, index) => (
            <li key={stage} className="rounded-2xl border border-stone-200 bg-white p-6">
              <span className="font-mono text-xs text-rust">0{index + 1}</span>
              <h3 className="mt-6 font-semibold text-ink">{stage}</h3>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm leading-7 text-stone-500">你可以从创意开始，也可以导入已有小说继续写作，或从已有剧本直接进入制作检查。是否改编、采用哪个候选、何时交付，都由你决定。</p>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="eyebrow !text-[#e98765]">Local first, by design</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">你的原作、版本与来源，默认留在你的电脑。</h2>
          </div>
          <div className="grid gap-6 text-sm leading-7 text-stone-300 sm:grid-cols-2">
            <p>AI 负责规划、生成、检查和修订，你保留最终采用权。已有正式内容不被候选静默覆盖。</p>
            <p>本地优先不等于离线 AI。模型调用需要配置连接与授权，图片、音频和视频是可替换的生产出口。</p>
            <p>云能力按需使用，私人正文、对话和记忆不自动跨端同步；媒体调用前核对来源、权利和费用。</p>
            <Link className="font-medium text-[#ee9b7e] hover:text-white" href="/trust">查看完整数据边界 →</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-24 text-center lg:px-8">
        <p className="eyebrow">Start with evidence</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-ink">从自己的故事开始，也可以先看示例。</h2>
        <p className="mx-auto mt-5 max-w-2xl leading-7 text-stone-600">小说与改编示例明确区分作者编写的样稿、目标流程和工程验证。已有十镜头离线样片保留为制作能力案例，不代表真实模型质量或正式发布。</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/cases"><Button className="h-12 px-7">查看创作示例</Button></Link>
          <Link href="/pricing"><Button className="h-12 px-7" variant="secondary">按创作与交付需要比较套餐</Button></Link>
        </div>
      </section>
    </main>
  )
}
