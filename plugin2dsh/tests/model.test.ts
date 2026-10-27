import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StudioModel, type Connection } from '../src/client/model.ts'
import { DramaService, type ProjectTable } from '../src/host/domain.ts'
import type { Project, Request } from '../src/shared/contracts.ts'

async function fixture() {
  const data = new Map<string, Project>()
  const table: ProjectTable = {
    get: (id) => data.get(id),
    entries: () => data.entries(),
    put: async (id, p) => {
      data.set(id, p)
    },
    update: async (id, fn) => {
      const p = fn(data.get(id)!)
      data.set(id, p)
      return p
    },
  }
  const domain = new DramaService(table)
  const response = await domain.dispatch({
    op: 'create',
    title: '测试',
    synopsis: '',
    authorIntent: '',
  })
  if (response.kind !== 'project') throw new Error()
  const p = response.project
  let hold: ((result: unknown) => Promise<unknown>) | undefined
  let offline = false
  const connection: Connection = {
    rpc: {
      call: async (_channel, _endpoint, payload) => {
        if (offline) throw new Error('连接断开')
        const request = (payload as { args: { request: Request } }).args.request
        const result = await domain.dispatch(request)
        return { ok: true, value: hold ? await hold(result) : result }
      },
    },
  }
  const model = new StudioModel(connection)
  await model.open(p.id)
  return {
    model,
    domain,
    p,
    setHold: (fn: typeof hold) => {
      hold = fn
    },
    setOffline: (value: boolean) => {
      offline = value
    },
  }
}
test('poll/reconnect preserve dirty text and retain its original write basis', async () => {
  const { model, domain, p, setOffline } = await fixture()
  model.edit({ title: '作者未保存的标题' })
  await domain.dispatch({
    op: 'updateProject',
    projectId: p.id,
    expectedRevision: p.stateRevision,
    title: '另一窗口',
    synopsis: '',
    authorIntent: '',
    archived: false,
  })
  setOffline(true)
  await model.refresh()
  assert.equal(model.state.online, false)
  setOffline(false)
  await model.refresh()
  assert.equal(model.state.draft.title, '作者未保存的标题')
  assert.equal(model.state.project!.title, '另一窗口')
  await model.save()
  assert.equal(model.state.conflict, true)
  assert.equal(model.state.dirty, true)
  model.rebase()
  await model.save()
  assert.equal(model.state.project!.title, '作者未保存的标题')
  assert.equal(model.state.dirty, false)
  model.dispose()
})
test('dirty navigation is blocked and discard is explicit', async () => {
  const { model } = await fixture()
  model.edit({ title: '未保存' })
  assert.equal(model.select({ kind: 'history' }), false)
  assert.equal(model.state.view.kind, 'project')
  model.discard()
  assert.equal(model.select({ kind: 'history' }), true)
  model.dispose()
})
test('late refresh after navigation cannot replace a newer view or draft', async () => {
  const { model, setHold } = await fixture()
  let release!: (value: unknown) => void
  setHold(
    (result) =>
      new Promise((resolve) => {
        release = () => resolve(result)
      }),
  )
  const refresh = model.refresh()
  await new Promise((resolve) => setImmediate(resolve))
  model.select({ kind: 'history' })
  release(undefined)
  await refresh
  assert.equal(model.state.view.kind, 'history')
  model.dispose()
})
