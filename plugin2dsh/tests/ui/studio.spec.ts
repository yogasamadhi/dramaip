import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
const state = JSON.parse(readFileSync(process.env.DRAMAIP_TEST_STATE_FILE!, 'utf8')) as {
  url: string
  projectId: string
}
async function enter(page: Page) {
  await page.addLocatorHandler(
    page.getByRole('dialog', { name: 'Preview Notice', exact: true }),
    async (notice) => {
      await notice.getByRole('button', { name: 'Continue', exact: true }).click()
    },
  )
  await page.addLocatorHandler(
    page.getByRole('dialog', { name: 'Get started', exact: true }),
    async (notice) => {
      await notice.getByRole('button', { name: 'Close', exact: true }).click()
    },
  )
  await page.goto(state.url)
  await page.getByText('尽意 · 故事创作', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '把故事写下去。' })).toBeVisible()
}
async function rpc(page: Page, request: unknown) {
  return page.evaluate(async (request) => {
    const rpcId = crypto.randomUUID()
    const response = await fetch('api/dramaip/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method: 'dramaip/dispatch',
        payload: { args: { request } },
      }),
    })
    const body = await response.json()
    if (!body.result.ok) throw new Error(JSON.stringify(body.result.error))
    return body.result.value
  }, request)
}
test('real DSH Client: authoring, proposal diff/adoption, import/export and reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await enter(page)
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).click()
  await page.getByRole('textbox', { name: '新项目名称', exact: true }).fill('UI 海边的信')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByRole('textbox', { name: '作者意图', exact: true }).fill('保留人物的自主选择')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.getByRole('textbox', { name: '新章节标题', exact: true }).fill('第一章 海风')
  await page.getByRole('button', { name: '＋ 新章节', exact: true }).click()
  await page
    .getByRole('textbox', { name: '正文', exact: true })
    .fill('# 海风\n\n林夏走到海边。\n“你好。”')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.getByRole('button', { name: '预览 Markdown', exact: true }).click()
  await expect(page.locator('.dip-preview h1')).toHaveText('海风')
  await page.getByRole('button', { name: '编辑 Markdown', exact: true }).click()
  await page.getByRole('button', { name: '＋ 新设定', exact: true }).click()
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('林夏')
  await page.getByRole('textbox', { name: '正文', exact: true }).fill('相信自己的判断')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  const list = await rpc(page, { op: 'list' })
  let p = (
    await rpc(page, {
      op: 'get',
      projectId: list.projects.find((p: { title: string }) => p.title === 'UI 海边的信').id,
    })
  ).project
  await rpc(page, {
    op: 'propose',
    projectId: p.id,
    chapterId: p.chapters[0].id,
    baseRevision: p.chapters[0].revision,
    baseContentRevision: p.contentRevision,
    text: '林夏停下脚步。\n“让我自己决定。”',
    explanation: '强化人物自主选择',
  })
  await page.getByRole('button', { name: /^修改提案/ }).click()
  await expect(page.getByText('强化人物自主选择')).toBeVisible()
  await expect(page.getByLabel('逐行差异')).toContainText('让我自己决定')
  await page.getByRole('button', { name: '采用提案', exact: true }).click()
  await expect(page.getByText('已采用', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出稿件', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('UI 海边的信.md')
  const content = readFileSync((await file.path())!, 'utf8')
  expect(content).toContain('让我自己决定')
  expect(content).not.toContain('保留人物的自主选择')
  p = (await rpc(page, { op: 'get', projectId: p.id })).project
  await page
    .locator('.dip-toolbar input[type=file]')
    .first()
    .setInputFiles({
      name: 'project.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'dramaip-dsh-project-v1',
          exportedAt: new Date().toISOString(),
          project: p,
        }),
      ),
    })
  await expect(page.getByRole('textbox', { name: '作者意图', exact: true })).toHaveValue(
    '保留人物的自主选择',
  )
  await page.reload()
  await page.getByText('尽意 · 故事创作', { exact: true }).click()
  const projects = page.locator('.dip-nav > button').filter({ hasText: 'UI 海边的信' })
  await expect(projects).toHaveCount(2)
  await projects.first().click()
  await page.getByRole('button', { name: /01.*第一章 海风/ }).click()
  await expect(page.getByRole('textbox', { name: '正文', exact: true })).toHaveValue(
    '林夏停下脚步。\n“让我自己决定。”',
  )
  await page.screenshot({ path: 'build/studio-light.png', fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: 'build/studio-dark.png', fullPage: true })
  expect(errors).toEqual([])
})
test('dirty draft survives external edits, network loss, and stale proposal cannot be adopted', async ({
  page,
}) => {
  await enter(page)
  await page
    .getByRole('button', { name: /临时验证作品/ })
    .first()
    .click()
  await page.getByRole('button', { name: /01.*第一章/ }).click()
  const area = page.getByRole('textbox', { name: '正文', exact: true })
  await area.fill('未保存的作者草稿')
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请先保存或放弃')
  let p = (await rpc(page, { op: 'get', projectId: state.projectId })).project
  await rpc(page, {
    op: 'saveChapter',
    projectId: p.id,
    expectedRevision: p.stateRevision,
    chapterId: p.chapters[0].id,
    title: '第一章',
    text: '另一窗口的新正文',
  })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(area).toHaveValue('未保存的作者草稿')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '服务端内容已变化' })).toBeVisible()
  await expect(area).toHaveValue('未保存的作者草稿')
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('连接中断 · 草稿已保留')).toBeVisible()
  await page.context().setOffline(false)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(area).toHaveValue('未保存的作者草稿')
  await page.getByRole('button', { name: '确认保留草稿并使用最新基准', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  p = (await rpc(page, { op: 'get', projectId: p.id })).project
  await rpc(page, {
    op: 'propose',
    projectId: p.id,
    chapterId: p.chapters[0].id,
    baseRevision: p.chapters[0].revision,
    baseContentRevision: p.contentRevision,
    text: '过期的建议正文',
    explanation: '过期验证',
  })
  p = (await rpc(page, { op: 'get', projectId: p.id })).project
  await rpc(page, {
    op: 'saveSetting',
    projectId: p.id,
    expectedRevision: p.stateRevision,
    kind: 'world',
    title: '时间线',
    text: '背景已经变化',
    archived: false,
  })
  await page.getByRole('button', { name: /^修改提案/ }).click()
  await expect(page.getByText('已过期 · 请重新生成', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采用提案', exact: true })).toBeDisabled()
})
test('Markdown preview is sanitized and does not load remote images', async ({ page }) => {
  await enter(page)
  await page
    .getByRole('button', { name: /临时验证作品/ })
    .first()
    .click()
  await page.getByRole('button', { name: /01.*第一章/ }).click()
  await page
    .getByRole('textbox', { name: '正文', exact: true })
    .fill(
      '<script>window.DRAMAIP_XSS=1</script><img src="https://example.invalid/image" onerror="window.DRAMAIP_XSS=1">\n[bad](javascript:alert(1))\n# 安全预览',
    )
  await page.getByRole('button', { name: '预览 Markdown', exact: true }).click()
  await expect(page.locator('.dip-preview script,.dip-preview img')).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'DRAMAIP_XSS'))).toBeUndefined()
  expect(await page.locator('.dip-preview').innerHTML()).not.toContain('javascript:')
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click()
})

test('Markdown import, chapter order, history restore and project archive round trip', async ({
  page,
}) => {
  await enter(page)
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).click()
  await page.getByRole('textbox', { name: '新项目名称', exact: true }).fill('UI 版本验证')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('UI 版本验证')
  const original = '# 海风\n\n这里是导入的第一稿。'
  await page
    .locator('.dip-nav input[type=file]')
    .setInputFiles({ name: '海风.md', mimeType: 'text/markdown', buffer: Buffer.from(original) })
  await page.getByRole('button', { name: /01.*海风/ }).click()
  await expect(page.getByRole('textbox', { name: '正文', exact: true })).toHaveValue(original)
  await page.getByRole('textbox', { name: '正文', exact: true }).fill('这是手工修改后的第二稿。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  const list = await rpc(page, { op: 'list' })
  let p = (
    await rpc(page, {
      op: 'get',
      projectId: list.projects.find((p: { title: string }) => p.title === 'UI 版本验证').id,
    })
  ).project
  expect(p.history[0].source).toBe('import')
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await page.getByRole('combobox', { name: '历史版本', exact: true }).selectOption(p.history[0].id)
  await expect(page.getByLabel('逐行差异')).toContainText('这里是导入的第一稿')
  await page.getByRole('button', { name: '恢复为新版本', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  p = (await rpc(page, { op: 'get', projectId: p.id })).project
  expect(p.chapters[0].revision).toBe(3)
  expect(p.chapters[0].text).toBe(original)
  await page.getByRole('textbox', { name: '新章节标题', exact: true }).fill('第二章')
  await page.getByRole('button', { name: '＋ 新章节', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('第二章')
  await page.getByRole('button', { name: '上移章节', exact: true }).click()
  await expect(page.getByRole('button', { name: /01.*第二章/ })).toBeVisible()
  await page.getByRole('button', { name: '作品与作者意图', exact: true }).click()
  await page.getByRole('checkbox', { name: '归档项目', exact: true }).check()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await expect(page.getByRole('button', { name: '＋ 新章节', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '显示归档', exact: true }).check()
  await expect(
    page.locator('.dip-nav > button').filter({ hasText: 'UI 版本验证 · 已归档' }),
  ).toBeVisible()
  await page.getByRole('checkbox', { name: '归档项目', exact: true }).uncheck()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await expect(page.getByRole('textbox', { name: '新章节标题', exact: true })).toBeEnabled()
})
