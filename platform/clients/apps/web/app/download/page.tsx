import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '../../components/ui/Button'
import { desktopReleaseInfo, PRODUCT_POSITIONING } from '../../lib/product-positioning'

export const metadata: Metadata = { title: '下载' }

const release = desktopReleaseInfo({
  url: process.env.NEXT_PUBLIC_DESKTOP_RELEASE_URL,
  version: process.env.NEXT_PUBLIC_DESKTOP_VERSION,
  sha256: process.env.NEXT_PUBLIC_DESKTOP_SHA256,
})
const releaseURL = release.url
const releaseVersion = release.version ?? '未配置'
const releaseSHA256 = release.sha256
const isReleaseConfigured = release.configured

const platforms = [
  { name: 'macOS', build: 'Universal · DMG / ZIP', state: isReleaseConfigured ? '签名与公证状态见发布清单' : '等待 Developer ID 签名与公证证据' },
  { name: 'Windows', build: 'x64 · NSIS / ZIP', state: isReleaseConfigured ? '签名状态见发布清单' : '等待受信代码签名证据' },
  { name: 'Linux Beta', build: 'x64 · AppImage / deb', state: isReleaseConfigured ? 'Beta smoke 状态见发布清单' : '等待 Beta smoke 证据' },
]

export default function DownloadPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
      <p className="eyebrow">Desktop release</p>
      <div className="mt-4 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight text-ink">下载尽意 DramaIP</h1>
          <p className="mt-5 max-w-2xl leading-7 text-stone-600">{PRODUCT_POSITIONING.category}。小说可独立写作与稿件交付，也可从创意、原著或已有剧本进入改编。模型生成需要连接与授权；离线样片不需要模型密钥，不代表离线 AI 能力。</p>
        </div>
        <span className={`w-fit rounded-full px-4 py-2 text-sm font-semibold ${isReleaseConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
          {release.version ? `v${releaseVersion} · 发布验收状态见清单` : '候选发布信息未配置'}
        </span>
      </div>

      {!isReleaseConfigured ? (
        <section className="mt-10 rounded-3xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h2 className="font-semibold">发布验收状态尚未确认</h2>
          <p className="mt-2 text-sm leading-6">当前部署尚未提供完整有效的 HTTPS 下载地址、版本与 SHA-256。这里不推断发布版本或签名结果，不提供未经配置校验的下载链接。配置完整也不等于三平台 GA，安装、升级、签名与公证证据仍以当次发布清单为准。</p>
        </section>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {platforms.map((platform) => (
          <article key={platform.name} className="flex min-h-64 flex-col rounded-3xl border border-stone-200 bg-white p-6">
            <h2 className="text-2xl font-semibold text-ink">{platform.name}</h2>
            <p className="mt-3 text-sm text-stone-600">{platform.build}</p>
            <p className="mt-8 text-sm leading-6 text-stone-500">{platform.state}</p>
            <div className="mt-auto pt-8">
              {isReleaseConfigured && releaseURL ? <a href={releaseURL} target="_blank" rel="noreferrer"><Button className="w-full">前往官方下载</Button></a> : <Button className="w-full" disabled>门禁通过后开放</Button>}
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
