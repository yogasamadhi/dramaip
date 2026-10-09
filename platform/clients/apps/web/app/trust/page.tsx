import type { Metadata } from 'next'

export const metadata: Metadata = { title: '信任中心' }

const boundaries = [
  ['Desktop 本地空间', 'Desktop 的项目原文、灵感对话、长期记忆、API Key、权利证明原件、源素材和生产母版不会自动同步到云端。'],
  ['Web 灵感空间', '登录后创建的云端创意会话、摘要和灵感卡片会持久化到账号；长期记忆仅在单独授权后跨会话启用，可查看、停用或清空。'],
  ['公共创意语料', '只采集允许公开访问且符合站点规则的网页；正文加密暂存最长 7 天，长期仅保留来源、哈希、短摘录和抽象创作机制，并支持权利投诉与下架。'],
  ['个人创意指纹', '与长期记忆分开授权，只学习你明确采用、拒绝、评分或保存的结果。可修正、冻结、暂停或清空，不用于训练平台模型。'],
  ['只在你主动调用时发送给 Provider', '生成所需的 Prompt、参考资产和遮罩；具体地区、留存、训练政策在调用前展示。'],
  ['只在主动发布云审片时上传', '严格审片 manifest、最高 540×960 的 H.264/AAC 代理、最长边 1080 px 的图片、缩略图与评论。'],
  ['匿名产品分析（默认关闭）', '仅随机安装标识、版本、OS、白名单事件、耗时区间与标准错误码；撤回后清空待发送队列。'],
]

export default function TrustPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Trust is a production feature</p>
      <h1 className="mt-4 max-w-4xl text-5xl font-semibold tracking-tight text-ink">清楚知道什么留在本地，<br />什么会被发送，以及为什么。</h1>
      <p className="mt-6 max-w-3xl leading-7 text-stone-600">尽意 DramaIP Desktop 采用本地优先和 BYOK；Web 灵感空间则按云端账号持久化。提示词、记忆正文、私人收藏、创意指纹和模型响应不会进入管理员视图、应用日志或异常文本，也不会用于训练平台模型。跨端只通过用户确认的 schema v4 创作简报包衔接。</p>
      <p className="mt-4 max-w-3xl leading-7 text-stone-600">本地优先描述作品与记录的归属，不等于离线模型推理。小说可以独立形成稿件，不要求媒体或云审片。规则分数、模型评议和观众模拟不证明文学质量、真实受众留存、必然能拍或商业爆款；优化中的改编诊断、整季方案与统一试制包按阶段验收。</p>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {boundaries.map(([title, description], index) => (
          <article key={title} className="rounded-3xl border border-stone-200 bg-white p-7">
            <div className="font-mono text-xs text-rust">BOUNDARY {index + 1}</div>
            <h2 className="mt-5 text-xl font-semibold text-ink">{title}</h2>
            <p className="mt-3 text-sm leading-7 text-stone-600">{description}</p>
          </article>
        ))}
      </div>

      <section className="mt-12 overflow-hidden rounded-3xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 p-7"><h2 className="text-2xl font-semibold text-ink">云审片安全边界</h2></div>
        <dl className="grid gap-px bg-stone-200 md:grid-cols-3">
          <Fact term="访问" detail="256 位随机 token；数据库只存 SHA-256。可选 PIN、即时撤销、访问限速。" />
          <Fact term="存储" detail="私有 S3 兼容 Bucket；媒体只通过短期签名 URL 访问，Bucket 永不公开。" />
          <Fact term="清理" detail="Studio 默认且最长 30 天。到期删除对象与敏感元数据，仅保留最小审计记录。" />
        </dl>
      </section>
    </main>
  )
}

function Fact({ term, detail }: { term: string; detail: string }) {
  return <div className="bg-white p-7"><dt className="font-semibold text-ink">{term}</dt><dd className="mt-3 text-sm leading-7 text-stone-600">{detail}</dd></div>
}
