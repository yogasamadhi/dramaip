import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import {
  ManuscriptRightsSchema,
  ManuscriptReceiptSchema,
} from "./delivery-save.js";
export {
  ManuscriptRightsSchema,
  ManuscriptReceiptSchema,
} from "./delivery-save.js";
export * from "./pilot-package.js";

export const ManuscriptPreviewInputSchema = z
  .object({
    projectVersion: z.number().int().nonnegative(),
    scope: z.enum(["whole-project", "selected-chapters"]),
    chapters: z
      .array(
        z.object({
          id: z.string().uuid(),
          version: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(10_000),
    format: z.enum(["markdown", "json"]),
  })
  .strict();
export const ManuscriptSaveInputSchema = z
  .object({
    version: z.number().int().nonnegative(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    rights: ManuscriptRightsSchema,
  })
  .strict();
export const ManuscriptManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().nonnegative(),
  projectTitle: z.string(),
  scope: z.enum(["whole-project", "selected-chapters"]),
  chapters: z
    .array(
      z.object({
        id: z.string().uuid(),
        version: z.number().int().nonnegative(),
        title: z.string(),
        orderIndex: z.number().int().nonnegative(),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    )
    .min(1),
  format: z.enum(["markdown", "json"]),
  fileName: z.string(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export const ManuscriptRecordSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  manifest: ManuscriptManifestSchema,
  status: z.enum([
    "awaiting-confirmation",
    "saving",
    "saved",
    "canceled",
    "failed",
  ]),
  rights: ManuscriptRightsSchema.optional(),
  receipt: ManuscriptReceiptSchema.optional(),
  sourceState: z.enum(["current", "stale"]),
  sourceIssues: z.array(z.string()),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const ManuscriptPreviewSchema = ManuscriptRecordSchema.extend({
  document: z.object({ content: z.string(), mimeType: z.string() }),
});
export const ManuscriptPageSchema = z.object({
  items: z.array(ManuscriptRecordSchema),
  nextCursor: z.string().optional(),
});
export type ManuscriptPreviewInput = z.infer<
  typeof ManuscriptPreviewInputSchema
>;
export type ManuscriptSaveInput = z.infer<typeof ManuscriptSaveInputSchema>;
export type ManuscriptRecord = z.infer<typeof ManuscriptRecordSchema>;
export type ManuscriptPreview = z.infer<typeof ManuscriptPreviewSchema>;
export type ManuscriptPage = z.infer<typeof ManuscriptPageSchema>;

export const DELIVERY_RECORD_SERVICE =
  defineServiceContract<DeliveryRecordService>({
    id: "delivery.records.v1",
    owner: "delivery",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });

export const DeliveryRecordKindSchema = z.enum([
  "localization",
  "delivery",
  "delivery-variant",
  "platform-archive",
]);
export type DeliveryRecordKind = z.infer<typeof DeliveryRecordKindSchema>;

export const DeliveryRecordSchema = z.object({
  id: z.string().uuid(),
  kind: DeliveryRecordKindSchema,
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  value: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>;

export * from "./platform-metadata.js";

export interface DeliveryRecordService {
  create(
    kind: DeliveryRecordKind,
    input: {
      projectId: string;
      parentId?: string;
      value: Record<string, unknown>;
    },
  ): DeliveryRecord;
  list(
    kind: DeliveryRecordKind,
    filter: { projectId?: string; parentId?: string },
  ): readonly DeliveryRecord[];
  get(id: string): DeliveryRecord | undefined;
  update(
    id: string,
    patch: Record<string, unknown>,
  ): DeliveryRecord | undefined;
  remove(id: string): boolean;
}

export const DeliveryCreativeVariantInputSchema = z.object({
  label: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  coverAssetId: z.string().uuid().optional(),
  source: z.enum(["manual", "ai_draft"]).default("manual"),
});

export const PlatformDeliveryPreflightInputSchema = z.object({
  profileId: z.string().uuid(),
  creativeVariantId: z.string().uuid(),
  manualFieldsConfirmed: z.boolean(),
});

export const DeliveryRecordInputSchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const DeliveryRecordPatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().nonnegative(),
});
