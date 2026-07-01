import { z } from 'zod'
import {
  CREATIVE_WORKFLOW_TEMPLATES,
  TASK_GROUPS,
  TASK_TYPE_LABELS,
  TEMPLATE_TYPES,
  VIDEO_PROVIDER_KINDS,
  WRITING_ROOM_TARGET_KINDS,
} from './constants'

const id = z.string().min(1)
const maybeId = z.string().min(1).optional()
const objectPayload = z.object({}).passthrough()
const stringArray = z.array(z.string().min(1))
const looseStringArray = z.array(z.string())
const requiredUnknown = z.custom<unknown>((value) => value !== undefined, { message: 'Required' })

function enumFromValues<T extends string>(values: readonly T[], label: string): z.ZodEnum<[T, ...T[]]> {
  if (values.length === 0) throw new Error(`${label} 枚举不能为空`)
  return z.enum(values as [T, ...T[]])
}

const novelTaskType = enumFromValues(Object.keys(TASK_TYPE_LABELS), 'NovelTaskType')
const taskGroupKey = enumFromValues(TASK_GROUPS.map((group) => group.key), 'TaskGroup')
const templateType = enumFromValues(TEMPLATE_TYPES, 'TemplateType')
const templateScope = z.union([novelTaskType, z.literal('snippet')])
const workflowTemplateKey = enumFromValues(
  CREATIVE_WORKFLOW_TEMPLATES.map((template) => template.key),
  'CreativeWorkflowTemplate',
)
const writingRoomTargetKind = enumFromValues(WRITING_ROOM_TARGET_KINDS, 'WritingRoomTargetKind')
const creativeTargetKind = z.enum(['project', 'chapter', 'adaptation', 'episode', 'script', 'scene', 'shot'])
const revisionTaskPriority = z.enum(['must', 'should', 'could'])
const revisionTaskStatus = z.enum(['open', 'accepted', 'applied', 'dismissed'])
const contentVersionSource = z.enum(['ai_overwrite', 'adopt_preview', 'revision_task', 'manual_checkpoint', 'restore'])
const logLevel = z.enum(['debug', 'info', 'warn', 'error'])

const projectInput = z
  .object({
    title: id,
    shortDramaType: id,
    targetAudience: z.string().optional(),
    targetWordCount: z.number().int().positive().optional(),
    targetEpisodeCount: z.number().int().positive().optional(),
    coreHook: z.string().optional(),
    emotionalCore: z.string().optional(),
    coreSellingPoint: z.string().optional(),
    synopsis: z.string().optional(),
    styleGuide: z.string().optional(),
    visualStyleDirection: z.string().optional(),
  })
  .passthrough()
const projectPatch = projectInput.partial().passthrough()

const chapterInput = z
  .object({
    projectId: id,
    title: id,
    orderIndex: z.number().int().optional(),
    summary: z.string().optional(),
    outline: z.string().optional(),
    content: z.string().optional(),
    mainConflict: z.string().optional(),
    hook: z.string().optional(),
    highlight: z.string().optional(),
    reversal: z.string().optional(),
    cliffhanger: z.string().optional(),
    shortDramaNote: z.string().optional(),
    aiVideoNote: z.string().optional(),
  })
  .passthrough()
const chapterPatch = chapterInput.omit({ projectId: true }).partial().passthrough()

const characterInput = z
  .object({
    projectId: id,
    name: id,
    role: id,
  })
  .passthrough()
const characterPatch = characterInput.omit({ projectId: true }).partial().passthrough()

const outlineInput = z
  .object({
    projectId: id,
    type: z.enum(['book', 'chapter']),
    title: id,
    content: z.string().optional(),
    orderIndex: z.number().int().optional(),
  })
  .passthrough()
const outlinePatch = outlineInput.omit({ projectId: true }).partial().passthrough()

const modelConfigInput = z
  .object({
    id: maybeId,
    name: id,
    provider: id,
    baseUrl: id,
    apiKey: z.string().optional(),
    model: id,
    isDefault: z.boolean().optional(),
  })
  .passthrough()
const modelConfigPatch = modelConfigInput.omit({ id: true }).partial().passthrough()

const videoProviderConfigInput = z
  .object({
    name: id,
    kind: z.enum(VIDEO_PROVIDER_KINDS),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    isDefault: z.boolean().optional(),
    defaultParams: z.string().optional(),
  })
  .passthrough()
const videoProviderConfigPatch = videoProviderConfigInput.partial().passthrough()

const aiTaskInput = objectPayload.extend({
  taskType: novelTaskType,
  projectId: maybeId,
  chapterId: maybeId,
  characterId: maybeId,
  adaptationProjectId: maybeId,
  episodeId: maybeId,
  sceneId: maybeId,
  shotId: maybeId,
  userInstruction: z.string().optional(),
  templateContent: z.string().optional(),
  templateScope: novelTaskType.optional(),
  chatHistory: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
})

const applyArtifactInput = z.object({
  projectId: maybeId,
  taskType: novelTaskType,
  data: requiredUnknown,
  characterId: maybeId,
  adaptationProjectId: maybeId,
}).passthrough()

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

const updateVideoTaskInput = z
  .object({
    status: z.enum(['pending', 'running', 'success', 'failed', 'canceled']).optional(),
    remoteTaskId: z.string().optional(),
    resultVideoUrl: z.string().optional(),
    errorMessage: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough()

const updateVideoResultInput = z
  .object({
    resultVideoUrl: z.string().optional(),
    remoteVideoUrl: z.string().optional(),
    localVideoPath: z.string().optional(),
    coverImageUrl: z.string().optional(),
    remoteCoverImageUrl: z.string().optional(),
    localCoverImagePath: z.string().optional(),
    isBest: z.boolean().optional(),
    note: z.string().optional(),
    rawMeta: z.string().optional(),
    archivedAt: z.string().optional(),
    archiveError: z.string().optional(),
  })
  .passthrough()

const templateInput = z
  .object({
    name: id,
    type: templateType,
    content: z.string().min(1),
    description: z.string().optional(),
    variables: looseStringArray.optional(),
    scope: templateScope.optional(),
    builtIn: z.boolean().optional(),
  })
  .passthrough()
const templatePatch = templateInput.partial().passthrough()

const templateRunInput = z
  .object({
    templateId: id,
    projectId: maybeId,
    variables: z.record(z.string()).optional(),
    userInstruction: z.string().optional(),
  })
  .passthrough()

const agentInput = z
  .object({
    name: id,
    role: id,
    systemPrompt: z.string().min(1),
    outputSchema: z.string().optional(),
    enabled: z.boolean().optional(),
    builtIn: z.boolean().optional(),
  })
  .passthrough()
const agentPatch = agentInput.partial().passthrough()

const writingRoomInput = z
  .object({
    targetKind: writingRoomTargetKind,
    targetId: id,
    projectId: maybeId,
    chapterId: maybeId,
    adaptationProjectId: maybeId,
    episodeId: maybeId,
    sceneId: maybeId,
    shotId: maybeId,
    agentIds: stringArray.optional(),
    userInstruction: z.string().optional(),
  })
  .passthrough()

const genrePresetInput = z
  .object({
    name: id,
    visualStyle: z.string().min(1),
    shotPromptAdvice: z.string().min(1),
    aiVideoRisks: z.string().min(1),
    description: z.string().optional(),
    commonRelationships: looseStringArray.optional(),
    commonHighlights: looseStringArray.optional(),
    commonReversals: looseStringArray.optional(),
    commonOpenings: looseStringArray.optional(),
    commonCliffhangers: looseStringArray.optional(),
    builtIn: z.boolean().optional(),
  })
  .passthrough()
const genrePresetPatch = genrePresetInput.partial().passthrough()

const workflowRunInput = z
  .object({
    templateKey: workflowTemplateKey,
    projectId: maybeId,
    chapterId: maybeId,
    adaptationProjectId: maybeId,
    episodeId: maybeId,
    sceneId: maybeId,
    shotId: maybeId,
    userInstruction: z.string().optional(),
  })
  .passthrough()

const batchTaskRunInput = z
  .object({
    kind: z.enum(['scripts', 'shots']),
    projectId: maybeId,
    adaptationProjectId: id,
    episodeIds: stringArray.optional(),
    sceneIds: stringArray.optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .passthrough()

const revisionTaskInput = z
  .object({
    projectId: maybeId,
    targetKind: creativeTargetKind,
    targetId: maybeId,
    sourceReportId: maybeId,
    title: id,
    description: z.string().min(1),
    priority: revisionTaskPriority.optional(),
    status: revisionTaskStatus.optional(),
    suggestedAction: z.string().min(1),
    expectedBenefit: z.record(z.unknown()).optional(),
    appliedVersionId: maybeId,
  })
  .passthrough()
const revisionTaskPatch = revisionTaskInput.partial().passthrough()

const contentVersionInput = z
  .object({
    projectId: maybeId,
    targetKind: creativeTargetKind,
    targetId: id,
    label: id,
    source: contentVersionSource,
    content: z.string(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough()

const caseStudyInput = z
  .object({
    title: id,
    sourceType: z.string().optional(),
    genre: z.string().optional(),
    summary: z.string().optional(),
    relationshipPatterns: looseStringArray.optional(),
    openingHooks: looseStringArray.optional(),
    highlightBeats: looseStringArray.optional(),
    reversalMechanisms: looseStringArray.optional(),
    cliffhangers: looseStringArray.optional(),
    visualPatterns: looseStringArray.optional(),
    riskTags: looseStringArray.optional(),
    notes: z.string().optional(),
  })
  .passthrough()
const caseStudyPatch = caseStudyInput.partial().passthrough()

export const IPC_EXACT_SCHEMAS: Record<string, z.ZodType<unknown>[]> = {
  'log:renderer': [logLevel, id, id, z.record(z.unknown()).optional()],
  'security:getSecretStorageStatus': [],
  'dataBackup:list': [],
  'dataBackup:create': [],
  'dataBackup:restore': [id],
  'longTask:list': [maybeId],
  'longTask:get': [id],
  'longTask:cancel': [id],
  'longTask:retry': [id],
  'batchTask:run': [batchTaskRunInput],
  'project:list': [],
  'project:create': [projectInput],
  'project:update': [id, projectPatch],
  'chapter:list': [id],
  'chapter:create': [chapterInput],
  'chapter:update': [id, chapterPatch],
  'character:list': [id],
  'character:create': [characterInput],
  'character:update': [id, characterPatch],
  'outline:list': [id, z.enum(['book', 'chapter']).optional()],
  'outline:create': [outlineInput],
  'outline:update': [id, outlinePatch],
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
  'caseStudy:importDocuments': [],
  'evaluation:list': [id],
  'aiRun:list': [id],
  'aiRun:listRecent': [maybeId],
  'aiRun:contextPreview': [id],
  'aiRun:exportDebugContext': [id],
  'aiRun:summarize': [],
  'model:list': [],
  'model:getDefault': [],
  'model:create': [modelConfigInput],
  'model:update': [id, modelConfigPatch],
  'model:setDefault': [id],
  'model:listTaskBindings': [],
  'model:upsertTaskBinding': [taskGroupKey, id],
  'model:deleteTaskBinding': [taskGroupKey],
  'model:testConnection': [modelConfigInput],
  'ai:run': [aiTaskInput],
  'ai:runStream': [aiTaskInput, id],
  'ai:applyResult': [applyArtifactInput],
  'chapter:updateContent': [id, z.string()],
  'episode:reorder': [stringArray],
  'agent:create': [agentInput],
  'agent:update': [id, agentPatch],
  'template:extractVariables': [z.string()],
  'template:create': [templateInput],
  'template:update': [id, templatePatch],
  'template:run': [templateRunInput],
  'writingRoom:run': [writingRoomInput],
  'genrePreset:create': [genrePresetInput],
  'genrePreset:update': [id, genrePresetPatch],
  'workflow:run': [workflowRunInput],
  'revisionTask:create': [revisionTaskInput],
  'revisionTask:update': [id, revisionTaskPatch],
  'revisionTask:apply': [id],
  'contentVersion:create': [contentVersionInput],
  'contentVersion:restore': [id],
  'contentVersion:listByTarget': [id, id],
  'caseStudy:create': [caseStudyInput],
  'caseStudy:update': [id, caseStudyPatch],
  'creative:freshness:list': [maybeId],
  'creative:freshness:listByTarget': [id, maybeId],
  'creative:antiTrope:listByTarget': [id, maybeId],
  'creative:qualityGate:list': [maybeId],
  'creative:audience:list': [maybeId],
  'creative:curve:list': [maybeId],
  'revisionTask:list': [maybeId],
  'revisionTask:listByTarget': [id, maybeId],
  'workflow:list': [maybeId],
  'videoProvider:create': [videoProviderConfigInput],
  'videoProvider:update': [id, videoProviderConfigPatch],
  'videoTask:create': [createVideoTaskInput],
  'videoTask:retry': [id, maybeId],
  'videoTask:update': [id, updateVideoTaskInput],
  'videoResult:selectBest': [id],
  'videoResult:update': [id, updateVideoResultInput],
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

function channelSchemas(channels: string[], schemas: z.ZodType<unknown>[]): Record<string, z.ZodType<unknown>[]> {
  return Object.fromEntries(channels.map((channel) => [channel, schemas]))
}

export const IPC_ALLOWED_FALLBACK_SCHEMAS: Record<string, z.ZodType<unknown>[]> = {
  ...channelSchemas(
    [
      'adaptationProject:list',
      'agent:list',
      'caseStudy:list',
      'genrePreset:list',
      'template:list',
      'templateRun:list',
      'videoProvider:getDefault',
      'videoProvider:list',
      'videoTask:list',
    ],
    [],
  ),
  ...channelSchemas(
    [
      'adaptationProject:get',
      'adaptationProject:delete',
      'adaptationProject:listByProject',
      'agent:get',
      'agent:delete',
      'beat:delete',
      'beat:listByChapter',
      'caseStudy:delete',
      'chapter:get',
      'chapter:delete',
      'chapterMemory:get',
      'chapterMemory:delete',
      'character:delete',
      'characterState:delete',
      'characterState:listByCharacter',
      'dramaTrend:get',
      'dramaTrend:delete',
      'episode:delete',
      'episodeAnalysis:get',
      'episodeAnalysis:delete',
      'feasibility:delete',
      'foreshadowing:delete',
      'genrePreset:get',
      'genrePreset:delete',
      'highlight:delete',
      'model:delete',
      'outline:delete',
      'project:get',
      'project:delete',
      'promptVersion:list',
      'scene:delete',
      'scene:listByScript',
      'script:get',
      'script:getByEpisode',
      'script:delete',
      'scriptReview:get',
      'scriptReview:delete',
      'shot:get',
      'shot:delete',
      'shot:listByEpisode',
      'shot:listByScene',
      'shotReview:get',
      'shotReview:delete',
      'storyEvent:delete',
      'template:get',
      'template:delete',
      'template:listByType',
      'templateRun:listByTemplate',
      'videoProvider:delete',
      'videoProvider:setDefault',
      'videoResult:compare',
      'videoResult:delete',
      'videoResult:listByShot',
      'videoResult:listByTask',
      'videoTask:checkStatus',
      'videoTask:get',
      'videoTask:delete',
      'videoTask:listByEpisode',
      'videoTask:listByShot',
      'visualProfile:delete',
      'visualProfile:getByCharacter',
      'visualSetting:delete',
    ],
    [id],
  ),
  ...channelSchemas(
    [
      'adaptationProject:create',
      'beat:create',
      'chapterMemory:create',
      'characterState:create',
      'episode:create',
      'feasibility:create',
      'foreshadowing:create',
      'highlight:create',
      'script:create',
      'shot:create',
      'storyEvent:create',
      'visualProfile:create',
      'visualSetting:create',
    ],
    [objectPayload],
  ),
  ...channelSchemas(
    [
      'adaptationProject:update',
      'beat:update',
      'chapterMemory:update',
      'episode:update',
      'foreshadowing:update',
      'scene:update',
      'script:update',
      'shot:update',
      'storyEvent:update',
      'visualProfile:update',
      'visualSetting:update',
    ],
    [id, objectPayload],
  ),
  'script:updateContent': [id, z.string()],
}

export function schemasForIpcChannel(channel: string): z.ZodType<unknown>[] {
  const exact = IPC_EXACT_SCHEMAS[channel]
  if (exact) return exact

  const fallback = IPC_ALLOWED_FALLBACK_SCHEMAS[channel]
  if (fallback) return fallback

  throw new Error(`未登记 IPC channel：${channel}`)
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
