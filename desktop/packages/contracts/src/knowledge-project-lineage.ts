import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import {
  StoryCausalNodeKindSchema,
  StoryCausalEdgeRelationSchema,
  AudienceKnowledgeValueSchema,
} from "./creative-intelligence.js";
import { NarrativeSummaryRequestSchema } from "./narrative-summary.js";
const uuid = z.string().uuid();
const version = z.number().int().nonnegative();
const ref = z.object({ id: uuid, version }).strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const opaque = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,499}$/u);
const paragraph = z.string().regex(/^[a-f0-9-]{36}@\d+:\d+-\d+:[a-f0-9]{12}$/u);
const field = z.union([
  z
    .string()
    .max(1000)
    .regex(
      /^\/(?:project|projects|chapters|characters|outlines|story-arcs|writing-resources|intent|selection|production|scripts|screenplays|knowledge|author-intents|narrative-summaries|narrative-story-index|story-declarations|story-assertions|story-bible|review|delivery|creator-content|preferences|profile)(?:\/[^\p{Cc}\\:%]*)?$/u,
    )
    .refine((value) => !value.includes("..") && !value.includes("//")),
  z
    .string()
    .regex(
      /^\/chapters\/([a-f0-9-]{36})\/paragraphs\/\1%40\d+%3A\d+-\d+%3A[a-f0-9]{12}$/u,
    ),
  z
    .string()
    .regex(
      /^\/chapters\/([a-f0-9-]{36})\/paragraphs\/\1@\d+:\d+-\d+:[a-f0-9]{12}$/u,
    ),
]);
const dependency = z
  .object({ sourceId: opaque, sourceVersion: version, fieldPath: field })
  .strict();
const source = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("paragraphs"),
      chapterId: uuid,
      chapterVersion: version,
      chapterContentHash: hash,
      paragraphIds: z.array(paragraph),
    })
    .strict(),
  z
    .object({
      kind: z.literal("adopted-fact"),
      chapterId: uuid,
      chapterVersion: version,
      chapterContentHash: hash,
      recordId: uuid,
      recordVersion: version,
      workflowId: uuid,
    })
    .strict(),
  z
    .object({
      kind: z.literal("screenplay-blocks"),
      scriptId: uuid,
      scriptVersion: version,
      documentId: uuid,
      documentVersion: version,
      documentContentHash: hash,
      blockIds: z.array(uuid),
    })
    .strict(),
]);
const anchor = z.union([
  z
    .object({
      start: version,
      end: z.number().int().positive(),
      paragraphIds: z.array(paragraph),
    })
    .strict(),
  z
    .object({
      blockId: uuid,
      blockIndex: version,
      blockType: z.enum([
        "scene_heading",
        "action",
        "character",
        "dialogue",
        "parenthetical",
        "transition",
        "note",
      ]),
      sourceLocation: z
        .object({
          line: z.number().int().positive(),
          column: z.number().int().positive().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
const sourceBasis = z
  .object({
    fingerprint: hash,
    sources: z.array(
      z
        .object({
          selection: source,
          quoteHash: hash,
          quoteCharacters: z.number().int().positive(),
          anchors: z.array(anchor),
        })
        .strict(),
    ),
    policyDependencies: z.array(dependency),
  })
  .strict();
const record = ref
  .extend({ kind: z.enum(["node", "edge", "cognition"]) })
  .strict();
const saved = {
  id: uuid,
  projectId: uuid,
  version,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  observation: z.literal("saved-owner-receipt-not-full-version-history"),
  fingerprint: z
    .object({
      format: z.literal("derived-from-saved-knowledge-receipt-v1"),
      sha256: hash,
    })
    .strict(),
  semanticVerification: z.literal("unverified"),
};
const interpretation = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("relationship"),
      from: ref,
      to: ref,
      relation: StoryCausalEdgeRelationSchema,
      confidence: z.number().min(0).max(1),
      interpretation: z.enum(["source-stated", "author-inferred"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cognition"),
      subject: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("audience"), id: opaque }).strict(),
        z.object({ kind: z.literal("character"), node: ref }).strict(),
      ]),
      target: ref,
      storyOrder: version,
      state: AudienceKnowledgeValueSchema,
      interpretation: z.enum(["source-stated", "author-inferred"]),
    })
    .strict(),
]);
const declaration = z
  .object({
    ...saved,
    kind: z.literal("declaration"),
    status: z.enum(["pending", "adopted", "discarded"]),
    nodeKind: StoryCausalNodeKindSchema,
    sourceBasis,
    adoptedRecord: ref
      .extend({ kind: z.literal("node") })
      .strict()
      .optional(),
    origin: z.literal("human-declared-not-independent-semantic-proof"),
  })
  .strict();
const assertion = z
  .object({
    ...saved,
    kind: z.literal("assertion"),
    status: z.enum(["pending", "adopted", "discarded"]),
    interpretation,
    sourceFingerprint: hash,
    sourceBasis,
    endpointVersions: z.array(ref),
    policyDependencies: z.array(dependency),
    adoptedRecord: ref
      .extend({ kind: z.enum(["edge", "cognition"]) })
      .strict()
      .optional(),
    origin: z.literal("human-declared-not-independent-semantic-proof"),
  })
  .strict();
const summary = z
  .object({
    ...saved,
    kind: z.literal("summary"),
    workflowId: uuid,
    status: z.enum(["awaiting-review", "adopted", "discarded"]),
    request: NarrativeSummaryRequestSchema,
    directory: z.array(
      ref
        .extend({
          orderIndex: version,
          contentHash: hash,
          hasContent: z.boolean(),
        })
        .strict(),
    ),
    references: z.array(
      z
        .object({
          chapter: ref,
          representation: z.enum(["original", "summary"]),
          sourceKind: z.enum(["chapter", "knowledge"]),
          sourceId: uuid,
          sourceVersion: version,
          fieldPath: field,
          contentHash: hash,
        })
        .strict(),
    ),
    coveredChapters: z.array(ref),
    evidence: z.array(
      z
        .object({
          chapter: ref,
          sourceId: uuid,
          sourceVersion: version,
          fieldPath: field,
          quoteHash: hash,
          quoteCharacters: z.number().int().positive(),
        })
        .strict(),
    ),
    sourceSnapshotId: uuid,
    runIds: z.array(uuid),
    engineKind: z.enum(["pi", "codex", "langgraph"]),
    contextBudget: z
      .object({
        source: z.literal("estimate"),
        tokenBudget: z.number().int().positive(),
        estimatedTokens: version,
      })
      .strict(),
    usage: z.object({ state: z.literal("unknown") }).strict(),
    adoptedAt: z.string().datetime().optional(),
  })
  .strict();
const original = z.discriminatedUnion("kind", [
  ref
    .extend({ kind: z.literal("node"), nodeKind: StoryCausalNodeKindSchema })
    .strict(),
  ref
    .extend({
      kind: z.literal("edge"),
      fromNodeId: uuid,
      toNodeId: uuid,
      relation: StoryCausalEdgeRelationSchema,
    })
    .strict(),
  ref
    .extend({
      kind: z.literal("cognition"),
      subjectType: z.enum(["audience", "character"]),
      subjectId: opaque,
      targetNodeId: uuid,
      storyOrder: version,
      state: AudienceKnowledgeValueSchema,
    })
    .strict(),
]);
const transition = z
  .object({
    kind: z.literal("source-transition"),
    id: uuid,
    projectId: uuid,
    sourceKind: z.enum(["declaration", "assertion"]),
    version: z.number().int().min(1).max(2),
    action: z.enum(["withdraw", "replace"]),
    record,
    original,
    replacementId: uuid.optional(),
    retiredAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    observation: z.literal(
      "original-immutable-transition-row-not-current-source-state",
    ),
    fingerprint: z
      .object({
        format: z.literal("derived-from-original-retired-row-v1"),
        sha256: hash,
      })
      .strict(),
    semanticVerification: z.literal("unverified"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.record.id !== value.original.id ||
      value.record.kind !== value.original.kind ||
      value.record.version !== value.original.version + 1 ||
      (value.action === "replace") !== Boolean(value.replacementId) ||
      (value.action === "withdraw" && value.version !== 1) ||
      (value.sourceKind === "declaration") !== (value.record.kind === "node")
    )
      ctx.addIssue({
        code: "custom",
        message: "原退役记录、版本与明确替换身份必须一致。",
      });
  });
export const KnowledgeProjectLineageItemSchema = z.union([
  declaration,
  assertion,
  summary,
  transition,
]);
export type KnowledgeProjectLineageItem = z.infer<
  typeof KnowledgeProjectLineageItemSchema
>;
export const KnowledgeProjectLineageCategorySchema = z.enum([
  "declarations",
  "assertions",
  "summaries",
  "transitions",
]);
export type KnowledgeProjectLineageCategory = z.infer<
  typeof KnowledgeProjectLineageCategorySchema
>;
export const KnowledgeProjectLineageCursorSchema = z.union([
  uuid,
  z.string().regex(/^(?:declaration|assertion):[a-f0-9-]{36}:[12]$/u),
]);
export const KnowledgeProjectLineagePageSchema = z
  .object({
    category: KnowledgeProjectLineageCategorySchema,
    items: z.array(KnowledgeProjectLineageItemSchema),
    nextCursor: KnowledgeProjectLineageCursorSchema.optional(),
  })
  .strict();
export function knowledgeProjectLineageIdentity(
  value: KnowledgeProjectLineageItem,
): string {
  return value.kind === "source-transition"
    ? `${value.sourceKind}:${value.id}:${value.version}`
    : value.id;
}
export const KnowledgeProjectPackageLineageSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("available"),
        coverage: z.literal("recorded-knowledge-owner-rows-only"),
        declarations: z.array(declaration),
        assertions: z.array(assertion),
        summaries: z.array(summary),
        transitions: z.array(transition),
      })
      .strict(),
    z.object({ state: z.literal("unavailable") }).strict(),
  ],
);
export const KNOWLEDGE_PROJECT_LINEAGE_SERVICE = defineServiceContract<{
  list(
    projectId: string,
    category: KnowledgeProjectLineageCategory,
    options: { cursor?: string; limit: number },
  ): z.infer<typeof KnowledgeProjectLineagePageSchema>;
}>({
  id: "knowledge.project-lineage.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
