// adaptation_projects —— AI 短剧改编项目（ROADMAP v0.4 §1）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import {
  adaptationProjects,
  projects,
  episodes,
  episodeAnalyses,
  scripts,
  scenes,
  scriptReviews,
  shots,
  shotReviews,
  promptVersions,
  videoGenerationTasks,
  videoResults,
} from '../schema'
import type { AdaptationProject, ChapterRange, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type AdaptationRow = typeof adaptationProjects.$inferSelect

/** 解析行 → 实体：把 sourceChapterRange(JSON 文本) 反序列化 */
function rowToEntity(row: AdaptationRow): AdaptationProject {
  return {
    ...(row as unknown as AdaptationProject),
    episodeDuration: row.episodeDuration ?? undefined,
    sourceChapterRange: parseChapterRange((row as { sourceChapterRange?: string | null }).sourceChapterRange),
  }
}

function parseChapterRange(value?: string | null): ChapterRange | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && 'from' in parsed && 'to' in parsed) {
      return { from: Number(parsed.from), to: Number(parsed.to) }
    }
  } catch {
    /* 忽略损坏的 JSON */
  }
  return undefined
}

export function listAdaptationProjects(db: DB): AdaptationProject[] {
  return db
    .select()
    .from(adaptationProjects)
    .orderBy(adaptationProjects.createdAt)
    .all()
    .map((row) => rowToEntity(row as AdaptationRow))
}

export function listAdaptationsByProject(db: DB, sourceProjectId: string): AdaptationProject[] {
  return db
    .select()
    .from(adaptationProjects)
    .where(eq(adaptationProjects.sourceProjectId, sourceProjectId))
    .orderBy(adaptationProjects.createdAt)
    .all()
    .map((row) => rowToEntity(row as AdaptationRow))
}

export function getAdaptationProject(db: DB, id: string): AdaptationProject | undefined {
  const row = db.select().from(adaptationProjects).where(eq(adaptationProjects.id, id)).get()
  return row ? rowToEntity(row as AdaptationRow) : undefined
}

export function createAdaptationProject(
  db: DB,
  data: Partial<OptionalId<AdaptationProject>> & { title: string; targetEpisodeCount: number; adaptationStyle: string },
): AdaptationProject {
  const ts = now()
  const value: typeof adaptationProjects.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    sourceProjectId: data.sourceProjectId ?? null,
    title: data.title,
    targetEpisodeCount: data.targetEpisodeCount,
    // 新建路径会显式传入生产 Profile 的时长建议；旧项目保留已有值，不再注入硬编码的 2 分钟规则。
    episodeDuration: data.episodeDuration ?? null,
    adaptationStyle: data.adaptationStyle,
    visualStyleDirection: data.visualStyleDirection ?? null,
    audience: data.audience ?? null,
    seasonNumber: data.seasonNumber ?? 1,
    sourceChapterRange: data.sourceChapterRange ? JSON.stringify(data.sourceChapterRange) : null,
    strategy: data.strategy ?? null,
  }
  const [row] = insertRow(db, adaptationProjects, value)
  // 新建改编就是用户刚刚选择工作的上下文；仅更新仍有效的源项目。
  if (value.sourceProjectId) {
    db.update(projects)
      .set({ activeAdaptationId: value.id, updatedAt: ts })
      .where(eq(projects.id, value.sourceProjectId))
      .run()
  }
  return rowToEntity(row as AdaptationRow)
}

export function updateAdaptationProject(
  db: DB,
  id: string,
  patch: Partial<OptionalId<AdaptationProject>>,
): AdaptationProject | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  // sourceChapterRange 需序列化
  if (fields['sourceChapterRange'] !== undefined) {
    const range = fields['sourceChapterRange'] as ChapterRange | undefined
    fields['sourceChapterRange'] = range ? JSON.stringify(range) : null
  }
  const [row] = updateRows(db, adaptationProjects, fields).where(eq(adaptationProjects.id, id)).returning().all()
  return row ? rowToEntity(row as AdaptationRow) : undefined
}

/** 删除改编项目 + 级联其分集、分析、剧本（含场景→镜头→审查/Prompt 版本）、剧本审稿 */
export function deleteAdaptationProject(db: DB, id: string): void {
  db.transaction((tx) => {
    deleteAdaptationProjectRows(tx as DB, id)
  })
}

function deleteAdaptationProjectRows(db: DB, id: string): void {
  const adaptation = getAdaptationProject(db, id)
  if (adaptation?.sourceProjectId) {
    const remaining = listAdaptationsByProject(db, adaptation.sourceProjectId).filter((item) => item.id !== id)
    const fallback = [...remaining].sort((left, right) => {
      const seasonDiff = (right.seasonNumber ?? 1) - (left.seasonNumber ?? 1)
      if (seasonDiff !== 0) return seasonDiff
      const updatedDiff = right.updatedAt.localeCompare(left.updatedAt)
      return updatedDiff || left.id.localeCompare(right.id)
    })[0]
    // 与级联删除处在同一事务中：外界不会看到一个指向已删除项目的当前上下文。
    db.update(projects)
      .set({ activeAdaptationId: fallback?.id ?? null, updatedAt: now() })
      .where(eq(projects.id, adaptation.sourceProjectId))
      .run()
  }
  // 先清空该改编项目下的剧本（剧本下的场景 → 镜头 → 审查/Prompt 版本 逐级清理）
  const scriptRows = db
    .select({ id: scripts.id })
    .from(scripts)
    .where(eq(scripts.adaptationProjectId, id))
    .all() as Array<{ id: string }>
  for (const s of scriptRows) {
    // 场景 → 其下镜头（镜头的审查 / Prompt 版本随之清理）
    const sceneRows = db.select({ id: scenes.id }).from(scenes).where(eq(scenes.scriptId, s.id)).all() as Array<{ id: string }>
    for (const sc of sceneRows) {
      const shotRows = db.select({ id: shots.id }).from(shots).where(eq(shots.sceneId, sc.id)).all() as Array<{ id: string }>
      for (const sh of shotRows) {
        deleteVideoTasksByShot(db, sh.id)
        db.delete(promptVersions).where(eq(promptVersions.shotId, sh.id)).run()
        db.delete(shotReviews).where(eq(shotReviews.shotId, sh.id)).run()
      }
      deleteVideoTasksByScene(db, sc.id)
      db.delete(shots).where(eq(shots.sceneId, sc.id)).run()
    }
    db.delete(scenes).where(eq(scenes.scriptId, s.id)).run()
    db.delete(scriptReviews).where(eq(scriptReviews.scriptId, s.id)).run()
  }
  const episodeRows = db.select({ id: episodes.id }).from(episodes).where(eq(episodes.adaptationProjectId, id)).all() as Array<{ id: string }>
  for (const episode of episodeRows) deleteVideoTasksByEpisode(db, episode.id)
  db.delete(scripts).where(eq(scripts.adaptationProjectId, id)).run()
  db.delete(episodes).where(eq(episodes.adaptationProjectId, id)).run()
  db.delete(episodeAnalyses).where(eq(episodeAnalyses.adaptationProjectId, id)).run()
  db.delete(adaptationProjects).where(eq(adaptationProjects.id, id)).run()
}

function deleteVideoTasksByShot(db: DB, shotId: string): void {
  deleteVideoTasks(db, db.select({ id: videoGenerationTasks.id }).from(videoGenerationTasks).where(eq(videoGenerationTasks.shotId, shotId)).all().map((row) => row.id))
}

function deleteVideoTasksByScene(db: DB, sceneId: string): void {
  deleteVideoTasks(db, db.select({ id: videoGenerationTasks.id }).from(videoGenerationTasks).where(eq(videoGenerationTasks.sceneId, sceneId)).all().map((row) => row.id))
}

function deleteVideoTasksByEpisode(db: DB, episodeId: string): void {
  deleteVideoTasks(db, db.select({ id: videoGenerationTasks.id }).from(videoGenerationTasks).where(eq(videoGenerationTasks.episodeId, episodeId)).all().map((row) => row.id))
}

function deleteVideoTasks(db: DB, taskIds: string[]): void {
  for (const taskId of taskIds) {
    db.delete(videoResults).where(eq(videoResults.taskId, taskId)).run()
    db.delete(videoGenerationTasks).where(eq(videoGenerationTasks.id, taskId)).run()
  }
}
