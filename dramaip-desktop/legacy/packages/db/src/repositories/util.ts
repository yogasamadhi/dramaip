import { randomUUID } from 'node:crypto'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { DB } from '../client'

export const genId = (): string => randomUUID()
export const now = (): string => new Date().toISOString()

function parseJson<T>(value: string | null | undefined, fallback: T, label: string): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    console.warn(`[db] 忽略无法解析的 JSON 字段：${label}`)
    return fallback
  }
}

export function parseJsonArray(value: string | null | undefined, label = 'json-array'): string[] {
  const parsed = parseJson<unknown>(value, [], label)
  return Array.isArray(parsed) ? parsed.map((v) => String(v)) : []
}

export function parseJsonObject<T extends Record<string, unknown>>(
  value: string | null | undefined,
  fallback: T,
  label = 'json-object',
): T {
  const parsed = parseJson<unknown>(value, fallback, label)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : fallback
}

export const stringifyArray = (value: string[] | undefined): string => JSON.stringify(value ?? [])
export const stringifyJson = (value: unknown): string => JSON.stringify(value ?? null)

export function normalizeStringArrayPatch<T extends Record<string, unknown>>(patch: T, keys: string[]): T {
  const normalized: Record<string, unknown> = { ...patch }
  for (const key of keys) {
    if (Array.isArray(normalized[key])) normalized[key] = stringifyArray(normalized[key] as string[])
  }
  return normalized as T
}

/**
 * 插入一行并返回结果。
 *
 * 背景：drizzle-orm 的 `.values()` 重载签名内部依赖深层条件类型
 * `SQLiteInsertValue<TTable>`；当本程序同时引入 zod（经 @sdns/core）且表较宽时，
 * TypeScript 的类型实例化预算会超限，导致签名无法解析、`.values()` 误匹配到数组重载，
 * 报 TS2488「must have a [Symbol.iterator]」。这是 TS + drizzle + zod 的已知限制。
 *
 * 这里用泛型 TTable（保持未实例化）+ 对 builder 做 cast 来绕过签名解析；
 * value 仍由调用方以 `typeof table.$inferInsert` 显式标注，字段校验不受影响。
 */
export function insertRow<TTable extends SQLiteTable>(
  db: DB,
  table: TTable,
  value: TTable['$inferInsert'],
): unknown[] {
  // better-sqlite3 同步驱动下，.returning() 返回的是 builder，需要 .all() 才执行取行。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db.insert(table) as any).values(value).returning().all() as unknown[]
}

/** 更新（返回 update builder，调用方可继续 .where().returning()） */
export function updateRows<TTable extends SQLiteTable>(
  db: DB,
  table: TTable,
  value: Partial<TTable['$inferInsert']>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db.update(table) as any).set(value)
}
