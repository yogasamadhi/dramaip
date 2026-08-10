import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertCloudEndpoint,
  createDesktopAuthorizationURL,
  createDesktopPKCERequest,
  parseDesktopCallback,
} from '../apps/desktop/electron/cloud-auth-protocol'

test('desktop PKCE uses S256 and callback accepts only matching state/code', () => {
  const request = createDesktopPKCERequest()
  assert.equal(request.verifier.length >= 43, true)
  assert.equal(request.challenge.length, 43)
  assert.equal(request.state.length, 43)
  const redirectURI = 'http://127.0.0.1:43123/callback'
  const code = 'A'.repeat(43)
  assert.equal(parseDesktopCallback(`${redirectURI}?code=${code}&state=${request.state}`, request.state, redirectURI), code)
  assert.throws(() => parseDesktopCallback(`${redirectURI}?code=${code}&state=wrong-state`, request.state, redirectURI), /状态校验失败/)
  assert.throws(() => parseDesktopCallback(`${redirectURI}?code=${code}&state=${request.state}&refresh_token=forbidden`, request.state, redirectURI), /长期凭据/)
  assert.throws(() => parseDesktopCallback(`http://localhost:43123/callback?code=${code}&state=${request.state}`, request.state, redirectURI), /不受信任/)
})

test('desktop authorization URL has no verifier or token and production endpoint requires HTTPS', () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    const request = createDesktopPKCERequest()
    const url = new URL(createDesktopAuthorizationURL('http://127.0.0.1:3009', {
      challenge: request.challenge,
      state: request.state,
      redirectURI: 'http://127.0.0.1:43123/callback',
      deviceID: 'desktop-12345678',
    }))
    assert.equal(url.pathname, '/desktop/authorize')
    assert.equal(url.searchParams.get('code_verifier'), null)
    assert.equal(url.searchParams.get('access_token'), null)
    assert.equal(url.searchParams.get('refresh_token'), null)
  } finally {
    if (original === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = original
  }
  assert.throws(() => assertCloudEndpoint('http://127.0.0.1:8000', { development: false }), /HTTPS/)
  assert.throws(() => assertCloudEndpoint('https://cloud.example/path', { development: false }), /纯 Origin/)
})
