import type { BrowserWindow } from 'electron'
import type {
  AdaptationProject,
  Chapter,
  Character,
  CreativeCaseStudy,
  Episode,
  Project,
  QualityGateReport,
  RevisionTask,
  Scene,
  Script,
} from '@sdns/core'
import {
  collectProjectPackage,
  exportNovelSubmissionJson,
  exportNovelSubmissionMarkdown,
  importProjectPackage,
  previewProjectPackage,
  serializeProjectPackage,
} from '@sdns/export'
import { schema } from '@sdns/db'
import { eq, sql } from 'drizzle-orm'
import { buildAgentCommandPlan } from '../renderer/src/lib/agentCommandPlanner'
import { buildProjectWorkflowStages } from '../renderer/src/lib/projectWorkflowGuide'
import { getRepos } from './db'
import { deleteModelConfigWithSecret, migrateLegacySecretsToKeychain } from './secrets'

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
  modelConfigId: string
  steps: E2eSmokeStep[]
}

export async function runDesktopE2eSmoke(win: BrowserWindow): Promise<E2eSmokeResult> {
  const renderer = await win.webContents.executeJavaScript(
    `(${rendererSmokeMain.toString()})()`,
    true,
  ) as RendererSmokeResult
  const cloudAuthStep = await verifyCloudAuthRendererBoundary(win)
  const keychainStep = await verifyKeychainModelConfig(renderer.modelConfigId)
  const p0 = runP0ProductionPathSmoke(renderer.projectId)
  const draftPersistenceStep = await verifyDraftPersistenceRenderer(win, p0.fixture)
  const projectPackageStep = runProjectPackageRoundTrip(renderer.projectId)
  if (!projectPackageStep.ok) throw new Error(projectPackageStep.error ?? '项目包往返失败')
  return {
    projectId: renderer.projectId,
    importedProjectId: String(projectPackageStep.detail?.importedProjectId ?? ''),
    steps: [...renderer.steps, keychainStep, cloudAuthStep, ...p0.steps, draftPersistenceStep, projectPackageStep],
  }
}

async function verifyCloudAuthRendererBoundary(win: BrowserWindow): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const status = await win.webContents.executeJavaScript(`window.api.cloudAuth.status()`, true) as Record<string, unknown>
    const keys = Object.keys(status)
    if (!keys.includes('enabled') || !keys.includes('configured') || !keys.includes('signedIn')) {
      throw new Error('renderer 未获得受限云端状态契约')
    }
    if (keys.some((key) => /token|verifier|code|secret/i.test(key))) {
      throw new Error('renderer 云端状态泄露了敏感字段')
    }
    const cloudAIKeys = await win.webContents.executeJavaScript(`Object.keys(window.api.cloudAI ?? {})`, true) as string[]
    if (!cloudAIKeys.includes('models') || !cloudAIKeys.includes('onBalance')) {
      throw new Error('renderer 未获得受限云端 AI 状态契约')
    }
    if (cloudAIKeys.some((key) => /chat|token|request|credential|secret/i.test(key))) {
      throw new Error('renderer 暴露了 token-bearing 云端 AI 操作')
    }
    return { name: 'cloud-auth-renderer-boundary', ok: true, durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      name: 'cloud-auth-renderer-boundary',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function verifyKeychainModelConfig(modelConfigId: string): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const repos = getRepos()
    const stored = repos.db
      .select({ apiKey: schema.modelConfigs.apiKey })
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, modelConfigId))
      .get()
    if (!stored?.apiKey.startsWith('keychain:v1:')) {
      throw new Error('模型配置未保存为 Keychain 引用')
    }
    await deleteModelConfigWithSecret(repos, modelConfigId)

    // 旧库 fixture：直接写入一个历史裸值，随后只通过主进程迁移入口处理。
    const legacy = repos.modelConfig.createModelConfig(repos.db, {
      name: 'Legacy Keychain Fixture',
      provider: 'mock',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'legacy-e2e-not-a-real-key',
      model: 'legacy-fixture',
    })
    const migration = await migrateLegacySecretsToKeychain(repos)
    const migrated = repos.db
      .select({ apiKey: schema.modelConfigs.apiKey })
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, legacy.id))
      .get()
    const auditRows = repos.db.all(sql`
      SELECT status, credential_ref AS credentialRef
      FROM credential_migration_audit
      WHERE area = 'model_config' AND record_id = ${legacy.id}
    `) as Array<{ status?: string; credentialRef?: string }>
    if (
      migration.migrated < 1 ||
      !migrated?.apiKey.startsWith('keychain:v1:') ||
      auditRows[0]?.status !== 'migrated' ||
      !auditRows[0]?.credentialRef?.startsWith('keychain:v1:')
    ) {
      throw new Error('旧 SQLite 凭据未完成可审计 Keychain 迁移')
    }
    await deleteModelConfigWithSecret(repos, legacy.id)
    return { name: 'keychain-reference-migration-and-renderer-mask', ok: true, durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      name: 'keychain-reference-migration-and-renderer-mask',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export interface P0Fixture {
  project: Project
  chapter: Chapter
  chapters: Chapter[]
  character: Character
  qualityGate: QualityGateReport
  adaptation: AdaptationProject
  episode: Episode
  script: Script
  scene: Scene
  caseStudy?: CreativeCaseStudy
  revisionTask?: RevisionTask
}

function smokeStep<T>(name: string, action: () => T): { step: E2eSmokeStep; value?: T } {
  const started = Date.now()
  try {
    const value = action()
    return {
      value,
      step: {
        name,
        ok: true,
        durationMs: Date.now() - started,
      },
    }
  } catch (error) {
    return {
      step: {
        name,
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function pushStep<T>(steps: E2eSmokeStep[], result: { step: E2eSmokeStep; value?: T }): T {
  steps.push(result.step)
  if (!result.step.ok) throw new Error(result.step.error ?? `${result.step.name} failed`)
  return result.value as T
}

function runP0ProductionPathSmoke(projectId: string): { fixture: P0Fixture; steps: E2eSmokeStep[] } {
  const steps: E2eSmokeStep[] = []
  const fixture = pushStep(steps, smokeStep('p0-fixture-project', () => seedP0Fixture(projectId)))
  pushStep(steps, smokeStep('p0-main-workflow-guide', () => verifyMainWorkflowGuide(fixture)))
  pushStep(steps, smokeStep('p0-agent-command-console-plan', () => verifyAgentCommandPlans(fixture)))
  pushStep(steps, smokeStep('p0-case-study-card-path', () => verifyCaseStudyCardPath(fixture)))
  pushStep(steps, smokeStep('p0-revision-task-adoption', () => verifyRevisionTaskAdoption(fixture)))
  pushStep(steps, smokeStep('p0-novel-submission-export', () => verifyNovelSubmissionExport(fixture.project.id)))
  return { fixture, steps }
}

async function verifyDraftPersistenceRenderer(win: BrowserWindow, fixture: P0Fixture): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const repos = getRepos()
    const shot = repos.shot.createShot(repos.db, {
      sceneId: fixture.scene.id,
      episodeId: fixture.episode.id,
      shotNumber: 1,
      visualDescription: 'E2E 草稿持久化镜头',
      videoPrompt: '原始镜头 Prompt',
    })
    const result = await win.webContents.executeJavaScript(
      `(${rendererDraftPersistenceMain.toString()})(${JSON.stringify({
        projectId: fixture.project.id,
        adaptationId: fixture.adaptation.id,
        episodeId: fixture.episode.id,
        sceneId: fixture.scene.id,
        scriptId: fixture.script.id,
        shotId: shot.id,
      })})`,
      true,
    ) as { scriptContent: string; shotPrompt: string }
    if (!result.scriptContent.includes('E2E immediate script draft') || !result.shotPrompt.includes('E2E immediate shot draft')) {
      throw new Error('编辑器立即切换后的草稿没有持久化')
    }
    return {
      name: 'draft-autosave-on-immediate-route-leave',
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: { scriptId: fixture.script.id, shotId: shot.id },
    }
  } catch (error) {
    return {
      name: 'draft-autosave-on-immediate-route-leave',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function seedP0Fixture(projectId: string): P0Fixture {
  const repos = getRepos()
  const project = repos.project.updateProject(repos.db, projectId, {
    coreHook: '她重回开机当天，用未来爆款公式逆转全网嘲笑。',
    synopsis: '女主前世被夺创意，重生后从第一场戏开始反击。',
    shortDramaType: '重生逆袭',
    targetAudience: '18-35 岁短剧用户',
    coreSellingPoint: '娱乐圈复仇、爆款制作、公开打脸',
    visualStyleDirection: '都市片场、竖屏强反应',
  }) ?? repos.project.getProject(repos.db, projectId)
  if (!project) throw new Error('fixture project missing')

  const existingChapter = repos.chapter.listChapters(repos.db, projectId)[0]
    ?? repos.chapter.createChapter(repos.db, { projectId, title: '第一章 开机日重生' })
  const chapter = repos.chapter.updateChapter(repos.db, existingChapter.id, {
    title: '第一章 开机日重生',
    content: '她在片场醒来，听见前世夺走她剧本的人正在宣布开机。',
    summary: '女主重回开机日并准备公开反击。',
    hook: '开场即重生到公开开机现场。',
    mainConflict: '前世仇人抢先宣布署名。',
    cliffhanger: '她把备份剧本投到大屏。',
  }) ?? existingChapter
  const secondChapter = repos.chapter.createChapter(repos.db, {
    projectId,
    title: '第二章 围读反击',
    orderIndex: 1,
    content: '围读会上，她改掉致命桥段，让投资人第一次沉默。',
    hook: '围读现场所有人等她出错。',
    mainConflict: '反派逼她当众承认抄袭。',
    cliffhanger: '投资人要求立刻试拍。',
  })

  const character = repos.character.createCharacter(repos.db, {
    projectId,
    name: '许知夏',
    role: '女主',
    identity: '重生短剧制作人',
    desire: '夺回创意署名',
    shortDramaFunction: '每章推动反击爽点',
  })
  repos.outline.createOutline(repos.db, {
    projectId,
    type: 'book',
    title: '全书大纲',
    content: '重生开机、围读反击、热搜反转、夺回署名。',
  })
  const qualityGate = repos.creative.createQualityGateReport(repos.db, {
    projectId,
    targetKind: 'project',
    targetId: projectId,
    stage: 'novel_to_adaptation',
    score: 82,
    verdict: 'pass',
    blockingIssues: [],
    warnings: ['反派动机还可继续加深'],
    suggestions: ['投稿前补齐前三章尾钩'],
  })
  const adaptation = repos.adaptationProject.createAdaptationProject(repos.db, {
    sourceProjectId: projectId,
    title: '短剧改编 smoke',
    targetEpisodeCount: 24,
    adaptationStyle: '竖屏爽剧',
    audience: '女性短剧用户',
  })
  const episode = repos.episode.createEpisode(repos.db, {
    adaptationProjectId: adaptation.id,
    episodeNumber: 1,
    title: '第1集 开机日重生',
    summary: '女主回到开机当天，在围观者面前准备反杀。',
    hook: '第一秒看到开机横幅和反派署名。',
    mainConflict: '署名被抢，现场无人相信她。',
    cliffhanger: '大屏开始播放她的原始创作记录。',
    keyVisuals: ['开机横幅', '证据投屏'],
    relatedChapterIds: [chapter.id],
  })
  const script = repos.script.createScript(repos.db, {
    adaptationProjectId: adaptation.id,
    episodeId: episode.id,
    episodeNumber: 1,
    title: '第1集剧本',
    content: '【片场】女主抬头看见被夺走的署名，按下投屏键。',
    hook: '署名被夺',
    mainConflict: '公开抢署名',
    cliffhanger: '投屏倒计时',
  })
  const scene = repos.scene.createScene(repos.db, {
    scriptId: script.id,
    episodeId: episode.id,
    sceneNumber: 1,
    title: '片场开机',
    location: '都市片场',
    summary: '女主当众准备反击。',
    visualDescription: '竖屏近景切开机横幅和人群反应。',
    characters: [character.id],
  })

  return {
    project,
    chapter,
    chapters: [chapter, secondChapter],
    character,
    qualityGate,
    adaptation,
    episode,
    script,
    scene,
  }
}

function verifyMainWorkflowGuide(fixture: P0Fixture): void {
  const repos = getRepos()
  const stages = buildProjectWorkflowStages({
    project: fixture.project,
    chapters: repos.chapter.listChapters(repos.db, fixture.project.id),
    characters: repos.character.listCharacters(repos.db, fixture.project.id),
    outlines: repos.outline.listOutlines(repos.db, fixture.project.id),
    qualityReports: repos.creative.listQualityGateReports(repos.db, fixture.project.id),
    adaptations: repos.adaptationProject.listAdaptationsByProject(repos.db, fixture.project.id),
    episodes: repos.episode.listEpisodes(repos.db, fixture.adaptation.id),
    scripts: repos.script.listScripts(repos.db, fixture.adaptation.id),
    scenes: repos.scene.listScenesByScript(repos.db, fixture.script.id),
    shots: [],
    videoTasks: [],
  })
  const done = new Set(stages.filter((stage) => stage.complete).map((stage) => stage.key))
  const requiredStages = ['setup', 'characters', 'outline', 'chapters', 'quality', 'adaptation', 'scripts'] as const
  for (const key of requiredStages) {
    if (!done.has(key)) throw new Error(`workflow stage not complete: ${key}`)
  }
  const shotsStage = stages.find((stage) => stage.key === 'shots')
  if (shotsStage?.status !== 'active') throw new Error(`shots stage should be active, got ${shotsStage?.status}`)
}

function verifyAgentCommandPlans(fixture: P0Fixture): void {
  const repos = getRepos()
  const context = {
    projectId: fixture.project.id,
    project: fixture.project,
    activeChapter: fixture.chapter,
    chapters: repos.chapter.listChapters(repos.db, fixture.project.id),
    characters: repos.character.listCharacters(repos.db, fixture.project.id),
    storyArcs: [],
    projectSkills: [],
    caseStudies: repos.creative.listCaseStudies(repos.db),
    visualProfiles: [],
    adaptations: repos.adaptationProject.listAdaptationsByProject(repos.db, fixture.project.id),
    episodes: repos.episode.listEpisodes(repos.db, fixture.adaptation.id),
    scripts: repos.script.listScripts(repos.db, fixture.adaptation.id),
    scenes: repos.scene.listScenesByScript(repos.db, fixture.script.id),
    shots: [],
  }
  const chapterPlan = buildAgentCommandPlan('帮我润色第一章，让情绪更强', context)
  if (chapterPlan?.status !== 'ready' || chapterPlan.taskType !== 'polish_chapter' || chapterPlan.resultMode !== 'text_preview') {
    throw new Error(`chapter command plan invalid: ${JSON.stringify(chapterPlan)}`)
  }
  const episodePlan = buildAgentCommandPlan('根据这本小说生成分集大纲', context)
  if (episodePlan?.status !== 'ready' || episodePlan.taskType !== 'convert_novel_to_episodes') {
    throw new Error(`episode command plan invalid: ${JSON.stringify(episodePlan)}`)
  }
  const shotPlan = buildAgentCommandPlan('把当前场景拆分镜头', context)
  if (shotPlan?.status !== 'ready' || shotPlan.taskType !== 'split_scene_to_shots' || shotPlan.confirmBeforeRun !== true) {
    throw new Error(`shot command plan invalid: ${JSON.stringify(shotPlan)}`)
  }
}

function verifyCaseStudyCardPath(fixture: P0Fixture): void {
  const repos = getRepos()
  const caseStudy = repos.creative.createCaseStudy(repos.db, {
    title: 'E2E 拆书样本',
    genre: fixture.project.shortDramaType,
    summary: '只保存抽象结构和创作卡片。',
    openingHooks: ['第一屏给出署名被抢的结果'],
    highlightBeats: ['公开证据投屏完成第一轮反击'],
    rhythmCurve: [8, 7, 9],
    creativeCards: [
      {
        kind: 'hook',
        title: '开机日公开反杀',
        pattern: '先给被夺署名的结果，再让主角用证据反杀。',
        applyTo: '第一章钩子 / 第一集开场',
        risk: '不要复用样本文句',
      },
    ],
    riskTags: ['避免照搬样本句子'],
  })
  fixture.caseStudy = caseStudy
  const listed = repos.creative.listCaseStudies(repos.db).find((item) => item.id === caseStudy.id)
  if (!listed?.creativeCards.length) throw new Error('case study creative cards missing')
  if (listed.creativeCards[0]?.pattern.includes('她在片场醒来')) throw new Error('case study card copied source prose')
}

function verifyRevisionTaskAdoption(fixture: P0Fixture): void {
  const repos = getRepos()
  const before = fixture.chapter.content
  const task = repos.creative.createRevisionTask(repos.db, {
    projectId: fixture.project.id,
    targetKind: 'chapter',
    targetId: fixture.chapter.id,
    title: '强化第一章尾钩',
    description: '让片尾证据投屏更明确。',
    suggestedAction: '补一个投屏倒计时尾钩。',
    priority: 'must',
    expectedBenefit: { retention: 2, freshness: 1, visual: 2, cost: 0 },
  })
  const revised = `${before}\n\n大屏倒计时归零前，她说：“署名是谁的，马上就知道。”`
  const version = repos.creative.createContentVersion(repos.db, {
    projectId: fixture.project.id,
    targetKind: 'chapter',
    targetId: fixture.chapter.id,
    label: 'E2E 修稿任务采用',
    source: 'revision_task',
    content: before,
    meta: { revisionTaskId: task.id },
  })
  const updatedChapter = repos.chapter.updateChapterContent(repos.db, fixture.chapter.id, revised)
  const updatedTask = repos.creative.updateRevisionTask(repos.db, task.id, {
    status: 'applied',
    appliedVersionId: version.id,
  })
  fixture.revisionTask = updatedTask
  if (!updatedChapter?.content.includes('署名是谁的')) throw new Error('revision adoption did not update chapter content')
  if (updatedTask?.status !== 'applied' || updatedTask.appliedVersionId !== version.id) throw new Error('revision task was not marked applied')
}

function verifyNovelSubmissionExport(projectId: string): void {
  const repos = getRepos()
  const project = repos.project.getProject(repos.db, projectId)
  if (!project) throw new Error('submission export project missing')
  const data = {
    project,
    characters: repos.character.listCharacters(repos.db, projectId),
    chapters: repos.chapter.listChapters(repos.db, projectId),
    evaluations: repos.evaluation.listEvaluations(repos.db, projectId),
    qualityGateReports: repos.creative.listQualityGateReports(repos.db, projectId),
  }
  const markdown = exportNovelSubmissionMarkdown(data, { chapterLimit: 2 })
  if (!markdown.includes('小说投稿包')) throw new Error('submission markdown missing title')
  if (!markdown.includes('质量摘要')) throw new Error('submission markdown missing quality summary')
  if (!markdown.includes('第一章 开机日重生')) throw new Error('submission markdown missing first chapter')
  const json = JSON.parse(exportNovelSubmissionJson(data, { chapterLimit: 1 })) as { sampleChapters?: unknown[]; chapterCatalog?: unknown[] }
  if (json.sampleChapters?.length !== 1) throw new Error('submission json chapter limit not applied')
  if ((json.chapterCatalog?.length ?? 0) < 2) throw new Error('submission json catalog missing chapters')
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
  const e2eApiKey = `sk-e2e-${Date.now()}-not-a-real-key`
  let projectId = ''
  let modelConfigId = ''

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
    setInputValue(inputByPlaceholder('sk-...'), e2eApiKey)
    setInputValue(inputByPlaceholder('gpt-4o-mini'), 'e2e-mock-model')
    clickButton('添加')
    await waitFor('模型配置列表', () => text().includes(modelName))
    const api = (window as unknown as {
      api: { model: { list: () => Promise<Array<{ id: string; name: string; apiKey?: string }>> } }
    }).api
    const config = (await api.model.list()).find((item) => item.name === modelName)
    if (!config?.id || !config.apiKey?.startsWith('masked:v1:') || config.apiKey.includes(e2eApiKey)) {
      throw new Error('renderer 未获得掩码后的模型配置')
    }
    modelConfigId = config.id
  })

  return { projectId, modelConfigId, steps }
}

async function rendererDraftPersistenceMain(input: {
  projectId: string
  adaptationId: string
  episodeId: string
  sceneId: string
  scriptId: string
  shotId: string
}): Promise<{ scriptContent: string; shotPrompt: string }> {
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const waitFor = async (label: string, probe: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await probe()) return
      await sleep(50)
    }
    throw new Error(`草稿持久化 smoke 等待超时：${label}`)
  }
  const setValue = (element: HTMLTextAreaElement, value: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const api = (window as unknown as {
    api: {
      script: { get: (id: string) => Promise<{ content: string } | undefined> }
      shot: { get: (id: string) => Promise<{ videoPrompt: string } | undefined> }
    }
  }).api

  window.location.hash = `#/adaptations/${input.adaptationId}/scripts`
  await waitFor('剧本编辑器', () => Boolean(document.querySelector('textarea[placeholder*="剧本正文"]')))
  const scriptDraft = 'E2E immediate script draft'
  setValue(document.querySelector('textarea[placeholder*="剧本正文"]') as HTMLTextAreaElement, scriptDraft)
  window.location.hash = '#/'
  await waitFor('项目列表', () => (document.body.textContent ?? '').includes('短剧 IP 小说写作工作台'))
  await waitFor('剧本持久化', async () => (await api.script.get(input.scriptId))?.content.includes(scriptDraft) === true)

  window.location.hash = `#/adaptations/${input.adaptationId}/shots?episode=${input.episodeId}&scene=${input.sceneId}`
  await waitFor('镜头编辑器', () => (document.body.textContent ?? '').includes('镜头 Prompt 编辑器'))
  const shotDraft = 'E2E immediate shot draft'
  const shotTextarea = document.querySelectorAll('textarea')[0] as HTMLTextAreaElement | undefined
  if (!shotTextarea) throw new Error('未找到镜头 Prompt 输入框')
  setValue(shotTextarea, shotDraft)
  window.location.hash = '#/'
  await waitFor('返回项目列表', () => (document.body.textContent ?? '').includes('短剧 IP 小说写作工作台'))
  await waitFor('镜头持久化', async () => (await api.shot.get(input.shotId))?.videoPrompt.includes(shotDraft) === true)

  return {
    scriptContent: (await api.script.get(input.scriptId))?.content ?? '',
    shotPrompt: (await api.shot.get(input.shotId))?.videoPrompt ?? '',
  }
}
