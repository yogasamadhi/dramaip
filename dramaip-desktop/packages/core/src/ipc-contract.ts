import { z } from 'zod'
import {
  CREATIVE_WORKFLOW_TEMPLATES,
  PROJECT_SKILL_CATEGORIES,
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
const projectAssetKind = z.enum([
  'character_reference',
  'casting_reference',
  'voice_reference',
  'scene_reference',
  'style_reference',
  'video_result',
  'cover_image',
  'first_frame_image',
  'narration_audio',
  'subtitle_file',
  'source_media',
  'other',
])
const projectAssetStatus = z.enum(['available', 'missing', 'remote_only'])
const projectAssetPackagePolicy = z.enum(['exclude', 'reference_only', 'include_binary'])
const projectAssetSourceKind = z.enum(['project', 'character', 'visual_profile', 'visual_setting', 'episode', 'script', 'scene', 'shot', 'video_result', 'manual'])
const revisionTaskPriority = z.enum(['must', 'should', 'could'])
const revisionTaskStatus = z.enum(['open', 'accepted', 'applied', 'dismissed'])
const contentVersionSource = z.enum(['ai_overwrite', 'adopt_preview', 'revision_task', 'manual_checkpoint', 'restore'])
const logLevel = z.enum(['debug', 'info', 'warn', 'error'])
const diagnosticExportOptions = z
  .object({
    includeContent: z.boolean().optional(),
  })
  .strict()
  .optional()
const projectPackageExportOptions = z
  .object({
    includeAssets: z.boolean().optional(),
  })
  .strict()
  .optional()
const novelSubmissionExportOptions = z
  .object({
    chapterLimit: z.number().int().positive().max(100).optional(),
  })
  .strict()
  .optional()
const dramaDeliveryExportOptions = z
  .object({
    episodeLimit: z.number().int().positive().max(100).optional(),
  })
  .strict()
  .optional()
const projectAssetInput = z
  .object({
    projectId: id,
    kind: projectAssetKind,
    title: id,
    description: z.string().optional(),
    sourceEntityKind: projectAssetSourceKind.optional(),
    sourceEntityId: maybeId,
    localPath: z.string().optional(),
    relativePath: z.string().optional(),
    remoteUrl: z.string().optional(),
    mimeType: z.string().optional(),
    originalName: z.string().optional(),
    sha256: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationSeconds: z.number().nonnegative().optional(),
    tags: looseStringArray.optional(),
    metadata: z.record(z.unknown()).optional(),
    status: projectAssetStatus.optional(),
    packagePolicy: projectAssetPackagePolicy.optional(),
  })
  .strict()
const projectAssetPatch = projectAssetInput.partial().strict()

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

const storyArcKind = z.enum(['volume', 'unit', 'stage'])
const storyArcInput = z
  .object({
    projectId: id,
    parentId: maybeId,
    kind: storyArcKind,
    title: id,
    summary: z.string().optional(),
    targetWordCount: z.number().int().positive().optional(),
    targetChapterCount: z.number().int().positive().optional(),
    chapterStart: z.number().int().positive().optional(),
    chapterEnd: z.number().int().positive().optional(),
    coreConflict: z.string().optional(),
    keyHighlights: z.array(z.string()).optional(),
    foreshadowingPayoffs: z.array(z.string()).optional(),
    orderIndex: z.number().int().optional(),
  })
  .passthrough()
const storyArcPatch = storyArcInput.omit({ projectId: true }).partial().passthrough()

const projectSkillCategory = enumFromValues(PROJECT_SKILL_CATEGORIES, 'ProjectSkillCategory')
const projectSkillInput = z
  .object({
    projectId: id,
    name: id,
    category: projectSkillCategory,
    description: z.string().optional(),
    taskTypes: z.array(novelTaskType).optional(),
    content: z.string().min(1),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough()
const projectSkillPatch = projectSkillInput.omit({ projectId: true }).partial().passthrough()

const projectAgentSchemeInput = z
  .object({
    projectId: id,
    name: id,
    description: z.string().optional(),
    primaryAgentId: maybeId,
    agentIds: stringArray.optional(),
    skillIds: stringArray.optional(),
    modelBindings: z.record(taskGroupKey, id).optional(),
    active: z.boolean().optional(),
  })
  .passthrough()
const projectAgentSchemePatch = projectAgentSchemeInput.omit({ projectId: true }).partial().passthrough()

const inspirationCardKind = z.enum(['opening', 'relationship', 'conflict', 'reversal', 'cliffhanger', 'visual'])
const inspirationCardSourceKind = z.enum(['genre_preset', 'case_study', 'template', 'anti_trope', 'mobile_import'])
const inspirationFavoriteInput = z
  .object({
    projectId: id,
    cardKey: id,
    sourceKind: inspirationCardSourceKind,
    sourceId: maybeId,
    kind: inspirationCardKind,
    title: id,
    pattern: z.string(),
    applyTo: z.string(),
    risk: z.string().optional(),
  })
  .passthrough()
const mobileInspirationImportInput = z
  .object({
    projectId: id,
    content: z.string().min(1).max(300_000),
    fileName: z.string().min(1).max(240).optional(),
  })
  .strict()

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
const aiBudgetSettingsPatch = z
  .object({
    singleRunTokenLimit: z.number().int().positive().optional().nullable(),
    dailyTokenLimit: z.number().int().positive().optional().nullable(),
    singleRunCostLimit: z.number().positive().optional().nullable(),
    dailyCostLimit: z.number().positive().optional().nullable(),
    costPer1kTokens: z.number().min(0).optional(),
    currency: z.string().min(1).max(12).optional(),
  })
  .passthrough()

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
    pauseAfterStep: z.boolean().optional(),
  })
  .passthrough()
const workflowResumeInput = z
  .object({
    runId: id,
    pauseAfterStep: z.boolean().optional(),
  })
  .strict()
const workflowRetryStepInput = z
  .object({
    runId: id,
    stepKey: id,
    pauseAfterStep: z.boolean().optional(),
  })
  .strict()

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

const creativeCaseCard = z
  .object({
    kind: z.enum(['hook', 'highlight', 'relationship', 'reversal', 'cliffhanger', 'visual', 'rhythm']),
    title: z.string().min(1),
    pattern: z.string().min(1),
    applyTo: z.string().min(1),
    risk: z.string().optional(),
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
    rhythmCurve: z.array(z.number().min(0).max(10)).optional(),
    creativeCards: z.array(creativeCaseCard).optional(),
    riskTags: looseStringArray.optional(),
    notes: z.string().optional(),
  })
  .passthrough()
const caseStudyPatch = caseStudyInput.partial().passthrough()
const caseStudyChapterStatus = z.enum(['parsed', 'needs_review', 'manual'])
const caseStudyImportChapterInput = z
  .object({
    orderIndex: z.number().int().nonnegative().optional(),
    title: z.string().min(1),
    content: z.string().optional(),
    textPreview: z.string().optional(),
    charCount: z.number().int().nonnegative().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    status: caseStudyChapterStatus.optional(),
    warning: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough()
const caseStudyDocumentInput = z
  .object({
    title: z.string().min(1),
    fileName: z.string().min(1),
    sourceType: z.string().optional(),
    truncated: z.boolean().optional(),
    parseWarnings: looseStringArray.optional(),
    chapters: z.array(caseStudyImportChapterInput),
  })
  .passthrough()
const caseStudyDocumentChapterPatch = z
  .object({
    title: z.string().min(1).optional(),
    textPreview: z.string().optional(),
    charCount: z.number().int().nonnegative().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    status: caseStudyChapterStatus.optional(),
    notes: z.string().optional(),
  })
  .passthrough()

const globalSearchInput = z
  .object({
    query: z.string().max(120),
    limit: z.number().int().positive().max(20).optional(),
  })
  .passthrough()

export const IPC_EXACT_SCHEMAS: Record<string, z.ZodType<unknown>[]> = {
  'log:renderer': [logLevel, id, id, z.record(z.unknown()).optional()],
  'search:global': [globalSearchInput],
  'diagnostic:exportPackage': [diagnosticExportOptions],
  'asset:create': [projectAssetInput],
  'asset:update': [id, projectAssetPatch],
  'asset:listByProject': [id],
  'asset:listBySource': [projectAssetSourceKind, id],
  'asset:delete': [id],
  'security:getSecretStorageStatus': [],
  // Cloud auth accepts no renderer-supplied redirect, credential, or URL.
  // The Electron main process owns the PKCE session and Keychain boundary.
  'cloudAuth:status': [],
  'cloudAuth:login': [],
  'cloudAuth:logout': [],
  'cloudAuth:context': [],
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
  'storyArc:list': [id, storyArcKind.optional()],
  'storyArc:create': [storyArcInput],
  'storyArc:update': [id, storyArcPatch],
  'projectSkill:list': [id],
  'projectSkill:create': [projectSkillInput],
  'projectSkill:update': [id, projectSkillPatch],
  'projectSkill:delete': [id],
  'projectAgentScheme:list': [id],
  'projectAgentScheme:getActive': [id],
  'projectAgentScheme:create': [projectAgentSchemeInput],
  'projectAgentScheme:update': [id, projectAgentSchemePatch],
  'projectAgentScheme:setActive': [id],
  'projectAgentScheme:delete': [id],
  'inspirationFavorite:list': [id],
  'inspirationFavorite:upsert': [inspirationFavoriteInput],
  'inspirationFavorite:importMobile': [mobileInspirationImportInput],
  'inspirationFavorite:delete': [id],
  'inspirationFavorite:deleteByCardKey': [id, id],
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
  'aiRun:summarizeUsage': [],
  'model:list': [],
  'model:getDefault': [],
  'model:create': [modelConfigInput],
  'model:update': [id, modelConfigPatch],
  'model:setDefault': [id],
  'model:listTaskBindings': [],
  'model:upsertTaskBinding': [taskGroupKey, id],
  'model:deleteTaskBinding': [taskGroupKey],
  'model:getBudgetSettings': [],
  'model:updateBudgetSettings': [aiBudgetSettingsPatch],
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
  'workflow:resume': [workflowResumeInput],
  'workflow:retryStep': [workflowRetryStepInput],
  'revisionTask:create': [revisionTaskInput],
  'revisionTask:update': [id, revisionTaskPatch],
  'revisionTask:preview': [id],
  'revisionTask:complete': [id],
  'revisionTask:apply': [id],
  'contentVersion:create': [contentVersionInput],
  'contentVersion:restore': [id],
  'contentVersion:listByTarget': [id, id],
  'caseStudy:create': [caseStudyInput],
  'caseStudy:update': [id, caseStudyPatch],
  'caseStudy:createDocument': [caseStudyDocumentInput],
  'caseStudy:updateDocumentChapter': [id, caseStudyDocumentChapterPatch],
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
  'export:novelSubmissionMarkdown': [id, novelSubmissionExportOptions],
  'export:novelSubmissionJson': [id, novelSubmissionExportOptions],
  'export:dramaProposalMarkdown': [id, dramaDeliveryExportOptions],
  'export:dramaProposalJson': [id, dramaDeliveryExportOptions],
  'export:dramaEpisodeDeliveryMarkdown': [id, dramaDeliveryExportOptions],
  'export:dramaEpisodeDeliveryJson': [id, dramaDeliveryExportOptions],
  'export:dramaShotDeliveryMarkdown': [id, dramaDeliveryExportOptions],
  'export:dramaShotDeliveryJson': [id, dramaDeliveryExportOptions],
  'export:dramaShotDeliveryCsv': [id, dramaDeliveryExportOptions],
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
  'export:projectPackage': [id, projectPackageExportOptions],
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
      'caseStudy:listDocuments',
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
      'caseStudy:deleteDocument',
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
      'projectSkill:delete',
      'promptVersion:list',
      'scene:delete',
      'scene:listByScript',
      'storyArc:delete',
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
