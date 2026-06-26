// validateOutputNode —— 使用 Zod 校验结构化输出（§10.2 / §14）
import {
  AdaptationStrategyResultSchema,
  AiVideoFeasibilityResultSchema,
  BeatsResultSchema,
  ChatProjectResultSchema,
  ChapterMemoryResultSchema,
  CharacterStateResultSchema,
  ConsistencyResultSchema,
  DramaTrendResultSchema,
  EpisodeItemSchema,
  EpisodesResultSchema,
  EvaluationResultSchema,
  First10AnalysisResultSchema,
  ForeshadowingResultSchema,
  GenerateChapterOutlinesResultSchema,
  GenerateCharactersResultSchema,
  GenerateProjectResultSchema,
  HighlightAnalysisResultSchema,
  ScenesResultSchema,
  ScriptReviewResultSchema,
  ScriptResultSchema,
  ShotPromptResultSchema,
  ShotReviewResultSchema,
  ShotsResultSchema,
  StoryEventsResultSchema,
  VisualProfileResultSchema,
  VisualSettingResultSchema,
} from '@sdns/core'
import type { NovelTaskType } from '@sdns/core'
import type { z } from 'zod'
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'

function getSchema(taskType: NovelTaskType): z.ZodType | undefined {
  switch (taskType) {
    case 'generate_project':
      return GenerateProjectResultSchema
    case 'generate_characters':
      return GenerateCharactersResultSchema
    case 'generate_chapter_outline':
      return GenerateChapterOutlinesResultSchema
    case 'evaluate_ai_drama_fit':
      return EvaluationResultSchema
    // v0.2
    case 'summarize_chapter':
      return ChapterMemoryResultSchema
    case 'update_character_state':
      return CharacterStateResultSchema
    case 'extract_story_events':
      return StoryEventsResultSchema
    case 'extract_foreshadowing':
      return ForeshadowingResultSchema
    case 'generate_character_visual_profile':
      return VisualProfileResultSchema
    case 'generate_visual_setting':
      return VisualSettingResultSchema
    case 'check_consistency':
      return ConsistencyResultSchema
    // v0.3 分析类
    case 'analyze_beats':
      return BeatsResultSchema
    case 'analyze_highlights':
      return HighlightAnalysisResultSchema
    case 'analyze_ai_video_feasibility':
      return AiVideoFeasibilityResultSchema
    case 'analyze_project_ai_drama_trend':
      return DramaTrendResultSchema
    case 'chat_project':
      return ChatProjectResultSchema
    // v0.4 改编分集
    case 'create_adaptation_strategy':
      return AdaptationStrategyResultSchema
    case 'convert_novel_to_episodes':
      return EpisodesResultSchema
    case 'rewrite_episode_outline':
    case 'enhance_episode_hook':
    case 'enhance_episode_visuals':
      return EpisodeItemSchema
    case 'analyze_first_10_episodes':
      return First10AnalysisResultSchema
    // v0.5 剧本
    case 'generate_ai_drama_script':
    case 'rewrite_ai_drama_script':
    case 'enhance_dialogue_conflict':
    case 'enhance_episode_cliffhanger':
    case 'enhance_script_visuality':
      return ScriptResultSchema
    case 'split_script_to_scenes':
      return ScenesResultSchema
    case 'review_ai_drama_script':
      return ScriptReviewResultSchema
    // v0.6 镜头
    case 'split_scene_to_shots':
      return ShotsResultSchema
    case 'generate_shot_prompt':
    case 'generate_negative_prompt':
    case 'rewrite_shot_prompt':
    case 'optimize_prompt_for_video_platform':
      return ShotPromptResultSchema
    case 'review_shot_prompt':
      return ShotReviewResultSchema
    default:
      return undefined
  }
}

export function createValidateOutputNode(_deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    if (state.error) return {}

    // v0.8：template_run 按 templateScope 取校验 schema
    const schema = getSchema(
      state.taskType === 'template_run'
        ? (state.templateScope ?? 'generate_project')
        : state.taskType,
    )
    if (!schema) {
      // 文本任务：仅校验非空
      const content = String(state.parsedOutput ?? '')
      if (!content.trim()) {
        return { error: '模型输出为空', retryable: true }
      }
      return { parsedOutput: content, error: '' }
    }

    const result = schema.safeParse(state.parsedOutput)
    if (result.success) {
      return { parsedOutput: result.data, error: '' }
    }
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { error: `结构校验失败：${detail}`, retryable: true }
  }
}
