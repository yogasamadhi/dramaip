import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { projectSkills } from '../schema'
import type { NovelTaskType, OptionalId, ProjectSkill, ProjectSkillCategory } from '@sdns/core'
import { projectSkillAppliesToTask } from '@sdns/core'
import { genId, insertRow, now, parseJsonArray, stringifyArray, updateRows } from './util'

type ProjectSkillRow = typeof projectSkills.$inferSelect

function rowToEntity(row: ProjectSkillRow): ProjectSkill {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    category: row.category as ProjectSkillCategory,
    description: row.description ?? undefined,
    taskTypes: parseJsonArray(row.taskTypes) as NovelTaskType[],
    content: row.content,
    priority: row.priority,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listProjectSkills(db: DB, projectId: string): ProjectSkill[] {
  return db
    .select()
    .from(projectSkills)
    .where(eq(projectSkills.projectId, projectId))
    .orderBy(desc(projectSkills.priority), projectSkills.createdAt)
    .all()
    .map((row) => rowToEntity(row as ProjectSkillRow))
}

export function listEnabledProjectSkills(db: DB, projectId: string): ProjectSkill[] {
  return db
    .select()
    .from(projectSkills)
    .where(and(eq(projectSkills.projectId, projectId), eq(projectSkills.enabled, true)))
    .orderBy(desc(projectSkills.priority), projectSkills.createdAt)
    .all()
    .map((row) => rowToEntity(row as ProjectSkillRow))
}

export function listProjectSkillsForTask(db: DB, projectId: string, taskType: NovelTaskType): ProjectSkill[] {
  return listEnabledProjectSkills(db, projectId).filter((skill) => projectSkillAppliesToTask(skill, taskType))
}

export function getProjectSkill(db: DB, id: string): ProjectSkill | undefined {
  const row = db.select().from(projectSkills).where(eq(projectSkills.id, id)).get()
  return row ? rowToEntity(row as ProjectSkillRow) : undefined
}

export function createProjectSkill(
  db: DB,
  data: Partial<OptionalId<ProjectSkill>> & { projectId: string; name: string; category: ProjectSkillCategory; content: string },
): ProjectSkill {
  const ts = now()
  const value: typeof projectSkills.$inferInsert = {
    id: genId(),
    projectId: data.projectId,
    name: data.name,
    category: data.category,
    description: data.description ?? null,
    taskTypes: stringifyArray(data.taskTypes),
    content: data.content,
    priority: data.priority ?? 0,
    enabled: data.enabled ?? true,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, projectSkills, value)
  return rowToEntity(row as ProjectSkillRow)
}

export function updateProjectSkill(db: DB, id: string, patch: Partial<OptionalId<ProjectSkill>>): ProjectSkill | undefined {
  const fields: Partial<typeof projectSkills.$inferInsert> = { updatedAt: now() }
  if (patch.name !== undefined) fields.name = patch.name
  if (patch.category !== undefined) fields.category = patch.category
  if (patch.description !== undefined || 'description' in patch) fields.description = patch.description ?? null
  if (patch.taskTypes !== undefined) fields.taskTypes = stringifyArray(patch.taskTypes)
  if (patch.content !== undefined) fields.content = patch.content
  if (patch.priority !== undefined) fields.priority = patch.priority
  if (patch.enabled !== undefined) fields.enabled = patch.enabled
  const [row] = updateRows(db, projectSkills, fields).where(eq(projectSkills.id, id)).returning().all()
  return row ? rowToEntity(row as ProjectSkillRow) : undefined
}

export function deleteProjectSkill(db: DB, id: string): void {
  db.delete(projectSkills).where(eq(projectSkills.id, id)).run()
}
