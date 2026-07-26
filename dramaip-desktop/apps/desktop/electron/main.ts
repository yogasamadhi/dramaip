// Electron 主进程入口
import { app, BrowserWindow, shell, session } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DB_FILE_NAME } from '@sdns/core'
import { getRepos, initDatabase, safeInitDatabase } from './db'
import { registerAllIpc } from './ipc'
import { installProcessLoggers, logger } from './logger'
import { runDesktopE2eSmoke } from './e2e-smoke'
import { runDesktopUiBaseline } from './ui-baseline'
import { canOpenExternalUrl, createContentSecurityPolicy } from './security-policy'
import { initializeCloudAuth } from './cloud-auth'
import { reconcileLongTasks } from './task-recovery'

const PACKAGE_SMOKE_ENV = 'SDNS_PACKAGE_SMOKE'
const PACKAGE_SMOKE_RESULT_ENV = 'SDNS_PACKAGE_SMOKE_RESULT'
const PACKAGE_SMOKE_USER_DATA_ENV = 'SDNS_PACKAGE_SMOKE_USER_DATA'
const E2E_SMOKE_ENV = 'SDNS_E2E_SMOKE'
const E2E_SMOKE_RESULT_ENV = 'SDNS_E2E_SMOKE_RESULT'
const E2E_SMOKE_USER_DATA_ENV = 'SDNS_E2E_SMOKE_USER_DATA'
const UI_BASELINE_ENV = 'SDNS_UI_BASELINE'
const UI_BASELINE_RESULT_ENV = 'SDNS_UI_BASELINE_RESULT'
const UI_BASELINE_USER_DATA_ENV = 'SDNS_UI_BASELINE_USER_DATA'
const UI_BASELINE_OUTPUT_ENV = 'SDNS_UI_BASELINE_OUTPUT'
let shutdownRequested = false

/** 开发启动器收到 Ctrl-C 后，明确关闭 macOS 上仍可能保留的 Electron 窗口。 */
function quitForProcessSignal(): void {
  if (shutdownRequested) return
  shutdownRequested = true
  if (app.isReady()) {
    app.quit()
    return
  }
  app.once('ready', () => app.quit())
}

process.once('SIGINT', quitForProcessSignal)
process.once('SIGTERM', quitForProcessSignal)

function isDevRuntime(): boolean {
  return Boolean(process.env['ELECTRON_RENDERER_URL'])
}

function installSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [createContentSecurityPolicy({ dev: isDevRuntime() })],
        'X-Content-Type-Options': ['nosniff'],
      },
    })
  })
}

function isPackageSmoke(): boolean {
  return process.env[PACKAGE_SMOKE_ENV] === '1' || process.argv.includes('--sdns-package-smoke')
}

function getSmokeArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function configurePackageSmokeUserData(): void {
  const userData =
    process.env[PACKAGE_SMOKE_USER_DATA_ENV] ??
    getSmokeArg('sdns-package-smoke-user-data') ??
    process.env[E2E_SMOKE_USER_DATA_ENV] ??
    getSmokeArg('sdns-e2e-smoke-user-data') ??
    process.env[UI_BASELINE_USER_DATA_ENV] ??
    getSmokeArg('sdns-ui-baseline-user-data')
  if (userData) app.setPath('userData', userData)
}

function getRuntimeVersions(): Record<'electron' | 'chrome' | 'node', string | undefined> {
  return {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }
}

function writePackageSmokeResult(payload: Record<string, unknown>): void {
  const resultPath =
    process.env[PACKAGE_SMOKE_RESULT_ENV] ?? getSmokeArg('sdns-package-smoke-result')
  if (!resultPath) return
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        ...payload,
        version: app.getVersion(),
        platform: process.platform,
        userData: app.getPath('userData'),
        runtimeVersions: getRuntimeVersions(),
      },
      null,
      2,
    ),
  )
}

function recoverPersistedLongTasks(): void {
  const summary = reconcileLongTasks(getRepos())
  if (summary.scanned > 0) logger.info('tasks', 'startup task recovery completed', summary)
}

async function runPackageSmoke(): Promise<void> {
  try {
    await initDatabase()
    recoverPersistedLongTasks()
    registerAllIpc()
    const dbPath = join(app.getPath('userData'), DB_FILE_NAME)
    if (!existsSync(dbPath)) throw new Error(`数据库文件未创建：${dbPath}`)
    writePackageSmokeResult({ ok: true, dbPath, dbExists: true })
    app.exit(0)
  } catch (error) {
    writePackageSmokeResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    app.exit(1)
  }
}

function isE2eSmoke(): boolean {
  return process.env[E2E_SMOKE_ENV] === '1' || process.argv.includes('--sdns-e2e-smoke')
}

function isUiBaseline(): boolean {
  return process.env[UI_BASELINE_ENV] === '1' || process.argv.includes('--sdns-ui-baseline')
}

function writeE2eSmokeResult(payload: Record<string, unknown>): void {
  const resultPath =
    process.env[E2E_SMOKE_RESULT_ENV] ?? getSmokeArg('sdns-e2e-smoke-result')
  if (!resultPath) return
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        ...payload,
        version: app.getVersion(),
        platform: process.platform,
        userData: app.getPath('userData'),
        runtimeVersions: getRuntimeVersions(),
      },
      null,
      2,
    ),
  )
}

function waitForWindowLoaded(mainWindow: BrowserWindow): Promise<void> {
  if (!mainWindow.webContents.isLoadingMainFrame()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mainWindow.webContents.removeListener('did-finish-load', onFinish)
      mainWindow.webContents.removeListener('did-fail-load', onFail)
    }
    const onFinish = () => {
      cleanup()
      resolve()
    }
    const onFail = (_event: Electron.Event, _errorCode: number, errorDescription: string) => {
      cleanup()
      reject(new Error(errorDescription))
    }
    mainWindow.webContents.once('did-finish-load', onFinish)
    mainWindow.webContents.once('did-fail-load', onFail)
  })
}

async function runE2eSmoke(): Promise<void> {
  try {
    await initDatabase()
    recoverPersistedLongTasks()
    registerAllIpc()
    const mainWindow = createWindow({ show: false })
    await waitForWindowLoaded(mainWindow)
    const result = await runDesktopE2eSmoke(mainWindow)
    writeE2eSmokeResult({ ok: true, ...result })
    app.exit(0)
  } catch (error) {
    writeE2eSmokeResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    app.exit(1)
  }
}

function writeUiBaselineResult(payload: Record<string, unknown>): void {
  const resultPath =
    process.env[UI_BASELINE_RESULT_ENV] ?? getSmokeArg('sdns-ui-baseline-result')
  if (!resultPath) return
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        ...payload,
        version: app.getVersion(),
        platform: process.platform,
        userData: app.getPath('userData'),
      },
      null,
      2,
    ),
  )
}

async function runUiBaseline(): Promise<void> {
  try {
    const outputDir = process.env[UI_BASELINE_OUTPUT_ENV] ?? getSmokeArg('sdns-ui-baseline-output')
    if (!outputDir) throw new Error('UI 基线缺少输出目录')
    await initDatabase()
    recoverPersistedLongTasks()
    registerAllIpc()
    const mainWindow = createWindow({ show: false })
    await waitForWindowLoaded(mainWindow)
    const result = await runDesktopUiBaseline(mainWindow, outputDir)
    writeUiBaselineResult({ ok: true, ...result })
    app.exit(0)
  } catch (error) {
    writeUiBaselineResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    app.exit(1)
  }
}

function createWindow(options: { show?: boolean } = {}): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: '短剧 IP 小说写作工作台',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    if (options.show !== false) mainWindow.show()
  })

  let closingAfterDraftFlush = false
  mainWindow.on('close', (event) => {
    if (closingAfterDraftFlush || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    void mainWindow.webContents.executeJavaScript(
      'window.__sdnsFlushDrafts ? window.__sdnsFlushDrafts() : Promise.resolve()',
      true,
    ).catch((error) => {
      logger.warn('main', 'draft flush before close failed', { message: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      closingAfterDraftFlush = true
      mainWindow.close()
    })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternalUrl(url, { dev: isDevRuntime() })) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) return
    event.preventDefault()
    if (canOpenExternalUrl(url, { dev: isDevRuntime() })) void shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl).catch((error) => {
      logger.error('main', 'loadURL failed', { message: error.message, stack: error.stack })
    })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
      logger.error('main', 'loadFile failed', { message: error.message, stack: error.stack })
    })
  }

  return mainWindow
}

configurePackageSmokeUserData()

app.whenReady().then(async () => {
  installProcessLoggers()
  logger.info('main', 'app ready', { version: app.getVersion(), platform: process.platform })
  installSecurityHeaders()
  if (isPackageSmoke()) {
    await runPackageSmoke()
    return
  }
  if (isE2eSmoke()) {
    void runE2eSmoke()
    return
  }
  if (isUiBaseline()) {
    void runUiBaseline()
    return
  }
  await safeInitDatabase()
  recoverPersistedLongTasks()
  await initializeCloudAuth()
  registerAllIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
