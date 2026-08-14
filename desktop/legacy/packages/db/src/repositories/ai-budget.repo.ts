import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { aiBudgetSettings } from '../schema'
import type { AiBudgetSettings } from '@sdns/core'
import { now, updateRows, insertRow } from './util'

const GLOBAL_ID = 'global'

type BudgetRow = typeof aiBudgetSettings.$inferSelect

function rowToEntity(row: BudgetRow): AiBudgetSettings {
  return {
    id: 'global',
    singleRunTokenLimit: row.singleRunTokenLimit ?? undefined,
    dailyTokenLimit: row.dailyTokenLimit ?? undefined,
    singleRunCostLimit: row.singleRunCostLimit ?? undefined,
    dailyCostLimit: row.dailyCostLimit ?? undefined,
    costPer1kTokens: row.costPer1kTokens,
    currency: row.currency,
    updatedAt: row.updatedAt,
  }
}

export function defaultAiBudgetSettings(): AiBudgetSettings {
  return {
    id: 'global',
    costPer1kTokens: 0,
    currency: 'USD',
    updatedAt: now(),
  }
}

export function getAiBudgetSettings(db: DB): AiBudgetSettings {
  const row = db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, GLOBAL_ID)).get()
  return row ? rowToEntity(row as BudgetRow) : defaultAiBudgetSettings()
}

export function upsertAiBudgetSettings(
  db: DB,
  patch: Partial<Omit<AiBudgetSettings, 'id' | 'updatedAt'>>,
): AiBudgetSettings {
  const existing = db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, GLOBAL_ID)).get()
  const base = existing ? rowToEntity(existing as BudgetRow) : defaultAiBudgetSettings()
  const value = normalizeBudgetPatch(patch, base)
  if (existing) {
    const [row] = updateRows(db, aiBudgetSettings, { ...value, updatedAt: now() })
      .where(eq(aiBudgetSettings.id, GLOBAL_ID))
      .returning()
      .all()
    return rowToEntity(row as BudgetRow)
  }
  const [row] = insertRow(db, aiBudgetSettings, {
    id: GLOBAL_ID,
    ...value,
    updatedAt: now(),
  })
  return rowToEntity(row as BudgetRow)
}

function normalizeBudgetPatch(
  patch: Partial<Omit<AiBudgetSettings, 'id' | 'updatedAt'>>,
  base: AiBudgetSettings,
) {
  return {
    singleRunTokenLimit: fieldProvided(patch, 'singleRunTokenLimit')
      ? positiveIntOrNull(patch.singleRunTokenLimit)
      : (base.singleRunTokenLimit ?? null),
    dailyTokenLimit: fieldProvided(patch, 'dailyTokenLimit')
      ? positiveIntOrNull(patch.dailyTokenLimit)
      : (base.dailyTokenLimit ?? null),
    singleRunCostLimit: fieldProvided(patch, 'singleRunCostLimit')
      ? positiveNumberOrNull(patch.singleRunCostLimit)
      : (base.singleRunCostLimit ?? null),
    dailyCostLimit: fieldProvided(patch, 'dailyCostLimit')
      ? positiveNumberOrNull(patch.dailyCostLimit)
      : (base.dailyCostLimit ?? null),
    costPer1kTokens: fieldProvided(patch, 'costPer1kTokens')
      ? Math.max(0, Number(patch.costPer1kTokens ?? 0))
      : base.costPer1kTokens,
    currency: fieldProvided(patch, 'currency') ? patch.currency?.trim() || 'USD' : base.currency,
  }
}

function fieldProvided<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function positiveIntOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function positiveNumberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
