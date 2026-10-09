import type { z } from "zod";
import type {
  ScreenplayDocument,
  ScreenplayImportPreview,
  ScreenplayImportPreviewInputSchema,
  ScreenplayImportConfirmationSchema,
} from "@dramaip/contracts/production";

export interface ScreenplayImportsClient {
  preview(
    input: z.infer<typeof ScreenplayImportPreviewInputSchema>,
  ): Promise<ScreenplayImportPreview>;
  get(id: string): Promise<ScreenplayImportPreview>;
  commit(
    id: string,
    etag: string,
    confirmation: z.infer<typeof ScreenplayImportConfirmationSchema>,
  ): Promise<ScreenplayDocument>;
  discard(id: string, etag: string): Promise<ScreenplayImportPreview>;
}
export function createScreenplayImportsClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): ScreenplayImportsClient {
  const preview = (id: string) =>
    `/api/v2/screenplay-import-previews/${encodeURIComponent(id)}`;
  return {
    preview: (input) =>
      request("/api/v2/screenplay-import-previews", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (id) => request(preview(id)),
    commit: (id, etag, confirmation) =>
      request(`${preview(id)}/commit`, {
        method: "POST",
        headers: { "If-Match": etag },
        body: JSON.stringify({ previewId: id, confirmation }),
      }),
    discard: (id, etag) =>
      request(preview(id), { method: "DELETE", headers: { "If-Match": etag } }),
  };
}
