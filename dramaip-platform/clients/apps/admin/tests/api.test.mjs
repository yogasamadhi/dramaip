import test from 'node:test'
import assert from 'node:assert/strict'

test('Admin API paths stay within the independent admin boundary', () => {
  const paths = ['/v1/admin/auth/login', '/v1/admin/reporting/overview', '/v1/admin/reporting/exceptions/resolve']
  for (const path of paths) assert.match(path, /^\/v1\/admin\//)
  assert.equal(paths.some((path) => path.includes('/v1/billing') || path.includes('/v1/ai')), false)
})
