import { safeStorage } from 'electron'
import { eq } from 'drizzle-orm'
import type { ModelConfig, VideoProviderConfig } from '@sdns/core'
import { schema, type Repositories } from '@sdns/db'
import {
  MASKED_PREFIX,
  classifySecretValue,
  decryptSecretValue,
  encryptSecretValue,
  mergeSecretStateCounts,
  planSecretMigrations,
  safeSecretErrorMessage,
  summarizeSecretValues,
  type SecretMigrationFailure,
  type SecretRecordSnapshot,
  type SecretStateCounts,
} from './secret-health'

export interface SecretStorageStatus {
  encryptionAvailable: boolean
  mode: 'encrypted' | 'unsafe_plaintext_unavailable'
  health?: SecretStorageHealth
  lastMigration?: SecretMigrationSummary
}

export interface SecretStorageHealth {
  checkedAt: string
  encryptionAvailable: boolean
  modelConfigs: SecretStateCounts
  videoProviderConfigs: SecretStateCounts
  totals: SecretStateCounts
}

export interface SecretMigrationSummary {
  checkedAt: string
  encryptionAvailable: boolean
  attempted: number
  migrated: number
  skipped: number
  failed: number
  before: SecretStorageHealth
  after: SecretStorageHealth
  failures: SecretMigrationFailure[]
}

let lastMigration: SecretMigrationSummary | undefined

export function getSecretStorageStatus(repos?: Repositories): SecretStorageStatus {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  return {
    encryptionAvailable,
    mode: encryptionAvailable ? 'encrypted' : 'unsafe_plaintext_unavailable',
    health: repos ? inspectSecretStorageHealth(repos) : undefined,
    lastMigration,
  }
}

export function encryptSecret(value: string | undefined, allowUnsafePlaintextStorage = false): string {
  return encryptSecretValue(value, safeStorage, allowUnsafePlaintextStorage)
}

export function decryptSecret(value: string | undefined): string {
  return decryptSecretValue(value, safeStorage)
}

function protectInput<T extends { apiKey?: string; allowUnsafeApiKeyStorage?: boolean }>(input: T): T {
  const { allowUnsafeApiKeyStorage, ...withoutPolicy } = input
  if (typeof input.apiKey !== 'string') return withoutPolicy as T
  if (input.apiKey.startsWith(MASKED_PREFIX)) {
    const { apiKey: _apiKey, ...rest } = withoutPolicy
    return rest as T
  }
  return { ...withoutPolicy, apiKey: encryptSecret(input.apiKey, allowUnsafeApiKeyStorage === true) } as T
}

function exposeModelConfig(config: ModelConfig): ModelConfig {
  return { ...config, apiKey: decryptSecret(config.apiKey) }
}

function exposeVideoConfig(config: VideoProviderConfig): VideoProviderConfig {
  return { ...config, apiKey: decryptSecret(config.apiKey) }
}

export function maskSecret(value: string | undefined): string {
  if (value?.startsWith(MASKED_PREFIX)) return value
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

export function installSecretProtection(repos: Repositories): void {
  const modelConfig = repos.modelConfig
  const listModelConfigs = modelConfig.listModelConfigs.bind(modelConfig)
  const getModelConfig = modelConfig.getModelConfig.bind(modelConfig)
  const createModelConfig = modelConfig.createModelConfig.bind(modelConfig)
  const updateModelConfig = modelConfig.updateModelConfig.bind(modelConfig)
  const getDefaultModelConfig = modelConfig.getDefaultModelConfig.bind(modelConfig)

  modelConfig.listModelConfigs = ((db) => listModelConfigs(db).map(exposeModelConfig)) as typeof modelConfig.listModelConfigs
  modelConfig.getModelConfig = ((db, id) => {
    const config = getModelConfig(db, id)
    return config ? exposeModelConfig(config) : undefined
  }) as typeof modelConfig.getModelConfig
  modelConfig.createModelConfig = ((db, data) =>
    exposeModelConfig(createModelConfig(db, protectInput(data)))) as typeof modelConfig.createModelConfig
  modelConfig.updateModelConfig = ((db, id, patch) => {
    const updated = updateModelConfig(db, id, protectInput(patch))
    return updated ? exposeModelConfig(updated) : undefined
  }) as typeof modelConfig.updateModelConfig
  modelConfig.getDefaultModelConfig = ((db) => {
    const config = getDefaultModelConfig(db)
    return config ? exposeModelConfig(config) : undefined
  }) as typeof modelConfig.getDefaultModelConfig

  const videoProviderConfig = repos.videoProviderConfig
  const listVideoProviderConfigs = videoProviderConfig.listVideoProviderConfigs.bind(videoProviderConfig)
  const getVideoProviderConfig = videoProviderConfig.getVideoProviderConfig.bind(videoProviderConfig)
  const createVideoProviderConfig = videoProviderConfig.createVideoProviderConfig.bind(videoProviderConfig)
  const updateVideoProviderConfig = videoProviderConfig.updateVideoProviderConfig.bind(videoProviderConfig)
  const getDefaultVideoProviderConfig = videoProviderConfig.getDefaultVideoProviderConfig.bind(videoProviderConfig)

  videoProviderConfig.listVideoProviderConfigs = ((db) =>
    listVideoProviderConfigs(db).map(exposeVideoConfig)) as typeof videoProviderConfig.listVideoProviderConfigs
  videoProviderConfig.getVideoProviderConfig = ((db, id) => {
    const config = getVideoProviderConfig(db, id)
    return config ? exposeVideoConfig(config) : undefined
  }) as typeof videoProviderConfig.getVideoProviderConfig
  videoProviderConfig.createVideoProviderConfig = ((db, data) =>
    exposeVideoConfig(createVideoProviderConfig(db, protectInput(data)))) as typeof videoProviderConfig.createVideoProviderConfig
  videoProviderConfig.updateVideoProviderConfig = ((db, id, patch) => {
    const updated = updateVideoProviderConfig(db, id, protectInput(patch))
    return updated ? exposeVideoConfig(updated) : undefined
  }) as typeof videoProviderConfig.updateVideoProviderConfig
  videoProviderConfig.getDefaultVideoProviderConfig = ((db) => {
    const config = getDefaultVideoProviderConfig(db)
    return config ? exposeVideoConfig(config) : undefined
  }) as typeof videoProviderConfig.getDefaultVideoProviderConfig
}

export function inspectSecretStorageHealth(repos: Repositories): SecretStorageHealth {
  const { modelRecords, videoRecords } = listStoredSecretRecords(repos)
  return buildSecretStorageHealth(modelRecords, videoRecords)
}

export function encryptExistingSecrets(repos: Repositories): SecretMigrationSummary {
  const { modelRecords, videoRecords, allRecords } = listStoredSecretRecords(repos)
  const before = buildSecretStorageHealth(modelRecords, videoRecords)
  const plan = planSecretMigrations(allRecords, safeStorage)
  const failures: SecretMigrationFailure[] = [...plan.failures]
  let migrated = 0

  for (const action of plan.actions) {
    try {
      updateStoredSecret(repos, action.record, action.nextValue)
      migrated += 1
    } catch (error) {
      failures.push({
        area: action.record.area,
        id: action.record.id,
        state: classifySecretValue(action.record.value),
        error: safeSecretErrorMessage(error),
      })
    }
  }

  lastMigration = {
    checkedAt: new Date().toISOString(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    attempted: plan.attempted,
    migrated,
    skipped: plan.skipped,
    failed: failures.length,
    before,
    after: inspectSecretStorageHealth(repos),
    failures,
  }
  return lastMigration
}

function listStoredSecretRecords(repos: Repositories): {
  modelRecords: SecretRecordSnapshot[]
  videoRecords: SecretRecordSnapshot[]
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

  return {
    modelRecords,
    videoRecords,
    allRecords: [...modelRecords, ...videoRecords],
  }
}

function buildSecretStorageHealth(
  modelRecords: SecretRecordSnapshot[],
  videoRecords: SecretRecordSnapshot[],
): SecretStorageHealth {
  const modelConfigs = summarizeSecretValues(modelRecords, safeStorage)
  const videoProviderConfigs = summarizeSecretValues(videoRecords, safeStorage)
  return {
    checkedAt: new Date().toISOString(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    modelConfigs,
    videoProviderConfigs,
    totals: mergeSecretStateCounts(modelConfigs, videoProviderConfigs),
  }
}

function updateStoredSecret(repos: Repositories, record: SecretRecordSnapshot, nextValue: string): void {
  if (record.area === 'model_config') {
    repos.db
      .update(schema.modelConfigs)
      .set({ apiKey: nextValue })
      .where(eq(schema.modelConfigs.id, record.id))
      .run()
    return
  }

  repos.db
    .update(schema.videoProviderConfigs)
    .set({ apiKey: nextValue })
    .where(eq(schema.videoProviderConfigs.id, record.id))
    .run()
}
