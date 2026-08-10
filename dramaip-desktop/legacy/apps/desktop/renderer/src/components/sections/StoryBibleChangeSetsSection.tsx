// LM5-05：故事圣经的统一审阅入口。AI 只产生草案，采用才会事务化写入各实体。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CirclePause, FileClock, Loader2, RotateCcw, Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Chapter, StoryBibleChangeSet, StoryBibleSettings } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

type StaleMark = Awaited<ReturnType<typeof ipc.storyBible.listStaleMarks>>[number]

const STATUS_LABEL: Record<StoryBibleChangeSet['status'], string> = {
  queued: '待生成', draft: '待确认', applied: '已采用', stale: '已过期', paused: '已暂停', failed: '失败', skipped: '已跳过', discarded: '已撤销',
}

function formatEstimate(changeSet: StoryBibleChangeSet): string {
  const tokens = changeSet.estimatedTokens ? `约 ${changeSet.estimatedTokens.toLocaleString()} tokens` : 'Token 预估未知'
  if (changeSet.estimatedCost === undefined) return `${tokens} · 费用未知`
  return `${tokens} · 约 ${changeSet.currency ?? ''} ${changeSet.estimatedCost}`.trim()
}

function diffCounts(changeSet: StoryBibleChangeSet): string[] {
  const payload = changeSet.payload
  if (!payload) return []
  return [
    payload.memories.length && `记忆 +${payload.memories.length}`,
    payload.characterStates.length && `人物状态 +${payload.characterStates.length}`,
    payload.storyEvents.length && `事件 +${payload.storyEvents.length}`,
    payload.foreshadowings.length && `伏笔 ${payload.foreshadowings.map((x) => x.action === 'resolve' ? '回收' : '新增').join('/')}`,
    payload.visualSettings.length && `视觉设定 +${payload.visualSettings.length}`,
  ].filter(Boolean) as string[]
}

function diffItems(changeSet: StoryBibleChangeSet): Array<{ label: string; detail: string }> {
  const payload = changeSet.payload
  if (!payload) return []
  return [
    ...payload.memories.map((item) => ({ label: '新增记忆', detail: item.summary })),
    ...payload.characterStates.map((item) => ({ label: '新增人物状态', detail: item.currentStatus })),
    ...payload.storyEvents.map((item) => ({ label: '新增事件', detail: item.title })),
    ...payload.foreshadowings.map((item) => ({ label: item.action === 'resolve' ? '回收伏笔' : '新增伏笔', detail: item.title })),
    ...payload.visualSettings.map((item) => ({ label: '新增视觉锚点', detail: item.title })),
  ]
}

export function StoryBibleChangeSetsSection({ projectId, chapter }: { projectId: string; chapter: Chapter | null }) {
  const [settings, setSettings] = useState<StoryBibleSettings | null>(null)
  const [changeSets, setChangeSets] = useState<StoryBibleChangeSet[]>([])
  const [staleMarks, setStaleMarks] = useState<StaleMark[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [nextSettings, nextChangeSets, nextStaleMarks] = await Promise.all([
      ipc.storyBible.getSettings(projectId),
      ipc.storyBible.listChangeSets(projectId),
      ipc.storyBible.listStaleMarks(projectId),
    ])
    setSettings(nextSettings)
    setChangeSets(nextChangeSets)
    setStaleMarks(nextStaleMarks)
  }, [projectId])

  useEffect(() => { void reload() }, [reload])

  const staleChapterIds = useMemo(() => [...new Set(staleMarks.map((mark) => mark.chapterId))], [staleMarks])

  async function queue(chapterId: string) {
    setBusyId(`queue:${chapterId}`)
    try {
      const result = await ipc.storyBible.queueChangeSet({ projectId, chapterId })
      toast.success(result.status === 'draft' ? '该版本已有待确认的变更包' : '已加入故事圣经建议队列')
      await reload()
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法加入建议队列')
      return undefined
    } finally {
      setBusyId(null)
    }
  }

  async function generate(changeSet: StoryBibleChangeSet) {
    setBusyId(changeSet.id)
    const loading = toast.loading('正在生成可审查的故事圣经变更包…')
    try {
      if (changeSet.status === 'paused') await ipc.storyBible.setChangeSetStatus(changeSet.id, 'queued')
      const result = await ipc.ai.run({ projectId, chapterId: changeSet.chapterId, taskType: 'propose_story_bible_changes' })
      if (!result.ok) {
        await ipc.storyBible.failChangeSet(changeSet.id, result.error ?? '模型未返回可用变更包')
        toast.error(`生成失败：${result.error ?? '未知错误'}`, { id: loading })
      } else {
        toast.success('变更包已生成，请核对差异后采用', { id: loading })
      }
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  async function apply(changeSet: StoryBibleChangeSet) {
    setBusyId(changeSet.id)
    try {
      await ipc.storyBible.applyChangeSet(changeSet.id)
      toast.success('已一次采用：记忆、人物状态、时间线、伏笔与视觉设定已同步更新')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采用失败')
    } finally {
      setBusyId(null)
    }
  }

  async function undo(changeSet: StoryBibleChangeSet) {
    setBusyId(changeSet.id)
    try {
      await ipc.storyBible.undoChangeSet(changeSet.id)
      toast.success('已撤销该变更包创建的记录；原章节和既有手写记录未受影响')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '撤销失败')
    } finally {
      setBusyId(null)
    }
  }

  async function queueStaleRange() {
    for (const chapterId of staleChapterIds) await queue(chapterId)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">故事圣经变更</h2>
          <p className="text-xs text-muted-foreground">先看差异，再一次确认；不会静默覆盖已有设定。</p>
        </div>
        <Badge variant="secondary">{changeSets.filter((item) => item.status === 'draft').length} 待确认</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={settings?.autoSuggest ? 'secondary' : 'outline'}
            aria-pressed={settings?.autoSuggest ?? false}
            onClick={async () => {
              const next = await ipc.storyBible.updateSettings(projectId, { autoSuggest: !(settings?.autoSuggest ?? false) })
              setSettings(next)
              toast.success(next.autoSuggest ? '已开启：稳定保存后只排队建议，不会自动采用' : '已关闭自动建议')
            }}
          >
            <FileClock />
            {settings?.autoSuggest ? '自动建议：开' : '自动建议：关'}
          </Button>
          <Button size="sm" onClick={() => chapter && void queue(chapter.id)} disabled={!chapter || busyId === `queue:${chapter?.id}`}>
            {busyId === `queue:${chapter?.id}` ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {chapter ? '为本章生成建议' : '先选择章节'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {staleChapterIds.length > 0 && (
            <div className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm">
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {staleChapterIds.length} 章的故事圣经或诊断需要回填</div>
              <p className="mt-1 text-xs text-muted-foreground">正文更新后，旧建议不会再被当作最新结果；可按章处理或把当前过期范围加入队列。</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void queueStaleRange()} disabled={busyId !== null}>
                <RotateCcw /> 按当前范围重新排队
              </Button>
            </div>
          )}

          {changeSets.length === 0 ? (
            <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              选择已完成的章节并生成建议。系统会先展示摘要、人物变化、关系/秘密、时间线、伏笔和视觉连续性差异，再由你确认写入。
            </div>
          ) : changeSets.map((changeSet) => {
            const running = busyId === changeSet.id
            const diffs = diffCounts(changeSet)
            const items = diffItems(changeSet)
            return (
              <article key={changeSet.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={changeSet.status === 'draft' ? 'default' : changeSet.status === 'failed' || changeSet.status === 'stale' ? 'destructive' : 'secondary'}>{STATUS_LABEL[changeSet.status]}</Badge>
                  <span className="text-xs text-muted-foreground">{formatEstimate(changeSet)}</span>
                  {changeSet.taskId && <span className="text-xs text-muted-foreground">任务已记录</span>}
                  <div className="ml-auto flex flex-wrap gap-2">
                    {changeSet.status === 'queued' || changeSet.status === 'paused' || changeSet.status === 'failed' ? (
                      <Button size="sm" onClick={() => void generate(changeSet)} disabled={running}>
                        {running ? <Loader2 className="animate-spin" /> : <Sparkles />} {changeSet.status === 'failed' ? '重试生成' : '生成草案'}
                      </Button>
                    ) : null}
                    {changeSet.status === 'queued' ? <Button size="sm" variant="outline" onClick={() => void ipc.storyBible.setChangeSetStatus(changeSet.id, 'paused').then(reload)}><CirclePause />暂停</Button> : null}
                    {changeSet.status === 'draft' ? <Button size="sm" onClick={() => void apply(changeSet)} disabled={running || changeSet.conflicts.length > 0}><Check />一次采用</Button> : null}
                    {(changeSet.status === 'applied' || changeSet.status === 'stale') ? <Button size="sm" variant="outline" onClick={() => void undo(changeSet)} disabled={running}><Undo2 />撤销</Button> : null}
                  </div>
                </div>
                {changeSet.payload && <>
                  <p className="mt-2 text-sm">{changeSet.payload.summary}</p>
                  {diffs.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{diffs.map((diff) => <Badge key={diff} variant="outline">{diff}</Badge>)}</div>}
                  {items.length > 0 && <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{items.map((item, index) => <li key={`${item.label}-${item.detail}-${index}`}><span className="mr-1 text-foreground">{item.label}</span>{item.detail}</li>)}</ul>}
                </>}
                {changeSet.conflicts.length > 0 && <div className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">存在 {changeSet.conflicts.length} 项冲突：{changeSet.conflicts.map((item) => item.detail).join('；')}。为保护已有手写设定，本包不能直接采用。</div>}
                {changeSet.errorMessage && <p className="mt-2 text-xs text-destructive">失败明细：{changeSet.errorMessage}</p>}
              </article>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
