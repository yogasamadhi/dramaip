import { app, clipboard } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import type { ReviewComment, ReviewDecision, ReviewPackageRecord } from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { withCloudAccessToken } from './cloud-auth'
import { DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION } from './cloud-contract'
import { mirrorReviewCommentsToFeedback, prepareCloudReviewStaging, type TimelineScope } from './review-editor'

const REQUEST_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 120_000

interface CloudWorkspace {
  id: string
  name: string
  planCode: string
  currentUserRole: 'owner' | 'admin' | 'member'
  includedSeats: number
  reviewStorageBytes: number
  reviewRetentionDays: number
}

interface CloudUploadTarget {
  mediaID: string
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

interface CloudCreatedPackage {
  packageID: string
  shareToken: string
  expiresAt: string
  uploadTargets: CloudUploadTarget[]
}

export interface PublishCloudReviewInput extends TimelineScope {
  workspaceId: string
  pin?: string
}

export async function listCloudReviewWorkspaces(): Promise<CloudWorkspace[]> {
  assertCloudReviewEnabled()
  const payload = await cloudRequest('/api/v1/workspaces', { method: 'GET' })
  const items = Array.isArray(payload) ? payload : object(payload).workspaces
  if (!Array.isArray(items)) throw new Error('云端工作区响应无效')
  return items.map(parseWorkspace)
}

export async function publishCloudReview(repos: Repositories, input: PublishCloudReviewInput): Promise<{
  published: boolean
  packageId?: string
  expiresAt?: string
  shareLinkCopied?: boolean
  error?: string
}> {
  assertCloudReviewEnabled()
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.workspaceId)) return { published: false, error: '请选择有效的 Studio 工作区' }
  if (input.pin && !/^[0-9]{4,12}$/.test(input.pin)) return { published: false, error: '审片 PIN 必须为 4–12 位数字' }
  const staging = await prepareCloudReviewStaging(repos, input)
  let localRecord: ReviewPackageRecord | undefined
  let remotePackageID = ''
  try {
    localRecord = repos.productionStudio.createReviewPackageRecord(repos.db, {
      projectId: input.projectId,
      adaptationProjectId: input.adaptationProjectId,
      episodeId: input.episodeId,
      kind: 'cloud',
      status: 'uploading',
      title: staging.manifest.title,
      manifest: staging.manifest,
    })
    const created = parseCreatedPackage(await cloudRequest('/api/v1/review-packages', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        desktopPackageId: staging.manifest.packageId,
        title: staging.manifest.title,
        manifestJson: JSON.stringify(staging.manifest),
        pin: input.pin ?? '',
        media: staging.media.map((item) => ({
          id: item.id,
          relativePath: item.relativePath,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          sha256: item.sha256,
        })),
      }),
    }))
    remotePackageID = created.packageID
    repos.productionStudio.updateReviewPackageRecord(repos.db, localRecord.id, {
      cloudPackageId: created.packageID,
      expiresAt: created.expiresAt,
    })
    const targets = new Map(created.uploadTargets.map((target) => [target.mediaID, target]))
    for (const media of staging.media) {
      let target = targets.get(media.id)
      if (!target) throw new Error(`云端未返回媒体 ${media.id} 的上传目标`)
      try {
        await uploadMedia(media.filePath, target)
      } catch (error) {
        if (!isExpiredUploadError(error)) throw error
        target = parseUploadTarget(await cloudRequest(`/api/v1/review-packages/${encodeURIComponent(created.packageID)}/media/${encodeURIComponent(media.id)}/upload-target`, {
          method: 'POST',
        }))
        await uploadMedia(media.filePath, target)
      }
    }
    const completed = parseCompletedPackage(await cloudRequest(`/api/v1/review-packages/${encodeURIComponent(created.packageID)}/complete`, {
      method: 'POST',
    }))
    repos.productionStudio.updateReviewPackageRecord(repos.db, localRecord.id, {
      status: 'published',
      cloudPackageId: created.packageID,
      expiresAt: completed.expiresAt || created.expiresAt,
      syncCursor: '0',
      errorMessage: undefined,
    })
    const publicOrigin = await cloudPublicWebOrigin()
    clipboard.writeText(`${publicOrigin}/review/${encodeURIComponent(created.shareToken)}`)
    repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
      eventName: 'review_published',
      appVersion: app.getVersion(),
      operatingSystem: process.platform,
    })
    return {
      published: true,
      packageId: localRecord.id,
      expiresAt: completed.expiresAt || created.expiresAt,
      shareLinkCopied: true,
    }
  } catch (error) {
    if (remotePackageID) {
      await cloudRequest(`/api/v1/review-packages/${encodeURIComponent(remotePackageID)}`, { method: 'DELETE' }).catch(() => undefined)
    }
    if (localRecord) {
      repos.productionStudio.updateReviewPackageRecord(repos.db, localRecord.id, {
        status: 'failed',
        errorMessage: safeError(error),
      })
    }
    return { published: false, packageId: localRecord?.id, error: safeError(error) }
  } finally {
    await rm(staging.directory, { recursive: true, force: true })
  }
}

export async function syncCloudReviews(repos: Repositories, projectId: string, episodeId?: string): Promise<void> {
  if (!cloudReviewEnabled()) return
  const records = repos.productionStudio.listReviewPackageRecords(repos.db, projectId, episodeId)
    .filter((record) => record.kind === 'cloud' && record.cloudPackageId && ['published', 'expired'].includes(record.status))
  for (const record of records) {
    const afterCursor = Number.parseInt(record.syncCursor ?? '0', 10)
    try {
      const cursorQuery = Number.isSafeInteger(afterCursor) && afterCursor >= 0 ? afterCursor : 0
      const payload = await cloudRequest(`/api/v1/review-packages/${encodeURIComponent(record.cloudPackageId!)}/sync?afterCursor=${cursorQuery}`, { method: 'GET' }) as Record<string, unknown>
      const comments = Array.isArray(payload.comments) ? payload.comments.map((value) => parseComment(value, record.id)) : []
      const decisions = Array.isArray(payload.decisions) ? payload.decisions.map((value) => parseDecision(value, record.id)) : []
      for (const comment of comments) repos.productionStudio.upsertReviewComment(repos.db, comment)
      mirrorReviewCommentsToFeedback(repos, record, comments, 'DramaIP 云审片')
      for (const decision of decisions) {
        if (!repos.productionStudio.listReviewDecisions(repos.db, record.id).some((item) => item.id === decision.id)) {
          repos.productionStudio.insertReviewDecision(repos.db, decision)
        }
      }
      const cursor = number(payload.next_cursor ?? payload.nextCursor)
      repos.productionStudio.updateReviewPackageRecord(repos.db, record.id, { syncCursor: String(cursor) })
    } catch (error) {
      if (safeError(error).includes('404') || safeError(error).includes('410')) {
        repos.productionStudio.updateReviewPackageRecord(repos.db, record.id, { status: 'expired', errorMessage: '云端审片包已到期或删除' })
        continue
      }
      throw error
    }
  }
}

export async function deleteCloudReview(repos: Repositories, id: string): Promise<ReviewPackageRecord | undefined> {
  const record = repos.productionStudio.getReviewPackageRecord(repos.db, id)
  if (!record) return undefined
  if (record.kind === 'cloud' && record.cloudPackageId && !['deleted', 'expired'].includes(record.status)) {
    await cloudRequest(`/api/v1/review-packages/${encodeURIComponent(record.cloudPackageId)}`, { method: 'DELETE' })
  }
  return repos.productionStudio.updateReviewPackageRecord(repos.db, id, {
    status: 'deleted',
    outputPath: undefined,
    errorMessage: undefined,
  })
}

async function cloudRequest(path: string, init: RequestInit): Promise<unknown> {
  return withCloudAccessToken(async ({ bffOrigin }, accessToken) => {
    const response = await fetchWithTimeout(`${bffOrigin}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        [DESKTOP_CONTRACT_HEADER]: DESKTOP_CONTRACT_VERSION,
        ...(init.headers ?? {}),
      },
    }, REQUEST_TIMEOUT_MS)
    if (!response.ok) throw new Error(`云审片请求失败（${response.status}）`)
    if (response.status === 204) return {}
    const envelope = object(await response.json())
    if (text(envelope.code) !== 'OK') throw new Error(`云审片请求失败（${text(envelope.code) || 'unknown'}）`)
    return envelope.data
  })
}

async function cloudPublicWebOrigin(): Promise<string> {
  return withCloudAccessToken(async ({ webOrigin }) => webOrigin.replace(/\/+$/, ''))
}

async function uploadMedia(filePath: string, target: CloudUploadTarget): Promise<void> {
  const bytes = await readFile(filePath)
  const response = await fetchWithTimeout(target.url, {
    method: 'PUT',
    headers: { ...target.headers, 'Content-Length': String(bytes.byteLength) },
    body: new Uint8Array(bytes),
  }, UPLOAD_TIMEOUT_MS)
  if (!response.ok) throw new Error(`审片媒体上传失败（${response.status}）`)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMS: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function parseWorkspace(value: unknown): CloudWorkspace {
  const row = object(value)
  const id = text(row.id)
  const role = text(row.current_user_role ?? row.currentUserRole)
  if (!id || !['owner', 'admin', 'member'].includes(role)) throw new Error('云端工作区条目无效')
  return {
    id,
    name: text(row.name) || '未命名工作区',
    planCode: text(row.plan_code ?? row.planCode),
    currentUserRole: role as CloudWorkspace['currentUserRole'],
    includedSeats: number(row.included_seats ?? row.includedSeats),
    reviewStorageBytes: number(row.review_storage_bytes ?? row.reviewStorageBytes),
    reviewRetentionDays: number(row.review_retention_days ?? row.reviewRetentionDays),
  }
}

function parseCreatedPackage(value: unknown): CloudCreatedPackage {
  const row = object(value)
  const reviewPackage = object(row.package)
  const shareToken = text(row.share_token ?? row.shareToken)
  const packageID = text(reviewPackage.id)
  const targets = row.upload_targets ?? row.uploadTargets
  if (!packageID || !/^[A-Za-z0-9_-]{43}$/.test(shareToken) || !Array.isArray(targets)) throw new Error('创建云审片包响应无效')
  return {
    packageID,
    shareToken,
    expiresAt: text(reviewPackage.expires_at ?? reviewPackage.expiresAt),
    uploadTargets: targets.map(parseUploadTarget),
  }
}

function parseCompletedPackage(value: unknown): { expiresAt: string } {
  const row = object(value)
  if (!text(row.id) || text(row.status) !== 'published') throw new Error('云审片包完成响应无效')
  return { expiresAt: text(row.expires_at ?? row.expiresAt) }
}

function parseUploadTarget(value: unknown): CloudUploadTarget {
  const row = object(value)
  const mediaID = text(row.media_id ?? row.mediaId)
  const url = text(row.url)
  const method = text(row.method)
  const values = row.required_headers ?? row.requiredHeaders
  if (!mediaID || method !== 'PUT' || !url.startsWith('http') || !Array.isArray(values)) throw new Error('云审片上传目标无效')
  const headers: Record<string, string> = {}
  for (const value of values) {
    const header = object(value)
    const name = text(header.name)
    const content = text(header.value)
    if (!name || /^(authorization|cookie|host)$/i.test(name)) throw new Error('云审片上传请求头无效')
    headers[name] = content
  }
  return { mediaID, method: 'PUT', url, headers }
}

function parseComment(value: unknown, packageId: string): ReviewComment {
  const row = object(value)
  const id = text(row.id)
  const body = text(row.body)
  if (!id || !body) throw new Error('云审片评论响应无效')
  return {
    id,
    packageId,
    shotId: text(row.shot_id ?? row.shotId) || undefined,
    timecodeSeconds: optionalNumber(row.timecode_seconds ?? row.timecodeSeconds),
    authorAlias: text(row.author_alias ?? row.authorAlias) || undefined,
    body,
    resolved: Boolean(row.resolved),
    createdAt: text(row.created_at ?? row.createdAt),
    updatedAt: text(row.updated_at ?? row.updatedAt),
  }
}

function parseDecision(value: unknown, packageId: string): ReviewDecision {
  const row = object(value)
  const id = text(row.id)
  const decision = text(row.decision)
  if (!id || !['approve', 'return', 'request_changes', 'note'].includes(decision)) throw new Error('云审片决定响应无效')
  return {
    id,
    packageId,
    shotId: text(row.shot_id ?? row.shotId) || undefined,
    decision: decision as ReviewDecision['decision'],
    authorAlias: text(row.author_alias ?? row.authorAlias) || undefined,
    note: text(row.note) || undefined,
    createdAt: text(row.created_at ?? row.createdAt),
  }
}

function cloudReviewEnabled(): boolean {
  return process.env['DRAMAIP_FEATURE_CLOUD_REVIEW'] === 'true'
}
function assertCloudReviewEnabled(): void {
  if (!cloudReviewEnabled()) throw new Error('云审片功能尚未通过当前发布门禁')
}
function isExpiredUploadError(error: unknown): boolean {
  const message = safeError(error)
  return message.includes('403') || message.includes('408')
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[A-Za-z0-9_-]{43,}/g, '[已隐藏]').slice(0, 1_000)
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('云审片响应无效')
  return value as Record<string, unknown>
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
