import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createProjectSnapshotRecoveryKey,
  decryptProjectSnapshot,
  encryptProjectSnapshot,
  parseProjectSnapshotEnvelope,
  PROJECT_SNAPSHOT_FORMAT,
} from '../apps/desktop/electron/project-snapshot-crypto'

test('encrypted project snapshot has a deterministic envelope with an injected nonce', () => {
  const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const envelope = encryptProjectSnapshot('{"project":"雨夜"}', key, Buffer.alloc(12, 7))

  assert.equal(envelope.format, PROJECT_SNAPSHOT_FORMAT)
  assert.equal(envelope.nonce, 'BwcHBwcHBwcHBwcH')
  assert.equal(envelope.plaintextSha256, 'Pk1kWX7vVb9tiOwO4ep7kswWCiumeM29ejTusGdWgf8')
  assert.equal(decryptProjectSnapshot(envelope, key), '{"project":"雨夜"}')
})

test('wrong recovery keys and tampering cannot decrypt a snapshot', () => {
  const key = createProjectSnapshotRecoveryKey()
  const envelope = encryptProjectSnapshot('private project body', key, Buffer.alloc(12, 8))
  const wrongKey = createProjectSnapshotRecoveryKey()
  assert.throws(() => decryptProjectSnapshot(envelope, wrongKey), /无法验证或恢复密钥错误/)
  const first = envelope.ciphertext[0] === 'A' ? 'B' : 'A'
  assert.throws(() => decryptProjectSnapshot({ ...envelope, ciphertext: `${first}${envelope.ciphertext.slice(1)}` }, key), /无法验证或恢复密钥错误/)
})

test('serialized envelopes are rejected before decryption when metadata is malformed', () => {
  const key = createProjectSnapshotRecoveryKey()
  const envelope = encryptProjectSnapshot('private project body', key, Buffer.alloc(12, 9))
  assert.equal(parseProjectSnapshotEnvelope(JSON.stringify(envelope)).ciphertext, envelope.ciphertext)
  assert.throws(() => parseProjectSnapshotEnvelope('{"format":"unknown"}'), /信封格式无效/)
  assert.throws(() => parseProjectSnapshotEnvelope('not json'), /信封格式无效/)
})
