import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";

const reference = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
// Persisted within the Writing-owned story arc payload. Chapter numbers are
// deliberately not accepted: reordering must not silently change membership.
export const NarrativeArcScopeSchema = z
  .object({
    format: z.literal("chapter-refs-v1"),
    chapters: z.array(reference).min(1).max(2000),
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
        message: "故事弧章节引用不能重复。",
      });
  });
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const NarrativeIndexChapterSchema = reference.extend({
  title: z.string(),
  orderIndex: z.number().int().nonnegative(),
  contentHash: hash,
  hasContent: z.boolean(),
  paragraphCount: z.number().int().nonnegative(),
  summaryState: z.enum(["current", "stale", "missing", "empty"]),
  summaryCount: z.number().int().nonnegative(),
  factCount: z.number().int().nonnegative(),
  excludedRecordCount: z.number().int().nonnegative(),
  originalEstimatedTokens: z.number().int().nonnegative(),
  summaryEstimatedTokens: z.number().int().nonnegative(),
});
const coverage = z.object({
  chapterCount: z.number().int().nonnegative(),
  nonEmptyChapterCount: z.number().int().nonnegative(),
  currentSummaryChapterCount: z.number().int().nonnegative(),
  missingSummaryChapterIds: z.array(z.string().uuid()),
});
export const NarrativeIndexCatalogSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().nonnegative(),
  fingerprint: hash,
  chapters: z.array(NarrativeIndexChapterSchema),
  groups: z.array(
    reference.extend({
      kind: z.enum(["book", "volume", "story-arc"]),
      title: z.string(),
      chapterIds: z.array(z.string().uuid()),
      state: z.enum(["current", "unbound", "stale"]),
      reasons: z.array(z.string()),
      coverage,
    }),
  ),
  unavailable: z.array(z.string()),
  unassignedRecords: z.array(
    reference.extend({
      reason: z.enum(["chapter-missing", "chapter-unbound"]),
    }),
  ),
});
const anchor = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  paragraphIds: z.array(z.string()).min(1),
});
export const NarrativeIndexDetailSchema = z.object({
  projectId: z.string().uuid(),
  fingerprint: hash,
  chapter: NarrativeIndexChapterSchema,
  paragraphs: z.array(
    z.object({
      id: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      contentHash: hash,
    }),
  ),
  summaries: z.array(
    reference.extend({
      sourceWorkflowId: z.string().uuid(),
      text: z.string(),
      evidence: z.object({
        quote: z.string(),
        matches: z.array(anchor).min(1),
      }),
    }),
  ),
  facts: z.array(
    reference.extend({
      kind: z.enum(["character-states", "story-events", "foreshadowings"]),
      sourceWorkflowId: z.string().uuid(),
      title: z.string(),
      text: z.string(),
      evidence: z.object({
        quote: z.string(),
        matches: z.array(anchor).min(1),
      }),
    }),
  ),
  excluded: z.array(
    reference.extend({
      reason: z.enum([
        "unverified-adoption",
        "source-stale",
        "invalid-evidence",
        "modified-record",
        "missing-summary",
      ]),
    }),
  ),
});
export type NarrativeIndexCatalog = z.infer<typeof NarrativeIndexCatalogSchema>;
export type NarrativeIndexDetail = z.infer<typeof NarrativeIndexDetailSchema>;
export const KNOWLEDGE_NARRATIVE_INDEX_SERVICE = defineServiceContract<{
  catalog(projectId: string): NarrativeIndexCatalog;
  chapter(
    projectId: string,
    chapterId: string,
  ): NarrativeIndexDetail | undefined;
  details?(
    projectId: string,
    chapterIds: readonly string[],
  ): NarrativeIndexDetail[];
}>({
  id: "knowledge.narrative-index.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
