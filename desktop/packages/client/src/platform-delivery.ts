import { z, type ZodType } from "zod";
import {
  PlatformMetadataProfileSchema,
  PlatformMetadataVariantSchema,
  PlatformMetadataVariantInputSchema,
  PlatformMetadataPreflightInputSchema,
  PlatformMetadataPreflightSchema,
  PlatformMetadataAdoptInputSchema,
  PlatformMetadataArchiveInputSchema,
  PlatformMetadataArchiveEntrySchema,
  PlatformMetadataReceiptSchema,
  type PlatformMetadataAdoptInput,
  type PlatformMetadataArchiveInput,
  type PlatformMetadataPreflightInput,
} from "@dramaip/contracts/delivery";
import {
  createGeneratedOpenApiClient,
  requestGeneratedApi,
} from "./openapi-client.js";
import { asApiError, StudioClientError } from "./errors.js";
import type { StudioClientOptions } from "./generated.js";

export function createPlatformDeliveryClient(options: StudioClientOptions) {
  const generated = createGeneratedOpenApiClient(options);
  const request = async <T>(
    path: string,
    schema: ZodType<T>,
    init: RequestInit = {},
  ) => {
    init.signal?.throwIfAborted();
    const response = await requestGeneratedApi(generated, path, init);
    init.signal?.throwIfAborted();
    if (!response.response.ok)
      throw new StudioClientError(
        response.response.status,
        asApiError(response.error),
      );
    return schema.parse(response.data);
  };
  const scoped = (path: string, projectId: string) =>
    `${path}?${new URLSearchParams({ projectId: z.string().uuid().parse(projectId) })}`;
  const id = (value: string) =>
    encodeURIComponent(z.string().uuid().parse(value));
  const receipt = async (
    path: string,
    operation: "adopt" | "archive",
    aggregateId: string,
    input: PlatformMetadataAdoptInput | PlatformMetadataArchiveInput,
    key: string,
    signal?: AbortSignal,
  ) => {
    const r = await request(path, PlatformMetadataReceiptSchema, {
      method: "POST",
      signal,
      headers: {
        "Idempotency-Key": z.string().uuid().parse(key),
        "If-Match": `"${"variantVersion" in input ? input.variantVersion : input.sourceFingerprint}"`,
      },
      body: JSON.stringify(input),
    });
    if (
      r.operation !== operation ||
      r.aggregateId !== aggregateId ||
      r.projectId !== input.projectId ||
      r.requestKey !== key ||
      JSON.stringify(r.input) !== JSON.stringify(input)
    )
      throw new Error(
        "Original platform metadata request identity does not match",
      );
    return r;
  };
  return {
    listProfiles: (signal?: AbortSignal) =>
      request(
        "/api/v2/platform-delivery/profiles",
        z.array(PlatformMetadataProfileSchema),
        { signal },
      ),
    listVariants: async (
      adaptationId: string,
      projectId: string,
      signal?: AbortSignal,
    ) => {
      const result = await request(
        scoped(
          `/api/v2/adaptations/${id(adaptationId)}/delivery-variants`,
          projectId,
        ),
        z.array(PlatformMetadataVariantSchema),
        { signal },
      );
      if (
        result.some(
          (r) => r.projectId !== projectId || r.adaptationId !== adaptationId,
        )
      )
        throw new Error("Variant scope does not match");
      return result;
    },
    createVariant: async (
      adaptationId: string,
      input: z.input<typeof PlatformMetadataVariantInputSchema>,
      signal?: AbortSignal,
    ) => {
      const result = await request(
        `/api/v2/adaptations/${id(adaptationId)}/delivery-variants`,
        PlatformMetadataVariantSchema,
        {
          method: "POST",
          signal,
          body: JSON.stringify(PlatformMetadataVariantInputSchema.parse(input)),
        },
      );
      if (result.adaptationId !== adaptationId)
        throw new Error("Variant scope does not match");
      return result;
    },
    adoptVariant: (
      variantId: string,
      input: PlatformMetadataAdoptInput,
      key: string,
      signal?: AbortSignal,
    ) =>
      receipt(
        `/api/v2/delivery-variants/${id(variantId)}/adopt`,
        "adopt",
        variantId,
        PlatformMetadataAdoptInputSchema.parse(input),
        key,
        signal,
      ),
    preflight: async (
      episodeId: string,
      input: PlatformMetadataPreflightInput,
      signal?: AbortSignal,
    ) => {
      const parsed = PlatformMetadataPreflightInputSchema.parse(input),
        result = await request(
          `/api/v2/episodes/${id(episodeId)}/platform-delivery/preflight`,
          PlatformMetadataPreflightSchema,
          { method: "POST", signal, body: JSON.stringify(parsed) },
        );
      if (
        result.episodeId !== episodeId ||
        JSON.stringify(result.input) !== JSON.stringify(parsed)
      )
        throw new Error("Original preflight input does not match");
      return result;
    },
    createArchive: (
      episodeId: string,
      input: PlatformMetadataArchiveInput,
      key: string,
      signal?: AbortSignal,
    ) =>
      receipt(
        `/api/v2/episodes/${id(episodeId)}/platform-deliveries`,
        "archive",
        episodeId,
        PlatformMetadataArchiveInputSchema.parse(input),
        key,
        signal,
      ),
    recoverRequest: async (
      key: string,
      projectId: string,
      signal?: AbortSignal,
    ) => {
      const result = await request(
        scoped(`/api/v2/platform-delivery/requests/${id(key)}`, projectId),
        PlatformMetadataReceiptSchema,
        { signal },
      );
      if (result.requestKey !== key || result.projectId !== projectId)
        throw new Error("Original recovery key does not match");
      return result;
    },
    listArchives: async (
      episodeId: string,
      projectId: string,
      signal?: AbortSignal,
    ) => {
      const result = await request(
        scoped(
          `/api/v2/episodes/${id(episodeId)}/platform-deliveries`,
          projectId,
        ),
        z.array(PlatformMetadataArchiveEntrySchema),
        { signal },
      );
      if (
        result.some(
          (r) => r.projectId !== projectId || r.episodeId !== episodeId,
        )
      )
        throw new Error("Archive scope does not match");
      return result;
    },
    exportArchive: async (
      archiveId: string,
      projectId: string,
      signal?: AbortSignal,
    ) => {
      const result = await request(
        scoped(
          `/api/v2/platform-deliveries/${id(archiveId)}/export`,
          projectId,
        ),
        z
          .object({
            fileName: z.string(),
            mimeType: z.literal("application/json; charset=utf-8"),
            content: z.string(),
          })
          .strict(),
        { signal },
      );
      const archive = PlatformMetadataArchiveEntrySchema.parse(
        JSON.parse(result.content),
      );
      if (archive.id !== archiveId || archive.projectId !== projectId)
        throw new Error("Export scope does not match");
      return result;
    },
  };
}
export type PlatformDeliveryClient = ReturnType<
  typeof createPlatformDeliveryClient
>;
