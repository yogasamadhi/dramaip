import type {
  AdaptationProject,
  Chapter,
  Character,
  CharacterVisualProfile,
  CreativeCaseStudy,
  Episode,
  NovelTaskType,
  Project,
  Scene,
  Script,
  Shot,
  StoryArc,
} from '@sdns/core'

export type AgentCommandKind = 'chapter' | 'episodes' | 'shots'
export type AgentCommandStatus = 'ready' | 'blocked'
export type AgentCommandResultMode = 'text_preview' | 'artifact_preview' | 'auto_write'

export interface AgentCommandAiInput {
  projectId?: string
  chapterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  taskType: NovelTaskType
  userInstruction?: string
}

export interface AgentCommandContext {
  projectId: string
  project?: Project | null
  activeChapter?: Chapter | null
  chapters: Chapter[]
  characters: Character[]
  storyArcs: StoryArc[]
  caseStudies: CreativeCaseStudy[]
  visualProfiles: CharacterVisualProfile[]
  adaptations: AdaptationProject[]
  episodes: Episode[]
  scripts: Script[]
  scenes: Scene[]
  shots: Shot[]
}

export interface AgentCommandPlan {
  id: string
  kind: AgentCommandKind
  status: AgentCommandStatus
  title: string
  summary: string
  targetLabel: string
  taskType: NovelTaskType
  resultMode: AgentCommandResultMode
  input?: AgentCommandAiInput
  warnings: string[]
  blockedReasons: string[]
  confirmBeforeRun?: boolean
}

const CHAPTER_TASK_HINTS: Array<{ pattern: RegExp; taskType: NovelTaskType; title: string }> = [
  { pattern: /润色|打磨|优化文风/, taskType: 'polish_chapter', title: '润色章节正文' },
  { pattern: /扩写|加细节|丰富/, taskType: 'expand_chapter', title: '扩写章节正文' },
  { pattern: /续写|接着写|继续写/, taskType: 'continue_chapter', title: '续写章节正文' },
  { pattern: /冲突|矛盾/, taskType: 'enhance_conflict', title: '增强章节冲突' },
  { pattern: /爽点|打脸|逆袭/, taskType: 'enhance_highlight', title: '增强章节爽点' },
  { pattern: /钩子|开头|开篇/, taskType: 'enhance_hook', title: '强化章节钩子' },
  { pattern: /反转/, taskType: 'enhance_reversal', title: '强化章节反转' },
  { pattern: /悬念|结尾|追看/, taskType: 'enhance_cliffhanger', title: '强化章节悬念' },
  { pattern: /短剧化|短剧感|镜头感/, taskType: 'rewrite_as_ai_drama_novel', title: '短剧化改写章节' },
  { pattern: /改写|重写|修改|调整|改一下|优化/, taskType: 'rewrite_chapter', title: '改写章节正文' },
]

export function buildAgentCommandPlan(command: string, context: AgentCommandContext): AgentCommandPlan | null {
  const text = normalizeCommand(command)
  if (!text) return null
  if (isShotCommand(text)) return buildShotPlan(command, context)
  if (isEpisodeCommand(text)) return buildEpisodePlan(command, context)
  if (isChapterCommand(text)) return buildChapterPlan(command, context)
  return null
}

function buildChapterPlan(command: string, context: AgentCommandContext): AgentCommandPlan {
  const task = inferChapterTask(command)
  const chapter = resolveChapter(command, context)
  const blockedReasons = chapter ? [] : ['未找到可执行的章节，请先新建或选择章节。']
  return {
    id: `chapter:${task.taskType}:${chapter?.id ?? 'missing'}`,
    kind: 'chapter',
    status: chapter ? 'ready' : 'blocked',
    title: task.title,
    summary: `调用 ${task.taskType}，生成正文差异预览后再由你决定是否采用。`,
    targetLabel: chapter ? chapterLabel(chapter, context.chapters) : '未选择章节',
    taskType: task.taskType,
    resultMode: 'text_preview',
    input: chapter
      ? {
          projectId: context.projectId,
          chapterId: chapter.id,
          taskType: task.taskType,
          userInstruction: command,
        }
      : undefined,
    warnings: ['不会直接覆盖正文，AI 结果会进入差异预览。'],
    blockedReasons,
  }
}

function buildEpisodePlan(command: string, context: AgentCommandContext): AgentCommandPlan {
  const adaptation = context.adaptations[0]
  const blockedReasons = adaptation ? [] : ['当前项目还没有改编项目，请先创建 AI 短剧改编项目。']
  return {
    id: `episodes:${adaptation?.id ?? 'missing'}`,
    kind: 'episodes',
    status: adaptation ? 'ready' : 'blocked',
    title: '生成分集大纲',
    summary: '调用 convert_novel_to_episodes，生成结果会先进入分集大纲预览。',
    targetLabel: adaptation ? adaptation.title : '未找到改编项目',
    taskType: 'convert_novel_to_episodes',
    resultMode: 'artifact_preview',
    input: adaptation
      ? {
          projectId: adaptation.sourceProjectId ?? context.projectId,
          adaptationProjectId: adaptation.id,
          taskType: 'convert_novel_to_episodes',
          userInstruction: command,
        }
      : undefined,
    warnings: ['采用预览后会写入该改编项目的分集大纲。'],
    blockedReasons,
  }
}

function buildShotPlan(command: string, context: AgentCommandContext): AgentCommandPlan {
  const scene = resolveSceneForShotSplit(context)
  const blockedReasons = scene ? [] : ['未找到可拆分的剧本场景，请先生成剧本并拆分场景。']
  return {
    id: `shots:${scene?.id ?? 'missing'}`,
    kind: 'shots',
    status: scene ? 'ready' : 'blocked',
    title: '拆分场景镜头',
    summary: '调用 split_scene_to_shots，把目标场景拆成镜头清单。',
    targetLabel: scene ? sceneLabel(scene, context.scenes) : '未找到场景',
    taskType: 'split_scene_to_shots',
    resultMode: 'auto_write',
    input: scene
      ? {
          projectId: context.adaptations[0]?.sourceProjectId ?? context.projectId,
          adaptationProjectId: context.adaptations[0]?.id,
          episodeId: scene.episodeId,
          sceneId: scene.id,
          taskType: 'split_scene_to_shots',
          userInstruction: command,
        }
      : undefined,
    warnings: ['该任务会替换目标场景的现有镜头列表，执行前会再次确认。'],
    blockedReasons,
    confirmBeforeRun: true,
  }
}

function isChapterCommand(text: string): boolean {
  return /(章|章节|正文|本章|当前章)/.test(text) && /(生成|续写|改|润色|扩写|强化|优化|重写|调整)/.test(text)
}

function isEpisodeCommand(text: string): boolean {
  return /(分集|集大纲|剧集|改编大纲)/.test(text) && /(生成|创建|转|输出|做)/.test(text)
}

function isShotCommand(text: string): boolean {
  return /(拆.*镜头|镜头.*拆|拆分镜头|分镜)/.test(text)
}

function inferChapterTask(command: string): { taskType: NovelTaskType; title: string } {
  const normalized = normalizeCommand(command)
  return CHAPTER_TASK_HINTS.find((hint) => hint.pattern.test(normalized)) ?? {
    taskType: 'rewrite_chapter',
    title: '改写章节正文',
  }
}

function resolveChapter(command: string, context: AgentCommandContext): Chapter | undefined {
  const requestedNumber = parseRequestedChapterNumber(command)
  if (requestedNumber !== null) {
    return context.chapters.find((chapter) => chapter.orderIndex === requestedNumber - 1)
      ?? context.chapters[requestedNumber - 1]
  }
  return context.activeChapter ?? context.chapters.find((chapter) => hasText(chapter.content)) ?? context.chapters[0]
}

function resolveSceneForShotSplit(context: AgentCommandContext): Scene | undefined {
  const scenesWithShotState = context.scenes.map((scene) => ({
    scene,
    shotCount: context.shots.filter((shot) => shot.sceneId === scene.id).length,
  }))
  return scenesWithShotState.find((item) => item.shotCount === 0)?.scene ?? scenesWithShotState[0]?.scene
}

function parseRequestedChapterNumber(command: string): number | null {
  const match = normalizeCommand(command).match(/第\s*([0-9一二两三四五六七八九十百]+)\s*[章节]/)
  if (!match) return null
  return parseLooseNumber(match[1])
}

function parseLooseNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw)
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (raw === '十') return 10
  const tenIndex = raw.indexOf('十')
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : digits[raw[tenIndex - 1]] ?? 0
    const ones = tenIndex === raw.length - 1 ? 0 : digits[raw[tenIndex + 1]] ?? 0
    const value = tens * 10 + ones
    return value > 0 ? value : null
  }
  return digits[raw] ?? null
}

function chapterLabel(chapter: Chapter, chapters: Chapter[]): string {
  const index = chapters.findIndex((item) => item.id === chapter.id)
  return `${index >= 0 ? `第 ${index + 1} 章 · ` : ''}${chapter.title}`
}

function sceneLabel(scene: Scene, scenes: Scene[]): string {
  const index = scenes.findIndex((item) => item.id === scene.id)
  return `${index >= 0 ? `场景 ${index + 1} · ` : ''}${scene.title}`
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, '')
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim())
}
