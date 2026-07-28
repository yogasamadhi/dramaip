export async function runStartupDatabaseInitialization(
  initialize: () => Promise<void>,
  reportFailure: (message: string) => void,
): Promise<boolean> {
  try {
    await initialize()
    return true
  } catch (error) {
    reportFailure(error instanceof Error ? error.message : String(error))
    return false
  }
}

export async function runDatabaseGatedStartup(
  ensureDatabase: () => Promise<boolean>,
  startApplication: () => Promise<void>,
): Promise<boolean> {
  if (!await ensureDatabase()) return false
  await startApplication()
  return true
}
