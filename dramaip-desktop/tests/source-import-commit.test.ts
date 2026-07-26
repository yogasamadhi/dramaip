import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDb, createRepositories } from '../packages/db/src'
import { applySourceImport, type SourceImportPreview } from '../apps/desktop/electron/source-import'

function preview(overrides: Partial<SourceImportPreview> = {}): SourceImportPreview {
  return {
    fileName: '授权样本.md',
    sourceType: 'markdown',
    contentKind: 'novel',
    title: '授权样本',
    charCount: 20,
    chapters: [],
    episodes: [],
    warnings: [],
    ...overrides,
  }
}

function withFixture(run: (fixture: ReturnType<typeof createFixture>) => void): void {
  const fixture = createFixture()
  try { run(fixture) } finally {
    fixture.raw.close()
    rmSync(fixture.dir, { recursive: true, force: true })
  }
}

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-source-import-'))
  const opened = createDb(join(dir, 'studio.db'))
  const repos = createRepositories(opened.db)
  const project = repos.project.createProject(opened.db, { title: '导入目标', shortDramaType: '都市' } as never)
  return { dir, raw: opened.raw, repos, project }
}

test('source import appends by default and replaces only with a checkpoint', () => withFixture(({ repos, project }) => {
  const original = repos.chapter.createChapter(repos.db, { projectId: project.id, title: '第一章', content: '原始正文' })
  const replace = applySourceImport(repos, {
    projectId: project.id,
    strategy: 'replace',
    preview: preview({ chapters: [{ key: 'replace', title: '第一章', content: '覆盖后的正文', orderIndex: 0, wordCount: 6 }] }),
  })
  assert.equal(replace.updatedChapters, 1)
  assert.equal(replace.checkpointCount, 1)
  assert.equal(repos.chapter.getChapter(repos.db, original.id)?.content, '覆盖后的正文')
  const checkpoints = repos.creative.listContentVersionsByTarget(repos.db, 'chapter', original.id)
  assert.equal(checkpoints[0]?.content, '原始正文')

  const imported = preview({
    chapters: [
      { key: 'one', title: '第一章', content: '导入正文', orderIndex: 0, wordCount: 4 },
      { key: 'two', title: '第二章', content: '新增正文', orderIndex: 1, wordCount: 4 },
    ],
  })
  const append = applySourceImport(repos, { projectId: project.id, preview: imported, strategy: 'append' })
  assert.equal(append.createdChapters, 2)
  assert.equal(repos.chapter.listChapters(repos.db, project.id).length, 3)
  assert.equal(repos.chapter.getChapter(repos.db, original.id)?.content, '覆盖后的正文')
}))

test('script import creates a usable adaptation, episodes, scripts, and scenes', () => withFixture(({ repos, project }) => {
  const result = applySourceImport(repos, {
    projectId: project.id,
    strategy: 'append',
    preview: preview({
      sourceType: 'script-json',
      contentKind: 'script',
      chapters: [],
      episodes: [{
        key: 'ep-1', episodeNumber: 1, title: '第一集', content: '林晚：我回来了。', scenes: [{
          key: 'scene-1', title: '客厅', location: '客厅', visualDescription: '夜景', characters: ['林晚'], summary: '回归', content: '林晚：我回来了。', orderIndex: 0, dialogueCount: 1, actionCount: 0,
        }],
      }],
    }),
  })
  assert.ok(result.adaptationProjectId)
  assert.equal(result.createdEpisodes, 1)
  assert.equal(result.createdScripts, 1)
  assert.equal(result.createdScenes, 1)
  const scripts = repos.script.listScripts(repos.db, result.adaptationProjectId!)
  assert.equal(scripts[0]?.content, '林晚：我回来了。')
  assert.equal(repos.scene.listScenesByScript(repos.db, scripts[0].id)[0]?.location, '客厅')
}))

test('an import failure rolls back every earlier write in the same batch', () => withFixture(({ repos, project, raw }) => {
  raw.exec("CREATE TRIGGER reject_source_import BEFORE INSERT ON chapters WHEN NEW.title = '故障章' BEGIN SELECT RAISE(ABORT, 'forced source import failure'); END;")
  assert.throws(() => applySourceImport(repos, {
    projectId: project.id,
    strategy: 'append',
    preview: preview({ chapters: [
      { key: 'safe', title: '正常章', content: '应当回滚', orderIndex: 0, wordCount: 4 },
      { key: 'fail', title: '故障章', content: '触发失败', orderIndex: 1, wordCount: 4 },
    ] }),
  }), /forced source import failure/)
  assert.equal(repos.chapter.listChapters(repos.db, project.id).length, 0)
}))
