import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectProjectPackage, importProjectPackage, parseProjectPackage, serializeProjectPackage } from '@sdns/export'
import { getRepos } from './db'
import { withCloudAccessToken } from './cloud-auth'
import { DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION } from './cloud-contract'
import { localCredentialStore } from './local-credential-store'
import {
  createProjectSnapshotRecoveryKey,
  decryptProjectSnapshot,
  encryptProjectSnapshot,
  parseProjectSnapshotEnvelope,
} from './project-snapshot-crypto'

const SNAPSHOT_TIMEOUT_MS = 30_000
const SNAPSHOT_CREDENTIAL_SERVICE = 'com.sdns.studio.project-snapshot-recovery'
const MAX_INLINE_ENCRYPTED_ENVELOPE_BYTES = 8 << 20
const MAX_ENCRYPTED_ENVELOPE_BYTES = 64 << 20
const SNAPSHOT_UPLOAD_CHUNK_BYTES = 1 << 20
const SNAPSHOT_UPLOAD_STAGING_DIR = 'project-snapshot-uploads'
const SNAPSHOT_UPLOAD_STAGING_RETENTION_MS = 24 * 60 * 60 * 1000

export interface CloudProjectSnapshot {
  id: string
  encryptedBytes: number
  encryptedSha256: string
  createdAt: string
  expiresAt: string
  recoveryKeyAvailable: boolean
}

export interface CreatedCloudProjectSnapshot extends CloudProjectSnapshot {
  // Returned once so the UI can ask the user to save it in their own password
  // manager. It is also stored in the prompt-free local credential file, never
  // in SQLite or the remote API.
  recoveryKey: string
}

interface StagedCloudProjectSnapshot {
  version: 1
  projectID: string
  idempotencyKey: string
  encryptedEnvelope: string
  encryptedSHA256: string
  createdAt: string
}

interface CloudProjectSnapshotUpload {
  id: string
  encryptedBytes: number
  encryptedSha256: string
  receivedChunkIndexes: number[]
  expiresAt: string
}

export async function createCloudProjectSnapshot(projectID: string): Promise<CreatedCloudProjectSnapshot> {
  await cleanupExpiredStagedUploads()
  let staged = await findStagedUpload(projectID)
  let recoveryKey: string | null = staged
    ? await localCredentialStore.getPassword(
        SNAPSHOT_CREDENTIAL_SERVICE,
        pendingCredentialAccount(staged.idempotencyKey),
      )
    : null
  if (!staged || !recoveryKey) {
    if (staged) await clearStagedUpload(staged)
    const repos = getRepos()
    const project = repos.project.getProject(repos.db, projectID)
    if (!project) throw new Error('未找到项目')
    recoveryKey = createProjectSnapshotRecoveryKey()
    const serializedPackage = serializeProjectPackage(collectProjectPackage(repos, projectID, { includeAssets: false }))
    const envelope = encryptProjectSnapshot(serializedPackage, recoveryKey)
    const encryptedEnvelope = Buffer.from(JSON.stringify(envelope), 'utf8')
    if (encryptedEnvelope.length > MAX_ENCRYPTED_ENVELOPE_BYTES) throw new Error('加密项目快照超过 64 MiB 上限；请先使用本机完整备份或缩减项目内容')
    const idempotencyKey = `desktop-snapshot-${randomUUID()}`
    // Persist only opaque ciphertext and a retry identifier. The recovery key
    // remains in the local credential file before any network request begins.
    await localCredentialStore.setPassword(
      SNAPSHOT_CREDENTIAL_SERVICE,
      pendingCredentialAccount(idempotencyKey),
      recoveryKey,
    )
    staged = { version: 1, projectID, idempotencyKey, encryptedEnvelope: encryptedEnvelope.toString('base64'), encryptedSHA256: sha256Hex(encryptedEnvelope), createdAt: new Date().toISOString() }
    await writeStagedUpload(staged)
  }
  try {
    const snapshot = await uploadStagedSnapshot(staged)
    try {
      await localCredentialStore.setPassword(
        SNAPSHOT_CREDENTIAL_SERVICE,
        snapshotCredentialAccount(snapshot.id),
        recoveryKey,
      )
    } catch {
      // The upload already succeeded. Keep the encrypted retry staging and
      // local pending entry so a later retry can recover the same snapshot.
      return { ...snapshot, recoveryKey, recoveryKeyAvailable: false }
    }
    await localCredentialStore.deletePassword(
      SNAPSHOT_CREDENTIAL_SERVICE,
      pendingCredentialAccount(staged.idempotencyKey),
    )
    await clearStagedUpload(staged)
    return { ...snapshot, recoveryKey, recoveryKeyAvailable: true }
  } catch (error) {
    // Keep the opaque staged envelope and local-only recovery key. Selecting
    // this project again resumes missing chunks instead of creating another key.
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`云端快照未完成；可再次选择同一项目继续上传（${detail}）`)
  }
}

export async function listCloudProjectSnapshots(): Promise<CloudProjectSnapshot[]> {
  const payload = await snapshotRequest('/v1/desktop/project-snapshots', { method: 'GET' }) as { snapshots?: unknown }
  if (!Array.isArray(payload.snapshots)) throw new Error('云端快照列表响应无效')
  return Promise.all(payload.snapshots.map((snapshot) => parseSnapshot(snapshot)))
}

// Restoring always creates a separate local project via the already-audited
// import transaction. It cannot overwrite the current local project.
export async function restoreCloudProjectSnapshot(snapshotID: string, suppliedRecoveryKey?: string) {
  const recoveryKey =
    suppliedRecoveryKey?.trim() ||
    await localCredentialStore.getPassword(
      SNAPSHOT_CREDENTIAL_SERVICE,
      snapshotCredentialAccount(snapshotID),
    )
  if (!recoveryKey) throw new Error('此设备没有恢复密钥；请输入创建快照时保存的恢复密钥')
  const payload = await snapshotRequest(`/v1/desktop/project-snapshots/download?id=${encodeURIComponent(snapshotID)}`, { method: 'GET' }) as { encrypted_envelope?: unknown }
  if (typeof payload.encrypted_envelope !== 'string' || !payload.encrypted_envelope) throw new Error('云端快照内容无效')
  const encoded = Buffer.from(payload.encrypted_envelope, 'base64')
  if (encoded.length === 0 || encoded.length > MAX_ENCRYPTED_ENVELOPE_BYTES) throw new Error('云端快照内容无效')
  const plaintext = decryptProjectSnapshot(parseProjectSnapshotEnvelope(encoded.toString('utf8')), recoveryKey)
  // Validation happens before the transaction creates anything. A tampered or
  // stale package therefore cannot result in a partial local restore.
  parseProjectPackage(plaintext)
  return importProjectPackage(getRepos(), plaintext)
}

export async function deleteCloudProjectSnapshot(snapshotID: string): Promise<void> {
  await snapshotRequest(`/v1/desktop/project-snapshots?id=${encodeURIComponent(snapshotID)}`, { method: 'DELETE' })
  await localCredentialStore.deletePassword(
    SNAPSHOT_CREDENTIAL_SERVICE,
    snapshotCredentialAccount(snapshotID),
  )
}

async function uploadStagedSnapshot(staged: StagedCloudProjectSnapshot): Promise<CloudProjectSnapshot> {
  const encryptedEnvelope = Buffer.from(staged.encryptedEnvelope, 'base64')
  if (encryptedEnvelope.length === 0 || encryptedEnvelope.length > MAX_ENCRYPTED_ENVELOPE_BYTES || sha256Hex(encryptedEnvelope) !== staged.encryptedSHA256) {
    throw new Error('本机暂存的加密快照无效')
  }
  if (encryptedEnvelope.length <= MAX_INLINE_ENCRYPTED_ENVELOPE_BYTES) {
    const payload = await snapshotRequest('/v1/desktop/project-snapshots', {
      method: 'POST', body: JSON.stringify({ idempotency_key: staged.idempotencyKey, encrypted_envelope: staged.encryptedEnvelope }),
    }) as { snapshot?: unknown }
    return parseSnapshot(payload.snapshot)
  }

  const started = await snapshotRequest('/v1/desktop/project-snapshot-uploads', {
    method: 'POST', body: JSON.stringify({ idempotency_key: staged.idempotencyKey, encrypted_bytes: encryptedEnvelope.length, encrypted_sha256: staged.encryptedSHA256 }),
  }) as { snapshot?: unknown; upload?: unknown }
  if (started.snapshot) return parseSnapshot(started.snapshot)
  const upload = parseUpload(started.upload, encryptedEnvelope.length, staged.encryptedSHA256)
  const received = new Set(upload.receivedChunkIndexes)
  const chunks = Math.ceil(encryptedEnvelope.length / SNAPSHOT_UPLOAD_CHUNK_BYTES)
  for (let index = 0; index < chunks; index += 1) {
    if (received.has(index)) continue
    const encryptedChunk = encryptedEnvelope.subarray(index * SNAPSHOT_UPLOAD_CHUNK_BYTES, Math.min(encryptedEnvelope.length, (index + 1) * SNAPSHOT_UPLOAD_CHUNK_BYTES))
    await snapshotRequest('/v1/desktop/project-snapshot-uploads/chunks', {
      method: 'POST', body: JSON.stringify({ upload_id: upload.id, chunk_index: index, encrypted_chunk: encryptedChunk.toString('base64'), encrypted_chunk_sha256: sha256Hex(encryptedChunk) }),
    })
  }
  const completed = await snapshotRequest('/v1/desktop/project-snapshot-uploads/complete', {
    method: 'POST', body: JSON.stringify({ upload_id: upload.id }),
  }) as { snapshot?: unknown }
  return parseSnapshot(completed.snapshot)
}

async function cleanupExpiredStagedUploads(): Promise<void> {
  try {
    const dir = stagedUploadDirectory()
    const names = await readdir(dir)
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const file = join(dir, name)
      const staged = await readStagedUploadFile(file)
      if (!staged || Date.now() - Date.parse(staged.createdAt) > SNAPSHOT_UPLOAD_STAGING_RETENTION_MS) {
        if (staged) {
          await localCredentialStore.deletePassword(
            SNAPSHOT_CREDENTIAL_SERVICE,
            pendingCredentialAccount(staged.idempotencyKey),
          )
        }
        await rm(file, { force: true })
      }
    }
  } catch {
    // A missing or unreadable local staging directory must never block a
    // fresh user-initiated snapshot.
  }
}

async function findStagedUpload(projectID: string): Promise<StagedCloudProjectSnapshot | undefined> {
  try {
    const names = await readdir(stagedUploadDirectory())
    const candidates = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => readStagedUploadFile(join(stagedUploadDirectory(), name))))
    return candidates.filter((item): item is StagedCloudProjectSnapshot => Boolean(item && item.projectID === projectID)).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  } catch {
    return undefined
  }
}

async function writeStagedUpload(staged: StagedCloudProjectSnapshot): Promise<void> {
  const directory = stagedUploadDirectory()
  await mkdir(directory, { recursive: true })
  const destination = stagedUploadFile(staged.idempotencyKey)
  const temporary = `${destination}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(staged), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, destination)
}

async function clearStagedUpload(staged: StagedCloudProjectSnapshot): Promise<void> {
  await rm(stagedUploadFile(staged.idempotencyKey), { force: true })
}

async function readStagedUploadFile(file: string): Promise<StagedCloudProjectSnapshot | undefined> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<StagedCloudProjectSnapshot>
    const projectID = text(value.projectID)
    const encryptedEnvelopeBase64 = text(value.encryptedEnvelope)
    const createdAt = text(value.createdAt)
    if (value.version !== 1 || !projectID || !validIdempotencyKey(value.idempotencyKey) || !encryptedEnvelopeBase64 || !validSHA256(value.encryptedSHA256) || !createdAt || !Number.isFinite(Date.parse(createdAt))) return undefined
    const encryptedEnvelope = Buffer.from(encryptedEnvelopeBase64, 'base64')
    if (encryptedEnvelope.length === 0 || encryptedEnvelope.length > MAX_ENCRYPTED_ENVELOPE_BYTES || sha256Hex(encryptedEnvelope) !== value.encryptedSHA256) return undefined
    return { version: 1, projectID, idempotencyKey: value.idempotencyKey, encryptedEnvelope: encryptedEnvelopeBase64, encryptedSHA256: value.encryptedSHA256, createdAt }
  } catch {
    return undefined
  }
}

function parseUpload(value: unknown, encryptedBytes: number, encryptedSHA256: string): CloudProjectSnapshotUpload {
  const upload = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const id = text(upload.id)
  const bytes = upload.encrypted_bytes
  const digest = text(upload.encrypted_sha256)
  const expiresAt = text(upload.expires_at)
  const received = Array.isArray(upload.received_chunk_indexes) ? upload.received_chunk_indexes : []
  if (!id || bytes !== encryptedBytes || digest !== encryptedSHA256 || !expiresAt || received.some((index) => !Number.isInteger(index) || index < 0 || index >= Math.ceil(encryptedBytes / SNAPSHOT_UPLOAD_CHUNK_BYTES))) {
    throw new Error('云端续传状态无效')
  }
  return { id, encryptedBytes: bytes, encryptedSha256: digest, receivedChunkIndexes: [...new Set(received as number[])], expiresAt }
}

function stagedUploadDirectory(): string { return join(app.getPath('userData'), SNAPSHOT_UPLOAD_STAGING_DIR) }
function stagedUploadFile(idempotencyKey: string): string { return join(stagedUploadDirectory(), `${createHash('sha256').update(idempotencyKey).digest('hex')}.json`) }
function pendingCredentialAccount(idempotencyKey: string): string { return `pending:${idempotencyKey}` }
function sha256Hex(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function validIdempotencyKey(value: unknown): value is string { return typeof value === 'string' && /^desktop-snapshot-[0-9a-f-]{36}$/.test(value) }
function validSHA256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) }

async function snapshotRequest(path: string, init: RequestInit): Promise<unknown> {
  return withCloudAccessToken(async ({ bffOrigin }, accessToken) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS)
    try {
      const response = await fetch(`${bffOrigin}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, [DESKTOP_CONTRACT_HEADER]: DESKTOP_CONTRACT_VERSION, ...(init.headers ?? {}) },
      })
      if (!response.ok) throw new Error(`云端快照请求失败（${response.status}）`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  })
}

async function parseSnapshot(value: unknown): Promise<CloudProjectSnapshot> {
  const snapshot = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const id = text(snapshot.id)
  const encryptedBytes = snapshot.encrypted_bytes
  const encryptedSha256 = text(snapshot.encrypted_sha256)
  const createdAt = text(snapshot.created_at)
  const expiresAt = text(snapshot.expires_at)
  if (!id || typeof encryptedBytes !== 'number' || !Number.isSafeInteger(encryptedBytes) || encryptedBytes <= 0 || !encryptedSha256 || !createdAt || !expiresAt) {
    throw new Error('云端快照元数据无效')
  }
  const recoveryKeyAvailable = Boolean(
    await localCredentialStore.getPassword(
      SNAPSHOT_CREDENTIAL_SERVICE,
      snapshotCredentialAccount(id),
    ),
  )
  return { id, encryptedBytes, encryptedSha256, createdAt, expiresAt, recoveryKeyAvailable }
}

function snapshotCredentialAccount(snapshotID: string): string { return `snapshot:${snapshotID}` }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
