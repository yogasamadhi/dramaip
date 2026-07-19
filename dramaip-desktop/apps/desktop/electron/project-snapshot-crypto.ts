import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const PROJECT_SNAPSHOT_FORMAT = 'sdns-e2e-project-snapshot'
export const PROJECT_SNAPSHOT_VERSION = 1
const CIPHER = 'aes-256-gcm'
const NONCE_BYTES = 12
const KEY_BYTES = 32

export interface ProjectSnapshotEnvelope {
  format: typeof PROJECT_SNAPSHOT_FORMAT
  version: typeof PROJECT_SNAPSHOT_VERSION
  cipher: typeof CIPHER
  nonce: string
  ciphertext: string
  authTag: string
  plaintextSha256: string
}

/** Parse a remote serialized envelope before attempting authenticated
 * decryption. Metadata validation never exposes project plaintext. */
export function parseProjectSnapshotEnvelope(value: string): ProjectSnapshotEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('项目快照信封格式无效')
  }
  const envelope = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const format = text(envelope.format)
  const version = envelope.version
  const cipher = text(envelope.cipher)
  const nonce = text(envelope.nonce)
  const ciphertext = text(envelope.ciphertext)
  const authTag = text(envelope.authTag)
  const plaintextSha256 = text(envelope.plaintextSha256)
  if (format !== PROJECT_SNAPSHOT_FORMAT || version !== PROJECT_SNAPSHOT_VERSION || cipher !== CIPHER || !nonce || !ciphertext || !authTag || !plaintextSha256) {
    throw new Error('项目快照信封格式无效')
  }
  return { format, version, cipher, nonce, ciphertext, authTag, plaintextSha256 }
}

/**
 * The recovery key is the sole portable decryption capability. It is generated
 * locally and must never be sent to a BFF, written to project data, or logged.
 */
export function createProjectSnapshotRecoveryKey(): string {
  return randomBytes(KEY_BYTES).toString('base64url')
}

export function encryptProjectSnapshot(plaintext: string, recoveryKey: string, nonce = randomBytes(NONCE_BYTES)): ProjectSnapshotEnvelope {
  const key = decodeRecoveryKey(recoveryKey)
  if (nonce.length !== NONCE_BYTES) throw new Error('快照 nonce 长度无效')
  const cipher = createCipheriv(CIPHER, key, nonce)
  cipher.setAAD(snapshotAAD())
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  return {
    format: PROJECT_SNAPSHOT_FORMAT,
    version: PROJECT_SNAPSHOT_VERSION,
    cipher: CIPHER,
    nonce: nonce.toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    plaintextSha256: sha256Base64url(Buffer.from(plaintext, 'utf8')),
  }
}

export function decryptProjectSnapshot(envelope: ProjectSnapshotEnvelope, recoveryKey: string): string {
  if (
    envelope?.format !== PROJECT_SNAPSHOT_FORMAT ||
    envelope.version !== PROJECT_SNAPSHOT_VERSION ||
    envelope.cipher !== CIPHER
  ) throw new Error('不支持的加密快照版本')
  const key = decodeRecoveryKey(recoveryKey)
  const nonce = decodeBase64url(envelope.nonce, NONCE_BYTES, 'nonce')
  const authTag = decodeBase64url(envelope.authTag, 16, '认证标签')
  const ciphertext = decodeBase64url(envelope.ciphertext, undefined, '密文')
  const expectedDigest = decodeBase64url(envelope.plaintextSha256, 32, '摘要')
  try {
    const decipher = createDecipheriv(CIPHER, key, nonce)
    decipher.setAAD(snapshotAAD())
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const actualDigest = createHash('sha256').update(plaintext).digest()
    if (!timingSafeEqual(actualDigest, expectedDigest)) throw new Error('摘要不匹配')
    return plaintext.toString('utf8')
  } catch {
    // Intentionally do not distinguish a wrong recovery key from tampered
    // ciphertext: both are unauthenticated encrypted input.
    throw new Error('快照无法验证或恢复密钥错误')
  }
}

function decodeRecoveryKey(value: string): Buffer {
  return decodeBase64url(value, KEY_BYTES, '恢复密钥')
}

function decodeBase64url(value: string, expectedLength: number | undefined, label: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label}格式无效`)
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length === 0 || (expectedLength !== undefined && decoded.length !== expectedLength)) throw new Error(`${label}长度无效`)
  return decoded
}

function sha256Base64url(value: Buffer): string {
  return createHash('sha256').update(value).digest('base64url')
}

function snapshotAAD(): Buffer {
  return Buffer.from(`${PROJECT_SNAPSHOT_FORMAT}:${PROJECT_SNAPSHOT_VERSION}`, 'utf8')
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
