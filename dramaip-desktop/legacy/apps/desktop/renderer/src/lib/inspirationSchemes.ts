import type { Chapter, InspirationSchemeItem, Project } from '@sdns/core'

export interface InspirationSchemeForm {
  genre: string
  targetAudience: string
  shortDramaDirection: string
  brief?: string
}

export interface InspirationProjectSeed {
  title: string
  type: string
  audience: string
  direction: string
  hook: string
  idea: string
}

export function normalizeInspirationSchemeForm(form: InspirationSchemeForm, project?: Project): InspirationSchemeForm {
  return {
    genre: form.genre.trim() || project?.shortDramaType?.trim() || '短剧小说',
    targetAudience: form.targetAudience.trim() || project?.targetAudience?.trim() || '短剧核心用户',
    shortDramaDirection: form.shortDramaDirection.trim() || project?.coreSellingPoint?.trim() || '强钩子、强反转、强追看',
    brief: form.brief?.trim(),
  }
}

export function buildInspirationSchemeInstruction(form: InspirationSchemeForm): string {
  const normalized = normalizeInspirationSchemeForm(form)
  return [
    `题材：${normalized.genre}`,
    `目标受众：${normalized.targetAudience}`,
    `短剧方向：${normalized.shortDramaDirection}`,
    normalized.brief ? `补充要求：${normalized.brief}` : '',
    '请生成 3-5 组差异化方案，每组都要能进入项目创建或章节改写。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function schemeToProjectSeed(scheme: InspirationSchemeItem, fallback: InspirationSchemeForm): InspirationProjectSeed {
  const normalized = normalizeInspirationSchemeForm(fallback)
  const title = scheme.title.trim() || '未命名灵感方案'
  const hook = scheme.coreHook.trim()
  const idea = [
    scheme.projectSeed || scheme.premise,
    scheme.emotionalCore ? `情绪主轴：${scheme.emotionalCore}` : '',
    scheme.protagonist ? `主角：${scheme.protagonist}` : '',
    scheme.relationship ? `人物关系：${scheme.relationship}` : '',
    `冲突机制：${scheme.conflictMechanism}`,
    `开局钩子：${scheme.openingHook}`,
    `关键反转：${scheme.keyReversal}`,
    `集尾悬念：${scheme.cliffhanger}`,
    `视频画面卖点：${scheme.visualSellingPoint}`,
    scheme.differentiation ? `差异点：${scheme.differentiation}` : '',
    scheme.riskNotes.length ? `风险提示：${scheme.riskNotes.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    title,
    type: scheme.genre?.trim() || normalized.genre,
    audience: scheme.targetAudience?.trim() || normalized.targetAudience,
    direction: scheme.shortDramaDirection?.trim() || normalized.shortDramaDirection,
    hook,
    idea,
  }
}

export function buildSchemeRewriteInstruction(scheme: InspirationSchemeItem, chapter?: Chapter): string {
  return [
    `请按灵感方案「${scheme.title}」改写${chapter?.title ? `《${chapter.title}》` : '当前章节'}。`,
    `核心钩子：${scheme.coreHook}`,
    `故事前提：${scheme.premise}`,
    `冲突机制：${scheme.conflictMechanism}`,
    `开局钩子：${scheme.openingHook}`,
    `关键反转：${scheme.keyReversal}`,
    `章尾/集尾悬念：${scheme.cliffhanger}`,
    `视频画面卖点：${scheme.visualSellingPoint}`,
    scheme.chapterRewriteBrief ? `改写要求：${scheme.chapterRewriteBrief}` : '',
    scheme.relationship ? `人物关系：${scheme.relationship}` : '',
    scheme.riskNotes.length ? `注意规避：${scheme.riskNotes.join('；')}` : '',
    '保留原章节已成立的人物称谓和必要事实，输出完整改写正文。',
  ]
    .filter(Boolean)
    .join('\n')
}
