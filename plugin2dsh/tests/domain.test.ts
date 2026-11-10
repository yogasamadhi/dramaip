import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DramaService, type ProjectTable } from '../src/host/domain.ts'
import { ProjectSchema, type Project, type Request } from '../src/shared/contracts.ts'

class Table implements ProjectTable {
  data = new Map<string, Project>()
  fail = false
  chain = Promise.resolve()
  get(id: string) {
    return this.data.get(id)
  }
  entries() {
    return this.data.entries()
  }
  async put(id: string, p: Project) {
    if (this.fail) throw new Error('disk failure')
    this.data.set(id, structuredClone(p))
  }
  async update(id: string, fn: (p: Project) => Project) {
    const next = this.chain.then(async () => {
      const p = fn(this.data.get(id)!)
      await this.put(id, p)
      return p
    })
    this.chain = next.then(
      () => {},
      () => {},
    )
    return next
  }
}
async function fixture() {
  const table = new Table(),
    service = new DramaService(table)
  async function call(request: Request) {
    const r = await service.dispatch(request)
    assert.equal(r.kind, 'project')
    if (r.kind !== 'project') throw new Error()
    return r.project
  }
  let p = await call({
    op: 'create',
    title: '海边的信',
    synopsis: '一段故事',
    authorIntent: '尊重人物选择',
  })
  p = await call({
    op: 'createChapter',
    projectId: p.id,
    expectedRevision: p.stateRevision,
    title: '第一章',
    text: '原稿\n“你好。”',
  })
  const propose = (project = p) =>
    service.dispatch(
      {
        op: 'propose',
        projectId: project.id,
        chapterId: project.chapters[0]!.id,
        baseRevision: project.chapters[0]!.revision,
        baseContentRevision: project.contentRevision,
        text: '新稿\n“再见。”',
        explanation: '保持作者意图',
      },
      { callId: 'call-1', sessionId: 'session-1' },
    )
  return { table, service, p, call, propose }
}
test('proposal does not alter manuscript; acceptance is one atomic revision and idempotent', async () => {
  const { service, p, propose, call } = await fixture()
  await propose()
  const withProposal = service.get(p.id),
    q = withProposal.proposals[0]!
  assert.equal(withProposal.chapters[0]!.text, p.chapters[0]!.text)
  assert.equal(withProposal.contentRevision, p.contentRevision)
  assert.equal(q.sessionId, 'session-1')
  const request = {
    op: 'accept' as const,
    projectId: p.id,
    expectedRevision: withProposal.stateRevision,
    proposalId: q.id,
  }
  const accepted = await call(request)
  assert.equal(accepted.chapters[0]!.revision, 2)
  assert.equal(accepted.history.at(-1)!.id, accepted.proposals[0]!.acceptedRevisionId)
  assert.deepEqual(await call(request), accepted)
  assert.equal(accepted.history.length, 2)
})
test('any changed authoritative context invalidates a proposal', async () => {
  const { service, p, propose, call } = await fixture()
  await propose()
  let latest = service.get(p.id)
  latest = await call({
    op: 'saveSetting',
    projectId: p.id,
    expectedRevision: latest.stateRevision,
    kind: 'world',
    title: '时间线',
    text: '十年前',
    archived: false,
  })
  await assert.rejects(
    call({
      op: 'accept',
      projectId: p.id,
      expectedRevision: latest.stateRevision,
      proposalId: latest.proposals[0]!.id,
    }),
    { code: 'dramaip/stale-proposal' },
  )
  await assert.rejects(propose(), { code: 'dramaip/stale-proposal' })
  assert.equal(service.get(p.id).chapters[0]!.revision, 1)
})
test('concurrent author saves cannot silently overwrite each other', async () => {
  const { p, call } = await fixture()
  const request = {
    op: 'saveChapter' as const,
    projectId: p.id,
    expectedRevision: p.stateRevision,
    chapterId: p.chapters[0]!.id,
    title: '第一章',
    text: '稿件甲',
  }
  const results = await Promise.allSettled([call(request), call({ ...request, text: '稿件乙' })])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.equal(failure.reason.code, 'dramaip/conflict')
})
test('failed persistence leaves manuscript, history and proposal unchanged, then allows retry', async () => {
  const { p, service, table, propose, call } = await fixture()
  await propose()
  const before = service.get(p.id)
  const request = {
    op: 'accept' as const,
    projectId: p.id,
    expectedRevision: before.stateRevision,
    proposalId: before.proposals[0]!.id,
  }
  table.fail = true
  await assert.rejects(call(request), /disk failure/)
  assert.deepEqual(service.get(p.id), before)
  table.fail = false
  await call(request)
  const restarted = new DramaService(table)
  assert.equal(restarted.get(p.id).proposals[0]!.status, 'accepted')
})
test('history restoration creates a new version and cross-project references are refused', async () => {
  const { p, call, propose, service } = await fixture()
  await propose()
  let current = service.get(p.id)
  current = await call({
    op: 'accept',
    projectId: p.id,
    expectedRevision: current.stateRevision,
    proposalId: current.proposals[0]!.id,
  })
  current = await call({
    op: 'restore',
    projectId: p.id,
    expectedRevision: current.stateRevision,
    revisionId: p.history[0]!.id,
  })
  assert.equal(current.chapters[0]!.text, p.chapters[0]!.text)
  assert.equal(current.chapters[0]!.revision, 3)
  assert.equal(current.history[2]!.source, 'restore')
  await assert.rejects(
    call({
      op: 'saveChapter',
      projectId: p.id,
      expectedRevision: current.stateRevision,
      chapterId: randomUUID(),
      title: '错域',
      text: '内容',
    }),
    { code: 'dramaip/not-found' },
  )
})
test('JSON round trip remaps every reference, preserves lineage and never replaces original', async () => {
  const { p, call, propose, service } = await fixture()
  await propose()
  let current = service.get(p.id)
  current = await call({
    op: 'accept',
    projectId: p.id,
    expectedRevision: current.stateRevision,
    proposalId: current.proposals[0]!.id,
  })
  const exported = await service.dispatch({ op: 'export', projectId: p.id, format: 'json' })
  assert.equal(exported.kind, 'export')
  if (exported.kind !== 'export') return
  const pack = JSON.parse(exported.text)
  const imported = await call({ op: 'import', package: pack })
  assert.notEqual(imported.id, p.id)
  assert.notEqual(imported.chapters[0]!.id, p.chapters[0]!.id)
  assert.equal(imported.importedFrom!.projectId, p.id)
  assert.equal(imported.proposals[0]!.acceptedRevisionId, imported.history[1]!.id)
  assert.deepEqual(
    imported.chapters.map((c) => c.text),
    current.chapters.map((c) => c.text),
  )
  assert.deepEqual(service.get(p.id), current)
  assert.equal(ProjectSchema.safeParse(imported).success, true)
  pack.project.history[0].chapterId = randomUUID()
  await assert.rejects(call({ op: 'import', package: pack }), { code: 'dramaip/invalid-input' })
  pack.format = 'unknown'
  await assert.rejects(call({ op: 'import', package: pack }))
})
test('Markdown export contains only manuscript in chapter order; long CJK survives export', async () => {
  const { p, call, service } = await fixture()
  const long = '中文长章节\n'.repeat(20_000)
  const latest = await call({
    op: 'createChapter',
    projectId: p.id,
    expectedRevision: p.stateRevision,
    title: '第二章',
    text: long,
  })
  const exported = await service.dispatch({
    op: 'export',
    projectId: latest.id,
    format: 'markdown',
  })
  assert.equal(exported.kind, 'export')
  if (exported.kind !== 'export') return
  assert.ok(exported.text.includes(long))
  assert.ok(exported.text.indexOf('## 第一章') < exported.text.indexOf('## 第二章'))
  assert.ok(!exported.text.includes('尊重人物选择'))
})
test('archive, reject and invalid records are explicit and non-destructive', async () => {
  const { p, propose, service, call } = await fixture()
  await propose()
  let latest = service.get(p.id)
  latest = await call({
    op: 'reject',
    projectId: p.id,
    expectedRevision: latest.stateRevision,
    proposalId: latest.proposals[0]!.id,
  })
  assert.equal(latest.contentRevision, p.contentRevision)
  latest = await call({
    op: 'updateProject',
    projectId: p.id,
    expectedRevision: latest.stateRevision,
    title: latest.title,
    synopsis: latest.synopsis,
    authorIntent: latest.authorIntent,
    archived: true,
  })
  await assert.rejects(
    call({
      op: 'createChapter',
      projectId: p.id,
      expectedRevision: latest.stateRevision,
      title: '不允许',
      text: '',
    }),
    { code: 'dramaip/archived' },
  )
  const bad = structuredClone(latest)
  bad.chapters[0]!.text = '没有对应版本的正文'
  assert.equal(ProjectSchema.safeParse(bad).success, false)
  assert.equal(service.get(p.id).archived, true)
})
