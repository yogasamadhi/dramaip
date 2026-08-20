import { z } from "zod";
import { AgentEngineKindSchema } from "./index.js";
import { TaskSchema } from "./automation.js";
import { CreativeQualityRecordSchema } from "./creative-quality.js";
import { ProjectSchema } from "./workspace.js";

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(160),
  orderIndex: z.number().int().nonnegative(),
  summary: z.string(),
  outline: z.string().optional(),
  content: z.string(),
  mainConflict: z.string().optional(),
  hook: z.string().optional(),
  highlight: z.string().optional(),
  reversal: z.string().optional(),
  cliffhanger: z.string().optional(),
  shortDramaNote: z.string().optional(),
  aiVideoNote: z.string().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ChapterInputSchema = ChapterSchema.pick({
  projectId: true,
  title: true,
}).extend({
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
});

export const ChapterPatchSchema = ChapterInputSchema.omit({
  projectId: true,
})
  .partial()
  .extend({ version: z.number().int().nonnegative() });

export const ChapterReorderInputSchema = z.object({
  chapterIds: z.array(z.string().uuid()),
});

export const NovelWorkspaceSchema = z.object({
  project: ProjectSchema,
  chapters: z.array(ChapterSchema),
  characters: z.array(z.record(z.string(), z.unknown())),
  outlines: z.array(z.record(z.string(), z.unknown())),
  storyArcs: z.array(z.record(z.string(), z.unknown())),
  statuses: z.array(
    z.object({
      chapterId: z.string().uuid(),
      words: z.number().int().nonnegative(),
      hasMemory: z.boolean(),
      quality: z.enum(["pass", "warn", "block"]).optional(),
      latestTaskStatus: z.string().optional(),
    }),
  ),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type ChapterInput = z.infer<typeof ChapterInputSchema>;
export type ChapterPatch = z.infer<typeof ChapterPatchSchema>;

export const WRITING_CHAPTER_SERVICE = "writing.chapters.v1" as const;

export type ChapterMutationResult =
  | { state: "updated"; value: Chapter }
  | { state: "missing" }
  | { state: "conflict"; current: Chapter };

export interface WritingChapterService {
  create(input: ChapterInput): Chapter;
  get(id: string): Chapter | undefined;
  list(projectId: string): readonly Chapter[];
  update(id: string, patch: ChapterPatch): ChapterMutationResult;
  remove(id: string): boolean;
  replaceContent(
    id: string,
    baseVersion: number,
    content: string,
  ): ChapterMutationResult;
  updateSummary(
    id: string,
    baseVersion: number,
    summary: string,
  ): ChapterMutationResult;
}

export const ChapterAgentRunInputSchema = z.object({
  taskType: z.string().regex(/^[a-z][a-z0-9_]{1,100}$/u),
  engineKind: AgentEngineKindSchema,
  model: z.record(z.string(), z.unknown()).optional(),
  prompt: z.string().max(100_000).optional(),
  wordGoal: z.number().int().positive().max(100_000).optional(),
  baseVersion: z.number().int().nonnegative(),
  selection: z.unknown().optional(),
});
export const ChapterAgentRunStartSchema = z.object({
  taskId: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  chapterId: z.string().uuid(),
  autoCommitWhenReady: z.boolean(),
});
export const ContinueChapterAgentRunInputSchema =
  ChapterAgentRunInputSchema.pick({
    engineKind: true,
    model: true,
    prompt: true,
    wordGoal: true,
    baseVersion: true,
  }).extend({ sourceChapterId: z.string().uuid() });
export const ContinueChapterAgentRunStartSchema = z.object({
  chapter: ChapterSchema,
  run: ChapterAgentRunStartSchema,
});

export const ContentVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterTitle: z.string(),
  versionNumber: z.number().int().nonnegative(),
  snapshot: ChapterSchema,
  createdAt: z.string().datetime(),
});

export const ContentVersionRestoreResultSchema = z.object({
  targetKind: z.literal("chapter"),
  targetId: z.string().uuid(),
  restoredFromId: z.string().uuid(),
  chapter: ChapterSchema,
});

export const ChapterAnalysisRunResultSchema = z.object({
  task: TaskSchema,
  records: z.array(CreativeQualityRecordSchema),
});

export const WritingResourceKindSchema = z.enum([
  "characters",
  "outlines",
  "story-arcs",
]);

export const WritingResourceSchema = z.object({
  id: z.string().uuid(),
  domain: WritingResourceKindSchema,
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(160),
  payload: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WritingResourceKind = z.infer<typeof WritingResourceKindSchema>;
export type WritingResource = z.infer<typeof WritingResourceSchema>;

export const WRITING_RESOURCE_SERVICE = "writing.resources.v1" as const;

export interface WritingResourceService {
  create(input: {
    kind: WritingResourceKind;
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, unknown>;
  }): WritingResource;
  list(
    kind: WritingResourceKind,
    projectId: string,
  ): readonly WritingResource[];
  get(id: string): WritingResource | undefined;
  update(
    id: string,
    patch: {
      title?: string;
      payload?: Record<string, unknown>;
      version: number;
    },
  ): WritingResource | "conflict" | undefined;
  remove(id: string, expectedVersion?: number): boolean;
}
