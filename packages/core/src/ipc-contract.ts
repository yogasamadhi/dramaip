import { z } from 'zod'

const id = z.string().min(1)
const maybeId = z.string().min(1).optional()
const objectPayload = z.object({}).passthrough()
const stringArray = z.array(z.string().min(1))

const aiTaskInput = objectPayload.extend({
  taskType: z.string().min(1),
  projectId: maybeId,
  chapterId: maybeId,
  characterId: maybeId,
  adaptationProjectId: maybeId,
  episodeId: maybeId,
  sceneId: maybeId,
  shotId: maybeId,
  userInstruction: z.string().optional(),
  templateContent: z.string().optional(),
  templateScope: z.string().optional(),
  chatHistory: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
})

const applyArtifactInput = objectPayload.extend({
  projectId: id,
  taskType: id,
})

const createVideoTaskInput = objectPayload.extend({
  providerConfigId: id,
  prompt: z.string().min(1),
  projectId: maybeId,
  episodeId: maybeId,
  sceneId: maybeId,
  shotId: maybeId,
  negativePrompt: z.string().optional(),
  referenceImageUrls: z.array(z.string()).optional(),
  note: z.string().optional(),
})

export const IPC_EXACT_SCHEMAS: Record<string, z.ZodType<unknown>[]> = {
  'project:list': [],
  'chapter:list': [id],
  'character:list': [id],
  'outline:list': [id, z.enum(['book', 'chapter']).optional()],
  'chapterMemory:list': [id],
  'characterState:list': [id],
  'visualProfile:list': [id],
  'visualSetting:list': [id],
  'storyEvent:list': [id],
  'foreshadowing:list': [id],
  'beat:list': [id],
  'highlight:list': [id],
  'feasibility:list': [id],
  'episode:list': [id],
  'script:list': [id],
  'project:importPackage': [],
  'evaluation:list': [id],
  'aiRun:list': [id],
  'aiRun:summarize': [],
  'model:list': [],
  'model:getDefault': [],
  'model:setDefault': [id],
  'model:listTaskBindings': [],
  'model:upsertTaskBinding': [id, id],
  'model:deleteTaskBinding': [id],
  'model:testConnection': [objectPayload],
  'ai:run': [aiTaskInput],
  'ai:runStream': [aiTaskInput, id],
  'ai:applyResult': [applyArtifactInput],
  'chapter:updateContent': [id, z.string()],
  'episode:reorder': [stringArray],
  'template:extractVariables': [z.string()],
  'template:run': [objectPayload],
  'writingRoom:run': [objectPayload],
  'videoTask:create': [createVideoTaskInput],
  'videoTask:retry': [id, maybeId],
  'videoResult:selectBest': [id],
  'export:projectMarkdown': [id],
  'export:projectJson': [id],
  'export:chapterMarkdown': [id],
  'export:adaptationMarkdown': [id],
  'export:adaptationJson': [id],
  'export:scriptMarkdown': [id],
  'export:scriptJson': [id],
  'export:scriptsMarkdown': [id],
  'export:scriptsJson': [id],
  'export:shotsMarkdown': [id],
  'export:shotsJson': [id],
  'export:shotsCsv': [id],
  'export:projectPackage': [id],
}

export function schemasForIpcChannel(channel: string): z.ZodType<unknown>[] {
  const exact = IPC_EXACT_SCHEMAS[channel]
  if (exact) return exact

  const [, action = ''] = channel.split(':')
  if (
    action === 'listByProject' ||
    action === 'listByCharacter' ||
    action === 'listByScript' ||
    action === 'listByScene' ||
    action === 'listByEpisode' ||
    action === 'listByShot' ||
    action === 'listByTask' ||
    action === 'listByType' ||
    action === 'listByTemplate'
  ) {
    return [id]
  }
  if (action === 'list' || action === 'getDefault') return []
  if (action === 'get' || action === 'delete' || action === 'remove' || action === 'checkStatus' || action === 'compare') {
    return [id]
  }
  if (action === 'create') return [objectPayload]
  if (action === 'update') return [id, objectPayload]
  if (action === 'setDefault') return [id]

  return [z.unknown()]
}

export function validateIpcArgs(channel: string, args: unknown[]): unknown[] {
  const schemas = schemasForIpcChannel(channel)
  const minArgs = schemas.filter((schema) => !schema.safeParse(undefined).success).length
  if (args.length < minArgs || args.length > schemas.length) {
    throw new Error(`IPC 参数数量错误：${channel} 需要 ${minArgs}-${schemas.length} 个参数，实际 ${args.length} 个`)
  }

  return schemas.slice(0, args.length).map((schema, index) => {
    const parsed = schema.safeParse(args[index])
    if (parsed.success) return parsed.data
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'arg'}: ${i.message}`).join('; ')
    throw new Error(`IPC 参数校验失败：${channel}[${index}] ${detail}`)
  })
}
