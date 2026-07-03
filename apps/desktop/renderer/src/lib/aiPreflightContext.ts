import type {
  AiContextControlCollection,
  AiContextControls,
  AiContextPreview,
  AiContextPreviewSection,
  Chapter,
  Character,
  CharacterVisualProfile,
  CreativeCaseStudy,
  NovelTaskType,
  Project,
  StoryArc,
} from '@sdns/core'

export type AiContextControlKey = keyof AiContextControlCollection
export type AiContextControlMode = 'auto' | 'pinned' | 'excluded'

export interface AiContextControlItem {
  key: AiContextControlKey
  id: string
  label: string
  detail?: string
  mode: AiContextControlMode
}

export interface AiContextControlGroup {
  key: AiContextControlKey
  title: string
  items: AiContextControlItem[]
}

export interface AiPreflightContextData {
  project?: Project | null
  chapters: Chapter[]
  characters: Character[]
  storyArcs: StoryArc[]
  caseStudies: CreativeCaseStudy[]
  visualProfiles: CharacterVisualProfile[]
}

export interface AiPreflightContextResult {
  preview: AiContextPreview
  groups: AiContextControlGroup[]
}

const DEFAULT_CONTEXT_TOKEN_BUDGET = 5_000
const CONTEXT_TOKEN_BUDGETS: Partial<Record<NovelTaskType, number>> = {
  chat_project: 3_500,
  convert_novel_to_episodes: 6_500,
  generate_story_arc_outline: 6_500,
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

export function buildAiPreflightContext(
  taskType: NovelTaskType,
  data: AiPreflightContextData,
  controls: AiContextControls = {},
): AiPreflightContextResult {
  const chapters = applyControls(data.chapters, 'chapters', controls)
  const characters = applyControls(data.characters, 'characters', controls)
  const storyArcs = applyControls(data.storyArcs, 'storyArcs', controls)
  const caseStudies = applyControls(data.caseStudies, 'caseStudies', controls)
  const visualProfiles = applyControls(data.visualProfiles, 'visualProfiles', controls)
  const rawSections = buildRawSections({ ...data, chapters, characters, storyArcs, caseStudies, visualProfiles }, controls)
  const budget = CONTEXT_TOKEN_BUDGETS[taskType] ?? DEFAULT_CONTEXT_TOKEN_BUDGET
  const { sections, trimmedTitles } = applyPreviewBudget(rawSections, budget)
  if (trimmedTitles.length) {
    sections.push(section('上下文裁剪说明', `预算约 ${budget.toLocaleString()} tokens；已裁剪：${trimmedTitles.join('、')}`))
  } else {
    sections.push(section('上下文裁剪说明', `预算约 ${budget.toLocaleString()} tokens；当前预览未触发裁剪。`))
  }
  const contextChars = sections.reduce((sum, item) => sum + item.charCount, 0)
  const estimatedContextTokens = sections.reduce((sum, item) => sum + item.estimatedTokens, 0)

  return {
    preview: {
      aiRunId: 'preflight',
      taskType,
      provider: 'preflight',
      model: 'pending',
      status: 'success',
      createdAt: new Date().toISOString(),
      inputChars: contextChars,
      estimatedInputTokens: estimatedContextTokens,
      contextChars,
      estimatedContextTokens,
      redacted: true,
      sections,
    },
    groups: buildControlGroups(data, controls),
  }
}

export function setAiContextControlMode(
  controls: AiContextControls,
  key: AiContextControlKey,
  id: string,
  mode: AiContextControlMode,
): AiContextControls {
  const next: AiContextControls = {
    pinned: { ...(controls.pinned ?? {}) },
    excluded: { ...(controls.excluded ?? {}) },
  }
  next.pinned![key] = withoutId(next.pinned?.[key], id)
  next.excluded![key] = withoutId(next.excluded?.[key], id)
  if (mode === 'pinned') next.pinned![key] = [...(next.pinned?.[key] ?? []), id]
  if (mode === 'excluded') next.excluded![key] = [...(next.excluded?.[key] ?? []), id]
  return compactControls(next)
}

function buildRawSections(data: AiPreflightContextData, controls: AiContextControls): AiContextPreviewSection[] {
  const sections: AiContextPreviewSection[] = []
  const controlLines = [
    controlLine('固定章节', controls.pinned?.chapters),
    controlLine('排除章节', controls.excluded?.chapters),
    controlLine('固定人物', controls.pinned?.characters),
    controlLine('排除人物', controls.excluded?.characters),
    controlLine('固定长篇规划', controls.pinned?.storyArcs),
    controlLine('排除长篇规划', controls.excluded?.storyArcs),
    controlLine('固定样本', controls.pinned?.caseStudies),
    controlLine('排除样本', controls.excluded?.caseStudies),
    controlLine('固定视觉档案', controls.pinned?.visualProfiles),
    controlLine('排除视觉档案', controls.excluded?.visualProfiles),
  ].filter(Boolean)
  sections.push(section('上下文控制', controlLines.length ? controlLines.join('\n') : '当前使用自动选择。'))

  if (data.project) {
    sections.push(section('项目设定', [
      line('作品名称', data.project.title),
      line('短剧类型', data.project.shortDramaType),
      line('目标受众', data.project.targetAudience),
      line('核心卖点', data.project.coreSellingPoint),
      line('一句话卖点', data.project.coreHook),
      line('故事简介', data.project.synopsis),
      line('视觉风格方向', data.project.visualStyleDirection),
    ].filter(Boolean).join('\n')))
  }

  if (data.chapters.length) {
    sections.push(section('章节上下文', data.chapters.slice(0, 30).map((chapter, index) =>
      `- 第 ${index + 1} 章 ${chapter.title}：${chapter.summary || excerptText(chapter.content, 120) || '暂无摘要'}`,
    ).join('\n')))
  }

  if (data.characters.length) {
    sections.push(section('人物上下文', data.characters.slice(0, 40).map((character) =>
      `- ${character.name}（${character.role}）：${[character.identity, character.personality, character.desire].filter(Boolean).join('；') || '暂无补充'}`,
    ).join('\n')))
  }

  if (data.storyArcs.length) {
    const parentById = new Map(data.storyArcs.map((arc) => [arc.id, arc.title]))
    sections.push(section('长篇规划', data.storyArcs.slice(0, 60).map((arc) => {
      const parent = arc.parentId ? `上级：${parentById.get(arc.parentId) ?? arc.parentId}；` : ''
      const range = arc.chapterStart || arc.chapterEnd ? `章节：${arc.chapterStart ?? '?'}-${arc.chapterEnd ?? '?'}；` : ''
      const target = [arc.targetChapterCount ? `${arc.targetChapterCount}章` : '', arc.targetWordCount ? `${arc.targetWordCount}字` : ''].filter(Boolean).join('/')
      return `- ${arc.title}（${arc.kind}）：${parent}${range}${target ? `目标：${target}；` : ''}${arc.coreConflict || arc.summary || '暂无补充'}`
    }).join('\n')))
  }

  if (data.caseStudies.length) {
    sections.push(section('样本结构', data.caseStudies.slice(0, 20).map((study) =>
      `- ${study.title}：${study.summary || [...study.openingHooks, ...study.highlightBeats].slice(0, 3).join('；') || '结构标签待补充'}`,
    ).join('\n')))
  }

  if (data.visualProfiles.length) {
    sections.push(section('视觉档案', data.visualProfiles.slice(0, 30).map((profile) =>
      `- ${profile.characterId}：${[profile.appearancePrompt, profile.faceDescription, profile.clothingStyle].filter(Boolean).join('；')}`,
    ).join('\n')))
  }

  return sections.filter((item) => item.charCount > 0)
}

function buildControlGroups(data: AiPreflightContextData, controls: AiContextControls): AiContextControlGroup[] {
  const groups: AiContextControlGroup[] = [
    {
      key: 'chapters',
      title: '章节',
      items: data.chapters.slice(0, 40).map((chapter, index) => ({
        key: 'chapters',
        id: chapter.id,
        label: `第 ${index + 1} 章 · ${chapter.title}`,
        detail: chapter.summary || excerptText(chapter.content, 48),
        mode: modeFor(controls, 'chapters', chapter.id),
      })),
    },
    {
      key: 'characters',
      title: '人物',
      items: data.characters.slice(0, 40).map((character) => ({
        key: 'characters',
        id: character.id,
        label: `${character.name}（${character.role}）`,
        detail: [character.identity, character.desire].filter(Boolean).join('；'),
        mode: modeFor(controls, 'characters', character.id),
      })),
    },
    {
      key: 'storyArcs',
      title: '长篇规划',
      items: data.storyArcs.slice(0, 60).map((arc) => ({
        key: 'storyArcs',
        id: arc.id,
        label: arc.title,
        detail: [arc.coreConflict, arc.summary].filter(Boolean).join('；'),
        mode: modeFor(controls, 'storyArcs', arc.id),
      })),
    },
    {
      key: 'caseStudies',
      title: '样本',
      items: data.caseStudies.slice(0, 30).map((study) => ({
        key: 'caseStudies',
        id: study.id,
        label: study.title,
        detail: study.genre || study.summary,
        mode: modeFor(controls, 'caseStudies', study.id),
      })),
    },
    {
      key: 'visualProfiles',
      title: '视觉档案',
      items: data.visualProfiles.slice(0, 30).map((profile) => ({
        key: 'visualProfiles',
        id: profile.id,
        label: profile.characterId,
        detail: profile.appearancePrompt,
        mode: modeFor(controls, 'visualProfiles', profile.id),
      })),
    },
  ]
  return groups.filter((group) => group.items.length > 0)
}

function applyControls<T extends { id: string }>(items: T[], key: AiContextControlKey, controls: AiContextControls): T[] {
  const excluded = new Set(controls.excluded?.[key] ?? [])
  const pinned = new Set(controls.pinned?.[key] ?? [])
  const filtered = items.filter((item) => !excluded.has(item.id))
  return [
    ...filtered.filter((item) => pinned.has(item.id)),
    ...filtered.filter((item) => !pinned.has(item.id)),
  ]
}

function applyPreviewBudget(sections: AiContextPreviewSection[], budget: number): { sections: AiContextPreviewSection[]; trimmedTitles: string[] } {
  const kept: AiContextPreviewSection[] = []
  const trimmedTitles: string[] = []
  let tokens = 0
  for (const item of sections) {
    if (tokens + item.estimatedTokens <= budget) {
      kept.push(item)
      tokens += item.estimatedTokens
    } else {
      trimmedTitles.push(item.title)
    }
  }
  return { sections: kept, trimmedTitles }
}

function section(title: string, body: string): AiContextPreviewSection {
  const normalized = body.trim()
  return {
    title,
    charCount: normalized.length,
    estimatedTokens: estimateTokens(normalized),
    excerpt: excerptText(normalized, 700),
  }
}

function estimateTokens(text: string): number {
  if (!text.trim()) return 0
  return Math.ceil(text.replace(/\s+/g, ' ').length / 2)
}

function excerptText(value: string | undefined, limit: number): string {
  const text = (value ?? '').replace(/\n{3,}/g, '\n\n').trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text
}

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return ''
  return `- ${label}：${value}`
}

function controlLine(label: string, ids?: string[]): string {
  return ids?.length ? `- ${label}：${ids.length} 项` : ''
}

function modeFor(controls: AiContextControls, key: AiContextControlKey, id: string): AiContextControlMode {
  if (controls.excluded?.[key]?.includes(id)) return 'excluded'
  if (controls.pinned?.[key]?.includes(id)) return 'pinned'
  return 'auto'
}

function withoutId(ids: string[] | undefined, id: string): string[] {
  return (ids ?? []).filter((item) => item !== id)
}

function compactControls(controls: AiContextControls): AiContextControls {
  return {
    pinned: compactCollection(controls.pinned),
    excluded: compactCollection(controls.excluded),
  }
}

function compactCollection(collection: AiContextControlCollection | undefined): AiContextControlCollection | undefined {
  if (!collection) return undefined
  const next: AiContextControlCollection = {}
  for (const key of ['chapters', 'characters', 'caseStudies', 'visualProfiles'] as const) {
    const values = collection[key]
    if (values?.length) next[key] = values
  }
  return Object.keys(next).length ? next : undefined
}
