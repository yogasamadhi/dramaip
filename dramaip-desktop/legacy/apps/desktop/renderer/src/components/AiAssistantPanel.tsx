import { useState } from 'react'
import { toast } from 'sonner'
import { Command, Sparkles, Loader2 } from 'lucide-react'
import type { Chapter, NovelTaskType, TextDiffPreviewPayload } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { TASK_TYPE_LABELS, TASK_WRITE_POLICIES } from '@sdns/core'
import {
  buildAiPreflightContext,
  type AiPreflightContextData,
} from '@/lib/aiPreflightContext'
import { useAiContextStore } from '@/stores/useAiContextStore'
import { toastAiError } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AiContextPreviewDialog } from '@/components/AiContextPreviewDialog'
import { shouldAutoAdoptChapterDraft } from '@/lib/textPreviewPolicy'
import { getChapterLengthStatus } from '@/lib/chapterLength'

interface AiAssistantPanelProps {
  projectId: string
  chapter: Chapter | null
  /** 当前编辑器设置的本章目标字数。 */
  chapterWordGoal: number
  /** 章节类任务完成后刷新章节（让编辑器载入新内容） */
  onChapterUpdated: (chapterId?: string) => Promise<void> | void
  /** 新建并切换到下一章；返回新章节供 AI 生成正文。 */
  onCreateNextChapter: () => Promise<Chapter | null>
  onTextPreview?: (preview: TextDiffPreviewPayload) => void
  /** 首次生成正文超出目标范围时，由工作台请求用户决定是否基于首稿调整。 */
  onChapterLengthMismatch?: (preview: TextDiffPreviewPayload, wordGoal: number) => void
  /** 流式生成时把累积内容实时推给编辑器显示（仅章节文本任务）。 */
  onStreamContent?: (event: { phase: 'start' | 'chunk' | 'end'; taskType: NovelTaskType; accumulated: string; chapterId?: string }) => void
  contextData?: AiPreflightContextData
}

const ACTIONS: { taskType: NovelTaskType; label: string; desc: string; variant: 'default' | 'outline' | 'secondary' }[] = [
  { taskType: 'generate_chapter', label: 'AI 生成正文', desc: '根据大纲生成本章正文', variant: 'default' },
  { taskType: 'polish_chapter', label: '润色', desc: '提升文字质感', variant: 'secondary' },
  { taskType: 'rewrite_chapter', label: '改写', desc: '按指令改写', variant: 'outline' },
  { taskType: 'enhance_conflict', label: '增强冲突', desc: '让矛盾更尖锐', variant: 'secondary' },
  { taskType: 'enhance_highlight', label: '增强爽点', desc: '放大打脸逆袭高潮', variant: 'secondary' },
  { taskType: 'enhance_ai_drama_feel', label: '增强 AI 短剧感', desc: '强化爽点与镜头感', variant: 'secondary' },
  { taskType: 'enhance_author_style', label: '作者风格强化', desc: '统一声口与句式节奏', variant: 'secondary' },
  // v0.3 AI 短剧小说强化
  { taskType: 'enhance_hook', label: '强化钩子', desc: '提升开篇与节点牵引', variant: 'secondary' },
  { taskType: 'enhance_reversal', label: '强化反转', desc: '增强反转与信息差爽感', variant: 'secondary' },
  { taskType: 'enhance_cliffhanger', label: '强化悬念', desc: '强化结尾追看钩子', variant: 'secondary' },
]

function recommendedActions(chapter: Chapter | null) {
  const taskTypes: NovelTaskType[] = chapter?.content.trim()
    ? ['polish_chapter', 'enhance_hook', 'enhance_conflict', 'enhance_highlight']
    : ['generate_chapter']
  return taskTypes.map((taskType) => ACTIONS.find((action) => action.taskType === taskType)).filter((action): action is typeof ACTIONS[number] => Boolean(action))
}

export function AiAssistantPanel({ projectId, chapter, chapterWordGoal, onChapterUpdated, onCreateNextChapter, onTextPreview, onChapterLengthMismatch, onStreamContent, contextData }: AiAssistantPanelProps) {
  const [running, setRunning] = useState<NovelTaskType | null>(null)
  const [instruction, setInstruction] = useState('')
  const contextControls = useAiContextStore((s) => s.contextControls)
  const setContextControls = useAiContextStore((s) => s.setControlMode)
  const [pendingTask, setPendingTask] = useState<NovelTaskType | null>(null)
  const [pendingNextChapter, setPendingNextChapter] = useState(false)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const actions = recommendedActions(chapter)
  const preflightTask = pendingNextChapter ? 'generate_chapter' : pendingTask
  const preflight = preflightTask && contextData ? buildAiPreflightContext(preflightTask, contextData, contextControls) : null

  async function runAction(taskType: NovelTaskType) {
    if (!chapter) {
      toast.error('请先选择或新建一个章节')
      return
    }
    if (contextData) {
      setPendingTask(taskType)
      return
    }
    await runActionNow(taskType)
  }

  async function runActionNow(taskType: NovelTaskType, targetChapter = chapter, userInstruction = instruction.trim() || undefined) {
    if (!targetChapter) {
      toast.error('请先选择或新建一个章节')
      return
    }
    setRunning(taskType)
    const label = TASK_TYPE_LABELS[taskType]
    const toastId = toast.loading(`正在执行：${label}…`)
    // 章节文本任务走流式：累积 token 实时推给编辑器显示，结束后仍走预览→采用。
    let accumulated = ''
    onStreamContent?.({ phase: 'start', taskType, accumulated: '', chapterId: targetChapter.id })
    try {
      const res = await ipc.ai.runStream(
        {
          projectId,
          chapterId: targetChapter.id,
          taskType,
          userInstruction,
          contextControls,
          chapterWordGoal,
        },
        (chunk) => {
          accumulated += chunk
          onStreamContent?.({ phase: 'chunk', taskType, accumulated, chapterId: targetChapter.id })
        },
        () => {
          accumulated = ''
          onStreamContent?.({ phase: 'chunk', taskType, accumulated, chapterId: targetChapter.id })
        },
      )
      if (res.ok) {
        if (res.result?.kind === 'text_preview') {
          const preview = res.result.data as TextDiffPreviewPayload
          const lengthStatus = preview.targetKind === 'chapter'
            ? getChapterLengthStatus(preview.nextContent, chapterWordGoal)
            : undefined
          if (lengthStatus && onChapterLengthMismatch) {
            // 字数确认弹窗已承载结果信息；必须关闭 loading toast，避免它在用户选择后仍残留转圈。
            toast.dismiss(toastId)
            onChapterLengthMismatch(preview, chapterWordGoal)
          } else if (shouldAutoAdoptChapterDraft(preview)) {
            const adopted = await ipc.ai.applyResult({ projectId, taskType, data: preview })
            if (!adopted.ok) {
              toast.error(`${label}写入失败：${adopted.error ?? '未知错误'}`, { id: toastId })
            } else {
              toast.success(`${label}完成，已写入空白章节`, { id: toastId })
              await onChapterUpdated(targetChapter.id)
            }
          } else {
            toast.success(`${label} 完成，预览后采用`, { id: toastId })
            onTextPreview?.(preview)
          }
        } else {
          const policy = TASK_WRITE_POLICIES[taskType]
          const savedText = policy.policy === 'snapshot_then_auto_write'
            ? '，已保存检查点并写入'
            : policy.policy === 'auto_write'
              ? '，已写入'
              : ''
          toast.success(`${label} 完成${savedText}`, { id: toastId })
          await onChapterUpdated(targetChapter.id)
        }
      } else {
        toastAiError({ message: res.error, id: toastId, retry: () => void runActionNow(taskType) })
      }
    } catch (e) {
      toastAiError({ message: e instanceof Error ? e.message : String(e), id: toastId, retry: () => void runActionNow(taskType) })
    } finally {
      // 无论成功或异常都必须结束流式态，否则编辑器会卡在只读。
      onStreamContent?.({ phase: 'end', taskType, accumulated, chapterId: targetChapter.id })
      setRunning(null)
    }
  }

  async function runNextChapterNow() {
    if (!chapter?.content.trim()) {
      toast.error('请先完成当前章节正文，再续写下一章')
      return
    }
    setRunning('generate_chapter')
    try {
      const nextChapter = await onCreateNextChapter()
      if (!nextChapter) {
        toast.error('新建下一章失败，请重试')
        return
      }
      // 等待编辑器切换到新章节，再开始推送流式正文。
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const continuationInstruction = [
        '请承接上一章结尾的情节，直接创作下一章正文，不要复述上一章。',
        `上一章《${chapter.title}》正文：\n${chapter.content.trim()}`,
        instruction.trim() ? `补充要求：\n${instruction.trim()}` : '',
      ].filter(Boolean).join('\n\n')
      await runActionNow('generate_chapter', nextChapter, continuationInstruction)
    } catch (error) {
      toast.error(`续写下一章失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRunning(null)
    }
  }

  async function runNextChapter() {
    if (!chapter?.content.trim()) {
      toast.error('请先完成当前章节正文，再续写下一章')
      return
    }
    if (contextData) {
      setPendingNextChapter(true)
      return
    }
    await runNextChapterNow()
  }

  async function executePendingTask() {
    if (!pendingTask && !pendingNextChapter) return
    setPreflightRunning(true)
    try {
      if (pendingNextChapter) await runNextChapterNow()
      else if (pendingTask) await runActionNow(pendingTask)
      setPendingTask(null)
      setPendingNextChapter(false)
    } finally {
      setPreflightRunning(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">AI 写作助手</h3>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-instruction">本次指令（可选）</Label>
        <Textarea
          id="ai-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="例如：让女主在结尾识破反派的陷阱…"
          className="h-20 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-2" aria-busy={running !== null}>
        {actions.map((a) => (
          <Button
            key={a.taskType}
            variant={a.variant}
            disabled={running !== null}
            onClick={() => runAction(a.taskType)}
            className="justify-start"
          >
            {running === a.taskType ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
            <span className="font-medium">{a.label}</span>
            <span className="ml-auto max-w-[58%] truncate text-xs font-normal text-muted-foreground">
              {a.desc} · {TASK_WRITE_POLICIES[a.taskType].label}
            </span>
          </Button>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={running !== null || !chapter?.content.trim()}
        onClick={() => void runNextChapter()}
        className="justify-start"
        title={chapter?.content.trim() ? '新建下一章并生成承接正文' : '请先完成当前章节正文'}
      >
        {running === 'generate_chapter' ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
        <span className="font-medium">续写下一章</span>
        <span className="ml-auto max-w-[58%] truncate text-xs font-normal text-muted-foreground">新建下一章并承接当前情节</span>
      </Button>

      {running && (
        <div className="studio-ai-surface studio-ai-pulse rounded-md px-3 py-2 text-xs text-ai motion-reduce:animate-none" role="status" aria-live="polite">
          正在生成「{TASK_TYPE_LABELS[running]}」；完成后会展示真实结果或失败原因。
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start text-xs"
        onClick={() => window.dispatchEvent(new Event('sdns:open-ai-command-palette'))}
      >
        <Command className="h-3.5 w-3.5" />
        浏览全部 AI 命令、收藏与最近使用
      </Button>

      {!chapter && <p className="rounded-md border border-warn/40 bg-warn-soft/50 p-2 text-xs text-warn">先选择或新建章节后再运行章节类 AI 命令；完整任务目录仍可浏览。</p>}
      <AiContextPreviewDialog
        open={preflightTask !== null}
        preview={preflight?.preview ?? null}
        controlGroups={preflight?.groups}
        onControlModeChange={(key, targetId, mode) =>
          setContextControls(key, targetId, mode)}
        onRun={() => void executePendingTask()}
        runLabel="执行 AI"
        running={preflightRunning}
        onClose={() => {
          setPendingTask(null)
          setPendingNextChapter(false)
        }}
      />
    </div>
  )
}
