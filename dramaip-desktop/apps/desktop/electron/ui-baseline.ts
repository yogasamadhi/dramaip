import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { getRepos } from './db'
import { seedP0Fixture } from './e2e-smoke'
import { PRODUCTION_OUTCOME_BASELINE, type ProductionOutcomeBaseline } from './production-outcome-baseline'

type UiTheme = 'light' | 'dark'
type UiThemePreference = UiTheme | 'system'
type UiDensity = 'comfortable' | 'compact'

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
  themePreference: UiThemePreference
  density: UiDensity
  reducedMotion: boolean
  openAiCommandPalette?: boolean
  openAiContextPreview?: boolean
  openTextDiffPreview?: boolean
  openVideoComparison?: boolean
  openHailuoProviderForm?: boolean
  openWanProviderForm?: boolean
}

interface UiFixture {
  projectId: string
  adaptationId: string
  episodeId: string
  sceneId: string
  shotId: string
  emptyProjectId: string
  longTitleProjectId: string
  longChapterProjectId: string
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
  themePreference: UiThemePreference
  density: UiDensity
  reducedMotion: boolean
  focusPath: string[]
  accessibility: UiAccessibilityReport
}

export interface UiBaselineResult {
  fixture: UiFixture
  artifactDir: string
  artifacts: UiBaselineArtifact[]
  accessibilityIssueCount: number
  outcomeBaseline: ProductionOutcomeBaseline
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
      readyText: '继续创作',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'create-project-1024-light',
      hash: '#/projects/new',
      expectedText: '创建项目',
      readyText: '带着灵感创建',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'create-adaptation-from-existing-novel-1024-light',
      hash: `#/adaptations/new?source=${fixture.projectId}`,
      expectedText: '创建 AI 短剧改编项目',
      readyText: '源小说项目',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'workspace-1024-light',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'workspace-1024-dark-reduced',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1024, height: 760 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: true,
    },
    {
      name: 'workspace-1179-light',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1179, height: 820 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'workspace-1179-dark',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1179, height: 820 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'workspace-1320-light',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'workspace-1320-dark',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1320, height: 860 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'ai-command-palette-1320-light',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
      openAiCommandPalette: true,
    },
    {
      name: 'ai-context-summary-1320-light',
      hash: `#/projects/${fixture.projectId}`,
      expectedText: 'UI 基线项目',
      readyText: '新建章节',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
      openAiCommandPalette: true,
      openAiContextPreview: true,
    },
    {
      name: 'ai-segmented-diff-1320-light',
      hash: `#/projects/${fixture.projectId}?section=creative-diagnosis`,
      expectedText: '段落级修稿预览',
      readyText: '修稿任务单',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
      openTextDiffPreview: true,
    },
    {
      name: 'ai-segmented-diff-1320-dark',
      hash: `#/projects/${fixture.projectId}?section=creative-diagnosis`,
      expectedText: '段落级修稿预览',
      readyText: '修稿任务单',
      viewport: { width: 1320, height: 860 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
      openTextDiffPreview: true,
    },
    {
      name: 'ai-segmented-diff-1320-reduced',
      hash: `#/projects/${fixture.projectId}?section=creative-diagnosis`,
      expectedText: '段落级修稿预览',
      readyText: '修稿任务单',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: true,
      openTextDiffPreview: true,
    },
    {
      name: 'chapter-tree-1060-light',
      hash: `#/projects/${fixture.longChapterProjectId}?section=chapters`,
      expectedText: 'UI 长篇章节树项目',
      readyText: '第一卷 · 导航验证',
      viewport: { width: 1060, height: 820 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'chapter-tree-1179-dark',
      hash: `#/projects/${fixture.longChapterProjectId}?section=chapters`,
      expectedText: 'UI 长篇章节树项目',
      readyText: '第一卷 · 导航验证',
      viewport: { width: 1179, height: 820 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'chapter-tree-1320-light-reduced',
      hash: `#/projects/${fixture.longChapterProjectId}?section=chapters`,
      expectedText: 'UI 长篇章节树项目',
      readyText: '第一卷 · 导航验证',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: true,
    },
    {
      name: 'workflow-stale-quality-1320-light',
      hash: `#/projects/${fixture.staleQualityProjectId}?section=overview`,
      expectedText: '源内容已变化，报告已过期，请重新检查',
      readyText: '主流程',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'production-planning-1024-light',
      hash: `#/adaptations/${fixture.adaptationId}?section=episodes`,
      expectedText: '分集大纲',
      readyText: '改编工作台',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'production-planning-1320-dark',
      hash: `#/adaptations/${fixture.adaptationId}?section=episodes`,
      expectedText: '分集大纲',
      readyText: '改编工作台',
      viewport: { width: 1320, height: 860 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'script-workspace-1600-light',
      hash: `#/adaptations/${fixture.adaptationId}/scripts`,
      expectedText: '剧本',
      readyText: '批量生成前 10 集',
      viewport: { width: 1600, height: 960 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'script-structure-1024-light',
      hash: `#/adaptations/${fixture.adaptationId}/scripts`,
      expectedText: '场景大纲',
      readyText: '批量生成前 10 集',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'script-structure-1320-dark',
      hash: `#/adaptations/${fixture.adaptationId}/scripts`,
      expectedText: '场景大纲',
      readyText: '批量生成前 10 集',
      viewport: { width: 1320, height: 860 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'storyboard-1024-light',
      hash: `#/adaptations/${fixture.adaptationId}/shots?episode=${fixture.episodeId}&scene=${fixture.sceneId}&shot=${fixture.shotId}`,
      expectedText: 'Storyboard',
      readyText: '批量拆分镜头',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'storyboard-1320-dark',
      hash: `#/adaptations/${fixture.adaptationId}/shots?episode=${fixture.episodeId}&scene=${fixture.sceneId}&shot=${fixture.shotId}`,
      expectedText: 'Storyboard',
      readyText: '批量拆分镜头',
      viewport: { width: 1320, height: 860 },
      theme: 'dark',
      themePreference: 'dark',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'video-production-console-1024-light',
      hash: `#/adaptations/${fixture.adaptationId}/video?episode=${fixture.episodeId}&scene=${fixture.sceneId}&shot=${fixture.shotId}`,
      expectedText: '提交前预估',
      readyText: '批量排队本场景',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
      openVideoComparison: true,
    },
    {
      name: 'video-failed-task-1320-reduced',
      hash: `#/adaptations/${fixture.adaptationId}/video?episode=${fixture.episodeId}&scene=${fixture.sceneId}&shot=${fixture.shotId}`,
      expectedText: '基线视频任务失败',
      readyText: '提交视频生成任务',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'compact',
      reducedMotion: true,
    },
    {
      name: 'hailuo-settings-1024-light',
      hash: '#/settings/video',
      expectedText: '视频生成设置',
      readyText: '新增视频 Provider',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
      openHailuoProviderForm: true,
    },
    {
      name: 'wan-settings-1024-light',
      hash: '#/settings/video',
      expectedText: '视频生成设置',
      readyText: '新增视频 Provider',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
      openWanProviderForm: true,
    },
    {
      name: 'task-monitor-recovery-1320-light',
      hash: '#/settings/tasks',
      expectedText: 'UI 基线失败任务',
      readyText: '最近任务',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'appearance-system-1320-light',
      hash: '#/settings/appearance',
      expectedText: '外观与编辑偏好',
      readyText: '界面主题',
      viewport: { width: 1320, height: 860 },
      theme: 'light',
      themePreference: 'system',
      density: 'comfortable',
      reducedMotion: false,
    },
    {
      name: 'encrypted-snapshots-1024-light',
      hash: '#/settings/data',
      expectedText: '端到端加密云端快照',
      readyText: '备份列表',
      viewport: { width: 1024, height: 760 },
      theme: 'light',
      themePreference: 'light',
      density: 'comfortable',
      reducedMotion: false,
    },
  ]

  const artifacts: UiBaselineArtifact[] = []
  for (const spec of specs) {
    win.setSize(spec.viewport.width, spec.viewport.height)
    await setMediaPreferences(win, spec.reducedMotion, spec.theme)
    const focusPath = await win.webContents.executeJavaScript(
      `(${prepareRendererForUiBaseline.toString()})(${JSON.stringify({
        hash: spec.hash,
        expectedText: spec.expectedText,
        readyText: spec.readyText,
        theme: spec.theme,
        themePreference: spec.themePreference,
        density: spec.density,
        reducedMotion: spec.reducedMotion,
        openAiCommandPalette: spec.openAiCommandPalette,
        openAiContextPreview: spec.openAiContextPreview,
        openTextDiffPreview: spec.openTextDiffPreview,
        openVideoComparison: spec.openVideoComparison,
        openHailuoProviderForm: spec.openHailuoProviderForm,
        openWanProviderForm: spec.openWanProviderForm,
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
      themePreference: spec.themePreference,
      density: spec.density,
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
    outcomeBaseline: PRODUCTION_OUTCOME_BASELINE,
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
  const diffTask = repos.creative.createRevisionTask(repos.db, {
    projectId: project.id,
    targetKind: 'chapter',
    targetId: p0.chapter.id,
    title: '段落级修稿预览',
    description: '以段落为单位审阅 AI 对雨夜对峙和结尾钩子的修改。',
    suggestedAction: '保留开场事实，强化第二段动作，并新增段尾倒计时。',
  })
  repos.revisionAdoption.saveRevisionTaskPreview(repos.db, diffTask.id, {
    targetKind: 'chapter',
    targetId: p0.chapter.id,
    taskType: 'rewrite_chapter',
    currentContent: p0.chapter.content,
    nextContent: `${p0.chapter.content}\n\n大屏的倒计时亮起，她终于抬头说：“署名是谁的，马上就知道。”`,
    projectId: project.id,
    title: diffTask.title,
  })
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
  repos.videoProviderConfig.createVideoProviderConfig(repos.db, {
    name: 'UI 基线 Mock Video',
    kind: 'mock',
    model: 'mock-v1',
    defaultParams: '{"seconds":4,"estimatedCost":0,"currency":"CNY"}',
    isDefault: true,
  })
  repos.videoProviderConfig.createVideoProviderConfig(repos.db, {
    name: 'UI 基线 MiniMax Hailuo（默认关闭）',
    kind: 'hailuo',
    baseUrl: 'https://api.minimaxi.com',
    model: 'MiniMax-Hailuo-2.3',
    defaultParams: '{"duration":6,"resolution":"768P","prompt_optimizer":true,"featureEnabled":false}',
    isDefault: false,
  })
  repos.videoProviderConfig.createVideoProviderConfig(repos.db, {
    name: 'UI 基线阿里云百炼 Wan（默认关闭）',
    kind: 'wan',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'wan2.7-t2v-2026-06-12',
    defaultParams: '{"duration":10,"resolution":"720P","ratio":"9:16","prompt_extend":true,"watermark":true,"imageModel":"wan2.7-i2v-2026-04-25","featureEnabled":false}',
    isDefault: false,
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
  repos.videoResult.createVideoResult(repos.db, {
    taskId: completedVideoTask.id,
    shotId: shot.id,
    resultVideoUrl: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAAAAGlzb20BAAAA',
    isBest: false,
    note: '本地基线候选结果（非真实视频）',
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
  const longChapterProject = repos.project.createProject(repos.db, {
    title: 'UI 长篇章节树项目',
    shortDramaType: '长篇都市反击',
    synopsis: '用于验证 300 章章节树、虚拟滚动和编辑器可用宽度的固定数据。',
  })
  for (let index = 0; index < 300; index++) {
    repos.chapter.createChapter(repos.db, {
      projectId: longChapterProject.id,
      title: `第 ${index + 1} 章 · 长篇章节树验证`,
      content: index === 0 ? '这是用于视觉回归的长篇第一章正文。' : '',
    })
  }
  const longVolume = repos.storyArc.createStoryArc(repos.db, {
    projectId: longChapterProject.id,
    kind: 'volume',
    title: '第一卷 · 导航验证',
  })
  repos.storyArc.createStoryArc(repos.db, {
    projectId: longChapterProject.id,
    parentId: longVolume.id,
    kind: 'unit',
    title: '开篇反击单元',
    chapterStart: 1,
    chapterEnd: 100,
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
    longChapterProjectId: longChapterProject.id,
    staleQualityProjectId: staleQualityProject.id,
  }
}

async function setMediaPreferences(win: BrowserWindow, reducedMotion: boolean, theme: UiTheme): Promise<void> {
  const debuggerApi = win.webContents.debugger
  const attachedHere = !debuggerApi.isAttached()
  if (attachedHere) debuggerApi.attach('1.3')
  try {
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
        { name: 'prefers-color-scheme', value: theme },
      ],
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
  themePreference: UiThemePreference
  density: UiDensity
  reducedMotion: boolean
  openAiCommandPalette?: boolean
  openAiContextPreview?: boolean
  openTextDiffPreview?: boolean
  openVideoComparison?: boolean
  openHailuoProviderForm?: boolean
  openWanProviderForm?: boolean
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
  window.localStorage.setItem('sdns-ui-theme-preference', input.themePreference)
  window.localStorage.setItem('sdns-ui-theme', input.themePreference)
  window.localStorage.setItem('sdns-ui-density', input.density)
  window.dispatchEvent(new StorageEvent('storage', { key: 'sdns-ui-theme-preference', newValue: input.themePreference }))
  window.dispatchEvent(new StorageEvent('storage', { key: 'sdns-ui-density', newValue: input.density }))
  document.documentElement.classList.toggle('dark', input.theme === 'dark')
  document.documentElement.dataset.theme = input.theme
  document.documentElement.dataset.themePreference = input.themePreference
  document.documentElement.dataset.density = input.density
  document.documentElement.style.colorScheme = input.theme
  document.documentElement.dataset.uiBaselineReducedMotion = String(input.reducedMotion)
  if (window.location.hash !== input.hash) window.location.hash = input.hash
  await waitFor(`${input.expectedText} / ${input.readyText}`, () => {
    const bodyText = document.body.textContent ?? ''
    return window.location.hash === input.hash && bodyText.includes(input.expectedText) && bodyText.includes(input.readyText)
  })
  if (input.openAiCommandPalette) {
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => (button.textContent ?? '').includes('AI 命令'))
    if (!trigger) throw new Error('UI 基线未找到 AI 命令入口')
    trigger.click()
    await waitFor('AI 命令面板', () => (document.body.textContent ?? '').includes('AI 命令面板'))
  }
  if (input.openAiContextPreview) {
    const commandDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => (dialog.textContent ?? '').includes('AI 命令面板'))
    const commandButton = Array.from(commandDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => (button.textContent ?? '').includes('续写章节'))
    if (!commandButton) throw new Error('UI 基线未找到续写章节命令')
    commandButton.click()
    await waitFor('AI 紧凑上下文摘要', () => {
      const bodyText = document.body.textContent ?? ''
      return bodyText.includes('AI 执行前确认') && bodyText.includes('查看详情')
    })
  }
  if (input.openTextDiffPreview) {
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => (button.textContent ?? '').includes('查看预览'))
    if (!trigger) throw new Error('UI 基线未找到修稿预览入口')
    trigger.click()
    await waitFor('AI 变更预览', () => {
      const bodyText = document.body.textContent ?? ''
      return bodyText.includes('AI 变更预览') && bodyText.includes('采用已选内容并保存')
    })
  }
  if (input.openVideoComparison) {
    const compareButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => (button.textContent ?? '').includes('加入对比'))
    await waitFor('视频结果对比入口', () => compareButtons().length >= 2)
    compareButtons().slice(0, 2).forEach((button) => button.click())
    await waitFor('同步视频结果对比', () => document.querySelectorAll('[data-video-comparison] video').length === 2)
    document.querySelector('[data-video-comparison]')?.scrollIntoView({ block: 'center' })
  } else if (input.hash.includes('/video?')) {
    Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => (button.textContent ?? '').includes('已加入对比'))
      .forEach((button) => button.click())
    await waitFor('清除视频对比选择', () => !document.querySelector('[data-video-comparison]'))
    document.querySelector('[data-video-preflight]')?.scrollIntoView({ block: 'start' })
  }
  if (input.openHailuoProviderForm || input.openWanProviderForm) {
    const providerLabel = input.openWanProviderForm ? '阿里云百炼 Wan' : '海螺 Hailuo'
    const channelLabel = input.openWanProviderForm ? '启用 阿里云百炼 Wan 生产渠道' : '启用 MiniMax Hailuo 生产渠道'
    const providerTrigger = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]'))
      .find((element) => element.getAttribute('aria-label') === 'Provider 种类')
    if (!providerTrigger) throw new Error('UI 基线未找到视频 Provider 种类选择器')
    providerTrigger.click()
    await waitFor(`${providerLabel} 选项`, () => (document.body.textContent ?? '').includes(providerLabel))
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .find((element) => (element.textContent ?? '').includes(providerLabel))
    if (!option) throw new Error(`UI 基线未找到 ${providerLabel} 选项`)
    option.click()
    await waitFor(`${providerLabel} 生产渠道开关`, () => (document.body.textContent ?? '').includes(channelLabel))
    await waitFor('Provider 下拉菜单关闭', () => !document.querySelector('[role="listbox"]'))
    const featureToggle = Array.from(document.querySelectorAll<HTMLElement>('label'))
      .find((element) => (element.textContent ?? '').includes(channelLabel))
    featureToggle?.scrollIntoView({ block: 'center' })
    await sleep(120)
  }
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
