import Link from 'next/link'
import { Button } from '../components/ui/Button'

export default function HomePage() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-stone-200">
        <div className="studio-grid absolute inset-0 opacity-70" />
        <div className="relative mx-auto grid min-h-[690px] max-w-7xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-8">
          <div>
            <p className="eyebrow">AI comic drama production studio · v2</p>
            <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.08] tracking-[-.045em] text-ink sm:text-6xl">
              一部长篇 IP，<br />走到可交付的最后一公里。
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-stone-600">
              从故事圣经、角色参考锁和镜头生产，到匿名审片与剪辑工程。每一次采用都有版本，每一次改动都有影响，每一份结果都能复现。
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/download"><Button className="h-12 px-7">体验内置样片</Button></Link>
              <Link href="/cases/demo"><Button className="h-12 px-7" variant="secondary">查看完整案例</Button></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-500">
              <span>无需登录</span><span>无需 API Key</span><span>无需网络</span><span>本地项目不限量</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-12 rounded-full bg-[#e7c8b2]/40 blur-3xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-stone-300 bg-[#242321] p-3 shadow-studio">
              <div className="flex items-center justify-between px-3 py-2 text-[11px] text-stone-400">
                <span>雾港来信 / EP01 / SH_007</span><span>导演工作台 · FINAL</span>
              </div>
              <div className="grid min-h-[430px] grid-cols-[88px_1fr] gap-2">
                <div className="space-y-2 rounded-2xl bg-[#181817] p-2">
                  {['001', '003', '005', '007', '009'].map((shot, index) => (
                    <div key={shot} className={`aspect-video rounded-md border ${index === 3 ? 'border-[#e56d42] bg-[#503329]' : 'border-stone-700 bg-stone-800'} p-1 text-[9px] text-stone-400`}>
                      SH_{shot}
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="relative flex-1 overflow-hidden rounded-2xl bg-gradient-to-br from-[#31454b] via-[#1e292d] to-[#a25839]">
                    <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute left-[18%] top-[27%] h-40 w-24 rounded-t-full bg-[#171b1d] shadow-2xl" />
                    <div className="absolute bottom-4 left-4 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[10px] text-white">角色锁 2 · 场景锁 1</div>
                    <div className="absolute right-4 top-4 rounded-full bg-emerald-400/15 px-3 py-1 text-[10px] text-emerald-300">一致性 94%</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {['候选 A · 已采用', '候选 B', '局部 Retake'].map((label, index) => (
                      <div key={label} className={`rounded-xl border p-3 text-[10px] ${index === 0 ? 'border-[#e56d42] bg-[#49332b] text-[#f3b49d]' : 'border-stone-700 bg-[#191918] text-stone-400'}`}>{label}</div>
                    ))}
                  </div>
                  <div className="flex h-14 items-end gap-1 rounded-xl bg-[#191918] p-3">
                    {[22, 34, 16, 42, 29, 48, 20, 37, 26, 44, 18, 31].map((height, index) => <span key={index} className="w-full rounded-sm bg-[#d4633d]" style={{ height }} />)}
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-6 -left-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl sm:-left-6">
              <div className="text-xs text-stone-500">生产影响</div>
              <div className="mt-1 font-semibold text-ink">2 项待处理 · 交付已阻断</div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <p className="eyebrow">One production line</p>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-ink">不是零散的 AI 按钮，是一条可追溯的生产线。</h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-stone-200 bg-stone-200 md:grid-cols-5">
          {[
            ['01', '长篇 IP', '故事圣经与剧本拆解保持来源关系。'],
            ['02', '资产一致性', '角色、场景、道具覆盖状态一屏可见。'],
            ['03', '镜头生产', '候选不可变，Retake 只改需要改的部分。'],
            ['04', '审片闭环', '离线免登录；Studio 可发布云端代理。'],
            ['05', '剪辑交付', 'FCPXML、EDL、SRT 与媒体清单同源生成。'],
          ].map(([number, title, description]) => (
            <article key={number} className="min-h-64 bg-white p-7">
              <div className="font-mono text-xs text-rust">{number}</div>
              <h3 className="mt-16 text-xl font-semibold text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-stone-600">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="eyebrow !text-[#e98765]">Local first, by design</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">你的原作与母版，默认留在你的电脑。</h2>
          </div>
          <div className="grid gap-6 text-sm leading-7 text-stone-300 sm:grid-cols-2">
            <p>图片、音频、视频均支持 BYOK。密钥由桌面主进程保管，不进入网页或渲染进程。</p>
            <p>云审片只上传你主动选择的低清代理、缩略图、清单和评论，30 天内自动清理。</p>
            <Link className="font-medium text-[#ee9b7e] hover:text-white" href="/trust">查看完整数据边界 →</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-24 text-center lg:px-8">
        <p className="eyebrow">Start with evidence</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-ink">先用一部完整样片，把流程跑通。</h2>
        <p className="mx-auto mt-5 max-w-2xl leading-7 text-stone-600">内置 10 镜头虚构项目和明确标注的 Mock Provider。复制后就是普通可编辑项目。</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/download"><Button className="h-12 px-7">下载 v2 RC</Button></Link>
          <Link href="/pricing"><Button className="h-12 px-7" variant="secondary">比较套餐</Button></Link>
        </div>
      </section>
    </main>
  )
}
