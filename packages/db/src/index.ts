export * from './client'
export * as schema from './schema'
export { INITIAL_SCHEMA_SQL } from './migrations'

export * as projectRepo from './repositories/project.repo'
export * as characterRepo from './repositories/character.repo'
export * as outlineRepo from './repositories/outline.repo'
export * as chapterRepo from './repositories/chapter.repo'
export * as evaluationRepo from './repositories/evaluation.repo'
export * as aiRunRepo from './repositories/ai-run.repo'
export * as aiBudgetRepo from './repositories/ai-budget.repo'
export * as longTaskRepo from './repositories/long-task.repo'
export * as modelConfigRepo from './repositories/model-config.repo'
// v0.2 长篇一致性与视觉记忆系统
export * as chapterMemoryRepo from './repositories/chapter-memory.repo'
export * as characterStateRepo from './repositories/character-state.repo'
export * as characterVisualProfileRepo from './repositories/character-visual-profile.repo'
export * as visualSettingRepo from './repositories/visual-setting.repo'
export * as storyEventRepo from './repositories/story-event.repo'
export * as foreshadowingRepo from './repositories/foreshadowing.repo'
// v0.3 AI 短剧小说强化系统
export * as beatRepo from './repositories/beat.repo'
export * as highlightRepo from './repositories/highlight-analysis.repo'
export * as feasibilityRepo from './repositories/ai-video-feasibility.repo'
export * as dramaTrendRepo from './repositories/drama-trend.repo'
// v0.4 改编分集大纲
export * as adaptationProjectRepo from './repositories/adaptation-project.repo'
export * as episodeRepo from './repositories/episode.repo'
export * as episodeAnalysisRepo from './repositories/episode-analysis.repo'
// v0.5 AI 短剧剧本生成
export * as scriptRepo from './repositories/script.repo'
export * as sceneRepo from './repositories/scene.repo'
export * as scriptReviewRepo from './repositories/script-review.repo'
// v0.6 分镜与镜头 Prompt 生成
export * as shotRepo from './repositories/shot.repo'
export * as shotReviewRepo from './repositories/shot-review.repo'
// v0.7 AI 视频平台对接
export * as videoProviderConfigRepo from './repositories/video-provider-config.repo'
export * as videoGenerationTaskRepo from './repositories/video-generation-task.repo'
export * as videoResultRepo from './repositories/video-result.repo'
// v0.8 多 Agent 编剧室与模板系统
export * as agentProfileRepo from './repositories/agent-profile.repo'
export * as templateRepo from './repositories/template.repo'
export * as genrePresetRepo from './repositories/genre-preset.repo'
export * as templateRunRepo from './repositories/template-run.repo'
// v1.0 模型配置增强
export * as taskModelBindingRepo from './repositories/task-model-binding.repo'
// v1.1 创意诊断与反套路迭代系统
export * as creativeRepo from './repositories/creative.repo'

// 也导出 repository 工厂：便于按 db 统一注入
import type { DB } from './client'
import * as projectRepo from './repositories/project.repo'
import * as characterRepo from './repositories/character.repo'
import * as outlineRepo from './repositories/outline.repo'
import * as chapterRepo from './repositories/chapter.repo'
import * as evaluationRepo from './repositories/evaluation.repo'
import * as aiRunRepo from './repositories/ai-run.repo'
import * as aiBudgetRepo from './repositories/ai-budget.repo'
import * as longTaskRepo from './repositories/long-task.repo'
import * as modelConfigRepo from './repositories/model-config.repo'
import * as chapterMemoryRepo from './repositories/chapter-memory.repo'
import * as characterStateRepo from './repositories/character-state.repo'
import * as characterVisualProfileRepo from './repositories/character-visual-profile.repo'
import * as visualSettingRepo from './repositories/visual-setting.repo'
import * as storyEventRepo from './repositories/story-event.repo'
import * as foreshadowingRepo from './repositories/foreshadowing.repo'
import * as beatRepo from './repositories/beat.repo'
import * as highlightRepo from './repositories/highlight-analysis.repo'
import * as feasibilityRepo from './repositories/ai-video-feasibility.repo'
import * as dramaTrendRepo from './repositories/drama-trend.repo'
import * as adaptationProjectRepo from './repositories/adaptation-project.repo'
import * as episodeRepo from './repositories/episode.repo'
import * as episodeAnalysisRepo from './repositories/episode-analysis.repo'
import * as scriptRepo from './repositories/script.repo'
import * as sceneRepo from './repositories/scene.repo'
import * as scriptReviewRepo from './repositories/script-review.repo'
import * as shotRepo from './repositories/shot.repo'
import * as shotReviewRepo from './repositories/shot-review.repo'
import * as videoProviderConfigRepo from './repositories/video-provider-config.repo'
import * as videoGenerationTaskRepo from './repositories/video-generation-task.repo'
import * as videoResultRepo from './repositories/video-result.repo'
import * as agentProfileRepo from './repositories/agent-profile.repo'
import * as templateRepo from './repositories/template.repo'
import * as genrePresetRepo from './repositories/genre-preset.repo'
import * as templateRunRepo from './repositories/template-run.repo'
import * as taskModelBindingRepo from './repositories/task-model-binding.repo'
import * as creativeRepo from './repositories/creative.repo'

export function createRepositories(db: DB) {
  return {
    project: { ...projectRepo },
    character: { ...characterRepo },
    outline: { ...outlineRepo },
    chapter: { ...chapterRepo },
    evaluation: { ...evaluationRepo },
    aiRun: { ...aiRunRepo },
    aiBudget: { ...aiBudgetRepo },
    longTask: { ...longTaskRepo },
    modelConfig: { ...modelConfigRepo },
    // v0.2
    chapterMemory: { ...chapterMemoryRepo },
    characterState: { ...characterStateRepo },
    visualProfile: { ...characterVisualProfileRepo },
    visualSetting: { ...visualSettingRepo },
    storyEvent: { ...storyEventRepo },
    foreshadowing: { ...foreshadowingRepo },
    // v0.3
    beat: { ...beatRepo },
    highlight: { ...highlightRepo },
    feasibility: { ...feasibilityRepo },
    dramaTrend: { ...dramaTrendRepo },
    // v0.4
    adaptationProject: { ...adaptationProjectRepo },
    episode: { ...episodeRepo },
    episodeAnalysis: { ...episodeAnalysisRepo },
    // v0.5
    script: { ...scriptRepo },
    scene: { ...sceneRepo },
    scriptReview: { ...scriptReviewRepo },
    // v0.6
    shot: { ...shotRepo },
    shotReview: { ...shotReviewRepo },
    // v0.7
    videoProviderConfig: { ...videoProviderConfigRepo },
    videoTask: { ...videoGenerationTaskRepo },
    videoResult: { ...videoResultRepo },
    // v0.8
    agentProfile: { ...agentProfileRepo },
    template: { ...templateRepo },
    genrePreset: { ...genrePresetRepo },
    templateRun: { ...templateRunRepo },
    // v1.0
    taskModelBinding: { ...taskModelBindingRepo },
    // v1.1
    creative: { ...creativeRepo },
    db,
  }
}
export type Repositories = ReturnType<typeof createRepositories>
