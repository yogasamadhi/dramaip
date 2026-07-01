// DB 冒烟测试：验证 repository（含 cast 辅助）在运行期 CRUD + 持久化正确
import os from 'node:os'
import path from 'node:path'
import { backupSqliteDatabase, createDb, restoreSqliteDatabaseFromBackup } from '../packages/db/src/client'
import { createRepositories } from '../packages/db/src/index'
import { BUILT_IN_AGENTS, BUILT_IN_TEMPLATES, BUILT_IN_GENRE_PRESETS } from '@sdns/core'
import {
  collectProjectPackage,
  serializeProjectPackage,
  parseProjectPackage,
  importProjectPackage,
} from '@sdns/export'

const dbPath = path.join(os.tmpdir(), `sdns-db-smoke-${process.pid}.sqlite`)
const backupPath = path.join(os.tmpdir(), `sdns-db-smoke-backup-${process.pid}.sqlite`)
const restoreDbPath = path.join(os.tmpdir(), `sdns-db-smoke-restore-${process.pid}.sqlite`)
const restoreBackupPath = path.join(os.tmpdir(), `sdns-db-smoke-restore-backup-${process.pid}.sqlite`)
const { db } = createDb(dbPath)
const repos = createRepositories(db)

let failures = 0
const assert = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

function smokeBackupRestore() {
  const { db: sourceDb, raw: sourceRaw } = createDb(restoreDbPath)
  const sourceRepos = createRepositories(sourceDb)
  const before = sourceRepos.project.createProject(sourceRepos.db, {
    title: '恢复前项目',
    shortDramaType: '数据安全',
  })
  backupSqliteDatabase(restoreDbPath, restoreBackupPath)
  sourceRepos.project.createProject(sourceRepos.db, {
    title: '备份后写入',
    shortDramaType: '数据安全',
  })
  sourceRaw.close()

  restoreSqliteDatabaseFromBackup(restoreBackupPath, restoreDbPath)
  const { db: restoredDb, raw: restoredRaw } = createDb(restoreDbPath)
  const restoredRepos = createRepositories(restoredDb)
  const restoredProjects = restoredRepos.project.listProjects(restoredRepos.db)
  assert(restoredRepos.project.getProject(restoredRepos.db, before.id)?.title === '恢复前项目', '恢复备份：备份点项目存在')
  assert(!restoredProjects.some((p) => p.title === '备份后写入'), '恢复备份：备份后写入被回滚')
  restoredRaw.close()
}

function main() {
  // 项目
  const p1 = repos.project.createProject(repos.db, {
    title: '复仇千金',
    shortDramaType: '女频复仇',
    targetEpisodeCount: 60,
    synopsis: '复仇故事',
  })
  assert(!!p1.id, 'createProject 返回 id')
  const p2 = repos.project.createProject(repos.db, { title: '重生霸总', shortDramaType: '重生逆袭' })
  assert(repos.project.listProjects(repos.db).length === 2, 'listProjects = 2')

  const got = repos.project.getProject(repos.db, p1.id)
  assert(got?.title === '复仇千金' && got.targetEpisodeCount === 60, 'getProject 字段正确')

  const upd = repos.project.updateProject(repos.db, p1.id, { title: '复仇千金归来', coreHook: '三年后回归' })
  assert(upd?.title === '复仇千金归来' && upd?.coreHook === '三年后回归', 'updateProject 写回正确')

  // 章节
  const c1 = repos.chapter.createChapter(repos.db, { projectId: p1.id, title: '第一章', outline: '归来' })
  const c2 = repos.chapter.createChapter(repos.db, { projectId: p1.id, title: '第二章', outline: '交锋' })
  assert(repos.chapter.listChapters(repos.db, p1.id).length === 2, 'listChapters = 2（顺序保留）')

  const cUpd = repos.chapter.updateChapterContent(repos.db, c1.id, '这是第一章正文…')
  assert(cUpd?.content === '这是第一章正文…', 'updateChapterContent 写回正文')

  // 人物
  const ch = repos.character.createCharacter(repos.db, { projectId: p1.id, name: '林晚', role: '主角', personality: '冷静' })
  assert(repos.character.listCharacters(repos.db, p1.id).length === 1, 'createCharacter + list')

  // 大纲
  const o = repos.outline.createOutline(repos.db, { projectId: p1.id, type: 'book', title: '全书大纲', content: '## 开端' })
  assert(repos.outline.listOutlines(repos.db, p1.id).length === 1, 'createOutline + list')

  // 模型配置
  const m = repos.modelConfig.createModelConfig(repos.db, {
    name: '默认', provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'gpt-4o', isDefault: true,
  })
  const def = repos.modelConfig.getDefaultModelConfig(repos.db)
  assert(def?.id === m.id, 'createModelConfig(isDefault) + getDefault')
  // 再建一个设为默认，验证 clearDefault 生效
  const m2 = repos.modelConfig.createModelConfig(repos.db, { name: '二号', provider: 'openai', baseUrl: 'u', apiKey: 'k', model: 'gpt-4o-mini', isDefault: true })
  const def2 = repos.modelConfig.getDefaultModelConfig(repos.db)
  assert(def2?.id === m2.id, '第二个 isDefault 后，旧的被取消默认')

  // ai_runs（直接造一条，验证 insert + list）
  const run = repos.aiRun.createAiRun(repos.db, {
    projectId: p1.id, graphName: 'novel-workflow', type: 'generate_chapter',
    provider: 'openai', model: 'gpt-4o', input: '{}', output: '正文', status: 'success', latencyMs: 123,
  })
  assert(repos.aiRun.listAiRunsByProject(repos.db, p1.id).length === 1 && !!run.id, 'createAiRun + list')

  // v0.5 改编项目 → 分集 → 剧本 → 场景 + 审稿（CRUD / upsert / 级联）
  const ap = repos.adaptationProject.createAdaptationProject(repos.db, {
    sourceProjectId: p1.id,
    title: '复仇千金·短剧',
    targetEpisodeCount: 24,
    adaptationStyle: '快节奏爽剧',
    seasonNumber: 1,
    sourceChapterRange: { from: 1, to: 12 },
  })
  // v1.0 多季字段往返：seasonNumber + sourceChapterRange(JSON) 解析正确
  const apReloaded = repos.adaptationProject.getAdaptationProject(repos.db, ap.id)
  assert(apReloaded?.seasonNumber === 1, 'createAdaptationProject seasonNumber 写回')
  assert(
    !!apReloaded?.sourceChapterRange &&
      apReloaded.sourceChapterRange.from === 1 &&
      apReloaded.sourceChapterRange.to === 12,
    'createAdaptationProject sourceChapterRange(JSON) 解析',
  )
  // 默认值：不传 season 时为 1、每集时长默认 2 分钟
  const apDef = repos.adaptationProject.createAdaptationProject(repos.db, {
    title: '默认季测试',
    targetEpisodeCount: 60,
    adaptationStyle: '快节奏爽剧',
  })
  assert(apDef.seasonNumber === 1 && apDef.episodeDuration === '2分钟', '改编项目默认：seasonNumber=1 / episodeDuration=2分钟')
  const ep1 = repos.episode.createEpisode(repos.db, {
    adaptationProjectId: ap.id,
    episodeNumber: 1,
    title: '归来',
    summary: '女主归来',
    hook: '暴雨夜回归',
    mainConflict: '与继母对峙',
    cliffhanger: '身份曝光',
  })
  const ep2 = repos.episode.createEpisode(repos.db, {
    adaptationProjectId: ap.id,
    episodeNumber: 2,
    title: '交锋',
    summary: '交锋',
    hook: '会议室',
    mainConflict: '夺权',
    cliffhanger: '反转',
  })
  assert(repos.episode.listEpisodes(repos.db, ap.id).length === 2, 'episode list = 2')

  const sc1 = repos.script.createScript(repos.db, {
    adaptationProjectId: ap.id,
    episodeId: ep1.id,
    episodeNumber: 1,
    title: ep1.title,
    content: '# 第 1 集：归来\n\n场景一…',
    hook: ep1.hook,
    cliffhanger: ep1.cliffhanger,
  })
  assert(!!sc1.id && repos.script.getScriptByEpisode(repos.db, ep1.id)?.id === sc1.id, 'createScript + getByEpisode')
  assert(repos.script.listScripts(repos.db, ap.id).length === 1, 'listScripts = 1')

  // upsert：同集再写一次应更新而非新建
  const sc1b = repos.script.upsertScriptByEpisode(repos.db, {
    adaptationProjectId: ap.id,
    episodeId: ep1.id,
    episodeNumber: 1,
    title: ep1.title,
    content: '# 第 1 集：归来（改）',
    cliffhanger: '新悬念',
  })
  assert(sc1b.id === sc1.id && repos.script.listScripts(repos.db, ap.id).length === 1, 'upsertScriptByEpisode 覆盖同一集')
  assert(repos.script.getScriptByEpisode(repos.db, ep1.id)?.content.includes('（改）'), 'upsert 内容写回')

  const sc1c = repos.script.updateScriptContent(repos.db, sc1.id, '# 第 1 集（编辑器保存）')
  assert(sc1c?.content === '# 第 1 集（编辑器保存）', 'updateScriptContent 写回')

  // 场景
  const scene1 = repos.scene.createScene(repos.db, {
    scriptId: sc1.id,
    episodeId: ep1.id,
    sceneNumber: 1,
    title: '暴雨夜',
    location: '林家大宅门口',
    timeOfDay: '夜',
    visualDescription: '暴雨中女主撑伞',
    characters: ['林晚', '继母'],
    summary: '女主归来与继母对峙',
    orderIndex: 0,
  })
  const scene2 = repos.scene.createScene(repos.db, {
    scriptId: sc1.id,
    episodeId: ep1.id,
    sceneNumber: 2,
    title: '客厅',
    location: '林家客厅',
    summary: '身份曝光',
    orderIndex: 1,
  })
  assert(repos.scene.listScenesByScript(repos.db, sc1.id).length === 2, 'createScene + listScenesByScript = 2')
  assert((repos.scene.listScenesByScript(repos.db, sc1.id)[0].characters.length === 2), 'scene characters 数组解析正确')
  const sceneUpd = repos.scene.updateScene(repos.db, scene1.id, { characters: ['林晚', '继母', '管家'] })
  assert(sceneUpd?.characters.length === 3, 'updateScene characters 写回')
  repos.scene.deleteScenesByScript(repos.db, sc1.id)
  assert(repos.scene.listScenesByScript(repos.db, sc1.id).length === 0, 'deleteScenesByScript 清空')
  // 恢复一条用于级联验证
  const sceneKeep = repos.scene.createScene(repos.db, {
    scriptId: sc1.id,
    episodeId: ep1.id,
    sceneNumber: 1,
    title: '暴雨夜',
    location: '林家大宅门口',
    summary: '女主归来',
    orderIndex: 0,
  })

  // v0.6 镜头 + 审查 + Prompt 版本（CRUD / upsert / 级联）
  const sh1 = repos.shot.createShot(repos.db, {
    sceneId: sceneKeep.id,
    episodeId: ep1.id,
    shotNumber: 1,
    visualDescription: '暴雨中女主撑伞特写',
    characterIds: ['林晚'],
    cameraAngle: '特写',
    cameraMovement: '推镜头',
    emotion: '决绝',
    durationSeconds: 4,
  })
  const sh2 = repos.shot.createShot(repos.db, {
    sceneId: sceneKeep.id,
    episodeId: ep1.id,
    shotNumber: 2,
    visualDescription: '继母推门震惊中景',
    characterIds: ['继母'],
    cameraAngle: '中景',
  })
  assert(repos.shot.listShotsByScene(repos.db, sceneKeep.id).length === 2, 'createShot + listShotsByScene = 2')
  assert(repos.shot.listShotsByEpisode(repos.db, ep1.id).length === 2, 'listShotsByEpisode = 2')
  assert((repos.shot.getShot(repos.db, sh1.id)?.characterIds.length === 1), 'shot characterIds 数组解析')
  const shUpd = repos.shot.updateShot(repos.db, sh1.id, {
    videoPrompt: 'close-up of a woman holding an umbrella in heavy rain, 9:16',
    negativePrompt: 'extra fingers, blurry',
    aiVideoDifficulty: 'low',
  })
  assert(shUpd?.videoPrompt.includes('umbrella') && shUpd.aiVideoDifficulty === 'low', 'updateShot Prompt + 难度写回')

  // Prompt 版本：append 递增
  const pv1 = repos.shot.appendPromptVersion(repos.db, {
    shotId: sh1.id,
    taskType: 'generate_shot_prompt',
    videoPrompt: 'v1 prompt',
  })
  const pv2 = repos.shot.appendPromptVersion(repos.db, {
    shotId: sh1.id,
    taskType: 'rewrite_shot_prompt',
    videoPrompt: 'v2 prompt',
    note: '增强画面感',
  })
  assert(pv1.version === 1 && pv2.version === 2, 'appendPromptVersion 版本号递增 1→2')
  assert(repos.shot.listPromptVersions(repos.db, sh1.id).length === 2, 'listPromptVersions = 2')

  // 镜头审查 upsert
  const srv1 = repos.shotReview.upsertShotReview(repos.db, {
    shotId: sh1.id,
    lengthScore: 80,
    characterCountScore: 90,
    actionComplexityScore: 75,
    visualClarityScore: 85,
    characterConsistencyScore: 70,
    sceneContinuityScore: 80,
    promptControllabilityScore: 88,
    verticalSuitabilityScore: 92,
    overallScore: 82,
    aiVideoDifficulty: 'low',
    issues: ['光线偏暗'],
    suggestions: ['补一盏轮廓光'],
  })
  assert(srv1?.id === repos.shotReview.getShotReview(repos.db, sh1.id)?.id, 'upsertShotReview + get')
  assert((repos.shotReview.getShotReview(repos.db, sh1.id)?.aiVideoDifficulty === 'low'), 'shotReview 难度解析')
  const srv1b = repos.shotReview.upsertShotReview(repos.db, {
    shotId: sh1.id,
    overallScore: 60,
    aiVideoDifficulty: 'medium',
    issues: ['a', 'b'],
    suggestions: [],
  })
  assert(srv1b.id === srv1.id && srv1b.overallScore === 60 && srv1b.aiVideoDifficulty === 'medium', 'upsertShotReview 覆盖同一镜头')

  // 场景级联：删除场景 → 其镜头/审查/版本随之清空
  repos.scene.deleteScene(repos.db, sceneKeep.id)
  assert(repos.shot.listShotsByScene(repos.db, sceneKeep.id).length === 0, '级联：场景删后镜头已删')
  assert(repos.shotReview.getShotReview(repos.db, sh1.id) === undefined, '级联：场景删后镜头审查已删')
  assert(repos.shot.listPromptVersions(repos.db, sh1.id).length === 0, '级联：场景删后 Prompt 版本已删')
  // 恢复一个场景 + 镜头，用于改编项目级联验证
  const sceneKeep2 = repos.scene.createScene(repos.db, {
    scriptId: sc1.id,
    episodeId: ep1.id,
    sceneNumber: 1,
    title: '暴雨夜',
    location: '林家大宅门口',
    summary: '女主归来',
    orderIndex: 0,
  })
  const shKeep = repos.shot.createShot(repos.db, {
    sceneId: sceneKeep2.id,
    episodeId: ep1.id,
    shotNumber: 1,
    visualDescription: '女主归来特写',
  })

  // v0.7 视频生成 Provider 配置 + 任务 + 结果（CRUD / 默认 / 择优 / 级联）
  const vpc1 = repos.videoProviderConfig.createVideoProviderConfig(repos.db, {
    name: 'Mock 视频',
    kind: 'mock',
    isDefault: true,
  })
  const vpc2 = repos.videoProviderConfig.createVideoProviderConfig(repos.db, {
    name: '可灵',
    kind: 'kling',
    baseUrl: 'https://api.kling.com/v1',
    apiKey: 'k-xxx',
    model: 'kling-v2',
  })
  assert(repos.videoProviderConfig.listVideoProviderConfigs(repos.db).length === 2, 'createVideoProviderConfig + list = 2')
  assert(repos.videoProviderConfig.getDefaultVideoProviderConfig(repos.db)?.id === vpc1.id, '默认视频 Provider = vpc1')
  // 切默认
  repos.videoProviderConfig.setDefaultVideoProviderConfig(repos.db, vpc2.id)
  assert(repos.videoProviderConfig.getDefaultVideoProviderConfig(repos.db)?.id === vpc2.id, '切默认后 = vpc2')
  const vpcUpd = repos.videoProviderConfig.updateVideoProviderConfig(repos.db, vpc2.id, { model: 'kling-v2.1' })
  assert(vpcUpd?.model === 'kling-v2.1', 'updateVideoProviderConfig 写回')

  // 任务
  const vt1 = repos.videoTask.createVideoTask(repos.db, {
    provider: vpc2.name,
    model: vpc2.model ?? 'default',
    projectId: p1.id,
    episodeId: ep1.id,
    sceneId: sceneKeep2.id,
    shotId: shKeep.id,
    prompt: '女主撑伞特写 9:16',
    negativePrompt: 'extra fingers',
    referenceImageUrls: ['https://img.local/a.jpg'],
    status: 'pending',
    note: '版本A',
  })
  assert(!!vt1.id && repos.videoTask.getVideoTask(repos.db, vt1.id)?.id === vt1.id, 'createVideoTask + get')
  assert(repos.videoTask.listVideoTasksByShot(repos.db, shKeep.id).length === 1, 'listVideoTasksByShot = 1')
  assert((repos.videoTask.getVideoTask(repos.db, vt1.id)?.referenceImageUrls.length === 1), 'task referenceImageUrls 数组解析')
  const vt1b = repos.videoTask.updateVideoTask(repos.db, vt1.id, { status: 'success', remoteTaskId: 'rmt-1' })
  assert(vt1b?.status === 'success' && vt1b.remoteTaskId === 'rmt-1', 'updateVideoTask status/remoteTaskId 写回')
  // 同镜头第二个任务（用于对比/择优）
  const vt2 = repos.videoTask.createVideoTask(repos.db, {
    provider: vpc2.name,
    model: vpc2.model ?? 'default',
    shotId: shKeep.id,
    prompt: '女主撑伞特写 9:16',
    status: 'pending',
    note: '版本B',
  })
  assert(repos.videoTask.listVideoTasksByShot(repos.db, shKeep.id).length === 2, '同镜头多任务 = 2')

  // 结果（一个任务可多个；跨任务对比）
  const vrA = repos.videoResult.createVideoResult(repos.db, {
    taskId: vt1.id,
    shotId: shKeep.id,
    resultVideoUrl: 'https://v.local/v1a.mp4',
    coverImageUrl: 'https://v.local/v1a.jpg',
  })
  const vrB = repos.videoResult.createVideoResult(repos.db, {
    taskId: vt2.id,
    shotId: shKeep.id,
    resultVideoUrl: 'https://v.local/v1b.mp4',
  })
  assert(repos.videoResult.listVideoResultsByShot(repos.db, shKeep.id).length === 2, 'createVideoResult + listByShot = 2')
  assert(repos.videoResult.listVideoResultsByTask(repos.db, vt1.id).length === 1, 'listVideoResultsByTask = 1')
  // 择优：标记 vrB 为最佳，应自动取消同镜头其它最佳
  const bestB = repos.videoResult.markBestVideoResult(repos.db, vrB.id)
  assert(bestB?.isBest === true, 'markBestVideoResult 置最佳')
  assert(repos.videoResult.listVideoResultsByShot(repos.db, shKeep.id).find((r) => r.id === vrA.id)?.isBest === false, '择优后旧最佳被取消（镜头级唯一）')
  // 切回 vrA 最佳
  repos.videoResult.markBestVideoResult(repos.db, vrA.id)
  assert(repos.videoResult.listVideoResultsByShot(repos.db, shKeep.id).find((r) => r.id === vrA.id)?.isBest === true, '再次择优切回 vrA')

  // v1.1 创意诊断与反套路迭代系统
  const caseStudy = repos.creative.createCaseStudy(repos.db, {
    title: '复仇结构样本',
    genre: '女频复仇',
    openingHooks: ['雨夜归来'],
    highlightBeats: ['身份揭露', '会议室反杀'],
    reversalMechanisms: ['反派其实被规则裹挟'],
    riskTags: ['复仇套路化'],
  })
  assert(caseStudy.openingHooks.length === 1 && repos.creative.listCaseStudies(repos.db).length >= 1, 'creative caseStudy CRUD/数组解析')
  const fresh = repos.creative.createFreshnessReport(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    originalityScore: 70,
    predictabilityScore: 80,
    tropeRiskScore: 75,
    characterFreshnessScore: 65,
    conflictFreshnessScore: 60,
    reversalFreshnessScore: 70,
    emotionalFreshnessScore: 68,
    overallScore: 66,
    clicheSignals: ['重生复仇开局常见'],
    audiencePredictionPoints: ['观众会猜到身份揭露'],
    suggestions: ['把复仇对象改成规则系统'],
  })
  assert(repos.creative.listFreshnessReportsByTarget(repos.db, 'chapter', c1.id)[0]?.id === fresh.id, 'freshness report 按 target 查询')
  const variant = repos.creative.createAntiTropeVariant(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    mode: 'balanced',
    title: '规则反派版',
    premise: '复仇对象不是人，而是家族规则。',
    pressureMechanism: '每次爽赢都会暴露一个盟友。',
    preservedPayoffs: ['反杀', '身份揭露'],
    keyChanges: ['反派从脸谱人变成规则执行者'],
    risks: ['理解门槛略高'],
  })
  assert(repos.creative.listAntiTropeVariantsByTarget(repos.db, 'chapter', c1.id)[0]?.id === variant.id, 'antiTrope variant 按 target 查询')
  const task = repos.creative.createRevisionTask(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    title: '替换老套复仇对象',
    description: '把单一恶人改成规则压力。',
    priority: 'must',
    suggestedAction: '重写冲突来源，保留身份揭露爽点。',
    expectedBenefit: { retention: 80, freshness: 90, visual: 60, cost: 70 },
  })
  const taskUpd = repos.creative.updateRevisionTask(repos.db, task.id, { status: 'accepted' })
  assert(taskUpd?.status === 'accepted' && taskUpd.expectedBenefit.freshness === 90, 'revisionTask 状态/收益 JSON 写回')
  const version = repos.creative.createContentVersion(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    label: '手动检查点',
    source: 'manual_checkpoint',
    content: cUpd?.content ?? '',
  })
  assert(repos.creative.listContentVersionsByTarget(repos.db, 'chapter', c1.id)[0]?.id === version.id, 'contentVersion 按 target 查询')
  assert(repos.creative.getContentVersion(repos.db, version.id)?.id === version.id, 'contentVersion 按 id 查询')
  const gate = repos.creative.createQualityGateReport(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    stage: 'novel_to_adaptation',
    score: 58,
    verdict: 'block',
    blockingIssues: ['开场太可预判'],
    warnings: [],
    suggestions: ['先做反套路改造'],
  })
  assert(repos.creative.listQualityGateReports(repos.db, p1.id)[0]?.id === gate.id, 'qualityGate report 写回')
  const audience = repos.creative.createAudienceSimulation(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    audienceProfile: '女频复仇短剧观众',
    retentionScore: 72,
    emotionalEngagementScore: 80,
    noveltyScore: 55,
    likelyDropOffPoints: ['复仇动机解释过长'],
    mostMemorableMoments: ['身份揭露'],
    complaints: ['像看过'],
    shareableClips: ['会议室反杀'],
    summary: '爽点够，但新鲜度不足。',
  })
  assert(repos.creative.listAudienceSimulations(repos.db, p1.id)[0]?.id === audience.id, 'audienceSimulation 写回')
  const curve = repos.creative.createNarrativeCurveReport(repos.db, {
    projectId: p1.id,
    targetKind: 'chapter',
    targetId: c1.id,
    hookCurve: [80, 60],
    conflictCurve: [70, 75],
    reversalCurve: [40, 90],
    emotionCurve: [65, 85],
    cliffhangerCurve: [50, 88],
    freshnessCurve: [55, 72],
    summary: '中段钩子下滑。',
    weakSpots: ['第二段铺垫偏长'],
  })
  assert(repos.creative.listNarrativeCurveReports(repos.db, p1.id)[0]?.id === curve.id, 'narrativeCurve report 写回')
  const wf = repos.creative.createWorkflowRun(repos.db, {
    projectId: p1.id,
    templateKey: 'chapter_anti_trope_revision',
    title: '章节反套路修稿',
    status: 'success',
    steps: [{ key: 'analyze_trope_freshness', label: '新鲜度', taskType: 'analyze_trope_freshness', status: 'success' }],
  })
  assert(repos.creative.listWorkflowRuns(repos.db, p1.id)[0]?.id === wf.id, 'workflowRun steps JSON 写回')

  // 审稿 upsert
  const rv1 = repos.scriptReview.upsertScriptReview(repos.db, {
    scriptId: sc1.id,
    hookStrengthScore: 80,
    dialogueScore: 70,
    conflictScore: 85,
    visualClarityScore: 60,
    sceneClarityScore: 75,
    characterFitScore: 90,
    shotReadinessScore: 65,
    aiVideoFeasibilityScore: 55,
    cliffhangerScore: 88,
    overallScore: 74,
    issues: ['开场略慢'],
    suggestions: ['前置冲突'],
  })
  assert(rv1?.id === repos.scriptReview.getScriptReview(repos.db, sc1.id)?.id, 'upsertScriptReview + get')
  assert((repos.scriptReview.getScriptReview(repos.db, sc1.id)?.issues.length === 1), 'scriptReview issues 数组解析')
  const rv1b = repos.scriptReview.upsertScriptReview(repos.db, {
    scriptId: sc1.id,
    overallScore: 90,
    issues: ['a', 'b'],
    suggestions: [],
  })
  assert(rv1b.id === rv1.id && rv1b.overallScore === 90 && rv1b.issues.length === 2, 'upsertScriptReview 覆盖同一剧本')

  // 级联：删除改编项目 → 其剧本/场景/审稿/镜头随之清空
  repos.adaptationProject.deleteAdaptationProject(repos.db, ap.id)
  assert(repos.script.listScripts(repos.db, ap.id).length === 0, '级联：剧本已删')
  assert(repos.scene.listScenesByScript(repos.db, sc1.id).length === 0, '级联：场景已删')
  assert(repos.scriptReview.getScriptReview(repos.db, sc1.id) === undefined, '级联：审稿已删')
  assert(repos.shot.listShotsByScene(repos.db, sceneKeep2.id).length === 0, '级联：镜头已删')
  assert(repos.shot.getShot(repos.db, shKeep.id) === undefined, '级联：镜头记录已删')

  // 级联删除：删项目后，其章节/人物/大纲/评分/ai_runs 都应消失
  repos.project.deleteProject(repos.db, p1.id)
  assert(repos.project.getProject(repos.db, p1.id) === undefined, 'deleteProject 后项目不存在')
  assert(repos.chapter.listChapters(repos.db, p1.id).length === 0, '级联：章节已删')
  assert(repos.character.listCharacters(repos.db, p1.id).length === 0, '级联：人物已删')
  assert(repos.aiRun.listAiRunsByProject(repos.db, p1.id).length === 0, '级联：ai_runs 已删')
  assert(repos.project.listProjects(repos.db).length === 1, '另一项目仍在')

  // 持久性：重新打开同一文件
  const { db: db2 } = createDb(dbPath)
  const repos2 = createRepositories(db2)
  assert(repos2.project.listProjects(repos2.db).length === 1, '重新打开数据库：项目持久化')
  assert(repos2.modelConfig.listModelConfigs(repos2.db).length === 2, '重新打开数据库：模型配置持久化')
  assert(repos2.videoProviderConfig.listVideoProviderConfigs(repos2.db).length === 2, '重新打开数据库：视频 Provider 持久化')
  assert(repos2.videoTask.listVideoTasks(repos2.db).length === 2, '重新打开数据库：视频任务持久化')

  // v1.0 数据安全：WAL 模式下生成可独立打开的一致性备份
  backupSqliteDatabase(dbPath, backupPath)
  const { db: backupDb } = createDb(backupPath)
  const backupRepos = createRepositories(backupDb)
  assert(backupRepos.project.listProjects(backupRepos.db).length === 1, '一致性备份：项目可恢复读取')
  assert(backupRepos.videoTask.listVideoTasks(backupRepos.db).length === 2, '一致性备份：视频任务可恢复读取')
  smokeBackupRestore()

  // v0.7 显式清理（video_* 表无 FK，手动验证删除）
  repos.videoResult.deleteVideoResultsByTask(repos.db, vt1.id)
  assert(repos.videoResult.listVideoResultsByTask(repos.db, vt1.id).length === 0, 'deleteVideoResultsByTask 清空')
  repos.videoTask.deleteVideoTask(repos.db, vt1.id)
  assert(repos.videoTask.getVideoTask(repos.db, vt1.id) === undefined, 'deleteVideoTask')
  repos.videoProviderConfig.deleteVideoProviderConfig(repos.db, vpc1.id)
  assert(repos.videoProviderConfig.listVideoProviderConfigs(repos.db).length === 1, 'deleteVideoProviderConfig')

  // v0.8 多 Agent 编剧室与模板系统（CRUD + 内置 seed 幂等 + JSON 数组往返）
  // Agent：内置 seed 幂等（跑两次不翻倍）
  const seeded1 = repos.agentProfile.upsertBuiltInAgentProfiles(repos.db, BUILT_IN_AGENTS)
  const seeded2 = repos.agentProfile.upsertBuiltInAgentProfiles(repos.db, BUILT_IN_AGENTS)
  assert(seeded1.length === BUILT_IN_AGENTS.length, 'upsertBuiltInAgentProfiles 首次 seed 数量正确')
  assert(seeded2.length === BUILT_IN_AGENTS.length, '内置 Agent seed 幂等：第二次不翻倍')
  assert(repos.agentProfile.listAgentProfiles(repos.db).length === BUILT_IN_AGENTS.length, 'agent list 数量 = 内置数')
  const chief = repos.agentProfile.getAgentProfileByRole(repos.db, 'chief_editor')
  assert(!!chief && chief.builtIn === true, 'getAgentProfileByRole + builtIn 标记')
  // 自定义 Agent
  const myAgent = repos.agentProfile.createAgentProfile(repos.db, {
    name: '节奏审查员',
    role: 'pace_reviewer',
    systemPrompt: '关注节奏。',
  })
  assert(repos.agentProfile.listAgentProfiles(repos.db).length === BUILT_IN_AGENTS.length + 1, '自定义 Agent 已新增')
  const myAgentUpd = repos.agentProfile.updateAgentProfile(repos.db, myAgent.id, { systemPrompt: '关注节奏与拖沓。' })
  assert(myAgentUpd?.systemPrompt.includes('拖沓'), 'updateAgentProfile 写回')
  repos.agentProfile.deleteAgentProfile(repos.db, myAgent.id)
  assert(repos.agentProfile.getAgentProfile(repos.db, myAgent.id) === undefined, 'deleteAgentProfile（自定义）')
  assert(repos.agentProfile.listAgentProfiles(repos.db).length === BUILT_IN_AGENTS.length, '删除自定义后仅剩内置')

  // 模板：内置 seed 幂等 + 变量数组往返
  const tseeded = repos.template.upsertBuiltInTemplates(repos.db, BUILT_IN_TEMPLATES)
  assert(tseeded.length === BUILT_IN_TEMPLATES.length, 'upsertBuiltInTemplates 数量正确')
  const firstTpl = tseeded[0]
  assert(firstTpl.variables.length > 0, '内置模板变量数组解析正确')
  assert(firstTpl.scope === 'generate_project', '内置模板 scope 解析')
  // 自定义模板 + 变量写回
  const myTpl = repos.template.createTemplate(repos.db, {
    name: '我的项目模板',
    type: 'project',
    content: '生成{{count}}章，主题：{{theme}}',
    variables: ['count', 'theme'],
  })
  assert(repos.template.getTemplate(repos.db, myTpl.id)?.variables.length === 2, 'createTemplate variables 往返')
  const myTplUpd = repos.template.updateTemplate(repos.db, myTpl.id, { variables: ['count', 'theme', 'tone'] })
  assert(myTplUpd?.variables.length === 3, 'updateTemplate variables 写回')
  assert(repos.template.listTemplatesByType(repos.db, 'project').length >= 2, 'listTemplatesByType')

  // 类型库：内置 seed 幂等 + 字符串数组往返
  const gseeded = repos.genrePreset.upsertBuiltInGenrePresets(repos.db, BUILT_IN_GENRE_PRESETS)
  assert(gseeded.length === BUILT_IN_GENRE_PRESETS.length, 'upsertBuiltInGenrePresets 数量正确')
  const fuchou = repos.genrePreset.getGenrePresetByName(repos.db, '女频复仇')
  assert(!!fuchou && fuchou.commonHighlights.length > 0 && fuchou.builtIn === true, 'getGenrePresetByName + 数组/builtIn 解析')
  // 自定义类型预设
  const myGenre = repos.genrePreset.createGenrePreset(repos.db, {
    name: '职场逆袭',
    visualStyle: '现代都市短剧，明亮偏暖',
    shotPromptAdvice: '多用办公场景中景',
    aiVideoRisks: '办公室群像角色一致性压力',
    commonHighlights: ['逆袭', '打脸'],
    commonReversals: ['上司另有背景'],
  })
  assert(repos.genrePreset.getGenrePreset(repos.db, myGenre.id)?.commonHighlights.length === 2, 'createGenrePreset 数组往返')
  const myGenreUpd = repos.genrePreset.updateGenrePreset(repos.db, myGenre.id, { commonHighlights: ['逆袭', '打脸', '反杀'] })
  assert(myGenreUpd?.commonHighlights.length === 3, 'updateGenrePreset 数组写回')

  // 模板运行记录
  const tr1 = repos.templateRun.createTemplateRun(repos.db, {
    templateId: myTpl.id,
    projectId: p2.id,
    scope: 'generate_project',
    renderedContent: '生成3章，主题：复仇',
    variables: { count: '3', theme: '复仇' },
  })
  assert(!!tr1.id && repos.templateRun.listTemplateRunsByTemplate(repos.db, myTpl.id).length === 1, 'createTemplateRun + listByTemplate')
  assert((repos.templateRun.listTemplateRunsByTemplate(repos.db, myTpl.id)[0]?.variables['count'] === '3'), 'templateRun variables(JSON) 解析')
  // aiRunId 回填
  const tr1b = repos.templateRun.attachAiRunToTemplateRun(repos.db, tr1.id, run.id)
  assert(tr1b?.aiRunId === run.id, 'attachAiRunToTemplateRun 写回')

  // v1.0 模型配置增强：按任务组绑定（task_model_bindings，每任务组唯一）
  const b1 = repos.taskModelBinding.upsertTaskModelBinding(repos.db, { taskGroup: 'writing', modelConfigId: m.id })
  assert(!!b1.id && b1.taskGroup === 'writing', 'upsertTaskModelBinding 新建')
  const b1b = repos.taskModelBinding.upsertTaskModelBinding(repos.db, { taskGroup: 'writing', modelConfigId: m2.id })
  assert(b1b.id === b1.id && b1b.modelConfigId === m2.id, 'upsertTaskModelBinding 覆盖同组（唯一）')
  assert(repos.taskModelBinding.getTaskModelBinding(repos.db, 'writing')?.modelConfigId === m2.id, 'getTaskModelBinding')
  assert(repos.taskModelBinding.listTaskModelBindings(repos.db).length === 1, 'listTaskModelBindings = 1（同组不重复）')
  repos.taskModelBinding.deleteTaskModelBinding(repos.db, 'writing')
  assert(repos.taskModelBinding.getTaskModelBinding(repos.db, 'writing') === undefined, 'deleteTaskModelBinding')

  // v1.0 ai_runs 汇总（summarizeAiRuns）—— 用一个独立 ai_run（p1 已被级联删除，故挂 p2）
  const runForSum = repos.aiRun.createAiRun(repos.db, {
    projectId: p2.id, graphName: 'novel-workflow', type: 'generate_chapter',
    provider: 'openai', model: 'gpt-4o', input: '{}', output: '正文', status: 'success', latencyMs: 200,
  })
  void runForSum
  const summary = repos.aiRun.summarizeAiRuns(repos.db)
  const runRow = summary.find((r) => r.model === 'gpt-4o')
  assert(!!runRow && runRow.successCount >= 1, 'summarizeAiRuns 按模型聚合成功次数')
  assert(runRow?.totalLatencyMs >= 200, 'summarizeAiRuns 耗时聚合')

  // v1.0 完整项目包导出/导入往返（ROADMAP v1.0-2）
  // 先准备一个有数据的项目 p3
  const p3 = repos.project.createProject(db, { title: '导出测试项目', shortDramaType: '女频复仇' })
  const c3 = repos.character.createCharacter(db, { projectId: p3.id, name: '女主A', role: '主角', identity: '重生者' })
  const ch3 = repos.chapter.createChapter(db, { projectId: p3.id, title: '第1章', chapterNumber: 1, content: '正文内容' })
  repos.chapter.updateChapterContent(db, ch3.id, '正文内容')
  repos.creative.createFreshnessReport(db, {
    projectId: p3.id,
    targetKind: 'chapter',
    targetId: ch3.id,
    originalityScore: 80,
    predictabilityScore: 40,
    tropeRiskScore: 30,
    characterFreshnessScore: 70,
    conflictFreshnessScore: 75,
    reversalFreshnessScore: 82,
    emotionalFreshnessScore: 78,
    overallScore: 79,
    clicheSignals: [],
    audiencePredictionPoints: [],
    suggestions: ['保持反派动机复杂度'],
  })
  repos.creative.createContentVersion(db, {
    projectId: p3.id,
    targetKind: 'chapter',
    targetId: ch3.id,
    label: '导出前检查点',
    source: 'manual_checkpoint',
    content: '正文内容',
  })
  const pkg = collectProjectPackage(repos, p3.id)
  assert(pkg.project.id === p3.id, 'collectProjectPackage 项目正确')
  assert(pkg.characters.length === 1 && pkg.characters[0].name === '女主A', 'collectProjectPackage 人物正确')
  assert(pkg.chapters.length === 1 && (pkg.chapters[0].content ?? '').includes('正文'), 'collectProjectPackage 章节+正文')
  assert(pkg.meta.version === 2, 'collectProjectPackage 版本 = 2')
  assert(pkg.freshnessReports.length === 1 && pkg.contentVersions.length === 1, 'collectProjectPackage 创意诊断数据')
  // 序列化 → 解析往返
  const content = serializeProjectPackage(pkg)
  const reParsed = parseProjectPackage(content)
  assert(reParsed.meta.format === 'sdns-project-package', 'parseProjectPackage 格式校验')
  // 导入 → 新项目（id 重映射，关联正确还原）
  const imported = importProjectPackage(repos, content)
  assert(imported.id !== p3.id, 'importProjectPackage 生成新项目 id')
  assert(imported.title.includes('导入'), 'importProjectPackage 标题加后缀')
  const importedChars = repos.character.listCharacters(db, imported.id)
  assert(importedChars.length === 1 && importedChars[0].name === '女主A', 'importProjectPackage 人物外键还原')
  const importedChapters = repos.chapter.listChapters(db, imported.id)
  assert(importedChapters.length === 1, 'importProjectPackage 章节还原')
  assert((importedChapters[0].content ?? '').includes('正文'), 'importProjectPackage 章节正文还原')
  assert(repos.creative.listFreshnessReports(db, imported.id).length === 1, 'importProjectPackage 新鲜度报告还原')
  assert(repos.creative.listContentVersionsByTarget(db, 'chapter', importedChapters[0].id).length === 1, 'importProjectPackage 内容版本还原')
  // 导入项目的旧 id 不应残留（外键已重映射到新项目）
  assert(repos.character.getCharacter(db, c3.id)?.projectId === p3.id, '导入不影响原项目数据')

  console.log(failures === 0 ? '\n✅ DB SMOKE OK' : `\n❌ DB SMOKE FAILED（${failures} 项）`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
