// buildPromptNode —— 根据 taskType 选模板 + 拼上下文（§10.2 / §13）
import {
  buildAdaptationContext,
  buildAnalysisContext,
  buildChapterContext,
  buildChatContext,
  buildCreativeContext,
  buildEvaluationContext,
  buildMemoryContext,
  buildScriptContext,
  buildShotContext,
  applyContextBudget,
} from '../context/context-builder'
import { effectiveTaskType, getPromptTemplate, isJsonTask, isTextChapterTask } from '../prompts/loader'
import { chapterLengthRange } from '../chapter-length'
import type { NovelTaskType } from '@sdns/core'
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'

export function createBuildPromptNode(_deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    // 重试路径：上次解析/校验失败，追加修复指令并清空 error 让 callModel 继续执行
    if (state.error) {
      const effectiveType = effectiveTaskType(state.taskType, state.templateScope)
      const fix = isJsonTask(effectiveType)
        ? [
            '',
            '---',
            '【修复要求】上一次输出无法解析：' + state.error,
            '请严格按输出格式重新生成；只输出合法 JSON 对象/数组，不要包含 Markdown 代码块或任何解释文字。',
          ].join('\n')
        : [
            '',
            '---',
            '【修复要求】上一次输出未通过校验：' + state.error,
            '请从头重新生成完整结果，绝不能沿用、续写或拼接上一轮文本。把字数上限当作绝对红线，优先遵守本章字数硬性约束中的首稿安全区间；不要解释、不要说明。',
          ].join('\n')
      return {
        promptText: (state.promptText ?? '') + fix,
        retryCount: (state.retryCount ?? 0) + 1,
        // 用空串清除上一轮错误（LangGraph 会跳过 undefined，故用 '' 表示无错误）
        error: '',
      }
    }

    // v0.8：template_run 用渲染后的模板正文替代 getPromptTemplate，实际作用域由 templateScope 决定
    const template =
      state.taskType === 'template_run'
        ? (state.templateContent ?? getPromptTemplate(state.templateScope ?? 'generate_project'))
        : getPromptTemplate(state.taskType)
    if (!template) {
      return { error: `未找到任务「${state.taskType}」的 prompt 模板`, retryable: false }
    }

    // 上下文构建依据「实际作用域」taskType（template_run → templateScope）
    const effectiveType = effectiveTaskType(state.taskType, state.templateScope)
    const contextText = applyContextBudget(buildContext(state, effectiveType), effectiveType)
    const parts: string[] = [template.trim()]
    if (contextText.trim()) {
      parts.push('---\n\n# 输入材料\n\n' + contextText.trim())
    }
    if (state.userInstruction?.trim()) {
      parts.push('# 本次指令\n\n' + state.userInstruction.trim())
    }
    const isChapterLengthAdjustment = effectiveType === 'rewrite_chapter'
      && state.userInstruction?.includes('【章节字数调整任务】')
    // 正文生成与整章改写类操作都需遵循编辑器的目标字数。选中文本的局部润色
    // 不传 chapterWordGoal，因而不会被误要求改成整章篇幅；续写任务输出的是尾段，也不套用整章约束。
    const isLengthBoundChapterText = state.chapterWordGoal !== undefined
      && isTextChapterTask(effectiveType)
      && effectiveType !== 'continue_chapter'
    if (isLengthBoundChapterText || isChapterLengthAdjustment) {
      const { target, minimum, maximum } = chapterLengthRange(state.chapterWordGoal)
      // 模型对中文字符、Markdown 标题的估算常有误差。首稿主动预留余量，
      // 验收范围仍严格是用户设置的目标字数 ±300，不改变最终规则。
      const safetyBuffer = Math.min(100, Math.floor((target - minimum) / 2))
      const preferredTarget = Math.max(minimum, target - safetyBuffer)
      const preferredMinimum = Math.max(minimum, preferredTarget - 50)
      const preferredMaximum = Math.min(maximum, preferredTarget + 50)
      parts.push([
        isChapterLengthAdjustment ? '# 字数调整最终硬性约束（覆盖前文任何篇幅倾向）' : '# 本章字数硬性约束',
        '',
        `验收范围：全部输出按非空白字符计（包括第一行 Markdown 标题），目标 ${target} 字，允许范围 ${minimum}–${maximum} 字（目标字数 ±${maximum - target} 字）。`,
        `绝对红线：不得超过 ${maximum} 字；即使只超出 1 字也视为失败。`,
        `${isChapterLengthAdjustment ? '一次调整成功的安全区间' : '首稿安全区间'}：请优先把完整正文控制在 ${preferredMinimum}–${preferredMaximum} 字，为标题和字符估算误差预留空间。`,
        `${isChapterLengthAdjustment ? '只能在待调整首稿上做定向增删，绝不能复述、复制两遍或另起炉灶。' : '写作前请在内部规划篇幅。'} 输出后自行复核，达到完整结尾后立即停止，禁止补写尾声、作者话、字数说明或任何附加内容。`,
        '不足时只补足有效情节、对白或动作；超出时优先删减重复描写。不得用标题、重复段落或标点凑字数。',
      ].join('\n'))
    }
    if (isJsonTask(effectiveType)) {
      parts.push('# 再次提醒\n\n只输出 JSON，不要 Markdown、不要代码块、不要解释。')
    }

    return { promptText: parts.join('\n\n'), contextText }
  }
}

function buildContext(state: NovelGraphStateType, taskType: NovelTaskType): string {
  const common = {
    project: state.project,
    characters: state.characters,
    outlines: state.outlines,
    storyArcs: state.storyArcs,
    projectSkills: state.projectSkills,
    chapters: state.chapters,
    currentChapter: state.currentChapter,
    chapterMemories: state.chapterMemories,
    characterStates: state.characterStates,
    visualProfiles: state.visualProfiles,
    visualSettings: state.visualSettings,
    storyEvents: state.storyEvents,
    foreshadowings: state.foreshadowings,
    evaluations: state.evaluations,
    beats: state.beats,
    highlightAnalyses: state.highlightAnalyses,
    feasibilityReports: state.feasibilityReports,
    dramaTrendReport: state.dramaTrendReport,
    chatHistory: state.chatHistory,
    adaptationProject: state.adaptationProject,
    episodes: state.episodes,
    // v0.5
    currentEpisode: state.currentEpisode,
    scripts: state.scripts,
    currentScript: state.currentScript,
    scenes: state.scenes,
    // v0.6
    currentScene: state.currentScene,
    shots: state.shots,
    currentShot: state.currentShot,
    creativeCaseStudies: state.creativeCaseStudies,
    freshnessReports: state.freshnessReports,
    qualityGateReports: state.qualityGateReports,
    revisionTasks: state.revisionTasks,
    audienceSimulations: state.audienceSimulations,
    narrativeCurveReports: state.narrativeCurveReports,
  }
  switch (taskType) {
    case 'chat_project':
      return buildChatContext(common)
    case 'evaluate_ai_drama_fit':
      return buildEvaluationContext(common)
    // v0.4：改编策略 / 分集生成 / 单集重写增强 / 前 10 集分析
    case 'create_adaptation_strategy':
    case 'convert_novel_to_episodes':
    case 'rewrite_episode_outline':
    case 'enhance_episode_hook':
    case 'enhance_episode_visuals':
    case 'analyze_first_10_episodes':
      return buildAdaptationContext(common)
    // v0.5：剧本生成 / 拆分场景 / 审稿 / 改写 / 增强
    case 'generate_ai_drama_script':
    case 'split_script_to_scenes':
    case 'review_ai_drama_script':
    case 'rewrite_ai_drama_script':
    case 'enhance_dialogue_conflict':
    case 'enhance_script_dialogue_voice':
    case 'enhance_episode_cliffhanger':
    case 'enhance_script_visuality':
      return buildScriptContext(common)
    // v0.6：场景拆镜头 / 生成 Prompt / 负面 Prompt / 审查 / 改写 / 平台优化
    case 'split_scene_to_shots':
    case 'generate_shot_prompt':
    case 'generate_negative_prompt':
    case 'review_shot_prompt':
    case 'rewrite_shot_prompt':
    case 'optimize_prompt_for_video_platform':
    case 'generate_video_asset_drafts':
      return buildShotContext(common)
    // v0.2：记忆/视觉/一致性任务使用记忆上下文（含历史状态、事件、伏笔）
    case 'summarize_chapter':
    case 'update_character_state':
    case 'extract_story_events':
    case 'extract_foreshadowing':
    case 'generate_character_visual_profile':
    case 'generate_visual_setting':
    case 'check_consistency':
    case 'build_long_context':
      return buildMemoryContext(common)
    // v0.3：分析类任务使用分析上下文（在记忆基础上追加评分/节拍/爽点/可行性）
    case 'analyze_beats':
    case 'analyze_highlights':
    case 'analyze_ai_video_feasibility':
    case 'analyze_project_ai_drama_trend':
      return buildAnalysisContext(common)
    case 'analyze_trope_freshness':
    case 'generate_anti_trope_variants':
    case 'analyze_narrative_curve':
    case 'generate_revision_tasks':
    case 'run_quality_gate':
    case 'simulate_audience_reaction':
    case 'analyze_video_cost_risk':
    case 'analyze_text_quality':
    case 'extract_case_structure':
    case 'generate_inspiration_schemes':
      return buildCreativeContext(common)
    case 'generate_project':
    case 'generate_characters':
    case 'generate_book_outline':
    case 'generate_chapter_outline':
    case 'generate_story_arc_outline':
      return buildChapterContext(common)
    default:
      // 文本章节任务（含 v0.3 的 enhance_hook/reversal/cliffhanger 与 rewrite_as_ai_drama_novel）
      return buildChapterContext(common)
  }
}
