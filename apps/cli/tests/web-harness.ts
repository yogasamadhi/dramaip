/**
 * Shared harness of the CLI acceptance suites: spawn the real source CLI
 * against a throwaway `DRAMAIP_HOME`, wait for the web profile's readiness
 * line, sign in through the launch token, and send raw HTTP requests.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect } from 'vitest'

export const DESKTOP_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CLI_ROOT = join(DESKTOP_ROOT, 'apps/cli')
const SOURCE_BIN = join(CLI_ROOT, 'src/bin.ts')
const TSX_LOADER = pathToFileURL(createRequire(join(CLI_ROOT, 'package.json')).resolve('tsx')).href
const READY_LINE = /dramaip web: (http:\/\/\S+)/u
export const BOOT_TIMEOUT_MS = 60_000

export interface Exit {
  readonly code: number | null
  readonly output: string
}

export interface RunningWeb {
  readonly child: ChildProcess
  readonly launchUrl: URL
  readonly exited: Promise<Exit>
  /** Combined stdout and stderr so far, launch token redacted. */
  readonly output: () => string
}

export interface HttpResult {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

/**
 * Fail early when the generated artifacts the web profile serves are missing.
 * `pnpm run test:infra` builds them first through `build:infra`.
 * @param paths - Desktop-relative artifact paths.
 */
export function assertBuilt(paths: readonly string[]): void {
  const missing = paths.filter(path => !existsSync(join(DESKTOP_ROOT, path)))
  expect(missing, 'run `pnpm run build:infra` before these suites').toEqual([])
}

function environment(home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD|PROXY)/iu.test(name)))
  return { ...env, DRAMAIP_HOME: home, NODE_NO_WARNINGS: '1', SSH_CONNECTION: '', SSH_TTY: '' }
}

export function redact(output: string): string {
  return output.replace(/([?&]token=)\S+/gu, '$1<redacted>')
}

function launch(home: string, args: readonly string[]): { child: ChildProcess, exited: Promise<Exit>, output: () => string } {
  const child = spawn(process.execPath, ['--import', TSX_LOADER, SOURCE_BIN, ...args], {
    cwd: CLI_ROOT,
    env: environment(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = (chunk: Buffer): void => { output = `${output}${String(chunk)}`.slice(-100_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const exited = new Promise<Exit>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => { resolve({ code, output }) })
  })
  return { child, exited, output: () => output }
}

/** Run one invocation to completion, killing it if it outlives the boot budget. */
export async function runToExit(home: string, args: readonly string[]): Promise<Exit> {
  const run = launch(home, args)
  const timer = setTimeout(() => { run.child.kill('SIGKILL') }, BOOT_TIMEOUT_MS)
  try {
    return await run.exited
  } finally {
    clearTimeout(timer)
  }
}

export async function startWeb(home: string): Promise<RunningWeb> {
  const run = launch(home, ['--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'])
  const launchUrl = await new Promise<URL>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`web did not become ready:\n${redact(run.output())}`)) }, BOOT_TIMEOUT_MS)
    const poll = setInterval(() => {
      const match = READY_LINE.exec(run.output())
      if (match?.[1] === undefined) return
      clearInterval(poll)
      clearTimeout(timer)
      resolve(new URL(match[1]))
    }, 50)
    void run.exited.then(({ code }) => {
      clearInterval(poll)
      clearTimeout(timer)
      reject(new Error(`web exited before readiness (${String(code)}):\n${redact(run.output())}`))
    })
  })
  return { child: run.child, launchUrl, exited: run.exited, output: () => redact(run.output()) }
}

export async function stop(running: RunningWeb, signal: NodeJS.Signals = 'SIGTERM'): Promise<Exit> {
  if (running.child.exitCode === null) running.child.kill(signal)
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  try {
    return await running.exited
  } finally {
    clearTimeout(forced)
  }
}

/** One raw request, so the test controls the wire Host header and nothing follows redirects. */
export function send(origin: URL, path: string, options: { method?: string, headers?: Record<string, string>, body?: string } = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: origin.hostname,
      port: origin.port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body }) })
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

/** The answer of one unary Remote call: the HTTP status and the Remote result. */
export interface RemoteAnswer<T = unknown> {
  readonly status: number
  readonly result: { ok: true, value: T } | { ok: false, error: { code: string, message: string } } | undefined
  readonly body: string
}

/**
 * Call one unary Remote endpoint over `POST /api/<endpoint>`, the way the
 * Client's HTTP carrier does.
 * @param origin - the web profile's origin.
 * @param endpoint - `<namespace>/<method>`.
 * @param args - arguments by parameter name.
 * @param headers - request headers (the session cookie).
 */
export async function callRemote<T = unknown>(origin: URL, endpoint: string, args: Record<string, unknown>, headers: Record<string, string>): Promise<RemoteAnswer<T>> {
  const response = await send(origin, `/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args } }),
  })
  let result: RemoteAnswer<T>['result']
  try {
    result = (JSON.parse(response.body) as { result?: RemoteAnswer<T>['result'] }).result
  } catch {
    result = undefined
  }
  return { status: response.status, result, body: response.body }
}

export async function signIn(launchUrl: URL): Promise<string> {
  const exchange = await send(launchUrl, `/${launchUrl.search}`)
  expect(exchange.status).toBe(303)
  const setCookie = exchange.headers['set-cookie']?.[0] ?? ''
  expect(setCookie).toMatch(/^dramaip-auth-/u)
  return setCookie.split(';', 1)[0]!
}

export async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/**
 * Read one P0 read-back path through the Remote method that replaced it.
 * The keys of tests/fixtures/baseline-userdata readback.json are the
 * `/api/v2` reads alpha.3 answered when the fixture was recorded.
 * @param origin - the web profile's origin.
 * @param path - a readback.json key.
 * @param cookie - the session cookie.
 */
export async function readBaseline(origin: URL, path: string, cookie: string): Promise<RemoteAnswer> {
  const project = /^\/api\/v2\/projects\/([^/]+)(?:\/(volumes|chapters))?$/u.exec(path)
  if (path === '/api/v2/providers') return callRemote(origin, 'agents/providersList', {}, { cookie })
  if (project === null) throw new Error(`no Remote read replaces ${path}`)
  const [endpoint, args]: [string, Record<string, unknown>] = project[2] === undefined
    ? ['workspace/projectsGet', { id: project[1] }]
    : [project[2] === 'volumes' ? 'writing/volumesList' : 'writing/chaptersList', { projectId: project[1] }]
  return callRemote(origin, endpoint, args, { cookie })
}
