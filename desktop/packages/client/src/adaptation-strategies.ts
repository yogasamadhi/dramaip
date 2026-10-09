import type {
  AdaptationStrategy,
  AdaptationStrategyCatalog,
} from "@dramaip/contracts/production";
export interface AdaptationStrategyClient {
  sources(projectId: string): Promise<AdaptationStrategyCatalog>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ items: AdaptationStrategy[]; nextCursor?: string }>;
  summaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{
    items: import("@dramaip/contracts/production").AdaptationStrategySummary[];
    nextCursor?: string;
  }>;
  get(id: string): Promise<AdaptationStrategy>;
  adopt(
    id: string,
    version: number,
    optionId: string,
    key: string,
  ): Promise<AdaptationStrategy>;
  discard(
    id: string,
    version: number,
    key: string,
  ): Promise<AdaptationStrategy>;
}
export function createAdaptationStrategyClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): AdaptationStrategyClient {
  const page = <T>(
    id: string,
    suffix: string,
    cursor?: string,
    limit?: number,
  ) => {
    const query = new URLSearchParams();
    if (cursor) query.set("cursor", cursor);
    if (limit !== undefined) query.set("limit", String(limit));
    return request<T>(
      `/api/v2/projects/${encodeURIComponent(id)}/${suffix}${query.size ? `?${query}` : ""}`,
    );
  };
  const write = (
    id: string,
    version: number,
    key: string,
    action: string,
    body: unknown,
  ) =>
    request<AdaptationStrategy>(
      `/api/v2/adaptation-strategies/${encodeURIComponent(id)}/${action}`,
      {
        method: "POST",
        headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
    );
  return {
    sources: (id) =>
      request(
        `/api/v2/projects/${encodeURIComponent(id)}/adaptation-strategy-sources`,
      ),
    list: (id, cursor, limit) =>
      page(id, "adaptation-strategies", cursor, limit),
    summaries: (id, cursor, limit) =>
      page(id, "adaptation-strategy-previews", cursor, limit),
    get: (id) =>
      request(`/api/v2/adaptation-strategies/${encodeURIComponent(id)}`),
    adopt: (id, version, optionId, key) =>
      write(id, version, key, "adopt", { confirmed: true, optionId }),
    discard: (id, version, key) => write(id, version, key, "discard", {}),
  };
}
