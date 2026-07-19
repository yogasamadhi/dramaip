import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { getRepos } from './db'
import { seedP0Fixture } from './e2e-smoke'

type UiTheme = 'light' | 'dark'

interface UiViewport {
  width: number
  height: number
}

interface UiBaselineSpec {
  name: string
  hash: string
  expectedText: string
  readyText: string
  viewport: UiViewport
  theme: UiTheme
  reducedMotion: boolean
}

interface UiFixture {
  projectId: string
  adaptationId: string
  episodeId: string
  sceneId: string
  shotId: string
  emptyProjectId: string
  longTitleProjectId: string
  staleQualityProjectId: string
}

export interface UiAccessibilityIssue {
  role: string
  reason: string
}

export interface UiAccessibilityReport {
  page: string
  nodeCount: number
  issueCount: number
  issues: UiAccessibilityIssue[]
}

export interface UiBaselineArtifact {
  name: string
  file: string
  page: string
  viewport: UiViewport
  theme: UiTheme
  reducedMotion: boolean
  focusPath: string[]
  accessibility: UiAccessibilityReport
}

export interface UiBaselineResult {
  fixture: UiFixture
  artifactDir: string
  artifacts: UiBaselineArtifact[]
  accessibilityIssueCount: number
}

/**
 * 为 UI 回归建立一组完全隔离的本地数据。它不调用网络服务，也不写入用户数据目录。
 */
export async function runDesktopUiBaseline(
  win: BrowserWindow,
  outputDir: string,
): Promise<UiBaselineResult> {
  mkdirSync(outputDir, { recursive: true })
  const fixture = seedUiFixture()
  const specs: UiBaselineSpec[] = [
    {
      name: 'project-list-1320-light',
      hash: '#/',
      expectedText: 'UI 基线项目',
      readyText: '打开工作台',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      reducedMotion: false,
    },
    {
      name: 'workspace-1024-light',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      reducedMotion: false,
    },
    {
      name: 'workspace-1320-dark',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1320, height: 860 },
      theme: 'dark',
      reducedMotion: false,
    },
    {
      name: 'workflow-stale-quality-1320-light',
      hash: `#/projects/${fixture.staleQualityProjectId}?section=overview`,
      expectedText: '源内容已变化，报告已过期，请重新检查',
      readyText: '主流程',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      reducedMotion: false,
    },
    {
      name: 'script-workspace-1600-light',
      hash: `#/adaptations/${fixture.adaptationId}/scripts`,
      expectedText: 'AI 短剧剧本',
      readyText: '批量生成前 10 集',
      viewport: { width: 1600, height: 960 },
      theme: 'light',
      reducedMotion: false,
    },
    {
      name: 'video-failed-task-1320-reduced',
      hash: `#/adaptations/${fixture.adaptationId}/video?episode=${fixture.episodeId}&scene=${fixture.sceneId}&shot=${fixture.shotId}`,
      expectedText: '基线视频任务失败',
      readyText: '提交视频生成任务',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      reducedMotion: true,
    },
  ]

  const artifacts: UiBaselineArtifact[] = []
  for (const spec of specs) {
    win.setSize(spec.viewport.width, spec.viewport.height)
    await setReducedMotion(win, spec.reducedMotion)
    const focusPath = await win.webContents.executeJavaScript(
      `(${prepareRendererForUiBaseline.toString()})(${JSON.stringify({
        hash: spec.hash,
        expectedText: spec.expectedText,
        readyText: spec.readyText,
        theme: spec.theme,
        reducedMotion: spec.reducedMotion,
      })})`,
      true,
    ) as string[]
    const image = await win.capturePage()
    const file = join(outputDir, `${spec.name}.png`)
    writeFileSync(file, image.toPNG())
    const accessibility = await scanAccessibility(win, spec.name)
    artifacts.push({
      name: spec.name,
      file,
      page: spec.hash,
      viewport: spec.viewport,
      theme: spec.theme,
      reducedMotion: spec.reducedMotion,
      focusPath,
      accessibility,
    })
  }

  const result: UiBaselineResult = {
    fixture,
    artifactDir: outputDir,
    artifacts,
    accessibilityIssueCount: artifacts.reduce((total, item) => total + item.accessibility.issueCount, 0),
  }
  writeFileSync(join(outputDir, 'ui-baseline-report.json'), JSON.stringify(result, null, 2))
  return result
}

function seedUiFixture(): UiFixture {
  const repos = getRepos()
  const project = repos.project.createProject(repos.db, {
    title: 'UI 基线项目',
    shortDramaType: '重生逆袭',
    targetAudience: '18-35 岁短剧用户',
    targetEpisodeCount: 24,
    synopsis: '仅用于桌面端视觉、交互与无障碍回归的隔离数据。',
  })
  const p0 = seedP0Fixture(project.id)
  const shot = repos.shot.createShot(repos.db, {
    sceneId: p0.scene.id,
    episodeId: p0.episode.id,
    shotNumber: 1,
    visualDescription: '女主抬头看见开机横幅，镜头快速推近她按下投屏键的手。',
    characterIds: [p0.character.id],
    cameraAngle: '特写',
    cameraMovement: '推镜头',
    emotion: '决绝',
    action: '按下投屏键',
    videoPrompt: '竖屏特写，都市片场，女主按下投屏键，冷色电影光。',
    negativePrompt: '模糊、文字水印、畸形手指',
  })
  repos.videoTask.createVideoTask(repos.db, {
    projectId: project.id,
    episodeId: p0.episode.id,
    sceneId: p0.scene.id,
    shotId: shot.id,
    provider: 'mock',
    model: 'ui-baseline',
    prompt: shot.videoPrompt,
    status: 'failed',
    errorMessage: '基线视频任务失败：用于验证失败状态展示与重试入口。',
    note: 'UI baseline fixture',
  })
  const completedVideoTask = repos.videoTask.createVideoTask(repos.db, {
    projectId: project.id,
    episodeId: p0.episode.id,
    sceneId: p0.scene.id,
    shotId: shot.id,
    provider: 'mock',
    model: 'ui-baseline',
    prompt: shot.videoPrompt,
    status: 'success',
    note: 'UI baseline completed fixture',
  })
  repos.videoResult.createVideoResult(repos.db, {
    taskId: completedVideoTask.id,
    shotId: shot.id,
    resultVideoUrl: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAAAAGlzb20=',
    isBest: true,
    note: '本地基线结果（非真实视频）',
  })
  repos.longTask.createLongTask(repos.db, {
    kind: 'video',
    status: 'failed',
    title: 'UI 基线失败任务',
    projectId: project.id,
    adaptationProjectId: p0.adaptation.id,
    episodeId: p0.episode.id,
    sceneId: p0.scene.id,
    shotId: shot.id,
    errorMessage: '基线任务失败，供任务中心回归使用。',
  })
  repos.adaptationProject.createAdaptationProject(repos.db, {
    sourceProjectId: project.id,
    title: 'UI 基线项目 · 备选改编',
    targetEpisodeCount: 12,
    adaptationStyle: '现实向竖屏短剧',
    audience: '短剧策划团队',
    seasonNumber: 2,
  })
  const emptyProject = repos.project.createProject(repos.db, {
    title: 'UI 空状态项目',
    shortDramaType: '都市情感',
    synopsis: '',
  })
  const longTitleProject = repos.project.createProject(repos.db, {
    title: 'UI 超长标题项目：为了验证项目卡片、工作台标题和窄窗口布局在连续多行中文内容下仍保持可读与可操作',
    shortDramaType: '悬疑反转',
    synopsis: '用于窄窗口和长文本视觉回归的脱敏固定内容。',
  })
  const staleQualityProject = repos.project.createProject(repos.db, {
    title: 'UI 过期报告项目',
    shortDramaType: '悬疑反转',
    synopsis: '用于验证源内容变化后质量报告必须失效的固定数据。',
  })
  const staleP0 = seedP0Fixture(staleQualityProject.id)
  repos.chapter.updateChapterContent(repos.db, staleP0.chapter.id, `${staleP0.chapter.content}\n\n新增正文会让此前质量报告失效。`)
  return {
    projectId: project.id,
    adaptationId: p0.adaptation.id,
    episodeId: p0.episode.id,
    sceneId: p0.scene.id,
    shotId: shot.id,
    emptyProjectId: emptyProject.id,
    longTitleProjectId: longTitleProject.id,
    staleQualityProjectId: staleQualityProject.id,
  }
}

async function setReducedMotion(win: BrowserWindow, reducedMotion: boolean): Promise<void> {
  const debuggerApi = win.webContents.debugger
  const attachedHere = !debuggerApi.isAttached()
  if (attachedHere) debuggerApi.attach('1.3')
  try {
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }],
    })
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
  }
}

async function scanAccessibility(win: BrowserWindow, page: string): Promise<UiAccessibilityReport> {
  const debuggerApi = win.webContents.debugger
  const attachedHere = !debuggerApi.isAttached()
  if (attachedHere) debuggerApi.attach('1.3')
  try {
    const result = await debuggerApi.sendCommand('Accessibility.getFullAXTree') as {
      nodes?: Array<{
        ignored?: boolean
        role?: { value?: string }
        name?: { value?: string }
        properties?: Array<{ name?: string; value?: { value?: boolean | string } }>
      }>
    }
    const nodes = result.nodes ?? []
    const issues = nodes.flatMap((node) => {
      if (node.ignored) return []
      const role = node.role?.value ?? ''
      if (!['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(role)) return []
      const name = String(node.name?.value ?? '').trim()
      const hidden = node.properties?.some((property) => property.name === 'hidden' && property.value?.value === true)
      if (hidden || name) return []
      return [{ role, reason: '可交互控件缺少可访问名称' }]
    })
    return { page, nodeCount: nodes.length, issueCount: issues.length, issues }
  } catch (error) {
    return {
      page,
      nodeCount: 0,
      issueCount: 1,
      issues: [{ role: 'audit', reason: error instanceof Error ? error.message : String(error) }],
    }
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
  }
}

async function prepareRendererForUiBaseline(input: {
  hash: string
  expectedText: string
  readyText: string
  theme: UiTheme
  reducedMotion: boolean
}): Promise<string[]> {
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const waitFor = async (label: string, probe: () => boolean, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (probe()) return
      await sleep(50)
    }
    throw new Error(`UI 基线等待超时：${label}`)
  }
  window.localStorage.setItem('sdns-ui-theme', input.theme)
  document.documentElement.classList.toggle('dark', input.theme === 'dark')
  document.documentElement.dataset.theme = input.theme
  document.documentElement.style.colorScheme = input.theme
  document.documentElement.dataset.uiBaselineReducedMotion = String(input.reducedMotion)
  if (window.location.hash !== input.hash) window.location.hash = input.hash
  await waitFor(`${input.expectedText} / ${input.readyText}`, () => {
    const bodyText = document.body.textContent ?? ''
    return window.location.hash === input.hash && bodyText.includes(input.expectedText) && bodyText.includes(input.readyText)
  })
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
  return Array.from(document.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([aria-disabled="true"])',
  ))
    .filter((element) => element.getClientRects().length > 0)
    .slice(0, 8)
    .map((element) => {
      const text = (element.getAttribute('aria-label') ?? element.textContent ?? element.getAttribute('placeholder') ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      return text || element.tagName.toLowerCase()
    })
}
