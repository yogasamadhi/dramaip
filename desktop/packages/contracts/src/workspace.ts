import { z } from "zod";
import { AuthorIntentCreationProvenanceSchema } from "./author-intent-creation.js";
export * from "./author-intent-creation.js";
import { defineServiceContract } from "./service-contract.js";
import { ProjectGoalConfirmationInputSchema } from "./creative-goals.js";
export { ProjectGoalConfirmationInputSchema } from "./creative-goals.js";
export type { ProjectGoalConfirmationInput } from "./creative-goals.js";

const optionalText = z.string().optional();

/**
 * A project has one durable creative intent.  It is deliberately not a UI
 * preference: changing it would leave writing, production and media records
 * with ambiguous ownership, so a different intent is created as a derivation.
 */
export const ProjectModeSchema = z.enum([
  "series_longform",
  "single_season",
  "personal_theater",
  "creator_channel",
]);
export type ProjectMode = z.infer<typeof ProjectModeSchema>;

export const SeriesLongformModeConfigSchema = z.object({
  mode: z.literal("series_longform"),
  targetChapterCount: z.number().int().positive().optional(),
  targetSeasonCount: z.number().int().positive().optional(),
  targetEpisodesPerSeason: z.number().int().positive().optional(),
});
export const SingleSeasonModeConfigSchema = z.object({
  mode: z.literal("single_season"),
  entryPath: z.enum(["novel", "source-import", "script", "inspiration"]),
  targetEpisodeCount: z.number().int().positive().optional(),
});
export const PersonalTheaterModeConfigSchema = z.object({
  mode: z.literal("personal_theater"),
  storyMethod: z.enum(["template", "freeform"]),
  episodeCount: z.number().int().positive().optional(),
  episodeDurationMinutes: z.number().positive().optional(),
});
export const CreatorChannelModeConfigSchema = z.object({
  mode: z.literal("creator_channel"),
  topic: z.string().trim().min(1).max(160),
  positioning: z.string().trim().max(1_000).optional(),
  audience: z.string().trim().max(500).optional(),
  platforms: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  riskDomain: z.enum(["general", "finance", "health", "legal"]).optional(),
});

export const ProjectModeConfigSchema = z.discriminatedUnion("mode", [
  SeriesLongformModeConfigSchema,
  SingleSeasonModeConfigSchema,
  PersonalTheaterModeConfigSchema,
  CreatorChannelModeConfigSchema,
]);
export type ProjectModeConfig = z.infer<typeof ProjectModeConfigSchema>;

export const ProjectLifecycleStatusSchema = z.enum([
  "initializing",
  "ready",
  "failed",
]);
export type ProjectLifecycleStatus = z.infer<
  typeof ProjectLifecycleStatusSchema
>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  /** Compatibility metadata for projects created before the four-mode model. */
  shortDramaType: z.string().min(1).max(160).optional(),
  mode: ProjectModeSchema,
  modeConfig: ProjectModeConfigSchema,
  lifecycleStatus: ProjectLifecycleStatusSchema,
  derivedFromProjectId: z.string().uuid().optional(),
  targetAudience: optionalText,
  targetWordCount: z.number().int().optional(),
  targetEpisodeCount: z.number().int().optional(),
  coreHook: optionalText,
  emotionalCore: optionalText,
  coreSellingPoint: optionalText,
  synopsis: z.string(),
  styleGuide: optionalText,
  visualStyleDirection: optionalText,
  genreOpportunity: optionalText,
  productionBrief: optionalText,
  seriesId: z.string().uuid().optional(),
  seriesTitle: optionalText,
  currentAdaptationId: z.string().uuid().optional(),
  deletedAt: z.string().datetime().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProjectInputSchema = ProjectSchema.pick({
  title: true,
  shortDramaType: true,
  targetAudience: true,
  targetWordCount: true,
  targetEpisodeCount: true,
  coreHook: true,
  emotionalCore: true,
  coreSellingPoint: true,
  synopsis: true,
  styleGuide: true,
  visualStyleDirection: true,
  genreOpportunity: true,
  productionBrief: true,
}).extend({
  /** Missing mode is accepted only for pre-v2 clients and migrates to series. */
  mode: ProjectModeSchema.optional().default("series_longform"),
  modeConfig: ProjectModeConfigSchema.optional(),
  synopsis: z.string().optional(),
  goalConfirmation: ProjectGoalConfirmationInputSchema.optional(),
});

export const ProjectInitializationStepSchema = z.object({
  key: z.string().min(1).max(120),
  pluginId: z.string().min(1).max(80),
  status: z.enum(["pending", "running", "ready", "failed"]),
  message: z.string().optional(),
  error: z.string().optional(),
  attempts: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const ProjectInitializationSchema = z.object({
  projectId: z.string().uuid(),
  status: ProjectLifecycleStatusSchema,
  steps: z.array(ProjectInitializationStepSchema),
  updatedAt: z.string().datetime(),
});
export type ProjectInitialization = z.infer<typeof ProjectInitializationSchema>;

export const ProjectCreationResultSchema = z.object({
  project: ProjectSchema,
  initialization: ProjectInitializationSchema,
});

export const ProjectDerivationInputSchema = z.object({
  targetMode: ProjectModeSchema,
  title: z.string().trim().min(1).max(160).optional(),
  seasonId: z.string().uuid().optional(),
  targetModeConfig: ProjectModeConfigSchema.optional(),
});
export type ProjectDerivationInput = z.infer<
  typeof ProjectDerivationInputSchema
>;

export const ProjectDerivationPreviewSchema = z.object({
  id: z.string().uuid(),
  sourceProjectId: z.string().uuid(),
  targetMode: ProjectModeSchema,
  targetModeConfig: ProjectModeConfigSchema,
  title: z.string().min(1).max(160),
  supported: z.boolean(),
  reason: z.string().optional(),
  expiresAt: z.string().datetime(),
});

export const ProjectDerivationCommitInputSchema = z.object({
  previewId: z.string().uuid(),
});

export const ProjectDerivationCommitResultSchema = z.object({
  project: ProjectSchema,
  initialization: ProjectInitializationSchema,
  derivationId: z.string().uuid(),
});

export const ProjectPatchSchema = ProjectInputSchema.partial()
  .extend({
    version: z.number().int().nonnegative(),
  })
  .omit({ mode: true, modeConfig: true, goalConfirmation: true });

export const ProjectPurgeSchema = z.object({ confirmationTitle: z.string() });

export const SeriesSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  description: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SeriesInputSchema = SeriesSchema.pick({
  title: true,
  description: true,
}).extend({ description: z.string().optional() });

export const ProjectSeriesInputSchema = z.object({
  seriesId: z.string().uuid().optional(),
});

export const SeriesStoryBibleSchema = z.object({
  id: z.string().uuid(),
  seriesId: z.string().uuid(),
  title: z.string(),
  payload: z.unknown(),
  version: z.number().int().nonnegative(),
  overridden: z.boolean(),
  sourceVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SeriesStoryBibleInputSchema = z.object({
  title: z.string().min(1),
  payload: z.unknown(),
});

export const SeriesStoryBibleOverrideInputSchema =
  SeriesStoryBibleInputSchema.extend({
    sourceVersion: z.number().int().nonnegative(),
  });

export const SeriesStoryBibleUpgradeInputSchema = z.object({
  sourceVersion: z.number().int().nonnegative(),
});

export const SeriesAssetTransferInputSchema = z.object({
  sourceAssetId: z.string().uuid(),
  sourceVersion: z.number().int().nonnegative(),
  mode: z.enum(["copy", "fork", "link"]),
});

export const SeriesAssetLinkSchema = z.object({
  id: z.string().uuid(),
  seriesId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  sourceVersion: z.number().int().nonnegative(),
  targetProjectId: z.string().uuid(),
  targetAssetId: z.string().uuid(),
  mode: z.enum(["copy", "fork", "link"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;
export type Series = z.infer<typeof SeriesSchema>;

export const WORKSPACE_PROJECT_SERVICE =
  defineServiceContract<WorkspaceProjectService>({
    id: "workspace.projects.v1",
    owner: "workspace",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });

export interface WorkspaceProjectService {
  create(input: ProjectInput): Project;
  createIdempotent(input: ProjectInput, idempotencyKey: string): Project;
  get(id: string, options?: { includeDeleted?: boolean }): Project | undefined;
  list(options?: { includeDeleted?: boolean }): readonly Project[];
  update(id: string, patch: ProjectPatch): Project | "conflict" | undefined;
  setCurrentAdaptation(
    projectId: string,
    adaptationId: string,
  ): Project | undefined;
}

const intentText = z.string().trim().min(1).max(4_000);
const intentConstraints = z.array(z.string().trim().min(1).max(1_000)).max(100);
export const AuthorIntentContentSchema = z.object({
  themeStatement: intentText,
  emotionalPromise: intentText,
  targetAudience: intentText,
  mustKeep: intentConstraints,
  mayChange: intentConstraints,
  mustAvoid: intentConstraints,
  endingContract: z.string().trim().max(4_000),
  toneAndVoice: intentText,
});
export const AuthorIntentSourceKindSchema = z.enum([
  "manual",
  "legacy-project",
  "ai-generated",
]);
export const AuthorIntentSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["manual", "legacy-project"]),
    projectVersion: z.number().int().nonnegative(),
    // Exact saved fields, never a parsed or automatically adopted author intent.
    legacyFields: z.record(z.string(), z.string()).optional(),
  }),
  z
    .object({
      kind: z.literal("ai-generated"),
      projectVersion: z.number().int().nonnegative(),
      creation: AuthorIntentCreationProvenanceSchema,
    })
    .strict(),
]);
export const AuthorIntentStatusSchema = z.enum([
  "pending",
  "adopted",
  "discarded",
  "conflicted",
]);
const AuthorIntentObjectSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  version: z.number().int().positive(),
  stateVersion: z.number().int().nonnegative(),
  status: AuthorIntentStatusSchema,
  content: AuthorIntentContentSchema,
  source: AuthorIntentSourceSchema,
  baseAdoptedId: z.string().uuid().optional(),
  // Read-only projection; an adopted snapshot is immutable even if project
  // metadata later changes. Only another explicit adoption changes the head.
  sourceState: z.enum(["current", "stale"]),
  isCurrent: z.boolean(),
  adoptedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const AuthorIntentSchema = AuthorIntentObjectSchema.superRefine(
  (value, check) => {
    const basis =
      value.source.kind === "ai-generated"
        ? value.source.creation.basis
        : undefined;
    if (basis?.sourceBasis && basis.sourceBasis.projectId !== value.projectId)
      check.addIssue({
        code: "custom",
        path: ["source"],
        message: "意图混合来源必须属于原项目，不能以外项目解释覆盖。",
      });
  },
);
export const AuthorIntentSummarySchema = AuthorIntentObjectSchema.omit({
  content: true,
  source: true,
}).extend({
  sourceKind: AuthorIntentSourceKindSchema,
  sourceProjectVersion: z.number().int().nonnegative(),
  workflowId: z.string().uuid().optional(),
});
export const AuthorIntentPageSchema = z.object({
  items: z.array(AuthorIntentSummarySchema),
  nextCursor: z.string().uuid().optional(),
});
export const AuthorIntentCurrentSchema = z.object({
  projectVersion: z.number().int().nonnegative(),
  current: AuthorIntentSchema.optional(),
  legacyReviewRequired: z.boolean(),
});
export const AuthorIntentPreviewInputSchema = z.object({
  projectVersion: z.number().int().nonnegative(),
  baseAdoptedId: z.string().uuid().optional(),
  // Public manual previews cannot forge model provenance.
  sourceKind: z.enum(["manual", "legacy-project"]),
  content: AuthorIntentContentSchema,
});
export const AuthorIntentAdoptInputSchema = z.object({
  confirmed: z.literal(true),
});
export type AuthorIntentContent = z.infer<typeof AuthorIntentContentSchema>;
export type AuthorIntent = z.infer<typeof AuthorIntentSchema>;
export type AuthorIntentSummary = z.infer<typeof AuthorIntentSummarySchema>;
export type AuthorIntentPage = z.infer<typeof AuthorIntentPageSchema>;
export type AuthorIntentCurrent = z.infer<typeof AuthorIntentCurrentSchema>;
export type AuthorIntentPreviewInput = z.infer<
  typeof AuthorIntentPreviewInputSchema
>;

export const WORKSPACE_AUTHOR_INTENT_SERVICE =
  defineServiceContract<WorkspaceAuthorIntentService>({
    id: "workspace.author-intents.v1",
    owner: "workspace",
    major: 1,
    capabilities: ["read"],
    degradable: true,
  });
export interface WorkspaceAuthorIntentService {
  get(projectId: string, id: string): AuthorIntent | undefined;
  current(projectId: string): AuthorIntent | undefined;
}

export const WorkspaceExportDocumentSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
});

export const WorkspaceBackupRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const ProjectPackagePreviewSchema = z.object({
  id: z.string().uuid(),
  sourceName: z.string(),
  projectTitle: z.string(),
  shortDramaType: z.string(),
  chapterCount: z.number().int().nonnegative(),
  resourceCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  expiresAt: z.string().datetime(),
});

export const ProjectPackagePreviewInputSchema = z.object({
  capabilityToken: z.string().uuid(),
});

export const ProjectPackageCommitInputSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
});

export const ProjectPackageCommitResultSchema = z.object({
  project: ProjectSchema,
  chaptersCreated: z.number().int().nonnegative(),
  resourcesCreated: z.number().int().nonnegative(),
});

export const GlobalSearchResultSchema = z.object({
  kind: z.string(),
  id: z.string().uuid(),
  title: z.string(),
  excerpt: z.string().optional(),
  projectId: z.string().uuid().optional(),
  updatedAt: z.string().datetime(),
});

export const GlobalSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(GlobalSearchResultSchema),
});

export const SourceImportChapterSchema = z.object({
  key: z.string(),
  title: z.string(),
  content: z.string(),
  orderIndex: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  warning: z.string().optional(),
});

export const SourceImportEpisodeSchema = z.object({
  key: z.string(),
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  scenes: z.array(z.record(z.string(), z.unknown())),
});

export const SourceImportPreviewSchema = z.object({
  fileName: z.string(),
  sourceType: z.enum([
    "txt",
    "markdown",
    "docx",
    "epub",
    "script-json",
    "draft",
  ]),
  contentKind: z.enum(["novel", "script", "draft"]),
  title: z.string(),
  charCount: z.number().int().nonnegative(),
  chapters: z.array(SourceImportChapterSchema),
  episodes: z.array(SourceImportEpisodeSchema),
  warnings: z.array(z.string()),
});

export const SourceImportPreviewInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  capabilityToken: z.string().uuid(),
});

export const StructuredScriptSceneSchema = z
  .object({
    title: z.string().trim().max(240).optional(),
    content: z.string().optional(),
    location: z.string().trim().max(240).optional(),
    time: z.string().trim().max(120).optional(),
    characters: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .catchall(z.unknown())
  .refine((scene) => Boolean(scene.title?.trim() || scene.content?.trim()), {
    message: "场景必须包含标题或正文。",
  });

export const StructuredScriptEpisodeSchema = z
  .object({
    episodeNumber: z.number().int().positive(),
    title: z.string().trim().max(240).optional(),
    content: z.string().optional(),
    scenes: z.array(StructuredScriptSceneSchema).max(500).default([]),
  })
  .refine(
    (episode) => Boolean(episode.content?.trim() || episode.scenes.length > 0),
    { message: "每一集必须包含剧本正文或至少一个场景。" },
  );

export const StructuredScriptDocumentSchema = z
  .object({
    title: z.string().trim().max(240).optional(),
    episodes: z.array(StructuredScriptEpisodeSchema).min(1).max(1000),
  })
  .superRefine((document, context) => {
    const seen = new Set<number>();
    for (const [index, episode] of document.episodes.entries()) {
      if (seen.has(episode.episodeNumber))
        context.addIssue({
          code: "custom",
          message: `第 ${episode.episodeNumber} 集重复。`,
          path: ["episodes", index, "episodeNumber"],
        });
      seen.add(episode.episodeNumber);
    }
  });

export const SourceImportPreviewResponseSchema = z.object({
  importId: z.string().uuid(),
  preview: SourceImportPreviewSchema,
  duplicates: z.object({
    chapters: z.array(z.string()),
    episodes: z.array(z.number().int().positive()),
  }),
  expiresAt: z.string().datetime(),
});

export const SourceImportCommitInputSchema = z.object({
  projectId: z.string().uuid(),
  strategy: z.enum(["append", "merge", "replace"]),
  rightsConfirmed: z.boolean(),
  destructiveConfirmed: z.boolean(),
  preview: SourceImportPreviewSchema,
});
export { canonicalImportRequestJSON } from "./import-recovery.js";

export const ImportExtractionCandidateSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["character", "scene", "prop", "chapter-summary", "adaptation"]),
  title: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  sourceRefs: z.array(
    z.object({
      sourceKey: z.string(),
      chapterTitle: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      excerpt: z.string(),
      sourceVersion: z.number().int().nonnegative(),
      chapterId: z.string().uuid().optional(),
    }),
  ),
  status: z.enum(["draft", "rejected", "adopted", "conflict"]),
  conflictNote: z.string().optional(),
});

export const ImportExtractionChangeSetSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceFingerprint: z.string(),
  sourceTitle: z.string(),
  status: z.enum(["draft", "applied", "stale", "discarded", "failed"]),
  summary: z.string(),
  candidates: z.array(ImportExtractionCandidateSchema),
  appliedAt: z.string().datetime().optional(),
  undoneAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ImportExtractionCandidatePatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(600).optional(),
  status: z.enum(["draft", "rejected"]).optional(),
});

export const ImportExtractionAdoptInputSchema = z.object({
  candidateIds: z.array(z.string().uuid()).optional(),
});

export const SourceImportCommitResultSchema = z.object({
  createdChapters: z.number().int().nonnegative(),
  updatedChapters: z.number().int().nonnegative(),
  createdEpisodes: z.number().int().nonnegative(),
  createdScripts: z.number().int().nonnegative(),
  updatedScripts: z.number().int().nonnegative(),
  createdScenes: z.number().int().nonnegative(),
  adaptationProjectId: z.string().uuid().optional(),
  checkpointCount: z.number().int().nonnegative(),
  extractionChangeSet: ImportExtractionChangeSetSchema.optional(),
});

export const SourceImportCommitRecoverySchema = z
  .object({
    importId: z.string().uuid(),
    projectId: z.string().uuid(),
    state: z.enum(["pending", "committed"]),
    input: SourceImportCommitInputSchema,
    result: SourceImportCommitResultSchema.strict().optional(),
    createdAt: z.string().datetime(),
    committedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.projectId === value.input.projectId &&
      (value.state === "committed"
        ? !!value.result && !!value.committedAt
        : value.result === undefined && value.committedAt === undefined),
  )
  .refine((value) => {
    const result = value.result;
    if (!result) return true;
    if (
      result.updatedChapters !== 0 ||
      result.updatedScripts !== 0 ||
      result.checkpointCount !== 0
    )
      return false;
    return value.input.preview.contentKind === "script"
      ? result.createdChapters === 0 &&
          result.createdEpisodes === value.input.preview.episodes.length &&
          result.createdScripts === value.input.preview.episodes.length &&
          result.createdScenes ===
            value.input.preview.episodes.reduce(
              (count, episode) => count + episode.scenes.length,
              0,
            ) &&
          !!result.adaptationProjectId &&
          result.extractionChangeSet === undefined
      : result.createdChapters === value.input.preview.chapters.length &&
          result.createdEpisodes === 0 &&
          result.createdScripts === 0 &&
          result.createdScenes === 0 &&
          result.adaptationProjectId === undefined &&
          result.extractionChangeSet?.projectId === value.projectId;
  });
export type SourceImportCommitInput = z.infer<
  typeof SourceImportCommitInputSchema
>;
export type SourceImportCommitResult = z.infer<
  typeof SourceImportCommitResultSchema
>;
export type SourceImportCommitRecovery = z.infer<
  typeof SourceImportCommitRecoverySchema
>;

export type SourceImportPreview = z.infer<typeof SourceImportPreviewSchema>;
export type ImportExtractionCandidate = z.infer<
  typeof ImportExtractionCandidateSchema
>;
export type ImportExtractionChangeSet = z.infer<
  typeof ImportExtractionChangeSetSchema
>;
