import { z } from "zod";
import { NarrativeContextRequestSchema } from "./narrative-context.js";
import { AgentEngineKindSchema } from "./index.js";
import { TaskSchema } from "./automation.js";
import { CreativeQualityRecordSchema } from "./creative-quality.js";
import { ProjectSchema } from "./workspace.js";
import { defineServiceContract } from "./service-contract.js";
export { canonicalImportRequestJSON } from "./import-recovery.js";

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

// Facts recorded by Writing in the same transaction as Preview / Commit.
// Saved text, workflow completion and imported drafts are not AI adoption.
export const ChapterAdoptionSchema = z.object({
  workflowId: z.string().uuid(),
  chapterId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  adoptedAt: z.string().datetime(),
});
export const ChapterAdoptionPageSchema = z.object({
  items: z.array(ChapterAdoptionSchema),
  nextCursor: z.string().optional(),
});
export type ChapterAdoption = z.infer<typeof ChapterAdoptionSchema>;
export type ChapterAdoptionPage = z.infer<typeof ChapterAdoptionPageSchema>;

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

// An explicit batch changes only these chapter memberships. Omitted chapters
// remain untouched; null removes membership, never deletes a chapter or volume.
export const WritingVolumeAssignmentInputSchema = z
  .object({
    chapters: z
      .array(
        z
          .object({
            chapterId: z.string().uuid(),
            version: z.number().int().nonnegative(),
            volumeId: z.string().uuid().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    volumes: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            version: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.chapters.map((item) => item.chapterId)).size ===
        value.chapters.length &&
      new Set(value.volumes.map((item) => item.id)).size ===
        value.volumes.length &&
      new Set(
        value.chapters.flatMap((item) =>
          item.volumeId ? [item.volumeId] : [],
        ),
      ).size === value.volumes.length &&
      value.volumes.every((volume) =>
        value.chapters.some((item) => item.volumeId === volume.id),
      ),
  );
export const WritingVolumeAssignmentReceiptSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    input: WritingVolumeAssignmentInputSchema,
    chapters: z
      .array(
        z
          .object({
            chapterId: z.string().uuid(),
            version: z.number().int().nonnegative(),
            volumeId: z.string().uuid().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    committedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (value) =>
      value.chapters.length === value.input.chapters.length &&
      value.chapters.every((item, index) => {
        const source = value.input.chapters[index];
        return (
          source &&
          item.chapterId === source.chapterId &&
          item.volumeId === source.volumeId &&
          item.version === source.version + 1
        );
      }),
  );
export type WritingVolumeAssignmentInput = z.infer<
  typeof WritingVolumeAssignmentInputSchema
>;
export type WritingVolumeAssignmentReceipt = z.infer<
  typeof WritingVolumeAssignmentReceiptSchema
>;
export type WritingVolumeWriteResult<T> =
  | { state: "committed"; value: T }
  | {
      state: "conflict";
      code: "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "INVALID_RECEIPT";
    };

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
  createOnce(
    input: z.infer<typeof WritingVolumeInputSchema>,
    key: string,
  ): WritingVolumeWriteResult<WritingVolume>;
  assignChapters(
    projectId: string,
    input: WritingVolumeAssignmentInput,
    key: string,
  ): WritingVolumeWriteResult<WritingVolumeAssignmentReceipt>;
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

export const WritingImportBatchInputSchema = z
  .object({
    importId: z.string().uuid(),
    projectId: z.string().uuid(),
    chapters: z
      .array(
        z
          .object({
            sourceKey: z.string().min(1).max(500),
            title: z.string().trim().min(1).max(160),
            content: z.string(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.chapters.map((chapter) => chapter.sourceKey)).size ===
      value.chapters.length,
  );
export const WritingImportBatchReceiptSchema = z
  .object({
    importId: z.string().uuid(),
    projectId: z.string().uuid(),
    committedAt: z.string().datetime(),
    chapters: z
      .array(
        z
          .object({
            sourceKey: z.string().min(1).max(500),
            chapterId: z.string().uuid(),
            version: z.literal(0),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.chapters.map((chapter) => chapter.sourceKey)).size ===
        value.chapters.length &&
      new Set(value.chapters.map((chapter) => chapter.chapterId)).size ===
        value.chapters.length,
  );
export type WritingImportBatchInput = z.infer<
  typeof WritingImportBatchInputSchema
>;
export type WritingImportBatchReceipt = z.infer<
  typeof WritingImportBatchReceiptSchema
>;

export interface WritingChapterService {
  importBatch(
    input: WritingImportBatchInput,
  ):
    | { state: "committed"; receipt: WritingImportBatchReceipt }
    | { state: "conflict" };
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
  }).extend({
    sourceChapterId: z.string().uuid(),
    narrativeContextRequest: NarrativeContextRequestSchema.optional(),
  });
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
