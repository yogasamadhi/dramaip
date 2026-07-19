import { strict as assert } from 'node:assert'
import { videoProviderFromConfig } from '../packages/ai/src/providers/video/factory'

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main(): Promise<void> {
  const apiKey = process.env.WAN_SANDBOX_API_KEY?.trim()
  const billingAllowed = process.env.WAN_SANDBOX_ALLOW_BILLING === '1'

  if (!billingAllowed) {
    throw new Error('Wan sandbox smoke is billable. Set WAN_SANDBOX_ALLOW_BILLING=1 only in an authorized sandbox run.')
  }
  if (!apiKey) {
    throw new Error('WAN_SANDBOX_API_KEY must be supplied by the authorized secret-injection environment.')
  }

  const model = process.env.WAN_SANDBOX_MODEL?.trim() || 'wan2.7-t2v-2026-06-12'
  const provider = videoProviderFromConfig({
    id: 'wan-sandbox',
    name: 'Alibaba Cloud Wan sandbox',
    kind: 'wan',
    baseUrl: process.env.WAN_SANDBOX_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/api/v1',
    apiKey,
    model,
    defaultParams: JSON.stringify({
      duration: 10,
      resolution: '720P',
      ratio: '9:16',
      prompt_extend: true,
      watermark: true,
      featureEnabled: true,
    }),
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const created = await provider.createTask({
    model,
    prompt: process.env.WAN_SANDBOX_PROMPT?.trim() || 'A paper boat floats slowly across a quiet pond at sunrise, cinematic close-up.',
  })
  assert.ok(created.remoteTaskId, 'Wan create response must return a task id')

  const deadline = Date.now() + 10 * 60_000
  let terminal = created
  while (Date.now() < deadline) {
    await delay(15_000)
    terminal = await provider.getTaskStatus(created.remoteTaskId)
    if (terminal.status === 'success' || terminal.status === 'failed' || terminal.status === 'canceled') break
  }

  assert.equal(terminal.status, 'success', `Wan task did not complete successfully: ${terminal.errorMessage ?? 'timed out'}`)
  assert.equal(terminal.results.length, 1, 'Wan completion must return one downloadable result')
  const downloadUrl = terminal.results[0].resultVideoUrl
  assert.ok(/^https:\/\//.test(downloadUrl), 'Wan result must contain an HTTPS download URL')

  // Confirm the time-limited URL is usable without retaining a billable output on disk or logs.
  const download = await fetch(downloadUrl)
  assert.ok(download.ok, `Wan download URL returned HTTP ${download.status}`)
  await download.body?.cancel()

  console.log('Wan sandbox lifecycle OK (task id, URL, prompt, and key intentionally redacted)')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
