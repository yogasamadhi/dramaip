import { z } from "@hono/zod-openapi";

export const projectStatusSchema = z.enum(["active", "archived", "trashed"]);
export const projectCreationModeSchema = z.enum([
  "inspiration",
  "source-import",
  "script-import",
]);

export const projectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    synopsis: z.string(),
    genre: z.string(),
    creationMode: projectCreationModeSchema,
    targetWordCount: z.number().int().nonnegative(),
    targetEpisodeCount: z.number().int().nonnegative(),
    initialScript: z.string().nullable(),
    status: projectStatusSchema,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("WorkspaceProject");

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4_000).default(""),
    synopsis: z.string().max(20_000).default(""),
    genre: z.string().trim().max(100).default("都市情感"),
    creationMode: projectCreationModeSchema.default("inspiration"),
    targetWordCount: z.number().int().min(0).max(20_000_000).default(0),
    targetEpisodeCount: z.number().int().min(0).max(10_000).default(0),
    initialScript: z.string().max(2_000_000).nullable().default(null),
  })
  .strict()
  .openapi("CreateWorkspaceProject");

export const updateProjectSchema = createProjectSchema
  .omit({ creationMode: true })
  .partial()
  .strict()
  .openapi("UpdateWorkspaceProject");

export const projectPageSchema = z.object({
  items: z.array(projectSchema),
  nextCursor: z.string().optional(),
});

export const seriesSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    description: z.string(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("WorkspaceSeries");

export const createSeriesSchema = z
  .object({
    projectId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4_000).default(""),
  })
  .strict()
  .openapi("CreateWorkspaceSeries");

export const updateSeriesSchema = createSeriesSchema
  .omit({ projectId: true })
  .partial()
  .strict();

export const seriesPageSchema = z.object({
  items: z.array(seriesSchema),
  nextCursor: z.string().optional(),
});

export const sourceImportChapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  ordinal: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
});

export const sourceImportCandidateKindSchema = z.enum([
  "character",
  "scene",
  "prop",
  "chapter-summary",
  "adaptation-suggestion",
]);

export const sourceImportCandidateSchema = z.object({
  id: z.uuid(),
  kind: sourceImportCandidateKindSchema,
  title: z.string(),
  data: z.record(z.string(), z.unknown()),
  selectedByDefault: z.boolean(),
});

export const sourceImportPreviewSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    fileName: z.string(),
    sourceType: z.enum(["txt", "markdown", "docx"]),
    checksum: z.string(),
    charCount: z.number().int().nonnegative(),
    chapters: z.array(sourceImportChapterSchema),
    candidates: z.array(sourceImportCandidateSchema),
    warnings: z.array(z.string()),
    status: z.enum(["preview", "committed", "discarded", "undone"]),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .openapi("SourceImportPreview");

export const previewSourceImportSchema = z
  .object({
    projectId: z.uuid(),
    capability: z.string().min(16).max(500),
  })
  .strict();

export const commitSourceImportSchema = z
  .object({
    rightsConfirmed: z.literal(true),
    selectedCandidateIds: z.array(z.uuid()).max(5_000),
  })
  .strict();

export const sourceImportCommitResultSchema = z.object({
  preview: sourceImportPreviewSchema,
  createdResourceIds: z.array(z.uuid()),
});

export const projectPackageSchema = z
  .object({
    format: z.literal("dramaip-next-project"),
    formatVersion: z.literal(2),
    project: projectSchema,
    pluginData: z.record(z.string(), z.unknown()),
    exportedAt: z.iso.datetime(),
    checksum: z.string(),
  })
  .openapi("ProjectPackageV2");

export const previewProjectPackageSchema = z
  .object({ capability: z.string().min(16).max(500) })
  .strict();

export const projectPackagePreviewSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  projectName: z.string(),
  sourceProjectId: z.uuid(),
  pluginIds: z.array(z.string()),
  checksum: z.string(),
  expiresAt: z.iso.datetime(),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type CreateSeries = z.infer<typeof createSeriesSchema>;
export type UpdateSeries = z.infer<typeof updateSeriesSchema>;
export type SourceImportPreview = z.infer<typeof sourceImportPreviewSchema>;
export type SourceImportCandidate = z.infer<typeof sourceImportCandidateSchema>;
export type ProjectPackage = z.infer<typeof projectPackageSchema>;
