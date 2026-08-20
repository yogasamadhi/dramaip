import { z } from "zod";

export const StoryBibleSettingsSchema = z.object({
  projectId: z.string().uuid(),
  autoSuggest: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const StoryBibleChangeSetStatusSchema = z.enum([
  "queued",
  "draft",
  "applied",
  "paused",
  "skipped",
  "discarded",
  "stale",
  "failed",
]);

export const StoryBibleChangePreviewSchema = z.object({
  title: z.string(),
  fields: z.array(z.object({ key: z.string(), value: z.string() })),
});

export const StoryBibleChangeSetSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
  sourceVersion: z.number().int().nonnegative(),
  status: StoryBibleChangeSetStatusSchema,
  summary: z.string(),
  taskId: z.string().uuid().optional(),
  conflictNotes: z.array(z.string()),
  preview: StoryBibleChangePreviewSchema,
  appliedAt: z.string().datetime().optional(),
  undoneAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StoryBibleStaleMarkSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
  reason: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StoryBibleChangeSetInputSchema = z.object({
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

export const StoryBibleChangeSetApplyInputSchema = z.object({
  fields: z.array(z.string()).optional(),
});

export type StoryBibleChangeSet = z.infer<typeof StoryBibleChangeSetSchema>;
