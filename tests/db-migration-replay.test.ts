import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  LATEST_MIGRATION_VERSION,
  MIGRATIONS,
  runMigrations,
  type Migration,
  type MigrationRaw,
} from '../packages/db/src/migrator'

interface RawBetterSqliteDatabase {
  close(): void
  exec(sql: string): void
  pragma(sql: string): unknown
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
  }
}

const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const Database = desktopRequire('better-sqlite3') as new (path: string) => RawBetterSqliteDatabase

function createRawDb(): { raw: RawBetterSqliteDatabase; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-migration-replay-'))
  const raw = new Database(join(dir, 'studio.db'))
  raw.pragma('foreign_keys = ON')
  return { raw, dir }
}

function closeAndRemove(raw: RawBetterSqliteDatabase, dir: string): void {
  raw.close()
  rmSync(dir, { recursive: true, force: true })
}

function migrationRaw(raw: RawBetterSqliteDatabase): MigrationRaw {
  return raw as unknown as MigrationRaw
}

function tableExists(raw: RawBetterSqliteDatabase, table: string): boolean {
  const row = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined
  return row?.name === table
}

function columns(raw: RawBetterSqliteDatabase, table: string): string[] {
  return (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
}

function appliedVersions(raw: RawBetterSqliteDatabase): number[] {
  return (raw.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as Array<{ version: number }>)
    .map((row) => row.version)
}

test('replays all migrations from a legacy v0 fixture and is idempotent', () => {
  const { raw, dir } = createRawDb()
  try {
    raw.exec(readFileSync(new URL('./fixtures/legacy-v0.1.sql', import.meta.url), 'utf8'))

    const applied = runMigrations(migrationRaw(raw))
    assert.deepEqual(applied, Array.from({ length: LATEST_MIGRATION_VERSION }, (_, index) => index + 1))
    assert.deepEqual(appliedVersions(raw), applied)

    assert.equal(
      (raw.prepare('SELECT title FROM projects WHERE id = ?').get('p-legacy') as { title?: string }).title,
      '旧库项目',
    )
    assert.ok(columns(raw, 'projects').includes('visual_style_direction'))
    assert.ok(columns(raw, 'characters').includes('appearance_prompt'))
    assert.ok(columns(raw, 'chapters').includes('ai_video_note'))
    assert.ok(columns(raw, 'evaluations').includes('ai_video_feasibility_score'))
    assert.ok(columns(raw, 'evaluations').includes('character_consistency_score'))
    assert.ok(columns(raw, 'evaluations').includes('shot_clarity_score'))
    assert.ok(columns(raw, 'adaptation_projects').includes('season_number'))
    assert.ok(columns(raw, 'adaptation_projects').includes('source_chapter_range'))
    assert.ok(columns(raw, 'video_results').includes('local_video_path'))
    assert.ok(tableExists(raw, 'long_tasks'))
    assert.ok(tableExists(raw, 'ai_budget_settings'))

    assert.deepEqual(runMigrations(migrationRaw(raw)), [])
    assert.deepEqual(appliedVersions(raw), applied)
  } finally {
    closeAndRemove(raw, dir)
  }
})

test('rolls back a failed pending migration without recording its version', () => {
  const { raw, dir } = createRawDb()
  const failingMigration: Migration = {
    version: LATEST_MIGRATION_VERSION + 100,
    name: 'test-rollback',
    up(db) {
      db.exec('CREATE TABLE migration_should_rollback (id TEXT PRIMARY KEY);')
      throw new Error('forced migration failure')
    },
  }

  try {
    runMigrations(migrationRaw(raw))
    MIGRATIONS.push(failingMigration)
    assert.throws(() => runMigrations(migrationRaw(raw)), /forced migration failure/)
    assert.equal(tableExists(raw, 'migration_should_rollback'), false)
    assert.equal(appliedVersions(raw).includes(failingMigration.version), false)
    assert.equal(Math.max(...appliedVersions(raw)), LATEST_MIGRATION_VERSION)
  } finally {
    const index = MIGRATIONS.indexOf(failingMigration)
    if (index >= 0) MIGRATIONS.splice(index, 1)
    closeAndRemove(raw, dir)
  }
})
