import { z } from "@hono/zod-openapi";

export const chapterStatusSchema = z.enum(["draft", "review", "final"]);

export const chapterSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    title: z.string(),
    summary: z.string(),
    content: z.string(),
    outline: z.string(),
    mainConflict: z.string(),
    hook: z.string(),
    highlight: z.string(),
    reversal: z.string(),
    cliffhanger: z.string(),
    shortDramaNote: z.string(),
    aiVideoNote: z.string(),
    status: chapterStatusSchema,
    ordinal: z.number().int().nonnegative(),
    wordCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("WritingChapter");

const chapterFields = z.object({
  title: z.string().trim().min(1).max(500),
  summary: z.string().max(20_000).default(""),
  content: z.string().max(2_000_000).default(""),
  outline: z.string().max(100_000).default(""),
  mainConflict: z.string().max(20_000).default(""),
  hook: z.string().max(20_000).default(""),
  highlight: z.string().max(20_000).default(""),
  reversal: z.string().max(20_000).default(""),
  cliffhanger: z.string().max(20_000).default(""),
  shortDramaNote: z.string().max(20_000).default(""),
  aiVideoNote: z.string().max(20_000).default(""),
  status: chapterStatusSchema.default("draft"),
});

export const createChapterSchema = chapterFields
  .extend({
    projectId: z.uuid(),
    ordinal: z.number().int().nonnegative().optional(),
  })
  .strict();
export const updateChapterSchema = chapterFields.partial().strict();

export const chapterPageSchema = z.object({
  items: z.array(chapterSchema),
  nextCursor: z.string().optional(),
});

export const chapterVersionSchema = z.object({
  id: z.uuid(),
  chapterId: z.uuid(),
  chapterVersion: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  fields: z.record(z.string(), z.string()),
  reason: z.enum([
    "manual-save",
    "agent-commit",
    "restore-checkpoint",
    "import",
  ]),
  createdAt: z.iso.datetime(),
});
export const chapterVersionPageSchema = z.object({
  items: z.array(chapterVersionSchema),
  nextCursor: z.string().optional(),
});

export const projectContentVersionSchema = chapterVersionSchema.extend({
  projectId: z.uuid(),
  chapterTitle: z.string(),
});
export const projectContentVersionPageSchema = z.object({
  items: z.array(projectContentVersionSchema),
  nextCursor: z.string().optional(),
});

export const localizationStatusSchema = z.enum([
  "draft",
  "adopted",
  "archived",
]);
export const localizationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  sourceId: z.string().min(1),
  locale: z.string().min(2).max(64),
  content: z.string(),
  status: localizationStatusSchema,
  version: z.number().int().positive(),
  adoptedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const localizationPageSchema = z.object({
  items: z.array(localizationSchema),
  nextCursor: z.string().optional(),
});
export const createLocalizationSchema = z
  .object({
    projectId: z.uuid(),
    sourceId: z.string().trim().min(1).max(500),
    locale: z.string().trim().min(2).max(64),
    content: z.string().max(2_000_000),
  })
  .strict();
export const updateLocalizationSchema = createLocalizationSchema
  .omit({ projectId: true, sourceId: true })
  .partial()
  .strict();
export const subtitleExportSchema = z.object({
  fileName: z.string(),
  mimeType: z.enum(["application/x-subrip", "text/vtt"]),
  content: z.string(),
});

export const writingWorkspaceSchema = z.object({
  projectId: z.uuid(),
  version: z.number().int().positive(),
  wordGoal: z.number().int().positive(),
  totalWordCount: z.number().int().nonnegative(),
  chapters: z.array(chapterSchema),
  updatedAt: z.iso.datetime(),
});

export const reorderChaptersSchema = z
  .object({ chapterIds: z.array(z.uuid()).min(1).max(10_000) })
  .strict();

export const revisionSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  chapterId: z.uuid(),
  baseVersion: z.number().int().positive(),
  proposedTitle: z.string(),
  proposedContent: z.string(),
  rationale: z.string(),
  status: z.enum(["pending", "committed", "discarded"]),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createRevisionSchema = z
  .object({
    projectId: z.uuid(),
    chapterId: z.uuid(),
    baseVersion: z.number().int().positive(),
    proposedTitle: z.string().trim().min(1).max(500),
    proposedContent: z.string().max(2_000_000),
    rationale: z.string().max(100_000).default(""),
  })
  .strict();

export const updateRevisionSchema = z
  .object({
    proposedTitle: z.string().trim().min(1).max(500).optional(),
    proposedContent: z.string().max(2_000_000).optional(),
    rationale: z.string().max(100_000).optional(),
  })
  .strict();

export type Chapter = z.infer<typeof chapterSchema>;
export type CreateChapter = z.infer<typeof createChapterSchema>;
export type UpdateChapter = z.infer<typeof updateChapterSchema>;
export type ChapterVersion = z.infer<typeof chapterVersionSchema>;
export type Localization = z.infer<typeof localizationSchema>;
export type WritingWorkspace = z.infer<typeof writingWorkspaceSchema>;
export type Revision = z.infer<typeof revisionSchema>;
