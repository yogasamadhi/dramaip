import { z } from "zod";
import { AgentEngineKindSchema } from "./index.js";
import { TaskSchema } from "./automation.js";
import { CreativeQualityRecordSchema } from "./creative-quality.js";
import { ProjectSchema } from "./workspace.js";
import { defineServiceContract } from "./service-contract.js";

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  volumeId: z.string().uuid().optional(),
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
  volumeId: true,
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

export const WritingVolumeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(160),
  outline: z.string(),
  orderIndex: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const WritingVolumeInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  outline: z.string().optional(),
});
export const WritingVolumePatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  outline: z.string().optional(),
  version: z.number().int().nonnegative(),
});
export const WritingVolumePageSchema = z.object({
  items: z.array(WritingVolumeSchema),
  nextCursor: z.string().optional(),
});
export type WritingVolume = z.infer<typeof WritingVolumeSchema>;

export const CREATOR_CONTENT_KINDS = [
  "profile",
  "column",
  "idea",
  "draft",
  "variant",
  "calendar",
] as const;
export const CreatorContentKindSchema = z.enum(CREATOR_CONTENT_KINDS);
export const CreatorContentStatusSchema = z.enum([
  "draft",
  "researching",
  "review_required",
  "ready",
  "scheduled",
  "archived",
]);
export const CreatorContentRecordSchema = z.object({
  id: z.string().uuid(),
  kind: CreatorContentKindSchema,
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  status: CreatorContentStatusSchema,
  payload: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreatorContentRecordInputSchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  status: CreatorContentStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export const CreatorContentRecordPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  status: CreatorContentStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().nonnegative(),
});
export const CreatorContentPageSchema = z.object({
  items: z.array(CreatorContentRecordSchema),
  nextCursor: z.string().optional(),
});
export type CreatorContentKind = z.infer<typeof CreatorContentKindSchema>;
export type CreatorContentRecord = z.infer<typeof CreatorContentRecordSchema>;

export const WRITING_VOLUME_SERVICE =
  defineServiceContract<WritingVolumeService>({
    id: "writing.longform.v1",
    owner: "writing",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });
export interface WritingVolumeService {
  create(input: z.infer<typeof WritingVolumeInputSchema>): WritingVolume;
  list(
    projectId: string,
    options?: { cursor?: string; limit?: number },
  ): { items: readonly WritingVolume[]; nextCursor?: string };
  get(id: string): WritingVolume | undefined;
  update(
    id: string,
    patch: z.infer<typeof WritingVolumePatchSchema>,
  ): WritingVolume | "conflict" | undefined;
}

export const CREATOR_CONTENT_SERVICE =
  defineServiceContract<CreatorContentService>({
    id: "writing.creator-content.v1",
    owner: "writing",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });
export interface CreatorContentService {
  create(
    kind: CreatorContentKind,
    input: z.infer<typeof CreatorContentRecordInputSchema>,
  ): CreatorContentRecord;
  list(
    kind: CreatorContentKind,
    projectId: string,
    options?: { cursor?: string; limit?: number; status?: string },
  ): { items: readonly CreatorContentRecord[]; nextCursor?: string };
  get(id: string): CreatorContentRecord | undefined;
  update(
    id: string,
    patch: z.infer<typeof CreatorContentRecordPatchSchema>,
  ): CreatorContentRecord | "conflict" | undefined;
}

export const WRITING_CHAPTER_SERVICE =
  defineServiceContract<WritingChapterService>({
    id: "writing.chapters.v1",
    owner: "writing",
    major: 1,
    capabilities: ["read", "write", "restore"],
    degradable: true,
  });

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

export const WRITING_RESOURCE_SERVICE =
  defineServiceContract<WritingResourceService>({
    id: "writing.resources.v1",
    owner: "writing",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });

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
