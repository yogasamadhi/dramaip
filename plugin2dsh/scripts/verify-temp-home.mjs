// Real installed DSH, isolated HOME/DSH_HOME/Documents, local mock model only.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dsh =
  process.env.DSH_BIN ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const tarball = join(root, 'build', `${manifest.name}-${manifest.version}.tgz`)
if (!existsSync(dsh) || !existsSync(tarball))
  throw new Error('Missing DSH or tgz; run pack:plugin first (DSH_BIN overrides installed CLI)')
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'dramaip-dsh-plugin-')))
const home = join(temp, 'home'),
  dshHome = join(temp, 'dsh'),
  work = join(temp, 'work')
mkdirSync(join(home, 'Documents'), { recursive: true })
mkdirSync(work)
const env = {
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: `${temp}/`,
  DSH_HOME: dshHome,
  DSH_TELEMETRY_DISABLED: '1',
  pnpm_config_offline: 'true',
  MOCK_API_KEY: 'mock-key',
}
const isolate = join(temp, 'isolate.yml')
writeFileSync(
  isolate,
  `- id: workspace-controller\n  name: '@deepseek-ai/dsh-api-workspace-controller'\n  config:\n    documentsDirectory: ${JSON.stringify(join(home, 'Documents'))}\n`,
)
const children = new Set()
let model,
  project,
  web,
  removed = false
const requests = []
const SAMPLE = '林夏推开门。\n“你来晚了。”他说。\n\n「对不起。」\n'
function ok(message) {
  console.log(`ok - ${message}`)
}
function child(args) {
  const p = spawn(dsh, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(p)
  p.on('exit', () => children.delete(p))
  return p
}
async function stop(p) {
  if (p && p.exitCode === null) {
    p.kill('SIGTERM')
    await once(p, 'exit')
  }
}
async function run(args, timeout = 60_000) {
  const p = child(args)
  let stdout = '',
    stderr = ''
  p.stdout.on('data', (b) => {
    stdout += b
  })
  p.stderr.on('data', (b) => {
    stderr += b
  })
  const timer = setTimeout(() => p.kill('SIGTERM'), timeout)
  try {
    const [code] = await once(p, 'exit')
    assert.equal(code, 0, stdout + stderr)
    return { stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}
async function boot() {
  const p = child(['--profile', 'web', '--patch', isolate, '--no-open', '--port', '0'])
  let output = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      p.kill('SIGTERM')
      reject(new Error(output || 'web startup timeout'))
    }, 60_000)
    const read = (b) => {
      output += b
      const m = /dsh web: (http:\/\/\S+)/.exec(output)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    }
    p.stdout.on('data', read)
    p.stderr.on('data', read)
    p.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`web exited ${code}: ${output}`))
    })
  })
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  assert.ok(cookie, 'authenticated session cookie')
  const origin = new URL(url).origin
  const rpc = async (request) => {
    const rpcId = crypto.randomUUID()
    const result = await fetch(`${origin}/api/dramaip/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method: 'dramaip/dispatch',
        payload: { args: { request } },
      }),
    })
    const body = await result.json()
    assert.equal(result.status, 200, JSON.stringify(body))
    assert.equal(body.rpcId, rpcId)
    if (!body.result.ok)
      throw Object.assign(new Error(JSON.stringify(body.result.error)), body.result.error)
    return body.result.value
  }
  // URL publication precedes plugin activation; wait on the real business API.
  for (let i = 0; ; i++) {
    try {
      await rpc({ op: 'list' })
      break
    } catch (error) {
      if (i === 80 || p.exitCode !== null || /did not activate/.test(output)) {
        await stop(p)
        throw new Error(`${error}\n${output}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  assert.ok(!/did not activate/.test(output), output)
  return { p, url, origin, cookie, rpc }
}
function textOf(message) {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}
async function mockModel() {
  const server = createServer(async (request, response) => {
    try {
      let body = ''
      for await (const b of request) body += b
      const payload = JSON.parse(body)
      requests.push(payload)
      const tools = payload.tools ?? []
      const history = (payload.messages ?? []).filter((m) => m.role === 'tool')
      const step = history.length
      const sequence = [
        ['dramaip_list_projects', {}],
        ['dramaip_text_stats', { text: SAMPLE }],
        ['dramaip_project_summary', { projectId: project.id }],
        ['dramaip_read_settings', { projectId: project.id }],
        ['dramaip_read_chapter', { projectId: project.id, chapterId: project.chapters[0].id }],
        [
          'dramaip_propose_chapter',
          {
            projectId: project.id,
            chapterId: project.chapters[0].id,
            baseRevision: project.chapters[0].revision,
            baseContentRevision: project.contentRevision,
            text: '林夏推开门。\n“这次，我愿意听你说。”',
            explanation: '保留人物自主选择，调整对白。',
          },
        ],
      ]
      const next =
        !removed && tools.length > 0 && step < sequence.length ? sequence[step] : undefined
      if (next)
        assert.ok(
          tools.some((t) => t.function?.name === next[0]),
          `tool ${next[0]} is offered`,
        )
      const delta = next
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${step}`,
                type: 'function',
                function: { name: next[0], arguments: JSON.stringify(next[1]) },
              },
            ],
          }
        : {
            role: 'assistant',
            content: history.length ? `RESULT\n${history.map(textOf).join('\n')}` : '故事修改',
          }
      const base = {
        id: `mock-${requests.length}`,
        object: 'chat.completion.chunk',
        created: 0,
        model: payload.model,
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: next ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
      )
      response.end('data: [DONE]\n\n')
    } catch (error) {
      response.writeHead(500)
      response.end(String(error))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}
try {
  console.log(`temp home: ${temp}`)
  const version = await run(['--version'])
  assert.equal(version.stdout.trim(), '0.2.1-rc.3')
  for (const profile of ['web', 'headless']) {
    await run(['plugin', '--profile', profile, 'add', tarball])
    const packages = JSON.parse(
      readFileSync(join(dshHome, 'profiles', profile, 'package.json'), 'utf8'),
    )
    assert.ok(packages.dsh.profile.bundles.includes(manifest.name))
    ok(`${profile}: packed plugin installed`)
  }
  web = await boot()
  ok('real strict Typert Gateway and storage activate')
  project = (
    await web.rpc({
      op: 'create',
      title: '临时验证作品',
      synopsis: '测试故事',
      authorIntent: '尊重人物自主选择',
    })
  ).project
  project = (
    await web.rpc({
      op: 'createChapter',
      projectId: project.id,
      expectedRevision: project.stateRevision,
      title: '第一章',
      text: SAMPLE,
    })
  ).project
  project = (
    await web.rpc({
      op: 'saveSetting',
      projectId: project.id,
      expectedRevision: project.stateRevision,
      kind: 'character',
      title: '林夏',
      text: '有自己的选择',
      archived: false,
    })
  ).project
  await assert.rejects(
    web.rpc({
      op: 'saveChapter',
      projectId: project.id,
      expectedRevision: 0,
      chapterId: project.chapters[0].id,
      title: '错版',
      text: '不应写入',
    }),
    { code: 'dramaip/conflict' },
  )
  await stop(web.p)
  web = undefined
  model = await mockModel()
  const mock = join(temp, 'mock.yml')
  writeFileSync(
    mock,
    `- id: llm-pi-ai\n  name: '@deepseek-ai/dsh-llm-pi-ai'\n  config:\n    providers:\n      mock:\n        apiKeyEnv: MOCK_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${model.address().port}/v1\n        models:\n          - id: mock-model\n            name: mock-model\n- id: agent-default-model\n  name: '@deepseek-ai/dsh-agent-default-model'\n  config:\n    provider: mock\n    model: mock-model\n`,
  )
  const turn = await run([
    '--profile',
    'headless',
    '--patch',
    isolate,
    '--patch',
    mock,
    'Read the project and submit a chapter proposal.',
  ])
  assert.ok(!/did not activate/.test(turn.stderr), turn.stderr)
  assert.ok(turn.stdout.includes('正文未改变'), turn.stdout + turn.stderr)
  const finalTools = requests.findLast(
    (r) => (r.messages ?? []).filter((m) => m.role === 'tool').length >= 6,
  )
  assert.ok(finalTools, 'all six calls returned to the real Agent loop')
  const statsMessage = finalTools.messages.find(
    (m) => m.role === 'tool' && textOf(m).includes('cjkCharacters'),
  )
  assert.ok(statsMessage && textOf(statsMessage).includes('14'))
  ok('real Agent reads project/settings/chapter and persists a pending proposal')
  web = await boot()
  let current = (await web.rpc({ op: 'get', projectId: project.id })).project
  assert.equal(current.chapters[0].text, SAMPLE)
  assert.equal(current.proposals.length, 1)
  assert.ok(current.proposals[0].callId)
  assert.ok(current.proposals[0].sessionId)
  const accept = {
    op: 'accept',
    projectId: current.id,
    expectedRevision: current.stateRevision,
    proposalId: current.proposals[0].id,
  }
  current = (await web.rpc(accept)).project
  const retry = (await web.rpc(accept)).project
  assert.deepEqual(current, retry)
  assert.equal(current.chapters[0].revision, 2)
  const pack = await web.rpc({ op: 'export', projectId: current.id, format: 'json' })
  const imported = (await web.rpc({ op: 'import', package: JSON.parse(pack.text) })).project
  assert.notEqual(imported.id, current.id)
  assert.equal(imported.chapters[0].text, current.chapters[0].text)
  await web.rpc({
    op: 'updateProject',
    projectId: imported.id,
    expectedRevision: imported.stateRevision,
    title: '导入验证作品',
    synopsis: imported.synopsis,
    authorIntent: imported.authorIntent,
    archived: false,
  })
  await stop(web.p)
  web = await boot()
  const restored = (await web.rpc({ op: 'get', projectId: current.id })).project
  assert.deepEqual(restored, current)
  ok('acceptance is atomic/idempotent; JSON remaps IDs; restart restores exact state')
  // Corrupt ONLY this throwaway authoritative record, then restore its exact bytes.
  await stop(web.p)
  web = undefined
  const storageFile = join(dshHome, 'storages', 'dramaip.json')
  const originalBytes = readFileSync(storageFile)
  const broken = JSON.parse(originalBytes)
  broken.tables.projects[current.id].chapters[0].text = 'corrupt head without a matching revision'
  writeFileSync(storageFile, JSON.stringify(broken))
  try {
    await assert.rejects(boot(), /invalid-record|does not match its schema/)
  } finally {
    writeFileSync(storageFile, originalBytes)
  }
  ok('corrupt authoritative storage refuses activation and is never reset or skipped')
  // Remove while stopped; a subsequent real Agent has no DramaIP tools.
  await run(['plugin', '--profile', 'headless', 'remove', manifest.name])
  ok('headless plugin removal succeeds without touching manuscript storage')
  removed = true
  const requestCount = requests.length
  await run(['--profile', 'headless', '--patch', isolate, '--patch', mock, 'Say hello.'])
  assert.ok(
    requests
      .slice(requestCount)
      .every((r) => !(r.tools ?? []).some((t) => t.function?.name.startsWith('dramaip_'))),
  )
  ok('after removal, real Agent no longer receives DramaIP tools')
  web = await boot()
  if (process.env.DRAMAIP_TEST_STATE_FILE)
    writeFileSync(
      process.env.DRAMAIP_TEST_STATE_FILE,
      JSON.stringify({ url: web.url, temp, projectId: current.id }),
    )
  if (process.argv.includes('--serve')) {
    console.log(`serving ${web.url}`)
    await new Promise((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
  }
} finally {
  model?.close()
  await Promise.all([...children].map(stop))
  if (process.argv.includes('--keep')) console.log(`kept ${temp}`)
  else rmSync(temp, { recursive: true, force: true })
}
