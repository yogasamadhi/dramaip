import assert from 'node:assert/strict'
import test from 'node:test'

import { resourcePath } from '../src/index'

test('maps Web Cookie-session endpoints to their v2 owners', () => {
  assert.equal(resourcePath('/v1/auth/login'), '/api/v1/auth/token')
  assert.equal(resourcePath('/v1/auth/refresh'), '/api/v1/auth/token/refresh')
  assert.equal(resourcePath('/v1/auth/logout'), '/api/v1/auth/token/revoke')
  assert.equal(resourcePath('/v1/auth/session'), '/api/v1/auth/session')
})
