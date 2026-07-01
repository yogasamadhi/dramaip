import { safeStorage } from 'electron'
import type { ModelConfig, VideoProviderConfig } from '@sdns/core'
import type { Repositories } from '@sdns/db'

const ENCRYPTED_PREFIX = 'enc:v1:'
const PLAINTEXT_PREFIX = 'plain:v1:'
const MASKED_PREFIX = 'masked:v1:'

export interface SecretStorageStatus {
  encryptionAvailable: boolean
  mode: 'encrypted' | 'unsafe_plaintext_unavailable'
}

export function getSecretStorageStatus(): SecretStorageStatus {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  return {
    encryptionAvailable,
    mode: encryptionAvailable ? 'encrypted' : 'unsafe_plaintext_unavailable',
  }
}

export function encryptSecret(value: string | undefined, allowUnsafePlaintextStorage = false): string {
  if (!value) return ''
  if (value.startsWith(ENCRYPTED_PREFIX)) return value
  if (value.startsWith(PLAINTEXT_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) {
    if (allowUnsafePlaintextStorage) return `${PLAINTEXT_PREFIX}${value}`
    throw new Error('系统安全存储不可用，已拒绝保存 API Key。请启用系统钥匙串/凭据管理器，或在设置页显式允许本机明文保存。')
  }
  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
}

export function decryptSecret(value: string | undefined): string {
  if (!value) return ''
  if (value.startsWith(PLAINTEXT_PREFIX)) return value.slice(PLAINTEXT_PREFIX.length)
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
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

export function encryptExistingSecrets(repos: Repositories): void {
  if (!safeStorage.isEncryptionAvailable()) return
  for (const config of repos.modelConfig.listModelConfigs(repos.db)) {
    if (config.apiKey) repos.modelConfig.updateModelConfig(repos.db, config.id, { apiKey: config.apiKey })
  }
  for (const config of repos.videoProviderConfig.listVideoProviderConfigs(repos.db)) {
    if (config.apiKey) repos.videoProviderConfig.updateVideoProviderConfig(repos.db, config.id, { apiKey: config.apiKey })
  }
}
