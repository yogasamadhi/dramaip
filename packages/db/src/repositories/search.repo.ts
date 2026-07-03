import { desc, eq, like, or } from 'drizzle-orm'
import type { GlobalSearchResponse, GlobalSearchResult, GlobalSearchResultKind } from '@sdns/core'
import type { DB } from '../client'
import { aiRuns, characters, chapters, projects, scenes, scripts, shots } from '../schema'

interface SearchInput {
  query: string
  limit?: number
}

const DEFAULT_LIMIT_PER_KIND = 8
const MAX_LIMIT_PER_KIND = 20
const SNIPPET_LENGTH = 96

export function globalSearch(db: DB, input: SearchInput): GlobalSearchResponse {
  const query = normalizeQuery(input.query)
  if (!query) return { query, results: [], total: 0 }

  const limit = clampLimit(input.limit)
  const term = `%${query}%`
  const results: GlobalSearchResult[] = [
    ...searchProjects(db, query, term, limit),
    ...searchCharacters(db, query, term, limit),
    ...searchChapters(db, query, term, limit),
    ...searchScripts(db, query, term, limit),
    ...searchScenes(db, query, term, limit),
    ...searchShots(db, query, term, limit),
    ...searchAiRuns(db, query, term, limit),
  ]

  return { query, results, total: results.length }
}

function searchProjects(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(projects)
    .where(or(
      like(projects.title, term),
      like(projects.shortDramaType, term),
      like(projects.coreHook, term),
      like(projects.synopsis, term),
      like(projects.visualStyleDirection, term),
    ))
    .orderBy(desc(projects.updatedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      kind: 'project',
      title: row.title,
      subtitle: row.shortDramaType,
      snippet: snippet(query, row.coreHook, row.synopsis, row.visualStyleDirection),
      route: `/projects/${row.id}?section=overview`,
      projectId: row.id,
      updatedAt: row.updatedAt,
    }))
}

function searchCharacters(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(characters)
    .where(or(
      like(characters.name, term),
      like(characters.role, term),
      like(characters.identity, term),
      like(characters.personality, term),
      like(characters.desire, term),
      like(characters.secret, term),
      like(characters.appearancePrompt, term),
      like(characters.notes, term),
    ))
    .orderBy(desc(characters.updatedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      kind: 'character',
      title: row.name,
      subtitle: row.role,
      snippet: snippet(query, row.identity, row.personality, row.desire, row.secret, row.appearancePrompt, row.notes),
      route: `/projects/${row.projectId}?section=characters`,
      projectId: row.projectId,
      updatedAt: row.updatedAt,
    }))
}

function searchChapters(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(chapters)
    .where(or(
      like(chapters.title, term),
      like(chapters.summary, term),
      like(chapters.outline, term),
      like(chapters.content, term),
      like(chapters.hook, term),
      like(chapters.highlight, term),
      like(chapters.aiVideoNote, term),
    ))
    .orderBy(desc(chapters.updatedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      kind: 'chapter',
      title: row.title,
      subtitle: '章节',
      snippet: snippet(query, row.summary, row.outline, row.content, row.hook, row.highlight, row.aiVideoNote),
      route: `/projects/${row.projectId}?section=chapters&chapter=${row.id}`,
      projectId: row.projectId,
      updatedAt: row.updatedAt,
    }))
}

function searchScripts(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(scripts)
    .where(or(
      like(scripts.title, term),
      like(scripts.content, term),
      like(scripts.hook, term),
      like(scripts.mainConflict, term),
      like(scripts.cliffhanger, term),
    ))
    .orderBy(desc(scripts.updatedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      kind: 'script',
      title: row.title,
      subtitle: `第 ${row.episodeNumber} 集剧本`,
      snippet: snippet(query, row.content, row.hook, row.mainConflict, row.cliffhanger),
      route: `/adaptations/${row.adaptationProjectId}/scripts?script=${row.id}`,
      updatedAt: row.updatedAt,
    }))
}

function searchScenes(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(scenes)
    .where(or(
      like(scenes.title, term),
      like(scenes.location, term),
      like(scenes.visualDescription, term),
      like(scenes.summary, term),
      like(scenes.characters, term),
    ))
    .orderBy(desc(scenes.updatedAt))
    .limit(limit)
    .all()
    .flatMap((row) => {
      const script = getScriptRouteContext(db, row.scriptId)
      if (!script) return []
      return [{
        id: row.id,
        kind: 'scene' as GlobalSearchResultKind,
        title: row.title,
        subtitle: `${script.title} / 第 ${row.sceneNumber} 场`,
        snippet: snippet(query, row.location, row.visualDescription, row.summary, row.characters),
        route: `/adaptations/${script.adaptationProjectId}/shots?episode=${row.episodeId}&scene=${row.id}`,
        updatedAt: row.updatedAt,
      }]
    })
}

function searchShots(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(shots)
    .where(or(
      like(shots.visualDescription, term),
      like(shots.dialogue, term),
      like(shots.narration, term),
      like(shots.subtitleDraft, term),
      like(shots.videoPrompt, term),
      like(shots.negativePrompt, term),
      like(shots.imagePrompt, term),
      like(shots.coverPrompt, term),
      like(shots.consistencyNotes, term),
    ))
    .orderBy(desc(shots.updatedAt))
    .limit(limit)
    .all()
    .flatMap((row) => {
      const scene = db.select().from(scenes).where(eq(scenes.id, row.sceneId)).get()
      if (!scene) return []
      const script = getScriptRouteContext(db, scene.scriptId)
      if (!script) return []
      return [{
        id: row.id,
        kind: 'shot' as GlobalSearchResultKind,
        title: `第 ${row.shotNumber} 镜`,
        subtitle: `${script.title} / ${scene.title}`,
        snippet: snippet(query, row.visualDescription, row.dialogue, row.narration, row.subtitleDraft, row.videoPrompt, row.negativePrompt, row.imagePrompt, row.coverPrompt, row.consistencyNotes),
        route: `/adaptations/${script.adaptationProjectId}/shots?episode=${row.episodeId}&scene=${row.sceneId}&shot=${row.id}`,
        updatedAt: row.updatedAt,
      }]
    })
}

function searchAiRuns(db: DB, query: string, term: string, limit: number): GlobalSearchResult[] {
  return db
    .select()
    .from(aiRuns)
    .where(or(
      like(aiRuns.type, term),
      like(aiRuns.provider, term),
      like(aiRuns.model, term),
      like(aiRuns.input, term),
      like(aiRuns.output, term),
      like(aiRuns.errorMessage, term),
    ))
    .orderBy(desc(aiRuns.createdAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      kind: 'ai_run',
      title: row.type,
      subtitle: `${row.status} / ${row.model}`,
      snippet: snippet(query, row.errorMessage, row.output, row.input),
      route: row.projectId ? `/projects/${row.projectId}?section=ai-runs` : '/settings/diagnostics',
      projectId: row.projectId ?? undefined,
      updatedAt: row.createdAt,
    }))
}

function getScriptRouteContext(db: DB, scriptId: string): { title: string; adaptationProjectId: string } | undefined {
  const row = db
    .select({ title: scripts.title, adaptationProjectId: scripts.adaptationProjectId })
    .from(scripts)
    .where(eq(scripts.id, scriptId))
    .get()
  return row ?? undefined
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT_PER_KIND
  return Math.min(MAX_LIMIT_PER_KIND, Math.max(1, Math.floor(limit)))
}

function snippet(query: string, ...values: Array<string | number | null | undefined>): string | undefined {
  const text = values
    .map((value) => String(value ?? '').replace(/\s+/g, ' ').trim())
    .find((value) => value.length > 0)
  if (!text) return undefined
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text.slice(0, SNIPPET_LENGTH)
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, start + SNIPPET_LENGTH)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
