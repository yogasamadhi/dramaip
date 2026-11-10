import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import type { AgentContextReference } from "./agent-context.js";
import {
  StoryCausalNodeKindSchema,
  StoryCausalEdgeRelationSchema,
  AudienceKnowledgeValueSchema,
} from "./creative-intelligence.js";
import { StorySourceRecordSchema } from "./story-source-lifecycle.js";
import { StoryEventTimelineSchema } from "./story-declaration.js";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
// A current read-only directory projection, not the membership frozen with a
// declaration and never a claim that the original chapters were read.
export const NarrativeStoryHierarchySchema = z
  .discriminatedUnion("state", [
    z
      .object({
        state: z.literal("available"),
        projectId: z.string().uuid(),
        projectVersion: z.number().int().nonnegative(),
        fingerprint: hash,
        membershipPolicy: z.literal(
          "current-directory-not-frozen-membership-or-read-coverage",
        ),
        chapters: z
          .array(
            ref
              .extend({
                title: z.string(),
                orderIndex: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .max(20000),
        groups: z
          .array(
            ref
              .extend({
                kind: z.enum(["book", "volume", "story-arc"]),
                title: z.string(),
                chapterIds: z.array(z.string().uuid()).max(20000),
                state: z.enum(["current", "unbound", "stale"]),
                reasons: z.array(z.string()),
              })
              .strict(),
          )
          .max(20000),
      })
      .strict(),
    z
      .object({
        state: z.literal("unavailable"),
        projectId: z.string().uuid(),
        reason: z.literal(
          "基础叙事目录归属暂不可完整核对，未换源或认定为空范围。",
        ),
      })
      .strict(),
  ])
  .superRefine((value, check) => {
    if (value.state !== "available") return;
    const chapters = new Set(value.chapters.map((chapter) => chapter.id));
    if (chapters.size !== value.chapters.length)
      check.addIssue({ code: "custom", message: "当前章节身份不能重复。" });
    if (
      new Set(value.groups.map((group) => `${group.kind}:${group.id}`)).size !==
      value.groups.length
    )
      check.addIssue({ code: "custom", message: "当前层级身份不能重复。" });
    const books = value.groups.filter((group) => group.kind === "book");
    if (
      books.length !== 1 ||
      books[0]!.id !== value.projectId ||
      books[0]!.version !== value.projectVersion ||
      books[0]!.state !== "current" ||
      JSON.stringify(books[0]!.chapterIds) !==
        JSON.stringify(value.chapters.map((chapter) => chapter.id))
    )
      check.addIssue({
        code: "custom",
        message: "全书层级必须绑定当前项目与完整实际章节顺序。",
      });
    const volumeChapters = new Set<string>();
    for (const group of value.groups) {
      if (new Set(group.chapterIds).size !== group.chapterIds.length)
        check.addIssue({ code: "custom", message: "层级章节身份不能重复。" });
      if (
        (group.state === "current" &&
          (group.reasons.length ||
            group.chapterIds.some((id) => !chapters.has(id)))) ||
        (group.state !== "current" && !group.reasons.length) ||
        (group.state === "unbound" && group.chapterIds.length)
      )
        check.addIssue({
          code: "custom",
          message: "层级当前／未绑定／失效状态与实际范围不符。",
        });
      if (group.kind === "volume" && group.state === "current")
        for (const id of group.chapterIds) {
          if (volumeChapters.has(id))
            check.addIssue({
              code: "custom",
              message: "同一当前章节不能归属多个实际卷。",
            });
          volumeChapters.add(id);
        }
    }
  });
export type NarrativeStoryHierarchy = z.infer<
  typeof NarrativeStoryHierarchySchema
>;
export const NarrativeStorySelectionSchema = ref
  .extend({ kind: z.enum(["declaration", "assertion"]) })
  .strict();
export const NarrativeStorySelectionsSchema = z
  .array(NarrativeStorySelectionSchema)
  .max(200)
  .superRefine((items, check) => {
    if (
      new Set(items.map((item) => `${item.kind}:${item.id}`)).size !==
      items.length
    )
      check.addIssue({ code: "custom", message: "叙事声明不能重复选择。" });
  });
export const NarrativeStoryIndexEntrySchema = z
  .object({
    selection: NarrativeStorySelectionSchema,
    projectId: z.string().uuid(),
    title: z.string(),
    statement: z.string(),
    classification: z.union([
      StoryCausalNodeKindSchema,
      z.enum(["relationship", "cognition"]),
    ]),
    status: z.enum(["pending", "adopted", "discarded"]),
    sourceFingerprint: hash,
    sourceState: z.enum(["current", "stale", "unavailable"]),
    record: StorySourceRecordSchema.optional(),
    retirement: z.enum(["active", "withdrawn", "replaced"]).optional(),
    interpretation: z.enum([
      "author-declared",
      "source-stated",
      "author-inferred",
    ]),
    eligibility: z
      .object({
        state: z.enum(["eligible", "ineligible"]),
        reasons: z.array(z.string()),
      })
      .strict(),
    sourceChapters: z.array(ref),
    sourceScripts: z.array(ref),
    endpoints: z
      .array(
        ref
          .extend({ title: z.string(), kind: StoryCausalNodeKindSchema })
          .strict(),
      )
      .max(2),
    storyOrder: z.number().int().nonnegative().optional(),
    eventTimeline: StoryEventTimelineSchema.optional(),
    relation: StoryCausalEdgeRelationSchema.optional(),
    relationshipEndpoints: z.object({ from: ref, to: ref }).strict().optional(),
    knowledgeState: AudienceKnowledgeValueSchema.optional(),
    cognitionTarget: ref.optional(),
    // Advisory directory metadata only; immutable compiled statements keep
    // the original input subject, including its original audience identity.
    cognitionSubject: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("audience"),
            id: z.string().trim().min(1).max(200),
          })
          .strict(),
        z.object({ kind: z.literal("character"), node: ref }).strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((entry, check) => {
    if (
      entry.eventTimeline &&
      (entry.classification !== "event" ||
        entry.selection.kind !== "declaration")
    )
      check.addIssue({
        code: "custom",
        message: "事件时间标注须来自原事件声明，不从认知顺序或章节目录推断。",
      });
    const hasEndpoint = (ref: { id: string; version: number }) =>
      entry.endpoints.some(
        (node) => node.id === ref.id && node.version === ref.version,
      );
    if (
      (entry.cognitionSubject || entry.cognitionTarget) &&
      (entry.classification !== "cognition" ||
        entry.selection.kind !== "assertion" ||
        entry.storyOrder === undefined ||
        !entry.knowledgeState ||
        !entry.cognitionSubject ||
        !entry.cognitionTarget ||
        !hasEndpoint(entry.cognitionTarget) ||
        (entry.cognitionSubject.kind === "character" &&
          !hasEndpoint(entry.cognitionSubject.node)))
    )
      check.addIssue({
        code: "custom",
        message: "认知主体和对象必须与原声明及实际端点一致。",
      });
    if (
      entry.relationshipEndpoints &&
      (entry.classification !== "relationship" ||
        entry.selection.kind !== "assertion" ||
        !entry.relation ||
        !hasEndpoint(entry.relationshipEndpoints.from) ||
        !hasEndpoint(entry.relationshipEndpoints.to))
    )
      check.addIssue({
        code: "custom",
        message: "关系方向必须绑定原声明的实际端点。",
      });
    if (
      entry.eligibility.state === "eligible" &&
      (entry.status !== "adopted" ||
        entry.sourceState !== "current" ||
        entry.retirement !== "active" ||
        !entry.record ||
        entry.eligibility.reasons.length)
    )
      check.addIssue({
        code: "custom",
        message: "可选声明必须有当前正式采用绑定。",
      });
    for (const refs of [entry.sourceChapters, entry.sourceScripts])
      if (new Set(refs.map((ref) => ref.id)).size !== refs.length)
        check.addIssue({
          code: "custom",
          message: "原来源身份不能重复或混合版本。",
        });
  });
export const NarrativeStoryIndexSchema = z
  .object({
    projectId: z.string().uuid(),
    fingerprint: hash,
    evidencePolicy: z.literal(
      "source-anchored-human-interpretations-not-semantic-proof",
    ),
    entries: z.array(NarrativeStoryIndexEntrySchema).max(20000),
    // Optional only for older owner responses. Absence stays unverified in UI;
    // compilation of immutable selected interpretations never depends on it.
    hierarchy: NarrativeStoryHierarchySchema.optional(),
  })
  .strict()
  .superRefine((value, check) => {
    if (value.hierarchy && value.hierarchy.projectId !== value.projectId)
      check.addIssue({
        code: "custom",
        message: "叙事层级不属于指定原项目。",
      });
  });
export const NarrativeStorySourceBasisSchema = z
  .object({
    selection: NarrativeStorySelectionSchema,
    sourceFingerprint: hash,
    record: StorySourceRecordSchema,
    sourceChapters: z.array(ref),
    sourceScripts: z.array(ref),
    contentHash: hash,
  })
  .strict();
export type NarrativeStorySelection = z.infer<
  typeof NarrativeStorySelectionSchema
>;
export type NarrativeStoryIndexEntry = z.infer<
  typeof NarrativeStoryIndexEntrySchema
>;
export type NarrativeStoryIndex = z.infer<typeof NarrativeStoryIndexSchema>;
export type NarrativeStorySourceBasis = z.infer<
  typeof NarrativeStorySourceBasisSchema
>;

// Separate from the basic paragraph/fact index: declaration validation itself
// reads that index. Never introduce a recursive source-validation graph.
export const KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE = defineServiceContract<{
  catalog(projectId: string): NarrativeStoryIndex;
  compile(
    projectId: string,
    selections: readonly NarrativeStorySelection[],
  ): {
    basis: NarrativeStorySourceBasis[];
    references: AgentContextReference[];
  };
}>({
  id: "knowledge.narrative-story-index.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read", "compile"],
  degradable: true,
});
