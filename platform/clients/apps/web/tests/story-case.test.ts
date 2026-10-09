import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { STORY_CASE, STORY_CASE_ARTIFACTS, storyCaseArtifact, storyCaseFileURL } from '../lib/story-case'
import { GET, generateStaticParams, dynamic, dynamicParams } from '../app/cases/story/files/[artifact]/route'
import CasesPage from '../app/cases/page'
import StoryCasePage from '../app/cases/story/page'

test('author display has two independent chapters, a complete pilot, six shots and explicit source/addition boundaries', () => {
  const chapterIds = new Set<string>(STORY_CASE.chapters.map((chapter) => chapter.id))
  const sceneIds = new Set<string>(STORY_CASE.pilot.scenes.map((scene) => scene.id))
  assert.equal(chapterIds.size, 2)
  assert.equal(sceneIds.size, 3)
  assert.equal(STORY_CASE.episodes.length, 3)
  assert.equal(STORY_CASE.shots.length, 6)
  assert.equal(STORY_CASE.strategies.length, 2)
  assert(STORY_CASE.strategies.some((strategy) => strategy.id === STORY_CASE.selectedStrategyId))
  for (const item of [...STORY_CASE.diagnosis, ...STORY_CASE.episodes, ...STORY_CASE.pilot.scenes, ...STORY_CASE.shots])
    for (const id of item.sourceChapterIds) assert(chapterIds.has(id))
  for (const shot of STORY_CASE.shots) assert(sceneIds.has(shot.sceneId))
  assert(STORY_CASE.pilot.scenes.at(-1)?.body.includes('首集结束'))
  assert(STORY_CASE.episodes.every((episode) => episode.additions.length > 0))
  assert.equal(STORY_CASE.handoff.mediaRequired, false)
  assert.equal(STORY_CASE.evidenceKind, 'author-written-fictional')
  assert.equal(STORY_CASE.selectionKind, 'author-written-example-not-runtime-adoption')
  assert.equal(STORY_CASE.qualityConclusion, 'not-established')
  assert.equal(STORY_CASE.releaseReady, false)
})

test('novel download contains only its two chapters and memory, not forced screenplay/adaptation output', () => {
  const file = storyCaseArtifact('manuscript.txt')
  assert(file)
  for (const chapter of STORY_CASE.chapters) assert(file.body.includes(chapter.content))
  for (const memory of STORY_CASE.memories) assert(file.body.includes(memory.known))
  assert(file.body.includes('不是完整长篇小说'))
  assert(!file.body.includes('EXT.'))
  assert(!file.body.includes('strategy-a'))
  assert(!file.body.includes('shot-1'))
})

test('full pilot Fountain and storyboard CSV preserve the exact same scenes/shots and do not leak later-chapter knowledge into the pilot', () => {
  const script = storyCaseArtifact('pilot.fountain')?.body
  const csv = storyCaseArtifact('storyboard.csv')?.body
  assert(script && csv)
  for (const scene of STORY_CASE.pilot.scenes) {
    assert(script.includes(scene.heading))
    assert(script.includes(scene.body))
    assert.deepEqual(scene.sourceChapterIds, ['chapter-1'])
    for (const later of ['潮汐表', '母亲曾要他等一个人']) assert(!scene.body.includes(later))
  }
  assert(csv.startsWith('\uFEFF'))
  assert.equal(csv.trim().split('\r\n').length, 7)
  for (const shot of STORY_CASE.shots) {
    for (const field of [shot.id, shot.sceneId, shot.action, shot.sourceNote]) assert(csv.includes(field))
  }
})

test('structured author demo includes the whole chosen adaptation and unknowns, not a runtime project or authorization receipt', () => {
  const file = storyCaseArtifact('adaptation-demo.json')
  assert(file)
  const data = JSON.parse(file.body)
  assert.equal(data.revision, STORY_CASE.revision)
  for (const field of ['chapters', 'memories', 'diagnosis', 'strategies', 'episodes', 'pilot', 'shots', 'handoff'] as const)
    assert.deepEqual(data[field], STORY_CASE[field])
  assert.equal(data.handoff.kind, 'author-demo-data-not-dramaip-project-package')
  for (const gap of ['实际模型', 'Runtime正式采用', '真实用户', '授权']) assert(data.handoff.missing.some((item: string) => item.includes(gap)))
  assert.equal(data.releaseReady, false)
  assert(!file.body.includes('credentialRef'))
  assert(!file.body.includes('modelVersion'))
})

test('each fixed public download serves exact UTF-8 bytes with attachment type, evidence label, nosniff and actual body hash', async () => {
  assert.equal(dynamic, 'force-static')
  assert.equal(dynamicParams, false)
  assert.deepEqual(generateStaticParams(), STORY_CASE_ARTIFACTS.map(({ file }) => ({ artifact: file })))
  for (const descriptor of STORY_CASE_ARTIFACTS) {
    const expected = storyCaseArtifact(descriptor.file)
    assert(expected)
    const url = storyCaseFileURL(descriptor.file)
    const response = await GET(new Request(`http://local.test${url}`), { params: Promise.resolve({ artifact: descriptor.file }) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), descriptor.mediaType)
    assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="${descriptor.file}"`)
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(response.headers.get('X-DramaIP-Example-Evidence'), 'author-written-fictional')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.deepEqual(bytes, Buffer.from(expected.body))
    assert.equal(response.headers.get('ETag'), `"sha256-${createHash('sha256').update(bytes).digest('hex')}"`)
  }
})

test('unknown/path/credential-like/header-injection file names never choose a private file or print the input', async () => {
  for (const artifact of ['missing.json', '../private.txt', '/private.txt', '__proto__', 'pilot.fountain\r\nX-Key: private-canary', 'credentialRef']) {
    assert.equal(storyCaseArtifact(artifact), undefined)
    const response = await GET(new Request('http://local.test/example'), { params: Promise.resolve({ artifact }) })
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('Content-Disposition'), null)
    assert(!await response.text().then((body) => body.includes(artifact)))
  }
})

test('ordinary case index splits novel/adaptation outcomes and story page links all four exact artifacts with honest boundaries', () => {
  const index = renderToStaticMarkup(createElement(CasesPage))
  assert(index.includes('独立小说'))
  assert(index.includes('/cases/story#adaptation'))
  assert(index.includes('/cases/demo'))
  const page = renderToStaticMarkup(createElement(StoryCasePage))
  for (const id of ['novel', 'adaptation', 'handoff']) assert(page.includes(`id="${id}"`))
  for (const file of STORY_CASE_ARTIFACTS) assert(page.includes(storyCaseFileURL(file.file)))
  for (const scene of STORY_CASE.pilot.scenes) assert(page.includes(scene.heading))
  for (const text of ['作者编写', '不是已运行的 AI', '不是DramaIP项目包', '未核验', '不必创建改编', '不是完整小说']) assert(page.includes(text))
  assert(!page.includes('首集剧本片段'))
  assert(!page.includes('允许复制与改编'))
})
