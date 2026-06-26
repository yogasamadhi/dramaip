// task_model_bindings —— 按任务组指定模型（ROADMAP v1.0-3）
// 每个任务组最多绑定一个模型（task_group 唯一）；缺省回退默认模型。
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { taskModelBindings } from '../schema'
import type { OptionalId, TaskModelBinding } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type BindingRow = typeof taskModelBindings.$inferSelect

function rowToEntity(row: BindingRow): TaskModelBinding {
  return {
    id: row.id,
    taskGroup: row.taskGroup,
    modelConfigId: row.modelConfigId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listTaskModelBindings(db: DB): TaskModelBinding[] {
  return db
    .select()
    .from(taskModelBindings)
    .orderBy(taskModelBindings.taskGroup)
    .all()
    .map((row) => rowToEntity(row as BindingRow))
}

export function getTaskModelBinding(db: DB, taskGroup: string): TaskModelBinding | undefined {
  const row = db
    .select()
    .from(taskModelBindings)
    .where(eq(taskModelBindings.taskGroup, taskGroup))
    .get()
  return row ? rowToEntity(row as BindingRow) : undefined
}

export function createTaskModelBinding(
  db: DB,
  data: OptionalId<TaskModelBinding> & { taskGroup: string; modelConfigId: string },
): TaskModelBinding {
  const ts = now()
  // task_group 唯一：先清掉同组旧绑定
  db.delete(taskModelBindings).where(eq(taskModelBindings.taskGroup, data.taskGroup)).run()
  const value: typeof taskModelBindings.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    taskGroup: data.taskGroup,
    modelConfigId: data.modelConfigId,
  }
  const [row] = insertRow(db, taskModelBindings, value)
  return rowToEntity(row as BindingRow)
}

/** upsert：存在同组则更新 modelConfigId，否则新建 */
export function upsertTaskModelBinding(
  db: DB,
  data: { taskGroup: string; modelConfigId: string },
): TaskModelBinding {
  const existing = getTaskModelBinding(db, data.taskGroup)
  if (existing) {
    const [row] = updateRows(db, taskModelBindings, { modelConfigId: data.modelConfigId, updatedAt: now() })
      .where(eq(taskModelBindings.taskGroup, data.taskGroup))
      .returning()
      .all()
    return rowToEntity(row as BindingRow)
  }
  return createTaskModelBinding(db, data)
}

export function deleteTaskModelBinding(db: DB, taskGroup: string): void {
  db.delete(taskModelBindings).where(eq(taskModelBindings.taskGroup, taskGroup)).run()
}
