// agent_profiles —— Agent 配置（ROADMAP v0.8 §1）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { agentProfiles } from '../schema'
import type { AgentProfile, BuiltInAgentPreset, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type AgentRow = typeof agentProfiles.$inferSelect

function rowToEntity(row: AgentRow): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    systemPrompt: row.systemPrompt,
    outputSchema: row.outputSchema ?? undefined,
    enabled: row.enabled,
    builtIn: row.builtIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listAgentProfiles(db: DB): AgentProfile[] {
  return db
    .select()
    .from(agentProfiles)
    .orderBy(agentProfiles.createdAt)
    .all()
    .map((row) => rowToEntity(row as AgentRow))
}

/** 仅启用的 Agent（编剧室默认只跑启用的） */
export function listEnabledAgentProfiles(db: DB): AgentProfile[] {
  return listAgentProfiles(db).filter((a) => a.enabled)
}

export function getAgentProfile(db: DB, id: string): AgentProfile | undefined {
  const row = db.select().from(agentProfiles).where(eq(agentProfiles.id, id)).get()
  return row ? rowToEntity(row as AgentRow) : undefined
}

export function getAgentProfileByRole(db: DB, role: string): AgentProfile | undefined {
  const row = db.select().from(agentProfiles).where(eq(agentProfiles.role, role)).get()
  return row ? rowToEntity(row as AgentRow) : undefined
}

export function createAgentProfile(
  db: DB,
  data: Partial<OptionalId<AgentProfile>> & { name: string; role: string; systemPrompt: string },
): AgentProfile {
  const ts = now()
  const value: typeof agentProfiles.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    name: data.name,
    role: data.role,
    systemPrompt: data.systemPrompt,
    outputSchema: data.outputSchema ?? null,
    enabled: data.enabled ?? true,
    builtIn: data.builtIn ?? false,
  }
  const [row] = insertRow(db, agentProfiles, value)
  return rowToEntity(row as AgentRow)
}

export function updateAgentProfile(db: DB, id: string, patch: Partial<OptionalId<AgentProfile>>): AgentProfile | undefined {
  const [row] = updateRows(db, agentProfiles, { ...patch, updatedAt: now() })
    .where(eq(agentProfiles.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as AgentRow) : undefined
}

export function deleteAgentProfile(db: DB, id: string): void {
  db.delete(agentProfiles).where(eq(agentProfiles.id, id)).run()
}

/**
 * 首次启动 seed：按 role 幂等 upsert 内置 Agent 预设。
 * 已存在同 role 的记录只补齐缺失字段，不覆盖用户修改过的 systemPrompt。
 */
export function upsertBuiltInAgentProfiles(db: DB, presets: BuiltInAgentPreset[]): AgentProfile[] {
  const ts = now()
  const result: AgentProfile[] = []
  for (const p of presets) {
    const existing = getAgentProfileByRole(db, p.role)
    if (existing) {
      // 已存在：保证 builtIn 标记正确，其余不动
      if (!existing.builtIn) {
        const updated = updateAgentProfile(db, existing.id, { builtIn: true })
        if (updated) result.push(updated)
        else result.push(existing)
      } else {
        result.push(existing)
      }
    } else {
      const value: typeof agentProfiles.$inferInsert = {
        id: genId(),
        createdAt: ts,
        updatedAt: ts,
        name: p.name,
        role: p.role,
        systemPrompt: p.systemPrompt,
        outputSchema: p.outputSchema ?? null,
        enabled: true,
        builtIn: true,
      }
      const [row] = insertRow(db, agentProfiles, value)
      result.push(rowToEntity(row as AgentRow))
    }
  }
  return result
}
