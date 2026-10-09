import { z } from "zod";
import {
  PlatformMetadataAdoptInputSchema,
  PlatformMetadataArchiveInputSchema,
} from "@dramaip/contracts/delivery";
const fields = {
  key: z.string().uuid(),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid(),
  episodeId: z.string().uuid(),
  aggregateId: z.string().uuid(),
};
export const PlatformMetadataPendingSchema = z
  .discriminatedUnion("operation", [
    z
      .object({
        ...fields,
        operation: z.literal("adopt"),
        input: PlatformMetadataAdoptInputSchema,
      })
      .strict(),
    z
      .object({
        ...fields,
        operation: z.literal("archive"),
        input: PlatformMetadataArchiveInputSchema,
      })
      .strict(),
  ])
  .superRefine((p, c) => {
    if (
      p.input.projectId !== p.projectId ||
      (p.operation === "adopt"
        ? p.input.adaptationId !== p.adaptationId
        : p.aggregateId !== p.episodeId)
    )
      c.addIssue({ code: "custom", message: "Pending scope mismatch" });
  });
export type PlatformMetadataPending = z.infer<
  typeof PlatformMetadataPendingSchema
>;
export const platformMetadataPendingKey = (
  projectId: string,
  adaptationId: string,
  episodeId: string,
) => `dramaip:platform-metadata:${projectId}:${adaptationId}:${episodeId}`;
/** Original opaque request only. No author copy, paths, credentials, platform login or new consent. */
export function readPlatformMetadataPending(
  storage: Pick<Storage, "getItem">,
  projectId: string,
  adaptationId: string,
  episodeId: string,
) {
  const raw = storage.getItem(
    platformMetadataPendingKey(projectId, adaptationId, episodeId),
  );
  if (!raw) return undefined;
  const p = PlatformMetadataPendingSchema.parse(JSON.parse(raw));
  if (
    p.projectId !== projectId ||
    p.adaptationId !== adaptationId ||
    p.episodeId !== episodeId
  )
    throw new Error("Pending scope mismatch");
  return p;
}
