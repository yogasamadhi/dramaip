// 上下文构建（PROJECT_BRIEF.md §13 / ROADMAP v0.2）—— 不把所有历史正文塞给模型，只取必要的设定与最近摘要
import type {
  AdaptationProject,
  AiVideoFeasibilityReport,
  Beat,
  Chapter,
  ChapterMemory,
  Character,
  CharacterState,
  CharacterVisualProfile,
  CreativeCaseStudy,
  DramaTrendReport,
  Episode,
  Evaluation,
  Foreshadowing,
  FreshnessReport,
  HighlightAnalysis,
  AudienceSimulation,
  NarrativeCurveReport,
  NovelTaskType,
  Outline,
  Project,
  QualityGateReport,
  RevisionTask,
  Scene,
  Script,
  Shot,
  StoryEvent,
  VisualSetting,
} from '@sdns/core'

const DEFAULT_CONTEXT_TOKEN_BUDGET = 5_000
const CONTEXT_TOKEN_BUDGETS: Partial<Record<NovelTaskType, number>> = {
  chat_project: 3_500,
  convert_novel_to_episodes: 6_500,
  generate_ai_drama_script: 7_000,
  rewrite_ai_drama_script: 7_000,
  split_script_to_scenes: 7_000,
  split_scene_to_shots: 5_500,
  generate_shot_prompt: 4_000,
  rewrite_shot_prompt: 4_000,
  optimize_prompt_for_video_platform: 4_000,
  check_consistency: 6_000,
  build_long_context: 7_000,
  analyze_trope_freshness: 6_000,
  generate_revision_tasks: 6_000,
}

export function estimateContextTokens(text: string): number {
  return Math.ceil(text.replace(/\s+/g, ' ').length / 2)
}

export function contextBudgetForTask(taskType: NovelTaskType): number {
  return CONTEXT_TOKEN_BUDGETS[taskType] ?? DEFAULT_CONTEXT_TOKEN_BUDGET
}

export function applyContextBudget(text: string, taskType: NovelTaskType): string {
  const budget = contextBudgetForTask(taskType)
  if (estimateContextTokens(text) <= budget) return text

  const note = `\n\n## 上下文裁剪说明\n原始上下文约 ${estimateContextTokens(text)} tokens，已按 ${budget} token 预算保留开头的设定/关键实体与末尾的最近记录。\n\n`
  const charBudget = Math.max(600, budget * 2 - note.length)
  const headSize = Math.floor(charBudget * 0.58)
  const tailSize = charBudget - headSize
  return `${text.slice(0, headSize).trimEnd()}${note}${text.slice(-tailSize).trimStart()}`
}

function limitList<T>(items: T[] | undefined, limit: number): T[] {
  return (items ?? []).slice(0, limit)
}

function limitRecent<T>(items: T[] | undefined, limit: number): T[] {
  return (items ?? []).slice(-limit)
}

export interface ChapterContextInput {
  project?: Project
  characters?: Character[]
  outlines?: Outline[]
  chapters?: Chapter[]
  currentChapter?: Chapter
  /** 最近章节摘要条数 */
  recentCount?: number
  /** v0.2 长篇一致性上下文 */
  chapterMemories?: ChapterMemory[]
  characterStates?: CharacterState[]
  visualProfiles?: CharacterVisualProfile[]
  visualSettings?: VisualSetting[]
  storyEvents?: StoryEvent[]
  foreshadowings?: Foreshadowing[]
  /** v0.3 分析上下文 */
  evaluations?: Evaluation[]
  beats?: Beat[]
  highlightAnalyses?: HighlightAnalysis[]
  feasibilityReports?: AiVideoFeasibilityReport[]
  dramaTrendReport?: DramaTrendReport
  /** v1.1 创意诊断上下文 */
  creativeCaseStudies?: CreativeCaseStudy[]
  freshnessReports?: FreshnessReport[]
  qualityGateReports?: QualityGateReport[]
  revisionTasks?: RevisionTask[]
  audienceSimulations?: AudienceSimulation[]
  narrativeCurveReports?: NarrativeCurveReport[]
  /** 对话式项目设定：多轮对话历史 */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** v0.4 改编上下文 */
  adaptationProject?: AdaptationProject
  episodes?: Episode[]
  /** v0.5 剧本上下文 */
  currentEpisode?: Episode
  scripts?: Script[]
  currentScript?: Script
  scenes?: Scene[]
  /** v0.6 镜头上下文 */
  currentScene?: Scene
  shots?: Shot[]
  currentShot?: Shot
}

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return ''
  return `- ${label}：${value}`
}

function block(title: string, body: string): string {
  if (!body.trim()) return ''
  return `## ${title}\n${body.trim()}`
}

/** 生成章节正文 / 章节辅助时使用的上下文 */
export function buildChapterContext(input: ChapterContextInput): string {
  const { project, characters, outlines, chapters, currentChapter } = input
  const sections: string[] = []

  if (project) {
    const fields = [
      line('作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('目标受众', project.targetAudience),
      line('目标集数', project.targetEpisodeCount),
      line('核心卖点', project.coreSellingPoint),
      line('情绪主轴', project.emotionalCore),
      line('一句话卖点', project.coreHook),
      line('风格要求', project.styleGuide),
      line('视觉风格方向', project.visualStyleDirection),
    ].filter(Boolean)
    sections.push(block('项目设定', fields.join('\n')))
  }

  if (characters?.length) {
    const profileByChar = new Map((input.visualProfiles ?? []).map((p) => [p.characterId, p]))
    const body = limitList(characters, 30)
      .map((c) => {
        const core = [c.identity, c.personality, c.desire].filter(Boolean).join('；')
        const parts: string[] = []
        if (c.visualDescription) parts.push(`视觉：${c.visualDescription}`)
        const vp = profileByChar.get(c.id)
        if (vp?.appearancePrompt) parts.push(`外观 Prompt：${vp.appearancePrompt}`)
        const visual = parts.length ? `；${parts.join('；')}` : ''
        return `- ${c.name}（${c.role}）：${core}${visual}`
      })
      .join('\n')
    sections.push(block('主要人物', body))
  }

  const bookOutline = outlines?.filter((o) => o.type === 'book').map((o) => o.content).join('\n')
  sections.push(block('全书大纲', bookOutline ?? ''))

  if (currentChapter) {
    const fields = [
      line('章节标题', currentChapter.title),
      line('本章大纲', currentChapter.outline),
      line('本章冲突', currentChapter.mainConflict),
      line('本章钩子', currentChapter.hook),
    ].filter(Boolean)
    sections.push(block('当前章节大纲', fields.join('\n')))
  }

  // 最近 N 章摘要（不含当前章）
  const recent = (chapters ?? [])
    .filter((c) => currentChapter == null || c.id !== currentChapter.id)
    .slice(-(input.recentCount ?? 3))
  if (recent.length) {
    const body = recent.map((c, i) => `第${i + 1}段：${c.summary || c.title}`).join('\n')
    sections.push(block('最近章节摘要', body))
  }

  // 当前章节已有正文（续写/润色等需要）
  if (currentChapter?.content?.trim()) {
    sections.push(block('当前章节已有正文', currentChapter.content.trim()))
  }

  return sections.filter(Boolean).join('\n\n')
}

/** 评分任务上下文：项目设定 + 当前章节正文 */
export function buildEvaluationContext(input: ChapterContextInput): string {
  const { project, currentChapter } = input
  const sections: string[] = []
  if (project) {
    const fields = [
      line('作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('目标集数', project.targetEpisodeCount),
    ].filter(Boolean)
    sections.push(block('项目设定', fields.join('\n')))
  }
  if (currentChapter?.content?.trim()) {
    sections.push(block('待评章节正文', currentChapter.content.trim()))
  }
  return sections.filter(Boolean).join('\n\n')
}

/**
 * v0.2 记忆任务上下文（extract / check 类）：
 * 项目设定 + 人物（含视觉）+ 当前章节正文 + 章节记忆 + 人物状态 + 最近事件 + 伏笔清单。
 * 让 AI 在「知道历史」的前提下抽取记忆或检查一致性。
 */
export function buildMemoryContext(input: ChapterContextInput): string {
  const {
    project,
    characters,
    visualProfiles,
    currentChapter,
    chapterMemories,
    characterStates,
    storyEvents,
    foreshadowings,
  } = input
  const sections: string[] = []

  if (project) {
    const fields = [
      line('作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('视觉风格方向', project.visualStyleDirection),
    ].filter(Boolean)
    sections.push(block('项目设定', fields.join('\n')))
  }

  if (characters?.length) {
    const profileByChar = new Map((visualProfiles ?? []).map((p) => [p.characterId, p]))
    const body = limitList(characters, 40)
      .map((c) => {
        const id = `（id:${c.id}）`
        const core = [c.identity, c.personality, c.desire].filter(Boolean).join('；')
        const vp = profileByChar.get(c.id)
        const visual = [c.visualDescription, vp?.appearancePrompt].filter(Boolean).join('；')
        return `- ${c.name}${id}（${c.role}）：${core}${visual ? `；视觉：${visual}` : ''}`
      })
      .join('\n')
    sections.push(block('人物设定', body))
  }

  if (chapterMemories?.length) {
    const body = limitRecent(chapterMemories, 30)
      .map((m, i) => `第${i + 1}章记忆：${m.summary}`)
      .join('\n')
    sections.push(block('已有章节记忆', body))
  }

  if (characterStates?.length) {
    const nameById = new Map((characters ?? []).map((c) => [c.id, c.name]))
    const body = limitList(characterStates, 60)
      .map((s) => {
        const name = nameById.get(s.characterId) ?? s.characterId
        const parts = [line('状态', s.currentStatus), line('情绪', s.emotionalState)].filter(Boolean)
        return `- ${name}：${parts.join('；')}`
      })
      .join('\n')
    sections.push(block('人物当前状态', body))
  }

  if (storyEvents?.length) {
    const body = storyEvents
      .slice(-10)
      .map((e) => `- [${e.eventType}] ${e.title}：${e.description}`)
      .join('\n')
    sections.push(block('最近事件时间线', body))
  }

  if (foreshadowings?.length) {
    const body = limitList(foreshadowings, 80)
      .map((f) => `- [${f.status}] ${f.title}：${f.description}`)
      .join('\n')
    sections.push(block('伏笔清单', body))
  }

  if (currentChapter?.content?.trim()) {
    sections.push(block('当前章节正文', currentChapter.content.trim()))
  }

  return sections.filter(Boolean).join('\n\n')
}

/**
 * v0.3 分析任务上下文（节拍/爽点/可行性/趋势）：
 * 在记忆上下文基础上，追加全书评分历史、戏剧节拍、爽点分析与可行性报告，
 * 让 AI 在「了解已有分析结果」的前提下做进一步分析。
 */
export function buildAnalysisContext(input: ChapterContextInput): string {
  const base = buildMemoryContext(input)
  const { evaluations, beats, highlightAnalyses, feasibilityReports, chapters } = input
  const extra: string[] = []

  if (chapters?.length) {
    const body = chapters.map((c, i) => `第${i + 1}章 ${c.title}`).join('\n')
    extra.push(block('全书章节列表', body))
  }

  if (evaluations?.length) {
    const body = evaluations
      .slice(-20)
      .map((e) => `- 总分${e.totalScore}（钩子${e.hookScore}/冲突${e.conflictScore}/反转${e.reversalScore}/画面${e.visualizationScore}/AI视频可行${e.aiVideoFeasibilityScore}/镜头${e.shotClarityScore}）`)
      .join('\n')
    extra.push(block('历史评分', body))
  }

  if (beats?.length) {
    const body = beats
      .slice(-15)
      .map((b) => `- [${b.type}] ${b.title}（戏剧${b.dramaValue}/画面${b.visualValue}）`)
      .join('\n')
    extra.push(block('已有戏剧节拍', body))
  }

  if (highlightAnalyses?.length) {
    const body = highlightAnalyses
      .slice(-10)
      .map((h) => `- ${h.highlightTypes.join('/')}（打脸${h.faceSlap}/逆袭${h.counterattack}/强宠${h.pampering}）`)
      .join('\n')
    extra.push(block('已有爽点分析', body))
  }

  if (feasibilityReports?.length) {
    const body = feasibilityReports
      .slice(-10)
      .map((f) => `- 综合可行${f.overallScore}（角色一致${f.characterConsistencyScore}/竖屏${f.verticalSuitabilityScore}）`)
      .join('\n')
    extra.push(block('已有可行性报告', body))
  }

  return [base, ...extra.filter(Boolean)].filter(Boolean).join('\n\n')
}

/**
 * 对话式项目设定上下文（chat_project）：
 * 当前项目设定（让 AI 知道哪些已填、哪些待聊）+ 完整对话历史。
 */
export function buildChatContext(input: ChapterContextInput): string {
  const { project, chatHistory } = input
  const sections: string[] = []

  if (project) {
    const filled = [
      line('作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('目标受众', project.targetAudience),
      line('目标字数', project.targetWordCount),
      line('目标集数', project.targetEpisodeCount),
      line('一句话钩子', project.coreHook),
      line('情绪主轴', project.emotionalCore),
      line('核心卖点', project.coreSellingPoint),
      line('故事简介', project.synopsis),
      line('小说风格要求', project.styleGuide),
      line('视觉风格方向', project.visualStyleDirection),
    ].filter(Boolean)
    sections.push(block('当前项目设定（已填部分）', filled.length ? filled.join('\n') : '（暂无，需逐步聊清）'))
  }

  if (chatHistory?.length) {
    const body = limitRecent(chatHistory, 12).map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n')
    sections.push(block('历史对话', body))
  } else {
    sections.push(block('历史对话', '（这是第一轮，请主动开场引导用户）'))
  }

  return sections.filter(Boolean).join('\n\n')
}

/**
 * v0.4 改编上下文（改编策略 / 分集生成 / 单集重写增强 / 前 10 集分析）：
 * 改编项目设定 + 源小说（项目设定/人物/章节大纲摘要）+ 已有分集 + 改编策略。
 */
export function buildAdaptationContext(input: ChapterContextInput): string {
  const { project, characters, outlines, chapters, adaptationProject, episodes } = input
  const sections: string[] = []

  if (adaptationProject) {
    const fields = [
      line('改编标题', adaptationProject.title),
      line('第几季', adaptationProject.seasonNumber),
      line(
        '本季改编范围',
        adaptationProject.sourceChapterRange
          ? `第 ${adaptationProject.sourceChapterRange.from}~${adaptationProject.sourceChapterRange.to} 章`
          : undefined,
      ),
      line('目标集数', adaptationProject.targetEpisodeCount),
      line('每集时长', adaptationProject.episodeDuration),
      line('改编风格', adaptationProject.adaptationStyle),
      line('视觉风格方向', adaptationProject.visualStyleDirection),
      line('目标受众', adaptationProject.audience),
    ].filter(Boolean)
    sections.push(block('改编项目设定（本季）', fields.join('\n')))
    if (adaptationProject.strategy) {
      sections.push(block('已有改编策略', adaptationProject.strategy))
    }
  }

  if (project) {
    const fields = [
      line('源作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('核心卖点', project.coreSellingPoint),
      line('一句话钩子', project.coreHook),
      line('情绪主轴', project.emotionalCore),
      line('视觉风格方向', project.visualStyleDirection),
    ].filter(Boolean)
    sections.push(block('源小说项目设定', fields.join('\n')))
  }

  if (characters?.length) {
    const body = limitList(characters, 40).map((c) => `- ${c.name}（${c.role}）：${[c.identity, c.desire].filter(Boolean).join('；')}`).join('\n')
    sections.push(block('人物设定', body))
  }

  const bookOutlines = (outlines ?? []).filter((o) => o.type === 'book')
  if (bookOutlines.length) {
    sections.push(block('全书大纲', bookOutlines.map((o) => o.content).join('\n')))
  }

  if (chapters?.length) {
    // 分集生成需要知道每一章大概内容，给前若干章摘要（控制长度）
    const body = limitList(chapters, 80)
      .map((c, i) => `第${i + 1}章 ${c.title}${c.summary ? `：${c.summary}` : ''}`)
      .join('\n')
    sections.push(block('源小说章节', body))
  }

  if (episodes?.length) {
    const body = limitList(episodes, 80)
      .map(
        (e) =>
          `第${e.episodeNumber}集《${e.title}》：${e.summary}（钩子：${e.hook}；冲突：${e.mainConflict}；悬念：${e.cliffhanger}）`,
      )
      .join('\n')
    sections.push(block('已有分集大纲', body))
  }

  return sections.filter(Boolean).join('\n\n')
}

/**
 * v0.5 剧本上下文（生成 / 拆分场景 / 审稿 / 改写 / 增强）：
 * 在改编上下文基础上，聚焦当前集分集大纲 + 当前剧本正文 + 前后集剧情 + 已有场景。
 */
export function buildScriptContext(input: ChapterContextInput): string {
  const { project, characters, adaptationProject, episodes, currentEpisode, currentScript, scenes } = input
  const sections: string[] = []

  if (adaptationProject) {
    const fields = [
      line('改编标题', adaptationProject.title),
      line('目标集数', adaptationProject.targetEpisodeCount),
      line('每集时长', adaptationProject.episodeDuration),
      line('改编风格', adaptationProject.adaptationStyle),
      line('视觉风格方向', adaptationProject.visualStyleDirection),
      line('目标受众', adaptationProject.audience),
    ].filter(Boolean)
    sections.push(block('改编项目设定', fields.join('\n')))
  }

  if (project) {
    const fields = [
      line('源作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('核心卖点', project.coreSellingPoint),
      line('视觉风格方向', project.visualStyleDirection),
    ].filter(Boolean)
    sections.push(block('源小说项目设定', fields.join('\n')))
  }

  if (characters?.length) {
    const body = limitList(characters, 40)
      .map((c) => {
        const visual = [c.visualDescription, c.appearancePrompt].filter(Boolean).join('；')
        return `- ${c.name}（${c.role}）：${[c.identity, c.personality, c.desire].filter(Boolean).join('；')}${visual ? `；视觉：${visual}` : ''}`
      })
      .join('\n')
    sections.push(block('人物设定', body))
  }

  // 当前集分集大纲（剧本生成的核心依据）
  if (currentEpisode) {
    const fields = [
      line('集数', currentEpisode.episodeNumber),
      line('标题', currentEpisode.title),
      line('梗概', currentEpisode.summary),
      line('开场钩子', currentEpisode.hook),
      line('核心冲突', currentEpisode.mainConflict),
      line('关键反转', currentEpisode.reversal),
      line('情绪爆点', currentEpisode.emotionalBeat),
      line('结尾悬念', currentEpisode.cliffhanger),
      line('AI视频备注', currentEpisode.aiVideoNote),
    ].filter(Boolean)
    sections.push(block('当前集分集大纲', fields.join('\n')))
    if (currentEpisode.keyVisuals.length) {
      sections.push(block('当前集关键画面', currentEpisode.keyVisuals.map((v) => `- ${v}`).join('\n')))
    }
  }

  // 前后集剧情（保持连贯）
  if (episodes?.length && currentEpisode) {
    const neighbors = episodes
      .filter((e) => Math.abs(e.episodeNumber - currentEpisode.episodeNumber) <= 2 && e.id !== currentEpisode.id)
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
    if (neighbors.length) {
      const body = neighbors
        .map((e) => `第${e.episodeNumber}集《${e.title}》：${e.summary}（悬念：${e.cliffhanger}）`)
        .join('\n')
      sections.push(block('前后集剧情（保持连贯）', body))
    }
  }

  // 当前剧本正文（续写/改写/拆分/审稿都需要）
  if (currentScript?.content?.trim()) {
    sections.push(block('当前剧本正文', currentScript.content.trim()))
  }

  // 已有场景（拆分/审稿参考）
  if (scenes?.length) {
    const body = limitList(scenes, 80)
      .map((s, i) => `场景${i + 1}「${s.title}」（${s.location}）：${s.summary}`)
      .join('\n')
    sections.push(block('已有场景', body))
  }

  return sections.filter(Boolean).join('\n\n')
}

/**
 * v0.6 镜头上下文（场景拆镜头 / 生成 Prompt / 负面 Prompt / 审查 / 改写 / 平台优化）：
 * 改编视觉风格 + 人物视觉档案 + 当前场景 + 当前场景已有镜头 + 当前镜头（生成/改写时）。
 */
export function buildShotContext(input: ChapterContextInput): string {
  const { adaptationProject, characters, visualProfiles, visualSettings, currentScene, shots, currentShot } = input
  const sections: string[] = []

  if (adaptationProject) {
    const fields = [
      line('改编标题', adaptationProject.title),
      line('视觉风格方向', adaptationProject.visualStyleDirection),
      line('改编风格', adaptationProject.adaptationStyle),
    ].filter(Boolean)
    sections.push(block('改编视觉设定', fields.join('\n')))
  }

  // 人物视觉档案（角色一致性依据）
  if (characters?.length) {
    const profileByChar = new Map((visualProfiles ?? []).map((p) => [p.characterId, p]))
    const body = limitList(characters, 40)
      .map((c) => {
        const vp = profileByChar.get(c.id)
        const visual = [c.visualDescription, c.appearancePrompt, vp?.appearancePrompt].filter(Boolean).join('；')
        return `- ${c.name}（${c.role}）${visual ? `：${visual}` : ''}`
      })
      .join('\n')
    sections.push(block('人物视觉档案（角色一致性依据）', body))
  }

  // 场景/世界视觉设定（场景一致性依据）
  if (visualSettings?.length) {
    const body = limitList(visualSettings, 40)
      .map((v) => `- ${v.title}（${v.type}）：${v.visualPrompt}`)
      .join('\n')
    sections.push(block('视觉设定（场景一致性依据）', body))
  }

  // 当前场景（拆镜头的核心依据）
  if (currentScene) {
    const fields = [
      line('场景标题', currentScene.title),
      line('地点', currentScene.location),
      line('时间', currentScene.timeOfDay),
      line('画面描述', currentScene.visualDescription),
      line('出场人物', currentScene.characters.join('、')),
      line('场景摘要', currentScene.summary),
    ].filter(Boolean)
    sections.push(block('当前场景', fields.join('\n')))
  }

  // 当前场景已有镜头（保持连贯，避免重复）
  if (shots?.length) {
    const body = limitList(shots, 80)
      .map((s, i) => `镜头${i + 1}（${s.cameraAngle ?? ''}/${s.cameraMovement ?? ''}）：${s.visualDescription}`)
      .join('\n')
    sections.push(block('本场景已有镜头', body))
  }

  // 当前镜头（生成/改写 Prompt、审查时聚焦单个镜头）
  if (currentShot) {
    const fields = [
      line('画面描述', currentShot.visualDescription),
      line('出场人物', currentShot.characterIds.join('、')),
      line('镜头角度', currentShot.cameraAngle),
      line('镜头运动', currentShot.cameraMovement),
      line('情绪', currentShot.emotion),
      line('动作', currentShot.action),
      line('对白', currentShot.dialogue),
      line('旁白', currentShot.narration),
      line('当前视频 Prompt', currentShot.videoPrompt),
      line('当前负面 Prompt', currentShot.negativePrompt),
      line('当前图片 Prompt', currentShot.imagePrompt),
    ].filter(Boolean)
    sections.push(block('当前镜头', fields.join('\n')))
  }

  return sections.filter(Boolean).join('\n\n')
}

/** v1.1 创意诊断上下文：把当前创作材料 + 本地样本库 + 已有分析报告组合给策略类任务。 */
export function buildCreativeContext(input: ChapterContextInput): string {
  const sections: string[] = [buildAnalysisContext(input), buildAdaptationContext(input), buildScriptContext(input), buildShotContext(input)]
  const {
    creativeCaseStudies,
    freshnessReports,
    qualityGateReports,
    revisionTasks,
    audienceSimulations,
    narrativeCurveReports,
  } = input

  if (creativeCaseStudies?.length) {
    const body = creativeCaseStudies
      .slice(0, 12)
      .map((c) => {
        const rhythmCurve = c.rhythmCurve ?? []
        const creativeCards = c.creativeCards ?? []
        const pieces = [
          c.genre ? `类型：${c.genre}` : '',
          c.openingHooks.length ? `开场：${c.openingHooks.join(' / ')}` : '',
          c.highlightBeats.length ? `爽点：${c.highlightBeats.join(' / ')}` : '',
          c.reversalMechanisms.length ? `反转：${c.reversalMechanisms.join(' / ')}` : '',
          rhythmCurve.length ? `节奏：${rhythmCurve.join('-')}` : '',
          creativeCards.length ? `卡片：${creativeCards.slice(0, 4).map((card) => `${card.title}/${card.applyTo}`).join(' / ')}` : '',
          c.riskTags.length ? `风险：${c.riskTags.join(' / ')}` : '',
        ].filter(Boolean)
        return `- ${c.title}：${pieces.join('；')}`
      })
      .join('\n')
    sections.push(block('本地样本库结构参考（仅抽象结构，不可照抄）', body))
  }

  if (freshnessReports?.length) {
    const body = freshnessReports
      .slice(0, 8)
      .map((r) => `- ${r.targetKind}${r.targetId ? `/${r.targetId}` : ''}：新鲜度${r.overallScore}，套路风险${r.tropeRiskScore}；${r.clicheSignals.slice(0, 3).join(' / ')}`)
      .join('\n')
    sections.push(block('已有新鲜度诊断', body))
  }

  if (qualityGateReports?.length) {
    const body = qualityGateReports
      .slice(0, 8)
      .map((r) => `- [${r.stage}] ${r.verdict} ${r.score}：${[...r.blockingIssues, ...r.warnings].slice(0, 4).join(' / ')}`)
      .join('\n')
    sections.push(block('已有质量闸门', body))
  }

  if (revisionTasks?.length) {
    const body = revisionTasks
      .slice(0, 10)
      .map((t) => `- [${t.status}/${t.priority}] ${t.title}：${t.suggestedAction}`)
      .join('\n')
    sections.push(block('已有修稿任务', body))
  }

  if (audienceSimulations?.length) {
    const body = audienceSimulations
      .slice(0, 5)
      .map((a) => `- ${a.audienceProfile}：留存${a.retentionScore}/新鲜${a.noveltyScore}；${a.summary}`)
      .join('\n')
    sections.push(block('已有观众模拟', body))
  }

  if (narrativeCurveReports?.length) {
    const body = narrativeCurveReports
      .slice(0, 5)
      .map((r) => `- ${r.targetKind}${r.targetId ? `/${r.targetId}` : ''}：${r.summary}；弱点：${r.weakSpots.join(' / ')}`)
      .join('\n')
    sections.push(block('已有曲线报告', body))
  }

  return sections.filter((s) => s.trim()).join('\n\n')
}
