import { randomUUID } from 'node:crypto'
import {
  PackageSchema,
  ProjectSchema,
  RequestSchema,
  type Project,
  type ProjectSummary,
  type Request,
  type Response,
  type Source,
} from '../shared/contracts.ts'

export class DramaError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
export interface ProjectTable {
  get(id: string): Project | undefined
  entries(): IterableIterator<[string, Project]>
  put(id: string, project: Project): Promise<void>
  update(id: string, transform: (current: Project) => Project): Promise<Project>
}

export function summary(p: Project): ProjectSummary {
  return {
    id: p.id,
    title: p.title,
    synopsis: p.synopsis,
    archived: p.archived,
    stateRevision: p.stateRevision,
    contentRevision: p.contentRevision,
    updatedAt: p.updatedAt,
    chapters: p.chapters.length,
    pending: p.proposals.filter((x) => x.status === 'pending').length,
  }
}
export function proposalStale(p: Project, proposal: Project['proposals'][number]): boolean {
  return (
    p.contentRevision !== proposal.baseContentRevision ||
    p.chapters.find((c) => c.id === proposal.chapterId)?.revision !== proposal.baseRevision
  )
}

/** Domain writes are pure transforms on DSH's single durable write queue. */
export class DramaService {
  private readonly table: ProjectTable
  constructor(table: ProjectTable) {
    this.table = table
  }

  get(id: string): Project {
    const p = this.table.get(id)
    if (!p) throw new DramaError('dramaip/not-found', '项目不存在')
    return structuredClone(p)
  }

  async dispatch(input: unknown, source: Source = {}): Promise<Response> {
    const parsed = RequestSchema.safeParse(input)
    if (!parsed.success)
      throw new DramaError(
        'dramaip/invalid-input',
        parsed.error.issues.map((i) => i.message).join('；'),
      )
    const r = parsed.data
    if (r.op === 'list')
      return {
        kind: 'projects',
        projects: [...this.table.entries()]
          .map(([, p]) => summary(p))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }
    if (r.op === 'get') return { kind: 'project', project: this.get(r.projectId) }
    if (r.op === 'export') {
      const p = this.get(r.projectId)
      const filename =
        p.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '_') || '作品'
      return {
        kind: 'export',
        format: r.format,
        filename: `${filename}.${r.format === 'json' ? 'json' : 'md'}`,
        text:
          r.format === 'json'
            ? JSON.stringify(
                {
                  format: 'dramaip-dsh-project-v1',
                  exportedAt: new Date().toISOString(),
                  project: p,
                },
                null,
                2,
              )
            : `# ${p.title}\n\n${p.chapters.map((c) => `## ${c.title}\n\n${c.text}`).join('\n\n')}`,
      }
    }
    if (r.op === 'create' || r.op === 'import') {
      const p =
        r.op === 'create'
          ? this.empty(r.title, r.synopsis, r.authorIntent)
          : this.importProject(r.package)
      const validated = ProjectSchema.parse(p)
      await this.table.put(p.id, validated)
      return { kind: 'project', project: structuredClone(validated) }
    }
    // Check existence before update so cross-project IDs never access another record.
    this.get(r.projectId)
    const updated = await this.table.update(r.projectId, (current) =>
      this.mutate(structuredClone(current), r, source),
    )
    return { kind: 'project', project: structuredClone(updated) }
  }

  private empty(title: string, synopsis: string, authorIntent: string): Project {
    const now = new Date().toISOString()
    return {
      id: randomUUID(),
      title,
      synopsis,
      authorIntent,
      archived: false,
      contentRevision: 0,
      stateRevision: 0,
      createdAt: now,
      updatedAt: now,
      chapters: [],
      settings: [],
      history: [],
      proposals: [],
    }
  }

  private importProject(input: unknown): Project {
    const pack = PackageSchema.parse(input)
    const p = structuredClone(pack.project)
    const original = p.id
    const ids = new Map<string, string>()
    for (const old of [
      p.id,
      ...p.chapters.map((x) => x.id),
      ...p.settings.map((x) => x.id),
      ...p.history.map((x) => x.id),
      ...p.proposals.map((x) => x.id),
    ])
      ids.set(old, randomUUID())
    const remap = (old: string) => ids.get(old)!
    p.id = remap(p.id)
    for (const c of p.chapters) c.id = remap(c.id)
    for (const s of p.settings) s.id = remap(s.id)
    for (const h of p.history) {
      h.id = remap(h.id)
      h.chapterId = remap(h.chapterId)
    }
    for (const q of p.proposals) {
      q.id = remap(q.id)
      q.chapterId = remap(q.chapterId)
      if (q.acceptedRevisionId) q.acceptedRevisionId = remap(q.acceptedRevisionId)
    }
    p.importedFrom = { projectId: original, importedAt: new Date().toISOString() }
    p.updatedAt = p.importedFrom.importedAt
    return p
  }

  private mutate(
    p: Project,
    r: Exclude<Request, { op: 'list' | 'get' | 'export' | 'create' | 'import' }>,
    source: Source,
  ): Project {
    // Idempotent retry may carry the revision from before the original acceptance.
    if (r.op === 'accept') {
      const prior = p.proposals.find((q) => q.id === r.proposalId)
      if (prior?.status === 'accepted') return p
    }
    if (r.op !== 'propose' && p.stateRevision !== r.expectedRevision)
      throw new DramaError('dramaip/conflict', '项目已变化，请刷新后重试；当前草稿已保留')
    if (p.archived && !(r.op === 'updateProject' && !r.archived))
      throw new DramaError('dramaip/archived', '请先恢复已归档项目')
    let contentChanged = true
    const chapter = (chapterId: string) => {
      const c = p.chapters.find((x) => x.id === chapterId)
      if (!c) throw new DramaError('dramaip/not-found', '本项目中不存在该章节')
      return c
    }
    const snapshot = (
      c: Project['chapters'][number],
      source: Project['history'][number]['source'],
    ) => {
      c.revision++
      const h = {
        id: randomUUID(),
        chapterId: c.id,
        title: c.title,
        text: c.text,
        revision: c.revision,
        createdAt: new Date().toISOString(),
        source,
      }
      p.history.push(h)
      return h
    }
    switch (r.op) {
      case 'updateProject':
        Object.assign(p, {
          title: r.title,
          synopsis: r.synopsis,
          authorIntent: r.authorIntent,
          archived: r.archived,
        })
        break
      case 'createChapter':
      case 'importMarkdown': {
        const c = { id: randomUUID(), title: r.title, text: r.text, revision: 0 }
        p.chapters.push(c)
        snapshot(c, r.op === 'importMarkdown' ? 'import' : 'manual')
        break
      }
      case 'saveChapter': {
        const c = chapter(r.chapterId)
        c.title = r.title
        c.text = r.text
        snapshot(c, 'manual')
        break
      }
      case 'reorderChapter': {
        chapter(r.chapterId)
        const from = p.chapters.findIndex((c) => c.id === r.chapterId)
        const to = from + (r.direction === 'up' ? -1 : 1)
        if (to < 0 || to >= p.chapters.length) return p
        ;[p.chapters[from], p.chapters[to]] = [p.chapters[to]!, p.chapters[from]!]
        break
      }
      case 'saveSetting': {
        const next = {
          id: r.settingId ?? randomUUID(),
          kind: r.kind,
          title: r.title,
          text: r.text,
          archived: r.archived,
        }
        if (r.settingId) {
          const index = p.settings.findIndex((s) => s.id === r.settingId)
          if (index < 0) throw new DramaError('dramaip/not-found', '本项目中不存在该设定')
          p.settings[index] = next
        } else p.settings.push(next)
        break
      }
      case 'restore': {
        const h = p.history.find((h) => h.id === r.revisionId)
        if (!h) throw new DramaError('dramaip/not-found', '本项目中不存在该历史版本')
        const c = chapter(h.chapterId)
        c.title = h.title
        c.text = h.text
        snapshot(c, 'restore')
        break
      }
      case 'propose': {
        const c = chapter(r.chapterId)
        if (c.revision !== r.baseRevision || p.contentRevision !== r.baseContentRevision)
          throw new DramaError(
            'dramaip/stale-proposal',
            '生成期间正文或设定已变化，请重新读取后生成提案',
          )
        // An Agent retry of the same call cannot create duplicate proposals.
        if (
          source.callId &&
          p.proposals.some((q) => q.callId === source.callId && q.sessionId === source.sessionId)
        )
          return p
        p.proposals.push({
          id: randomUUID(),
          chapterId: c.id,
          baseRevision: r.baseRevision,
          baseContentRevision: r.baseContentRevision,
          text: r.text,
          explanation: r.explanation,
          status: 'pending',
          createdAt: new Date().toISOString(),
          ...source,
        })
        contentChanged = false
        break
      }
      case 'accept':
      case 'reject': {
        const q = p.proposals.find((q) => q.id === r.proposalId)
        if (!q) throw new DramaError('dramaip/not-found', '本项目中不存在该提案')
        if (q.status !== 'pending') throw new DramaError('dramaip/conflict', '该提案已处理')
        if (r.op === 'accept') {
          if (proposalStale(p, q))
            throw new DramaError(
              'dramaip/stale-proposal',
              '正文或上下文已变化，此提案已过期，请重新生成',
            )
          const c = chapter(q.chapterId)
          c.text = q.text
          q.acceptedRevisionId = snapshot(c, 'ai').id
          q.status = 'accepted'
        } else {
          q.status = 'rejected'
          contentChanged = false
        }
        break
      }
    }
    p.stateRevision++
    if (contentChanged) p.contentRevision++
    p.updatedAt = new Date().toISOString()
    return ProjectSchema.parse(p)
  }
}
