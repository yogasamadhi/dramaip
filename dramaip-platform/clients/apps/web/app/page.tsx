import Link from 'next/link'
import { ServiceStatus } from '../components/ServiceStatus'
import { Button } from '../components/ui/Button'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-6xl flex-col px-6 py-8">
      <section className="grid flex-1 content-center gap-8 py-20 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-brand-700">
            智能短剧创作平台
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-tight text-slate-950">
            把长篇故事转化为可制作的短剧 IP。
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            面向专业创作者的桌面端工作台、云端订阅、模型额度与移动灵感记录流程。
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/download">
              <Button>下载桌面端</Button>
            </Link>
            <Link href="/pricing">
              <Button variant="secondary">查看套餐</Button>
            </Link>
            <Link href="/register">
              <Button variant="secondary">创建账号</Button>
            </Link>
            <Link href="/chat">
              <Button variant="secondary">体验智能对话</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4">
          <ServiceStatus />
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">平台能力</div>
            <div className="mt-4 grid gap-3 text-sm text-slate-700">
              <div>桌面端工作台：本地优先的专业创作空间</div>
              <div>网页端：官网、订阅、账号中心</div>
              <div>移动端：轻量灵感记录</div>
              <div>平台服务：认证、计费、额度、智能网关</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
