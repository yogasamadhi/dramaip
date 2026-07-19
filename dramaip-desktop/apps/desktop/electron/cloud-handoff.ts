import { withCloudAccessToken } from './cloud-auth'
import { DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION } from './cloud-contract'

const HANDOFF_TIMEOUT_MS = 15_000

export interface CloudMobileDraft {
  id: string
  clientId: string
  kind: 'inspiration' | 'character' | 'project'
  captureMode: 'text' | 'voice'
  title: string
  content: string
  aiExpansion: string
  createdAt: string
  updatedAt: string
}

export async function listCloudMobileDrafts(): Promise<CloudMobileDraft[]> {
  const payload = await cloudRequest('/v1/desktop/mobile-handoff?limit=50', { method: 'GET' }) as { drafts?: unknown }
  if (!Array.isArray(payload.drafts)) throw new Error('移动交接列表响应无效')
  return payload.drafts.map(parseDraft)
}

export async function adoptCloudMobileDraft(draftID: string, idempotencyKey: string): Promise<CloudMobileDraft> {
  const payload = await cloudRequest('/v1/desktop/mobile-handoff/adopt', {
    method: 'POST', body: JSON.stringify({ draft_id: draftID, idempotency_key: idempotencyKey }),
  }) as { draft?: unknown }
  return parseDraft(payload.draft)
}

async function cloudRequest(path: string, init: RequestInit): Promise<unknown> {
  return withCloudAccessToken(async ({ bffOrigin }, accessToken) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HANDOFF_TIMEOUT_MS)
    try {
      const response = await fetch(`${bffOrigin}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, [DESKTOP_CONTRACT_HEADER]: DESKTOP_CONTRACT_VERSION, ...(init.headers ?? {}) },
      })
      if (!response.ok) throw new Error(`移动交接请求失败（${response.status}）`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  })
}

function parseDraft(value: unknown): CloudMobileDraft {
  const draft = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const id = text(draft.id)
  const clientId = text(draft.client_id)
  const kind = text(draft.kind)
  const captureMode = text(draft.capture_mode)
  const title = text(draft.title)
  const content = text(draft.content)
  const aiExpansion = typeof draft.ai_expansion === 'string' ? draft.ai_expansion : ''
  const createdAt = typeof draft.created_at === 'string' ? draft.created_at : ''
  const updatedAt = typeof draft.updated_at === 'string' ? draft.updated_at : ''
  if (!id || !clientId || !title || !content || (kind !== 'inspiration' && kind !== 'character' && kind !== 'project') || (captureMode !== 'text' && captureMode !== 'voice')) {
    throw new Error('移动交接草稿数据无效')
  }
  return { id, clientId, kind, captureMode, title, content, aiExpansion, createdAt, updatedAt }
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
