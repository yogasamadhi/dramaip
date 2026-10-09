import { z } from "zod";
import {
  StorySourceLifecycleSchema,
  StorySourceLifecycleSummarySchema,
} from "./story-source-lifecycle.js";
import { defineServiceContract } from "./service-contract.js";
import { StoryCausalNodeKindSchema } from "./creative-intelligence.js";
import type { AgentContextReference } from "./agent-context.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const chapter = {
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().nonnegative(),
  chapterContentHash: hash,
};
/** Explicit author-reviewed story-time coordinates, never derived from chapter order. */
export const StoryEventTimelineSchema = z
  .object({
    storyOrder: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    timeLabel: z.string().trim().min(1).max(240),
    interpretation: z.enum(["source-stated", "author-inferred"]),
  })
  .strict();
export type StoryEventTimeline = z.infer<typeof StoryEventTimelineSchema>;
export const StoryDeclarationSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...chapter,
      kind: z.literal("paragraphs"),
      paragraphIds: z.array(z.string().min(1).max(240)).min(1).max(1000),
    })
    .strict(),
  z
    .object({
      ...chapter,
      kind: z.literal("adopted-fact"),
      recordId: z.string().uuid(),
      recordVersion: z.number().int().nonnegative(),
      workflowId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("screenplay-blocks"),
      scriptId: z.string().uuid(),
      scriptVersion: z.number().int().nonnegative(),
      documentId: z.string().uuid(),
      documentVersion: z.number().int().nonnegative(),
      documentContentHash: hash,
      blockIds: z.array(z.string().uuid()).min(1).max(1000),
    })
    .strict(),
]);
export const StoryDeclarationInputSchema = z
  .object({
    kind: StoryCausalNodeKindSchema,
    title: z.string().trim().min(1).max(240),
    statement: z.string().trim().min(1).max(4000),
    eventTimeline: StoryEventTimelineSchema.optional(),
    sources: z.array(StoryDeclarationSourceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, check) => {
    if (value.eventTimeline && value.kind !== "event")
      check.addIssue({
        code: "custom",
        path: ["eventTimeline"],
        message: "事件时间标注只能绑定实际事件声明，不能代替人物认知顺序。",
      });
    const keys = value.sources.map((source) =>
      source.kind === "screenplay-blocks"
        ? `${source.scriptId}:${source.kind}`
        : `${source.chapterId}:${source.kind}:${source.kind === "adopted-fact" ? source.recordId : "paragraphs"}`,
    );
    if (new Set(keys).size !== keys.length)
      check.addIssue({
        code: "custom",
        path: ["sources"],
        message: "声明来源不能重复；同章段落或同剧本块放在同一来源中。",
      });
    value.sources.forEach((source, index) => {
      if (
        source.kind === "paragraphs" &&
        new Set(source.paragraphIds).size !== source.paragraphIds.length
      )
        check.addIssue({
          code: "custom",
          path: ["sources", index, "paragraphIds"],
          message: "原文段落不能重复。",
        });
      if (
        source.kind === "screenplay-blocks" &&
        new Set(source.blockIds).size !== source.blockIds.length
      )
        check.addIssue({
          code: "custom",
          path: ["sources", index, "blockIds"],
          message: "实际剧本块不能重复。",
        });
    });
  });
export const StoryDeclarationBasisSchema = z
  .object({
    format: z.literal("source-anchored-story-declaration-v1"),
    projectId: z.string().uuid(),
    fingerprint: hash,
    evidencePolicy: z.literal(
      "exact-source-identity-not-semantic-verification",
    ),
    sources: z
      .array(
        z
          .object({
            selection: StoryDeclarationSourceSchema,
            text: z.string().min(1).max(200000),
            quote: z.string().min(1).max(200000),
            quoteHash: hash,
            anchors: z
              .array(
                z.union([
                  z
                    .object({
                      start: z.number().int().nonnegative(),
                      end: z.number().int().positive(),
                      paragraphIds: z.array(z.string()).min(1),
                    })
                    .strict(),
                  z
                    .object({
                      blockId: z.string().uuid(),
                      blockIndex: z.number().int().nonnegative(),
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
                ]),
              )
              .min(1),
          })
          .strict()
          .superRefine((source, check) => {
            const script = source.selection.kind === "screenplay-blocks";
            if (source.anchors.some((anchor) => script !== "blockId" in anchor))
              check.addIssue({
                code: "custom",
                message: "实际剧本块与原文段落锚点不能互换。",
              });
            if (
              script &&
              source.selection.kind === "screenplay-blocks" &&
              JSON.stringify(
                source.anchors.map((anchor) =>
                  "blockId" in anchor ? anchor.blockId : "",
                ),
              ) !== JSON.stringify(source.selection.blockIds)
            )
              check.addIssue({
                code: "custom",
                message: "冻结剧本锚点必须保持实际选择与顺序。",
              });
          }),
      )
      .min(1)
      .max(100),
    policyDependencies: z
      .array(
        z
          .object({
            sourceId: z.string().min(1),
            sourceVersion: z.number().int().nonnegative(),
            fieldPath: z.string().startsWith("/").max(500),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
export const StoryDeclarationSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    status: z.enum(["pending", "adopted", "discarded"]),
    input: StoryDeclarationInputSchema,
    basis: StoryDeclarationBasisSchema,
    adoptedNode: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    lifecycle: StorySourceLifecycleSchema.optional(),
    sourceStatus: z
      .object({
        state: z.enum(["current", "stale", "unavailable"]),
        reasons: z.array(z.string()),
      })
      .strict(),
    etag: z.string().regex(/^"[a-f0-9]{64}"$/u),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const StoryDeclarationSummarySchema = StoryDeclarationSchema.pick({
  id: true,
  projectId: true,
  version: true,
  status: true,
  sourceStatus: true,
  adoptedNode: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  lifecycle: StorySourceLifecycleSummarySchema.optional(),
  title: z.string(),
  kind: StoryCausalNodeKindSchema,
  sourceFingerprint: hash,
});
export const StoryDeclarationPageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(StoryDeclarationSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export const StoryDeclarationAdoptInputSchema = z
  .object({
    sourceFingerprint: hash,
    confirmedSourceReview: z.literal(true),
    confirmedInterpretationReview: z.literal(true),
  })
  .strict();
export type StoryDeclarationInput = z.infer<typeof StoryDeclarationInputSchema>;
export type StoryDeclarationSource = z.infer<
  typeof StoryDeclarationSourceSchema
>;
export type StoryDeclarationBasis = z.infer<typeof StoryDeclarationBasisSchema>;
export type StoryDeclaration = z.infer<typeof StoryDeclarationSchema>;
export type StoryDeclarationPage = z.infer<typeof StoryDeclarationPageSchema>;
export type StoryDeclarationAdoptInput = z.infer<
  typeof StoryDeclarationAdoptInputSchema
>;

export const KNOWLEDGE_STORY_DECLARATION_SERVICE = defineServiceContract<{
  indexRecords(projectId: string): StoryDeclaration[];
  references(projectId: string): AgentContextReference[];
  nodeReference(
    projectId: string,
    nodeId: string,
    nodeVersion: number,
  ): AgentContextReference | undefined;
  isCurrentNode(
    projectId: string,
    nodeId: string,
    nodeVersion: number,
  ): boolean;
}>({
  id: "knowledge.story-declarations.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
