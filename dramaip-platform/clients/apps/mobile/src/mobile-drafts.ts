import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { MobileDraftResponseSchema, MobileExpansionResponseSchema } from '@dramaip/sdk/contracts'
import { authorizedMobileRequest } from './mobile-session'

const DRAFT_QUEUE_KEY = 'com.dramaip.mobile.draft-outbox.v1'
const MAX_LOCAL_DRAFTS = 100

export type MobileDraftKind = 'inspiration' | 'character' | 'project'
export type MobileCaptureMode = 'text' | 'voice'

export interface LocalMobileDraft {
  clientId: string
  kind: MobileDraftKind
  captureMode: MobileCaptureMode
  title: string
  content: string
  aiExpansion: string
  createdAt: string
  syncedAt?: string
}

export interface QueueDraftInput {
  kind: MobileDraftKind
  captureMode: MobileCaptureMode
  title: string
  content: string
  aiExpansion?: string
}

export async function listLocalDrafts(): Promise<LocalMobileDraft[]> {
  const raw = await AsyncStorage.getItem(DRAFT_QUEUE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLocalDraft).slice(0, MAX_LOCAL_DRAFTS)
  } catch {
    return []
  }
}

export async function queueDraft(input: QueueDraftInput): Promise<LocalMobileDraft> {
  const title = input.title.trim()
  const content = input.content.trim()
  const aiExpansion = input.aiExpansion?.trim() ?? ''
  if (!title || !content || title.length > 120 || content.length > 3_000 || aiExpansion.length > 2_400) {
    throw new Error('草稿长度或内容无效')
  }
  const draft: LocalMobileDraft = {
    clientId: newClientID(), kind: input.kind, captureMode: input.captureMode,
    title, content, aiExpansion, createdAt: new Date().toISOString(),
  }
  const current = await listLocalDrafts()
  await writeLocalDrafts([draft, ...current].slice(0, MAX_LOCAL_DRAFTS))
  return draft
}

// A replay retains clientId, so an interrupted network request can be retried
// without producing a second cloud draft. Local records are never deleted by
// a failed request; the user can export them even while offline.
export async function syncQueuedDrafts(): Promise<{ synced: number; pending: number }> {
  const drafts = await listLocalDrafts()
  let synced = 0
  const next: LocalMobileDraft[] = []
  for (const draft of drafts) {
    if (draft.syncedAt) {
      next.push(draft)
      continue
    }
    try {
      const response = await authorizedMobileRequest('/v1/mobile/drafts', {
        method: 'POST',
        body: JSON.stringify({
          client_id: draft.clientId, kind: draft.kind, capture_mode: draft.captureMode,
          title: draft.title, content: draft.content, ai_expansion: draft.aiExpansion,
        }),
      })
      MobileDraftResponseSchema.parse(response)
      next.push({ ...draft, syncedAt: new Date().toISOString() })
      synced += 1
    } catch {
      next.push(draft)
    }
  }
  await writeLocalDrafts(next)
  return { synced, pending: next.filter((draft) => !draft.syncedAt).length }
}

export async function expandMobileDraft(kind: MobileDraftKind, content: string): Promise<string> {
  const text = content.trim()
  if (!text || Array.from(text).length > 1_500) throw new Error('扩写内容需要在 1,500 字符以内')
  const response = await authorizedMobileRequest('/v1/mobile/ai/expand', {
    method: 'POST', body: JSON.stringify({ idempotency_key: newClientID(), kind, content: text }),
  })
  const payload = MobileExpansionResponseSchema.safeParse(response)
  if (!payload.success) throw new Error('扩写响应无效')
  return payload.data.expansion.trim()
}

export async function exportLocalDrafts(): Promise<{ uri: string; shared: boolean }> {
  const drafts = await listLocalDrafts()
  if (!drafts.length) throw new Error('暂无可导出的本地草稿')
  if (!FileSystem.cacheDirectory) throw new Error('当前设备不支持草稿导出')
  const uri = `${FileSystem.cacheDirectory}dramaip-mobile-handoff.json`
  const packagePayload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    items: drafts.map((draft) => ({
      title: draft.title,
      kind: desktopKind(draft.kind),
      pattern: [draft.content, draft.aiExpansion].filter(Boolean).join('\n\n'),
      applyTo: draft.kind === 'character' ? '人物设定候选' : draft.kind === 'project' ? '项目方向候选' : '灵感台候选',
      risk: `来自移动端${draft.captureMode === 'voice' ? '语音转写' : '文字'}草稿；采用前请人工核对。`,
    })),
  }
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(packagePayload, null, 2), { encoding: FileSystem.EncodingType.UTF8 })
  if (!(await Sharing.isAvailableAsync())) return { uri, shared: false }
  await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: '发送到 DramaIP Desktop 导入' })
  return { uri, shared: true }
}

async function writeLocalDrafts(drafts: LocalMobileDraft[]): Promise<void> {
  await AsyncStorage.setItem(DRAFT_QUEUE_KEY, JSON.stringify(drafts))
}

function isLocalDraft(value: unknown): value is LocalMobileDraft {
  const draft = record(value)
  return typeof draft.clientId === 'string' && draft.clientId.length >= 8 && isKind(draft.kind) && isCaptureMode(draft.captureMode) &&
    typeof draft.title === 'string' && typeof draft.content === 'string' && typeof draft.aiExpansion === 'string' && typeof draft.createdAt === 'string' &&
    (draft.syncedAt === undefined || typeof draft.syncedAt === 'string')
}

function isKind(value: unknown): value is MobileDraftKind { return value === 'inspiration' || value === 'character' || value === 'project' }
function isCaptureMode(value: unknown): value is MobileCaptureMode { return value === 'text' || value === 'voice' }
function desktopKind(kind: MobileDraftKind): string { return kind === 'character' ? 'relationship' : kind === 'project' ? 'opening' : 'conflict' }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function newClientID(): string { return globalThis.crypto?.randomUUID?.() ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}` }
