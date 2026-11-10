/**
 * P2 acceptance 5: the browser smoke of the §7.3 core flows on the `web`
 * profile. The real source CLI serves the existing Studio app through the
 * transitional legacy client, a headless browser signs in with the launch
 * token, and every flow drives the same page-level steps as its Electron
 * spec. Data is seeded through `/api/v2` from the signed page itself.
 *
 * Not covered here, because the `web` profile has no Desktop Host until P3:
 * local agent engines (engine-runtime), Host media-library playback and
 * render sources (media-playback, timeline-render-sources) and the Electron
 * window focus contract (background-debug). Only their web-facing
 * boundaries are asserted.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Locator, Page, Route } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertBuilt, BOOT_TIMEOUT_MS, DESKTOP_ROOT, send, startWeb, stop, type RunningWeb } from './web-harness.ts'
import {
  openProductionStage,
  openProjectCreation,
  openProjectTool,
  selectWorkspaceObject,
} from '../../../tests/electron/project-tools.ts'

const desktopRequire = createRequire(join(DESKTOP_ROOT, 'package.json'))
const { chromium } = desktopRequire('playwright') as typeof import('playwright')
const { expect: see } = desktopRequire('@playwright/test') as typeof import('@playwright/test')

/** The Electron window size the Studio layout is specified at. */
const VIEWPORT = { width: 1800, height: 1000 }

/** What the legacy client installs where the Electron preload put it. */
interface StudioWindow { readonly runtimeBootstrap: { resolve(): Promise<{ baseUrl: string, accessToken: string, runtimeId: string }> } }

interface Project { readonly id: string, readonly title: string }
interface Chapter { readonly id: string, readonly projectId: string, readonly title: string, readonly content: string, readonly version: number }

let home: string
let browser: Browser
let web: RunningWeb
let context: BrowserContext
let page: Page

/** Open the launch URL in a fresh context: the token exchange sets the session cookie. */
async function openStudio(): Promise<void> {
  await context?.close()
  context = await browser.newContext({ viewport: VIEWPORT, locale: 'zh-CN' })
  page = await context.newPage()
  await page.goto(web.launchUrl.href)
  await see(page.getByRole('heading', { name: '项目工作台' })).toBeVisible({ timeout: 30_000 })
}

/** One `/api/v2` call from the signed page, with the page's own cookie. */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(async ([verb, target, payload]) => {
    const response = await fetch(`/api/v2/${target}`, {
      method: verb,
      headers: {
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(verb === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${verb} ${target}: HTTP ${response.status} ${text}`)
    return text === '' ? undefined : JSON.parse(text)
  }, [method, path, body] as const) as Promise<T>
}

/**
 * Route the page's Remote call of `endpoint` (`<namespace>/<method>`) whose
 * arguments include `args`; every other call goes on.
 * @returns a function removing the route.
 */
async function routeRemote(
  endpoint: string,
  args: Record<string, unknown>,
  handler: (route: Route) => Promise<void> | void,
): Promise<() => Promise<void>> {
  const url = `**/api/${endpoint}`
  const matcher = async (route: Route): Promise<void> => {
    const sent = (route.request().postDataJSON() as { payload?: { args?: Record<string, unknown> } } | null)?.payload?.args ?? {}
    if (Object.entries(args).every(([name, value]) => sent[name] === value)) return handler(route)
    return route.fallback()
  }
  await page.route(url, matcher)
  return () => page.unroute(url, matcher)
}

const createProject = async (input: Record<string, unknown>): Promise<Project> =>
  (await api<{ project: Project }>('POST', 'projects', input)).project
const createChapter = (input: Record<string, unknown>): Promise<Chapter> => api<Chapter>('POST', 'chapters', input)
/** The hash route a link targets: a `<base>` element makes the hash router write absolute hrefs. */
const actionOf = async (scope: Locator): Promise<string> =>
  new URL((await scope.getByRole('link').first().getAttribute('href'))!, page.url()).hash
const navigate = (route: string): Promise<void> => page.evaluate((value) => { window.location.hash = value }, route)

beforeAll(async () => {
  assertBuilt(['apps/web/dist/index.html', 'packages/workspace/studio-client/lib/client.js'])
  home = mkdtempSync(join(tmpdir(), 'dramaip-p2-smoke-'))
  browser = await chromium.launch({ headless: true })
  web = await startWeb(home)
  await openStudio()
}, BOOT_TIMEOUT_MS * 2)

afterAll(async () => {
  await context?.close()
  await browser?.close()
  if (web !== undefined) await stop(web)
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
})

describe('§7.3 core flows in the browser', { timeout: 180_000 }, () => {
  it('starts, signs in and enters the project home (abc-smoke)', async () => {
    // Without the launch exchange nothing behind /api/v2 answers.
    expect((await send(web.launchUrl, '/api/v2/runtime')).status).toBe(401)
    await see(page.getByRole('link', { name: '项目库', exact: true })).toBeVisible()
    const englishOnly = (await page.getByRole('button').allTextContents())
      .map(value => value.trim())
      .filter(value => value && /[A-Za-z]/u.test(value) && !/[㐀-鿿]/u.test(value))
    expect(englishOnly).toEqual([])
    expect(await page.evaluate(() => Object.keys((window as unknown as StudioWindow).runtimeBootstrap).sort())).toEqual(['resolve'])
    const bootstrap = await page.evaluate(() => (window as unknown as StudioWindow).runtimeBootstrap.resolve())
    expect(bootstrap.baseUrl).toBe(web.launchUrl.origin)
    expect(bootstrap.accessToken).toBe('carried-by-the-signed-browser-cookie')
    const runtime = await api<{ runtimeId: string, profile: string, capabilities: Record<string, boolean> }>('GET', 'runtime')
    expect(bootstrap.runtimeId).toBe(runtime.runtimeId)
    expect(runtime.capabilities.desktopHost).toBe(false)
    // The renderer's root Slot hosts the existing app: one React root.
    expect(await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter(element => Object.keys(element).some(key => key.startsWith('__reactContainer$'))).length)).toBe(1)
    await see(page.locator('[data-slot="root"] main')).toBeVisible()

    await page.getByRole('button', { name: '先看看示例' }).click()
    await see(page.getByRole('heading', { name: '示例短剧：雨夜归来' })).toBeVisible()
    await see(page.getByRole('link', { name: '故事', exact: true })).toBeVisible()
  })

  it('keeps the home progress honest when a read fails, across a restart (project-home-progress)', async () => {
    const project = await createProject({ title: '首页真实小说', mode: 'series_longform' })
    const chapter = await createChapter({
      projectId: project.id,
      title: '仍可打开的作者原稿',
      content: 'PRIVATE 作者原稿，读取错误不能成为继续生成或采用的授权。',
    })
    const originalChapters = await api<Chapter[]>('GET', `projects/${project.id}/chapters`)
    const card = () => page.getByLabel('继续当前项目', { exact: true })
    await navigate(`/projects/${project.id}?chapterId=${chapter.id}`)
    await see(page.getByRole('navigation', { name: '当前项目导航', exact: true })).toBeVisible()
    await navigate('/')
    await see(card().getByText('推荐原因：', { exact: false })).toBeVisible()
    const normalAction = await actionOf(card())

    let failedReads = 0
    await navigate(`/tasks?projectId=${project.id}`)
    const unrouteGraph = await routeRemote('production/graph', { id: project.id }, (route) => { failedReads++; return route.abort('failed') })
    // Let the five-second query cache go stale without touching React internals.
    await page.waitForTimeout(5_200)
    await navigate('/')
    await see.poll(() => failedReads, { timeout: 10_000 }).toBeGreaterThan(0)
    await see(card().getByRole('alert')).toContainText('项目进度尚未核验', { timeout: 10_000 })
    await see(card().getByText('推荐原因：', { exact: false })).toHaveCount(0)
    const safeOpen = card().getByRole('link', { name: '打开已有项目', exact: true })
    const safeHref = new URL((await safeOpen.getAttribute('href'))!, page.url())
    expect([safeHref.origin, safeHref.hash]).toEqual([web.launchUrl.origin, `#/projects/${project.id}`])
    await safeOpen.click()
    await see(page.locator('main').getByText(chapter.content, { exact: true })).toBeVisible()
    await unrouteGraph()
    await navigate('/')
    await see(card().getByText('推荐原因：', { exact: false })).toBeVisible()
    expect(await actionOf(card())).toBe(normalAction)

    // Restart the web profile on the same home: a new launch token, the same data.
    await stop(web)
    web = await startWeb(home)
    await openStudio()
    await navigate('/')
    await see(card().getByText('推荐原因：', { exact: false })).toBeVisible()
    expect(await actionOf(card())).toBe(normalAction)
    expect(await api<Chapter>('GET', `chapters/${chapter.id}`)).toEqual(chapter)
    expect(await api<Chapter[]>('GET', `projects/${project.id}/chapters`)).toEqual(originalChapters)
  })

  it('never substitutes a wrong project or chapter with a cached manuscript (project-identity)', async () => {
    const project = await createProject({ title: '小说精确原项目' })
    const other = await createProject({ title: '不能替代的其他小说' })
    const original = await createChapter({ projectId: project.id, title: '指定本章', content: 'PRIVATE 原项目的唯一正文，不能借错误地址读取。' })
    const second = await createChapter({ projectId: project.id, title: '另选的实际本章', content: 'PRIVATE 同项目第二章的实际正文。' })
    const foreign = await createChapter({ projectId: other.id, title: '其他项目本章', content: 'PRIVATE 其他项目正文不可冒充当前本章。' })
    const originals = await api<Chapter[]>('GET', `projects/${project.id}/chapters`)
    const body = (content: string) => page.locator('main').getByText(content, { exact: true })
    const originalRoute = `/projects/${project.id}?chapterId=${original.id}`
    await navigate(originalRoute)
    await see(body(original.content)).toBeVisible()
    await navigate(`/projects/${project.id}?chapterId=${second.id}`)
    await see(body(second.content)).toBeVisible()
    await navigate(originalRoute)
    await see(body(original.content)).toBeVisible()
    for (const route of [
      `/projects/${crypto.randomUUID()}?chapterId=${original.id}`,
      `/projects/${project.id}?chapterId=${foreign.id}`,
      `/projects/${project.id}?chapterId=${crypto.randomUUID()}`,
      `/projects/${project.id}?chapterId=${original.id}&chapterId=${second.id}`,
      `/projects/${project.id}?chapterId=`,
      `/projects/${project.id}?chapterId=${original.id}&projectId=${other.id}`,
    ]) {
      await navigate(route)
      for (const chapter of [original, second, foreign]) await see(body(chapter.content)).toHaveCount(0)
      expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(route)
      await see(page.locator('main').getByRole('alert')).toContainText(/指定|归属|读取|身份|未找到/u)
    }
    await navigate(originalRoute)
    await see(body(original.content)).toBeVisible()

    // A read that completes after returning to the original project must not replace it.
    let signalRead!: () => void
    const pendingRead = new Promise<void>((resolve) => { signalRead = resolve })
    let releaseRead!: () => void
    const resumeRead = new Promise<void>((resolve) => { releaseRead = resolve })
    let signalReply!: () => void
    const replied = new Promise<void>((resolve) => { signalReply = resolve })
    const unrouteDelayed = await routeRemote('workspace/projectsGet', { id: other.id }, async (route) => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      signalRead()
      await resumeRead
      await route.fulfill({ response })
      signalReply()
    })
    try {
      await navigate(`/projects/${other.id}?chapterId=${foreign.id}`)
      await pendingRead
      await see(body(original.content)).toHaveCount(0)
      await navigate(originalRoute)
      await see(body(original.content)).toBeVisible()
    } finally {
      releaseRead()
    }
    await replied
    await unrouteDelayed()
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await see(body(original.content)).toBeVisible()
    await see(body(foreign.content)).toHaveCount(0)
    expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(originalRoute)
    expect(await api<Chapter[]>('GET', `projects/${project.id}/chapters`)).toEqual(originals)
    expect(await api<Chapter>('GET', `chapters/${foreign.id}`)).toEqual(foreign)
  })

  it('creates a novel with its first chapter and enters writing (novel-creation-journey)', async () => {
    await navigate('#/write/new')
    await see(page.getByRole('heading', { name: '创建小说项目' })).toBeVisible()
    const startNewSeries = page.getByRole('button', { name: '开始新的系列长篇' })
    if (await startNewSeries.isVisible().catch(() => false)) await startNewSeries.click()
    await page.getByRole('textbox', { name: '作品名称' }).fill('浏览器端空白小说')
    await page.getByRole('button', { name: '创建并进入 AI 工作台' }).click()
    await see(page).toHaveURL(/\/projects\/[^/]+$/u)
    await see(page.getByRole('heading', { name: '浏览器端空白小说' })).toBeVisible()
    const directory = page.getByRole('button', { name: '章节目录', exact: true })
    if ((await directory.getAttribute('aria-expanded')) !== 'true') await directory.click()
    await see(page.getByText('第 1 章', { exact: true }).first()).toBeVisible()
    const panel = page.locator('aside[aria-label="章节辅助栏"]')
    await see(panel).toBeVisible()
    await see(panel.getByRole('button', { name: '生成并检查本章正文' })).toBeVisible()
    await see(panel.getByRole('button', { name: '续写本章' })).toBeDisabled()

    const projectId = /\/projects\/([^/?]+)/u.exec(page.url())![1]!
    const project = await api<Project>('GET', `projects/${projectId}`)
    expect(project.title).toBe('浏览器端空白小说')
    const [first] = await api<Chapter[]>('GET', `projects/${projectId}/chapters`)
    expect(first).toMatchObject({ projectId, title: '第 1 章', content: '' })

    const novelNavigation = page.getByLabel('小说创作入口')
    for (const label of ['正文', '大纲', '人物', '设定', '故事圣经'])
      await see(novelNavigation.getByRole('button', { name: label, exact: true })).toBeVisible()
    await novelNavigation.getByRole('button', { name: '正文', exact: true }).click()
    await see(page.getByRole('textbox', { name: '章节正文编辑器' })).toBeVisible()
    await see(panel.getByLabel('AI 本章正文')).toBeVisible()
    await panel.getByLabel('AI 创作要求').fill('承接上章结尾，突出人物动机，保持第三人称。')
    await novelNavigation.getByRole('button', { name: '长篇工具', exact: true }).click()
    for (const label of ['章节记忆', '人物状态', '时间线', '伏笔', '一致性'])
      await see(page.getByRole('button', { name: label, exact: true })).toBeVisible()

    // The chapter list and project read back unchanged after a reload.
    await page.reload()
    await see(page.getByRole('heading', { name: '浏览器端空白小说' })).toBeVisible()
    expect(await api<Chapter[]>('GET', `projects/${projectId}/chapters`)).toEqual([first])
  })

  it('runs the script entry through review, timeline and internal delivery (lm6-full-journey)', async () => {
    // The first flow already opened the sample; it is opened only when absent.
    const projects = await api<Project[]>('GET', 'projects')
    if (!projects.some(project => project.title === '示例短剧：雨夜归来')) {
      await navigate('/')
      await page.getByRole('button', { name: '先看看示例' }).click()
      await see(page.getByRole('heading', { name: '示例短剧：雨夜归来' })).toBeVisible()
    }
    await openProjectCreation(page)
    await page.getByRole('button', { name: '导入已有剧本' }).click()
    await page.getByRole('button', { name: /单季短剧/u }).click()
    await page.getByRole('textbox', { name: '项目名称' }).fill('P2 浏览器剧本入口')
    await page.getByRole('textbox', { name: '已有剧本内容' }).fill('【雨夜门口】\n林晚：这封信不能让任何人看见。')
    await page.getByLabel('我确认拥有此剧本的使用权，或已经取得必要授权。').check()
    await page.getByRole('button', { name: '创建单季短剧' }).click()
    await see(page.getByRole('heading', { name: '剧本审查', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '开始审查', exact: true }).click()
    await see(page.getByText('已完成本地规则审查。它仅依据已保存的剧本和场景，不会冒充模型结论。', { exact: true })).toBeVisible()
    await page.reload()
    await see(page.getByRole('heading', { name: '剧本审查', exact: true })).toBeVisible()
    await see(page.getByText('林晚：这封信不能让任何人看见。', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: '尽意项目首页' }).click()
    await see(page.getByText('示例短剧：雨夜归来')).toBeVisible()
    await page.reload()
    await page.getByRole('link', { name: '雨夜归来' }).click()
    await openProjectTool(page, '试制计划')
    const fixturePilot = page.getByLabel('试制向导')
    await see(fixturePilot.getByRole('checkbox').first()).toBeChecked()
    await fixturePilot.getByRole('button', { name: '建立试制计划' }).click()
    await fixturePilot.getByRole('button', { name: '确认来源并生成首集' }).click()
    await see(fixturePilot).toContainText('当前阶段：采用试制剧本')

    await page.getByRole('link', { name: '制作', exact: true }).click()
    await selectWorkspaceObject(page, '项目', { label: '示例短剧：雨夜归来' })
    await selectWorkspaceObject(page, '改编项目', { label: '雨夜归来·第一季改编方案' })
    await selectWorkspaceObject(page, '分集', { label: '第 1 集：雨夜敲门' })
    await selectWorkspaceObject(page, '剧本', { label: '第 1 集剧本' })
    await selectWorkspaceObject(page, '场景', { label: '场景 1：雨夜门口' })
    await selectWorkspaceObject(page, '分镜', { label: '镜头 1：门缝中的雨夜' })
    await openProductionStage(page, '导演看板')
    await see(page.getByLabel('导演分镜看板')).toBeVisible()
    await see(page.getByLabel('静帧预览：静帧已采用')).toBeVisible()

    // Media playback and timeline render: the editor and its no-media guard.
    await openProductionStage(page, '多轨时间线')
    const timeline = page.getByLabel('多轨时间线编辑器')
    await see(timeline).toBeVisible()
    for (const track of ['视频', '对白', '旁白', '配乐', '音效', '字幕'])
      await see(timeline.getByText(track, { exact: true })).toBeVisible()
    await see(timeline.getByRole('button', { name: '播放', exact: true })).toBeDisabled()
    await timeline.getByRole('button', { name: '加载实际同步预览', exact: true }).click()
    await see(timeline.getByRole('alert')).toContainText('片段缺少明确可读素材')
    await see(timeline.getByRole('button', { name: '播放', exact: true })).toBeDisabled()
    const delivery = timeline.getByLabel('NLE 交付与媒体核验')
    for (const format of ['导出 FCPXML', '导出 OTIO', '导出 EDL', '导出重链接清单'])
      await see(delivery.getByRole('button', { name: format })).toBeVisible()
    await see(delivery).toContainText('NLE 交付不包含 MP4 成片。')

    await page.getByRole('link', { name: '审核交付' }).click()
    await selectWorkspaceObject(page, '项目', { label: '示例短剧：雨夜归来' })
    await selectWorkspaceObject(page, '改编项目', { label: '雨夜归来·第一季改编方案' })
    await selectWorkspaceObject(page, '分集', { label: '第 1 集：雨夜敲门' })
    await page.getByRole('button', { name: '预览与修订', exact: true }).click()
    await page.getByRole('button', { name: '创建离线审片包' }).click()
    await see(page.getByText('已创建离线审片包记录；可以导出单文件审阅页分发给审片人。')).toBeVisible()
    await page.getByRole('combobox', { name: '关联分镜' }).selectOption({ label: '镜头 1：门缝中的雨夜' })
    await page.getByLabel('时间码（秒）').fill('1.5')
    await page.getByLabel('署名（可选）').fill('本地审片人')
    await page.getByLabel('审阅意见').fill('请给反应镜头多留一秒。')
    await page.getByRole('button', { name: '保存审阅意见' }).click()
    await see(page.getByText('请给反应镜头多留一秒。')).toBeVisible()
    await page.getByRole('combobox', { name: '审片决定', exact: true }).selectOption('request_changes')
    await page.getByLabel('决定说明（可选）').fill('补充反应镜头。')
    await page.getByRole('button', { name: '保存审片决定' }).click()
    await see(page.getByText('需要修改 · 本地审片人')).toBeVisible()
    await page.getByText('导入已有修改稿', { exact: true }).click()
    await page.getByLabel('修订草案').fill('【雨夜门口】\n林晚先观察门外的反应，再打开门。')
    await page.getByRole('button', { name: '创建待确认修订预览' }).click()
    await see(page.getByText('已创建待确认修订预览；正式剧本尚未改写。')).toBeVisible()
  })

  it('reports the Host-only flows as unavailable instead of faking them (engine-runtime, media, background-debug)', async () => {
    const runtime = await api<{ capabilities: Record<string, boolean>, mode: string }>('GET', 'runtime')
    expect(runtime.capabilities).toEqual({ desktopHost: false, fileGrant: false, credentials: false, localEngines: false })
    const engines = await api<Array<{ kind: string, runtimeStatus: string }>>('GET', 'agent-engines')
    expect(engines.filter(engine => engine.runtimeStatus === 'running')).toEqual([])
    const theme = await page.evaluate(async () =>
      (await fetch('/api/v2/system/host/window/theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"theme":"dark"}' })).status)
    expect(theme).toBe(503)
  })
})
