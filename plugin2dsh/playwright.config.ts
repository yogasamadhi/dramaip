import { defineConfig } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const cache = join(homedir(), 'Library/Caches/ms-playwright')
const candidates = existsSync(cache)
  ? readdirSync(cache)
      .filter((x) => x.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse()
      .map((x) => join(cache, x, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'))
  : []
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE ?? candidates.find(existsSync)
export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  timeout: 40_000,
  reporter: 'list',
  outputDir: 'build/test-results',
  use: {
    headless: true,
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
    launchOptions: { ...(executablePath ? { executablePath } : {}) },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
