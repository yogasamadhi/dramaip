import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const desktopDir = join(rootDir, 'apps', 'desktop')
const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-build')

const commandEnv = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
}

function run(command, commandArgs, options = {}) {
  console.log(`\n$ ${[command, ...commandArgs].join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    env: commandEnv,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

function localBin(name) {
  return join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runElectronE2eSmoke() {
  const smokeDir = mkdtempSync(join(tmpdir(), 'sdns-e2e-smoke-'))
  const resultPath = join(smokeDir, 'result.json')
  const userDataPath = join(smokeDir, 'userData')
  mkdirSync(userDataPath, { recursive: true })

  const electron = localBin('electron')
  const mainEntry = join(desktopDir, 'out', 'main', 'index.js')
  assert(existsSync(electron), `Electron runner not found: ${electron}`)
  assert(existsSync(mainEntry), `Desktop main build not found: ${mainEntry}`)

  const launchArgs = [
    mainEntry,
    '--sdns-e2e-smoke',
    `--sdns-e2e-smoke-result=${resultPath}`,
    `--sdns-e2e-smoke-user-data=${userDataPath}`,
  ]

  console.log(`\n$ ${[electron, ...launchArgs].join(' ')} # e2e smoke launch`)
  return new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(electron, launchArgs, {
      env: {
        ...commandEnv,
        SDNS_E2E_SMOKE: '1',
        SDNS_E2E_SMOKE_RESULT: resultPath,
        SDNS_E2E_SMOKE_USER_DATA: userDataPath,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      stdio: 'inherit',
    })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      rejectSmoke(new Error('Electron E2E smoke timed out'))
    }, 45000)
    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectSmoke(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      try {
        assert(code === 0, `Electron E2E smoke exited with ${code}`)
        assert(existsSync(resultPath), `E2E result was not written: ${resultPath}`)
        const result = JSON.parse(readFileSync(resultPath, 'utf8'))
        assert(result.ok === true, `E2E result failed: ${JSON.stringify(result, null, 2)}`)
        assert(result.projectId, `E2E project id missing: ${JSON.stringify(result)}`)
        assert(result.importedProjectId, `E2E imported project id missing: ${JSON.stringify(result)}`)
        assert(Array.isArray(result.steps), `E2E steps missing: ${JSON.stringify(result)}`)
        assert(result.steps.every((step) => step.ok === true), `E2E step failed: ${JSON.stringify(result.steps, null, 2)}`)
        console.log(`E2E smoke steps: ${result.steps.map((step) => step.name).join(', ')}`)
        console.log(`E2E smoke userData: ${relative(rootDir, result.userData)}`)
        console.log(`E2E smoke project: ${result.projectId} -> ${result.importedProjectId}`)
        rmSync(smokeDir, { recursive: true, force: true })
        resolveSmoke()
      } catch (error) {
        rejectSmoke(error)
      }
    })
  })
}

if (!skipBuild) {
  run(localBin('electron-vite'), ['build'], { cwd: desktopDir })
  run(localBin('electron-rebuild'), ['-f', '-w', 'better-sqlite3'], { cwd: desktopDir })
}

await runElectronE2eSmoke()
console.log('\nElectron E2E smoke OK')
