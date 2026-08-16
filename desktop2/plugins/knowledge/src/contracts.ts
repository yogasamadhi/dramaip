import { z } from "@hono/zod-openapi";

const base = {
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const characterDataSchema = z.object({
  role: z.string().max(500).default(""),
  biography: z.string().max(100_000).default(""),
  traits: z.array(z.string().max(500)).max(500).default([]),
  relationships: z
    .array(z.object({ characterId: z.uuid(), relation: z.string().max(2_000) }))
    .max(1_000)
    .default([]),
  currentState: z.string().max(20_000).default(""),
  visualProfile: z.string().max(20_000).default(""),
});
export const outlineDataSchema = z.object({
  summary: z.string().max(200_000).default(""),
  beats: z.array(z.string().max(20_000)).max(10_000).default([]),
});
export const storyArcDataSchema = z.object({
  premise: z.string().max(100_000).default(""),
  beats: z
    .array(
      z.object({
        title: z.string().max(500),
        description: z.string().max(20_000),
      }),
    )
    .max(10_000)
    .default([]),
});
export const storyBibleDataSchema = z.object({
  world: z.string().max(200_000).default(""),
  rules: z.array(z.string().max(20_000)).max(10_000).default([]),
  themes: z.array(z.string().max(5_000)).max(1_000).default([]),
  events: z.array(z.string().max(20_000)).max(10_000).default([]),
  foreshadowing: z.array(z.string().max(20_000)).max(10_000).default([]),
});

export const characterSchema = z
  .object({ ...base, data: characterDataSchema })
  .openapi("KnowledgeCharacter");
export const outlineSchema = z
  .object({ ...base, data: outlineDataSchema })
  .openapi("KnowledgeOutline");
export const storyArcSchema = z
  .object({ ...base, data: storyArcDataSchema })
  .openapi("KnowledgeStoryArc");
export const storyBibleSchema = z
  .object({ ...base, data: storyBibleDataSchema })
  .openapi("KnowledgeStoryBible");

export const knowledgeKindSchema = z.enum([
  "character",
  "outline",
  "story-arc",
  "story-bible",
]);
export const knowledgeRecordSchema = z.discriminatedUnion("kind", [
  characterSchema.extend({ kind: z.literal("character") }),
  outlineSchema.extend({ kind: z.literal("outline") }),
  storyArcSchema.extend({ kind: z.literal("story-arc") }),
  storyBibleSchema.extend({ kind: z.literal("story-bible") }),
]);

export const createKnowledgeRecordSchema = z
  .object({
    projectId: z.uuid(),
    title: z.string().trim().min(1).max(500),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export const updateKnowledgeRecordSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const knowledgePageSchema = z.object({
  items: z.array(knowledgeRecordSchema),
  nextCursor: z.string().optional(),
});

export const storyBibleSettingsSchema = z.object({
  projectId: z.uuid(),
  autoSuggest: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const changeOperationSchema = z.enum(["create", "update", "delete"]);
export const changeSetItemSchema = z.object({
  id: z.uuid(),
  targetKind: knowledgeKindSchema,
  targetId: z.uuid().nullable(),
  operation: changeOperationSchema,
  baseVersion: z.number().int().positive().nullable(),
  title: z.string(),
  patch: z.record(z.string(), z.unknown()),
  applied: z.boolean(),
});
export const changeSetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  chapterId: z.uuid().nullable(),
  rationale: z.string(),
  status: z.enum([
    "queued",
    "paused",
    "skipped",
    "applied",
    "undone",
    "discarded",
  ]),
  items: z.array(changeSetItemSchema),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const createChangeSetSchema = z
  .object({
    projectId: z.uuid(),
    chapterId: z.uuid().nullable().optional(),
    rationale: z.string().max(100_000).default(""),
    changes: z
      .array(
        z.object({
          targetKind: knowledgeKindSchema,
          targetId: z.uuid().nullable().optional(),
          operation: changeOperationSchema,
          baseVersion: z.number().int().positive().nullable().optional(),
          title: z.string().trim().min(1).max(500),
          patch: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(1_000),
  })
  .strict();
export const applyChangeSetSchema = z
  .object({ selectedItemIds: z.array(z.uuid()).min(1).max(1_000) })
  .strict();

export const staleMarkSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  sourceType: z.string(),
  sourceId: z.string(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});

export const importExtractionSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  sourceImportId: z.uuid(),
  candidate: z.object({
    id: z.uuid(),
    kind: z.enum([
      "character",
      "scene",
      "prop",
      "chapter-summary",
      "adaptation-suggestion",
    ]),
    title: z.string(),
    data: z.record(z.string(), z.unknown()),
    selectedByDefault: z.boolean(),
  }),
  createdResourceIds: z.array(z.uuid()),
  status: z.literal("adopted"),
  createdAt: z.iso.datetime(),
});

export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;
