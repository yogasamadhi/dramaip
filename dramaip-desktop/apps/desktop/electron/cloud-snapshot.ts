import { randomUUID } from 'node:crypto'
import * as keytar from 'keytar'
import { collectProjectPackage, importProjectPackage, parseProjectPackage, serializeProjectPackage } from '@sdns/export'
import { getRepos } from './db'
import { withCloudAccessToken } from './cloud-auth'
import { DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION } from './cloud-contract'
import {
  createProjectSnapshotRecoveryKey,
  decryptProjectSnapshot,
  encryptProjectSnapshot,
  parseProjectSnapshotEnvelope,
} from './project-snapshot-crypto'

const SNAPSHOT_TIMEOUT_MS = 30_000
const SNAPSHOT_KEYCHAIN_SERVICE = 'com.sdns.studio.project-snapshot-recovery'
const MAX_ENCRYPTED_ENVELOPE_BYTES = 8 << 20

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
  // manager. It is also stored in the local OS Keychain, never in SQLite or
  // the remote API.
  recoveryKey: string
}

export async function createCloudProjectSnapshot(projectID: string): Promise<CreatedCloudProjectSnapshot> {
  const repos = getRepos()
  const project = repos.project.getProject(repos.db, projectID)
  if (!project) throw new Error('未找到项目')

  const serializedPackage = serializeProjectPackage(collectProjectPackage(repos, projectID, { includeAssets: false }))
  const recoveryKey = createProjectSnapshotRecoveryKey()
  const envelope = encryptProjectSnapshot(serializedPackage, recoveryKey)
  const encryptedEnvelope = Buffer.from(JSON.stringify(envelope), 'utf8')
  if (encryptedEnvelope.length > MAX_ENCRYPTED_ENVELOPE_BYTES) throw new Error('加密项目快照超过 8 MiB 上限；请先使用本机完整备份或缩减项目内容')

  const idempotencyKey = `desktop-snapshot-${randomUUID()}`
  const temporaryKeyAccount = `pending:${idempotencyKey}`
  // A cloud upload is not started until the recovery key is durable locally;
  // this prevents a successful backup whose user can no longer decrypt it.
  await keytar.setPassword(SNAPSHOT_KEYCHAIN_SERVICE, temporaryKeyAccount, recoveryKey)
  try {
    const payload = await snapshotRequest('/v1/desktop/project-snapshots', {
      method: 'POST', body: JSON.stringify({ idempotency_key: idempotencyKey, encrypted_envelope: encryptedEnvelope.toString('base64') }),
    }) as { snapshot?: unknown }
    const snapshot = await parseSnapshot(payload.snapshot)
    try {
      await keytar.setPassword(SNAPSHOT_KEYCHAIN_SERVICE, keychainAccount(snapshot.id), recoveryKey)
    } catch {
      // The upload already succeeded. Return the one-time key rather than
      // pretending it failed and leaving a backup that the user cannot find.
      await keytar.deletePassword(SNAPSHOT_KEYCHAIN_SERVICE, temporaryKeyAccount)
      return { ...snapshot, recoveryKey, recoveryKeyAvailable: false }
    }
    await keytar.deletePassword(SNAPSHOT_KEYCHAIN_SERVICE, temporaryKeyAccount)
    return { ...snapshot, recoveryKey, recoveryKeyAvailable: true }
  } catch (error) {
    await keytar.deletePassword(SNAPSHOT_KEYCHAIN_SERVICE, temporaryKeyAccount)
    throw error
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
  const recoveryKey = suppliedRecoveryKey?.trim() || await keytar.getPassword(SNAPSHOT_KEYCHAIN_SERVICE, keychainAccount(snapshotID))
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
  await keytar.deletePassword(SNAPSHOT_KEYCHAIN_SERVICE, keychainAccount(snapshotID))
}

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
  const recoveryKeyAvailable = Boolean(await keytar.getPassword(SNAPSHOT_KEYCHAIN_SERVICE, keychainAccount(id)))
  return { id, encryptedBytes, encryptedSha256, createdAt, expiresAt, recoveryKeyAvailable }
}

function keychainAccount(snapshotID: string): string { return `snapshot:${snapshotID}` }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
