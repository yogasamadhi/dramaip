// ChatSection —— 项目对话（与 AI 多轮对话逐步聊清项目设定，字段实时写回）
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Play, Send, Sparkles, Wand2 } from 'lucide-react'
import { TASK_TYPE_LABELS, TASK_WRITE_POLICIES, type AiContextControls, type TextDiffPreviewPayload } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction } from '@/components/ConfirmActionDialog'
import {
  buildAgentCommandPlan,
  type AgentCommandContext,
  type AgentCommandPlan,
} from '@/lib/agentCommandPlanner'
import { buildAiPreflightContext, setAiContextControlMode } from '@/lib/aiPreflightContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import type { PreviewTaskType } from '@/components/GeneratePreviewDialog'
import { AiContextPreviewDialog } from '@/components/AiContextPreviewDialog'
import { shouldAutoAdoptChapterDraft } from '@/lib/textPreviewPolicy'
import { getChapterLengthStatus } from '@/lib/chapterLength'

interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  /** 该消息正接收模型流式输出。 */
  streaming?: boolean
  /** 本轮更新的字段（仅 assistant 消息有） */
  patches?: string[]
  commandPlan?: AgentCommandPlan
  commandStatus?: 'pending' | 'running' | 'done' | 'failed'
  commandResult?: string
}

/** 项目可更新字段 → 中文标签，用于提示用户哪些被更新了 */
const FIELD_LABELS: Record<string, string> = {
  title: '作品名称',
  shortDramaType: '短剧类型',
  targetAudience: '目标受众',
  targetWordCount: '目标字数',
  targetEpisodeCount: '目标集数',
  coreHook: '一句话钩子',
  emotionalCore: '情绪主轴',
  coreSellingPoint: '核心卖点',
  synopsis: '故事简介',
  styleGuide: '小说风格要求',
  visualStyleDirection: '视觉风格方向',
}

function extractReplyFromJsonStream(raw: string): string | undefined {
  const key = raw.match(/"reply"\s*:\s*"/)
  if (!key || key.index === undefined) return undefined

  const start = key.index + key[0].length
  let reply = ''
  let escaping = false

  for (let i = start; i < raw.length; i++) {
    const char = raw[i]
    if (escaping) {
      if (char === 'n') reply += '\n'
      else if (char === 'r') reply += '\r'
      else if (char === 't') reply += '\t'
      else reply += char
      escaping = false
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (char === '"') break
    reply += char
  }

  return reply
}

interface Props {
  projectId: string
  /** 当前编辑器设置的章节正文目标字数。 */
  chapterWordGoal: number
  /** 项目当前设定是否几乎为空（用于决定 AI 是否主动开场） */
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
  commandContext?: AgentCommandContext
  onTextPreview?: (preview: TextDiffPreviewPayload) => void
  onChapterLengthMismatch?: (preview: TextDiffPreviewPayload, wordGoal: number) => void
  onGeneratePreview?: (payload: { taskType: PreviewTaskType; data: unknown; adaptationProjectId?: string }) => void
  onCommandCompleted?: () => void
}

export function ChatSection({
  projectId,
  chapterWordGoal,
  onGenerate,
  generating,
  commandContext,
  onTextPreview,
  onChapterLengthMismatch,
  onGeneratePreview,
  onCommandCompleted,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [commandRunningIndex, setCommandRunningIndex] = useState<number | null>(null)
  const [contextControls, setContextControls] = useState<AiContextControls>({})
  const [pendingCommand, setPendingCommand] = useState<{ plan: AgentCommandPlan; assistantIndex: number } | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const [project, setProject] = useState<{ title?: string; shortDramaType?: string; coreHook?: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const preflight = pendingCommand && commandContext
    ? buildAiPreflightContext(
        pendingCommand.plan.taskType,
        {
          project: commandContext.project,
          chapters: commandContext.chapters,
          characters: commandContext.characters,
          storyArcs: commandContext.storyArcs,
          projectSkills: commandContext.projectSkills,
          caseStudies: commandContext.caseStudies,
          visualProfiles: commandContext.visualProfiles,
        },
        contextControls,
      )
    : null

  // 加载项目，若设定为空则让 AI 主动开场
  const init = useCallback(async () => {
    const p = await ipc.project.get(projectId)
    setProject(p ? { title: p.title, shortDramaType: p.shortDramaType, coreHook: p.coreHook } : null)
    const isEmpty = !p?.shortDramaType || p.shortDramaType === ''
    // 简单判断：若没有核心信息，发一条开场（仅一次）
    if (messages.length === 0 && (isEmpty || !p?.coreHook)) {
      setMessages([
        {
          role: 'assistant',
          content: `你好！我是你的 AI 短剧创作策划。我们先聊聊你的项目吧 —— 你想写一个什么类型的故事？比如「游戏系统·副本升级」「末世求生·领地经营」「规则怪谈·无限流」，或者直接告诉我你脑子里的一个点子/一句话想法，我来帮你梳理。`,
        },
      ])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    void init()
  }, [init])

  // 自动滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const commandPlan = commandContext ? buildAgentCommandPlan(text, commandContext) : null
    if (commandPlan) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content: commandPlan.status === 'ready'
            ? '我把这条指令整理成了执行计划，确认后再调用 AI。'
            : '这条指令还缺少执行条件，先把卡点列出来。',
          commandPlan,
          commandStatus: 'pending',
        },
      ])
      return
    }

    const nextHistory: ChatMessage[] = [...messages, { role: 'user', content: text }]
    const assistantIndex = nextHistory.length
    setMessages([...nextHistory, { role: 'assistant', content: '' }])
    setBusy(true)
    const toastId = toast.loading('AI 正在思考…')
    let rawStream = ''
    try {
      const res = await ipc.ai.runStream(
        {
          projectId,
          taskType: 'chat_project',
          chatHistory: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        },
        (chunk) => {
          rawStream += chunk
          const reply = extractReplyFromJsonStream(rawStream)
          if (reply === undefined) return

          setMessages((prev) =>
            prev.map((m, i) => (i === assistantIndex ? { ...m, content: reply } : m)),
          )
        },
        () => {
          rawStream = ''
          setMessages((prev) => prev.map((m, i) => (i === assistantIndex ? { ...m, content: '' } : m)))
        },
      )
      if (res.ok && res.result) {
        const { reply, fieldPatches } = res.result.data as {
          reply: string
          fieldPatches: Record<string, unknown>
        }
        const patches = Object.keys(fieldPatches ?? {})
        // 若有字段更新，写回项目
        if (patches.length > 0) {
          await ipc.project.update(projectId, fieldPatches)
          setProject((p) => ({ ...p, ...fieldPatches }))
          toast.success(`已更新：${patches.map((k) => FIELD_LABELS[k] ?? k).join('、')}`, { id: toastId })
        } else {
          toast.dismiss(toastId)
        }
        setMessages((prev) =>
          prev.map((m, i) => (i === assistantIndex ? { role: 'assistant', content: reply, patches } : m)),
        )
      } else {
        toast.error('对话失败：' + (res.error ?? '未知错误'), { id: toastId })
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantIndex
              ? { role: 'assistant', content: `对话失败：${res.error ?? '未知错误'}` }
              : m,
          ),
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error('对话异常：' + message, { id: toastId })
      setMessages((prev) =>
        prev.map((m, i) => (i === assistantIndex ? { role: 'assistant', content: `对话异常：${message}` } : m)),
      )
    } finally {
      setBusy(false)
    }
  }

  function openCommandPreflight(plan: AgentCommandPlan, assistantIndex: number) {
    if (!commandContext) {
      void executeCommand(plan, assistantIndex)
      return
    }
    setPendingCommand({ plan, assistantIndex })
  }

  async function runPendingCommand() {
    if (!pendingCommand) return
    setPreflightRunning(true)
    try {
      await executeCommand(pendingCommand.plan, pendingCommand.assistantIndex)
      setPendingCommand(null)
    } finally {
      setPreflightRunning(false)
    }
  }

  async function executeCommand(plan: AgentCommandPlan, assistantIndex: number) {
    if (plan.status !== 'ready' || !plan.input || commandRunningIndex !== null) return
    if (plan.confirmBeforeRun) {
      const shouldRun = await confirmAction({
        title: `执行「${plan.title}」？`,
        description: `${plan.warnings.join('；')}。执行会按计划写入或创建任务，结果可在对应工作区和任务中心追踪。`,
        confirmLabel: '继续执行',
      })
      if (!shouldRun) return
    }

    setCommandRunningIndex(assistantIndex)
    setMessages((prev) =>
      prev.map((message, index) => (
        index === assistantIndex ? { ...message, commandStatus: 'running', commandResult: undefined } : message
      )),
    )
    const label = TASK_TYPE_LABELS[plan.taskType] ?? plan.taskType
    const toastId = toast.loading(`正在执行：${label}…`)
    const streamMessageId = `command-stream-${plan.id}-${Date.now()}`
    let streamedText = ''
    setMessages((prev) => [...prev, {
      id: streamMessageId,
      role: 'assistant',
      content: '',
      streaming: true,
    }])
    try {
      const res = await ipc.ai.runStream(
        { ...plan.input, contextControls, chapterWordGoal },
        (chunk) => {
          streamedText += chunk
          setMessages((prev) =>
            prev.map((message) => (
              message.id === streamMessageId
                ? { ...message, content: streamedText }
                : message
            )),
          )
        },
        () => {
          streamedText = ''
          setMessages((prev) =>
            prev.map((message) => (
              message.id === streamMessageId ? { ...message, content: '' } : message
            )),
          )
        },
      )
      if (!res.ok) {
        const error = res.error ?? '未知错误'
        toast.error(`${label}失败：${error}`, { id: toastId })
        setMessages((prev) =>
          prev.map((message) => (
            message.id === streamMessageId
              ? { ...message, content: streamedText || `执行失败：${error}`, streaming: false }
              : message
          )),
        )
        setMessages((prev) =>
          prev.map((message, index) => (
            index === assistantIndex
              ? { ...message, commandStatus: 'failed', commandResult: `执行失败：${error}` }
              : message
          )),
        )
        return
      }

      let resultText = `${label}已完成。`
      if (res.result?.kind === 'text_preview') {
        const preview = res.result.data as TextDiffPreviewPayload
        const lengthStatus = preview.targetKind === 'chapter'
          ? getChapterLengthStatus(preview.nextContent, chapterWordGoal)
          : undefined
        if (lengthStatus && onChapterLengthMismatch) {
          onChapterLengthMismatch(preview, chapterWordGoal)
          resultText = `已生成完整首稿（${lengthStatus.count} 字），正在等待你决定是否调整字数。`
        } else if (shouldAutoAdoptChapterDraft(preview)) {
          const adopted = await ipc.ai.applyResult({ projectId, taskType: plan.taskType, data: preview })
          if (!adopted.ok) throw new Error(`生成正文写入失败：${adopted.error ?? '未知错误'}`)
          onCommandCompleted?.()
          resultText = '已生成正文并写入空白章节。'
        } else {
          onTextPreview?.(preview)
          resultText = '已生成文本差异预览，确认采用后才会写入。'
        }
        if (!streamedText.trim()) streamedText = preview.nextContent
      } else if (plan.resultMode === 'artifact_preview' && res.result) {
        onGeneratePreview?.({
          taskType: plan.taskType as PreviewTaskType,
          data: res.result.data,
          adaptationProjectId: plan.input.adaptationProjectId,
        })
        resultText = '已生成结构化预览，确认采用后才会写入。'
        if (!streamedText.trim()) streamedText = formatCommandOutput(res.result.data)
      } else {
        onCommandCompleted?.()
        if (TASK_WRITE_POLICIES[plan.taskType].policy === 'snapshot_then_auto_write') {
          resultText = '已保存结构检查点并刷新项目状态。'
        } else {
          resultText = plan.resultMode === 'auto_write' ? '已执行并刷新项目状态。' : resultText
        }
        if (!streamedText.trim() && res.result) streamedText = formatCommandOutput(res.result.data)
      }
      toast.success(label + '完成', { id: toastId })
      setMessages((prev) =>
        prev.map((message) => (
          message.id === streamMessageId
            ? { ...message, content: streamedText || resultText, streaming: false }
            : message
        )),
      )
      setMessages((prev) =>
        prev.map((message, index) => (
          index === assistantIndex ? { ...message, commandStatus: 'done', commandResult: resultText } : message
        )),
      )
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      toast.error(`${label}异常：${error}`, { id: toastId })
      setMessages((prev) =>
        prev.map((message) => (
          message.id === streamMessageId
            ? { ...message, content: streamedText || `执行异常：${error}`, streaming: false }
            : message
        )),
      )
      setMessages((prev) =>
        prev.map((message, index) => (
          index === assistantIndex ? { ...message, commandStatus: 'failed', commandResult: `执行异常：${error}` } : message
        )),
      )
    } finally {
      setCommandRunningIndex(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Agent 指挥台</h2>
        {project?.shortDramaType && <Badge variant="secondary">{project.shortDramaType}</Badge>}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onGenerate('generate_project', input.trim() || undefined)}
            disabled={generating !== null}
          >
            <Wand2 />
            一键补全设定
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="space-y-3 p-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {m.content ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (m.streaming || (busy && i === messages.length - 1 && m.role === 'assistant')) ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
                {m.patches && m.patches.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border/40 pt-1.5">
                    <span className="text-[10px] opacity-70">已写入：</span>
                    {m.patches.map((k) => (
                      <span key={k} className="rounded bg-background/30 px-1.5 py-0.5 text-[10px]">
                        {FIELD_LABELS[k] ?? k}
                      </span>
                    ))}
                  </div>
                )}
                {m.commandPlan && (
                  <CommandPlanCard
                    plan={m.commandPlan}
                    status={m.commandStatus ?? 'pending'}
                    result={m.commandResult}
                    running={commandRunningIndex !== null}
                    onRun={() => openCommandPreflight(m.commandPlan as AgentCommandPlan, i)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="输入项目想法，或直接下达创作指令…"
            disabled={busy || commandRunningIndex !== null}
          />
          <Button size="icon" onClick={send} disabled={busy || commandRunningIndex !== null || !input.trim()}>
            {busy || commandRunningIndex !== null ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          可聊设定，也可让 Agent 先列计划再执行章节、分集和分镜任务。
        </p>
      </div>
      <AiContextPreviewDialog
        open={pendingCommand !== null}
        preview={preflight?.preview ?? null}
        controlGroups={preflight?.groups}
        onControlModeChange={(key, id, mode) =>
          setContextControls((current) => setAiContextControlMode(current, key, id, mode))}
        onRun={() => void runPendingCommand()}
        runLabel="执行 AI"
        running={preflightRunning}
        onClose={() => setPendingCommand(null)}
      />
    </div>
  )
}

function formatCommandOutput(data: unknown): string {
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return 'AI 已返回结果，请在对应工作区查看。'
  }
}

function CommandPlanCard({
  plan,
  status,
  result,
  running,
  onRun,
}: {
  plan: AgentCommandPlan
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: string
  running: boolean
  onRun: () => void
}) {
  const policy = TASK_WRITE_POLICIES[plan.taskType]
  const resultModeLabel = plan.resultMode === 'text_preview'
    ? '差异预览'
    : plan.resultMode === 'artifact_preview'
      ? '结构预览'
      : policy.policy === 'snapshot_then_auto_write'
        ? '快照后写入'
        : '确认后写入'

  return (
    <div className="mt-2 rounded-md border bg-background/80 p-3 text-xs text-foreground">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{TASK_TYPE_LABELS[plan.taskType] ?? plan.taskType}</Badge>
        <Badge variant={plan.resultMode === 'auto_write' ? 'destructive' : 'secondary'}>
          {resultModeLabel}
        </Badge>
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">{plan.title}</div>
        <div className="text-muted-foreground">目标：{plan.targetLabel}</div>
        <div className="text-muted-foreground">{plan.summary}</div>
      </div>
      {(plan.warnings.length > 0 || plan.blockedReasons.length > 0) && (
        <div className="mt-2 space-y-1 text-muted-foreground">
          {plan.blockedReasons.map((reason) => (
            <div key={reason}>卡点：{reason}</div>
          ))}
          {plan.warnings.map((warning) => (
            <div key={warning}>提示：{warning}</div>
          ))}
        </div>
      )}
      {result && <div className="mt-2 text-muted-foreground">{result}</div>}
      {plan.status === 'ready' && status !== 'done' && (
        <Button size="sm" className="mt-3" onClick={onRun} disabled={running || status === 'running'}>
          {status === 'running' ? <Loader2 className="animate-spin" /> : <Play />}
          执行计划
        </Button>
      )}
      {status === 'done' && (
        <Badge variant="secondary" className="mt-3">
          已完成
        </Badge>
      )}
    </div>
  )
}
