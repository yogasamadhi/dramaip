import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { AuthorIntentCreationRequestSchema } from "./author-intent-creation.js";
import { AuthorIntentStatusSchema } from "./workspace.js";

const uuid = z.string().uuid(),
  version = z.number().int().nonnegative(),
  hash = z.string().regex(/^[a-f0-9]{64}$/u);
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
]);
const request = AuthorIntentCreationRequestSchema.superRefine(
  (value, check) => {
    for (const item of value.context?.chapters ?? [])
      if (item.representation === "paragraphs")
        for (const id of item.paragraphIds)
          if (
            !new RegExp(
              "^" + item.id + "@" + item.version + ":\\d+-\\d+:[a-f0-9]{12}$",
              "u",
            ).test(id)
          )
            check.addIssue({
              code: "custom",
              message: "只保留原章节版本的真实段落身份。",
            });
  },
);
const creation = z
  .object({
    workflowId: uuid,
    sourceSnapshotId: uuid,
    runIds: z.array(uuid).min(1),
    engineKind: z.enum(["codex", "pi", "langgraph"]),
    request,
    references: z
      .array(
        z
          .object({
            sourceKind: z.enum([
              "project",
              "author_intent",
              "chapter",
              "production",
              "knowledge",
            ]),
            sourceId: uuid,
            sourceVersion: version,
            fieldPath: field,
            contentHash: hash,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const WorkspaceProjectLineageReceiptSchema = z
  .object({
    kind: z.literal("author-intent"),
    id: uuid,
    projectId: uuid,
    version: z.number().int().positive(),
    stateVersion: version,
    status: AuthorIntentStatusSchema,
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.enum(["manual", "legacy-project"]),
          projectVersion: version,
        })
        .strict(),
      z
        .object({
          kind: z.literal("ai-generated"),
          projectVersion: version,
          creation,
        })
        .strict(),
    ]),
    baseAdoptedId: uuid.optional(),
    adoptedAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    fingerprints: z
      .object({
        content: z
          .object({
            format: z.literal("derived-original-intent-content-json-bytes-v1"),
            sha256: hash,
          })
          .strict(),
        source: z
          .object({
            format: z.literal("derived-original-intent-source-json-bytes-v1"),
            sha256: hash,
          })
          .strict(),
      })
      .strict(),
    observation: z.literal("saved-author-intent-row-not-full-state-history"),
    semanticVerification: z.literal("unverified"),
  })
  .strict()
  .superRefine((value, check) => {
    if (
      value.source.kind === "ai-generated" &&
      (value.source.creation.request.projectVersion !==
        value.source.projectVersion ||
        value.source.creation.request.baseAdoptedId !== value.baseAdoptedId)
    )
      check.addIssue({
        code: "custom",
        message: "意图须保持原项目版本与原正式比较父身份。",
      });
    if ((value.status === "adopted") !== (value.adoptedAt !== undefined))
      check.addIssue({
        code: "custom",
        message: "采用状态须与实际采用时间一致。",
      });
    if (value.source.kind === "ai-generated") {
      const refs = value.source.creation.references,
        ids = refs.map((ref) =>
          JSON.stringify([
            ref.sourceKind,
            ref.sourceId,
            ref.sourceVersion,
            ref.fieldPath,
          ]),
        );
      if (new Set(ids).size !== ids.length)
        check.addIssue({ code: "custom", message: "原引用不能重复。" });
      const projects = refs.filter((ref) => ref.sourceKind === "project");
      if (
        projects.length !== 1 ||
        projects[0]!.sourceId !== value.projectId ||
        projects[0]!.sourceVersion !== value.source.projectVersion
      )
        check.addIssue({ code: "custom", message: "原项目引用须精确一致。" });
    }
  });
export type WorkspaceProjectLineageReceipt = z.infer<
  typeof WorkspaceProjectLineageReceiptSchema
>;
export const WorkspaceProjectLineagePageSchema = z
  .object({
    items: z.array(WorkspaceProjectLineageReceiptSchema),
    nextCursor: uuid.optional(),
  })
  .strict();
export type WorkspaceProjectLineagePage = z.infer<
  typeof WorkspaceProjectLineagePageSchema
>;
export const WORKSPACE_PROJECT_LINEAGE_SERVICE = defineServiceContract<{
  list(
    projectId: string,
    options: { cursor?: string; limit: number },
  ): WorkspaceProjectLineagePage;
}>({
  id: "workspace.project-lineage.v1",
  owner: "workspace",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
export const WorkspaceProjectPackageLineageSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("available"),
        coverage: z.literal("recorded-workspace-author-intent-rows-only"),
        authorIntents: z.array(WorkspaceProjectLineageReceiptSchema),
      })
      .strict(),
    z.object({ state: z.literal("unavailable") }).strict(),
  ],
);
