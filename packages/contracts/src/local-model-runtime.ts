import { z } from "zod";

export const LocalModelRuntimeKindSchema = z.enum(["ollama", "lm_studio"]);

export const LocalModelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  digest: z.string().optional(),
});

export const LocalModelRuntimeSchema = z.object({
  kind: LocalModelRuntimeKindSchema,
  endpointRef: z.string().min(1),
  state: z.enum(["inactive", "active", "unavailable"]),
  version: z.string().optional(),
  models: z.array(LocalModelDescriptorSchema),
  lastHealthAt: z.string().datetime(),
  limitation: z.string().optional(),
});

export type LocalModelRuntimeKind = z.infer<typeof LocalModelRuntimeKindSchema>;
export type LocalModelDescriptor = z.infer<typeof LocalModelDescriptorSchema>;
export type LocalModelRuntime = z.infer<typeof LocalModelRuntimeSchema>;
