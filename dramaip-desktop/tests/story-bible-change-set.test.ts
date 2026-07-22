import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StoryBibleChangeSetPayloadSchema, type StoryBibleChangeSetPayload } from '../packages/core/src'
import { createDb, createRepositories } from '../packages/db/src'

function withFixture(run: (fixture: ReturnType<typeof createFixture>) => void): void {
  const fixture = createFixture()
  try { run(fixture) } finally {
    fixture.raw.close()
    rmSync(fixture.dir, { recursive: true, force: true })
  }
}

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-story-bible-'))
  const opened = createDb(join(dir, 'studio.db'))
  const repos = createRepositories(opened.db)
  const project = repos.project.createProject(opened.db, { title: '故事圣经事务样本', shortDramaType: '都市' } as never)
  const chapter = repos.chapter.createChapter(opened.db, { projectId: project.id, title: '第一章', content: '林晚在雨夜回到旧宅，发现父亲留下的钥匙。' })
  const character = repos.character.createCharacter(opened.db, { projectId: project.id, name: '林晚', role: '主角' })
  return { dir, raw: opened.raw, db: opened.db, repos, project, chapter, character }
}

function payload(characterId: string): StoryBibleChangeSetPayload {
  return StoryBibleChangeSetPayloadSchema.parse({
    summary: '林晚回到旧宅并拿到钥匙，家庭秘密进入主线。',
    memories: [{
      summary: '林晚在雨夜回到旧宅，发现父亲留下的钥匙。',
      importantEvents: ['回到旧宅', '得到钥匙'],
      characterChanges: ['林晚决定调查父亲失踪真相'],
      revealedSecrets: ['钥匙指向父亲隐藏的房间'],
      newForeshadowing: ['钥匙的编号'],
      resolvedForeshadowing: [],
      keyVisualElements: ['雨夜旧宅', '铜制钥匙'],
    }],
    characterStates: [{
      characterId,
      currentStatus: '重返旧宅，开始调查',
      emotionalState: '警惕',
      relationshipChanges: '与父亲的关系从疏离转为追查',
      knownSecrets: ['父亲留有钥匙'],
      hiddenSecrets: [],
      visualContinuityNotes: '湿发、深色风衣',
    }],
    storyEvents: [{ title: '雨夜归宅', description: '林晚在父亲旧宅发现钥匙。', eventType: 'reveal', relatedCharacterIds: [characterId] }],
    foreshadowings: [{ title: '钥匙编号', description: '钥匙编号将在地下室对应保险柜。', status: 'setup', relatedCharacterIds: [characterId], action: 'add' }],
    visualSettings: [{ title: '旧宅雨夜', type: 'location', visualPrompt: '雨夜、老旧石库门、昏黄门灯、湿润地面', notes: '后续回忆场景保持阴冷色温' }],
  })
}

test('story bible proposal is parsed, applied atomically, and can be undone without touching the chapter', () => withFixture(({ repos, db, project, chapter, character }) => {
  const queued = repos.storyBible.queueStoryBibleChangeSet(db, { projectId: project.id, chapterId: chapter.id, costPer1kTokens: 2, currency: 'CNY' })
  assert.equal(queued.status, 'queued')
  assert.ok(queued.estimatedTokens)
  assert.equal(queued.estimatedCost! > 0, true)

  const draft = repos.storyBible.saveStoryBibleDraft(db, { projectId: project.id, chapterId: chapter.id, payload: payload(character.id), costPer1kTokens: 2, currency: 'CNY' })
  assert.equal(draft.id, queued.id)
  assert.equal(draft.status, 'draft')
  assert.deepEqual(draft.conflicts, [])

  const applied = repos.storyBible.applyStoryBibleChangeSet(db, draft.id)
  assert.equal(applied.status, 'applied')
  assert.equal(repos.chapterMemory.listChapterMemories(db, project.id).length, 1)
  assert.equal(repos.characterState.listCharacterStates(db, project.id).length, 1)
  assert.equal(repos.storyEvent.listStoryEvents(db, project.id).length, 1)
  assert.equal(repos.foreshadowing.listForeshadowings(db, project.id).length, 1)
  assert.equal(repos.visualSetting.listVisualSettings(db, project.id).length, 1)

  const undone = repos.storyBible.undoStoryBibleChangeSet(db, draft.id)
  assert.equal(undone.status, 'discarded')
  assert.equal(repos.chapterMemory.listChapterMemories(db, project.id).length, 0)
  assert.equal(repos.characterState.listCharacterStates(db, project.id).length, 0)
  assert.equal(repos.storyEvent.listStoryEvents(db, project.id).length, 0)
  assert.equal(repos.foreshadowing.listForeshadowings(db, project.id).length, 0)
  assert.equal(repos.visualSetting.listVisualSettings(db, project.id).length, 0)
  assert.match(repos.chapter.getChapter(db, chapter.id)?.content ?? '', /父亲留下的钥匙/)
}))

test('a changed chapter makes prior story bible work stale and preserves a visible diagnostic refill mark', () => withFixture(({ repos, db, project, chapter, character }) => {
  const draft = repos.storyBible.saveStoryBibleDraft(db, { projectId: project.id, chapterId: chapter.id, payload: payload(character.id), costPer1kTokens: 0, currency: 'CNY' })
  repos.chapter.updateChapterContent(db, chapter.id, `${chapter.content}\n林晚决定打开地下室。`)

  assert.equal(repos.storyBible.getStoryBibleChangeSet(db, draft.id)?.status, 'stale')
  const marks = repos.storyBible.listStoryBibleStaleMarks(db, project.id)
  assert.deepEqual(new Set(marks.map((mark) => mark.targetKind)), new Set(['story_bible', 'diagnostic']))
  assert.throws(() => repos.storyBible.applyStoryBibleChangeSet(db, draft.id), /只有待确认草案/)
}))

test('invalid character references are conflicts, and a failing entity insert rolls the entire adopted package back', () => withFixture(({ repos, db, raw, project, chapter }) => {
  const conflict = repos.storyBible.saveStoryBibleDraft(db, { projectId: project.id, chapterId: chapter.id, payload: payload('missing-character'), costPer1kTokens: 0, currency: 'CNY' })
  assert.equal(conflict.conflicts.length, 1)
  assert.throws(() => repos.storyBible.applyStoryBibleChangeSet(db, conflict.id), /存在冲突/)

  const character = repos.character.createCharacter(db, { projectId: project.id, name: '陆沉', role: '配角' })
  const draft = repos.storyBible.saveStoryBibleDraft(db, { projectId: project.id, chapterId: chapter.id, payload: payload(character.id), costPer1kTokens: 0, currency: 'CNY' })
  raw.exec("CREATE TRIGGER reject_story_bible_event BEFORE INSERT ON story_events WHEN NEW.title = '雨夜归宅' BEGIN SELECT RAISE(ABORT, 'forced story bible failure'); END;")
  assert.throws(() => repos.storyBible.applyStoryBibleChangeSet(db, draft.id), /forced story bible failure/)
  assert.equal(repos.chapterMemory.listChapterMemories(db, project.id).length, 0)
  assert.equal(repos.characterState.listCharacterStates(db, project.id).length, 0)
  assert.equal(repos.storyEvent.listStoryEvents(db, project.id).length, 0)
  assert.equal(repos.storyBible.getStoryBibleChangeSet(db, draft.id)?.status, 'draft')
}))

test('queued long-form items can pause, resume, skip, and preserve a failure detail for later recovery', () => withFixture(({ repos, db, project, chapter }) => {
  const queued = repos.storyBible.queueStoryBibleChangeSet(db, { projectId: project.id, chapterId: chapter.id, costPer1kTokens: 0, currency: 'CNY' })
  assert.equal(repos.storyBible.setStoryBibleChangeSetStatus(db, queued.id, 'paused')?.status, 'paused')
  assert.equal(repos.storyBible.setStoryBibleChangeSetStatus(db, queued.id, 'queued')?.status, 'queued')
  assert.equal(repos.storyBible.markStoryBibleChangeSetFailed(db, queued.id, '第 4 章模型超时')?.errorMessage, '第 4 章模型超时')
  assert.equal(repos.storyBible.setStoryBibleChangeSetStatus(db, queued.id, 'skipped')?.status, 'skipped')
}))
