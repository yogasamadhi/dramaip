// Prompt 注册表 —— 以 ?raw 形式导入 Markdown 模板（PROJECT_BRIEF.md §12）
import type { NovelTaskType } from '@sdns/core'

import generateProject from './zh-CN/project/generate-project.md?raw'
import generateCharacter from './zh-CN/character/generate-character.md?raw'
import generateBookOutline from './zh-CN/outline/generate-book-outline.md?raw'
import generateChapterOutline from './zh-CN/outline/generate-chapter-outline.md?raw'
import generateChapter from './zh-CN/chapter/generate-chapter.md?raw'
import continueChapter from './zh-CN/chapter/continue-chapter.md?raw'
import rewriteChapter from './zh-CN/chapter/rewrite-chapter.md?raw'
import polishChapter from './zh-CN/chapter/polish-chapter.md?raw'
import expandChapter from './zh-CN/chapter/expand-chapter.md?raw'
import enhanceConflict from './zh-CN/chapter/enhance-conflict.md?raw'
import enhanceHighlight from './zh-CN/chapter/enhance-highlight.md?raw'
import enhanceAiDramaFeel from './zh-CN/chapter/enhance-ai-drama-feel.md?raw'
import evaluateAiDramaFit from './zh-CN/evaluation/evaluate-ai-drama-fit.md?raw'
// v0.2 长篇一致性与视觉记忆系统
import summarizeChapter from './zh-CN/memory/summarize-chapter.md?raw'
import updateCharacterState from './zh-CN/memory/update-character-state.md?raw'
import extractStoryEvents from './zh-CN/memory/extract-story-events.md?raw'
import extractForeshadowing from './zh-CN/memory/extract-foreshadowing.md?raw'
import buildLongContext from './zh-CN/memory/build-long-context.md?raw'
import generateCharacterVisualProfile from './zh-CN/visual/generate-character-visual-profile.md?raw'
import generateVisualSetting from './zh-CN/visual/generate-visual-setting.md?raw'
import checkConsistency from './zh-CN/consistency/check-consistency.md?raw'
// v0.3 AI 短剧小说强化系统
import analyzeBeats from './zh-CN/beat/analyze-beats.md?raw'
import analyzeHighlights from './zh-CN/analysis/analyze-highlights.md?raw'
import analyzeAiVideoFeasibility from './zh-CN/analysis/analyze-ai-video-feasibility.md?raw'
import analyzeProjectAiDramaTrend from './zh-CN/analysis/analyze-project-ai-drama-trend.md?raw'
import enhanceHook from './zh-CN/chapter/enhance-hook.md?raw'
import enhanceReversal from './zh-CN/chapter/enhance-reversal.md?raw'
import enhanceCliffhanger from './zh-CN/chapter/enhance-cliffhanger.md?raw'
import rewriteAsAiDramaNovel from './zh-CN/rewrite/rewrite-as-ai-drama-novel.md?raw'
import chatProject from './zh-CN/chat/chat-project.md?raw'
// v0.4 改编分集大纲
import createAdaptationStrategy from './zh-CN/adaptation/create-adaptation-strategy.md?raw'
import convertNovelToEpisodes from './zh-CN/adaptation/convert-novel-to-episodes.md?raw'
import rewriteEpisodeOutline from './zh-CN/adaptation/rewrite-episode-outline.md?raw'
import enhanceEpisodeHook from './zh-CN/adaptation/enhance-episode-hook.md?raw'
import enhanceEpisodeVisuals from './zh-CN/adaptation/enhance-episode-visuals.md?raw'
import analyzeFirst10Episodes from './zh-CN/adaptation/analyze-first-10-episodes.md?raw'
// v0.5 AI 短剧剧本生成
import generateAiDramaScript from './zh-CN/script/generate-ai-drama-script.md?raw'
import splitScriptToScenes from './zh-CN/script/split-script-to-scenes.md?raw'
import reviewAiDramaScript from './zh-CN/script/review-ai-drama-script.md?raw'
import rewriteAiDramaScript from './zh-CN/script/rewrite-ai-drama-script.md?raw'
import enhanceDialogueConflict from './zh-CN/script/enhance-dialogue-conflict.md?raw'
import enhanceEpisodeCliffhanger from './zh-CN/script/enhance-episode-cliffhanger.md?raw'
import enhanceScriptVisuality from './zh-CN/script/enhance-script-visuality.md?raw'
// v0.6 分镜与镜头 Prompt 生成
import splitSceneToShots from './zh-CN/shot/split-scene-to-shots.md?raw'
import generateShotPrompt from './zh-CN/shot/generate-shot-prompt.md?raw'
import generateNegativePrompt from './zh-CN/shot/generate-negative-prompt.md?raw'
import reviewShotPrompt from './zh-CN/shot/review-shot-prompt.md?raw'
import rewriteShotPrompt from './zh-CN/shot/rewrite-shot-prompt.md?raw'
import optimizePromptForVideoPlatform from './zh-CN/shot/optimize-prompt-for-video-platform.md?raw'
// v0.8 多 Agent 编剧室与模板系统
// writing_room_* 由 writing-room.graph 内部直接引用 agent prompts；
// template_run 的实际正文来自 graph state 的 templateContent（此处仅为占位，保证 REGISTRY 完整）。
import agentReviewPrompt from './zh-CN/agent/agent-review.md?raw'
import consolidatePrompt from './zh-CN/agent/consolidate-review.md?raw'

const REGISTRY: Record<NovelTaskType, string> = {
  generate_project: generateProject,
  generate_characters: generateCharacter,
  generate_book_outline: generateBookOutline,
  generate_chapter_outline: generateChapterOutline,
  generate_chapter: generateChapter,
  continue_chapter: continueChapter,
  rewrite_chapter: rewriteChapter,
  polish_chapter: polishChapter,
  expand_chapter: expandChapter,
  enhance_conflict: enhanceConflict,
  enhance_highlight: enhanceHighlight,
  enhance_ai_drama_feel: enhanceAiDramaFeel,
  evaluate_ai_drama_fit: evaluateAiDramaFit,
  // v0.2
  summarize_chapter: summarizeChapter,
  update_character_state: updateCharacterState,
  extract_story_events: extractStoryEvents,
  extract_foreshadowing: extractForeshadowing,
  generate_character_visual_profile: generateCharacterVisualProfile,
  generate_visual_setting: generateVisualSetting,
  check_consistency: checkConsistency,
  build_long_context: buildLongContext,
  // v0.3
  analyze_beats: analyzeBeats,
  analyze_highlights: analyzeHighlights,
  analyze_ai_video_feasibility: analyzeAiVideoFeasibility,
  analyze_project_ai_drama_trend: analyzeProjectAiDramaTrend,
  enhance_hook: enhanceHook,
  enhance_reversal: enhanceReversal,
  enhance_cliffhanger: enhanceCliffhanger,
  rewrite_as_ai_drama_novel: rewriteAsAiDramaNovel,
  chat_project: chatProject,
  // v0.4
  create_adaptation_strategy: createAdaptationStrategy,
  convert_novel_to_episodes: convertNovelToEpisodes,
  rewrite_episode_outline: rewriteEpisodeOutline,
  enhance_episode_hook: enhanceEpisodeHook,
  enhance_episode_visuals: enhanceEpisodeVisuals,
  analyze_first_10_episodes: analyzeFirst10Episodes,
  // v0.5
  generate_ai_drama_script: generateAiDramaScript,
  split_script_to_scenes: splitScriptToScenes,
  review_ai_drama_script: reviewAiDramaScript,
  rewrite_ai_drama_script: rewriteAiDramaScript,
  enhance_dialogue_conflict: enhanceDialogueConflict,
  enhance_episode_cliffhanger: enhanceEpisodeCliffhanger,
  enhance_script_visuality: enhanceScriptVisuality,
  // v0.6
  split_scene_to_shots: splitSceneToShots,
  generate_shot_prompt: generateShotPrompt,
  generate_negative_prompt: generateNegativePrompt,
  review_shot_prompt: reviewShotPrompt,
  rewrite_shot_prompt: rewriteShotPrompt,
  optimize_prompt_for_video_platform: optimizePromptForVideoPlatform,
  // v0.8
  writing_room_review: agentReviewPrompt,
  writing_room_consolidate: consolidatePrompt,
  template_run: '请按「输入材料」与「本次指令」中的要求生成内容。',
}

export function getPromptTemplate(taskType: NovelTaskType): string | undefined {
  return REGISTRY[taskType]
}

/** 输出结构化 JSON 的任务（需解析 + Zod 校验） */
export const JSON_TASKS: ReadonlySet<NovelTaskType> = new Set<NovelTaskType>([
  'generate_project',
  'generate_characters',
  'generate_chapter_outline',
  'evaluate_ai_drama_fit',
  // v0.2
  'summarize_chapter',
  'update_character_state',
  'extract_story_events',
  'extract_foreshadowing',
  'generate_character_visual_profile',
  'generate_visual_setting',
  'check_consistency',
  // v0.3 分析类
  'analyze_beats',
  'analyze_highlights',
  'analyze_ai_video_feasibility',
  'analyze_project_ai_drama_trend',
  // 对话
  'chat_project',
  // v0.4 改编分集
  'create_adaptation_strategy',
  'convert_novel_to_episodes',
  'rewrite_episode_outline',
  'enhance_episode_hook',
  'enhance_episode_visuals',
  'analyze_first_10_episodes',
  // v0.5 剧本（剧本正文置于 ScriptResult.content，仍是结构化 JSON 任务）
  'generate_ai_drama_script',
  'split_script_to_scenes',
  'review_ai_drama_script',
  'rewrite_ai_drama_script',
  'enhance_dialogue_conflict',
  'enhance_episode_cliffhanger',
  'enhance_script_visuality',
  // v0.6 镜头（镜头 Prompt / 负面 Prompt / 审查 / 改写 / 平台优化 均为结构化 JSON 任务）
  'split_scene_to_shots',
  'generate_shot_prompt',
  'generate_negative_prompt',
  'review_shot_prompt',
  'rewrite_shot_prompt',
  'optimize_prompt_for_video_platform',
])

export function isJsonTask(taskType: NovelTaskType): boolean {
  return JSON_TASKS.has(taskType)
}

/**
 * v0.8：解析一个任务「真正参与解析/校验/落库」的 taskType。
 * - 普通任务：返回自身。
 * - template_run：返回 templateScope（由 graph state 注入，如 generate_project），
 *   从而复用对应生成类任务的解析、Zod 校验与预览落库闭环；缺省回退为 generate_project。
 */
export function effectiveTaskType(taskType: NovelTaskType, templateScope?: NovelTaskType): NovelTaskType {
  if (taskType === 'template_run') {
    return templateScope ?? 'generate_project'
  }
  return taskType
}

/** 以正文文本为输出的章节类任务 */
export const TEXT_CHAPTER_TASKS: ReadonlySet<NovelTaskType> = new Set<NovelTaskType>([
  'generate_chapter',
  'continue_chapter',
  'rewrite_chapter',
  'polish_chapter',
  'expand_chapter',
  'enhance_conflict',
  'enhance_highlight',
  'enhance_ai_drama_feel',
  // v0.3 强化/改写类
  'enhance_hook',
  'enhance_reversal',
  'enhance_cliffhanger',
  'rewrite_as_ai_drama_novel',
])

export function isTextChapterTask(taskType: NovelTaskType): boolean {
  return TEXT_CHAPTER_TASKS.has(taskType)
}
