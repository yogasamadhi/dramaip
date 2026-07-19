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
import { createDb, createRepositories } from '../packages/db/src'
import type { TextDiffPreviewPayload } from '@sdns/core'

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

function createRepositoryFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-revision-adoption-'))
  const opened = createDb(join(dir, 'studio.db'))
  const repos = createRepositories(opened.db)
  const project = repos.project.createProject(opened.db, { title: '修稿事务样本', shortDramaType: '都市' } as never)
  const chapter = repos.chapter.createChapter(opened.db, { projectId: project.id, title: '第一章', content: '原始章节正文。' })
  const adaptation = repos.adaptationProject.createAdaptationProject(opened.db, {
    sourceProjectId: project.id,
    title: '第一季',
    targetEpisodeCount: 1,
    adaptationStyle: '强冲突',
  })
  const episode = repos.episode.createEpisode(opened.db, {
    adaptationProjectId: adaptation.id,
    episodeNumber: 1,
    title: '第一集',
    summary: '摘要',
    hook: '钩子',
    mainConflict: '冲突',
    cliffhanger: '悬念',
  })
  const script = repos.script.createScript(opened.db, {
    adaptationProjectId: adaptation.id,
    episodeId: episode.id,
    episodeNumber: 1,
    title: '第一集',
    content: '原始剧本。',
  })
  const scene = repos.scene.createScene(opened.db, {
    scriptId: script.id,
    episodeId: episode.id,
    sceneNumber: 1,
    title: '天台',
    location: '天台',
    summary: '对峙',
  })
  const shot = repos.shot.createShot(opened.db, {
    sceneId: scene.id,
    episodeId: episode.id,
    shotNumber: 1,
    visualDescription: '夜景',
    videoPrompt: '原始视频 Prompt',
    negativePrompt: '原始负面 Prompt',
    imagePrompt: '原始图片 Prompt',
  })
  return { dir, raw: opened.raw, db: opened.db, repos, project, chapter, script, shot }
}

function closeRepositoryFixture(fixture: ReturnType<typeof createRepositoryFixture>): void {
  fixture.raw.close()
  rmSync(fixture.dir, { recursive: true, force: true })
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
    assert.ok(columns(raw, 'projects').includes('deleted_at'))
    assert.ok(columns(raw, 'characters').includes('appearance_prompt'))
    assert.ok(columns(raw, 'character_visual_profiles').includes('casting_prompt'))
    assert.ok(columns(raw, 'character_visual_profiles').includes('actor_reference_url'))
    assert.ok(columns(raw, 'character_visual_profiles').includes('voice_tone'))
    assert.ok(columns(raw, 'character_visual_profiles').includes('voice_sample_url'))
    assert.ok(columns(raw, 'shots').includes('subtitle_draft'))
    assert.ok(columns(raw, 'shots').includes('cover_prompt'))
    assert.ok(columns(raw, 'chapters').includes('ai_video_note'))
    assert.ok(columns(raw, 'evaluations').includes('ai_video_feasibility_score'))
    assert.ok(columns(raw, 'evaluations').includes('character_consistency_score'))
    assert.ok(columns(raw, 'evaluations').includes('shot_clarity_score'))
    assert.ok(columns(raw, 'adaptation_projects').includes('season_number'))
    assert.ok(columns(raw, 'adaptation_projects').includes('source_chapter_range'))
    assert.ok(columns(raw, 'video_results').includes('local_video_path'))
    assert.ok(tableExists(raw, 'long_tasks'))
    assert.ok(tableExists(raw, 'ai_budget_settings'))
    assert.ok(tableExists(raw, 'credential_migration_audit'))
    assert.deepEqual(columns(raw, 'credential_migration_audit'), [
      'area',
      'record_id',
      'source_state',
      'credential_ref',
      'status',
      'attempts',
      'last_error',
      'completed_at',
      'updated_at',
    ])
    assert.ok(tableExists(raw, 'case_study_documents'))
    assert.ok(tableExists(raw, 'case_study_chapters'))
    assert.ok(columns(raw, 'creative_case_studies').includes('rhythm_curve'))
    assert.ok(columns(raw, 'creative_case_studies').includes('creative_cards'))
    assert.ok(columns(raw, 'case_study_chapters').includes('text_preview'))
    assert.ok(tableExists(raw, 'story_arcs'))
    assert.ok(columns(raw, 'story_arcs').includes('target_word_count'))
    assert.ok(columns(raw, 'story_arcs').includes('foreshadowing_payoffs'))
    assert.ok(tableExists(raw, 'project_skills'))
    assert.ok(columns(raw, 'project_skills').includes('task_types'))
    assert.ok(columns(raw, 'project_skills').includes('priority'))
    assert.ok(tableExists(raw, 'project_agent_schemes'))
    assert.ok(columns(raw, 'project_agent_schemes').includes('primary_agent_id'))
    assert.ok(columns(raw, 'project_agent_schemes').includes('model_bindings'))
    assert.ok(columns(raw, 'revision_tasks').includes('preview_payload'))
    assert.ok(columns(raw, 'revision_tasks').includes('preview_fingerprint'))
    assert.ok(columns(raw, 'revision_tasks').includes('undo_version_id'))
    assert.ok(tableExists(raw, 'inspiration_favorites'))
    assert.ok(columns(raw, 'inspiration_favorites').includes('card_key'))
    assert.ok(columns(raw, 'inspiration_favorites').includes('source_kind'))

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

test('adopts a revision exactly once and supports an audited one-step undo', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project, chapter } = fixture
    const task = repos.creative.createRevisionTask(db, {
      projectId: project.id,
      targetKind: 'chapter',
      targetId: chapter.id,
      title: '增强章节尾钩',
      description: '补强最后一句。',
      suggestedAction: '增加倒计时。',
    })
    const preview: TextDiffPreviewPayload = {
      targetKind: 'chapter',
      targetId: chapter.id,
      taskType: 'rewrite_chapter',
      currentContent: chapter.content,
      nextContent: '原始章节正文。\n倒计时开始。',
      projectId: project.id,
    }
    const ready = repos.revisionAdoption.saveRevisionTaskPreview(db, task.id, preview)
    assert.equal(ready.status, 'preview_ready')

    const adopted = repos.revisionAdoption.adoptRevisionTask(db, task.id)
    assert.equal(adopted.ok, true)
    assert.equal(adopted.alreadyApplied, undefined)
    assert.equal(repos.chapter.getChapter(db, chapter.id)?.content, preview.nextContent)
    assert.equal(adopted.task?.status, 'applied')
    assert.ok(adopted.beforeVersion?.id)
    assert.ok(adopted.appliedVersion?.id)
    assert.equal(repos.creative.listContentVersionsByTarget(db, 'chapter', chapter.id).length, 2)

    const repeated = repos.revisionAdoption.adoptRevisionTask(db, task.id)
    assert.equal(repeated.ok, true)
    assert.equal(repeated.alreadyApplied, true)
    assert.equal(repos.creative.listContentVersionsByTarget(db, 'chapter', chapter.id).length, 2)

    const undone = repos.revisionAdoption.undoRevisionTask(db, task.id)
    assert.equal(undone.ok, true)
    assert.equal(undone.task?.status, 'undone')
    assert.equal(repos.chapter.getChapter(db, chapter.id)?.content, chapter.content)
    assert.equal(repos.creative.listContentVersionsByTarget(db, 'chapter', chapter.id).length, 3)
  } finally {
    closeRepositoryFixture(fixture)
  }
})

test('rejects stale revision previews and rolls back an invalid script adoption', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project, chapter, script } = fixture
    const chapterTask = repos.creative.createRevisionTask(db, {
      projectId: project.id,
      targetKind: 'chapter',
      targetId: chapter.id,
      title: '并发检查',
      description: '不得覆盖新编辑。',
      suggestedAction: '补强。',
    })
    repos.revisionAdoption.saveRevisionTaskPreview(db, chapterTask.id, {
      targetKind: 'chapter', targetId: chapter.id, taskType: 'rewrite_chapter', currentContent: chapter.content, nextContent: '候选正文。', projectId: project.id,
    })
    repos.chapter.updateChapterContent(db, chapter.id, '人工在预览后编辑。')
    const stale = repos.revisionAdoption.adoptRevisionTask(db, chapterTask.id)
    assert.equal(stale.ok, false)
    assert.match(stale.error ?? '', /重新生成/)
    assert.equal(repos.chapter.getChapter(db, chapter.id)?.content, '人工在预览后编辑。')
    assert.equal(repos.creative.listContentVersionsByTarget(db, 'chapter', chapter.id).length, 0)

    const scriptTask = repos.creative.createRevisionTask(db, {
      projectId: project.id,
      targetKind: 'script',
      targetId: script.id,
      title: '故障回滚',
      description: '模拟损坏的候选。',
      suggestedAction: '重写。',
    })
    const malformedPreview = {
      targetKind: 'script', targetId: script.id, taskType: 'rewrite_ai_drama_script', currentContent: script.content, nextContent: '不应写入的剧本。', projectId: project.id,
    } as TextDiffPreviewPayload
    repos.revisionAdoption.saveRevisionTaskPreview(db, scriptTask.id, malformedPreview)
    const failed = repos.revisionAdoption.adoptRevisionTask(db, scriptTask.id)
    assert.equal(failed.ok, false)
    assert.match(failed.error ?? '', /剧本修稿预览数据无效/)
    assert.equal(repos.script.getScript(db, script.id)?.content, script.content)
    assert.equal(repos.creative.listContentVersionsByTarget(db, 'script', script.id).length, 0)
    assert.equal(repos.creative.getRevisionTask(db, scriptTask.id)?.status, 'preview_ready')
  } finally {
    closeRepositoryFixture(fixture)
  }
})

test('atomically adopts a shot preview including all prompt fields', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project, shot } = fixture
    const task = repos.creative.createRevisionTask(db, {
      projectId: project.id,
      targetKind: 'shot',
      targetId: shot.id,
      title: '优化镜头提示词',
      description: '统一三个 Prompt。',
      suggestedAction: '重写。',
    })
    const current = '视频 Prompt:\n原始视频 Prompt\n\n负面 Prompt:\n原始负面 Prompt\n\n图片 Prompt:\n原始图片 Prompt'
    repos.revisionAdoption.saveRevisionTaskPreview(db, task.id, {
      targetKind: 'shot', targetId: shot.id, shotId: shot.id, taskType: 'rewrite_shot_prompt', currentContent: current,
      nextContent: '视频 Prompt:\n新视频 Prompt\n\n负面 Prompt:\n新负面 Prompt\n\n图片 Prompt:\n新图片 Prompt', projectId: project.id,
      shotPatch: { videoPrompt: '新视频 Prompt', negativePrompt: '新负面 Prompt', imagePrompt: '新图片 Prompt' },
    })
    const adopted = repos.revisionAdoption.adoptRevisionTask(db, task.id)
    assert.equal(adopted.ok, true)
    const updated = repos.shot.getShot(db, shot.id)
    assert.equal(updated?.videoPrompt, '新视频 Prompt')
    assert.equal(updated?.negativePrompt, '新负面 Prompt')
    assert.equal(updated?.imagePrompt, '新图片 Prompt')
  } finally {
    closeRepositoryFixture(fixture)
  }
})
