import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ENCRYPTED_PREFIX,
  KEYCHAIN_PREFIX,
  MASKED_PREFIX,
  PLAINTEXT_PREFIX,
  classifySecretValue,
  decryptSecretValue,
  encryptSecretValue,
  isKeychainReference,
  planSecretMigrations,
  readLegacySecretForMigration,
  summarizeSecretValues,
  type SecretCipher,
} from '../apps/desktop/electron/secret-health'

function encoded(value: string): string {
  return `${ENCRYPTED_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`
}

function fakeCipher(options: { available?: boolean; failEncrypt?: boolean; failDecrypt?: boolean } = {}): SecretCipher {
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: (value) => {
      if (options.failEncrypt) throw new Error(`encrypt failed for sk-${'x'.repeat(16)}`)
      return Buffer.from(`sealed:${value}`, 'utf8')
    },
    decryptString: (value) => {
      if (options.failDecrypt) throw new Error('decrypt failed')
      const text = value.toString('utf8')
      return text.startsWith('sealed:') ? text.slice('sealed:'.length) : text
    },
  }
}

test('classifies stored secret values without exposing the secret', () => {
  assert.equal(classifySecretValue(undefined, fakeCipher()), 'empty')
  assert.equal(classifySecretValue('', fakeCipher()), 'empty')
  assert.equal(classifySecretValue(`${PLAINTEXT_PREFIX}secret`, fakeCipher()), 'unsafe_plaintext')
  assert.equal(classifySecretValue(`${MASKED_PREFIX}1234`, fakeCipher()), 'masked')
  assert.equal(classifySecretValue(`${KEYCHAIN_PREFIX}model_config:cfg:uuid`, fakeCipher()), 'keychain')
  assert.equal(isKeychainReference(`${KEYCHAIN_PREFIX}model_config:cfg:uuid`), true)
  assert.equal(classifySecretValue('legacy-secret', fakeCipher()), 'legacy_plaintext')
  assert.equal(classifySecretValue(encoded('sealed:secret'), fakeCipher()), 'encrypted')
  assert.equal(classifySecretValue(encoded('sealed:secret'), fakeCipher({ failDecrypt: true })), 'unreadable_encrypted')
})

test('reads legacy encrypted values only for a successful Keychain handoff', () => {
  const encrypted = encoded('sealed:legacy-secret')
  const migrated = readLegacySecretForMigration(encrypted, fakeCipher())
  assert.equal(migrated.state, 'encrypted')
  assert.equal(migrated.plaintext, 'legacy-secret')

  const unavailable = readLegacySecretForMigration(encrypted, fakeCipher({ available: false }))
  assert.equal(unavailable.plaintext, undefined)
  assert.match(unavailable.error ?? '', /不可用/)
})

test('encrypts, decrypts, and rejects unsafe plaintext fallback', () => {
  const cipher = fakeCipher()
  const encrypted = encryptSecretValue('secret', cipher)
  assert.match(encrypted, new RegExp(`^${ENCRYPTED_PREFIX}`))
  assert.equal(decryptSecretValue(encrypted, cipher), 'secret')
  assert.equal(decryptSecretValue(`${PLAINTEXT_PREFIX}secret`, cipher), 'secret')
  assert.equal(decryptSecretValue('legacy-secret', cipher), 'legacy-secret')
  assert.equal(decryptSecretValue(`${MASKED_PREFIX}1234`, cipher), '')

  const unavailable = fakeCipher({ available: false })
  assert.throws(() => encryptSecretValue('secret', unavailable), /安全存储不可用/)
  assert.throws(() => encryptSecretValue('secret', unavailable), /安全存储不可用/)
})

test('summarizes secret health and plans only reversible migrations', () => {
  const records = [
    { area: 'model_config' as const, id: 'empty', value: '' },
    { area: 'model_config' as const, id: 'plain', value: `${PLAINTEXT_PREFIX}plain-secret` },
    { area: 'model_config' as const, id: 'legacy', value: 'legacy-secret' },
    { area: 'video_provider_config' as const, id: 'masked', value: `${MASKED_PREFIX}1234` },
    { area: 'video_provider_config' as const, id: 'encrypted', value: encoded('sealed:secret') },
  ]

  const counts = summarizeSecretValues(records, fakeCipher())
  assert.equal(counts.total, 5)
  assert.equal(counts.empty, 1)
  assert.equal(counts.unsafePlaintext, 1)
  assert.equal(counts.legacyPlaintext, 1)
  assert.equal(counts.masked, 1)
  assert.equal(counts.encrypted, 1)

  const plan = planSecretMigrations(records, fakeCipher())
  assert.equal(plan.attempted, 2)
  assert.equal(plan.skipped, 3)
  assert.deepEqual(plan.actions.map((action) => action.record.id), ['plain', 'legacy'])
  assert.ok(plan.actions.every((action) => action.nextValue.startsWith(ENCRYPTED_PREFIX)))
})

test('keeps migration failures auditable without leaking key material', () => {
  const plan = planSecretMigrations(
    [{ area: 'model_config', id: 'plain', value: `${PLAINTEXT_PREFIX}plain-secret` }],
    fakeCipher({ failEncrypt: true }),
  )

  assert.equal(plan.attempted, 1)
  assert.equal(plan.actions.length, 0)
  assert.equal(plan.failures.length, 1)
  assert.equal(plan.failures[0].id, 'plain')
  assert.match(plan.failures[0].error, /sk-\*\*\*/)
  assert.doesNotMatch(plan.failures[0].error, /plain-secret/)
})
