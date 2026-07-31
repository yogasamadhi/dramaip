import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, GripVertical, ImageOff, Timer } from 'lucide-react'
import type { ProjectAsset, Shot } from '@sdns/core'
import { assetReferenceUrl, isVideoReferenceImageAsset } from '@/lib/assets'
import { moveStoryboardShot, nudgeStoryboardShot } from '@/lib/storyboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface StoryboardCanvasProps {
  shots: Shot[]
  activeShotId?: string | null
  assetsByShot: Record<string, ProjectAsset[]>
  busy?: boolean
  onSelect: (shotId: string) => void
  onReorder: (orderedIds: string[]) => Promise<void>
}

const DIFFICULTY_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  low: 'secondary',
  medium: 'outline',
  high: 'destructive',
}

/** 可键盘操作、原生拖放并使用 FLIP 位移动画的单场景 Storyboard。 */
export function StoryboardCanvas({ shots, activeShotId, assetsByShot, busy = false, onSelect, onReorder }: StoryboardCanvasProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const previousRects = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>()
    for (const shot of shots) {
      const node = nodes.current.get(shot.id)
      if (!node) continue
      const next = node.getBoundingClientRect()
      const previous = previousRects.current.get(shot.id)
      if (previous && (previous.left !== next.left || previous.top !== next.top) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.animate(
          [
            { transform: `translate(${previous.left - next.left}px, ${previous.top - next.top}px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
        )
      }
      nextRects.set(shot.id, next)
    }
    previousRects.current = nextRects
  }, [shots])

  async function reorder(next: string[]) {
    if (next.every((id, index) => id === shots[index]?.id)) return
    await onReorder(next)
  }

  return (
    <section className="rounded-lg border bg-muted/[0.12] p-3" data-storyboard-canvas>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-sm font-semibold">Storyboard</h2>
          <p className="text-xs text-muted-foreground">拖拽镜头调整顺序；也可选中后按 Alt+←/→。顺序会立即写入交付数据。</p>
        </div>
        <Badge variant="secondary" className="ml-auto">{shots.length} 镜头</Badge>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3" role="list" aria-label="当前场景 Storyboard">
        {shots.map((shot, index) => {
          const assets = assetsByShot[shot.id] ?? []
          const image = assets.find(isVideoReferenceImageAsset)
          const imageUrl = image ? assetReferenceUrl(image) : undefined
          const active = shot.id === activeShotId
          return (
            <article
              key={shot.id}
              ref={(node) => { if (node) nodes.current.set(shot.id, node); else nodes.current.delete(shot.id) }}
              role="listitem"
              tabIndex={0}
              draggable={!busy}
              aria-current={active ? 'true' : undefined}
              data-storyboard-shot={shot.id}
              className={cn('group relative overflow-hidden rounded-md border bg-background text-left shadow-sm outline-none transition-colors transform-gpu hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none', active && 'border-primary ring-1 ring-primary/40', draggingId === shot.id && 'opacity-55')}
              onClick={() => onSelect(shot.id)}
              onDragStart={(event) => {
                if (busy) return
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', shot.id)
                setDraggingId(shot.id)
              }}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => { if (draggingId && draggingId !== shot.id) event.preventDefault() }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain') || draggingId
                if (sourceId) void reorder(moveStoryboardShot(shots.map((item) => item.id), sourceId, shot.id))
                setDraggingId(null)
              }}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
                event.preventDefault()
                void reorder(nudgeStoryboardShot(shots.map((item) => item.id), shot.id, event.key === 'ArrowLeft' ? -1 : 1))
              }}
            >
              <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-primary/25 via-muted to-iris/15">
                {imageUrl ? (
                  <img src={imageUrl} alt={`镜头 ${index + 1} ${image?.title ?? '素材缩略图'}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col justify-end p-3 text-xs text-muted-foreground"><ImageOff className="mb-auto h-5 w-5 opacity-70" /><span className="line-clamp-2">{shot.visualDescription || '待补画面描述'}</span></div>
                )}
                <div className="absolute left-2 top-2 flex items-center gap-1.5">
                  <Badge variant="secondary">{String(index + 1).padStart(2, '0')}</Badge>
                  {shot.aiVideoDifficulty && <Badge variant={DIFFICULTY_VARIANT[shot.aiVideoDifficulty]}>{shot.aiVideoDifficulty}</Badge>}
                </div>
              </div>
              <div className="space-y-1.5 p-2.5">
                <div className="flex items-start gap-1.5"><GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><p className="line-clamp-2 text-xs font-medium">{shot.visualDescription || '未填写画面描述'}</p></div>
                <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {shot.cameraAngle && <span>{shot.cameraAngle}</span>}
                  {shot.cameraMovement && <span>· {shot.cameraMovement}</span>}
                  {shot.durationSeconds && <span className="ml-auto inline-flex items-center gap-0.5"><Timer className="h-3 w-3" />{shot.durationSeconds}s</span>}
                </div>
                <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={busy || index === 0} onClick={(event) => { event.stopPropagation(); void reorder(nudgeStoryboardShot(shots.map((item) => item.id), shot.id, -1)) }} title="前移镜头"><ArrowLeft className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={busy || index === shots.length - 1} onClick={(event) => { event.stopPropagation(); void reorder(nudgeStoryboardShot(shots.map((item) => item.id), shot.id, 1)) }} title="后移镜头"><ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
