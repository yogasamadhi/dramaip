import test from 'node:test'
import assert from 'node:assert/strict'

test('Admin API paths stay within the independent admin boundary', () => {
  const paths = ['/api/v1/admin/auth/login', '/api/v1/admin/reporting/overview', '/api/v1/admin/reporting/exceptions/resolve']
  for (const path of paths) assert.match(path, /^\/api\/v1\/admin\//)
  assert.equal(paths.every((path) => path.startsWith('/api/v1/admin/')), true)
})
