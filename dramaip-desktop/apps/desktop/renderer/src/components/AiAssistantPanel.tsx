import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2 } from 'lucide-react'
import type { AiContextControls, Chapter, NovelTaskType, TextDiffPreviewPayload } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { TASK_TYPE_LABELS, TASK_WRITE_POLICIES } from '@sdns/core'
import {
  buildAiPreflightContext,
  setAiContextControlMode,
  type AiPreflightContextData,
} from '@/lib/aiPreflightContext'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AiContextPreviewDialog } from '@/components/AiContextPreviewDialog'

interface AiAssistantPanelProps {
  projectId: string
  chapter: Chapter | null
  /** 章节类任务完成后刷新章节（让编辑器载入新内容） */
  onChapterUpdated: () => Promise<void> | void
  onTextPreview?: (preview: TextDiffPreviewPayload) => void
  contextData?: AiPreflightContextData
}

const ACTIONS: { taskType: NovelTaskType; label: string; desc: string; variant: 'default' | 'outline' | 'secondary' }[] = [
  { taskType: 'generate_chapter', label: 'AI 生成正文', desc: '根据大纲生成本章正文', variant: 'default' },
  { taskType: 'continue_chapter', label: '续写', desc: '顺着已有正文往下写', variant: 'outline' },
  { taskType: 'polish_chapter', label: '润色', desc: '提升文字质感', variant: 'outline' },
  { taskType: 'expand_chapter', label: '扩写', desc: '丰富细节与画面', variant: 'outline' },
  { taskType: 'rewrite_chapter', label: '改写', desc: '按指令改写', variant: 'outline' },
  { taskType: 'enhance_conflict', label: '增强冲突', desc: '让矛盾更尖锐', variant: 'secondary' },
  { taskType: 'enhance_highlight', label: '增强爽点', desc: '放大打脸逆袭高潮', variant: 'secondary' },
  { taskType: 'enhance_ai_drama_feel', label: '增强 AI 短剧感', desc: '强化爽点与镜头感', variant: 'secondary' },
  { taskType: 'enhance_author_style', label: '作者风格强化', desc: '统一声口与句式节奏', variant: 'secondary' },
  // v0.3 AI 短剧小说强化
  { taskType: 'enhance_hook', label: '强化钩子', desc: '提升开篇与节点牵引', variant: 'secondary' },
  { taskType: 'enhance_reversal', label: '强化反转', desc: '增强反转与信息差爽感', variant: 'secondary' },
  { taskType: 'enhance_cliffhanger', label: '强化悬念', desc: '强化结尾追看钩子', variant: 'secondary' },
  { taskType: 'rewrite_as_ai_drama_novel', label: 'AI 短剧化改写', desc: '更视觉化、更短剧化', variant: 'outline' },
]

export function AiAssistantPanel({ projectId, chapter, onChapterUpdated, onTextPreview, contextData }: AiAssistantPanelProps) {
  const [running, setRunning] = useState<NovelTaskType | null>(null)
  const [instruction, setInstruction] = useState('')
  const [contextControls, setContextControls] = useState<AiContextControls>({})
  const [pendingTask, setPendingTask] = useState<NovelTaskType | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const preflight = pendingTask && contextData ? buildAiPreflightContext(pendingTask, contextData, contextControls) : null

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

  async function runActionNow(taskType: NovelTaskType) {
    if (!chapter) {
      toast.error('请先选择或新建一个章节')
      return
    }
    setRunning(taskType)
    const label = TASK_TYPE_LABELS[taskType]
    const toastId = toast.loading(`正在执行：${label}…`)
    try {
      const res = await ipc.ai.run({
        projectId,
        chapterId: chapter.id,
        taskType,
        userInstruction: instruction.trim() || undefined,
        contextControls,
      })
      if (res.ok) {
        if (res.result?.kind === 'text_preview') {
          toast.success(`${label} 完成，预览后采用`, { id: toastId })
          onTextPreview?.(res.result.data as TextDiffPreviewPayload)
        } else {
          const policy = TASK_WRITE_POLICIES[taskType]
          const savedText = policy.policy === 'snapshot_then_auto_write'
            ? '，已保存检查点并写入'
            : policy.policy === 'auto_write'
              ? '，已写入'
              : ''
          toast.success(`${label} 完成${savedText}`, { id: toastId })
          await onChapterUpdated()
        }
      } else {
        toast.error(`${label} 失败：${res.error ?? '未知错误'}`, { id: toastId })
      }
    } catch (e) {
      toast.error(`${label} 异常：${e instanceof Error ? e.message : String(e)}`, { id: toastId })
    } finally {
      setRunning(null)
    }
  }

  async function executePendingTask() {
    if (!pendingTask) return
    setPreflightRunning(true)
    try {
      await runActionNow(pendingTask)
      setPendingTask(null)
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

      <div className="grid grid-cols-1 gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.taskType}
            variant={a.variant}
            disabled={running !== null}
            onClick={() => runAction(a.taskType)}
            className="justify-start"
          >
            {running === a.taskType ? <Loader2 className="animate-spin" /> : null}
            <span className="font-medium">{a.label}</span>
            <span className="ml-auto max-w-[58%] truncate text-xs font-normal text-muted-foreground">
              {a.desc} · {TASK_WRITE_POLICIES[a.taskType].label}
            </span>
          </Button>
        ))}
      </div>

      {!chapter && <p className="text-xs text-muted-foreground">新建或选择章节后即可使用 AI 功能。</p>}
      <AiContextPreviewDialog
        open={pendingTask !== null}
        preview={preflight?.preview ?? null}
        controlGroups={preflight?.groups}
        onControlModeChange={(key, targetId, mode) =>
          setContextControls((current) => setAiContextControlMode(current, key, targetId, mode))}
        onRun={() => void executePendingTask()}
        runLabel="执行 AI"
        running={preflightRunning}
        onClose={() => setPendingTask(null)}
      />
    </div>
  )
}
