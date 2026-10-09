import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { SavedScreenplayBlockSchema } from "./screenplay-block.js";

const identity = {
  projectId: z.string().uuid(),
  scriptId: z.string().uuid(),
  scriptVersion: z.number().int().nonnegative(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
};
export const ScreenplaySourceDocumentSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    title: z.string().min(1).max(240),
    sourceFormat: z.enum(["native", "fountain", "fdx", "pdf"]),
    blocks: z.array(SavedScreenplayBlockSchema),
    lossReport: z
      .object({
        unsupported: z.array(z.string()),
        warnings: z.array(z.string()),
        preserved: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export const ScreenplaySourceSchema = z
  .object({
    ...identity,
    source: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("available"),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
          document: ScreenplaySourceDocumentSchema,
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
            .max(2000),
        })
        .strict(),
      z
        .object({
          state: z.literal("unavailable"),
          reason: z.enum([
            "saved-document-missing",
            "invalid-saved-document",
            "lineage-unavailable",
          ]),
        })
        .strict(),
    ]),
  })
  .strict();
export const ScreenplaySourceSummarySchema = z
  .object({
    ...identity,
    state: z.enum(["available", "unavailable"]),
  })
  .strict();
export const ScreenplaySourcePageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(ScreenplaySourceSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type ScreenplaySource = z.infer<typeof ScreenplaySourceSchema>;
export type ScreenplaySourcePage = z.infer<typeof ScreenplaySourcePageSchema>;
export const PRODUCTION_SCREENPLAY_SOURCE_SERVICE = defineServiceContract<{
  get(projectId: string, scriptId: string): ScreenplaySource | undefined;
  list(
    projectId: string,
    options?: { cursor?: string; limit?: number },
  ): ScreenplaySourcePage;
}>({
  id: "production.screenplay-sources.v1",
  owner: "production",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
