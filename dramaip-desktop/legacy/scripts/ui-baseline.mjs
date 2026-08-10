import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const desktopDir = join(rootDir, 'apps', 'desktop')
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const keep = args.includes('--keep')
const outputArg = args.find((arg) => arg.startsWith('--output='))
const requestedOutput = outputArg ? resolve(rootDir, outputArg.slice('--output='.length)) : undefined

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

async function runUiBaseline() {
  const baselineDir = mkdtempSync(join(tmpdir(), 'sdns-ui-baseline-'))
  const resultPath = join(baselineDir, 'result.json')
  const userDataPath = join(baselineDir, 'userData')
  const artifactDir = requestedOutput ?? join(baselineDir, 'artifacts')
  mkdirSync(userDataPath, { recursive: true })
  mkdirSync(artifactDir, { recursive: true })

  const electron = localBin('electron')
  const mainEntry = join(desktopDir, 'out', 'main', 'index.js')
  assert(existsSync(electron), `Electron runner not found: ${electron}`)
  assert(existsSync(mainEntry), `Desktop main build not found: ${mainEntry}`)
  const launchArgs = [
    mainEntry,
    '--sdns-ui-baseline',
    `--sdns-ui-baseline-result=${resultPath}`,
    `--sdns-ui-baseline-user-data=${userDataPath}`,
    `--sdns-ui-baseline-output=${artifactDir}`,
  ]

  console.log(`\n$ ${[electron, ...launchArgs].join(' ')} # UI baseline launch`)
  const result = await new Promise((resolveBaseline, rejectBaseline) => {
    const child = spawn(electron, launchArgs, {
      env: {
        ...commandEnv,
        SDNS_UI_BASELINE: '1',
        SDNS_UI_BASELINE_RESULT: resultPath,
        SDNS_UI_BASELINE_USER_DATA: userDataPath,
        SDNS_UI_BASELINE_OUTPUT: artifactDir,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      stdio: 'inherit',
    })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      rejectBaseline(new Error('Electron UI baseline timed out'))
    }, 60000)
    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectBaseline(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      try {
        assert(code === 0, `Electron UI baseline exited with ${code}`)
        assert(existsSync(resultPath), `UI baseline result was not written: ${resultPath}`)
        const parsed = JSON.parse(readFileSync(resultPath, 'utf8'))
        assert(parsed.ok === true, `UI baseline failed: ${JSON.stringify(parsed, null, 2)}`)
        assert(Array.isArray(parsed.artifacts) && parsed.artifacts.length >= 5, 'UI baseline screenshots are incomplete')
        for (const artifact of parsed.artifacts) {
          assert(existsSync(artifact.file), `UI baseline screenshot missing: ${artifact.file}`)
        }
        resolveBaseline(parsed)
      } catch (error) {
        rejectBaseline(error)
      }
    })
  })

  console.log(`UI baseline screenshots: ${result.artifacts.map((artifact) => artifact.name).join(', ')}`)
  console.log(`UI baseline a11y observations: ${result.accessibilityIssueCount}`)
  console.log(`UI baseline artifacts: ${relative(rootDir, artifactDir)}`)
  if (!keep && !requestedOutput) rmSync(baselineDir, { recursive: true, force: true })
}

if (!skipBuild) {
  run(localBin('electron-vite'), ['build'], { cwd: desktopDir })
  run(localBin('electron-rebuild'), ['-f', '-w', 'better-sqlite3'], { cwd: desktopDir })
}

await runUiBaseline()
console.log('\nElectron UI baseline OK')
