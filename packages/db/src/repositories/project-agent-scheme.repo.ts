import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { projectAgentSchemes } from '../schema'
import type { OptionalId, ProjectAgentScheme } from '@sdns/core'
import { genId, insertRow, now, parseJsonArray, parseJsonObject, stringifyArray, stringifyJson, updateRows } from './util'

type ProjectAgentSchemeRow = typeof projectAgentSchemes.$inferSelect

function normalizeModelBindings(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, modelConfigId]) => typeof modelConfigId === 'string' && modelConfigId.trim().length > 0)
      .map(([taskGroup, modelConfigId]) => [taskGroup, String(modelConfigId)]),
  )
}

function rowToEntity(row: ProjectAgentSchemeRow): ProjectAgentScheme {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? undefined,
    primaryAgentId: row.primaryAgentId ?? undefined,
    agentIds: parseJsonArray(row.agentIds, 'project_agent_schemes.agent_ids'),
    skillIds: parseJsonArray(row.skillIds, 'project_agent_schemes.skill_ids'),
    modelBindings: normalizeModelBindings(
      parseJsonObject<Record<string, unknown>>(row.modelBindings, {}, 'project_agent_schemes.model_bindings'),
    ),
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listProjectAgentSchemes(db: DB, projectId: string): ProjectAgentScheme[] {
  return db
    .select()
    .from(projectAgentSchemes)
    .where(eq(projectAgentSchemes.projectId, projectId))
    .orderBy(desc(projectAgentSchemes.active), desc(projectAgentSchemes.updatedAt))
    .all()
    .map((row) => rowToEntity(row as ProjectAgentSchemeRow))
}

export function getProjectAgentScheme(db: DB, id: string): ProjectAgentScheme | undefined {
  const row = db.select().from(projectAgentSchemes).where(eq(projectAgentSchemes.id, id)).get()
  return row ? rowToEntity(row as ProjectAgentSchemeRow) : undefined
}

export function getActiveProjectAgentScheme(db: DB, projectId: string): ProjectAgentScheme | undefined {
  const row = db
    .select()
    .from(projectAgentSchemes)
    .where(and(eq(projectAgentSchemes.projectId, projectId), eq(projectAgentSchemes.active, true)))
    .orderBy(desc(projectAgentSchemes.updatedAt))
    .get()
  return row ? rowToEntity(row as ProjectAgentSchemeRow) : undefined
}

function deactivateProjectSchemes(db: DB, projectId: string): void {
  updateRows(db, projectAgentSchemes, { active: false, updatedAt: now() })
    .where(eq(projectAgentSchemes.projectId, projectId))
    .run()
}

export function createProjectAgentScheme(
  db: DB,
  data: Partial<OptionalId<ProjectAgentScheme>> & { projectId: string; name: string },
): ProjectAgentScheme {
  const ts = now()
  const shouldActivate = data.active ?? getActiveProjectAgentScheme(db, data.projectId) === undefined
  if (shouldActivate) deactivateProjectSchemes(db, data.projectId)
  const value: typeof projectAgentSchemes.$inferInsert = {
    id: genId(),
    projectId: data.projectId,
    name: data.name,
    description: data.description ?? null,
    primaryAgentId: data.primaryAgentId ?? null,
    agentIds: stringifyArray(data.agentIds),
    skillIds: stringifyArray(data.skillIds),
    modelBindings: stringifyJson(data.modelBindings ?? {}),
    active: shouldActivate,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, projectAgentSchemes, value)
  return rowToEntity(row as ProjectAgentSchemeRow)
}

export function updateProjectAgentScheme(
  db: DB,
  id: string,
  patch: Partial<OptionalId<ProjectAgentScheme>>,
): ProjectAgentScheme | undefined {
  const current = getProjectAgentScheme(db, id)
  if (!current) return undefined
  if (patch.active === true) deactivateProjectSchemes(db, current.projectId)
  const fields: Partial<typeof projectAgentSchemes.$inferInsert> = { updatedAt: now() }
  if (patch.name !== undefined) fields.name = patch.name
  if (patch.description !== undefined || 'description' in patch) fields.description = patch.description ?? null
  if (patch.primaryAgentId !== undefined || 'primaryAgentId' in patch) fields.primaryAgentId = patch.primaryAgentId ?? null
  if (patch.agentIds !== undefined) fields.agentIds = stringifyArray(patch.agentIds)
  if (patch.skillIds !== undefined) fields.skillIds = stringifyArray(patch.skillIds)
  if (patch.modelBindings !== undefined) fields.modelBindings = stringifyJson(patch.modelBindings)
  if (patch.active !== undefined) fields.active = patch.active
  const [row] = updateRows(db, projectAgentSchemes, fields).where(eq(projectAgentSchemes.id, id)).returning().all()
  return row ? rowToEntity(row as ProjectAgentSchemeRow) : undefined
}

export function setActiveProjectAgentScheme(db: DB, id: string): ProjectAgentScheme | undefined {
  return updateProjectAgentScheme(db, id, { active: true })
}

export function deleteProjectAgentScheme(db: DB, id: string): void {
  db.delete(projectAgentSchemes).where(eq(projectAgentSchemes.id, id)).run()
}
