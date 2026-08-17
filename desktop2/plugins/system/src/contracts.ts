import { z } from "@hono/zod-openapi";

export const healthSchema = z
  .object({
    status: z.enum(["healthy", "degraded"]),
    apiVersion: z.literal("2"),
    database: z.literal("available"),
    criticalConsumers: z.enum(["healthy", "degraded"]),
    time: z.iso.datetime(),
  })
  .openapi("Health");

export const bootstrapSchema = z
  .object({
    apiVersion: z.literal("2"),
    productName: z.literal("DramaIP Studio"),
    appId: z.literal("com.sdns.dramaip.next"),
    profile: z.string(),
    plugins: z.array(z.string()),
    capabilities: z.object({
      agentEngines: z.literal(true),
      mediaRemoteExecution: z.literal(false),
      cloudReviewSync: z.literal(false),
      localMediaLibrary: z.literal(true),
      localReviewPackages: z.literal(true),
    }),
  })
  .openapi("Bootstrap");

export const diagnosticSchema = z.object({
  pluginId: z.string(),
  component: z.string(),
  status: z.enum(["healthy", "retrying", "degraded"]),
  critical: z.boolean(),
  detail: z.string().optional(),
});

export const diagnosticsSchema = z
  .object({ items: z.array(diagnosticSchema) })
  .openapi("Diagnostics");

export const searchResultSchema = z.object({
  pluginId: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  title: z.string(),
  updatedAt: z.iso.datetime(),
});

export const searchPageSchema = z.object({
  items: z.array(searchResultSchema),
  nextCursor: z.string().optional(),
});

export const backupSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const backupPageSchema = z.object({ items: z.array(backupSchema) });
export const restoreBackupSchema = z
  .object({ confirmation: z.string().trim().min(1).max(300) })
  .strict();
