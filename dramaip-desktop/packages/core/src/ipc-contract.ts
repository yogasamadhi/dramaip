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
  'dialogue_audio',
  'bgm_audio',
  'sfx_audio',
  'subtitle_file',
  'source_media',
  'rights_evidence',
  'other',
])
const projectAssetStatus = z.enum(['available', 'missing', 'remote_only'])
const projectAssetPackagePolicy = z.enum(['exclude', 'reference_only', 'include_binary'])
const projectAssetSourceKind = z.enum(['project', 'character', 'visual_profile', 'visual_setting', 'episode', 'script', 'scene', 'shot', 'video_result', 'manual'])
const assetRightsStatus = z.enum(['verified', 'declared', 'unknown', 'expired', 'restricted'])
const assetRightsType = z.enum(['ownership', 'license', 'talent_release', 'voice_consent', 'provider_terms', 'public_domain', 'other'])
const assetPermittedUse = z.enum(['commercial', 'adaptation', 'generative', 'voice_cloning'])
const visualAssetOwnerKind = z.enum(['visual_profile', 'visual_setting'])
const visualAssetSlot = z.enum(['face_anchor', 'turnaround', 'expression', 'pose', 'costume', 'prop', 'scene_layout', 'scene_variant', 'style_frame', 'voice_reference'])
const visualAssetVersionStatus = z.enum(['candidate', 'adopted', 'superseded', 'rejected'])
const visualAssetVersionInput = z.object({
  projectId: id,
  ownerKind: visualAssetOwnerKind,
  ownerId: id,
  assetId: id,
  slot: visualAssetSlot,
  label: z.string().min(1).max(200),
  notes: z.string().max(2_000).optional(),
  status: visualAssetVersionStatus.optional(),
}).strict()
const shotVisualAssetLockInput = z.object({
  projectId: id,
  shotId: id,
  visualAssetVersionId: id,
  role: z.string().min(1).max(100),
}).strict()
const shotStillKind = z.enum(['still', 'first_frame', 'last_frame', 'cover'])
const shotStillCandidateInput = z.object({
  projectId: id,
  shotId: id,
  assetId: id,
  kind: shotStillKind,
  label: z.string().min(1).max(200),
  notes: z.string().max(2_000).optional(),
}).strict()
const animaticClipInput = z.object({
  id,
  shotId: id,
  orderIndex: z.number().int().nonnegative(),
  durationSeconds: z.number().positive().max(15),
  stillCandidateId: maybeId,
  assetId: maybeId,
  transition: z.enum(['cut', 'fade', 'push', 'pull']),
  crop: z.object({
    zoom: z.number().min(0.8).max(2),
    x: z.number().min(-50).max(50),
    y: z.number().min(-50).max(50),
  }).strict().optional(),
  dialogue: z.string().max(4_000).optional(),
  narration: z.string().max(4_000).optional(),
  temporaryAudioAssetId: maybeId,
}).strict()
const animaticAnnotationInput = z.object({
  id,
  atSeconds: z.number().nonnegative(),
  shotId: maybeId,
  category: z.enum(['pacing', 'information', 'hook', 'shot']),
  note: z.string().min(1).max(2_000),
  createdAt: z.string().min(1),
}).strict()
const animaticSaveInput = z.object({
  projectId: id,
  adaptationProjectId: id,
  episodeId: id,
  sourceFingerprint: z.string().min(1),
  clips: z.array(animaticClipInput).max(500),
  annotations: z.array(animaticAnnotationInput).max(500),
}).strict()
const animaticReviewInput = z.object({
  status: z.enum(['approved', 'returned']),
  reviewNote: z.string().min(1).max(2_000).optional(),
}).strict()
const voiceProfileInput = z.object({
  projectId: id, characterId: maybeId, label: z.string().min(1).max(200), voiceTone: z.string().max(500).optional(),
  speed: z.number().min(0.5).max(2).optional(), emotion: z.string().max(200).optional(), language: z.string().max(80).optional(),
  pronunciationDictionary: z.record(z.string().max(200)).default({}), sampleAssetId: maybeId, notes: z.string().max(2_000).optional(),
}).strict()
const audioClipInput = z.object({
  id, shotId: maybeId, characterId: maybeId, assetId: maybeId, voiceProfileId: maybeId, text: z.string().max(4_000).optional(),
  startSeconds: z.number().nonnegative(), durationSeconds: z.number().positive().max(3_600).optional(), volume: z.number().min(0).max(2).default(1),
  fadeInSeconds: z.number().nonnegative().max(60).default(0), fadeOutSeconds: z.number().nonnegative().max(60).default(0), loop: z.boolean().default(false), duckingIntent: z.boolean().default(false),
}).strict()
const audioTrackSaveInput = z.object({
  projectId: id, adaptationProjectId: id, episodeId: id, kind: z.enum(['dialogue', 'narration', 'bgm', 'sfx']), label: z.string().min(1).max(200), sourceFingerprint: z.string().min(1), clips: z.array(audioClipInput).max(1_000),
}).strict()
const revisionTaskPriority = z.enum(['must', 'should', 'could'])
const revisionTaskStatus = z.enum(['open', 'accepted', 'preview_ready', 'applied', 'undone', 'dismissed'])
const contentVersionSource = z.enum(['ai_overwrite', 'adopt_preview', 'revision_task', 'manual_checkpoint', 'restore'])
const storyBibleSettingsPatch = z.object({ autoSuggest: z.boolean() }).strict()
const storyBibleQueueInput = z.object({ projectId: id, chapterId: id }).strict()
const storyBibleChangeSetStatus = z.enum(['paused', 'queued', 'skipped', 'discarded'])
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
    // 反馈评论可能含有仅限本机保存的原文，必须由用户单独确认才写入项目包。
    includeFeedback: z.boolean().optional(),
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
const assetRightsInput = z.object({
  projectId: id,
  assetId: id,
  rightsholder: z.string().max(300).optional(),
  source: z.string().max(1_000).optional(),
  rightsTypes: z.array(assetRightsType).max(12).optional(),
  permittedUses: z.array(assetPermittedUse).max(8).optional(),
  platforms: looseStringArray.optional(),
  regions: looseStringArray.optional(),
  validFrom: z.string().max(40).optional(),
  validUntil: z.string().max(40).optional(),
  evidenceAssetId: maybeId,
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  aiGenerated: z.boolean().optional(),
  status: assetRightsStatus.optional(),
  reviewedAt: z.string().max(40).optional(),
  reviewNote: z.string().max(2_000).optional(),
}).strict()
const assetRightsPatch = assetRightsInput.partial().strict()
const rightsPreflightInput = z.object({ projectId: id, platform: z.string().max(100).optional(), region: z.string().max(100).optional(), deliveryAt: z.string().max(40).optional() }).strict()

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
  partialAdopt: z.boolean().optional(),
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

const updateGenerationCostInput = z
  .object({
    actualCost: z.number().nonnegative().optional(),
    currency: z.string().min(1).max(12).optional(),
    actualCostNote: z.string().max(500).optional(),
  })
  .strict()

const episodeRenderInput = z
  .object({
    projectId: id,
    adaptationProjectId: id,
    episodeId: id,
    mutedTrackIds: stringArray.optional(),
  })
  .strict()

const episodeQualityListInput = z
  .object({
    projectId: id,
    adaptationProjectId: id,
    episodeId: id,
  })
  .strict()

const episodeQualityInput = episodeQualityListInput.extend({ renderTaskId: id }).strict()

const episodeMinimalRedoInput = episodeQualityListInput.extend({ qualityTaskId: id }).strict()

const episodeComplianceListInput = z
  .object({ projectId: id, adaptationProjectId: id, episodeId: id })
  .strict()

const episodeComplianceInput = episodeComplianceListInput.extend({
  renderTaskId: id,
  qualityTaskId: id,
  profileId: id,
  title: z.string().max(300),
  subtitleLanguage: z.string().max(64),
  targetPlatform: z.string().max(120).optional(),
  targetRegion: z.string().max(120).optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aigcDeclared: z.boolean(),
  manualContentReviewConfirmed: z.boolean(),
}).strict()

const platformDeliveryVariantInput = episodeComplianceListInput.pick({ projectId: true, adaptationProjectId: true }).extend({
  label: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(2000),
  tags: stringArray,
  coverAssetId: id.optional(),
  source: z.enum(['manual', 'ai_draft']),
}).strict()

const platformDeliveryScopedIdInput = episodeComplianceListInput.pick({ projectId: true, adaptationProjectId: true }).extend({ id }).strict()

const platformDeliveryExportInput = episodeComplianceListInput.extend({
  profileId: id,
  creativeVariantId: id,
  complianceTaskId: id,
  manualFieldsConfirmed: z.boolean(),
}).strict()

const feedbackPreviewTextInput = z.object({ kind: z.enum(['metrics', 'comments']), sourceName: z.string().min(1).max(240), content: z.string().max(10_000_000), platform: z.string().max(120).optional(), sourceVersion: z.string().max(120).optional() }).strict()
const feedbackCommitInput = z.object({ projectId: id, token: id, privacy: z.enum(['local_only', 'redacted']) }).strict()
const feedbackBatchInput = z.object({ projectId: id, batchId: id }).strict()
const feedbackRevisionInput = feedbackBatchInput.extend({ clusterId: id.optional(), title: z.string().max(240).optional(), suggestedAction: z.string().max(2000).optional() }).strict()

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
const qualityIssueAcknowledgementInput = z
  .object({
    projectId: id,
    adaptationProjectId: maybeId,
    issueId: id,
    issueKind: z.string().min(1).max(80),
    issueTitle: z.string().min(1).max(240),
    issueDetail: z.string().max(2400).optional(),
    disposition: z.enum(['accepted', 'ignored']),
    note: z.string().max(1200).optional(),
  })
  .strict()
const textDiffPreviewInput = z
  .object({
    targetKind: z.enum(['chapter', 'script', 'shot']),
    targetId: maybeId,
    taskType: novelTaskType,
    currentContent: z.string(),
    nextContent: z.string(),
    projectId: maybeId,
    adaptationProjectId: maybeId,
    episodeId: maybeId,
    sceneId: maybeId,
    shotId: maybeId,
    title: z.string().optional(),
    note: z.string().optional(),
    script: z.record(z.unknown()).optional(),
    shotPatch: z.record(z.string()).optional(),
  })
  .passthrough()

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

const sourceImportSceneInput = z
  .object({
    key: z.string().min(1).optional(),
    title: z.string().min(1),
    location: z.string().min(1),
    timeOfDay: z.string().optional(),
    visualDescription: z.string().optional(),
    characters: looseStringArray.optional(),
    summary: z.string().optional(),
    content: z.string().optional(),
    orderIndex: z.number().int().nonnegative().optional(),
    dialogueCount: z.number().int().nonnegative().optional(),
    actionCount: z.number().int().nonnegative().optional(),
  })
  .strict()
const sourceImportEpisodeInput = z
  .object({
    key: z.string().min(1).optional(),
    episodeNumber: z.number().int().positive(),
    title: z.string().min(1),
    content: z.string().max(1_500_000),
    scenes: z.array(sourceImportSceneInput).max(2_000),
  })
  .strict()
const sourceImportChapterInput = z
  .object({
    key: z.string().min(1).optional(),
    title: z.string().min(1),
    content: z.string().max(1_500_000),
    orderIndex: z.number().int().nonnegative().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    warning: z.string().optional(),
  })
  .strict()
const sourceImportPreviewInput = z
  .object({
    fileName: z.string().min(1),
    sourceType: z.enum(['txt', 'markdown', 'docx', 'epub', 'script-json', 'draft']),
    contentKind: z.enum(['novel', 'script', 'draft']),
    title: z.string().min(1),
    charCount: z.number().int().nonnegative(),
    chapters: z.array(sourceImportChapterInput).max(2_000),
    episodes: z.array(sourceImportEpisodeInput).max(1_000),
    warnings: looseStringArray,
  })
  .strict()
const sourceImportCommitInput = z
  .object({
    importId: id,
    projectId: id,
    strategy: z.enum(['append', 'merge', 'replace']),
    rightsConfirmed: z.literal(true),
    destructiveConfirmed: z.boolean().optional(),
    preview: sourceImportPreviewInput,
  })
  .strict()

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
  'generation:listLineagesByProject': [id],
  'generation:listCostsByProject': [id],
  'generation:updateCost': [id, updateGenerationCostInput],
  'asset:delete': [id],
  'asset:chooseLocalFile': [z.enum(['character_reference', 'casting_reference', 'voice_reference', 'scene_reference', 'style_reference', 'first_frame_image', 'cover_image', 'narration_audio', 'dialogue_audio', 'bgm_audio', 'sfx_audio', 'subtitle_file', 'rights_evidence'])],
  'rights:listByProject': [id],
  'rights:create': [assetRightsInput],
  'rights:update': [id, assetRightsPatch],
  'rights:preflight': [rightsPreflightInput],
  'visualAsset:listByProject': [id],
  'visualAsset:listByOwner': [visualAssetOwnerKind, id],
  'visualAsset:create': [visualAssetVersionInput],
  'visualAsset:adopt': [id],
  'visualAsset:listLocksByShot': [id],
  'visualAsset:lockShot': [shotVisualAssetLockInput],
  'shotStill:listByShot': [id],
  'shotStill:create': [shotStillCandidateInput],
  'shotStill:adopt': [id],
  'animatic:listByEpisode': [id],
  'animatic:initialize': [id, id],
  'animatic:save': [animaticSaveInput],
  'animatic:review': [id, animaticReviewInput],
  'audio:listVoiceProfiles': [id],
  'audio:createVoiceProfile': [voiceProfileInput],
  'audio:adoptVoiceProfile': [id],
  'audio:listTracksByEpisode': [id],
  'audio:saveTrack': [audioTrackSaveInput],
  'audio:adoptTrack': [id],
  'episodeRender:listByEpisode': [episodeRenderInput],
  'episodeRender:preflight': [episodeRenderInput],
  'episodeRender:start': [episodeRenderInput],
  'episodeQuality:listByEpisode': [episodeQualityListInput],
  'episodeQuality:start': [episodeQualityInput],
  'episodeQuality:createMinimalRedoPlan': [episodeMinimalRedoInput],
  'compliance:listProfiles': [],
  'compliance:activateProfile': [id],
  'episodeCompliance:listByEpisode': [episodeComplianceListInput],
  'episodeCompliance:preflight': [episodeComplianceInput],
  'episodeCompliance:start': [episodeComplianceInput],
  'platformDelivery:listProfiles': [],
  'platformDelivery:listVariants': [episodeComplianceListInput.pick({ projectId: true, adaptationProjectId: true }).strict()],
  'platformDelivery:createVariant': [platformDeliveryVariantInput],
  'platformDelivery:adoptVariant': [platformDeliveryScopedIdInput],
  'platformDelivery:listExports': [episodeComplianceListInput],
  'platformDelivery:preflight': [platformDeliveryExportInput],
  'platformDelivery:export': [platformDeliveryExportInput],
  'platformDelivery:openExportDirectory': [platformDeliveryScopedIdInput],
  'feedback:chooseAndPreview': [z.enum(['metrics', 'comments'])],
  'feedback:previewText': [feedbackPreviewTextInput],
  'feedback:commitPreview': [feedbackCommitInput],
  'feedback:listBatches': [id],
  'feedback:listMetrics': [id],
  'feedback:listComments': [id],
  'feedback:listClusters': [id],
  'feedback:clusterBatch': [feedbackBatchInput],
  'feedback:deleteClusters': [feedbackBatchInput],
  'feedback:deleteBatch': [feedbackBatchInput],
  'feedback:createRevisionTask': [feedbackRevisionInput],
  'security:getSecretStorageStatus': [],
  // Cloud auth accepts no renderer-supplied redirect, credential, or URL.
  // The Electron main process owns the PKCE session and Keychain boundary.
  'cloudAuth:status': [],
  'cloudAuth:login': [],
  'cloudAuth:logout': [],
  'cloudAuth:context': [],
  // Cloud model discovery is renderer-safe; all token-bearing AI calls remain
  // inside Electron main and are never exposed as an IPC operation.
  'cloudAI:models': [],
  // Explicit handoff only: Electron main owns the cloud session and writes a
  // local inspiration favorite after a user picks a draft/project.
  'cloudHandoff:list': [],
  'cloudHandoff:adopt': [z.object({ projectId: id, draftId: id })],
  'cloudSnapshot:list': [],
  'cloudSnapshot:create': [z.object({ projectId: id }).strict()],
  'cloudSnapshot:restore': [z.object({ snapshotId: id, recoveryKey: z.string().min(1).max(256).optional() }).strict()],
  'cloudSnapshot:delete': [z.object({ snapshotId: id }).strict()],
  'dataBackup:list': [],
  'dataBackup:create': [],
  'dataBackup:restore': [id],
  'longTask:list': [maybeId],
  'longTask:get': [id],
  'longTask:cancel': [id],
  'longTask:retry': [id],
  'batchTask:run': [batchTaskRunInput],
  'project:list': [],
  'project:listHomeSummaries': [],
  'project:listTrash': [],
  'project:create': [projectInput],
  'project:update': [id, projectPatch],
  'project:resolveActiveAdaptation': [id, maybeId],
  'project:setActiveAdaptation': [id, maybeId],
  'project:trash': [id],
  'project:restore': [id],
  'project:deletionPreview': [id],
  'project:purge': [id, id],
  'chapter:list': [id],
  'chapter:create': [chapterInput],
  'chapter:update': [id, chapterPatch],
  'chapter:reorder': [id, stringArray],
  'shot:reorder': [id, stringArray],
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
  'storyBible:settings:get': [id],
  'storyBible:settings:update': [id, storyBibleSettingsPatch],
  'storyBible:changeSet:list': [id],
  'storyBible:changeSet:queue': [storyBibleQueueInput],
  'storyBible:changeSet:apply': [id],
  'storyBible:changeSet:undo': [id],
  'storyBible:changeSet:fail': [id, z.string().min(1)],
  'storyBible:changeSet:setStatus': [id, storyBibleChangeSetStatus],
  'storyBible:stale:list': [id],
  'beat:list': [id],
  'highlight:list': [id],
  'feasibility:list': [id],
  'episode:list': [id],
  'script:list': [id],
  'project:importPackage': [],
  'sourceImport:choose': [id],
  'sourceImport:commit': [sourceImportCommitInput],
  'sourceImport:discard': [id],
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
  // 结构与来源校验由 core 的 validateGenreMarketSnapshot 在主进程落库前执行；
  // 此处只负责把通道纳入统一 IPC 白名单与参数数量校验。
  'genreMarketSnapshot:import': [objectPayload],
  'genreMarketSnapshot:activate': [id],
  'workflow:run': [workflowRunInput],
  'workflow:resume': [workflowResumeInput],
  'workflow:retryStep': [workflowRetryStepInput],
  'revisionTask:create': [revisionTaskInput],
  'revisionTask:update': [id, revisionTaskPatch],
  'revisionTask:preview': [id],
  'revisionTask:updatePreview': [id, textDiffPreviewInput],
  'revisionTask:adopt': [id],
  'revisionTask:undo': [id],
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
  'creative:qualityIssue:list': [id],
  'creative:qualityIssue:acknowledge': [qualityIssueAcknowledgementInput],
  'creative:audience:list': [maybeId],
  'creative:curve:list': [maybeId],
  'revisionTask:list': [maybeId],
  'revisionTask:listByTarget': [id, maybeId],
  'workflow:list': [maybeId],
  'videoProvider:create': [videoProviderConfigInput],
  'videoProvider:update': [id, videoProviderConfigPatch],
  'videoTask:create': [createVideoTaskInput],
  'videoTask:retry': [id, maybeId],
  'videoTask:cancel': [id],
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
      'genreMarketSnapshot:list',
      'genreMarketSnapshot:getActive',
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
      'videoTask:cancel',
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
