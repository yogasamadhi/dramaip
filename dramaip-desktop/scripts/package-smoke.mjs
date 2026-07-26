import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const desktopDir = join(rootDir, 'apps', 'desktop')
const distDir = join(desktopDir, 'dist')
const args = new Set(process.argv.slice(2))
const dirOnly = args.has('--dir')
const skipBuild = args.has('--skip-build')
const skipStart = args.has('--skip-start')
const expectedElectronVersion = '43.2.0'

const commandEnv = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
  USE_HARD_LINKS: process.env.USE_HARD_LINKS ?? 'false',
}

function run(command, commandArgs, options = {}) {
  console.log(`\n$ ${[command, ...commandArgs].join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    env: commandEnv,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`)
  }
}

function localBin(name) {
  return join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
}

function builderArgsForCurrentPlatform() {
  if (dirOnly) return ['--dir', '--publish', 'never']
  if (process.platform === 'darwin') return ['--mac', 'dmg', 'zip', '--publish', 'never']
  if (process.platform === 'win32') return ['--win', 'nsis', 'zip', '--publish', 'never']
  if (process.platform === 'linux') return ['--linux', 'AppImage', 'deb', '--publish', 'never']
  throw new Error(`Unsupported package smoke platform: ${process.platform}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function walkFiles(dir, prefix = '') {
  if (!existsSync(dir)) return []
  const entries = []
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name)
    const rel = prefix ? join(prefix, name) : name
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      entries.push(...walkFiles(fullPath, rel))
    } else {
      entries.push(rel)
    }
  }
  return entries
}

function firstExistingDir(candidates) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory())
}

function findMacApp(dir) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name)
    if (name.endsWith('.app') && statSync(fullPath).isDirectory()) return fullPath
    if (statSync(fullPath).isDirectory()) {
      const nested = findMacApp(fullPath)
      if (nested) return nested
    }
  }
  return undefined
}

function findExecutableInDir(dir, predicate = () => true) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name)
    const stat = statSync(fullPath)
    if (!stat.isFile()) continue
    if (!predicate(name, fullPath)) continue
    if (process.platform === 'win32') {
      if (name.toLowerCase().endsWith('.exe')) return fullPath
    } else if ((stat.mode & 0o111) !== 0) {
      return fullPath
    }
  }
  return undefined
}

function findUnpackedApp() {
  if (process.platform === 'darwin') {
    const candidates = readdirSync(distDir)
      .filter((name) => name === 'mac' || name.startsWith('mac-'))
      .map((name) => join(distDir, name))
    const appDir = candidates.map(findMacApp).find(Boolean)
    assert(appDir, 'macOS unpacked .app not found in dist')
    const executableDir = join(appDir, 'Contents', 'MacOS')
    const executable = findExecutableInDir(executableDir)
    assert(executable, `macOS executable not found in ${executableDir}`)
    return { executable, resourcesDir: join(appDir, 'Contents', 'Resources') }
  }

  if (process.platform === 'win32') {
    const unpackedDir = firstExistingDir([join(distDir, 'win-unpacked')])
    assert(unpackedDir, 'Windows win-unpacked directory not found in dist')
    const executable = findExecutableInDir(
      unpackedDir,
      (name) => !/uninstall|elevate/i.test(name),
    )
    assert(executable, `Windows executable not found in ${unpackedDir}`)
    return { executable, resourcesDir: join(unpackedDir, 'resources') }
  }

  if (process.platform === 'linux') {
    const unpackedDir = firstExistingDir([join(distDir, 'linux-unpacked')])
    assert(unpackedDir, 'Linux linux-unpacked directory not found in dist')
    const executable = findExecutableInDir(
      unpackedDir,
      (name) => !['chrome-sandbox', 'chrome_crashpad_handler'].includes(name) && !name.endsWith('.so'),
    )
    assert(executable, `Linux executable not found in ${unpackedDir}`)
    return { executable, resourcesDir: join(unpackedDir, 'resources') }
  }

  throw new Error(`Unsupported package smoke platform: ${process.platform}`)
}

function validateInstallers() {
  if (dirOnly) return
  const files = readdirSync(distDir)
  const expectations =
    process.platform === 'darwin'
      ? [/\.dmg$/i, /\.zip$/i]
      : process.platform === 'win32'
        ? [/\.exe$/i, /\.zip$/i]
        : [/\.AppImage$/i, /\.deb$/i]
  for (const pattern of expectations) {
    assert(files.some((file) => pattern.test(file)), `Missing package artifact matching ${pattern}`)
  }
}

function loadAsarModule() {
  try {
    return createRequire(join(desktopDir, 'package.json'))('@electron/asar')
  } catch {
    const pnpmDir = join(rootDir, 'node_modules', '.pnpm')
    if (!existsSync(pnpmDir)) return undefined
    const packageDir = readdirSync(pnpmDir).find((name) => name.startsWith('@electron+asar@'))
    if (!packageDir) return undefined
    return createRequire(join(rootDir, 'package.json'))(
      join(pnpmDir, packageDir, 'node_modules', '@electron', 'asar'),
    )
  }
}

function forbiddenPackageEntries(entries) {
  const forbidden = [
    { pattern: /^\/?(electron|packages|scripts|tests)\//, label: 'workspace source directory' },
    { pattern: /^\/?renderer\/src\//, label: 'renderer source directory' },
    { pattern: /(^|\/)(LOOPRULE|LOOPMAP|UPDATE)\.md$/i, label: 'loop working document' },
    { pattern: /(^|\/)\.env(\..*)?$/i, label: 'environment file' },
    { pattern: /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/i, label: 'workspace config' },
  ]
  return entries
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => forbidden.some(({ pattern }) => pattern.test(entry)))
    .map((entry) => {
      const hit = forbidden.find(({ pattern }) => pattern.test(entry))
      return `${entry} (${hit?.label ?? 'forbidden'})`
    })
}

function validatePackageContents(resourcesDir) {
  const appAsar = join(resourcesDir, 'app.asar')
  assert(existsSync(appAsar), `app.asar not found at ${appAsar}`)
  const asar = loadAsarModule()
  if (!asar) {
    console.warn('Could not resolve @electron/asar; skipped app.asar entry inspection.')
  } else {
    const forbidden = forbiddenPackageEntries(asar.listPackage(appAsar))
    assert(
      forbidden.length === 0,
      `Forbidden entries found in app.asar:\n${forbidden.slice(0, 20).join('\n')}`,
    )
  }

  const unpackedDir = join(resourcesDir, 'app.asar.unpacked')
  if (existsSync(unpackedDir)) {
    const forbidden = forbiddenPackageEntries(walkFiles(unpackedDir)).filter(
      (entry) => !/node_modules\/[^/]+\/.*\.node/i.test(entry),
    )
    assert(
      forbidden.length === 0,
      `Forbidden entries found in app.asar.unpacked:\n${forbidden.slice(0, 20).join('\n')}`,
    )
  }
}

/** Final MP4 export is offline; package smoke must prove it does not depend on a developer PATH. */
function validateBundledFfmpegRuntime(resourcesDir) {
  const executable = join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  )
  assert(existsSync(executable), `Bundled FFmpeg executable not found: ${executable}`)
  assert(statSync(executable).size > 1_000_000, `Bundled FFmpeg executable is unexpectedly small: ${executable}`)
  const result = spawnSync(executable, ['-hide_banner', '-version'], { stdio: 'pipe' })
  assert(result.status === 0, `Bundled FFmpeg cannot start: ${result.stderr?.toString() ?? ''}`)
}

function runPackagedAppSmoke(executable, resourcesDir) {
  if (skipStart) return Promise.resolve()
  const smokeDir = mkdtempSync(join(tmpdir(), 'sdns-package-smoke-'))
  const resultPath = join(smokeDir, 'result.json')
  const userDataPath = join(smokeDir, 'userData')
  mkdirSync(userDataPath, { recursive: true })
  const smokeArgs = [
    '--sdns-package-smoke',
    `--sdns-package-smoke-result=${resultPath}`,
    `--sdns-package-smoke-user-data=${userDataPath}`,
  ]
  const appAsar = join(resourcesDir, 'app.asar')
  const electronRunner = localBin('electron')
  const launchCommand = existsSync(electronRunner) ? electronRunner : executable
  const launchArgs = existsSync(electronRunner) ? [appAsar, ...smokeArgs] : smokeArgs

  console.log(`\n$ ${[launchCommand, ...launchArgs].join(' ')} # package smoke launch`)
  return new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(launchCommand, launchArgs, {
      env: {
        ...commandEnv,
        SDNS_PACKAGE_SMOKE: '1',
        SDNS_PACKAGE_SMOKE_RESULT: resultPath,
        SDNS_PACKAGE_SMOKE_USER_DATA: userDataPath,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      stdio: 'inherit',
    })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      rejectSmoke(new Error('Packaged app smoke launch timed out'))
    }, 30000)
    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectSmoke(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      try {
        assert(code === 0, `Packaged app exited with ${code}`)
        assert(existsSync(resultPath), `Smoke result was not written: ${resultPath}`)
        const result = JSON.parse(readFileSync(resultPath, 'utf8'))
        assert(result.ok === true, `Smoke result failed: ${JSON.stringify(result)}`)
        assert(
          result.runtimeVersions?.electron === expectedElectronVersion,
          `Packaged Electron version mismatch: expected ${expectedElectronVersion}, got ${result.runtimeVersions?.electron ?? 'missing'}`,
        )
        assert(result.runtimeVersions?.chrome, `Packaged Chromium version missing: ${JSON.stringify(result)}`)
        assert(result.runtimeVersions?.node, `Packaged Node version missing: ${JSON.stringify(result)}`)
        assert(result.dbExists === true, `Smoke DB was not initialized: ${JSON.stringify(result)}`)
        assert(result.dbPath && existsSync(result.dbPath), `Smoke DB path missing: ${result.dbPath}`)
        console.log(
          `Package smoke runtime: Electron ${result.runtimeVersions.electron}, Chromium ${result.runtimeVersions.chrome}, Node ${result.runtimeVersions.node}`,
        )
        console.log(`Package smoke DB initialized at ${relative(rootDir, result.dbPath)}`)
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

run(localBin('electron-builder'), builderArgsForCurrentPlatform(), { cwd: desktopDir })
validateInstallers()
const unpacked = findUnpackedApp()
validatePackageContents(unpacked.resourcesDir)
validateBundledFfmpegRuntime(unpacked.resourcesDir)
await runPackagedAppSmoke(unpacked.executable, unpacked.resourcesDir)

console.log('\nPackage smoke OK')
