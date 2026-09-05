'use client'

import type {
  CorpusItem,
  CreativeCollectionItem,
  CreativeExperiment,
  CreativeFingerprint,
  CreativeMemory,
  CreativeMemorySettings,
  CreativeMode,
  InspirationCard,
  InspirationCardKind,
  InspirationConversation,
  InspirationMessage,
  InspirationMemoryJob,
} from '@dramaip/sdk'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RequireAuth } from '../../components/RequireAuth'
import { Button } from '../../components/ui/Button'
import { apiClient } from '../../lib/api-client'
import { parseApiError } from '../../lib/api-error'

const MODES: readonly { id: CreativeMode; label: string; description: string; starter: string }[] = [
  { id: 'free', label: '自由漫游', description: '开放联想，不强求结论', starter: '我脑中有一个模糊的画面，请陪我自由联想，不要急着下结论。' },
  { id: 'guided', label: '新手引导', description: '一次一个问题', starter: '我想创作一个故事，但还没有方向。请一次只问我一个问题。' },
  { id: 'character_interview', label: '角色访谈', description: '动机、秘密与矛盾', starter: '请像一位敏锐的访谈者，帮我发现这个角色真正想隐瞒的东西。' },
  { id: 'world_simulation', label: '世界推演', description: '规则、历史与因果', starter: '我有一条世界规则，请和我一起推演它会造成的连锁反应。' },
  { id: 'conflict_lab', label: '冲突实验室', description: '冲突、反转与悬念', starter: '请为我的想法设计三个性质不同的核心冲突，并追问我更偏爱哪一个。' },
]

const CARD_KINDS: readonly [InspirationCardKind, string][] = [
  ['premise', '故事前提'], ['character', '人物'], ['world', '世界观'], ['conflict', '冲突'],
  ['scene', '场景'], ['style', '风格'], ['question', '待探索问题'],
]

type ActiveRun = { conversationId: string; runId: string; assistantText: string }
type ToolTab = 'results' | 'corpus' | 'experiments' | 'fingerprint'

export default function InspirationPage() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => apiClient.getSession(), retry: false })
  const models = useQuery({ queryKey: ['chat-models'], queryFn: () => apiClient.getChatModels(), retry: false, staleTime: 60_000 })
  const [conversations, setConversations] = useState<InspirationConversation[]>([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<InspirationMessage[]>([])
  const [cards, setCards] = useState<InspirationCard[]>([])
  const [memories, setMemories] = useState<CreativeMemory[]>([])
  const [settings, setSettings] = useState<CreativeMemorySettings>()
  const [memoryJobs, setMemoryJobs] = useState<InspirationMemoryJob[]>([])
  const [corpusItems, setCorpusItems] = useState<CorpusItem[]>([])
  const [selectedCorpusIds, setSelectedCorpusIds] = useState<string[]>([])
  const [collections, setCollections] = useState<CreativeCollectionItem[]>([])
  const [fingerprint, setFingerprint] = useState<CreativeFingerprint>()
  const [experiments, setExperiments] = useState<CreativeExperiment[]>([])
  const [toolTab, setToolTab] = useState<ToolTab>('results')
  const [corpusQuery, setCorpusQuery] = useState('')
  const [experimentPrompt, setExperimentPrompt] = useState('')
  const [creativeBusy, setCreativeBusy] = useState(false)
  const [mode, setMode] = useState<CreativeMode>('free')
  const [prompt, setPrompt] = useState('')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [active, setActive] = useState<ActiveRun | null>(null)
  const [busy, setBusy] = useState(false)
  const lastSequence = useRef(0)
  const consentAsked = useRef(false)
  const importChecked = useRef(false)
  const selectedModel = models.data?.models.find((item) => item.is_default) ?? models.data?.models[0]
  const conversation = conversations.find((item) => item.id === conversationId)
  const visibleConversations = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return keyword ? conversations.filter((item) => item.title.toLocaleLowerCase().includes(keyword)) : conversations
  }, [conversations, search])

  const loadConversations = async (preferredId?: string) => {
    const [current, archived] = await Promise.all([
      apiClient.inspiration.listConversations({ limit: 100 }),
      apiClient.inspiration.listConversations({ archived: true, limit: 1 }),
    ])
    setConversations(current.items)
    setArchivedCount(archived.items.length)
    const next = preferredId ?? (conversationId && current.items.some((item) => item.id === conversationId) ? conversationId : current.items[0]?.id)
    setConversationId(next)
  }

  const loadConversation = async (id: string) => {
    const [messagePage, nextCards, nextJobs] = await Promise.all([
      apiClient.inspiration.listMessages(id, { limit: 200 }),
      apiClient.inspiration.listCards(id),
      apiClient.inspiration.listMemoryJobs(id),
    ])
    setMessages(messagePage.items)
    setCards(nextCards)
    setMemoryJobs(nextJobs)
  }

  const loadMemoryCenter = async () => {
    const [nextSettings, nextMemories] = await Promise.all([
      apiClient.inspiration.getMemorySettings(),
      apiClient.inspiration.listMemories(),
    ])
    setSettings(nextSettings)
    setMemories(nextMemories)
  }

  const loadCreativeIntelligence = async (query = '') => {
    const [corpus, nextCollections, nextFingerprint, nextExperiments] = await Promise.all([
      apiClient.creativeIntelligence.searchCorpus({ query, visibility: 'all', limit: 50 }),
      apiClient.creativeIntelligence.listCollections(),
      apiClient.creativeIntelligence.getFingerprint(),
      apiClient.creativeIntelligence.listExperiments({ limit: 30 }),
    ])
    setCorpusItems(corpus.items)
    setCollections(nextCollections)
    setFingerprint(nextFingerprint)
    setExperiments(nextExperiments.items)
  }

  useEffect(() => {
    if (!session.data?.user.id) return
    void Promise.all([loadConversations(), loadMemoryCenter(), loadCreativeIntelligence()]).catch((error) => setNotice(errorMessage(error)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data?.user.id])

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      setCards([])
      setMemoryJobs([])
      return
    }
    lastSequence.current = 0
    void loadConversation(conversationId).catch((error) => setNotice(errorMessage(error)))
    const current = conversations.find((item) => item.id === conversationId)
    if (current) setMode(current.creativeMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  useEffect(() => {
    if (!settings || settings.consentedAt || consentAsked.current) return
    consentAsked.current = true
    const enabled = window.confirm('是否允许灵感空间自动学习你的创作偏好？只提取主题、风格、明确禁区和长期目标，可随时暂停或清空。')
    void apiClient.inspiration.updateMemorySettings(enabled).then(setSettings).catch((error) => setNotice(errorMessage(error)))
  }, [settings])

  useEffect(() => {
    const userId = session.data?.user.id
    if (!userId || importChecked.current) return
    importChecked.current = true
    const key = `dramaip.author-chat.v1.${userId}`
    const legacy = readLegacyHistory(key)
    if (!legacy.length) return
    const accepted = window.confirm(`发现此浏览器中旧版创作助手的 ${legacy.length} 条消息。是否导入为一段独立的云端灵感对话？`)
    if (!accepted) return
    void apiClient.inspiration.importHistory({ title: '从旧版创作助手导入', messages: legacy }).then(async (created) => {
      window.localStorage.removeItem(key)
      await loadConversations(created.id)
      setNotice('旧浏览器历史已按你的选择导入；本地旧记录已删除。')
    }).catch((error) => setNotice(`导入失败，本地旧记录仍保留。${errorMessage(error)}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data?.user.id])

  useEffect(() => {
    if (!active) return
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const events = await apiClient.inspiration.replayEvents(active.conversationId, lastSequence.current)
        let terminal = false
        let appended = ''
        for (const event of events) {
          lastSequence.current = Math.max(lastSequence.current, event.sequence)
          if (event.runId !== active.runId) continue
          if (event.type === 'delta' && typeof event.payload.delta === 'string') appended += event.payload.delta
          if (['completed', 'failed', 'canceled'].includes(event.type)) {
            terminal = true
            if (event.type !== 'completed') setNotice(`本次对话未完成：${String(event.payload.code ?? event.type)}`)
          }
        }
        if (appended) setActive((current) => current ? { ...current, assistantText: current.assistantText + appended } : current)
        if (terminal) {
          setActive(null)
          await Promise.all([loadConversation(active.conversationId), loadMemoryCenter(), loadConversations(active.conversationId)])
        }
      } catch (error) {
        setNotice(`正在等待断线续接：${errorMessage(error)}`)
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_200)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.runId])

  const newConversation = () => {
    setConversationId(undefined)
    setMessages([])
    setCards([])
    setMode('free')
    setPrompt('')
    setNotice('')
  }

  const ensureConversation = async () => {
    if (conversation) {
      if (conversation.creativeMode !== mode) {
        const updated = await apiClient.inspiration.updateConversation(conversation.id, { creativeMode: mode })
        setConversations((items) => items.map((item) => item.id === updated.id ? updated : item))
        return updated
      }
      return conversation
    }
    const created = await apiClient.inspiration.createConversation({ creativeMode: mode })
    await loadConversations(created.id)
    return created
  }

  const send = async (starter?: string) => {
    const content = (starter ?? prompt).trim()
    if (!content || !selectedModel || active || busy) return
    setBusy(true)
    setNotice('正在创建持久化消息并执行额度预检…')
    try {
      const current = await ensureConversation()
      const requestId = crypto.randomUUID()
      const started = await apiClient.inspiration.sendMessage(current.id, {
        model: selectedModel.model,
        content,
        maxTokens: 1_024,
      }, requestId)
      setPrompt('')
      await loadConversation(current.id)
      setActive({ conversationId: current.id, runId: started.runId, assistantText: '' })
      setNotice('正在接收创意回应；断线后会从最后事件继续。')
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    if (!conversation) return
    const title = window.prompt('新的对话名称', conversation.title)?.trim()
    if (!title) return
    const updated = await apiClient.inspiration.updateConversation(conversation.id, { title })
    setConversations((items) => items.map((item) => item.id === updated.id ? updated : item))
  }

  const fork = async () => {
    if (!conversation) return
    const created = await apiClient.inspiration.forkConversation(conversation.id)
    await loadConversations(created.id)
    setNotice('已从当前状态创建独立分支，源对话保持不变。')
  }

  const archive = async () => {
    if (!conversation) return
    await apiClient.inspiration.updateConversation(conversation.id, { archived: true })
    newConversation()
    await loadConversations()
  }

  const remove = async () => {
    if (!conversation || !window.confirm('永久删除这段对话、摘要、卡片和仅由它产生的长期记忆？')) return
    await apiClient.inspiration.deleteConversation(conversation.id)
    newConversation()
    await Promise.all([loadConversations(), loadMemoryCenter()])
  }

  const addCard = async () => {
    if (!conversation) return
    const content = window.prompt('记录下这条灵感')?.trim()
    if (!content) return
    const requestedKind = window.prompt(`类型：${CARD_KINDS.map(([id, label]) => `${id}=${label}`).join('、')}`, 'premise') as InspirationCardKind | null
    const kind = CARD_KINDS.some(([id]) => id === requestedKind) ? requestedKind! : 'premise'
    const created = await apiClient.inspiration.createCard(conversation.id, { kind, title: content.slice(0, 40), content })
    setCards((items) => [created, ...items])
  }

  const convertToProject = async () => {
    if (!conversation) return
    const title = window.prompt('项目名称', conversation.title)?.trim()
    if (!title) return
    const selected = cards.filter((card) => card.adopted)
    const preview = await apiClient.inspiration.createProjectPreview({
      conversationId: conversation.id,
      title,
      projectMode: 'single_season',
      brief: { title, premise: selected.find((card) => card.kind === 'premise')?.content ?? '', source: 'inspiration-space' },
      cardIds: selected.map((card) => card.id),
      corpusItemIds: selectedCorpusIds,
    })
    if (!window.confirm(`预览：生成“${title}”的云端项目草稿和 Desktop 简报包，包含 ${selected.length} 张已采用卡片与 ${selectedCorpusIds.length} 条选中抽象语料。确认？`)) return
    const confirmed = await apiClient.inspiration.confirmProjectPreview(preview.id, crypto.randomUUID())
    await apiClient.inspiration.saveCloudProjectDraft(confirmed.cloudDraft)
    downloadPackage(title, confirmed.projectPackage)
    setNotice('云端项目草稿已保存，schema v4 简报包已下载；原对话仍独立保留。')
  }

  const createPrivateCorpusItem = async () => {
    const title = window.prompt('给这条有趣语料起个名字')?.trim()
    if (!title) return
    const mechanism = window.prompt('它为什么有趣？请记录可复用的创作机制，而不是堆积原文。')?.trim()
    if (!mechanism) return
    setCreativeBusy(true)
    try {
      await apiClient.creativeIntelligence.createPrivateItem({
        kind: 'meme',
        title,
        mechanism,
        contexts: ['灵感空间'],
        freshness: 'emerging',
      })
      await loadCreativeIntelligence(corpusQuery)
      setNotice('已保存到你的私有灵感库，不会公开或用于平台训练。')
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setCreativeBusy(false)
    }
  }

  const importCorpusUrl = async () => {
    const url = window.prompt('提交公开网页 URL。不会绕过登录、付费墙、验证码或 robots。')?.trim()
    if (!url) return
    try {
      await apiClient.creativeIntelligence.importUrl(url)
      setNotice('来源已进入隔离采集队列；通过权利与内容复核后才会进入公共库。')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const collectCorpusItem = async (item: CorpusItem) => {
    await apiClient.creativeIntelligence.collect({
      corpusItemId: item.id,
      title: item.title,
      mechanism: item.mechanism,
      tags: item.tags,
    })
    await loadCreativeIntelligence(corpusQuery)
    setNotice('已收藏为你的私有覆盖层；公共条目撤回时仍会保留你的原创备注。')
  }

  const runCreativeExperiment = async (source?: CorpusItem) => {
    const prompt = (source?.mechanism ?? experimentPrompt).trim()
    if (!prompt || !selectedModel || creativeBusy) return
    setCreativeBusy(true)
    try {
      const created = await apiClient.creativeIntelligence.createExperiment({
        originType: source ? 'corpus' : 'inspiration',
        originId: source?.id ?? conversation?.id,
        prompt,
        model: selectedModel.model,
        maxTokens: 1_024,
      }, crypto.randomUUID())
      setExperiments((items) => [created, ...items])
      setExperimentPrompt('')
      setToolTab('experiments')
      setNotice('三档候选已生成；只有采用、并列或全部拒绝后才会形成指纹证据。')
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setCreativeBusy(false)
    }
  }

  const reviewVariant = async (experiment: CreativeExperiment, variantId?: string) => {
    const updated = await apiClient.creativeIntelligence.reviewExperiment(experiment.id, {
      version: experiment.version,
      selectedVariantId: variantId,
      rejected: !variantId,
    })
    setExperiments((items) => items.map((item) => item.id === updated.id ? updated : item))
    setFingerprint(await apiClient.creativeIntelligence.getFingerprint())
    const selected = updated.variants.find((item) => item.id === variantId)
    if (selected && conversation && window.confirm('将采用结果同时保存为当前对话的灵感卡片？')) {
      const card = await apiClient.inspiration.createCard(conversation.id, {
        kind: 'premise',
        title: selected.title,
        content: selected.content,
      })
      setCards((items) => [card, ...items])
    }
  }

  return (
    <RequireAuth>
      <main className="mx-auto grid min-h-[calc(100vh-72px)] max-w-[1600px] gap-4 px-4 py-5 xl:grid-cols-[260px_minmax(0,1fr)_310px]">
        <aside className="flex min-h-0 flex-col rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust">独立创意对话</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-950">灵感空间</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">不先建项目，也不调用项目或文件工具。</p>
          <Button type="button" className="mt-5 w-full" onClick={newConversation}>新建对话</Button>
          <input className="mt-3 h-10 rounded-xl border border-stone-300 px-3 text-sm outline-none focus:border-rust" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索对话" />
          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {visibleConversations.map((item) => (
              <button key={item.id} type="button" className={`w-full rounded-xl px-3 py-2 text-left text-sm ${item.id === conversationId ? 'bg-orange-50 text-rust' : 'hover:bg-stone-50'}`} onClick={() => setConversationId(item.id)}>
                <span className="block truncate font-medium">{item.title}</span>
                <span className="mt-1 block text-xs text-stone-500">{MODES.find((entry) => entry.id === item.creativeMode)?.label}</span>
              </button>
            ))}
            {archivedCount ? <p className="pt-3 text-xs text-stone-500">另有已归档对话</p> : null}
          </div>
        </aside>

        <section className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div><h2 className="font-semibold text-stone-950">{conversation?.title ?? '新的灵感对话'}</h2><p className="mt-1 text-xs text-stone-500">云端持久化 · 策略 {conversation?.promptPolicyVersion ?? 'inspiration.v1'}</p></div>
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => void rename()} disabled={!conversation}>重命名</button>
              <button type="button" onClick={() => void fork()} disabled={!conversation}>分支</button>
              <button type="button" onClick={() => void archive()} disabled={!conversation}>归档</button>
              <button type="button" className="text-rose-700" onClick={() => void remove()} disabled={!conversation}>删除</button>
            </div>
          </header>
          <div className="flex gap-2 overflow-x-auto border-b border-stone-100 p-3">
            {MODES.map((entry) => (
              <button key={entry.id} type="button" className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${mode === entry.id ? 'border-rust bg-orange-50' : 'border-stone-200'}`} onClick={() => setMode(entry.id)}>
                <span className="block text-sm font-medium">{entry.label}</span><span className="block text-xs text-stone-500">{entry.description}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-6" aria-live="polite">
            {!messages.length && !active ? (
              <button type="button" className="rounded-2xl border border-dashed border-stone-300 p-5 text-left text-sm leading-6 text-stone-600 hover:border-rust" onClick={() => void send(MODES.find((entry) => entry.id === mode)?.starter)}>
                {MODES.find((entry) => entry.id === mode)?.starter}
              </button>
            ) : null}
            {messages.map((item) => <MessageBubble key={item.id} message={item} />)}
            {active ? <div className="mr-10 rounded-2xl rounded-tl-sm bg-stone-100 px-4 py-3 text-sm leading-7 text-stone-800">{active.assistantText || '正在思考…'}<span className="ml-1 animate-pulse">▍</span></div> : null}
          </div>
          <footer className="border-t border-stone-100 bg-stone-50/70 p-4">
            {notice ? <p className="mb-3 text-sm text-stone-600" role="status">{notice}</p> : null}
            <textarea className="min-h-28 w-full resize-y rounded-2xl border border-stone-300 bg-white p-3 text-sm leading-6 outline-none focus:border-rust" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="说出一个画面、人物、疑问，或任何尚未成形的念头…" disabled={Boolean(active)} />
            <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-stone-500">旧消息完整保存；摘要不会删除原文。</p>{active ? <Button type="button" variant="secondary" onClick={() => void apiClient.inspiration.cancelRun(active.conversationId, active.runId).then(() => setNotice('已请求停止，未结算额度会自动补偿。'))}>停止</Button> : <Button type="button" onClick={() => void send()} disabled={!prompt.trim() || !selectedModel || busy}>{busy ? '发送中…' : '发送'}</Button>}</div>
          </footer>
        </section>

        <aside className="min-h-0 space-y-4 overflow-y-auto">
          <nav className="grid grid-cols-2 gap-1 rounded-2xl border border-stone-200 bg-white p-1 text-xs shadow-sm">
            {([
              ['results', '灵感成果'],
              ['corpus', '灵感库'],
              ['experiments', '创意实验'],
              ['fingerprint', '我的指纹'],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" className={`rounded-xl px-2 py-2 ${toolTab === id ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'}`} onClick={() => setToolTab(id)}>{label}</button>
            ))}
          </nav>

          {toolTab === 'results' ? <>
            <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between"><div><h2 className="font-semibold">灵感成果</h2><p className="text-xs text-stone-500">只复制你采用的卡片</p></div><button type="button" className="text-sm text-rust" disabled={!conversation} onClick={() => void addCard()}>添加卡片</button></div>
              <div className="mt-3 space-y-2">
                {cards.map((card) => (
                  <label key={card.id} className="flex gap-2 rounded-2xl border border-stone-200 p-3 text-sm">
                    <input type="checkbox" checked={card.adopted} onChange={async (event) => {
                      const updated = await apiClient.inspiration.updateCard(card.id, { adopted: event.target.checked, version: card.version })
                      setCards((items) => items.map((item) => item.id === updated.id ? updated : item))
                    }} />
                    <span><strong>{card.title}</strong><span className="mt-1 block whitespace-pre-wrap text-xs leading-5 text-stone-500">{card.content}</span></span>
                  </label>
                ))}
                {!cards.length ? <p className="text-xs leading-5 text-stone-500">保存故事前提、人物、世界观、冲突、场景、风格或待探索问题。</p> : null}
              </div>
              <Button type="button" variant="secondary" className="mt-4 w-full" disabled={!conversation} onClick={() => void convertToProject()}>预览并转为项目</Button>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2"><div><h2 className="font-semibold">记忆中心</h2><p className="text-xs text-stone-500">每 6 轮批量整理，额度独立计量</p></div><label className="text-xs"><input className="mr-1" type="checkbox" checked={settings?.enabled ?? false} onChange={async (event) => setSettings(await apiClient.inspiration.updateMemorySettings(event.target.checked))} />自动学习</label></div>
              <div className="mt-3 space-y-2">
                {memories.map((memory) => (
                  <article key={memory.id} className={`rounded-2xl border border-stone-200 p-3 text-xs ${memory.status === 'disabled' ? 'opacity-50' : ''}`}>
                    <p className="whitespace-pre-wrap leading-5">{memory.content}</p>
                    <div className="mt-2 flex justify-between text-stone-500"><span>{memory.kind} · {Math.round(memory.confidence * 100)}% · {memory.sourceConversationIds.length} 个来源</span><button type="button" onClick={async () => {
                      const updated = await apiClient.inspiration.updateMemory(memory.id, { status: memory.status === 'active' ? 'disabled' : 'active', version: memory.version })
                      setMemories((items) => items.map((item) => item.id === updated.id ? updated : item))
                    }}>{memory.status === 'active' ? '停用' : '启用'}</button></div>
                  </article>
                ))}
                {!memories.length ? <p className="text-xs leading-5 text-stone-500">拒绝自动学习也会保留当前会话和摘要，但不会跨会话使用记忆。</p> : null}
              </div>
              <div className="mt-3 flex gap-3 text-xs"><button type="button" disabled={!conversation} onClick={() => conversation && void apiClient.inspiration.rebuildMemories(conversation.id).then(() => setNotice('已加入重新整理队列。'))}>重新整理</button><button type="button" className="text-rose-700" onClick={async () => { if (window.confirm('清空全部长期创意记忆？')) { await apiClient.inspiration.clearMemories(); setMemories([]) } }}>清空</button></div>
              {memoryJobs[0] ? <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-[11px] leading-5 text-stone-500">最近整理：{memoryJobs[0].status === 'completed' ? `${memoryJobs[0].model ?? '未知模型'} · ${memoryJobs[0].promptTokens + memoryJobs[0].completionTokens} Token` : `待整理 · ${memoryJobs[0].errorCode ?? '等待后台处理'}`}</p> : null}
            </section>
          </> : null}

          {toolTab === 'corpus' ? <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">创意语料网络</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">收藏梗、喜剧机制和故事钩子；长期保存的是抽象机制与短摘录，不是网页全文。</p>
            <div className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm" value={corpusQuery} onChange={(event) => setCorpusQuery(event.target.value)} placeholder="搜索机制、场景、标签" /><button type="button" className="text-sm text-rust" onClick={() => void loadCreativeIntelligence(corpusQuery)}>搜索</button></div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs"><button type="button" onClick={() => void createPrivateCorpusItem()} disabled={creativeBusy}>添加私有语料</button><button type="button" onClick={() => void importCorpusUrl()}>提交公开网页</button><span className="text-stone-500">已收藏 {collections.length}</span></div>
            <div className="mt-4 space-y-2">
              {corpusItems.map((item) => <article key={item.id} className="rounded-2xl border border-stone-200 p-3 text-xs">
                <div className="flex items-start justify-between gap-2"><strong>{item.title}</strong><span className="shrink-0 text-stone-400">{item.visibility === 'private' ? '私有' : item.freshness}</span></div>
                <p className="mt-2 whitespace-pre-wrap leading-5 text-stone-600">{item.mechanism}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-rust"><button type="button" disabled={item.visibility === 'private' || collections.some((entry) => entry.corpusItemId === item.id)} onClick={() => void collectCorpusItem(item)}>{collections.some((entry) => entry.corpusItemId === item.id) ? '已收藏' : '收藏'}</button><button type="button" onClick={() => setSelectedCorpusIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}>{selectedCorpusIds.includes(item.id) ? '已选入简报' : '选入简报'}</button><button type="button" onClick={() => void runCreativeExperiment(item)}>拿去实验</button></div>
              </article>)}
              {!corpusItems.length ? <p className="text-xs text-stone-500">暂无匹配内容。可以先记录一条属于自己的有趣机制。</p> : null}
            </div>
          </section> : null}

          {toolTab === 'experiments' ? <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">创意实验室</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">固定生成稳健、平衡、大胆三档候选。默认隐藏来源，以六个维度辅助比较。</p>
            <p className="mt-1 text-[11px] leading-5 text-stone-400">开始后调用当前模型 3 次，输出上限合计约 3,072 Token；按实际 Token 扣减额度，金额以服务商账单为准。</p>
            <textarea className="mt-3 min-h-24 w-full rounded-xl border border-stone-300 p-3 text-sm" value={experimentPrompt} onChange={(event) => setExperimentPrompt(event.target.value)} placeholder="输入想要变奏的前提、冲突或机制…" />
            <Button type="button" className="mt-2 w-full" disabled={!experimentPrompt.trim() || creativeBusy || !selectedModel} onClick={() => void runCreativeExperiment()}>{creativeBusy ? '三档生成中…' : '开始三档实验'}</Button>
            <div className="mt-4 space-y-4">{experiments.map((experiment) => <article key={experiment.id} className="rounded-2xl border border-stone-200 p-3 text-xs">
              <p className="line-clamp-2 font-medium">{experiment.prompt}</p><p className="mt-1 text-stone-400">{experiment.model} · {experiment.promptTokens + experiment.completionTokens} Token · {experiment.status}</p>
              <div className="mt-3 space-y-2">{experiment.variants.map((variant) => <div key={variant.id} className={`rounded-xl p-3 ${variant.selected ? 'bg-orange-50 ring-1 ring-rust' : 'bg-stone-50'}`}><strong>{variant.lane === 'conservative' ? '稳健' : variant.lane === 'balanced' ? '平衡' : '大胆'} · {variant.title}</strong><p className="mt-1 whitespace-pre-wrap leading-5 text-stone-600">{variant.content}</p>{experiment.status === 'ready' ? <button type="button" className="mt-2 text-rust" onClick={() => void reviewVariant(experiment, variant.id)}>采用这个方向</button> : null}</div>)}</div>
              {experiment.status === 'ready' ? <button type="button" className="mt-3 text-rose-700" onClick={() => void reviewVariant(experiment)}>全部拒绝</button> : null}
            </article>)}</div>
          </section> : null}

          {toolTab === 'fingerprint' ? <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">个人创意指纹</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">与长期记忆分开授权；只使用你明确采用、拒绝、评分或保存的结果，不扫描完整对话和文件，也不用于平台训练。</p>
            <label className="mt-4 flex items-center justify-between rounded-2xl bg-stone-50 p-3 text-sm"><span>{fingerprint?.enabled ? '学习已开启' : '尚未授权'}</span><input type="checkbox" checked={fingerprint?.enabled ?? false} onChange={async (event) => {
              if (event.target.checked && !window.confirm('单独授权尽意 DramaIP 根据你明确采用、拒绝、评分和保存的结果学习个人创意指纹？')) return
              setFingerprint(await apiClient.creativeIntelligence.setFingerprintEnabled(event.target.checked))
            }} /></label>
            <div className="mt-4 space-y-2">{fingerprint?.dimensions.map((dimension) => <div key={dimension.key} className={`rounded-xl border border-stone-200 p-3 text-xs ${dimension.frozen ? 'opacity-60' : ''}`}><div className="flex justify-between"><strong>{dimension.key}</strong><span>{Math.round(dimension.score * 100)}% · 置信 {Math.round(dimension.confidence * 100)}%</span></div><div className="mt-2 h-1.5 rounded-full bg-stone-100"><div className="h-full rounded-full bg-rust" style={{ width: `${dimension.score * 100}%` }} /></div><button type="button" className="mt-2 text-stone-500" onClick={async () => setFingerprint(await apiClient.creativeIntelligence.updateFingerprint({ version: fingerprint.version, dimensions: [{ key: dimension.key, frozen: !dimension.frozen }] }))}>{dimension.frozen ? '解除冻结' : '冻结维度'}</button></div>)}</div>
            <button type="button" className="mt-4 text-xs text-rose-700" onClick={async () => { if (window.confirm('清空创意指纹和全部证据？此操作不会删除对话或灵感卡。')) { await apiClient.creativeIntelligence.clearFingerprint(); setFingerprint(await apiClient.creativeIntelligence.getFingerprint()) } }}>撤回授权并清空</button>
          </section> : null}
        </aside>
      </main>
    </RequireAuth>
  )
}

function MessageBubble({ message }: { message: InspirationMessage }) {
  return (
    <article className={message.role === 'user' ? 'ml-10 rounded-2xl rounded-tr-sm bg-stone-900 px-4 py-3 text-sm leading-7 text-white' : 'mr-10 rounded-2xl rounded-tl-sm bg-stone-100 px-4 py-3 text-sm leading-7 text-stone-800'}>
      <p className="whitespace-pre-wrap">{message.content}</p>
      {message.role === 'assistant' ? <p className="mt-2 text-[11px] opacity-60">{message.promptTokens + message.completionTokens} Token</p> : null}
    </article>
  )
}

function readLegacyHistory(key: string): { role: 'user' | 'assistant'; content: string }[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      return (record.role === 'user' || record.role === 'assistant') && typeof record.content === 'string' && record.content.trim()
        ? [{ role: record.role as 'user' | 'assistant', content: record.content }]
        : []
    }).slice(0, 500)
  } catch {
    return []
  }
}

function downloadPackage(title: string, value: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '-') || 'dramaip-inspiration'}.dramaip.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function errorMessage(error: unknown) {
  const parsed = parseApiError(error)
  return parsed.message || parsed.code || '操作失败，请稍后重试。'
}
