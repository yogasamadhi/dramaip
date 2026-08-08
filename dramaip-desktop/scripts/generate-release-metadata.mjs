import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, process.env.DRAMAIP_RELEASE_ARTIFACT_DIR ?? 'apps/desktop/dist')
const output = resolve(root, process.env.DRAMAIP_RELEASE_METADATA_DIR ?? 'apps/desktop/dist/release-metadata')

const artifacts = (await walk(dist))
  .filter((path) => !path.startsWith(output))
  .filter((path) => !path.endsWith('.blockmap'))
  .sort()
if (!artifacts.length) throw new Error(`没有在 ${dist} 找到发布物`)

await mkdir(output, { recursive: true })
const checksums = []
for (const path of artifacts) {
  const bytes = await readFile(path)
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${relative(dist, path)}`)
}
await writeFile(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`)

const components = []
const packageRoot = join(root, 'node_modules/.bun')
for (const directory of await safeReadDir(packageRoot)) {
  const packageJSON = await findPackageJSON(join(packageRoot, directory))
  if (!packageJSON) continue
  try {
    const pkg = JSON.parse(await readFile(packageJSON, 'utf8'))
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue
    components.push({
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${encodeURIComponent(pkg.name)}@${pkg.version}`,
      licenses: normalizeLicenses(pkg.license ?? pkg.licenses),
    })
  } catch {
    // A malformed dependency manifest is omitted from the generated inventory
    // and will be caught by the release gate's minimum component check.
  }
}
components.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`))
const unique = [...new Map(components.map((component) => [`${component.name}@${component.version}`, component])).values()]
if (unique.length < 20) throw new Error('SBOM 组件数量异常，拒绝生成不完整发布元数据')

const app = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8'))
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: app.name, version: app.version },
  },
  components: unique,
}
await writeFile(join(output, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
await writeFile(join(output, 'THIRD_PARTY_LICENSES.json'), `${JSON.stringify({
  generated_at: new Date().toISOString(),
  notice: '此清单用于定位第三方许可；发布包仍须携带各组件要求的完整许可文本。',
  components: unique.map(({ name, version, licenses }) => ({ name, version, licenses })),
}, null, 2)}\n`)
process.stdout.write(`release metadata: ${artifacts.length} artifacts, ${unique.length} SBOM components -> ${output}\n`)

async function walk(path) {
  const info = await stat(path)
  if (info.isFile()) return [path]
  const output = []
  for (const entry of await readdir(path)) output.push(...await walk(join(path, entry)))
  return output
}
async function safeReadDir(path) {
  try { return await readdir(path) } catch { return [] }
}
async function findPackageJSON(path) {
  for (const dependency of await safeReadDir(join(path, 'node_modules'))) {
    if (dependency.startsWith('@')) {
      for (const scoped of await safeReadDir(join(path, 'node_modules', dependency))) {
        const candidate = join(path, 'node_modules', dependency, scoped, 'package.json')
        try { if ((await stat(candidate)).isFile()) return candidate } catch {}
      }
    } else {
      const candidate = join(path, 'node_modules', dependency, 'package.json')
      try { if ((await stat(candidate)).isFile()) return candidate } catch {}
    }
  }
}
function normalizeLicenses(value) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.map((license) => ({ license: { id: typeof license === 'string' ? license : String(license?.type ?? 'UNKNOWN') } }))
}
