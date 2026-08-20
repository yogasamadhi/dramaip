import { z } from "zod";

export const DELIVERY_RECORD_SERVICE = "delivery.records.v1" as const;

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
