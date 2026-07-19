import { strict as assert } from 'node:assert'
import { videoProviderFromConfig } from '../packages/ai/src/providers/video/factory'

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main(): Promise<void> {
  const apiKey = process.env.HAILUO_SANDBOX_API_KEY?.trim()
  const billingAllowed = process.env.HAILUO_SANDBOX_ALLOW_BILLING === '1'

  if (!billingAllowed) {
    throw new Error('Hailuo sandbox smoke is billable. Set HAILUO_SANDBOX_ALLOW_BILLING=1 only in an authorized sandbox run.')
  }
  if (!apiKey) {
    throw new Error('HAILUO_SANDBOX_API_KEY must be supplied by the authorized secret-injection environment.')
  }

  const provider = videoProviderFromConfig({
    id: 'hailuo-sandbox',
    name: 'MiniMax Hailuo sandbox',
    kind: 'hailuo',
    baseUrl: process.env.HAILUO_SANDBOX_BASE_URL?.trim() || 'https://api.minimaxi.com',
    apiKey,
    model: process.env.HAILUO_SANDBOX_MODEL?.trim() || 'MiniMax-Hailuo-2.3',
    defaultParams: JSON.stringify({
      duration: 6,
      resolution: '768P',
      prompt_optimizer: false,
      featureEnabled: true,
    }),
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const created = await provider.createTask({
    model: process.env.HAILUO_SANDBOX_MODEL?.trim() || 'MiniMax-Hailuo-2.3',
    prompt: process.env.HAILUO_SANDBOX_PROMPT?.trim() || 'A paper boat floats slowly across a quiet pond at sunrise, cinematic close-up.',
  })
  assert.ok(created.remoteTaskId, 'Hailuo create response must return a task id')

  const deadline = Date.now() + 10 * 60_000
  let terminal = created
  while (Date.now() < deadline) {
    await delay(10_000)
    terminal = await provider.getTaskStatus(created.remoteTaskId)
    if (terminal.status === 'success' || terminal.status === 'failed') break
  }

  assert.equal(terminal.status, 'success', `Hailuo task did not complete successfully: ${terminal.errorMessage ?? 'timed out'}`)
  assert.equal(terminal.results.length, 1, 'Hailuo completion must resolve one downloadable result')
  const downloadUrl = terminal.results[0].resultVideoUrl
  assert.ok(/^https:\/\//.test(downloadUrl), 'Hailuo file retrieval must resolve an HTTPS download URL')

  // Confirm the returned URL is usable without retaining the video body in test output or disk.
  const download = await fetch(downloadUrl)
  assert.ok(download.ok, `Hailuo download URL returned HTTP ${download.status}`)
  await download.body?.cancel()

  console.log('Hailuo sandbox lifecycle OK (task id and URLs intentionally redacted)')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
