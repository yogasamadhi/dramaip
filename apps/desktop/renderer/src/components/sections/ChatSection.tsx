// ChatSection —— 项目对话（与 AI 多轮对话逐步聊清项目设定，字段实时写回）
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, Sparkles, Wand2 } from 'lucide-react'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import type { PreviewTaskType } from '@/components/GeneratePreviewDialog'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 本轮更新的字段（仅 assistant 消息有） */
  patches?: string[]
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
  /** 项目当前设定是否几乎为空（用于决定 AI 是否主动开场） */
  onGenerate: (taskType: PreviewTaskType, userInstruction?: string) => void
  generating: PreviewTaskType | null
}

export function ChatSection({ projectId, onGenerate, generating }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [project, setProject] = useState<{ title?: string; shortDramaType?: string; coreHook?: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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
          content: `你好！我是你的 AI 短剧创作策划。我们先聊聊你的项目吧 —— 你想写一个什么类型的故事？比如「真假千金」「重生逆袭」「霸总追妻」，或者直接告诉我你脑子里的一个点子/一句话想法，我来帮你梳理。`,
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">项目对话</h2>
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
                ) : busy && i === messages.length - 1 && m.role === 'assistant' ? (
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
            placeholder="和 AI 聊聊你的项目设定…（回车发送）"
            disabled={busy}
          />
          <Button size="icon" onClick={send} disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          AI 会逐步问你类型、卖点、钩子、受众等，聊清楚的字段会自动填进「项目概览」。
        </p>
      </div>
    </div>
  )
}
