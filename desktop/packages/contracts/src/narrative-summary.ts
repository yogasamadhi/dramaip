import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { NarrativeIndexChapterSchema } from "./narrative-index.js";

const ref = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const NarrativeSummaryTargetSchema = ref
  .extend({ kind: z.enum(["book", "volume", "story-arc"]) })
  .strict();
export const NarrativeSummaryRequestSchema = z
  .object({
    target: NarrativeSummaryTargetSchema,
    scopeFingerprint: hash,
    expectedHead: z.string().uuid().nullable(),
    chapters: z
      .array(
        z.discriminatedUnion("representation", [
          ref.extend({ representation: z.literal("original") }).strict(),
          ref
            .extend({ representation: z.literal("summary"), record: ref })
            .strict(),
        ]),
      )
      .min(1)
      .max(2000),
  })
  .strict()
  .superRefine((value, check) => {
    if (
      new Set(value.chapters.map((chapter) => chapter.id)).size !==
      value.chapters.length
    )
      check.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "摘要来源章节不能重复。",
      });
  });
export const NarrativeSummaryBasisSchema = z.object({
  request: NarrativeSummaryRequestSchema,
  scopeTitle: z.string(),
  directory: z.array(
    ref.extend({
      orderIndex: z.number().int().nonnegative(),
      contentHash: hash,
      hasContent: z.boolean(),
    }),
  ),
  references: z.array(
    z.object({
      chapter: ref,
      representation: z.enum(["original", "summary"]),
      sourceKind: z.enum(["chapter", "knowledge"]),
      sourceId: z.string().uuid(),
      sourceVersion: z.number().int().nonnegative(),
      fieldPath: z.string().startsWith("/"),
      contentHash: hash,
    }),
  ),
});
export const NarrativeSummaryContentSchema = z
  .object({
    summary: z.string().trim().min(1).max(100000),
    coveredChapters: z.array(ref).min(1).max(2000),
    evidence: z
      .array(
        z
          .object({
            chapter: ref,
            sourceId: z.string().uuid(),
            sourceVersion: z.number().int().nonnegative(),
            fieldPath: z.string().startsWith("/"),
            quote: z.string().trim().min(1).max(20000),
          })
          .strict(),
      )
      .min(1)
      .max(4000),
  })
  .strict();
export const NarrativeSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  workflowId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  status: z.enum(["awaiting-review", "adopted", "discarded"]),
  basis: NarrativeSummaryBasisSchema,
  content: NarrativeSummaryContentSchema,
  sourceSnapshotId: z.string().uuid(),
  runIds: z.array(z.string().uuid()),
  engineKind: z.enum(["pi", "codex", "langgraph"]),
  contextBudget: z.object({
    source: z.literal("estimate"),
    tokenBudget: z.number().int().positive(),
    estimatedTokens: z.number().int().nonnegative(),
  }),
  usage: z.object({ state: z.literal("unknown") }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  adoptedAt: z.string().datetime().optional(),
  isHead: z.boolean(),
  isCurrent: z.boolean(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  // A frozen adopted range may remain usable when the directory grows. It
  // never becomes evidence that the new complete scope has been summarized.
  contextEligibility: z.object({
    state: z.enum(["eligible", "ineligible"]),
    reasons: z.array(z.string()),
  }),
});
export const NarrativeSummaryPageSchema = z.object({
  items: z.array(NarrativeSummarySchema),
  nextCursor: z.string().optional(),
});
// Body-free owner read model. Scope freshness and frozen-context eligibility
// are distinct: directory growth must not silently invalidate usable evidence.
export const NarrativeSummaryStatusSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    status: NarrativeSummarySchema.shape.status,
    target: NarrativeSummaryTargetSchema,
    isHead: z.boolean(),
    isCurrent: z.boolean(),
    sourceState: NarrativeSummarySchema.shape.sourceState,
    staleReasonCount: z.number().int().nonnegative(),
    contextEligibility: z
      .object({
        state: z.enum(["eligible", "ineligible"]),
        reasonCount: z.number().int().nonnegative(),
      })
      .strict(),
    coveredChapterCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    adoptedAt: z.string().datetime().optional(),
  })
  .strict();
export const NarrativeSummaryStatusPageSchema = z
  .object({
    items: z.array(NarrativeSummaryStatusSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export type NarrativeSummaryStatus = z.infer<
  typeof NarrativeSummaryStatusSchema
>;
export type NarrativeSummaryStatusPage = z.infer<
  typeof NarrativeSummaryStatusPageSchema
>;
export const NarrativeSummaryScopeSchema = z.object({
  target: NarrativeSummaryTargetSchema,
  title: z.string(),
  scopeFingerprint: hash,
  chapters: z.array(NarrativeIndexChapterSchema),
  head: ref.nullable(),
  state: z.enum(["current", "unbound", "stale"]),
  reasons: z.array(z.string()),
});
export const NarrativeSummaryScopesSchema = z.object({
  projectId: z.string().uuid(),
  scopes: z.array(NarrativeSummaryScopeSchema),
  unavailable: z.array(z.string()),
});
export type NarrativeSummaryRequest = z.infer<
  typeof NarrativeSummaryRequestSchema
>;
export type NarrativeSummaryBasis = z.infer<typeof NarrativeSummaryBasisSchema>;
export type NarrativeSummaryContent = z.infer<
  typeof NarrativeSummaryContentSchema
>;
export type NarrativeSummary = z.infer<typeof NarrativeSummarySchema>;
export type NarrativeSummaryPage = z.infer<typeof NarrativeSummaryPageSchema>;
export type NarrativeSummaryScope = z.infer<typeof NarrativeSummaryScopeSchema>;
export type NarrativeSummaryScopes = z.infer<
  typeof NarrativeSummaryScopesSchema
>;
export const KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE = defineServiceContract<{
  get(projectId: string, id: string): NarrativeSummary | undefined;
  /** Actual adopted head identity, never inferred from a historical isHead flag. */
  current?(
    projectId: string,
    target: NarrativeSummaryRequest["target"],
  ): { id: string; version: number } | undefined;
}>({
  id: "knowledge.narrative-summaries.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
