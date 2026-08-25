import { z } from "zod";

export const EXTENSION_PLUGIN_API_VERSION = "1" as const;

export const ExtensionPermissionSchema = z.enum([
  "storage.read",
  "storage.write",
  "events.subscribe",
  "commands.register",
  "ui.contribute",
  "extensions.route",
  "projects.read",
  "projects.write",
  "documents.read",
  "documents.write",
  "assets.read",
  "assets.write",
  "ai.invoke",
  "network.request",
  "notification.show",
]);

const JsonSchemaSchema = z
  .record(z.string(), z.unknown())
  .superRefine((schema, context) => {
    const inspect = (value: unknown, depth: number): void => {
      if (depth > 20) {
        context.addIssue({
          code: "custom",
          message: "JSON Schema is too deep",
        });
        return;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (
          ["$ref", "$dynamicRef", "$recursiveRef", "contentMediaType"].includes(
            key,
          )
        )
          context.addIssue({
            code: "custom",
            message: `Unsupported JSON Schema keyword: ${key}`,
          });
        inspect(child, depth + 1);
      }
    };
    inspect(schema, 0);
  });

const ServerContributionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9.-]{2,100}$/u),
    method: z.enum(["delete", "get", "patch", "post", "put"]),
    path: z
      .string()
      .regex(/^\/[a-zA-Z0-9_./{}-]*$/u)
      .max(200),
    handler: z.string().regex(/^[a-z][a-zA-Z0-9._-]{1,100}$/u),
    requestSchema: JsonSchemaSchema.optional(),
    responseSchema: JsonSchemaSchema,
  })
  .strict();

const UiFieldSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-zA-Z0-9._-]{1,100}$/u),
    label: z.string().min(1).max(100),
    type: z.enum(["boolean", "number", "select", "text", "textarea"]),
    required: z.boolean().optional(),
    options: z.array(z.string().max(100)).max(100).optional(),
  })
  .strict();

export const ExtensionUiContributionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9.-]{2,100}$/u),
    kind: z.enum(["command", "form", "menu", "panel", "settings", "table"]),
    slot: z.enum([
      "project.tools",
      "settings.extensions",
      "shell.commands",
      "workspace.panels",
    ]),
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    icon: z.enum(["box", "command", "file", "settings", "sparkles"]).optional(),
    command: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9._-]{1,100}$/u)
      .optional(),
    fields: z.array(UiFieldSchema).max(100).optional(),
    columns: z.array(z.string().max(100)).max(50).optional(),
  })
  .strict();

const StorageCollectionSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
    schema: JsonSchemaSchema,
    indexes: z
      .array(
        z.object({
          name: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
          path: z.string().regex(/^\$\.[a-zA-Z0-9_.-]+$/u),
          type: z.enum(["boolean", "number", "string"]),
        }),
      )
      .max(20)
      .default([]),
  })
  .strict();

const EventSubscriptionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9.-]{2,100}$/u),
    eventType: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z0-9.-]+\.v\d+$/u),
    handler: z.string().regex(/^[a-z][a-zA-Z0-9._-]{1,100}$/u),
  })
  .strict();

export const ExtensionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u),
    name: z.string().min(1).max(100),
    description: z.string().max(1_000).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
    publisher: z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9.-]{2,100}$/u),
        keyId: z.string().regex(/^[a-zA-Z0-9._-]{3,100}$/u),
      })
      .strict(),
    pluginApi: z.literal("^1"),
    product: z.string().min(1).max(100),
    entrypoint: z.literal("dist/extension.js"),
    activation: z.enum(["lazy", "startup"]),
    permissions: z.array(ExtensionPermissionSchema).max(64),
    networkOrigins: z.array(z.string().url()).max(32).default([]),
    dependencies: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u),
            range: z.string().min(1).max(100),
            optional: z.boolean().default(false),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    serverContributions: z.array(ServerContributionSchema).max(100).default([]),
    eventSubscriptions: z.array(EventSubscriptionSchema).max(100).default([]),
    uiContributions: z
      .array(ExtensionUiContributionSchema)
      .max(100)
      .default([]),
    storage: z
      .object({ collections: z.array(StorageCollectionSchema).max(50) })
      .strict()
      .default({ collections: [] }),
    resources: z
      .object({
        memoryMiB: z.number().int().min(16).max(64).default(64),
        maxConcurrentRequests: z.number().int().min(1).max(4).default(4),
        requestsPerMinute: z.number().int().min(1).max(100).default(100),
      })
      .strict()
      .default({
        memoryMiB: 64,
        maxConcurrentRequests: 4,
        requestsPerMinute: 100,
      }),
  })
  .strict();

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;
export type ExtensionPermission = z.infer<typeof ExtensionPermissionSchema>;
export type ExtensionUiContribution = z.infer<
  typeof ExtensionUiContributionSchema
>;

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  const manifest = ExtensionManifestSchema.parse(value);
  const permissions = new Set(manifest.permissions);
  if (
    manifest.serverContributions.length &&
    !permissions.has("extensions.route")
  )
    throw new Error("Server contributions require extensions.route");
  if (
    manifest.eventSubscriptions.length &&
    !permissions.has("events.subscribe")
  )
    throw new Error("Event subscriptions require events.subscribe");
  if (manifest.uiContributions.length && !permissions.has("ui.contribute"))
    throw new Error("UI contributions require ui.contribute");
  if (
    manifest.uiContributions.some((contribution) => contribution.command) &&
    !permissions.has("commands.register")
  )
    throw new Error("UI commands require commands.register");
  if (manifest.networkOrigins.length && !permissions.has("network.request"))
    throw new Error("Network origins require network.request");
  const ids = [
    ...manifest.serverContributions.map((entry) => `server:${entry.id}`),
    ...manifest.eventSubscriptions.map((entry) => `event:${entry.id}`),
    ...manifest.uiContributions.map((entry) => `ui:${entry.id}`),
    ...manifest.storage.collections.map((entry) => `storage:${entry.name}`),
  ];
  if (new Set(ids).size !== ids.length)
    throw new Error("Extension contribution identifiers must be unique");
  return manifest;
}
