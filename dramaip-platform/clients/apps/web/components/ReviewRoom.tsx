'use client'

import { useMutation } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import type { ReviewPackage } from '@dramaip/sdk'
import { apiClient } from '../lib/api-client'
import { formatApiError } from '../lib/api-error'
import { Button } from './ui/Button'

type ManifestMedia = {
  id: string
  shotId: string
  orderIndex: number
  label: string
  relativePath: string
  mimeType: string
  durationSeconds?: number
}
type ReviewManifest = { format: 'dramaip-review'; version: 1; packageId: string; title: string; media: ManifestMedia[] }

export function ReviewRoom({ token }: { token: string }) {
  const [pin, setPin] = useState('')
  const [activePIN, setActivePIN] = useState('')
  const [reviewPackage, setReviewPackage] = useState<ReviewPackage>()
  const [selectedID, setSelectedID] = useState('')
  const [author, setAuthor] = useState('')
  const [comment, setComment] = useState('')
  const [timecode, setTimecode] = useState(0)
  const [notice, setNotice] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  const load = useMutation({
    mutationFn: () => apiClient.getPublicReview({ token, pin }),
    onSuccess: (result) => {
      setActivePIN(pin)
      setReviewPackage(result.package)
      setSelectedID(parseManifest(result.package)?.media[0]?.id ?? '')
    },
  })
  const manifest = useMemo(() => parseManifest(reviewPackage), [reviewPackage])
  const selectedManifest = manifest?.media.find((item) => item.id === selectedID) ?? manifest?.media[0]
  const selectedMedia = reviewPackage?.media.find((item) => item.id === selectedManifest?.id || item.relative_path === selectedManifest?.relativePath)

  const commentMutation = useMutation({
    mutationFn: (clientID: string) => apiClient.submitPublicReviewComment({
      token,
      pin: activePIN,
      client_id: clientID,
      shot_id: selectedManifest?.shotId ?? '',
      timecode_seconds: timecode,
      author_alias: author.trim() || '审片人',
      body: comment.trim(),
    }),
    onSuccess: () => { setComment(''); setNotice('评论已同步到制作端。') },
  })
  const decisionMutation = useMutation({
    mutationFn: (input: { clientID: string; decision: 'approve' | 'return' | 'request_changes' }) => apiClient.submitPublicReviewDecision({
      token,
      pin: activePIN,
      client_id: input.clientID,
      shot_id: selectedManifest?.shotId ?? '',
      decision: input.decision,
      author_alias: author.trim() || '审片人',
      note: comment.trim(),
    }),
    onSuccess: (_, input) => setNotice(`已提交「${decisionLabel(input.decision)}」。`),
  })
  const error = load.error ?? commentMutation.error ?? decisionMutation.error

  if (!reviewPackage || !manifest) {
    return (
      <main className="mx-auto grid min-h-[calc(100vh-73px)] max-w-lg place-items-center px-5 py-16">
        <section className="w-full rounded-3xl border border-stone-200 bg-white p-8 shadow-studio">
          <p className="eyebrow">Private review</p>
          <h1 className="mt-4 text-3xl font-semibold text-ink">打开审片包</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">此页面无需账户。若制作方设置了 PIN，请在下方输入；访问 token 不会放入 API 查询参数。</p>
          <form className="mt-7 space-y-4" onSubmit={(event) => { event.preventDefault(); load.mutate() }}>
            <label className="grid gap-2 text-sm font-medium text-stone-700">
              审片 PIN（可选）
              <input inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="one-time-code" className="h-12 rounded-xl border border-stone-300 px-4 font-mono tracking-[.25em]" value={pin} onChange={(event) => setPin(event.target.value)} />
            </label>
            <Button className="h-12 w-full" disabled={load.isPending}>{load.isPending ? '正在验证...' : '进入审片'}</Button>
          </form>
          {load.error ? <p className="mt-4 text-sm text-rose-700" role="alert">{formatApiError(load.error, '链接无效、已撤销、已过期或 PIN 不正确。')}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#1d1d1c] text-white">
      <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs uppercase tracking-[.16em] text-[#e98765]">Anonymous review</p><h1 className="mt-1 text-xl font-semibold">{reviewPackage.title}</h1></div>
          <div className="text-xs text-stone-400">{manifest.media.length} 镜头 · {new Date(reviewPackage.expires_at).toLocaleDateString('zh-CN')} 到期</div>
        </header>
        <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_320px]">
          <nav aria-label="镜头列表" className="flex gap-2 overflow-x-auto rounded-2xl bg-black/25 p-2 lg:block lg:space-y-2">
            {manifest.media.map((item) => (
              <button key={item.id} type="button" onClick={() => { setSelectedID(item.id); setTimecode(0); setNotice('') }} className={`min-w-32 rounded-xl border p-3 text-left text-xs transition lg:w-full ${item.id === selectedManifest?.id ? 'border-[#e98765] bg-[#5b382c] text-white' : 'border-stone-700 bg-[#292928] text-stone-400 hover:border-stone-500'}`}>
                <span className="block font-mono text-[10px]">{String(item.orderIndex + 1).padStart(2, '0')} · {item.shotId}</span>
                <span className="mt-1 block truncate">{item.label}</span>
              </button>
            ))}
          </nav>

          <section className="min-w-0">
            <div className="grid aspect-video place-items-center overflow-hidden rounded-2xl bg-black">
              {selectedMedia?.mime_type.startsWith('video/') ? (
                <video ref={videoRef} className="max-h-full max-w-full" src={selectedMedia.download_url} controls onTimeUpdate={(event) => setTimecode(event.currentTarget.currentTime)} />
              ) : selectedMedia?.mime_type.startsWith('image/') ? (
                // Signed media URLs are short lived and originate from the configured private object store.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="max-h-full max-w-full object-contain" src={selectedMedia.download_url} alt={selectedManifest?.label ?? '审片镜头'} />
              ) : <p className="text-sm text-stone-500">此媒体格式无法在浏览器预览。</p>}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-stone-400">
              <span>{selectedManifest?.shotId} · {selectedManifest?.label}</span>
              <span className="font-mono">{formatTimecode(timecode)}</span>
            </div>
          </section>

          <aside className="rounded-2xl bg-[#292928] p-5">
            <h2 className="font-semibold">审片意见</h2>
            <label className="mt-5 grid gap-2 text-xs text-stone-400">
              显示名称
              <input maxLength={80} className="h-10 rounded-xl border border-stone-600 bg-[#1d1d1c] px-3 text-sm text-white" placeholder="审片人" value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
            <label className="mt-4 grid gap-2 text-xs text-stone-400">
              镜头意见
              <textarea maxLength={4000} rows={6} className="rounded-xl border border-stone-600 bg-[#1d1d1c] p-3 text-sm leading-6 text-white" placeholder={`意见将定位到 ${formatTimecode(timecode)}`} value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>
            <Button className="mt-4 w-full !bg-[#e98765] !text-ink" disabled={!comment.trim() || commentMutation.isPending} onClick={() => commentMutation.mutate(randomID())}>提交时间码评论</Button>
            <div className="mt-6 border-t border-stone-700 pt-5">
              <p className="text-xs text-stone-400">镜头决定</p>
              <div className="mt-3 grid gap-2">
                <Button variant="secondary" onClick={() => decisionMutation.mutate({ clientID: randomID(), decision: 'approve' })}>通过</Button>
                <Button variant="secondary" onClick={() => decisionMutation.mutate({ clientID: randomID(), decision: 'request_changes' })}>要求修改</Button>
                <Button variant="secondary" onClick={() => decisionMutation.mutate({ clientID: randomID(), decision: 'return' })}>退回</Button>
              </div>
            </div>
            {notice ? <p className="mt-4 rounded-xl bg-emerald-950 p-3 text-sm text-emerald-200" role="status">{notice}</p> : null}
            {error ? <p className="mt-4 text-sm text-rose-300" role="alert">{formatApiError(error, '提交失败，请检查链接状态后重试。')}</p> : null}
          </aside>
        </div>
      </div>
    </main>
  )
}

function parseManifest(reviewPackage?: ReviewPackage): ReviewManifest | undefined {
  if (!reviewPackage) return undefined
  try {
    const value = JSON.parse(reviewPackage.manifest_json) as ReviewManifest
    if (value.format !== 'dramaip-review' || value.version !== 1 || !Array.isArray(value.media)) return undefined
    return value
  } catch {
    return undefined
  }
}
function randomID() { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}` }
function formatTimecode(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
function decisionLabel(value: string) { return ({ approve: '通过', return: '退回', request_changes: '要求修改' } as Record<string, string>)[value] ?? value }
