const { existsSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function notarizeMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  const required = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.log(`[notarize] skipped: missing ${missing.join(', ')}`)
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)
  if (!existsSync(appPath)) {
    throw new Error(`[notarize] app bundle not found: ${appPath}`)
  }

  const { notarize } = require('@electron/notarize')
  await notarize({
    appBundleId: context.packager.appInfo.appId,
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
}
