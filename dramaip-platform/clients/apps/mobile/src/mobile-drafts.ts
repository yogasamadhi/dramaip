import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { MobileDraftDeleteResponseSchema, MobileDraftPageSchema, MobileDraftResponseSchema, MobileExpansionResponseSchema, type MobileDraft } from '@dramaip/sdk/contracts'
import { authorizedMobileRequest } from './mobile-session'

const DRAFT_QUEUE_KEY = 'com.dramaip.mobile.draft-outbox.v1'
const MAX_LOCAL_DRAFTS = 300

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
  cloudId?: string
  syncedAt?: string
  pendingDelete?: boolean
  syncError?: string
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
    return parsed.filter(isLocalDraft).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
  if (current.filter((item) => !item.pendingDelete).length >= MAX_LOCAL_DRAFTS) throw new Error(`本地草稿已达 ${MAX_LOCAL_DRAFTS} 条，请同步、导出或删除后再继续`)
  await writeLocalDrafts([draft, ...current])
  return draft
}

export async function updateLocalDraft(clientId: string, input: QueueDraftInput): Promise<LocalMobileDraft> {
  const drafts = await listLocalDrafts()
  const current = drafts.find((draft) => draft.clientId === clientId && !draft.pendingDelete)
  if (!current) throw new Error('找不到要编辑的草稿')
  const title = input.title.trim(); const content = input.content.trim(); const aiExpansion = input.aiExpansion?.trim() ?? ''
  if (!title || !content || title.length > 120 || content.length > 3_000 || aiExpansion.length > 2_400) throw new Error('草稿长度或内容无效')
  const updated = { ...current, kind: input.kind, captureMode: input.captureMode, title, content, aiExpansion, syncedAt: undefined, syncError: undefined }
  await writeLocalDrafts(drafts.map((draft) => draft.clientId === clientId ? updated : draft))
  return updated
}

export async function markLocalDraftForDeletion(clientId: string): Promise<void> {
  const drafts = await listLocalDrafts()
  const target = drafts.find((draft) => draft.clientId === clientId)
  if (!target) return
  if (!target.cloudId) { await writeLocalDrafts(drafts.filter((draft) => draft.clientId !== clientId)); return }
  await writeLocalDrafts(drafts.map((draft) => draft.clientId === clientId ? { ...draft, pendingDelete: true, syncError: undefined } : draft))
}

// A replay retains clientId, so an interrupted network request can be retried
// without producing a second cloud draft. Local records are never deleted by
// a failed request; the user can export them even while offline.
export async function syncQueuedDrafts(): Promise<{ synced: number; deleted: number; pending: number; failed: number }> {
  const drafts = await listLocalDrafts()
  let synced = 0; let deleted = 0
  const next: LocalMobileDraft[] = []
  for (const draft of drafts) {
    if (draft.pendingDelete && draft.cloudId) {
      try {
        const response = await authorizedMobileRequest(`/v1/mobile/drafts/${encodeURIComponent(draft.cloudId)}`, { method: 'DELETE' })
        MobileDraftDeleteResponseSchema.parse(response)
        deleted += 1
        continue
      } catch (error) {
        next.push({ ...draft, syncError: error instanceof Error ? error.message : '云端删除失败' })
        continue
      }
    }
    if (draft.pendingDelete || draft.syncedAt) {
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
      const remote = MobileDraftResponseSchema.parse(response).draft
      next.push(fromRemote(draft, remote))
      synced += 1
    } catch (error) {
      next.push({ ...draft, syncError: error instanceof Error ? error.message : '同步失败' })
    }
  }
  await writeLocalDrafts(next)
  const pending = next.filter((draft) => !draft.syncedAt || draft.pendingDelete).length
  return { synced, deleted, pending, failed: next.filter((draft) => Boolean(draft.syncError)).length }
}

export async function listCloudDraftPage(cursor = ''): Promise<{ drafts: MobileDraft[]; nextCursor: string }> {
  const params = new URLSearchParams({ limit: '50' }); if (cursor) params.set('cursor', cursor)
  const response = await authorizedMobileRequest(`/v1/mobile/drafts?${params}`, { method: 'GET' })
  const page = MobileDraftPageSchema.parse(response)
  return { drafts: page.drafts, nextCursor: page.next_cursor }
}

export async function deleteCloudDraft(draftID: string): Promise<void> {
  MobileDraftDeleteResponseSchema.parse(await authorizedMobileRequest(`/v1/mobile/drafts/${encodeURIComponent(draftID)}`, { method: 'DELETE' }))
  const drafts = await listLocalDrafts()
  await writeLocalDrafts(drafts.filter((draft) => draft.cloudId !== draftID))
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
    (draft.cloudId === undefined || typeof draft.cloudId === 'string') && (draft.syncedAt === undefined || typeof draft.syncedAt === 'string') &&
    (draft.pendingDelete === undefined || typeof draft.pendingDelete === 'boolean') && (draft.syncError === undefined || typeof draft.syncError === 'string')
}

function isKind(value: unknown): value is MobileDraftKind { return value === 'inspiration' || value === 'character' || value === 'project' }
function isCaptureMode(value: unknown): value is MobileCaptureMode { return value === 'text' || value === 'voice' }
function desktopKind(kind: MobileDraftKind): string { return kind === 'character' ? 'relationship' : kind === 'project' ? 'opening' : 'conflict' }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function newClientID(): string { return globalThis.crypto?.randomUUID?.() ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}` }
function fromRemote(local: LocalMobileDraft, remote: MobileDraft): LocalMobileDraft { return { ...local, cloudId: remote.id, syncedAt: new Date().toISOString(), pendingDelete: false, syncError: undefined } }
