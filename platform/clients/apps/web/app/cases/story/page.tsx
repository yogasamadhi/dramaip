import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '../../../components/ui/Button'
import { STORY_CASE, STORY_CASE_ARTIFACTS, storyCaseFileURL } from '../../../lib/story-case'

export const metadata: Metadata = { title: '最后一班渡船：小说与改编示例' }

const { chapters, diagnosis, strategies, episodes, pilot, shots } = STORY_CASE

export default function StoryCasePage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Author-written fictional example</p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink">《最后一班渡船》</h1>
      <p className="mt-6 max-w-3xl leading-7 text-stone-600">本站作者编写的虚构创作示例。以下小说、诊断、季纲、剧本和分镜均为作者编写的展示稿，不是已运行的 AI 候选、正式采用记录或用户测试。展示稿不代替公开许可或真实验收；具体能力按当前工程范围核对，文学质量、用户反馈与发行证据另行验证。</p>
      <nav aria-label="按成果查看示例" className="mt-6 flex flex-wrap gap-4 text-sm font-medium text-rust"><a href="#novel">只看独立小说稿件</a><a href="#adaptation">查看完整改编展示稿</a><a href="#handoff">查看交付与缺口</a></nav>

      <section className="mt-12 rounded-3xl border border-stone-200 bg-white p-8">
        <h2 className="text-2xl font-semibold text-ink">作者意图：等待不是被动，留下是一种选择。</h2>
        <p className="mt-4 leading-7 text-stone-600">{STORY_CASE.authorIntent}</p>
      </section>

      <section id="novel" className="mt-12 scroll-mt-8">
        <h2 className="text-3xl font-semibold text-ink">小说可以在这里独立完成。</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {chapters.map((chapter) => <article key={chapter.title} className="rounded-3xl border border-stone-200 bg-white p-7"><h3 className="text-xl font-semibold text-ink">{chapter.title}</h3><p className="mt-4 leading-8 text-stone-600">{chapter.content}</p></article>)}
        </div>
        <p className="mt-5 text-sm leading-7 text-stone-600">连续性记忆示例：第一章只知寄箱；第二章才知托付，仍不知姓名。下一章不得直接写成“她认出了那个等待的人”。可以继续续写或导出稿件，不必创建改编、分镜或视频。</p>
        <p className="mt-4 text-sm text-stone-500">范围：{STORY_CASE.sourceScope} 下载文件包含这两章、作者意图与认知记忆，不是完整小说或实际投稿／采用回执。</p>
        <a href={storyCaseFileURL('manuscript.txt')} className="mt-5 inline-block rounded-xl bg-ink px-5 py-3 text-sm font-medium text-white">下载两章小说展示稿 · TXT</a>
      </section>

      <section id="adaptation" className="mt-12 scroll-mt-8">
        <h2 className="text-3xl font-semibold text-ink">选择改编时，先解释取舍。</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">{diagnosis.map((item) => <article key={item.id} className="rounded-3xl border border-stone-200 bg-white p-6"><h3 className="font-semibold text-ink">{item.title}</h3><p className="mt-3 text-sm leading-7 text-stone-600">{item.detail}</p><p className="mt-4 text-xs leading-6 text-stone-500">来源：{item.sourceChapterIds.join('、')}</p></article>)}</div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {strategies.map((strategy) => <article key={strategy.id} className="rounded-2xl bg-stone-100 p-6"><h3 className="font-semibold">{strategy.title}</h3><p className="mt-3 text-sm leading-7 text-stone-600">{strategy.detail}</p></article>)}
        </div>
        <p className="mt-4 text-xs leading-6 text-stone-500">策略 A 只是本作者展示稿的选择，不是 Runtime 正式采用或真实模型比较结果。</p>
      </section>

      <section className="mt-12">
        <h2 className="text-3xl font-semibold text-ink">三集季纲展示稿：每集都有来源。</h2>
        <ol className="mt-6 space-y-4">{episodes.map((episode) => <li key={episode.id} className="rounded-2xl border border-stone-200 bg-white p-6"><h3 className="font-semibold">{episode.title} · {episode.detail}</h3><p className="mt-3 text-sm leading-7 text-stone-600">{episode.turn}</p><p className="mt-2 text-xs leading-6 text-stone-500">来源：{episode.sourceScope}（{episode.sourceChapterIds.join('、')}）</p><p className="mt-2 text-xs leading-6 text-stone-500">新增／未知：{episode.additions}</p></li>)}</ol>
      </section>

      <section className="mt-12 grid gap-6 md:grid-cols-2">
        <article className="rounded-3xl bg-ink p-8 text-white"><h2 className="text-2xl font-semibold">完整首集剧本展示稿</h2><p className="mt-4 text-xs leading-6 text-stone-400">{pilot.coverage} 来源：第一章；{pilot.additions}</p>{pilot.scenes.map((scene) => <section key={scene.id} className="mt-7"><h3 className="font-mono text-sm font-semibold">{scene.heading}</h3><p className="mt-3 whitespace-pre-line text-sm leading-8 text-stone-300">{scene.body}</p></section>)}<a href={storyCaseFileURL('pilot.fountain')} className="mt-6 inline-block rounded-xl border border-stone-500 px-4 py-3 text-sm text-white">下载完整首集展示稿 · Fountain</a></article>
        <article className="rounded-3xl border border-stone-200 bg-white p-8"><h2 className="text-2xl font-semibold text-ink">首集分镜：六镜头与试制边界</h2><ol className="mt-5 space-y-5 text-sm leading-7 text-stone-600">{shots.map((shot, index) => <li key={shot.id}><h3 className="font-semibold text-ink">镜头 {index + 1} · {shot.frame} · {shot.sceneId}</h3><p>{shot.action}</p><p className="mt-1 text-xs leading-6 text-stone-500">来源：{shot.sourceChapterIds.join('、')}；{shot.sourceNote}</p></li>)}</ol><p className="mt-5 text-xs leading-6 text-stone-500">一个渡口、两名角色与道具；三场调度不表示三个制作地点。没有图片、配音、视频或实际时长，不把示意分镜当成成片。</p><a href={storyCaseFileURL('storyboard.csv')} className="mt-6 inline-block rounded-xl border border-stone-300 px-4 py-3 text-sm font-medium text-ink">下载六镜头展示表 · CSV</a></article>
      </section>

      <section id="handoff" className="mt-12 scroll-mt-8 rounded-3xl border border-stone-200 bg-white p-8"><h2 className="text-2xl font-semibold text-ink">结构化展示稿：成果与缺口一起交付</h2><div className="mt-6 grid gap-6 md:grid-cols-2"><div><h3 className="font-semibold text-ink">这份展示稿包含</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-stone-600">{STORY_CASE.handoff.included.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3 className="font-semibold text-ink">仍未验证／制作</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-stone-600">{STORY_CASE.handoff.missing.map((item) => <li key={item}>{item}</li>)}</ul></div></div><a href={storyCaseFileURL('adaptation-demo.json')} className="mt-6 inline-block rounded-xl bg-ink px-5 py-3 text-sm font-medium text-white">{STORY_CASE_ARTIFACTS[3].label} · JSON</a><p className="mt-4 text-xs leading-6 text-stone-500">版本：{STORY_CASE.revision}。JSON是本站作者展示资料，不是DramaIP项目包、Runtime交付或正式采用回执；下载不表示公开／改编／发行授权已核验。文学质量与发行结论仍未建立。</p></section>

      <section className="mt-12 rounded-3xl border border-amber-200 bg-amber-50 p-8"><h2 className="text-xl font-semibold text-ink">上游变更与局部影响示例</h2><p className="mt-4 leading-7 text-stone-700">若作者把第一章“拇指遮住日期”改成“公告日期被雨水冲淡”，只应复核该疑点对应的诊断、第 1 集和镜头 3；第二章托付与其他镜头不应被全量重做。实际来源映射、失效与恢复需在 Runtime 验收，本页只解释目标行为。</p></section>
      <Link href="/cases" className="mt-10 inline-block"><Button variant="secondary">返回创作案例</Button></Link>
    </main>
  )
}
