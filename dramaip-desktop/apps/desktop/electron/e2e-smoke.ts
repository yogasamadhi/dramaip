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
import { buildQualityGateSourceFingerprint } from '@sdns/core'
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
import { reconcileLongTasks } from './task-recovery'

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
  const revisionAdoptionIpcStep = await verifyRevisionTaskAdoptionIpc(win, p0.fixture)
  const productionShellStep = await verifyProductionShellRenderer(win, p0.fixture)
  const structuredScriptStep = await verifyStructuredScriptRenderer(win, p0.fixture)
  const storyboardStep = await verifyStoryboardRenderer(win, p0.fixture)
  const draftPersistenceStep = await verifyDraftPersistenceRenderer(win, p0.fixture)
  const taskRecoveryStep = verifyTaskRecoveryAfterSimulatedRestart(p0.fixture.project.id)
  const projectPackageStep = runProjectPackageRoundTrip(renderer.projectId)
  if (!projectPackageStep.ok) throw new Error(projectPackageStep.error ?? '项目包往返失败')
  return {
    projectId: renderer.projectId,
    importedProjectId: String(projectPackageStep.detail?.importedProjectId ?? ''),
    steps: [...renderer.steps, keychainStep, cloudAuthStep, ...p0.steps, revisionAdoptionIpcStep, productionShellStep, structuredScriptStep, storyboardStep, draftPersistenceStep, taskRecoveryStep, projectPackageStep],
  }
}

function verifyTaskRecoveryAfterSimulatedRestart(projectId: string): E2eSmokeStep {
  const startedAt = Date.now()
  try {
    const repos = getRepos()
    const localAi = repos.longTask.createLongTask(repos.db, {
      kind: 'ai',
      status: 'running',
      title: 'E2E 崩溃前 AI 任务',
      projectId,
      input: { retryInput: { projectId, taskType: 'polish_chapter' } },
    })
    const localBatch = repos.longTask.createLongTask(repos.db, {
      kind: 'batch',
      status: 'pending',
      title: 'E2E 崩溃前批量任务',
      projectId,
    })
    const remoteVideo = repos.videoTask.createVideoTask(repos.db, {
      projectId,
      provider: 'e2e',
      model: 'e2e',
      prompt: '恢复远端视频状态',
      referenceImageUrls: [],
      status: 'running',
      remoteTaskId: 'remote-e2e-recovery',
    })
    const videoLongTask = repos.longTask.createLongTask(repos.db, {
      kind: 'video',
      status: 'running',
      title: 'E2E 崩溃前远端视频任务',
      projectId,
      relatedEntityId: remoteVideo.id,
    })

    const restarted = reconcileLongTasks(repos)
    const recoveredAi = repos.longTask.getLongTask(repos.db, localAi.id)
    const recoveredBatch = repos.longTask.getLongTask(repos.db, localBatch.id)
    const recoveredVideo = repos.longTask.getLongTask(repos.db, videoLongTask.id)
    const recoveryMode = (task: typeof recoveredAi) => {
      const recovery = task?.output?.recovery
      return recovery && typeof recovery === 'object' ? (recovery as { mode?: string }).mode : undefined
    }
    if (
      restarted.interrupted < 2 ||
      restarted.remotePolling < 1 ||
      recoveredAi?.status !== 'failed' ||
      recoveredBatch?.status !== 'failed' ||
      recoveredVideo?.status !== 'pending' ||
      recoveryMode(recoveredAi) !== 'interrupted' ||
      recoveryMode(recoveredVideo) !== 'remote_polling'
    ) {
      throw new Error('重启后任务恢复没有把本地任务安全中断或恢复远端轮询')
    }

    repos.videoTask.updateVideoTask(repos.db, remoteVideo.id, { status: 'success' })
    const polledAfterRestart = reconcileLongTasks(repos)
    const completedVideo = repos.longTask.getLongTask(repos.db, videoLongTask.id)
    if (polledAfterRestart.remoteFinished < 1 || completedVideo?.status !== 'success') {
      throw new Error('恢复后的远端视频任务未能重新确认最终状态')
    }
    return {
      name: 'long-task-crash-restart-recovery-and-remote-requery',
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: { interrupted: restarted.interrupted, remotePolling: restarted.remotePolling },
    }
  } catch (error) {
    return {
      name: 'long-task-crash-restart-recovery-and-remote-requery',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
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
    sourceFingerprint: buildQualityGateSourceFingerprint({
      stage: 'novel_to_adaptation',
      project,
      chapters: repos.chapter.listChapters(repos.db, projectId),
      characters: repos.character.listCharacters(repos.db, projectId),
      outlines: repos.outline.listOutlines(repos.db, projectId),
    }),
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
    activeAdaptation: repos.project.resolveActiveAdaptation(repos.db, fixture.project.id).adaptation,
    episodes: repos.episode.listEpisodes(repos.db, fixture.adaptation.id),
    scripts: repos.script.listScripts(repos.db, fixture.adaptation.id),
    scenes: repos.scene.listScenesByScript(repos.db, fixture.script.id),
    shots: [],
    videoTasks: [],
    videoResults: [],
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
    activeAdaptationId: repos.project.resolveActiveAdaptation(repos.db, fixture.project.id).adaptation?.id,
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
  repos.revisionAdoption.saveRevisionTaskPreview(repos.db, task.id, {
    targetKind: 'chapter',
    targetId: fixture.chapter.id,
    taskType: 'rewrite_chapter',
    currentContent: before,
    nextContent: revised,
    projectId: fixture.project.id,
  })
  const adopted = repos.revisionAdoption.adoptRevisionTask(repos.db, task.id)
  const repeated = repos.revisionAdoption.adoptRevisionTask(repos.db, task.id)
  fixture.revisionTask = adopted.task
  const updatedChapter = repos.chapter.getChapter(repos.db, fixture.chapter.id)
  if (!adopted.ok || !updatedChapter?.content.includes('署名是谁的')) throw new Error('revision adoption did not update chapter content')
  if (adopted.task?.status !== 'applied' || !adopted.appliedVersion?.id || !adopted.beforeVersion?.id || !repeated.alreadyApplied) {
    throw new Error('revision adoption was not atomic or idempotent')
  }
}

async function verifyRevisionTaskAdoptionIpc(win: BrowserWindow, fixture: P0Fixture): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const task = fixture.revisionTask
    if (!task) throw new Error('revision task fixture missing')
    const undone = await win.webContents.executeJavaScript(
      `window.api.revisionTask.undo(${JSON.stringify(task.id)})`,
      true,
    ) as { ok?: boolean; error?: string; task?: { status?: string } }
    if (!undone.ok || undone.task?.status !== 'undone') throw new Error(undone.error ?? 'renderer undo did not complete')
    const repos = getRepos()
    const restored = repos.chapter.getChapter(repos.db, fixture.chapter.id)
    if (restored?.content !== fixture.chapter.content) throw new Error('renderer undo did not restore pre-adopt chapter content')
    const editedCandidate = `${fixture.chapter.content}\n\n只从预览中采用这一段倒计时。`
    const updated = await win.webContents.executeJavaScript(
      `window.api.revisionTask.updatePreview(${JSON.stringify(task.id)}, ${JSON.stringify({
        targetKind: 'chapter', targetId: fixture.chapter.id, taskType: 'rewrite_chapter',
        currentContent: fixture.chapter.content, nextContent: editedCandidate, projectId: fixture.project.id,
      })})`,
      true,
    ) as { ok?: boolean; error?: string; task?: { status?: string } }
    if (!updated.ok || updated.task?.status !== 'preview_ready') throw new Error(updated.error ?? 'renderer did not save edited revision candidate')
    const adopted = await win.webContents.executeJavaScript(`window.api.revisionTask.adopt(${JSON.stringify(task.id)})`, true) as { ok?: boolean; error?: string }
    if (!adopted.ok || repos.chapter.getChapter(repos.db, fixture.chapter.id)?.content !== editedCandidate) throw new Error(adopted.error ?? 'renderer did not atomically adopt edited candidate')
    const undoneAgain = await win.webContents.executeJavaScript(`window.api.revisionTask.undo(${JSON.stringify(task.id)})`, true) as { ok?: boolean; error?: string }
    if (!undoneAgain.ok || repos.chapter.getChapter(repos.db, fixture.chapter.id)?.content !== fixture.chapter.content) throw new Error(undoneAgain.error ?? 'renderer did not undo edited candidate')
    return { name: 'revision-task-edited-preview-adopt-and-undo-ipc', ok: true, durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      name: 'revision-task-edited-preview-adopt-and-undo-ipc',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
  let trashProjectTitle = ''

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

  await step('accessible-confirm-dialog-cancel', async () => {
    const deleteButton = document.querySelector('button[aria-label="删除章节"]') as HTMLButtonElement | null
    if (!deleteButton) throw new Error('未找到章节删除确认入口')
    deleteButton.click()
    const confirmationDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => normalize(dialog.textContent).includes('删除该章节'))
    await waitFor('可访问删除确认对话框', () => confirmationDialog())
    const dialog = confirmationDialog()
    if (!dialog?.querySelector('#confirm-action-description') || !dialog.contains(document.activeElement)) {
      throw new Error('确认对话框缺少说明或未接管键盘焦点')
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await waitFor('Escape 关闭确认对话框', () => !confirmationDialog())
    if (!(document.body.textContent ?? '').includes('第 1 章')) throw new Error('取消确认后章节被意外删除')
  })

  await step('workspace-shell-deep-link-history-and-panels', async () => {
    const chapterHash = window.location.hash
    if (!chapterHash.includes('section=chapters') || !chapterHash.includes('chapter=')) {
      throw new Error(`新建章节未写入可恢复深链：${chapterHash}`)
    }
    const overviewButton = document.querySelector('button[title="项目概览"]') as HTMLButtonElement | null
    if (!overviewButton) throw new Error('未找到项目概览导航入口')
    overviewButton.click()
    await waitFor('项目概览深链', () => window.location.hash.includes('section=overview'))
    window.history.back()
    await waitFor('章节深链历史恢复', () => window.location.hash === chapterHash)

    const resizeHandle = document.querySelector('[role="separator"][aria-label="调整上下文侧栏宽度"]') as HTMLElement | null
    if (!resizeHandle) throw new Error('未找到上下文侧栏键盘调宽控件')
    const before = JSON.parse(window.localStorage.getItem('sdns-workspace-shell-v1') ?? '{}') as { contextWidth?: number }
    resizeHandle.focus()
    resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    await waitFor('侧栏宽度持久化', () => {
      const after = JSON.parse(window.localStorage.getItem('sdns-workspace-shell-v1') ?? '{}') as { contextWidth?: number }
      return typeof after.contextWidth === 'number' && after.contextWidth === (before.contextWidth ?? 232) + 16
    })

    const focusButton = document.querySelector('button[aria-label="进入专注模式"]') as HTMLButtonElement | null
    if (!focusButton) throw new Error('未找到专注模式入口')
    focusButton.click()
    await waitFor('专注模式隐藏两侧面板', () => !document.querySelector('[data-context-mode]') && !document.querySelector('[role="separator"]'))
    const exitFocusButton = document.querySelector('button[aria-label="退出专注模式"]') as HTMLButtonElement | null
    if (!exitFocusButton) throw new Error('未找到退出专注模式入口')
    exitFocusButton.click()
    await waitFor('退出专注模式恢复上下文侧栏', () => Boolean(document.querySelector('[data-context-mode]')))
  })

  await step('global-task-dock-is-available-across-workspace', async () => {
    const dock = document.querySelector('button[aria-label^="任务状态"]') as HTMLButtonElement | null
    if (!dock) throw new Error('未找到全局任务状态入口')
    dock.click()
    await waitFor('展开全局任务状态', () => Boolean(document.querySelector('[aria-label="任务状态详情"]')))
    dock.click()
    await waitFor('收起全局任务状态', () => !document.querySelector('[aria-label="任务状态详情"]'))
  })

  await step('ai-command-palette-search-policy-and-shortcut', async () => {
    const commandButton = buttonByText('AI 命令')
    if (!commandButton) throw new Error('未找到 AI 命令面板入口')
    commandButton.click()
    const commandDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => normalize(dialog.textContent).includes('AI 命令面板'))
    await waitFor('AI 命令面板', () => commandDialog())
    const commandSearch = commandDialog()?.querySelector('input[aria-label="搜索 AI 命令"]') as HTMLInputElement | null
    if (!commandSearch) throw new Error('AI 命令面板缺少可访问搜索框')
    setInputValue(commandSearch, '润色')
    await waitFor('AI 命令搜索与写入策略', () => {
      const textValue = normalize(commandDialog()?.textContent)
      return textValue.includes('润色章节') && textValue.includes('预览后采用')
    })
    const favoriteButton = commandDialog()?.querySelector('button[aria-label="收藏 润色章节"]') as HTMLButtonElement | null
    if (!favoriteButton) throw new Error('AI 命令缺少收藏入口')
    favoriteButton.click()
    await waitFor('AI 命令收藏状态', () => Boolean(commandDialog()?.querySelector('button[aria-label="取消收藏 润色章节"]')))

    const polishCommand = Array.from(commandDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => normalize(button.textContent).startsWith('润色章节'))
    if (!polishCommand) throw new Error('AI 命令缺少章节执行入口')
    polishCommand.click()
    const preflightDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => normalize(dialog.textContent).includes('AI 执行前确认'))
    await waitFor('AI 紧凑预检摘要', () => normalize(preflightDialog()?.textContent).includes('查看详情'))
    clickButton('查看详情')
    await waitFor('AI 预检详情', () => normalize(preflightDialog()?.textContent).includes('收起详情'))
    const closePreflight = Array.from(preflightDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => normalize(button.textContent) === '关闭')
    if (!closePreflight) throw new Error('AI 预检缺少关闭入口')
    closePreflight.click()
    await waitFor('关闭 AI 预检', () => !preflightDialog())

    commandButton.click()
    await waitFor('再次打开 AI 命令面板', () => commandDialog())
    const catalogSearch = commandDialog()?.querySelector('input[aria-label="搜索 AI 命令"]') as HTMLInputElement | null
    if (!catalogSearch) throw new Error('AI 命令面板缺少第二次搜索框')
    setInputValue(catalogSearch, '人物卡')
    await waitFor('人物卡命令', () => normalize(commandDialog()?.textContent).includes('生成人物卡'))
    const characterCommand = Array.from(commandDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => normalize(button.textContent).startsWith('生成人物卡'))
    if (!characterCommand) throw new Error('AI 命令缺少人物卡入口')
    characterCommand.click()
    await waitFor('人物卡原工作区', () => window.location.hash.includes('section=characters'))

    const overviewButton = document.querySelector('button[title="项目概览"]') as HTMLButtonElement | null
    if (!overviewButton) throw new Error('未找到项目概览导航入口')
    overviewButton.click()
    await waitFor('命令面板快捷键前的项目概览', () => window.location.hash.includes('section=overview'))
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'k', metaKey: true }))
    await waitFor('Cmd K 打开 AI 命令面板', () => commandDialog())
    clickButton('关闭')
    await waitFor('Cmd K 命令面板关闭', () => !commandDialog())
  })

  await step('chapter-tree-300-performance-order-and-keyboard', async () => {
    const api = (window as unknown as {
      api: {
        chapter: {
          list: (projectId: string) => Promise<Array<{ id: string; title: string; orderIndex: number }>>
          create: (input: { projectId: string; title: string }) => Promise<{ id: string }>
          reorder: (projectId: string, orderedIds: string[]) => Promise<Array<{ id: string; orderIndex: number }>>
        }
        storyArc: {
          create: (input: { projectId: string; kind: 'volume' | 'unit'; title: string; parentId?: string; chapterStart?: number; chapterEnd?: number }) => Promise<{ id: string }>
        }
      }
    }).api
    let longProjectChapters = await api.chapter.list(projectId)
    for (let index = longProjectChapters.length; index < 300; index++) {
      await api.chapter.create({ projectId, title: `第 ${index + 1} 章 · 长篇导航验证` })
    }
    const volume = await api.storyArc.create({ projectId, kind: 'volume', title: '第一卷 · 长篇导航验证' })
    await api.storyArc.create({
      projectId,
      kind: 'unit',
      parentId: volume.id,
      title: '开篇反击单元',
      chapterStart: 1,
      chapterEnd: 100,
    })
    longProjectChapters = await api.chapter.list(projectId)
    const reordered = await api.chapter.reorder(projectId, [longProjectChapters[1]!.id, longProjectChapters[0]!.id, ...longProjectChapters.slice(2).map((chapter) => chapter.id)])
    if (reordered[0]?.id !== longProjectChapters[1]?.id || reordered[0]?.orderIndex !== 0) {
      throw new Error('章节重排没有持久化完整顺序')
    }

    // 直接通过受限 IPC 造 300 章 fixture 后，按真实用户导航重新打开工作台，
    // 验证章节树会从 SQLite 重新读取卷/单元和重排结果。
    window.location.hash = '#/'
    await waitFor('返回项目列表以刷新长篇 fixture', () => text().includes('项目工作台'))
    window.location.hash = `#/projects/${projectId}?section=chapters&chapter=${reordered[0]!.id}`
    await waitFor('300 章章节树', () => Boolean(document.querySelector('[role="tree"][aria-label="按卷和单元分组的章节"]')))
    const tree = document.querySelector('[role="tree"]') as HTMLElement
    const renderedRows = tree.querySelectorAll('[role="treeitem"]').length
    if (renderedRows >= 60) throw new Error(`章节树未虚拟化：渲染了 ${renderedRows} 行`)
    if (!tree.textContent?.includes('第一卷 · 长篇导航验证')) throw new Error('章节树未显示卷/单元分组')

    const searchInput = document.querySelector('input[aria-label="搜索章节"]') as HTMLInputElement | null
    if (!searchInput) throw new Error('未找到章节树搜索框')
    setInputValue(searchInput, '第 300 章')
    await waitFor('章节树搜索', () => tree.textContent?.includes('第 300 章 · 长篇导航验证'))
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'k', metaKey: true }))
    await waitFor('Cmd K 聚焦章节搜索', () => document.activeElement === searchInput)
    setInputValue(searchInput, '')
    const beforeChapterId = window.location.hash.match(/[?&]chapter=([^&]+)/)?.[1]
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', altKey: true }))
    await waitFor('Alt 下方向键切章', () => window.location.hash.includes('chapter=') && !window.location.hash.endsWith(`chapter=${beforeChapterId}`))
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'n', metaKey: true }))
    await waitFor('Cmd N 新建章节', async () => (await api.chapter.list(projectId)).length === 301)
  })

  await step('project-trash-undo-restore-and-strong-purge', async () => {
    const api = (window as unknown as {
      api: { project: { create: (data: { title: string; shortDramaType: string }) => Promise<{ id: string; title: string }> } }
    }).api
    trashProjectTitle = `E2E 废纸篓 ${Date.now()}`
    await api.project.create({ title: trashProjectTitle, shortDramaType: '废纸篓验证' })
    window.location.hash = '#/'
    await waitFor('废纸篓项目卡', () => text().includes(trashProjectTitle))

    const projectTrashButton = () => Array.from(document.querySelectorAll<HTMLElement>('.studio-card-interactive'))
      .find((card) => normalize(card.textContent).includes(trashProjectTitle))
      ?.querySelector<HTMLElement>('button[aria-label="移至废纸篓"]')
    const trashProjectFromCard = () => {
      const button = projectTrashButton()
      if (!button) throw new Error('未找到待移入废纸篓的项目卡')
      button.click()
    }
    trashProjectFromCard()
    await waitFor('项目已移入废纸篓', () => !projectTrashButton() && text().includes('已移至废纸篓'))
    clickButton('撤销')
    await waitFor('撤销恢复项目', () => Boolean(projectTrashButton()))

    trashProjectFromCard()
    await waitFor('再次移入废纸篓', () => !projectTrashButton())
    const openTrash = () => {
      const trigger = document.querySelector('button[aria-label="打开项目废纸篓"]') as HTMLButtonElement | null
      if (!trigger) throw new Error('未找到项目废纸篓入口')
      trigger.click()
    }
    openTrash()
    const trashDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => normalize(dialog.textContent).includes('项目废纸篓'))
    await waitFor('项目废纸篓对话框', () => trashDialog()?.textContent?.includes(trashProjectTitle))
    const restoreButton = Array.from(trashDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => normalize(button.textContent).includes('恢复'))
    if (!restoreButton) throw new Error('未找到废纸篓恢复按钮')
    restoreButton.click()
    await waitFor('废纸篓恢复完成', () => text().includes(`已恢复「${trashProjectTitle}」`))
    clickButton('关闭')
    await waitFor('恢复后回到项目列表', () => !text().includes('项目废纸篓') && Boolean(projectTrashButton()))

    trashProjectFromCard()
    await waitFor('最终删除前再次移入废纸篓', () => !projectTrashButton())
    openTrash()
    await waitFor('废纸篓待清理项目', () => trashDialog()?.textContent?.includes(trashProjectTitle))
    const requestPurgeButton = Array.from(trashDialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => normalize(button.textContent).includes('永久删除'))
    if (!requestPurgeButton) throw new Error('未找到废纸篓永久删除按钮')
    requestPurgeButton.click()
    await waitFor('强确认对话框', () => text().includes(`永久删除「${trashProjectTitle}」`))
    const confirmationDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => normalize(dialog.textContent).includes(`永久删除「${trashProjectTitle}」`))
    const confirmationInput = confirmationDialog?.querySelector('input') as HTMLInputElement | null
    const finalDeleteButton = Array.from(confirmationDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => normalize(button.textContent).includes('永久删除'))
    if (!confirmationInput || !finalDeleteButton?.disabled) throw new Error('永久删除未要求完整项目名确认')
    setInputValue(confirmationInput, trashProjectTitle)
    await waitFor('强确认启用最终删除', () => !finalDeleteButton.disabled)
    finalDeleteButton.click()
    await waitFor('永久删除完成', () => !text().includes(trashProjectTitle))
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
  await waitFor('结构化剧本编辑器', () => Boolean(document.querySelector('[data-script-editor="structured"]')))
  const markdownToggle = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Markdown')
  if (!markdownToggle) throw new Error('未找到剧本 Markdown 回退视图')
  markdownToggle.click()
  await waitFor('剧本 Markdown 回退输入框', () => Boolean(document.querySelector('textarea[aria-label="剧本 Markdown 正文"]')))
  const scriptDraft = 'E2E immediate script draft'
  setValue(document.querySelector('textarea[aria-label="剧本 Markdown 正文"]') as HTMLTextAreaElement, scriptDraft)
  window.location.hash = '#/'
  await waitFor('项目列表', () => (document.body.textContent ?? '').includes('项目工作台'))
  await waitFor('剧本持久化', async () => (await api.script.get(input.scriptId))?.content.includes(scriptDraft) === true)

  window.location.hash = `#/adaptations/${input.adaptationId}/shots?episode=${input.episodeId}&scene=${input.sceneId}&shot=${input.shotId}`
  await waitFor('镜头编辑器', () => (document.body.textContent ?? '').includes('镜头 Prompt 编辑器'))
  const promptTab = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('role') === 'tab' && button.textContent?.trim() === 'Prompt')
  if (!promptTab) throw new Error('未找到镜头 Prompt Inspector 标签')
  promptTab.click()
  await waitFor('视频 Prompt 输入框', () => Boolean(document.querySelector('textarea[aria-label="视频 Prompt"]')))
  const shotDraft = 'E2E immediate shot draft'
  const shotTextarea = document.querySelector('textarea[aria-label="视频 Prompt"]') as HTMLTextAreaElement | undefined
  if (!shotTextarea) throw new Error('未找到镜头 Prompt 输入框')
  setValue(shotTextarea, shotDraft)
  window.location.hash = '#/'
  await waitFor('返回项目列表', () => (document.body.textContent ?? '').includes('项目工作台'))
  await waitFor('镜头持久化', async () => (await api.shot.get(input.shotId))?.videoPrompt.includes(shotDraft) === true)

  return {
    scriptContent: (await api.script.get(input.scriptId))?.content ?? '',
    shotPrompt: (await api.shot.get(input.shotId))?.videoPrompt ?? '',
  }
}

async function verifyStructuredScriptRenderer(win: BrowserWindow, fixture: P0Fixture): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const result = await win.webContents.executeJavaScript(
      `(${rendererStructuredScriptMain.toString()})(${JSON.stringify({
        adaptationId: fixture.adaptation.id,
        scriptId: fixture.script.id,
      })})`,
      true,
    ) as { blockKinds: string[] }
    return {
      name: 'structured-script-editor-keyboard-and-compatible-save',
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: result,
    }
  } catch (error) {
    return {
      name: 'structured-script-editor-keyboard-and-compatible-save',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function rendererStructuredScriptMain(input: { adaptationId: string; scriptId: string }): Promise<{ blockKinds: string[] }> {
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const waitFor = async (label: string, probe: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await probe()) return
      await sleep(50)
    }
    throw new Error(`结构化剧本 smoke 等待超时：${label}`)
  }
  const api = (window as unknown as { api: { script: { get: (id: string) => Promise<{ content: string } | undefined> } } }).api
  window.location.hash = `#/adaptations/${input.adaptationId}/scripts`
  await waitFor('结构化编辑器', () => Boolean(document.querySelector('[data-script-editor="structured"]')))
  const insertBar = document.querySelector('[aria-label="插入剧本块"]')
  const addScene = Array.from(insertBar?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('场景'))
  if (!addScene) throw new Error('未找到添加场景按钮')
  addScene.click()
  await waitFor('新增场景块', () => Boolean(document.querySelector('[data-script-block="scene_heading"] input')))
  const sceneInput = document.querySelector('[data-script-block="scene_heading"] input') as HTMLInputElement
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(sceneInput, 'E2E 结构化场景')
  sceneInput.dispatchEvent(new Event('input', { bubbles: true }))
  await waitFor('场景输入更新', () => (document.querySelector('[data-script-block="scene_heading"] input') as HTMLInputElement | null)?.value === 'E2E 结构化场景')
  const updatedSceneInput = document.querySelector('[data-script-block="scene_heading"] input') as HTMLInputElement
  updatedSceneInput.focus()
  updatedSceneInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', metaKey: true }))
  await waitFor('键盘新增动作块', () => document.querySelectorAll('[data-script-block="action"]').length >= 2)
  await waitFor('兼容 Markdown 保存', async () => (await api.script.get(input.scriptId))?.content.includes('## 场景：E2E 结构化场景') === true)
  return { blockKinds: Array.from(document.querySelectorAll('[data-script-block]')).map((node) => node.getAttribute('data-script-block') ?? '') }
}

async function verifyStoryboardRenderer(win: BrowserWindow, fixture: P0Fixture): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const repos = getRepos()
    const shots = [1, 2, 3].map((shotNumber) => repos.shot.createShot(repos.db, {
      sceneId: fixture.scene.id,
      episodeId: fixture.episode.id,
      shotNumber,
      visualDescription: `E2E Storyboard 镜头 ${shotNumber}`,
      durationSeconds: 3 + shotNumber,
      videoPrompt: `storyboard prompt ${shotNumber}`,
    }))
    const result = await win.webContents.executeJavaScript(
      `(${rendererStoryboardMain.toString()})(${JSON.stringify({
        adaptationId: fixture.adaptation.id,
        episodeId: fixture.episode.id,
        sceneId: fixture.scene.id,
        orderedIds: shots.map((shot) => shot.id),
      })})`,
      true,
    ) as { order: string[] }
    return { name: 'storyboard-order-keyboard-and-inspector', ok: true, durationMs: Date.now() - startedAt, detail: result }
  } catch (error) {
    return {
      name: 'storyboard-order-keyboard-and-inspector',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function rendererStoryboardMain(input: { adaptationId: string; episodeId: string; sceneId: string; orderedIds: string[] }): Promise<{ order: string[] }> {
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const waitFor = async (label: string, probe: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await probe()) return
      await sleep(50)
    }
    throw new Error(`Storyboard smoke 等待超时：${label}`)
  }
  const api = (window as unknown as { api: { shot: { listByScene: (sceneId: string) => Promise<Array<{ id: string }>> } } }).api
  window.location.hash = `#/adaptations/${input.adaptationId}/shots?episode=${input.episodeId}&scene=${input.sceneId}&shot=${input.orderedIds[0]}`
  await waitFor('Storyboard 画布', () => document.querySelectorAll('[data-storyboard-shot]').length === 3)
  if (!document.querySelector('[data-storyboard-assets]')) throw new Error('未找到镜头素材 Inspector')
  const firstCard = document.querySelector(`[data-storyboard-shot="${input.orderedIds[0]}"]`) as HTMLElement
  firstCard.focus()
  firstCard.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight', altKey: true }))
  await waitFor('镜头键盘重排持久化', async () => (await api.shot.listByScene(input.sceneId)).map((shot) => shot.id).join(',') === [input.orderedIds[1], input.orderedIds[0], input.orderedIds[2]].join(','))
  return { order: (await api.shot.listByScene(input.sceneId)).map((shot) => shot.id) }
}

async function verifyProductionShellRenderer(win: BrowserWindow, fixture: P0Fixture): Promise<E2eSmokeStep> {
  const startedAt = Date.now()
  try {
    const result = await win.webContents.executeJavaScript(
      `(${rendererProductionShellMain.toString()})(${JSON.stringify({
        adaptationId: fixture.adaptation.id,
        episodeId: fixture.episode.id,
      })})`,
      true,
    ) as { stages: string[] }
    return {
      name: 'production-shell-stage-navigation-and-context',
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: result,
    }
  } catch (error) {
    return {
      name: 'production-shell-stage-navigation-and-context',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function rendererProductionShellMain(input: { adaptationId: string; episodeId: string }): Promise<{ stages: string[] }> {
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const waitFor = async (label: string, probe: () => boolean, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (probe()) return
      await sleep(50)
    }
    throw new Error(`生产壳 smoke 等待超时：${label}`)
  }
  const bodyText = () => document.body.textContent ?? ''
  const stepperButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('nav[aria-label="改编生产阶段"] button'))
  const chooseStage = async (label: string, expectedHash: string, expectedText: string) => {
    const button = stepperButtons().find((item) => (item.textContent ?? '').includes(label))
    if (!button) throw new Error(`未找到生产阶段入口：${label}`)
    button.click()
    await waitFor(`${label} 路由与上下文`, () => window.location.hash === expectedHash && bodyText().includes(expectedText))
  }

  window.location.hash = `#/adaptations/${input.adaptationId}?section=episodes`
  await waitFor('分集规划生产壳', () => bodyText().includes('分集大纲') && stepperButtons().length === 5)
  await chooseStage('剧本', `#/adaptations/${input.adaptationId}/scripts`, '剧本正文')
  await chooseStage('分镜', `#/adaptations/${input.adaptationId}/shots?episode=${input.episodeId}`, '在左侧选择一个场景')
  await chooseStage('视频交付', `#/adaptations/${input.adaptationId}/video?episode=${input.episodeId}`, '选择左侧镜头')

  return { stages: stepperButtons().map((button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim()) }
}
