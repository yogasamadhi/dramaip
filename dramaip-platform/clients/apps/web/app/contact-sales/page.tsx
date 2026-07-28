import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Enterprise 联系销售' }

export default function ContactSalesPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-20 lg:px-8">
      <p className="eyebrow">Enterprise</p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink">把组织边界带进生产工作流。</h1>
      <p className="mt-6 leading-7 text-stone-600">Enterprise 支持合同约定的席位、文本额度、审片容量、保留期与私有模型网关，不开放自助结账。</p>
      <section className="mt-10 rounded-3xl border border-stone-200 bg-white p-7">
        <h2 className="text-xl font-semibold text-ink">销售联系入口尚未配置</h2>
        <p className="mt-3 text-sm leading-7 text-stone-600">当前部署未设置正式销售工单地址。配置 <code className="rounded bg-stone-100 px-1">NEXT_PUBLIC_SALES_CONTACT_URL</code> 后才会对外开放提交，避免咨询内容发送到占位地址。</p>
      </section>
    </main>
  )
}
