import { defineTool, type ToolExecution, type ParameterSpec } from '@deepseek-ai/dsh-tools'
import { textStats } from '../shared/stats.ts'
import { summary, type DramaService } from './domain.ts'
import type { HostContext } from './context.ts'

export function installTools(ctx: HostContext, domain: DramaService): void {
  const string = (description: string): ParameterSpec => ({
    type: 'string',
    required: true,
    description,
  })
  const number = (description: string): ParameterSpec => ({
    type: 'number',
    required: true,
    description,
  })
  const register = (
    name: string,
    description: string,
    parameters: Record<string, ParameterSpec>,
    execute: (args: Record<string, unknown>, exec: ToolExecution) => Promise<string>,
  ) => {
    const definition = defineTool({
      name,
      description,
      parameters,
      output: {
        schema: { type: 'string' },
        render: (_args, value: string) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        return execute(args, exec)
      },
    })
    ctx.effect(() => ctx.tools.register(definition), `dramaip:tool:${name}`)
  }
  const project = {
    projectId: string('Explicit DramaIP project UUID, obtained from list_projects or the author'),
  }
  const chapter = { ...project, chapterId: string('Explicit chapter UUID from project_summary') }
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'dramaip_text_stats',
          description:
            'Count characters, CJK characters, Latin words, paragraphs, dialogue lines and reading minutes. Reads no files.',
          parameters: {
            text: { type: 'string', required: true, description: 'Chapter or excerpt' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                characters: { type: 'integer', required: true },
                cjkCharacters: { type: 'integer', required: true },
                latinWords: { type: 'integer', required: true },
                paragraphs: { type: 'integer', required: true },
                dialogueLines: { type: 'integer', required: true },
                readingMinutes: { type: 'integer', required: true },
              },
            },
            render: (_args, value: ReturnType<typeof textStats>) => [
              { type: 'text', text: JSON.stringify(value) },
            ],
          },
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            return textStats(args.text)
          },
        }),
      ),
    'dramaip:tool:dramaip_text_stats',
  )
  register(
    'dramaip_list_projects',
    'List DramaIP story projects and IDs. No manuscript text. Ask the author which project if ambiguous.',
    {},
    async () => JSON.stringify(await domain.dispatch({ op: 'list' })),
  )
  register(
    'dramaip_project_summary',
    'Read synopsis, author intent, chapter IDs/revisions and contentRevision. Read settings and chapter before proposing changes.',
    project,
    async (args) => {
      const p = domain.get(String(args.projectId))
      return JSON.stringify({
        ...summary(p),
        authorIntent: p.authorIntent,
        chapterList: p.chapters.map(({ id, title, revision }) => ({ id, title, revision })),
      })
    },
  )
  register(
    'dramaip_read_chapter',
    'Read one chapter and its exact revision and project contentRevision. Do not invent versions.',
    chapter,
    async (args) => {
      const p = domain.get(String(args.projectId))
      const c = p.chapters.find((c) => c.id === args.chapterId)
      if (!c) throw new Error('本项目中不存在该章节')
      return JSON.stringify({ projectId: p.id, contentRevision: p.contentRevision, chapter: c })
    },
  )
  register(
    'dramaip_read_settings',
    'Read author intent, characters and world settings, including archived markers. Archived settings are not current constraints.',
    project,
    async (args) => {
      const p = domain.get(String(args.projectId))
      return JSON.stringify({
        projectId: p.id,
        contentRevision: p.contentRevision,
        authorIntent: p.authorIntent,
        settings: p.settings,
      })
    },
  )
  register(
    'dramaip_propose_chapter',
    'Submit a FULL replacement chapter as a pending proposal. Does NOT change authoritative text. Use versions from reads; the author previews/adopts in the DramaIP panel. Never claim a proposal was adopted.',
    {
      ...chapter,
      baseRevision: number('Exact chapter revision read'),
      baseContentRevision: number('Exact project contentRevision read'),
      text: string('Full proposed chapter Markdown'),
      explanation: string('Explain changes and how author intent/settings are preserved'),
    },
    async (args, exec) => {
      const response = await domain.dispatch(
        { ...args, op: 'propose' },
        { callId: exec.callId, ...(exec.agent?.id ? { sessionId: exec.agent.id } : {}) },
      )
      if (response.kind !== 'project') throw new Error('Unexpected response')
      const p = response.project
      return JSON.stringify({
        status: 'pending',
        projectId: p.id,
        proposalId: p.proposals.find(
          (q) => q.callId === exec.callId && q.sessionId === exec.agent?.id,
        )?.id,
        message: '正文未改变，请作者在尽意面板查看差异并采用。',
      })
    },
  )
}
