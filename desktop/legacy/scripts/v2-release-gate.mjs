import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const evidenceRoot = resolve(root, process.env.DRAMAIP_RELEASE_EVIDENCE_DIR ?? 'release-evidence/v2.0.0')
const stage = process.env.DRAMAIP_RELEASE_STAGE ?? 'rc'
const blockers = []
const passed = []
const app = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'))
const workspace = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

check(app.version === '2.0.0', `Desktop 版本必须为 2.0.0 GA，当前为 ${app.version}`, 'Desktop 版本为 2.0.0')
check(workspace.version === '2.0.0', `Workspace 版本必须为 2.0.0 GA，当前为 ${workspace.version}`, 'Workspace 版本为 2.0.0')
check(stage === 'ga', `DRAMAIP_RELEASE_STAGE 必须为 ga，当前为 ${stage}`, '发布阶段为 GA')
checkHTTPS('DRAMAIP_UPDATE_URL')
checkHTTPS('DRAMAIP_WEB_ORIGIN')
checkHTTPS('DESKTOP_CLOUD_WEB_ORIGIN')
checkHTTPS('DESKTOP_CLOUD_BFF_ORIGIN')
check(process.env.DESKTOP_CLOUD_LOGIN_ENABLED === 'true', 'DESKTOP_CLOUD_LOGIN_ENABLED 必须显式为 true', '桌面云登录已开启')
for (const feature of [
  'DIRECTOR_WORKSPACE_V2',
  'RETAKE',
  'PRODUCTION_GRAPH',
  'SMART_ROUTING',
  'CLOUD_REVIEW',
  'EDITOR_EXPORT',
  'PRICING_V2',
]) {
  check(process.env[`DRAMAIP_FEATURE_${feature}`] === 'true', `DRAMAIP_FEATURE_${feature} 必须显式为 true`, `${feature} 已开启`)
}
requireEnv('REVIEW_S3_ENDPOINT')
requireEnv('REVIEW_S3_BUCKET')
requireEnv('REVIEW_S3_ACCESS_KEY')
requireEnv('REVIEW_S3_SECRET_KEY')
requireAnyEnv(['WECHAT_MCH_ID', 'ALIPAY_APP_ID'], '至少一套生产支付商户凭据')
requireAnyEnv(['CSC_LINK', 'APPLE_API_KEY'], 'macOS 签名或公证凭据')
requireAnyEnv(['WIN_CSC_LINK', 'WIN_CSC_SHA1'], 'Windows 受信代码签名凭据')
await requireReleaseMetadata()
await requireReadableFile('docs/release/RELEASE_NOTES_V2.md', 'v2.0.0 版本说明')
await requireReadableFile('docs/release/ROLLBACK_V2.md', 'v2.0.0 回滚 Runbook')

const evidence = [
  'openai-image-edit.json',
  'openai-tts.json',
  'hailuo-video.json',
  'wan-video.json',
  'fcpxml-final-cut-12.2.json',
  'edl-relink.json',
  'macos-sign-notarize-install-upgrade.json',
  'windows-sign-install-upgrade.json',
  'linux-beta-smoke.json',
  'cloud-review-security.json',
  'platform-backup-restore.json',
  'payment-production.json',
]
for (const filename of evidence) await requireEvidence(filename)

process.stdout.write([
  `DramaIP v2 release gate (${stage})`,
  `commit: ${commit}`,
  ...passed.map((item) => `PASS  ${item}`),
  ...blockers.map((item) => `BLOCK ${item}`),
  blockers.length ? `RESULT: RC ONLY (${blockers.length} blockers)` : 'RESULT: GA READY',
  '',
].join('\n'))
if (blockers.length) process.exitCode = 1

function check(ok, blocker, pass) {
  if (ok) passed.push(pass)
  else blockers.push(blocker)
}
function requireEnv(name) {
  check(Boolean(process.env[name]?.trim()), `缺少受管环境变量 ${name}`, `${name} 已注入`)
}
function requireAnyEnv(names, label) {
  check(names.some((name) => process.env[name]?.trim()), `缺少${label}（${names.join(' / ')}）`, `${label}已注入`)
}
function checkHTTPS(name) {
  const raw = process.env[name]?.trim() ?? ''
  let valid = false
  try {
    const url = new URL(raw)
    valid = url.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname) && !url.hostname.endsWith('.invalid')
  } catch {}
  check(valid, `${name} 必须是真实、非占位的 HTTPS 地址`, `${name} 已验证`)
}
async function requireEvidence(filename) {
  try {
    const raw = await readFile(resolve(evidenceRoot, filename), 'utf8')
    const value = JSON.parse(raw)
    const safeShape = value?.status === 'passed'
      && value?.commit === commit
      && typeof value?.executed_at === 'string'
      && Number.isFinite(Date.parse(value.executed_at))
      && /^[a-f0-9]{64}$/.test(String(value?.evidence_sha256 ?? ''))
      && value?.contains_secrets === false
    check(safeShape, `${filename} 证据无效、commit 不匹配或未脱敏`, `${filename} 已验证`)
  } catch {
    blockers.push(`缺少发布证据 ${resolve(evidenceRoot, filename)}`)
  }
}
async function requireReadableFile(relativePath, label) {
  try {
    const content = await readFile(resolve(root, relativePath), 'utf8')
    check(content.trim().length > 200, `${label}内容不完整`, `${label}已提供`)
  } catch {
    blockers.push(`缺少${label} ${resolve(root, relativePath)}`)
  }
}
async function requireReleaseMetadata() {
  const metadataRoot = resolve(root, process.env.DRAMAIP_RELEASE_METADATA_DIR ?? 'apps/desktop/dist/release-metadata')
  try {
    const checksums = await readFile(resolve(metadataRoot, 'SHA256SUMS'), 'utf8')
    const sbom = JSON.parse(await readFile(resolve(metadataRoot, 'sbom.cdx.json'), 'utf8'))
    const licenses = JSON.parse(await readFile(resolve(metadataRoot, 'THIRD_PARTY_LICENSES.json'), 'utf8'))
    const valid = /^[a-f0-9]{64}  .+/m.test(checksums)
      && sbom?.bomFormat === 'CycloneDX'
      && sbom?.metadata?.component?.version === app.version
      && Array.isArray(sbom?.components) && sbom.components.length >= 20
      && Array.isArray(licenses?.components) && licenses.components.length >= 20
    check(valid, '发布物 SHA-256、SBOM 或第三方许可清单无效', '发布元数据已验证')
  } catch {
    blockers.push(`缺少发布元数据 ${metadataRoot}`)
  }
}
