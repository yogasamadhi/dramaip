import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canOpenExternalUrl, createContentSecurityPolicy } from '../apps/desktop/electron/security-policy'

test('external navigation allows only HTTPS by default', () => {
  assert.equal(canOpenExternalUrl('https://example.com/path'), true)
  assert.equal(canOpenExternalUrl('http://example.com/path'), false)
  assert.equal(canOpenExternalUrl('http://localhost:5173'), false)
  assert.equal(canOpenExternalUrl('javascript:alert(1)'), false)
  assert.equal(canOpenExternalUrl('not a url'), false)
})

test('external navigation allows localhost HTTP only in dev', () => {
  assert.equal(canOpenExternalUrl('http://localhost:5173', { dev: true }), true)
  assert.equal(canOpenExternalUrl('http://127.0.0.1:5173', { dev: true }), true)
  assert.equal(canOpenExternalUrl('http://[::1]:5173', { dev: true }), true)
  assert.equal(canOpenExternalUrl('http://example.com', { dev: true }), false)
})

test('production CSP excludes HTTP and dev localhost sources', () => {
  const csp = createContentSecurityPolicy()
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /img-src 'self' data: https: file:/)
  assert.match(csp, /media-src 'self' data: https: file:/)
  assert.match(csp, /connect-src 'self' https:/)
  assert.doesNotMatch(csp, /http:\/\/localhost/)
  assert.doesNotMatch(csp, /ws:\/\/localhost/)
})

test('dev CSP keeps localhost scoped to development sources', () => {
  const csp = createContentSecurityPolicy({ dev: true })
  assert.match(csp, /http:\/\/localhost:\*/)
  assert.match(csp, /http:\/\/127\.0\.0\.1:\*/)
  assert.match(csp, /ws:\/\/localhost:\*/)
  assert.match(csp, /img-src[^;]+http:\/\/localhost:\*/)
  assert.match(csp, /media-src[^;]+http:\/\/localhost:\*/)
  assert.match(csp, /connect-src[^;]+https:/)
})
