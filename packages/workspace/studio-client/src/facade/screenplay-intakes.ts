import type {
  ScreenplayIntakePreview,
  ScreenplayIntakeCommit,
} from "@dramaip/contracts/production";

export interface ScreenplayIntakesClient {
  preview(input: {
    previewId: string;
    grantId: string;
  }): Promise<ScreenplayIntakePreview>;
  get(id: string): Promise<ScreenplayIntakePreview>;
  commit(
    id: string,
    etag: string,
    requestKey: string,
    input: ScreenplayIntakeCommit,
  ): Promise<ScreenplayIntakePreview>;
  discard(id: string, etag: string): Promise<ScreenplayIntakePreview>;
}
export function createScreenplayIntakesClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): ScreenplayIntakesClient {
  const path = (id: string) =>
    `/api/v2/screenplay-intakes/${encodeURIComponent(id)}`;
  return {
    preview: (input) =>
      request("/api/v2/screenplay-intakes", {
        method: "POST",
        headers: { "Idempotency-Key": input.previewId },
        body: JSON.stringify(input),
      }),
    get: (id) => request(path(id)),
    commit: (id, etag, requestKey, input) =>
      request(`${path(id)}/commit`, {
        method: "POST",
        headers: { "If-Match": etag, "Idempotency-Key": requestKey },
        body: JSON.stringify(input),
      }),
    discard: (id, etag) =>
      request(path(id), { method: "DELETE", headers: { "If-Match": etag } }),
  };
}
