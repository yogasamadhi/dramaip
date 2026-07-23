export const ENCRYPTED_PREFIX = 'enc:v1:'
export const PLAINTEXT_PREFIX = 'plain:v1:'
export const MASKED_PREFIX = 'masked:v1:'
export const KEYCHAIN_PREFIX = 'keychain:v1:'

export type SecretRecordArea = 'model_config' | 'video_provider_config' | 'image_provider_config' | 'tts_provider_config'

export type SecretValueState =
  | 'empty'
  | 'keychain'
  | 'encrypted'
  | 'unsafe_plaintext'
  | 'masked'
  | 'legacy_plaintext'
  | 'unreadable_encrypted'

export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface SecretRecordSnapshot {
  area: SecretRecordArea
  id: string
  value?: string
}

export interface SecretStateCounts {
  total: number
  empty: number
  keychain: number
  encrypted: number
  unsafePlaintext: number
  masked: number
  legacyPlaintext: number
  unreadableEncrypted: number
}

export interface SecretMigrationAction {
  record: SecretRecordSnapshot
  nextValue: string
}

export interface SecretMigrationFailure {
  area: SecretRecordArea
  id: string
  state: SecretValueState
  error: string
}

export interface SecretMigrationPlan {
  attempted: number
  skipped: number
  actions: SecretMigrationAction[]
  failures: SecretMigrationFailure[]
}

export function emptySecretStateCounts(): SecretStateCounts {
  return {
    total: 0,
    empty: 0,
    keychain: 0,
    encrypted: 0,
    unsafePlaintext: 0,
    masked: 0,
    legacyPlaintext: 0,
    unreadableEncrypted: 0,
  }
}

export function classifySecretValue(value: string | undefined, cipher?: SecretCipher): SecretValueState {
  if (!value) return 'empty'
  if (value.startsWith(KEYCHAIN_PREFIX)) return 'keychain'
  if (value.startsWith(MASKED_PREFIX)) return 'masked'
  if (value.startsWith(PLAINTEXT_PREFIX)) return 'unsafe_plaintext'
  if (value.startsWith(ENCRYPTED_PREFIX)) {
    if (cipher?.isEncryptionAvailable()) {
      try {
        cipher.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
      } catch {
        return 'unreadable_encrypted'
      }
    }
    return 'encrypted'
  }
  return 'legacy_plaintext'
}

export function isKeychainReference(value: string | undefined): value is string {
  return Boolean(value?.startsWith(KEYCHAIN_PREFIX) && value.length > KEYCHAIN_PREFIX.length)
}

export function summarizeSecretValues(
  records: SecretRecordSnapshot[],
  cipher?: SecretCipher,
): SecretStateCounts {
  const counts = emptySecretStateCounts()
  for (const record of records) {
    counts.total += 1
    incrementSecretState(counts, classifySecretValue(record.value, cipher))
  }
  return counts
}

export function mergeSecretStateCounts(...items: SecretStateCounts[]): SecretStateCounts {
  const merged = emptySecretStateCounts()
  for (const counts of items) {
    merged.total += counts.total
    merged.empty += counts.empty
    merged.keychain += counts.keychain
    merged.encrypted += counts.encrypted
    merged.unsafePlaintext += counts.unsafePlaintext
    merged.masked += counts.masked
    merged.legacyPlaintext += counts.legacyPlaintext
    merged.unreadableEncrypted += counts.unreadableEncrypted
  }
  return merged
}

export function encryptSecretValue(
  value: string | undefined,
  cipher: SecretCipher,
): string {
  if (!value) return ''
  if (value.startsWith(ENCRYPTED_PREFIX)) return value
  if (value.startsWith(PLAINTEXT_PREFIX)) return value
  if (value.startsWith(MASKED_PREFIX)) return value
  if (!cipher.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，已拒绝保存 API Key。请启用系统钥匙串/凭据管理器后重试。')
  }
  return `${ENCRYPTED_PREFIX}${cipher.encryptString(value).toString('base64')}`
}

export function decryptSecretValue(value: string | undefined, cipher: SecretCipher): string {
  if (!value) return ''
  if (value.startsWith(MASKED_PREFIX)) return ''
  if (value.startsWith(PLAINTEXT_PREFIX)) return value.slice(PLAINTEXT_PREFIX.length)
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value
  if (!cipher.isEncryptionAvailable()) return ''
  try {
    return cipher.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

export function planSecretMigrations(
  records: SecretRecordSnapshot[],
  cipher: SecretCipher,
): SecretMigrationPlan {
  const plan: SecretMigrationPlan = {
    attempted: 0,
    skipped: 0,
    actions: [],
    failures: [],
  }

  for (const record of records) {
    const state = classifySecretValue(record.value)
    const plaintext = plaintextForMigration(record.value, state)
    if (plaintext == null) {
      plan.skipped += 1
      continue
    }
    if (!cipher.isEncryptionAvailable()) {
      plan.skipped += 1
      continue
    }

    plan.attempted += 1
    try {
      plan.actions.push({ record, nextValue: encryptSecretValue(plaintext, cipher) })
    } catch (error) {
      plan.failures.push({
        area: record.area,
        id: record.id,
        state,
        error: safeSecretErrorMessage(error),
      })
    }
  }

  return plan
}

export function safeSecretErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***')
    .slice(0, 240)
}

function plaintextForMigration(value: string | undefined, state: SecretValueState): string | undefined {
  if (!value) return undefined
  if (state === 'unsafe_plaintext') return value.slice(PLAINTEXT_PREFIX.length)
  if (state === 'legacy_plaintext') return value
  return undefined
}

/**
 * 读取旧版 SQLite 值以迁移到系统凭据库。调用方只能在 Electron 主进程内使用
 * 返回值，并且不得记录 plaintext；无法读取时以安全错误信息返回。
 */
export function readLegacySecretForMigration(
  value: string | undefined,
  cipher: SecretCipher,
): { state: SecretValueState; plaintext?: string; error?: string } {
  const state = classifySecretValue(value, cipher)
  if (state === 'unsafe_plaintext') return { state, plaintext: value?.slice(PLAINTEXT_PREFIX.length) }
  if (state === 'legacy_plaintext') return { state, plaintext: value }
  if (state === 'encrypted') {
    if (!cipher.isEncryptionAvailable()) return { state, error: '旧版系统加密服务不可用' }
    try {
      const encoded = value?.slice(ENCRYPTED_PREFIX.length) ?? ''
      return { state, plaintext: cipher.decryptString(Buffer.from(encoded, 'base64')) }
    } catch (error) {
      return { state, error: safeSecretErrorMessage(error) }
    }
  }
  if (state === 'unreadable_encrypted') return { state, error: '旧版加密内容无法读取' }
  return { state }
}

function incrementSecretState(counts: SecretStateCounts, state: SecretValueState): void {
  if (state === 'empty') counts.empty += 1
  if (state === 'keychain') counts.keychain += 1
  if (state === 'encrypted') counts.encrypted += 1
  if (state === 'unsafe_plaintext') counts.unsafePlaintext += 1
  if (state === 'masked') counts.masked += 1
  if (state === 'legacy_plaintext') counts.legacyPlaintext += 1
  if (state === 'unreadable_encrypted') counts.unreadableEncrypted += 1
}
