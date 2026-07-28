'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChatMessage, ChatModel, ChatResponse } from '@dramaip/sdk'
import { RequireAuth } from '../../components/RequireAuth'
import { Button } from '../../components/ui/Button'
import { parseApiError } from '../../lib/api-error'
import { apiClient } from '../../lib/api-client'
import {
  chatStatusLabel,
  conversationStateFromStatus,
  streamTerminalOutcome,
  type ChatStreamTerminalEvent,
  type ConversationMessageState,
} from '../../lib/chat-state'

type ConversationMessage = ChatMessage & {
  id: string
  requestID?: string
  state?: ConversationMessageState
}

type ActiveRequest = {
  idempotencyKey: string
  requestID: string
  assistantID: string
}

const starters = [
  { title: '故事前提', prompt: '请为“创作者重建事业”写一个具有冲突与反转的短剧故事前提。' },
  { title: '角色关系', prompt: '请根据我的故事前提，设计 3 位主角的目标、秘密、冲突和关系张力。' },
  { title: '第一集节拍', prompt: '请将这个故事拆成第一集的 8 个短剧节拍，结尾设置强钩子。' },
]

export default function ChatPage() {
  const queryClient = useQueryClient()
  const controllerRef = useRef<AbortController | null>(null)
  const historyLoadedRef = useRef(false)
  const [prompt, setPrompt] = useState('')
  const [selectedModelID, setSelectedModelID] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [active, setActive] = useState<ActiveRequest | null>(null)
  const [preflight, setPreflight] = useState<{ estimated: number; remaining: number } | null>(null)
  const [notice, setNotice] = useState('')

  const session = useQuery({ queryKey: ['session'], queryFn: () => apiClient.getSession(), retry: false })
  const models = useQuery({ queryKey: ['chat-models'], queryFn: () => apiClient.getChatModels(), retry: false, staleTime: 60_000 })
  const tokenBalance = useQuery({ queryKey: ['token-balance'], queryFn: () => apiClient.getTokenBalance(), retry: false })
  const selectedModel = useMemo(
    () => models.data?.models.find((item) => item.id === selectedModelID) ?? models.data?.models.find((item) => item.is_default),
    [models.data?.models, selectedModelID],
  )

  useEffect(() => {
    const preferred = models.data?.models.find((item) => item.is_default) ?? models.data?.models[0]
    if (preferred && !selectedModelID) setSelectedModelID(preferred.id)
  }, [models.data?.models, selectedModelID])

  useEffect(() => {
    const userID = session.data?.user.id
    if (!userID) return
    historyLoadedRef.current = false
    setMessages(readLocalHistory(userID))
    historyLoadedRef.current = true
  }, [session.data?.user.id])

  useEffect(() => {
    const userID = session.data?.user.id
    if (!userID || !historyLoadedRef.current) return
    writeLocalHistory(userID, messages)
  }, [messages, session.data?.user.id])

  const runAuthorTask = async () => {
    const text = prompt.trim()
    if (!text || !selectedModel || active) return
    const requestID = newRequestID()
    const assistantID = `${requestID}-assistant`
    const userMessage: ConversationMessage = { id: `${requestID}-user`, role: 'user', content: text, requestID }
    const assistantMessage: ConversationMessage = { id: assistantID, role: 'assistant', content: '', requestID, state: 'streaming' }
    const outbound = [...messages, userMessage].slice(-8).map(toChatMessage)
    const controller = new AbortController()
    controllerRef.current = controller
    setMessages((current) => [...current, userMessage, assistantMessage])
    setPrompt('')
    setNotice('正在进行额度预检…')
    setActive({ idempotencyKey: requestID, requestID, assistantID })
    setPreflight(null)

    try {
      let terminalEvent: ChatStreamTerminalEvent | undefined
      const checked = await apiClient.preflightChat({
        provider: selectedModel.provider,
        model: selectedModel.model,
        messages: outbound,
        max_tokens: 512,
      })
      setPreflight({ estimated: checked.estimated_tokens, remaining: checked.remaining_tokens })
      setNotice('已通过预检，正在接收模型输出…')
      await apiClient.streamChat({
        provider: checked.model.provider,
        model: checked.model.model,
        messages: outbound,
        max_tokens: 512,
        request_id: requestID,
        idempotency_key: requestID,
        preflight_request_hash: checked.request_hash,
      }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'delta') {
            setMessages((current) => updateMessage(current, assistantID, (message) => ({ ...message, content: message.content + event.delta })))
          }
          if (event.type === 'completed') {
            terminalEvent = 'completed'
            if (event.reply) finishAssistant(setMessages, assistantID, event.reply)
          }
          if (event.type === 'failed') {
            terminalEvent = 'failed'
            setNotice(streamTerminalOutcome('failed', event.request_id || requestID).notice)
            setMessages((current) => updateMessage(current, assistantID, (message) => ({ ...message, state: 'failed' })))
          }
        },
      })
      const outcome = streamTerminalOutcome(terminalEvent, requestID)
      setNotice(outcome.notice)
      setMessages((current) => updateMessage(current, assistantID, (message) => ({ ...message, state: outcome.state })))
      if (outcome.refreshUsage) await invalidateUsage(queryClient)
    } catch (error) {
      if (controller.signal.aborted) {
        setNotice('已请求取消，额度会在网关确认后释放。')
        setMessages((current) => updateMessage(current, assistantID, (message) => ({ ...message, state: 'canceled' })))
      } else {
        setNotice(classifyChatError(error))
        setMessages((current) => updateMessage(current, assistantID, (message) => ({ ...message, state: 'failed' })))
      }
    } finally {
      controllerRef.current = null
      setActive(null)
    }
  }

  const cancelActiveTask = async () => {
    if (!active) return
    controllerRef.current?.abort()
    setNotice('正在向网关请求取消…')
    try {
      const result = await apiClient.cancelChat({ idempotency_key: active.idempotencyKey })
      setNotice(result.status === 'cancellation_requested' ? '取消已受理，正在释放额度。' : `请求状态：${chatStatusLabel(result.status)}`)
    } catch (error) {
      setNotice(classifyChatError(error))
    }
  }

  const recoverLatest = async () => {
    const request = active ?? latestRequest(messages)
    if (!request) return
    setNotice('正在查询网关中的原请求，不会再次调用模型。')
    try {
      const result = await apiClient.getChatStatus({ idempotency_key: request.idempotencyKey })
      const assistantID = request.assistantID ?? `${result.request_id}-assistant`
	  const resultStatus = result.status ?? 'in_progress'
      setMessages((current) => {
        const exists = current.some((message) => message.id === assistantID)
		const next = { id: assistantID, role: 'assistant' as const, content: result.content, requestID: result.request_id, state: conversationStateFromStatus(resultStatus) }
        return exists ? updateMessage(current, assistantID, () => next) : [...current, next]
      })
	  setNotice(`已恢复请求状态：${chatStatusLabel(resultStatus)}。`)
	  if (resultStatus === 'succeeded') await invalidateUsage(queryClient)
    } catch (error) {
      setNotice(classifyChatError(error))
    }
  }

  const clearConversation = () => {
    if (active) return
    setMessages([])
    setPreflight(null)
    setNotice('已仅清除此浏览器中当前账号的会话记录。')
  }

  return (
    <RequireAuth>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:h-fit">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">创作助手</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">从灵感到下一稿</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">选择一个作者任务，平台会先核验模型与额度，再开始生成。</p>
            <div className="mt-6 grid gap-2" aria-label="作者任务">
              {starters.map((starter) => (
                <button
                  key={starter.title}
                  type="button"
                  className="rounded-xl border border-slate-200 px-3 py-3 text-left text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  onClick={() => setPrompt(starter.prompt)}
                  disabled={Boolean(active)}
                >
                  {starter.title}
                </button>
              ))}
            </div>
            <div className="mt-6 border-t border-slate-100 pt-5">
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                创作模型
                <select
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                  value={selectedModel?.id ?? ''}
                  onChange={(event) => setSelectedModelID(event.target.value)}
                  disabled={models.isLoading || Boolean(active) || !models.data?.models.length}
                  aria-label="创作模型"
                >
                  {models.data?.models.map((model) => <option key={model.id} value={model.id}>{model.model}{model.is_default ? '（推荐）' : ''}</option>)}
                </select>
              </label>
              {models.isError || !models.data?.models.length ? <p className="mt-2 text-xs leading-5 text-rose-700">当前没有可用的创作模型，请稍后重试。</p> : null}
              <p className="mt-4 text-xs leading-5 text-slate-500">剩余额度：{tokenBalance.data ? tokenBalance.data.remaining_tokens.toLocaleString() : '加载中…'}</p>
              {preflight ? <p className="mt-1 text-xs leading-5 text-emerald-700">本次预计使用 {preflight.estimated.toLocaleString()} tokens，预检后可用 {preflight.remaining.toLocaleString()} tokens。</p> : null}
            </div>
          </aside>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
              <div>
                <h2 className="font-semibold text-slate-950">创作会话</h2>
                <p className="mt-1 text-xs text-slate-500">会话仅保存在此浏览器并按当前账号隔离；服务端审计不保存提示词。</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="h-9 px-3" onClick={() => void recoverLatest()} disabled={Boolean(active) || messages.length === 0}>恢复最近请求</Button>
                <Button type="button" variant="secondary" className="h-9 px-3" onClick={clearConversation} disabled={Boolean(active) || messages.length === 0}>新会话</Button>
              </div>
            </header>

            <div className="min-h-[26rem] space-y-5 px-5 py-6 sm:px-7" aria-live="polite" aria-busy={Boolean(active)}>
              {messages.length === 0 ? <EmptyConversation onStarter={(value) => setPrompt(value)} /> : messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            </div>

            <div className="border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5">
              {notice ? <p className="mb-3 text-sm text-slate-600" role="status">{notice}</p> : null}
              <label className="sr-only" htmlFor="author-prompt">本次创作要求</label>
              <textarea
                id="author-prompt"
                className="min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100"
                placeholder="描述你想推进的故事、角色或片段…"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={Boolean(active)}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">生成期间可取消；断线后可安全查询原请求，不会重复调用模型。</p>
                {active ? (
                  <Button type="button" variant="secondary" onClick={() => void cancelActiveTask()}>取消生成</Button>
                ) : (
                  <Button type="button" onClick={() => void runAuthorTask()} disabled={!prompt.trim() || !selectedModel}>开始创作</Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </RequireAuth>
  )
}

function EmptyConversation({ onStarter }: { onStarter: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-xl text-brand-700" aria-hidden="true">✦</div>
      <h3 className="mt-5 text-lg font-semibold text-slate-900">从一个清晰的创作动作开始</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">可以选择左侧任务，也可以直接写下你现在最想解决的问题。</p>
      <button type="button" className="mt-5 text-sm font-medium text-brand-700 hover:text-brand-800" onClick={() => onStarter(starters[0].prompt)}>尝试“故事前提”</button>
    </div>
  )
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isAuthor = message.role === 'user'
  return (
    <article className={`flex gap-3 ${isAuthor ? 'justify-end' : 'justify-start'}`}>
      {!isAuthor ? <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700" aria-hidden="true">AI</div> : null}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${isAuthor ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-800'}`}>
        {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : message.state === 'streaming' ? <span className="inline-flex items-center gap-1 text-slate-500"><i className="h-1.5 w-1.5 rounded-full bg-brand-500 motion-safe:animate-pulse motion-reduce:animate-none" /><i className="h-1.5 w-1.5 rounded-full bg-brand-500 motion-safe:animate-pulse motion-reduce:animate-none" /><i className="h-1.5 w-1.5 rounded-full bg-brand-500 motion-safe:animate-pulse motion-reduce:animate-none" /><span className="ml-1">正在接收模型输出</span></span> : null}
        {message.state && message.state !== 'completed' && message.state !== 'streaming' ? <p className="mt-2 text-xs text-rose-700">{message.state === 'canceled' ? '已取消' : '生成未完成'}</p> : null}
      </div>
    </article>
  )
}

function toChatMessage(message: ConversationMessage): ChatMessage {
  return { role: message.role, content: message.content }
}

function updateMessage(messages: ConversationMessage[], id: string, update: (message: ConversationMessage) => ConversationMessage) {
  return messages.map((message) => message.id === id ? update(message) : message)
}

function finishAssistant(setMessages: Dispatch<SetStateAction<ConversationMessage[]>>, assistantID: string, reply: ChatResponse) {
  setMessages((current) => updateMessage(current, assistantID, (message) => ({ ...message, content: reply.content, requestID: reply.request_id, state: 'completed' })))
}

function latestRequest(messages: ConversationMessage[]): ActiveRequest | null {
  const latest = [...messages].reverse().find((message) => message.requestID)
  if (!latest?.requestID) return null
  return { idempotencyKey: latest.requestID, requestID: latest.requestID, assistantID: `${latest.requestID}-assistant` }
}

function classifyChatError(error: unknown) {
  const apiError = parseApiError(error, '智能请求暂时不可用。')
  const text = `${apiError.code} ${apiError.message}`.toLowerCase()
  if (apiError.status === 402 || text.includes('quota')) return '模型额度不足，已在调用模型前停止请求。'
  if (apiError.status === 429 || text.includes('rate')) return '请求频率已达上限，请稍后再试。'
  if (text.includes('preflight') || text.includes('model')) return '当前模型不可用或请求已变更，请重新发起预检。'
  return apiError.message
}

async function invalidateUsage(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['token-balance'] }),
    queryClient.invalidateQueries({ queryKey: ['token-usage'] }),
    queryClient.invalidateQueries({ queryKey: ['usage-trend'] }),
    queryClient.invalidateQueries({ queryKey: ['account-bootstrap'] }),
  ])
}

function newRequestID() {
  return globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function historyKey(userID: string) {
  return `dramaip.author-chat.v1.${userID}`
}

function readLocalHistory(userID: string): ConversationMessage[] {
  try {
    const raw = window.localStorage.getItem(historyKey(userID))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConversationMessage).slice(-32)
  } catch {
    return []
  }
}

function writeLocalHistory(userID: string, messages: ConversationMessage[]) {
  try {
    window.localStorage.setItem(historyKey(userID), JSON.stringify(messages.slice(-32)))
  } catch {
    // Local history is a convenience layer. A storage quota failure must not
    // prevent the secure gateway request from completing.
  }
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return typeof message.id === 'string' && (message.role === 'user' || message.role === 'assistant' || message.role === 'system') && typeof message.content === 'string'
}
