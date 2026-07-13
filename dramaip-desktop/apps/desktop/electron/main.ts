// Electron 主进程入口
import { app, BrowserWindow, shell, session } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DB_FILE_NAME } from '@sdns/core'
import { initDatabase, safeInitDatabase } from './db'
import { registerAllIpc } from './ipc'
import { installProcessLoggers, logger } from './logger'
import { runDesktopE2eSmoke } from './e2e-smoke'
import { canOpenExternalUrl, createContentSecurityPolicy } from './security-policy'
import { initializeCloudAuth } from './cloud-auth'

const PACKAGE_SMOKE_ENV = 'SDNS_PACKAGE_SMOKE'
const PACKAGE_SMOKE_RESULT_ENV = 'SDNS_PACKAGE_SMOKE_RESULT'
const PACKAGE_SMOKE_USER_DATA_ENV = 'SDNS_PACKAGE_SMOKE_USER_DATA'
const E2E_SMOKE_ENV = 'SDNS_E2E_SMOKE'
const E2E_SMOKE_RESULT_ENV = 'SDNS_E2E_SMOKE_RESULT'
const E2E_SMOKE_USER_DATA_ENV = 'SDNS_E2E_SMOKE_USER_DATA'

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
    getSmokeArg('sdns-e2e-smoke-user-data')
  if (userData) app.setPath('userData', userData)
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
      },
      null,
      2,
    ),
  )
}

async function runPackageSmoke(): Promise<void> {
  try {
    await initDatabase()
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
  await safeInitDatabase()
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
