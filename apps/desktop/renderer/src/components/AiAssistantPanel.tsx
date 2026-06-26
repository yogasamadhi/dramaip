import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2 } from 'lucide-react'
import type { Chapter, NovelTaskType } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { TASK_TYPE_LABELS } from '@sdns/core'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface AiAssistantPanelProps {
  projectId: string
  chapter: Chapter | null
  /** 章节类任务完成后刷新章节（让编辑器载入新内容） */
  onChapterUpdated: () => Promise<void> | void
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
  // v0.3 AI 短剧小说强化
  { taskType: 'enhance_hook', label: '强化钩子', desc: '提升开篇与节点牵引', variant: 'secondary' },
  { taskType: 'enhance_reversal', label: '强化反转', desc: '增强反转与信息差爽感', variant: 'secondary' },
  { taskType: 'enhance_cliffhanger', label: '强化悬念', desc: '强化结尾追看钩子', variant: 'secondary' },
  { taskType: 'rewrite_as_ai_drama_novel', label: 'AI 短剧化改写', desc: '更视觉化、更短剧化', variant: 'outline' },
]

export function AiAssistantPanel({ projectId, chapter, onChapterUpdated }: AiAssistantPanelProps) {
  const [running, setRunning] = useState<NovelTaskType | null>(null)
  const [instruction, setInstruction] = useState('')

  async function runAction(taskType: NovelTaskType) {
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
      })
      if (res.ok) {
        toast.success(`${label} 完成`, { id: toastId })
        await onChapterUpdated()
      } else {
        toast.error(`${label} 失败：${res.error ?? '未知错误'}`, { id: toastId })
      }
    } catch (e) {
      toast.error(`${label} 异常：${e instanceof Error ? e.message : String(e)}`, { id: toastId })
    } finally {
      setRunning(null)
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
            <span className="ml-auto text-xs font-normal text-muted-foreground">{a.desc}</span>
          </Button>
        ))}
      </div>

      {!chapter && <p className="text-xs text-muted-foreground">新建或选择章节后即可使用 AI 功能。</p>}
    </div>
  )
}
