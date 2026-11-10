import { z } from 'zod'

const id = z.string().uuid()
const version = z.number().int().nonnegative()
const title = z.string().trim().min(1).max(200)
const text = z.string().max(2_000_000)
const time = z.string().datetime()
export const ChapterSchema = z.strictObject({ id, title, text, revision: version })
export const SettingSchema = z.strictObject({
  id,
  kind: z.enum(['character', 'world']),
  title,
  text,
  archived: z.boolean(),
})
export const RevisionSchema = z.strictObject({
  id,
  chapterId: id,
  title,
  text,
  revision: version,
  createdAt: time,
  source: z.enum(['manual', 'ai', 'restore', 'import']),
})
export const ProposalSchema = z.strictObject({
  id,
  chapterId: id,
  baseRevision: version,
  baseContentRevision: version,
  text,
  explanation: text,
  status: z.enum(['pending', 'accepted', 'rejected']),
  createdAt: time,
  callId: z.string().optional(),
  sessionId: z.string().optional(),
  acceptedRevisionId: id.optional(),
})
export const ProjectSchema = z
  .strictObject({
    id,
    title,
    synopsis: text,
    authorIntent: text,
    archived: z.boolean(),
    stateRevision: version,
    contentRevision: version,
    createdAt: time,
    updatedAt: time,
    chapters: z.array(ChapterSchema).max(1000),
    settings: z.array(SettingSchema).max(2000),
    history: z.array(RevisionSchema),
    proposals: z.array(ProposalSchema),
    importedFrom: z.strictObject({ projectId: id, importedAt: time }).optional(),
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    const all = [
      p.id,
      ...p.chapters.map((c) => c.id),
      ...p.settings.map((s) => s.id),
      ...p.history.map((h) => h.id),
      ...p.proposals.map((s) => s.id),
    ]
    if (new Set(all).size !== all.length) fail('项目内部 ID 重复')
    const chapters = new Map(p.chapters.map((c) => [c.id, c]))
    const revisions = new Set<string>()
    for (const h of p.history) {
      const c = chapters.get(h.chapterId)
      if (!c || h.revision > c.revision || h.revision < 1) fail('版本引用无效')
      const key = `${h.chapterId}:${h.revision}`
      if (revisions.has(key)) fail('章节版本重复')
      revisions.add(key)
    }
    for (const c of p.chapters) {
      const head = p.history.find((h) => h.chapterId === c.id && h.revision === c.revision)
      if (!head || head.text !== c.text || head.title !== c.title) fail('章节与历史版本不一致')
      const count = p.history.filter((h) => h.chapterId === c.id).length
      if (count !== c.revision) fail('章节历史不连续')
    }
    for (const proposal of p.proposals) {
      const c = chapters.get(proposal.chapterId)
      if (
        !c ||
        proposal.baseRevision < 1 ||
        proposal.baseRevision > c.revision ||
        proposal.baseContentRevision > p.contentRevision
      )
        fail('提案基础引用无效')
      if (proposal.status === 'accepted') {
        const accepted = p.history.find((h) => h.id === proposal.acceptedRevisionId)
        if (
          !accepted ||
          accepted.chapterId !== proposal.chapterId ||
          accepted.source !== 'ai' ||
          accepted.text !== proposal.text
        )
          fail('提案采用版本引用无效')
      } else if (proposal.acceptedRevisionId !== undefined) fail('未采用提案不能包含采用版本')
    }
  })
export type Project = z.infer<typeof ProjectSchema>
export type Chapter = z.infer<typeof ChapterSchema>
export type Setting = z.infer<typeof SettingSchema>
export type Proposal = z.infer<typeof ProposalSchema>
export const PackageSchema = z.strictObject({
  format: z.literal('dramaip-dsh-project-v1'),
  exportedAt: time,
  project: ProjectSchema,
})
export type ProjectPackage = z.infer<typeof PackageSchema>

const base = { projectId: id, expectedRevision: version }
export const RequestSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('list') }),
  z.strictObject({ op: z.literal('get'), projectId: id }),
  z.strictObject({ op: z.literal('create'), title, synopsis: text, authorIntent: text }),
  z.strictObject({
    op: z.literal('updateProject'),
    ...base,
    title,
    synopsis: text,
    authorIntent: text,
    archived: z.boolean(),
  }),
  z.strictObject({ op: z.literal('createChapter'), ...base, title, text }),
  z.strictObject({ op: z.literal('importMarkdown'), ...base, title, text }),
  z.strictObject({ op: z.literal('saveChapter'), ...base, chapterId: id, title, text }),
  z.strictObject({
    op: z.literal('reorderChapter'),
    ...base,
    chapterId: id,
    direction: z.enum(['up', 'down']),
  }),
  z.strictObject({
    op: z.literal('saveSetting'),
    ...base,
    settingId: id.optional(),
    kind: z.enum(['character', 'world']),
    title,
    text,
    archived: z.boolean(),
  }),
  z.strictObject({ op: z.literal('restore'), ...base, revisionId: id }),
  z.strictObject({ op: z.literal('accept'), ...base, proposalId: id }),
  z.strictObject({ op: z.literal('reject'), ...base, proposalId: id }),
  z.strictObject({
    op: z.literal('propose'),
    projectId: id,
    chapterId: id,
    baseRevision: version,
    baseContentRevision: version,
    text,
    explanation: text,
  }),
  z.strictObject({ op: z.literal('export'), projectId: id, format: z.enum(['json', 'markdown']) }),
  z.strictObject({ op: z.literal('import'), package: PackageSchema }),
])
export type Request = z.infer<typeof RequestSchema>
export const SummarySchema = z.strictObject({
  id,
  title,
  synopsis: text,
  archived: z.boolean(),
  stateRevision: version,
  contentRevision: version,
  updatedAt: time,
  chapters: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
})
export type ProjectSummary = z.infer<typeof SummarySchema>
export const ResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('projects'), projects: z.array(SummarySchema) }),
  z.strictObject({ kind: z.literal('project'), project: ProjectSchema }),
  z.strictObject({
    kind: z.literal('export'),
    filename: z.string(),
    text: z.string(),
    format: z.enum(['json', 'markdown']),
  }),
])
export type Response = z.infer<typeof ResponseSchema>
export type Source = { callId?: string; sessionId?: string }
