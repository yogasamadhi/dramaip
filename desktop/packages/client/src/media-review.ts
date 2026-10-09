import { z, type ZodType } from "zod";
import {
  MediaReviewPreviewSchema,
  MediaReviewReceiptSchema,
  MediaReviewEvidenceSchema,
  MediaReviewCreateInputSchema,
  MediaReviewScopeSchema,
  MediaReviewExportSchema,
  type MediaReviewCreateInput,
  type MediaReviewScope,
} from "@dramaip/contracts/review";
import {
  createGeneratedOpenApiClient,
  requestGeneratedApi,
} from "./openapi-client.js";
import { asApiError, StudioClientError } from "./errors.js";
import type { StudioClientOptions } from "./generated.js";

export function createMediaReviewClient(options: StudioClientOptions) {
  const api = createGeneratedOpenApiClient(options);
  const request = async <T>(
    path: string,
    schema: ZodType<T>,
    init: RequestInit = {},
  ) => {
    init.signal?.throwIfAborted();
    const r = await requestGeneratedApi(api, path, init);
    init.signal?.throwIfAborted();
    if (!r.response.ok)
      throw new StudioClientError(r.response.status, asApiError(r.error));
    return schema.parse(r.data);
  };
  const id = (v: string) => encodeURIComponent(z.string().uuid().parse(v));
  const query = (p: string) =>
    new URLSearchParams({ projectId: z.string().uuid().parse(p) });
  return {
    exportOriginal: async (
      packageId: string,
      scope: MediaReviewScope,
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams(MediaReviewScopeSchema.parse(scope));
      const document = await request(
        `/api/v2/review-packages/${id(packageId)}/media-review-export?${q}`,
        z
          .object({
            fileName: z.string(),
            mimeType: z.literal("application/json; charset=utf-8"),
            content: z.string(),
          })
          .strict(),
        { signal },
      );
      const r = MediaReviewExportSchema.parse(JSON.parse(document.content));
      if (
        r.package.id !== packageId ||
        r.package.projectId !== scope.projectId ||
        r.package.episodeId !== scope.episodeId ||
        document.fileName !== `review-${packageId}-original-nle.json`
      )
        throw new Error("Original review export does not match");
      return document;
    },
    preview: async (
      episodeId: string,
      projectId: string,
      signal?: AbortSignal,
    ) => {
      const r = await request(
        `/api/v2/episodes/${id(episodeId)}/media-review-preview?${query(projectId)}`,
        MediaReviewPreviewSchema,
        { signal },
      );
      if (r.projectId !== projectId || r.episodeId !== episodeId)
        throw new Error("Original review preview scope does not match");
      return r;
    },
    createPackage: async (
      episodeId: string,
      input: MediaReviewCreateInput,
      key: string,
      signal?: AbortSignal,
    ) => {
      const parsed = MediaReviewCreateInputSchema.parse(input);
      const r = await request(
        `/api/v2/episodes/${id(episodeId)}/media-review-packages`,
        MediaReviewReceiptSchema,
        {
          method: "POST",
          signal,
          headers: {
            "Idempotency-Key": z.string().uuid().parse(key),
            "If-Match": `"${parsed.sourceFingerprint}"`,
          },
          body: JSON.stringify(parsed),
        },
      );
      if (
        r.projectId !== parsed.projectId ||
        r.episodeId !== episodeId ||
        r.requestKey !== key ||
        JSON.stringify(r.input) !== JSON.stringify(parsed)
      )
        throw new Error("Original review request does not match");
      return r;
    },
    recoverRequest: async (
      key: string,
      projectId: string,
      signal?: AbortSignal,
    ) => {
      const r = await request(
        `/api/v2/media-review-requests/${id(key)}?${query(projectId)}`,
        MediaReviewReceiptSchema,
        { signal },
      );
      if (r.projectId !== projectId || r.requestKey !== key)
        throw new Error("Original review request does not match");
      return r;
    },
    evidence: async (
      packageId: string,
      scope: MediaReviewScope,
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams(MediaReviewScopeSchema.parse(scope));
      const r = await request(
        `/api/v2/review-packages/${id(packageId)}/delivery-evidence?${q}`,
        MediaReviewEvidenceSchema,
        { signal },
      );
      if (
        r.packageId !== packageId ||
        r.projectId !== scope.projectId ||
        r.episodeId !== scope.episodeId
      )
        throw new Error("Original review evidence scope does not match");
      return r;
    },
  };
}
export type MediaReviewClient = ReturnType<typeof createMediaReviewClient>;
