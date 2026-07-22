import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  AdaptationProject,
  Character,
  Episode,
  EpisodeAnalysis,
  Project,
  Scene,
  Script,
  ScriptReview,
  Shot,
  ShotReview,
  VideoGenerationTask,
  VideoResult,
} from '../packages/core/src'
import {
  buildDramaEpisodeDeliveryPackage,
  buildDramaProposalPackage,
  DRAMA_EPISODE_DELIVERY_PACKAGE_FORMAT,
  DRAMA_PROPOSAL_PACKAGE_FORMAT,
  DRAMA_SHOT_DELIVERY_PACKAGE_FORMAT,
  exportDramaEpisodeDeliveryJson,
  exportDramaEpisodeDeliveryMarkdown,
  exportDramaProposalMarkdown,
  exportDramaShotDeliveryCsv,
  exportDramaShotDeliveryJson,
  type DramaDeliveryExportData,
} from '../packages/export/src'

const now = '2026-01-01T00:00:00.000Z'

const project: Project = {
  id: 'p1',
  title: '重生后我拍爆短剧',
  shortDramaType: '重生逆袭',
  targetAudience: '18-35 岁短剧用户',
  targetEpisodeCount: 24,
  coreHook: '她重回开机当天，用未来爆款公式逆转全网嘲笑。',
  emotionalCore: '从被否定到掌控创作命运',
  coreSellingPoint: '娱乐圈复仇、爆款制作、公开打脸',
  synopsis: '女主前世被夺创意，重生后从第一场戏开始反击。',
  styleGuide: '对白短促，冲突密集。',
  visualStyleDirection: '都市片场、竖屏强反应',
  createdAt: now,
  updatedAt: now,
}

const adaptation: AdaptationProject = {
  id: 'a1',
  sourceProjectId: 'p1',
  title: '爆款开机日',
  targetEpisodeCount: 24,
  episodeDuration: '2 分钟',
  adaptationStyle: '快节奏竖屏爽剧',
  visualStyleDirection: '高对比片场灯光',
  audience: '都市女性短剧用户',
  strategy: '前三集连续打脸。',
  createdAt: now,
  updatedAt: now,
}

const characters: Character[] = [
  {
    id: 'char-1',
    projectId: 'p1',
    name: '许知夏',
    role: '女主',
    identity: '重生短剧制作人',
    personality: '冷静、敏锐',
    desire: '夺回创意署名',
    arc: '从被动求生到主动操盘',
    shortDramaFunction: '推动反击爽点',
    visualDescription: '利落西装，片场对峙时目光锋利',
    appearancePrompt: 'vertical drama heroine, sharp suit',
    negativePrompt: 'blurred face',
    createdAt: now,
    updatedAt: now,
  },
]

const episodes: Episode[] = [
  episode(1, '开机日重生', '片场醒来当众反击', '雨夜追车，女主抓住被偷剧本'),
  episode(2, '围读翻盘', '围读会压制反派', '会议室长桌对峙'),
]

const episodeAnalysis: EpisodeAnalysis = {
  id: 'ea1',
  adaptationProjectId: 'a1',
  hookStrengthTrend: [90, 86, 84, 82, 80, 79, 78, 77, 76, 75, 74],
  retentionScoreTrend: [88, 85, 84, 83, 81, 80, 79, 78, 77, 76, 75],
  paceScoreTrend: [84, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75],
  reversalDensityTrend: [72, 76, 80, 78, 77, 76, 75, 74, 73, 72, 71],
  visualAppealTrend: [92, 88, 86, 85, 84, 83, 82, 81, 80, 79, 78],
  summary: '前 10 集留存稳定，第一集钩子最强。',
  suggestions: '第 4 集后补更明确的视觉爆点。',
  createdAt: now,
  updatedAt: now,
}

const scripts: Script[] = [
  {
    id: 's1',
    adaptationProjectId: 'a1',
    episodeId: 'e1',
    episodeNumber: 1,
    title: '开机日重生',
    content: '【片场】许知夏夺回剧本，反问导演谁敢开拍。',
    hook: '片场醒来',
    mainConflict: '署名被抢',
    emotionalBeat: '当众反击',
    cliffhanger: '反派拿出偷拍视频',
    estimatedDuration: '2 分钟',
    createdAt: now,
    updatedAt: now,
  },
]

const scenes: Scene[] = [
  {
    id: 'scene-1',
    scriptId: 's1',
    episodeId: 'e1',
    sceneNumber: 1,
    title: '片场雨夜',
    location: '外景片场',
    timeOfDay: '夜',
    visualDescription: '雨幕下的竖屏近景，灯光打在剧本封面上',
    characters: ['许知夏', '反派制片'],
    summary: '女主夺回剧本并公开质问。',
    orderIndex: 0,
    createdAt: now,
    updatedAt: now,
  },
]

const scriptReviews: ScriptReview[] = [
  {
    id: 'sr1',
    scriptId: 's1',
    hookStrengthScore: 88,
    dialogueScore: 82,
    conflictScore: 86,
    visualClarityScore: 76,
    sceneClarityScore: 80,
    characterFitScore: 84,
    shotReadinessScore: 70,
    aiVideoFeasibilityScore: 55,
    cliffhangerScore: 78,
    overallScore: 79,
    issues: ['雨夜动作复杂'],
    suggestions: ['拆成更短镜头'],
    createdAt: now,
    updatedAt: now,
  },
]

const shots: Shot[] = [
  {
    id: 'shot-1',
    sceneId: 'scene-1',
    episodeId: 'e1',
    shotNumber: 1,
    durationSeconds: 4,
    visualDescription: '女主手按剧本封面，镜头推近到署名',
    characterIds: ['许知夏'],
    cameraAngle: '特写',
    cameraMovement: '推镜头',
    emotion: '压迫',
    action: '按住剧本',
    dialogue: '这本子，是谁写的？',
    videoPrompt: 'vertical close-up, rain set, script cover, sharp lighting',
    negativePrompt: 'blurred face, extra fingers',
    consistencyNotes: '保持女主西装和湿发',
    aiVideoDifficulty: 'high',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'shot-2',
    sceneId: 'scene-1',
    episodeId: 'e1',
    shotNumber: 2,
    visualDescription: '反派制片后退，众人看向监视器',
    characterIds: ['反派制片'],
    videoPrompt: 'producer steps back, crew reaction, monitor glow',
    aiVideoDifficulty: 'medium',
    createdAt: now,
    updatedAt: now,
  },
]

const shotReviews: ShotReview[] = [
  {
    id: 'shr1',
    shotId: 'shot-1',
    lengthScore: 72,
    characterCountScore: 86,
    actionComplexityScore: 45,
    visualClarityScore: 70,
    characterConsistencyScore: 65,
    sceneContinuityScore: 78,
    promptControllabilityScore: 58,
    verticalSuitabilityScore: 84,
    overallScore: 52,
    aiVideoDifficulty: 'high',
    issues: ['雨夜和推镜头叠加，生成风险高'],
    suggestions: ['降低雨量，固定近景'],
    createdAt: now,
    updatedAt: now,
  },
]

const videoTasks: VideoGenerationTask[] = [
  {
    id: 'video-task-1',
    projectId: 'p1',
    episodeId: 'e1',
    sceneId: 'scene-1',
    shotId: 'shot-1',
    provider: 'mock',
    model: 'mock-v1',
    prompt: shots[0].videoPrompt,
    referenceImageUrls: [],
    status: 'success',
    createdAt: now,
    updatedAt: now,
  },
]

const videoResults: VideoResult[] = [
  {
    id: 'video-result-1',
    taskId: 'video-task-1',
    shotId: 'shot-1',
    resultVideoUrl: 'https://cdn.example.test/result.mp4',
    remoteVideoUrl: 'https://cdn.example.test/result.mp4',
    isBest: true,
    createdAt: now,
  },
]

const data: DramaDeliveryExportData = {
  project,
  adaptation,
  characters,
  episodes,
  episodeAnalysis,
  scripts,
  scenes,
  shots,
  scriptReviews,
  shotReviews,
  videoTasks,
  videoResults,
}

test('builds a short drama proposal package with first 10 analysis and video risks', () => {
  const pkg = buildDramaProposalPackage(data, { episodeLimit: 10, exportedAt: now })

  assert.equal(pkg.meta.format, DRAMA_PROPOSAL_PACKAGE_FORMAT)
  assert.equal(pkg.firstEpisodesAnalysis?.hookStrengthTrend.length, 10)
  assert.equal(pkg.episodeOutlines.length, 2)
  assert.equal(pkg.characters[0].name, '许知夏')
  assert.equal(pkg.videoRiskSummary.highRiskShots, 1)
  assert.equal(pkg.videoRiskSummary.lowFeasibilityScriptReviews, 1)

  const md = exportDramaProposalMarkdown(data, { episodeLimit: 10 })
  assert.match(md, /## 核心卖点/)
  assert.match(md, /## 分集大纲/)
  assert.match(md, /## 前 10 集分析/)
  assert.match(md, /前 10 集留存稳定/)
  assert.match(md, /## 视频风险/)
  assert.match(md, /雨夜动作复杂/)
})

test('exports episode delivery package with scripts, scenes, shots, and prompts', () => {
  const pkg = buildDramaEpisodeDeliveryPackage(data, { episodeLimit: 1, exportedAt: now })

  assert.equal(pkg.meta.format, DRAMA_EPISODE_DELIVERY_PACKAGE_FORMAT)
  assert.equal(pkg.episodes.length, 1)
  assert.equal(pkg.episodes[0].script?.id, 's1')
  assert.equal(pkg.episodes[0].scenes[0].shots[0].riskFlags.includes('AI 视频高难度'), true)
  assert.deepEqual(pkg.episodes[0].scenes[0].shots[0].bestVideo, {
    resultId: 'video-result-1',
    taskId: 'video-task-1',
    lineageId: undefined,
    source: 'result',
    url: 'https://cdn.example.test/result.mp4',
    archivedAt: undefined,
  })

  const md = exportDramaEpisodeDeliveryMarkdown(data, { episodeLimit: 1 })
  assert.match(md, /# 爆款开机日 · 分集交付包/)
  assert.match(md, /### 剧本审稿/)
  assert.match(md, /### 剧本正文/)
  assert.match(md, /视频 Prompt/)
  assert.match(md, /负面 Prompt/)
  assert.match(md, /最佳视频交付/)

  const json = JSON.parse(exportDramaEpisodeDeliveryJson(data, { episodeLimit: 1 })) as ReturnType<typeof buildDramaEpisodeDeliveryPackage>
  assert.equal(json.meta.format, DRAMA_EPISODE_DELIVERY_PACKAGE_FORMAT)
  assert.equal(json.episodes[0].scenes[0].shots.length, 2)
})

test('exports shot delivery json and csv for video production handoff', () => {
  const json = JSON.parse(exportDramaShotDeliveryJson(data, { episodeLimit: 1 }))
  assert.equal(json.meta.format, DRAMA_SHOT_DELIVERY_PACKAGE_FORMAT)
  assert.equal(json.scenes[0].shots[0].shot.negativePrompt, 'blurred face, extra fingers')

  const csv = exportDramaShotDeliveryCsv(data, { episodeLimit: 1 })
  assert.match(csv, /episodeNumber,episodeTitle,sceneNumber,sceneTitle/)
  assert.match(csv, /videoPrompt,negativePrompt,bestVideoSource,bestVideoUrl/)
  assert.match(csv, /"vertical close-up, rain set, script cover, sharp lighting"/)
  assert.match(csv, /"blurred face, extra fingers"/)
  assert.match(csv, /雨夜和推镜头叠加/)
  assert.match(csv, /https:\/\/cdn.example.test\/result.mp4/)
})

test('keeps shot delivery exports in persisted storyboard order', () => {
  const reorderedInput: DramaDeliveryExportData = { ...data, shots: [shots[1], shots[0]] }
  const json = JSON.parse(exportDramaShotDeliveryJson(reorderedInput, { episodeLimit: 1 })) as { scenes: Array<{ shots: Array<{ shot: Shot }> }> }
  assert.deepEqual(json.scenes[0].shots.map((item) => item.shot.id), ['shot-1', 'shot-2'])

  const csv = exportDramaShotDeliveryCsv(reorderedInput, { episodeLimit: 1 })
  assert.ok(csv.indexOf('女主手按剧本封面') < csv.indexOf('反派制片后退'))
})

function episode(episodeNumber: number, title: string, summary: string, aiVideoNote: string): Episode {
  return {
    id: `e${episodeNumber}`,
    adaptationProjectId: 'a1',
    episodeNumber,
    title,
    summary,
    hook: `${title} 钩子`,
    mainConflict: `${title} 冲突`,
    reversal: `${title} 反转`,
    emotionalBeat: `${title} 情绪爆点`,
    cliffhanger: `${title} 尾钩`,
    aiVideoNote,
    keyVisuals: ['竖屏近景', '强反应'],
    createdAt: now,
    updatedAt: now,
  }
}
