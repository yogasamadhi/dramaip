import { test } from "vitest"
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

test('mobile session gateway declares the public contract header', () => {
  const source = read('src/mobile-session.ts')
  if (!source.includes('API_CONTRACT_HEADER') && !source.includes('Contract-Version')) {
    throw new Error('mobile-session.ts must declare the public contract version')
  }
  if (!source.includes('@dramaip/sdk/contracts')) {
    throw new Error('mobile-session.ts must validate responses through @dramaip/sdk/contracts')
  }
})

test('the mobile client never ships a hardcoded API secret or token', () => {
  const sources = ['src/mobile-session.ts', 'src/api.ts', 'src/lib/env.ts'].map(read)
  const secretPatterns = [
    /(?:api[_-]?key|secret|private[_-]?key|password|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9]{8,}['"]/i,
  ]
  for (const source of sources) {
    for (const pattern of secretPatterns) {
      if (pattern.test(source)) {
        throw new Error('A literal secret-like value was found in client source')
      }
    }
  }
})

test('public env vars are the only API configuration channel', () => {
  const source = read('src/lib/env.ts')
  if (!source.includes('EXPO_PUBLIC_MOBILE_API_ORIGIN') || !source.includes('EXPO_PUBLIC_API_BASE_URL')) {
    throw new Error('env.ts must read the API origin from EXPO_PUBLIC_* variables')
  }
})
