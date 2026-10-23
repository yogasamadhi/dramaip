// Install the packed plugin into the locally installed DeepSeek Harness, but
// only under a throwaway DSH_HOME, HOME and Documents directory, and check:
//   1. `dsh plugin add <tgz>` adds the bundle to the web and headless profiles;
//   2. the composed web profile carries the plugin's layer;
//   3. a headless Agent turn against a local mock model is offered the
//      `dramaip_text_stats` tool, calls it, and gets its result back;
//   4. the web profile boots with every entry active and its Client graph
//      lists the plugin's panel bundle.
// Nothing reads or writes ~/.dsh. Usage (after `pnpm run pack:plugin`):
//   node scripts/verify-temp-home.mjs [--keep] [--serve]
// --keep leaves the temp directory; --serve leaves the web profile running
// and prints its URL until interrupted. DSH_BIN overrides the CLI path.

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const keep = process.argv.includes('--keep')
const serve = process.argv.includes('--serve')
const dsh = process.env.DSH_BIN ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const tarball = join(root, 'build', `${manifest.name}-${manifest.version}.tgz`)
const TOOL = 'dramaip_text_stats'
const SAMPLE = '林夏推开门。\n“你来晚了。”他说。\n\n「对不起。」\n'

if (!existsSync(dsh)) throw new Error(`DeepSeek Harness CLI not found at ${dsh}; set DSH_BIN`)
if (!existsSync(tarball)) throw new Error(`${tarball} is missing; run \`pnpm run pack:plugin\` first`)

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'dramaip-dsh-plugin-')))
const home = join(temp, 'home'), dshHome = join(temp, 'dsh'), work = join(temp, 'work')
for (const dir of [join(home, 'Documents'), work]) mkdirSync(dir, { recursive: true })

const env = {
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: `${temp}/`,
  DSH_HOME: dshHome,
  DSH_TELEMETRY_DISABLED: '1',
  pnpm_config_offline: 'true',
  MOCK_API_KEY: 'mock-key',
}

// The workspace controller would otherwise ask macOS for the real Documents folder.
const isolate = join(temp, 'isolate.yml')
writeFileSync(isolate, [
  '- id: workspace-controller',
  "  name: '@deepseek-ai/dsh-api-workspace-controller'",
  '  config:',
  `    documentsDirectory: ${JSON.stringify(join(home, 'Documents'))}`,
  '',
].join('\n'))

/** Run the CLI to completion; resolves with its exit code and output. */
async function run(args) {
  const child = spawn(dsh, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'exit')
  return { code, stdout, stderr }
}

function check(condition, message, detail = '') {
  if (!condition) throw new Error(`${message}${detail === '' ? '' : `\n${detail}`}`)
  console.log(`ok - ${message}`)
}

function offers(payload) {
  return (payload.tools ?? []).some(tool => tool.function?.name === TOOL)
}

function textOf(message) {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}

/** An OpenAI-compatible streaming endpoint that calls the tool once, then echoes its result. */
async function mockModel() {
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body || '{}')
    requests.push(payload)
    const toolResult = (payload.messages ?? []).findLast(message => message.role === 'tool')
    // Requests that do not offer the tool (e.g. a session title) get plain text.
    const callTool = toolResult === undefined && offers(payload)
    const base = { id: `mock-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: payload.model }
    const delta = callTool
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: TOOL, arguments: JSON.stringify({ text: SAMPLE }) } }] }
      : { role: 'assistant', content: toolResult === undefined ? 'mock text' : `RESULT\n${textOf(toolResult)}` }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: callTool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, requests, port: server.address().port }
}

/** Boot the web profile; resolves once it prints its URL. */
async function bootWeb() {
  const child = spawn(dsh, ['--profile', 'web', '--patch', isolate, '--no-open', '--port', '0'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`web profile printed no URL within 60 s:\n${output}`)), 60_000)
    const read = chunk => {
      output += chunk
      const match = /dsh web: (http:\/\/\S+)/.exec(output)
      if (match !== null) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`web profile exited with ${code}:\n${output}`)) })
  })
  // Activation diagnostics follow the URL line; give them a moment to land.
  await new Promise(resolve => setTimeout(resolve, 3_000))
  return { child, url, output: () => output }
}

/** The page's session cookie, from opening the tokened URL. */
async function cookieFor(url) {
  const response = await fetch(url, { redirect: 'manual' })
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0])
  if (cookies.length === 0) throw new Error(`no cookie from ${url} (status ${response.status})`)
  return cookies.join('; ')
}

/** The first `graph` frame of the Host's Client plugin stream. */
async function clientGraph(origin, cookie) {
  const abort = new AbortController()
  const response = await fetch(`${origin}/plugins/events`, { headers: { cookie }, signal: abort.signal })
  if (response.status !== 200) throw new Error(`/plugins/events answered ${response.status}`)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`/plugins/events closed before a graph frame: ${buffered}`)
      buffered += value
      for (const block of buffered.split('\n\n').slice(0, -1)) {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (data === '') continue
        const frame = JSON.parse(data)
        if (frame.type === 'graph') return frame.graph
      }
    }
  } finally {
    abort.abort()
  }
}

let web
let model
try {
  console.log(`temp home: ${temp}`)
  for (const profile of ['web', 'headless']) {
    const added = await run(['plugin', '--profile', profile, 'add', tarball])
    check(added.code === 0, `dsh plugin --profile ${profile} add exits 0`, added.stdout + added.stderr)
    const bundles = JSON.parse(readFileSync(join(dshHome, 'profiles', profile, 'package.json'), 'utf8')).dsh.profile.bundles
    check(bundles.includes(manifest.name), `${profile} profile lists the ${manifest.name} bundle`, JSON.stringify(bundles))
  }

  const dump = await run(['--profile', 'web', '--dump-config'])
  check(dump.code === 0 && dump.stdout.includes(`# == ${manifest.name}`) && dump.stdout.includes(`- id: ${manifest.name}`),
    'composed web profile carries the plugin layer and row', dump.stderr)

  model = await mockModel()
  const mock = join(temp, 'mock-model.yml')
  writeFileSync(mock, [
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '  config:',
    '    providers:',
    '      mock:',
    '        apiKeyEnv: MOCK_API_KEY',
    '        api: openai-completions',
    `        baseURL: http://127.0.0.1:${model.port}/v1`,
    '        models:',
    '          - id: mock-model',
    '            name: mock-model',
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: mock',
    '    model: mock-model',
    '',
  ].join('\n'))
  const turn = await run(['--profile', 'headless', '--patch', isolate, '--patch', mock, 'Measure the sample chapter.'])
  check(turn.code === 0, 'headless Agent turn exits 0', turn.stdout + turn.stderr)
  check(!/did not activate/.test(turn.stderr), 'headless profile activates every entry', turn.stderr)
  const summary = model.requests.map((request, index) => `#${index + 1} tools=${(request.tools ?? []).length} last=${request.messages?.at(-1)?.role}`).join('\n')
  check(model.requests.some(offers), `a model request offers the ${TOOL} tool`, summary)
  const returned = model.requests.find(request => (request.messages ?? []).some(message => message.role === 'tool' && textOf(message).includes('CJK characters: 14')))
  check(returned !== undefined, 'the Agent runs the tool and returns its result to the model', `${summary}\n${turn.stdout}\n${turn.stderr}`)
  console.log(`   model requests:\n${summary.replace(/^/gm, '   ')}`)
  check(/CJK characters: 14/.test(turn.stdout) && /dialogue lines: 2/.test(turn.stdout), 'final answer carries the tool result', turn.stdout)

  web = await bootWeb()
  check(!/did not activate/.test(web.output()), 'web profile activates every entry', web.output())
  const origin = new URL(web.url).origin
  const graph = await clientGraph(origin, await cookieFor(web.url))
  check(JSON.stringify(graph).includes(manifest.name), 'web Client graph lists the plugin panel bundle', JSON.stringify(graph).slice(0, 2000))

  if (serve) {
    console.log(`\nserving ${web.url}\n(temp home kept; Ctrl-C to stop)`)
    await once(process, 'SIGINT')
  }
} finally {
  model?.server.close()
  if (web !== undefined && web.child.exitCode === null) {
    web.child.kill('SIGTERM')
    await once(web.child, 'exit')
  }
  if (keep || serve) console.log(`kept ${temp}`)
  else rmSync(temp, { recursive: true, force: true })
}
