import { safeStorage } from 'electron'
import * as keytar from 'keytar'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { ImageProviderConfigRecord, ModelConfig, VideoProviderConfig } from '@sdns/core'
import { schema, type Repositories } from '@sdns/db'
import {
  KEYCHAIN_PREFIX,
  MASKED_PREFIX,
  decryptSecretValue,
  isKeychainReference,
  mergeSecretStateCounts,
  readLegacySecretForMigration,
  safeSecretErrorMessage,
  summarizeSecretValues,
  type SecretCipher,
  type SecretMigrationFailure,
  type SecretRecordArea,
  type SecretRecordSnapshot,
  type SecretStateCounts,
  type SecretValueState,
} from './secret-health'

const CREDENTIAL_SERVICE = 'com.sdns.studio.provider-credentials'
const KEYCHAIN_HEALTH_ACCOUNT = '__sdns_healthcheck__'

export interface CredentialStore {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

export interface SecretStorageStatus {
  /** @deprecated compatibility field; represents the system credential store state. */
  encryptionAvailable: boolean
  keychainAvailable: boolean
  mode: 'system_keychain' | 'keychain_unavailable'
  health?: SecretStorageHealth
  lastMigration?: SecretMigrationSummary
  unavailableReason?: string
}

export interface SecretStorageHealth {
  checkedAt: string
  /** @deprecated compatibility field; represents the system credential store state. */
  encryptionAvailable: boolean
  keychainAvailable: boolean
  modelConfigs: SecretStateCounts
  videoProviderConfigs: SecretStateCounts
  imageProviderConfigs: SecretStateCounts
  totals: SecretStateCounts
}

export interface SecretMigrationSummary {
  checkedAt: string
  keychainAvailable: boolean
  attempted: number
  migrated: number
  skipped: number
  failed: number
  before: SecretStorageHealth
  after: SecretStorageHealth
  failures: SecretMigrationFailure[]
}

interface PreparedCredential {
  ref: string
  account: string
  value: string
}

interface SecretInput {
  data: Record<string, unknown>
  apiKey?: string
}

let credentialStore: CredentialStore = keytar
let keychainAvailable = false
let keychainUnavailableReason: string | undefined
let lastMigration: SecretMigrationSummary | undefined
const credentialCache = new Map<string, string>()

/** Test seam: production always uses the OS-backed keytar adapter. */
export function setCredentialStoreForTests(store?: CredentialStore): void {
  credentialStore = store ?? keytar
  credentialCache.clear()
  keychainAvailable = false
  keychainUnavailableReason = undefined
}

/**
 * Must run before registering IPC. It verifies Keychain/Credential Manager access,
 * hydrates only referenced credentials into main-process memory, then migrates old
 * SQLite values. Renderer code never receives this cache.
 */
export async function initializeSecretStorage(repos: Repositories): Promise<SecretMigrationSummary> {
  await probeCredentialStore()
  await hydrateCredentialCache(repos)
  const summary = await migrateLegacySecretsToKeychain(repos)
  await hydrateCredentialCache(repos)
  return summary
}

export function getSecretStorageStatus(repos?: Repositories): SecretStorageStatus {
  return {
    encryptionAvailable: keychainAvailable,
    keychainAvailable,
    mode: keychainAvailable ? 'system_keychain' : 'keychain_unavailable',
    health: repos ? inspectSecretStorageHealth(repos) : undefined,
    lastMigration,
    unavailableReason: keychainUnavailableReason,
  }
}

/** Legacy-only decoder retained to read pre-LM3-25 values during migration. */
export function decryptSecret(value: string | undefined): string {
  if (isKeychainReference(value)) return credentialCache.get(value) ?? ''
  return decryptSecretValue(value, safeStorage)
}

export function maskSecret(value: string | undefined): string {
  if (value?.startsWith(MASKED_PREFIX)) return value
  if (isKeychainReference(value)) return `${MASKED_PREFIX}stored`
  const plain = decryptSecret(value)
  if (!plain) return ''
  return `${MASKED_PREFIX}${plain.slice(-4)}`
}

export function maskModelConfig(config: ModelConfig): ModelConfig {
  return { ...config, apiKey: maskSecret(config.apiKey) }
}

export function maskVideoConfig(config: VideoProviderConfig): VideoProviderConfig {
  return { ...config, apiKey: maskSecret(config.apiKey) }
}

export function maskImageProviderConfig(config: ImageProviderConfigRecord): ImageProviderConfigRecord {
  return { ...config, apiKey: maskSecret(config.apiKey) }
}

/**
 * Keep repository consumers synchronous while making the backing store external:
 * service calls read the main-process cache; all renderer IPC masks the result.
 */
export function installSecretProtection(repos: Repositories): void {
  const modelConfig = repos.modelConfig
  const listModelConfigs = modelConfig.listModelConfigs.bind(modelConfig)
  const getModelConfig = modelConfig.getModelConfig.bind(modelConfig)
  const getDefaultModelConfig = modelConfig.getDefaultModelConfig.bind(modelConfig)

  modelConfig.listModelConfigs = ((db) => listModelConfigs(db).map(exposeModelConfig)) as typeof modelConfig.listModelConfigs
  modelConfig.getModelConfig = ((db, id) => {
    const config = getModelConfig(db, id)
    return config ? exposeModelConfig(config) : undefined
  }) as typeof modelConfig.getModelConfig
  modelConfig.getDefaultModelConfig = ((db) => {
    const config = getDefaultModelConfig(db)
    return config ? exposeModelConfig(config) : undefined
  }) as typeof modelConfig.getDefaultModelConfig

  const videoProviderConfig = repos.videoProviderConfig
  const listVideoProviderConfigs = videoProviderConfig.listVideoProviderConfigs.bind(videoProviderConfig)
  const getVideoProviderConfig = videoProviderConfig.getVideoProviderConfig.bind(videoProviderConfig)
  const getDefaultVideoProviderConfig = videoProviderConfig.getDefaultVideoProviderConfig.bind(videoProviderConfig)

  videoProviderConfig.listVideoProviderConfigs = ((db) =>
    listVideoProviderConfigs(db).map(exposeVideoConfig)) as typeof videoProviderConfig.listVideoProviderConfigs
  videoProviderConfig.getVideoProviderConfig = ((db, id) => {
    const config = getVideoProviderConfig(db, id)
    return config ? exposeVideoConfig(config) : undefined
  }) as typeof videoProviderConfig.getVideoProviderConfig
  videoProviderConfig.getDefaultVideoProviderConfig = ((db) => {
    const config = getDefaultVideoProviderConfig(db)
    return config ? exposeVideoConfig(config) : undefined
  }) as typeof videoProviderConfig.getDefaultVideoProviderConfig

  const imageProviderConfig = repos.imageProviderConfig
  const listImageProviderConfigs = imageProviderConfig.listImageProviderConfigs.bind(imageProviderConfig)
  const getImageProviderConfig = imageProviderConfig.getImageProviderConfig.bind(imageProviderConfig)
  const getDefaultImageProviderConfig = imageProviderConfig.getDefaultImageProviderConfig.bind(imageProviderConfig)

  imageProviderConfig.listImageProviderConfigs = ((db) =>
    listImageProviderConfigs(db).map(exposeImageProviderConfig)) as typeof imageProviderConfig.listImageProviderConfigs
  imageProviderConfig.getImageProviderConfig = ((db, id) => {
    const config = getImageProviderConfig(db, id)
    return config ? exposeImageProviderConfig(config) : undefined
  }) as typeof imageProviderConfig.getImageProviderConfig
  imageProviderConfig.getDefaultImageProviderConfig = ((db) => {
    const config = getDefaultImageProviderConfig(db)
    return config ? exposeImageProviderConfig(config) : undefined
  }) as typeof imageProviderConfig.getDefaultImageProviderConfig
}

export async function createModelConfigWithSecret(repos: Repositories, input: unknown): Promise<ModelConfig> {
  const { data, apiKey } = splitSecretInput(input)
  const id = randomUUID()
  let prepared: PreparedCredential | undefined
  if (apiKey) prepared = await prepareCredential('model_config', id, apiKey)

  try {
    const created = repos.modelConfig.createModelConfig(repos.db, {
      ...data,
      id,
      apiKey: prepared?.ref ?? '',
    } as never)
    if (prepared) credentialCache.set(prepared.ref, prepared.value)
    return exposeModelConfig(created)
  } catch (error) {
    if (prepared) await deleteCredentialQuietly(prepared.ref)
    throw error
  }
}

export async function updateModelConfigWithSecret(
  repos: Repositories,
  id: string,
  input: unknown,
): Promise<ModelConfig | undefined> {
  const previous = getStoredSecretRecord(repos, 'model_config', id)
  if (!previous) return undefined
  const { data, apiKey } = splitSecretInput(input)
  const prepared = apiKey ? await prepareCredential('model_config', id, apiKey) : undefined
  try {
    const updated = repos.modelConfig.updateModelConfig(repos.db, id, {
      ...data,
      ...(prepared ? { apiKey: prepared.ref } : {}),
    } as never)
    if (!updated) {
      if (prepared) await deleteCredentialQuietly(prepared.ref)
      return undefined
    }
    if (prepared) {
      credentialCache.set(prepared.ref, prepared.value)
      await retireCredentialReference(previous.value)
    }
    return exposeModelConfig(updated)
  } catch (error) {
    if (prepared) await deleteCredentialQuietly(prepared.ref)
    throw error
  }
}

export async function deleteModelConfigWithSecret(repos: Repositories, id: string): Promise<void> {
  const previous = getStoredSecretRecord(repos, 'model_config', id)
  repos.modelConfig.deleteModelConfig(repos.db, id)
  await retireCredentialReference(previous?.value)
}

export async function createVideoConfigWithSecret(repos: Repositories, input: unknown): Promise<VideoProviderConfig> {
  const { data, apiKey } = splitSecretInput(input)
  const id = randomUUID()
  let prepared: PreparedCredential | undefined
  if (apiKey) prepared = await prepareCredential('video_provider_config', id, apiKey)

  try {
    const created = repos.videoProviderConfig.createVideoProviderConfig(repos.db, {
      ...data,
      id,
      apiKey: prepared?.ref ?? '',
    } as never)
    if (prepared) credentialCache.set(prepared.ref, prepared.value)
    return exposeVideoConfig(created)
  } catch (error) {
    if (prepared) await deleteCredentialQuietly(prepared.ref)
    throw error
  }
}

export async function updateVideoConfigWithSecret(
  repos: Repositories,
  id: string,
  input: unknown,
): Promise<VideoProviderConfig | undefined> {
  const previous = getStoredSecretRecord(repos, 'video_provider_config', id)
  if (!previous) return undefined
  const { data, apiKey } = splitSecretInput(input)
  const prepared = apiKey ? await prepareCredential('video_provider_config', id, apiKey) : undefined
  try {
    const updated = repos.videoProviderConfig.updateVideoProviderConfig(repos.db, id, {
      ...data,
      ...(prepared ? { apiKey: prepared.ref } : {}),
    } as never)
    if (!updated) {
      if (prepared) await deleteCredentialQuietly(prepared.ref)
      return undefined
    }
    if (prepared) {
      credentialCache.set(prepared.ref, prepared.value)
      await retireCredentialReference(previous.value)
    }
    return exposeVideoConfig(updated)
  } catch (error) {
    if (prepared) await deleteCredentialQuietly(prepared.ref)
    throw error
  }
}

export async function deleteVideoConfigWithSecret(repos: Repositories, id: string): Promise<void> {
  const previous = getStoredSecretRecord(repos, 'video_provider_config', id)
  repos.videoProviderConfig.deleteVideoProviderConfig(repos.db, id)
  await retireCredentialReference(previous?.value)
}

export async function createImageProviderConfigWithSecret(repos: Repositories, input: unknown): Promise<ImageProviderConfigRecord> {
  const { data, apiKey } = splitSecretInput(input)
  const id = randomUUID()
  const prepared = apiKey ? await prepareCredential('image_provider_config', id, apiKey) : undefined
  try {
    const created = repos.imageProviderConfig.createImageProviderConfig(repos.db, {
      ...data,
      id,
      apiKey: prepared?.ref ?? '',
    } as never)
    if (prepared) credentialCache.set(prepared.ref, prepared.value)
    return exposeImageProviderConfig(created)
  } catch (error) {
    if (prepared) await deleteCredentialQuietly(prepared.ref)
    throw error
  }
}

export async function updateImageProviderConfigWithSecret(
  repos: Repositories,
  id: string,
  input: unknown,
): Promise<ImageProviderConfigRecord | undefined> {
  const previous = getStoredSecretRecord(repos, 'image_provider_config', id)
  if (!previous) return undefined
  const { data, apiKey } = splitSecretInput(input)
  const prepared = apiKey ? await prepareCredential('image_provider_config', id, apiKey) : undefined
  try {
    const updated = repos.imageProviderConfig.updateImageProviderConfig(repos.db, id, {
      ...data,
      ...(prepared ? { apiKey: prepared.ref } : {}),
    } as never)
    if (!updated) {
      if (prepared) await deleteCredentialQuietly(prepared.ref)
      return undefined
    }
    if (prepared) {
      credentialCache.set(prepared.ref, prepared.value)
      await retireCredentialReference(previous.value)
    }
    return exposeImageProviderConfig(updated)
  } catch (error) {
    if (prepared) await deleteCredentialQuietly(prepared.ref)
    throw error
  }
}

export async function deleteImageProviderConfigWithSecret(repos: Repositories, id: string): Promise<void> {
  const previous = getStoredSecretRecord(repos, 'image_provider_config', id)
  repos.imageProviderConfig.deleteImageProviderConfig(repos.db, id)
  await retireCredentialReference(previous?.value)
}

export function inspectSecretStorageHealth(repos: Repositories): SecretStorageHealth {
  const { modelRecords, videoRecords, imageRecords } = listStoredSecretRecords(repos)
  return buildSecretStorageHealth(modelRecords, videoRecords, imageRecords)
}

/** Re-runnable recovery path for old SQLite credentials; never exposed to the renderer. */
export async function migrateLegacySecretsToKeychain(repos: Repositories): Promise<SecretMigrationSummary> {
  const { modelRecords, videoRecords, imageRecords, allRecords } = listStoredSecretRecords(repos)
  const before = buildSecretStorageHealth(modelRecords, videoRecords, imageRecords)
  const failures: SecretMigrationFailure[] = []
  let attempted = 0
  let migrated = 0
  let skipped = 0

  for (const record of allRecords) {
    const legacy = readLegacySecretForMigration(record.value, safeStorage as SecretCipher)
    if (legacy.state === 'empty' || legacy.state === 'keychain' || legacy.state === 'masked') {
      skipped += 1
      continue
    }
    if (!legacy.plaintext) {
      skipped += 1
      const failure = legacy.error ?? '旧版密钥值不可迁移'
      failures.push({ area: record.area, id: record.id, state: legacy.state, error: failure })
      recordMigrationAudit(repos, record, legacy.state, 'failed', undefined, failure)
      continue
    }

    attempted += 1
    try {
      const prepared = await prepareCredential(record.area, record.id, legacy.plaintext)
      try {
        updateStoredSecret(repos, record, prepared.ref)
        credentialCache.set(prepared.ref, prepared.value)
        recordMigrationAudit(repos, record, legacy.state, 'migrated', prepared.ref)
        migrated += 1
      } catch (error) {
        await deleteCredentialQuietly(prepared.ref)
        throw error
      }
    } catch (error) {
      const message = safeSecretErrorMessage(error)
      failures.push({ area: record.area, id: record.id, state: legacy.state, error: message })
      recordMigrationAudit(repos, record, legacy.state, 'failed', undefined, message)
    }
  }

  lastMigration = {
    checkedAt: new Date().toISOString(),
    keychainAvailable,
    attempted,
    migrated,
    skipped,
    failed: failures.length,
    before,
    after: inspectSecretStorageHealth(repos),
    failures,
  }
  return lastMigration
}

async function probeCredentialStore(): Promise<void> {
  try {
    await credentialStore.getPassword(CREDENTIAL_SERVICE, KEYCHAIN_HEALTH_ACCOUNT)
    keychainAvailable = true
    keychainUnavailableReason = undefined
  } catch (error) {
    keychainAvailable = false
    keychainUnavailableReason = safeSecretErrorMessage(error)
  }
}

async function hydrateCredentialCache(repos: Repositories): Promise<void> {
  const records = listStoredSecretRecords(repos).allRecords
  for (const record of records) {
    if (!isKeychainReference(record.value)) continue
    try {
      const value = await credentialStore.getPassword(CREDENTIAL_SERVICE, accountFromReference(record.value))
      if (value) credentialCache.set(record.value, value)
      else credentialCache.delete(record.value)
    } catch (error) {
      credentialCache.delete(record.value)
      keychainAvailable = false
      keychainUnavailableReason = safeSecretErrorMessage(error)
    }
  }
}

async function prepareCredential(area: SecretRecordArea, recordId: string, value: string): Promise<PreparedCredential> {
  if (!value.trim()) throw new Error('API Key 不能为空。')
  if (!keychainAvailable) await probeCredentialStore()
  if (!keychainAvailable) {
    throw new Error('系统钥匙串/凭据管理器不可用，已拒绝保存 API Key。请恢复系统凭据服务后重试。')
  }
  const account = `${area}:${recordId}:${randomUUID()}`
  try {
    await credentialStore.setPassword(CREDENTIAL_SERVICE, account, value)
    return { ref: `${KEYCHAIN_PREFIX}${account}`, account, value }
  } catch (error) {
    keychainAvailable = false
    keychainUnavailableReason = safeSecretErrorMessage(error)
    throw new Error('系统钥匙串/凭据管理器写入失败，原有配置未被修改。')
  }
}

async function retireCredentialReference(value: string | undefined): Promise<void> {
  if (!isKeychainReference(value)) return
  credentialCache.delete(value)
  await deleteCredentialQuietly(value)
}

async function deleteCredentialQuietly(reference: string): Promise<void> {
  if (!isKeychainReference(reference)) return
  try {
    await credentialStore.deletePassword(CREDENTIAL_SERVICE, accountFromReference(reference))
  } catch {
    // SQLite 已经不再引用该凭据；下次用户保存或删除时仍可安全重试清理。
  }
}

function accountFromReference(reference: string): string {
  return reference.slice(KEYCHAIN_PREFIX.length)
}

function splitSecretInput(input: unknown): SecretInput {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const apiKey = source['apiKey']
  const data = { ...source }
  delete data['apiKey']
  // 旧版 UI 可能仍携带该字段；明确丢弃，绝不允许 SQLite 明文降级。
  delete data['allowUnsafeApiKeyStorage']
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.startsWith(MASKED_PREFIX)) return { data }
  return { data, apiKey }
}

function exposeModelConfig(config: ModelConfig): ModelConfig {
  return { ...config, apiKey: decryptSecret(config.apiKey) }
}

function exposeVideoConfig(config: VideoProviderConfig): VideoProviderConfig {
  return { ...config, apiKey: decryptSecret(config.apiKey) }
}

function exposeImageProviderConfig(config: ImageProviderConfigRecord): ImageProviderConfigRecord {
  return { ...config, apiKey: decryptSecret(config.apiKey) }
}

function listStoredSecretRecords(repos: Repositories): {
  modelRecords: SecretRecordSnapshot[]
  videoRecords: SecretRecordSnapshot[]
  imageRecords: SecretRecordSnapshot[]
  allRecords: SecretRecordSnapshot[]
} {
  const modelRecords = repos.db
    .select({ id: schema.modelConfigs.id, value: schema.modelConfigs.apiKey })
    .from(schema.modelConfigs)
    .all()
    .map((row) => ({ area: 'model_config' as const, id: row.id, value: row.value }))
  const videoRecords = repos.db
    .select({ id: schema.videoProviderConfigs.id, value: schema.videoProviderConfigs.apiKey })
    .from(schema.videoProviderConfigs)
    .all()
    .map((row) => ({ area: 'video_provider_config' as const, id: row.id, value: row.value ?? undefined }))
  const imageRecords = repos.db
    .select({ id: schema.imageProviderConfigs.id, value: schema.imageProviderConfigs.apiKey })
    .from(schema.imageProviderConfigs)
    .all()
    .map((row) => ({ area: 'image_provider_config' as const, id: row.id, value: row.value ?? undefined }))
  return { modelRecords, videoRecords, imageRecords, allRecords: [...modelRecords, ...videoRecords, ...imageRecords] }
}

function getStoredSecretRecord(
  repos: Repositories,
  area: SecretRecordArea,
  id: string,
): SecretRecordSnapshot | undefined {
  if (area === 'model_config') {
    const row = repos.db
      .select({ id: schema.modelConfigs.id, value: schema.modelConfigs.apiKey })
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, id))
      .get()
    return row ? { area, id: row.id, value: row.value } : undefined
  }
  if (area === 'image_provider_config') {
    const row = repos.db
      .select({ id: schema.imageProviderConfigs.id, value: schema.imageProviderConfigs.apiKey })
      .from(schema.imageProviderConfigs)
      .where(eq(schema.imageProviderConfigs.id, id))
      .get()
    return row ? { area, id: row.id, value: row.value } : undefined
  }
  const row = repos.db
    .select({ id: schema.videoProviderConfigs.id, value: schema.videoProviderConfigs.apiKey })
    .from(schema.videoProviderConfigs)
    .where(eq(schema.videoProviderConfigs.id, id))
    .get()
  return row ? { area, id: row.id, value: row.value ?? undefined } : undefined
}

function buildSecretStorageHealth(
  modelRecords: SecretRecordSnapshot[],
  videoRecords: SecretRecordSnapshot[],
  imageRecords: SecretRecordSnapshot[],
): SecretStorageHealth {
  const modelConfigs = summarizeSecretValues(modelRecords, safeStorage)
  const videoProviderConfigs = summarizeSecretValues(videoRecords, safeStorage)
  const imageProviderConfigs = summarizeSecretValues(imageRecords, safeStorage)
  return {
    checkedAt: new Date().toISOString(),
    encryptionAvailable: keychainAvailable,
    keychainAvailable,
    modelConfigs,
    videoProviderConfigs,
    imageProviderConfigs,
    totals: mergeSecretStateCounts(modelConfigs, videoProviderConfigs, imageProviderConfigs),
  }
}

function updateStoredSecret(repos: Repositories, record: SecretRecordSnapshot, nextValue: string): void {
  if (record.area === 'model_config') {
    repos.db.update(schema.modelConfigs).set({ apiKey: nextValue }).where(eq(schema.modelConfigs.id, record.id)).run()
    return
  }
  if (record.area === 'image_provider_config') {
    repos.db
      .update(schema.imageProviderConfigs)
      .set({ apiKey: nextValue })
      .where(eq(schema.imageProviderConfigs.id, record.id))
      .run()
    return
  }
  repos.db
    .update(schema.videoProviderConfigs)
    .set({ apiKey: nextValue })
    .where(eq(schema.videoProviderConfigs.id, record.id))
    .run()
}

function recordMigrationAudit(
  repos: Repositories,
  record: SecretRecordSnapshot,
  sourceState: SecretValueState,
  status: 'migrated' | 'failed',
  credentialRef?: string,
  error?: string,
): void {
  const timestamp = new Date().toISOString()
  try {
    repos.db.run(sql`
      INSERT INTO credential_migration_audit
        (area, record_id, source_state, credential_ref, status, attempts, last_error, completed_at, updated_at)
      VALUES
        (${record.area}, ${record.id}, ${sourceState}, ${credentialRef ?? null}, ${status}, 1,
          ${error ? safeSecretErrorMessage(error) : null}, ${status === 'migrated' ? timestamp : null}, ${timestamp})
      ON CONFLICT(area, record_id) DO UPDATE SET
        source_state = excluded.source_state,
        credential_ref = excluded.credential_ref,
        status = excluded.status,
        attempts = credential_migration_audit.attempts + 1,
        last_error = excluded.last_error,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `)
  } catch {
    // 审计不可用不应阻断安全迁移；原值仍遵循“先写凭据库、后改 SQLite”。
  }
}
