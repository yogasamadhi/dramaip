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
import { DEFAULT_GENRE_MARKET_SNAPSHOT, type TextDiffPreviewPayload } from '@sdns/core'
import { applyGeneratedArtifact } from '../packages/ai/src/persistence'
import { collectProjectPackage, importProjectPackage, serializeProjectPackage } from '../packages/export/src/project-package'

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
  return { dir, raw: opened.raw, db: opened.db, repos, project, chapter, adaptation, episode, script, shot }
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
    assert.ok(columns(raw, 'projects').includes('active_adaptation_id'))
    assert.ok(columns(raw, 'projects').includes('genre_opportunity'))
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
    assert.ok(tableExists(raw, 'quality_issue_acknowledgements'))
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
    assert.ok(tableExists(raw, 'genre_market_snapshots'))

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

test('persists a validated active adaptation and safely falls back after deletion', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project, adaptation } = fixture
    const seasonTwo = repos.adaptationProject.createAdaptationProject(db, {
      sourceProjectId: project.id,
      title: '第二季',
      targetEpisodeCount: 12,
      adaptationStyle: '悬疑',
      seasonNumber: 2,
    })
    const otherProject = repos.project.createProject(db, { title: '其他项目', shortDramaType: '都市' } as never)
    const otherAdaptation = repos.adaptationProject.createAdaptationProject(db, {
      sourceProjectId: otherProject.id,
      title: '其他项目第一季',
      targetEpisodeCount: 8,
      adaptationStyle: '都市',
    })

    assert.equal(repos.project.getProject(db, project.id)?.activeAdaptationId, seasonTwo.id)
    assert.equal(repos.project.setActiveAdaptation(db, project.id, adaptation.id)?.activeAdaptationId, adaptation.id)
    assert.equal(repos.project.setActiveAdaptation(db, project.id, otherAdaptation.id), undefined)

    const deepLink = repos.project.resolveActiveAdaptation(db, project.id, seasonTwo.id)
    assert.equal(deepLink.reason, 'requested')
    assert.equal(deepLink.adaptation?.id, seasonTwo.id)
    const invalidDeepLink = repos.project.resolveActiveAdaptation(db, project.id, otherAdaptation.id)
    assert.equal(invalidDeepLink.reason, 'persisted')
    assert.equal(invalidDeepLink.adaptation?.id, seasonTwo.id)

    repos.adaptationProject.deleteAdaptationProject(db, seasonTwo.id)
    assert.equal(repos.project.getProject(db, project.id)?.activeAdaptationId, adaptation.id)
    repos.adaptationProject.deleteAdaptationProject(db, adaptation.id)
    assert.equal(repos.project.getProject(db, project.id)?.activeAdaptationId, null)
  } finally {
    closeRepositoryFixture(fixture)
  }
})

test('persists a selected genre opportunity snapshot without changing older projects', () => {
  const fixture = createRepositoryFixture()
  try {
    const selection = {
      snapshotVersion: 'cn-ai-drama-market-2026-07-22-v1',
      snapshotObservedAt: '2026-07-22',
      opportunity: {
        id: 'genre-market-20260722-01',
        genreName: '奇幻玄幻·修仙逆袭',
        status: 'hot',
        audiences: ['male', 'general'],
        presentations: ['ai_animation', 'live_action'],
        platforms: ['短剧 App', '短视频竖屏', 'AI 漫剧'],
        productionCost: 'high',
        saturation: 'medium',
        whyRecommended: ['适合试播'],
        primaryRisks: ['奇观成本高'],
        differentiationIdeas: ['固定视觉锚点'],
      },
    }
    const project = fixture.repos.project.createProject(fixture.db, {
      title: '机会快照项目',
      shortDramaType: selection.opportunity.genreName,
      genreOpportunity: selection,
    } as never)

    const saved = fixture.repos.project.getProject(fixture.db, project.id)
    assert.deepEqual(saved?.genreOpportunity, selection)
    assert.equal(fixture.repos.project.getProject(fixture.db, fixture.project.id)?.genreOpportunity, undefined)
    const pkg = collectProjectPackage(fixture.repos, project.id)
    assert.deepEqual(pkg.project.genreOpportunity, selection)
    const imported = importProjectPackage(fixture.repos, serializeProjectPackage(pkg))
    assert.deepEqual(fixture.repos.project.getProject(fixture.db, imported.id)?.genreOpportunity, selection)
  } finally {
    closeRepositoryFixture(fixture)
  }
})

test('imports validated market snapshot history and rolls back active version without rewriting projects', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos } = fixture
    const builtIn = repos.genreMarketSnapshot.ensureBuiltInGenreMarketSnapshot(db, DEFAULT_GENRE_MARKET_SNAPSHOT)
    assert.equal(builtIn.active, true)
    assert.equal(repos.genreMarketSnapshot.ensureBuiltInGenreMarketSnapshot(db, DEFAULT_GENRE_MARKET_SNAPSHOT).active, true)
    const importedVersion = 'cn-ai-drama-market-2026-07-23-v1'
    const imported = repos.genreMarketSnapshot.importGenreMarketSnapshot(db, {
      ...DEFAULT_GENRE_MARKET_SNAPSHOT,
      version: importedVersion,
      observedAt: '2026-07-23',
    })
    assert.equal(imported.active, true)
    assert.ok(imported.sources.some((source) => source.kind === 'user_imported'))
    assert.equal(repos.genreMarketSnapshot.getActiveGenreMarketSnapshot(db)?.version, importedVersion)

    const project = repos.project.createProject(db, {
      title: '采用新快照的项目',
      shortDramaType: imported.opportunities[0]!.genreName,
      genreOpportunity: {
        snapshotVersion: imported.version,
        snapshotObservedAt: imported.observedAt,
        opportunity: imported.opportunities[0]!,
      },
    } as never)
    const rolledBack = repos.genreMarketSnapshot.activateGenreMarketSnapshot(db, builtIn.version)
    assert.equal(rolledBack?.active, true)
    assert.equal(repos.genreMarketSnapshot.getActiveGenreMarketSnapshot(db)?.version, builtIn.version)
    assert.equal(repos.project.getProject(db, project.id)?.genreOpportunity?.snapshotVersion, importedVersion)
    assert.equal(repos.genreMarketSnapshot.listGenreMarketSnapshots(db).length, 2)
  } finally {
    closeRepositoryFixture(fixture)
  }
})

test('appends quality issue risk decisions without changing the original report', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project } = fixture
    const report = repos.creative.createQualityGateReport(db, {
      projectId: project.id,
      targetKind: 'project',
      targetId: project.id,
      stage: 'novel_to_adaptation',
      score: 58,
      verdict: 'block',
      blockingIssues: ['人物动机不够明确'],
    })
    const accepted = repos.creative.acknowledgeQualityIssue(db, {
      projectId: project.id,
      issueId: `quality-report:${report.id}:block:0`,
      issueKind: 'quality_report',
      issueTitle: '人物动机不够明确',
      issueDetail: '第一季试制阶段接受该风险。',
      disposition: 'accepted',
      note: '先验证开场节奏，再进入修订。',
    })
    const ignored = repos.creative.acknowledgeQualityIssue(db, {
      projectId: project.id,
      issueId: `quality-report:${report.id}:block:0`,
      issueKind: 'quality_report',
      issueTitle: '人物动机不够明确',
      disposition: 'ignored',
      note: '复检后改为忽略旧项。',
    })

    assert.equal(accepted.actorLabel, '本地用户')
    assert.equal(repos.creative.listQualityGateReports(db, project.id)[0]?.blockingIssues[0], '人物动机不够明确')
    const audit = repos.creative.listQualityIssueAcknowledgements(db, project.id)
    assert.equal(audit.length, 2)
    assert.deepEqual(new Set(audit.map((item) => item.id)), new Set([accepted.id, ignored.id]))
  } finally {
    closeRepositoryFixture(fixture)
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

test('persists an edited partial revision candidate before atomic adoption', () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project, chapter } = fixture
    const task = repos.creative.createRevisionTask(db, {
      projectId: project.id, targetKind: 'chapter', targetId: chapter.id,
      title: '仅采用段尾钩子', description: '保留人工正文，只采用一个候选段落。', suggestedAction: '补强段尾。',
    })
    repos.revisionAdoption.saveRevisionTaskPreview(db, task.id, {
      targetKind: 'chapter', targetId: chapter.id, taskType: 'rewrite_chapter', currentContent: chapter.content,
      nextContent: 'AI 全文改写。', projectId: project.id,
    })
    const edited = repos.revisionAdoption.saveRevisionTaskPreview(db, task.id, {
      targetKind: 'chapter', targetId: chapter.id, taskType: 'rewrite_chapter', currentContent: chapter.content,
      nextContent: `${chapter.content}\n\n只采用的段尾倒计时。`, projectId: project.id,
    })
    assert.equal(edited.status, 'preview_ready')
    assert.equal(edited.preview?.nextContent, `${chapter.content}\n\n只采用的段尾倒计时。`)
    const adopted = repos.revisionAdoption.adoptRevisionTask(db, task.id)
    assert.equal(adopted.ok, true)
    assert.equal(repos.chapter.getChapter(db, chapter.id)?.content, `${chapter.content}\n\n只采用的段尾倒计时。`)
  } finally {
    closeRepositoryFixture(fixture)
  }
})

test('partial episode adoption preserves unselected episodes and updates matching selected numbers', async () => {
  const fixture = createRepositoryFixture()
  try {
    const { db, repos, project, adaptation, episode } = fixture
    const result = await applyGeneratedArtifact({ repos } as never, {
      projectId: project.id,
      adaptationProjectId: adaptation.id,
      taskType: 'convert_novel_to_episodes',
      partialAdopt: true,
      data: [{
        episodeNumber: 2,
        title: '第二集（仅采用）',
        summary: '保留第一集，只写入被选中的第二集。',
        hook: '新钩子', mainConflict: '新冲突', cliffhanger: '新悬念',
        keyVisuals: [], relatedChapterIds: [], relatedBeatIds: [],
      }],
    })
    assert.equal((result.created as unknown[]).length, 1)
    const episodes = repos.episode.listEpisodes(db, adaptation.id)
    assert.equal(episodes.length, 2)
    assert.equal(episodes[0]?.id, episode.id)
    assert.equal(episodes[0]?.title, '第一集')
    assert.equal(episodes[1]?.title, '第二集（仅采用）')
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
