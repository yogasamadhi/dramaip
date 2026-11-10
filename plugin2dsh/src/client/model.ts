import {
  ResponseSchema,
  type Project,
  type ProjectSummary,
  type Request,
  type Response,
} from '../shared/contracts.ts'

export interface Connection {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<
      { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
    >
  }
}
export type View =
  | { kind: 'project' | 'proposals' | 'history' }
  | { kind: 'chapter' | 'setting'; id: string }
export type Draft = {
  title: string
  text: string
  synopsis: string
  authorIntent: string
  kind: 'character' | 'world'
  archived: boolean
}
export type State = {
  projects: ProjectSummary[]
  project: Project | undefined
  view: View
  draft: Draft
  dirty: boolean
  busy: boolean
  error: string
  notice: string
  online: boolean
  conflict: boolean
}
const empty = (): Draft => ({
  title: '',
  text: '',
  synopsis: '',
  authorIntent: '',
  kind: 'character',
  archived: false,
})
export function draftOf(p: Project, view: View): Draft {
  if (view.kind === 'project')
    return {
      ...empty(),
      title: p.title,
      synopsis: p.synopsis,
      authorIntent: p.authorIntent,
      archived: p.archived,
    }
  if (view.kind === 'chapter') {
    const c = p.chapters.find((c) => c.id === view.id)
    return { ...empty(), title: c?.title ?? '', text: c?.text ?? '' }
  }
  if (view.kind === 'setting') {
    const s = p.settings.find((s) => s.id === view.id)
    return s
      ? { ...empty(), title: s.title, text: s.text, kind: s.kind, archived: s.archived }
      : empty()
  }
  return empty()
}

/** Keeps wire state separate from the author's draft and fences late replies. */
export class StudioModel {
  state: State = {
    projects: [],
    project: undefined,
    view: { kind: 'project' },
    draft: empty(),
    dirty: false,
    busy: false,
    error: '',
    notice: '',
    online: true,
    conflict: false,
  }
  private listeners = new Set<() => void>()
  private baseline = ''
  private baseRevision = 0
  private epoch = 0
  private readSequence = 0
  private disposed = false
  private controller = new AbortController()
  private connection: Connection
  constructor(connection: Connection) {
    this.connection = connection
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.state
  private publish(patch: Partial<State>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const f of this.listeners) f()
  }
  private async call(request: Request): Promise<Response> {
    const result = await this.connection.rpc.call(
      '/api',
      'dramaip/dispatch',
      { args: { request } },
      this.controller.signal,
    )
    if (!result.ok) {
      const error = new Error(result.error.message)
      Object.assign(error, { code: result.error.code })
      throw error
    }
    return ResponseSchema.parse(result.value)
  }
  private loadDraft(p: Project, view: View) {
    const draft = draftOf(p, view)
    this.baseline = JSON.stringify(draft)
    this.baseRevision = p.stateRevision
    this.publish({ draft, dirty: false, conflict: false })
  }
  edit(patch: Partial<Draft>) {
    const draft = { ...this.state.draft, ...patch }
    this.publish({ draft, dirty: JSON.stringify(draft) !== this.baseline, notice: '' })
  }
  select(view: View): boolean {
    if (this.state.busy || this.state.dirty) {
      this.publish({ error: '请先保存或放弃当前草稿，再切换。' })
      return false
    }
    this.epoch++
    this.publish({ view, error: '', notice: '' })
    if (this.state.project) this.loadDraft(this.state.project, view)
    return true
  }
  discard() {
    if (this.state.project) this.loadDraft(this.state.project, this.state.view)
    this.publish({ error: '', notice: '已放弃未保存修改' })
  }
  rebase() {
    // Only called by the explicit conflict-resolution button after showing diff.
    const p = this.state.project
    if (!p) return
    this.baseRevision = p.stateRevision
    this.baseline = JSON.stringify(draftOf(p, this.state.view))
    this.publish({
      conflict: false,
      error: '',
      dirty: JSON.stringify(this.state.draft) !== this.baseline,
      notice: '已确认最新基准，请保存草稿',
    })
  }
  async open(projectId: string): Promise<void> {
    if (this.state.busy || this.state.dirty) {
      this.publish({ error: '请先保存或放弃当前草稿，再切换。' })
      return
    }
    const epoch = ++this.epoch
    this.publish({ busy: true, error: '' })
    try {
      const result = await this.call({ op: 'get', projectId })
      if (epoch !== this.epoch || result.kind !== 'project') return
      this.publish({ project: result.project, view: { kind: 'project' }, online: true, notice: '' })
      this.loadDraft(result.project, { kind: 'project' })
    } catch (error) {
      if (epoch === this.epoch) this.fail(error)
    } finally {
      if (epoch === this.epoch) this.publish({ busy: false })
    }
  }
  async refresh(): Promise<void> {
    if (this.disposed || this.state.busy) return
    const epoch = this.epoch,
      seq = ++this.readSequence,
      id = this.state.project?.id
    try {
      const list = await this.call({ op: 'list' })
      if (epoch !== this.epoch || seq !== this.readSequence) return
      if (list.kind === 'projects')
        this.publish({
          projects: list.projects,
          online: true,
          ...(!this.state.online ? { error: '' } : {}),
        })
      if (id) {
        if (
          list.kind === 'projects' &&
          list.projects.find((p) => p.id === id)?.stateRevision ===
            this.state.project?.stateRevision
        )
          return
        const result = await this.call({ op: 'get', projectId: id })
        if (
          epoch !== this.epoch ||
          seq !== this.readSequence ||
          result.kind !== 'project' ||
          this.state.busy
        )
          return
        const p = result.project
        if (p.stateRevision < (this.state.project?.stateRevision ?? -1)) return
        const changed = p.stateRevision !== this.state.project?.stateRevision
        this.publish({ project: p, online: true })
        if (!this.state.dirty) this.loadDraft(p, this.state.view)
        else if (changed)
          this.publish({ notice: '服务端已有变化，当前草稿仍保留。保存时会检查版本。' })
      }
    } catch (error) {
      if (epoch === this.epoch && seq === this.readSequence) this.fail(error, true)
    }
  }
  async save(): Promise<void> {
    const { project: p, view, draft: d } = this.state
    if (!p || !this.state.dirty) return
    const base = { projectId: p.id, expectedRevision: this.baseRevision }
    let request: Request
    if (view.kind === 'project')
      request = {
        op: 'updateProject',
        ...base,
        title: d.title,
        synopsis: d.synopsis,
        authorIntent: d.authorIntent,
        archived: d.archived,
      }
    else if (view.kind === 'chapter')
      request = { op: 'saveChapter', ...base, chapterId: view.id, title: d.title, text: d.text }
    else if (view.kind === 'setting')
      request = {
        op: 'saveSetting',
        ...base,
        settingId: view.id,
        kind: d.kind,
        title: d.title,
        text: d.text,
        archived: d.archived,
      }
    else return
    await this.mutate(request, true)
  }
  async mutate(request: Request, saving = false): Promise<Response | undefined> {
    if (this.state.busy) return
    if (!saving && this.state.dirty) {
      this.publish({ error: '请先保存或放弃当前草稿，再执行此操作。' })
      return
    }
    const epoch = ++this.epoch
    this.publish({ busy: true, error: '', notice: '' })
    try {
      const result = await this.call(request)
      if (epoch !== this.epoch) return
      if (result.kind === 'project') {
        const newProject = result.project.id !== this.state.project?.id
        const view = newProject ? { kind: 'project' as const } : this.state.view
        this.publish({ project: result.project, view, online: true })
        this.loadDraft(result.project, view)
      }
      this.publish({ notice: request.op === 'export' ? '已生成导出文件' : '已保存', online: true })
      return result
    } catch (error) {
      this.fail(error)
      if ((error as { code?: string }).code === 'dramaip/conflict') this.publish({ conflict: true })
    } finally {
      if (epoch === this.epoch) {
        this.publish({ busy: false })
        void this.refresh()
      }
    }
  }
  private fail(error: unknown, transport = false) {
    this.publish({
      error: error instanceof Error ? error.message : String(error),
      ...(transport ? { online: false } : {}),
    })
  }
  dispose() {
    this.disposed = true
    this.epoch++
    this.controller.abort()
    this.listeners.clear()
  }
}
