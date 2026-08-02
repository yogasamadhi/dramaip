import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const clientsRoot = process.cwd()
const platformRoot = resolve(clientsRoot, '..')
const schemaPath = 'clients/packages/sdk/contracts/http-v2.schema.json'
const schemaRaw = readFileSync(resolve(platformRoot, schemaPath), 'utf8')
const schema = JSON.parse(schemaRaw)
const version = schema.properties?.contractVersion?.const

if (version !== '2' || schema.properties?.limits?.properties?.listLimitMax?.const !== 100 || schema.properties?.limits?.properties?.usageTrendDaysMax?.const !== 365) {
  throw new Error('HTTP contract schema must declare the v2 shared limits')
}
if (!schema.required?.includes('result') || !schema.properties?.result?.required?.includes('requestId') || !schema.properties?.result?.required?.includes('traceId')) {
  throw new Error('HTTP contract schema must require the Result correlation fields')
}

const sdk = readFileSync(resolve(platformRoot, 'clients/packages/sdk/src/contracts.ts'), 'utf8')
const admin = readFileSync(resolve(platformRoot, 'clients/apps/admin/src/api.ts'), 'utf8')
const mobileSession = readFileSync(resolve(platformRoot, 'clients/apps/mobile/src/mobile-session.ts'), 'utf8')
const desktopAI = readFileSync(resolve(platformRoot, '../dramaip-desktop/apps/desktop/electron/cloud-ai.ts'), 'utf8')
const desktopHandoff = readFileSync(resolve(platformRoot, '../dramaip-desktop/apps/desktop/electron/cloud-handoff.ts'), 'utf8')

for (const [name, source] of Object.entries({ sdk, admin, mobileSession, desktopAI, desktopHandoff })) {
  if (!source.includes('Contract-Version') && !source.includes('API_CONTRACT_HEADER') && !source.includes('DESKTOP_CONTRACT_HEADER')) {
    throw new Error(`${name} does not declare the public contract version`)
  }
}
if (!admin.includes("@dramaip/sdk/contracts") || !mobileSession.includes("@dramaip/sdk/contracts")) {
  throw new Error('Admin and Mobile must validate key API responses through shared contract schemas')
}
if (!sdk.includes("API_CONTRACT_VERSION = '2'")) {
  throw new Error('SDK contract version and JSON schema version have diverged')
}

// In CI, a contract-schema change against main must also change the published
// version. This intentionally treats all schema changes as compatibility
// sensitive; maintainers can introduce v2 instead of mutating v1 in place.
try {
  const mainSchema = execFileSync('git', ['show', `origin/main:${schemaPath}`], { cwd: platformRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (mainSchema !== schemaRaw) {
    const mainVersion = JSON.parse(mainSchema).properties?.contract_version?.const
    if (mainVersion === version) throw new Error('public HTTP schema changed without a contract-version bump')
  }
} catch (error) {
  if (String(error).includes('public HTTP schema changed')) throw error
  // The schema is being introduced for the first time, or CI intentionally
  // runs without an origin/main ref. Static checks above still remain active.
}

console.log(`client contract v${version} verified (${createHash('sha256').update(schemaRaw).digest('hex').slice(0, 12)})`)
