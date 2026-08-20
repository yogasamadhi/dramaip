import { z } from "zod";

const optionalText = z.string().optional();

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  shortDramaType: z.string().min(1).max(160),
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
}).extend({ synopsis: z.string().optional() });

export const ProjectPatchSchema = ProjectInputSchema.partial().extend({
  version: z.number().int().nonnegative(),
});

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

export const WORKSPACE_PROJECT_SERVICE = "workspace.projects.v1" as const;

export interface WorkspaceProjectService {
  create(input: ProjectInput): Project;
  get(id: string, options?: { includeDeleted?: boolean }): Project | undefined;
  list(options?: { includeDeleted?: boolean }): readonly Project[];
  update(id: string, patch: ProjectPatch): Project | "conflict" | undefined;
  setCurrentAdaptation(
    projectId: string,
    adaptationId: string,
  ): Project | undefined;
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
  projectId: z.string().uuid(),
  capabilityToken: z.string().uuid(),
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

export type SourceImportPreview = z.infer<typeof SourceImportPreviewSchema>;
export type ImportExtractionCandidate = z.infer<
  typeof ImportExtractionCandidateSchema
>;
export type ImportExtractionChangeSet = z.infer<
  typeof ImportExtractionChangeSetSchema
>;
