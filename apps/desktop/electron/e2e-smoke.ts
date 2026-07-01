import type { BrowserWindow } from 'electron'
import {
  collectProjectPackage,
  importProjectPackage,
  previewProjectPackage,
  serializeProjectPackage,
} from '@sdns/export'
import { getRepos } from './db'

export interface E2eSmokeStep {
  name: string
  ok: boolean
  durationMs: number
  detail?: Record<string, unknown>
  error?: string
}

export interface E2eSmokeResult {
  projectId: string
  importedProjectId: string
  steps: E2eSmokeStep[]
}

interface RendererSmokeResult {
  projectId: string
  steps: E2eSmokeStep[]
}

export async function runDesktopE2eSmoke(win: BrowserWindow): Promise<E2eSmokeResult> {
  const renderer = await win.webContents.executeJavaScript(
    `(${rendererSmokeMain.toString()})()`,
    true,
  ) as RendererSmokeResult
  const projectPackageStep = runProjectPackageRoundTrip(renderer.projectId)
  if (!projectPackageStep.ok) throw new Error(projectPackageStep.error ?? '项目包往返失败')
  return {
    projectId: renderer.projectId,
    importedProjectId: String(projectPackageStep.detail?.importedProjectId ?? ''),
    steps: [...renderer.steps, projectPackageStep],
  }
}

function runProjectPackageRoundTrip(projectId: string): E2eSmokeStep {
  const started = Date.now()
  try {
    const repos = getRepos()
    const pkg = collectProjectPackage(repos, projectId)
    const content = serializeProjectPackage(pkg)
    const preview = previewProjectPackage(content)
    const imported = importProjectPackage(repos, content)
    const importedChapters = repos.chapter.listChapters(repos.db, imported.id)
    if (preview.projectTitle !== pkg.project.title) {
      throw new Error(`项目包预览标题不匹配：${preview.projectTitle}`)
    }
    if (importedChapters.length < 1) {
      throw new Error('项目包导入后缺少章节')
    }
    return {
      name: 'project-package-roundtrip',
      ok: true,
      durationMs: Date.now() - started,
      detail: {
        packageBytes: content.length,
        previewRecords: preview.counts.totalRecords,
        importedProjectId: imported.id,
        importedChapters: importedChapters.length,
      },
    }
  } catch (error) {
    return {
      name: 'project-package-roundtrip',
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function rendererSmokeMain(): Promise<RendererSmokeResult> {
  type Step = {
    name: string
    ok: boolean
    durationMs: number
    detail?: Record<string, unknown>
    error?: string
  }

  const steps: Step[] = []
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const text = () => document.body.textContent ?? ''
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()

  async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try {
      const result = await action()
      steps.push({ name, ok: true, durationMs: Math.round(performance.now() - started) })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      steps.push({ name, ok: false, durationMs: Math.round(performance.now() - started), error: message })
      throw error
    }
  }

  async function waitFor<T>(label: string, probe: () => T | undefined | null | false, timeoutMs = 7000): Promise<T> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const value = probe()
      if (value) return value
      await sleep(50)
    }
    throw new Error(`等待超时：${label}`)
  }

  function buttons(): HTMLElement[] {
    return Array.from(document.querySelectorAll('button,[role="button"]')) as HTMLElement[]
  }

  function buttonByText(label: string): HTMLElement | undefined {
    return buttons().find((button) => normalize(button.textContent).includes(label))
  }

  function clickButton(label: string): void {
    const button = buttonByText(label)
    if (!button) throw new Error(`未找到按钮：${label}`)
    button.click()
  }

  function inputByPlaceholder(fragment: string): HTMLInputElement {
    const input = Array.from(document.querySelectorAll('input')).find((item) =>
      (item.getAttribute('placeholder') ?? '').includes(fragment),
    ) as HTMLInputElement | undefined
    if (!input) throw new Error(`未找到输入框：${fragment}`)
    return input
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function hasInputValue(value: string): boolean {
    return Array.from(document.querySelectorAll('input')).some((input) => input.value === value)
  }

  const title = `E2E 项目 ${Date.now()}`
  const modelName = `E2E Mock Model ${Date.now()}`
  let projectId = ''

  await step('open-create-project-page', async () => {
    window.location.hash = '#/projects/new'
    await waitFor('创建项目页面', () => text().includes('创建项目'))
  })

  await step('create-project', async () => {
    setInputValue(inputByPlaceholder('重生之千金归来'), title)
    clickButton('创建项目')
    await waitFor('项目工作台路由', () =>
      window.location.hash.startsWith('#/projects/') && !window.location.hash.startsWith('#/projects/new'),
    )
    projectId = window.location.hash.match(/^#\/projects\/([^/?#]+)/)?.[1] ?? ''
    if (!projectId) throw new Error(`未从 hash 获取项目 ID：${window.location.hash}`)
    await waitFor('工作台标题', () => text().includes(title))
  })

  await step('create-chapter', async () => {
    await waitFor('新建章节按钮', () => buttonByText('新建章节'))
    clickButton('新建章节')
    await waitFor('章节标题输入框', () => hasInputValue('第 1 章'))
  })

  await step('open-model-settings-page', async () => {
    window.location.hash = '#/settings/models'
    await waitFor('模型设置页面', () => text().includes('模型设置') && text().includes('新增模型配置'))
  })

  await step('create-model-config', async () => {
    setInputValue(inputByPlaceholder('默认 GPT-4o'), modelName)
    setInputValue(inputByPlaceholder('openai / deepseek'), 'mock')
    setInputValue(inputByPlaceholder('https://api.openai.com/v1'), 'https://example.invalid/v1')
    setInputValue(inputByPlaceholder('gpt-4o-mini'), 'e2e-mock-model')
    clickButton('添加')
    await waitFor('模型配置列表', () => text().includes(modelName))
  })

  return { projectId, steps }
}
