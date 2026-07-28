import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '../../components/ui/Button'

export const metadata: Metadata = { title: '下载' }

const releaseURL = process.env.NEXT_PUBLIC_DESKTOP_RELEASE_URL
const releaseVersion = process.env.NEXT_PUBLIC_DESKTOP_VERSION ?? '2.0.0-rc.1'
const releaseSHA256 = process.env.NEXT_PUBLIC_DESKTOP_SHA256
const isReleaseReady = Boolean(releaseURL && releaseSHA256 && !releaseURL?.includes('example.invalid'))

const platforms = [
  { name: 'macOS', build: 'Universal · DMG / ZIP', state: isReleaseReady ? '签名与公证状态见发布清单' : '等待 Developer ID 签名与公证证据' },
  { name: 'Windows', build: 'x64 · NSIS / ZIP', state: isReleaseReady ? '签名状态见发布清单' : '等待受信代码签名证据' },
  { name: 'Linux Beta', build: 'x64 · AppImage / deb', state: isReleaseReady ? 'Beta smoke 已记录' : '等待 Beta smoke 证据' },
]

export default function DownloadPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Desktop release</p>
      <div className="mt-4 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight text-ink">下载 DramaIP Studio</h1>
          <p className="mt-5 max-w-2xl leading-7 text-stone-600">无需登录、密钥或网络，先用内置样片跑通导演工作台、离线审片和标准交付。</p>
        </div>
        <span className={`w-fit rounded-full px-4 py-2 text-sm font-semibold ${isReleaseReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
          {isReleaseReady ? `v${releaseVersion}` : `v${releaseVersion} · RC 门禁中`}
        </span>
      </div>

      {!isReleaseReady ? (
        <section className="mt-10 rounded-3xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h2 className="font-semibold">安装包尚未通过 GA 门禁</h2>
          <p className="mt-2 text-sm leading-6">正式 HTTPS 更新源、SHA-256 与平台签名证据尚未注入当前部署。页面保持 RC 状态，不提供未经验证的下载链接。</p>
        </section>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {platforms.map((platform) => (
          <article key={platform.name} className="flex min-h-64 flex-col rounded-3xl border border-stone-200 bg-white p-6">
            <h2 className="text-2xl font-semibold text-ink">{platform.name}</h2>
            <p className="mt-3 text-sm text-stone-600">{platform.build}</p>
            <p className="mt-8 text-sm leading-6 text-stone-500">{platform.state}</p>
            <div className="mt-auto pt-8">
              {isReleaseReady && releaseURL ? <a href={releaseURL} target="_blank" rel="noreferrer"><Button className="w-full">前往官方下载</Button></a> : <Button className="w-full" disabled>门禁通过后开放</Button>}
            </div>
          </article>
        ))}
      </div>

      <section className="mt-8 grid gap-px overflow-hidden rounded-3xl border border-stone-200 bg-stone-200 sm:grid-cols-3">
        <ReleaseFact label="版本" value={releaseVersion} />
        <ReleaseFact label="SHA-256" value={releaseSHA256 ?? '未发布'} mono />
        <ReleaseFact label="系统要求" value="macOS 13+ · Windows 10+ · Linux Beta" />
      </section>

      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link className="font-medium text-rust hover:underline" href="/cases/demo">查看内置样片 →</Link>
        <Link className="font-medium text-rust hover:underline" href="/trust">了解本地数据边界 →</Link>
      </div>
    </main>
  )
}

function ReleaseFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="bg-white p-6"><div className="text-xs uppercase tracking-wider text-stone-400">{label}</div><div className={`mt-2 break-all text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</div></div>
}
