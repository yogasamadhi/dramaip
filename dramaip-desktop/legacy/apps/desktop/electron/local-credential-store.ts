import { app } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STORE_DIRECTORY = 'credentials'
const STORE_KEY_FILE = 'local-credentials.key'
const STORE_DATA_FILE = 'local-credentials.v1'
const STORE_VERSION = 1

interface CredentialVault {
  version: 1
  credentials: Record<string, string>
}

interface EncryptedCredentialVault {
  version: 1
  iv: string
  authTag: string
  ciphertext: string
}

export interface CredentialStore {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

/**
 * A prompt-free credential store scoped to Electron's userData directory.
 *
 * The vault and its AES key are separate files restricted to the current OS
 * account (0700 directory, 0600 files). This deliberately avoids macOS
 * Keychain, Windows Credential Manager and Linux Secret Service.
 */
class LocalCredentialStore implements CredentialStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly getUserDataPath: () => string) {}

  getPassword(service: string, account: string): Promise<string | null> {
    return this.schedule(async () => {
      const credentials = await this.readCredentials()
      return credentials[credentialID(service, account)] ?? null
    })
  }

  setPassword(service: string, account: string, password: string): Promise<void> {
    return this.schedule(async () => {
      const credentials = await this.readCredentials()
      credentials[credentialID(service, account)] = password
      await this.writeCredentials(credentials)
    })
  }

  deletePassword(service: string, account: string): Promise<boolean> {
    return this.schedule(async () => {
      const credentials = await this.readCredentials()
      const id = credentialID(service, account)
      if (!(id in credentials)) return false
      delete credentials[id]
      await this.writeCredentials(credentials)
      return true
    })
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async readCredentials(): Promise<Record<string, string>> {
    const { dataFile } = this.paths()
    let encoded: string
    try {
      encoded = await readFile(dataFile, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return {}
      throw error
    }

    const envelope = parseEnvelope(encoded)
    const key = await this.readKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ])
    return parseVault(plaintext.toString('utf8')).credentials
  }

  private async writeCredentials(credentials: Record<string, string>): Promise<void> {
    const { directory, dataFile } = this.paths()
    await ensurePrivateDirectory(directory)
    const key = await this.ensureKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const plaintext = Buffer.from(
      JSON.stringify({ version: STORE_VERSION, credentials } satisfies CredentialVault),
      'utf8',
    )
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const envelope: EncryptedCredentialVault = {
      version: STORE_VERSION,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    const temporary = `${dataFile}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    try {
      await rename(temporary, dataFile)
    } catch (error) {
      if (!isReplaceConflict(error)) throw error
      await rm(dataFile, { force: true })
      await rename(temporary, dataFile)
    } finally {
      await rm(temporary, { force: true })
    }
    await ensurePrivateFile(dataFile)
  }

  private async ensureKey(): Promise<Buffer> {
    const { directory, keyFile } = this.paths()
    await ensurePrivateDirectory(directory)
    try {
      return await this.readKey()
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }

    const key = randomBytes(32)
    try {
      await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' })
      return key
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      return this.readKey()
    }
  }

  private async readKey(): Promise<Buffer> {
    const { keyFile } = this.paths()
    const key = await readFile(keyFile)
    if (key.length !== 32) throw new Error('本地凭据密钥文件无效')
    await ensurePrivateFile(keyFile)
    return key
  }

  private paths(): { directory: string; keyFile: string; dataFile: string } {
    const directory = join(this.getUserDataPath(), STORE_DIRECTORY)
    return {
      directory,
      keyFile: join(directory, STORE_KEY_FILE),
      dataFile: join(directory, STORE_DATA_FILE),
    }
  }
}

function credentialID(service: string, account: string): string {
  return JSON.stringify([service, account])
}

function parseEnvelope(encoded: string): EncryptedCredentialVault {
  const value = JSON.parse(encoded) as Partial<EncryptedCredentialVault>
  if (
    value.version !== STORE_VERSION ||
    typeof value.iv !== 'string' ||
    typeof value.authTag !== 'string' ||
    typeof value.ciphertext !== 'string'
  ) {
    throw new Error('本地凭据文件格式无效')
  }
  return value as EncryptedCredentialVault
}

function parseVault(encoded: string): CredentialVault {
  const value = JSON.parse(encoded) as Partial<CredentialVault>
  if (
    value.version !== STORE_VERSION ||
    !value.credentials ||
    typeof value.credentials !== 'object' ||
    Array.isArray(value.credentials) ||
    Object.values(value.credentials).some((credential) => typeof credential !== 'string')
  ) {
    throw new Error('本地凭据内容无效')
  }
  return value as CredentialVault
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await chmod(directory, 0o700)
  } catch {
    // Windows may not implement POSIX permission bits; the directory remains
    // scoped to the current user's application data.
  }
}

async function ensurePrivateFile(file: string): Promise<void> {
  try {
    await chmod(file, 0o600)
  } catch {
    // See ensurePrivateDirectory.
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function isMissingFile(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST'
}

function isReplaceConflict(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'EEXIST' || code === 'EPERM'
}

export const localCredentialStore: CredentialStore = new LocalCredentialStore(() => app.getPath('userData'))
