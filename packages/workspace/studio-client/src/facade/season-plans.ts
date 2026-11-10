import type {
  SeasonPlan,
  SeasonPlanCatalog,
  SeasonPlanPage,
  SeasonPlanSummaryPage,
} from "@dramaip/contracts/production";
export interface SeasonPlanClient {
  sources(projectId: string): Promise<SeasonPlanCatalog>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<SeasonPlanPage>;
  summaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<SeasonPlanSummaryPage>;
  get(id: string): Promise<SeasonPlan>;
  adopt(id: string, stateVersion: number, key: string): Promise<SeasonPlan>;
  discard(id: string, stateVersion: number, key: string): Promise<SeasonPlan>;
  reorder(
    id: string,
    stateVersion: number,
    episodeIds: string[],
    key: string,
  ): Promise<SeasonPlan>;
}
export function createSeasonPlanClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): SeasonPlanClient {
  const project = (id: string) => `/api/v2/projects/${encodeURIComponent(id)}`;
  const plan = (id: string) => `/api/v2/season-plans/${encodeURIComponent(id)}`;
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
      `${project(id)}/${suffix}${query.size ? `?${query}` : ""}`,
    );
  };
  const write = (
    id: string,
    version: number,
    key: string,
    action: string,
    body: unknown,
  ) =>
    request<SeasonPlan>(`${plan(id)}/${action}`, {
      method: "POST",
      headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  return {
    sources: (id) => request(`${project(id)}/season-plan-sources`),
    get: (id) => request(plan(id)),
    list: (id, cursor, limit) => page(id, "season-plans", cursor, limit),
    summaries: (id, cursor, limit) =>
      page(id, "season-plan-previews", cursor, limit),
    adopt: (id, version, key) =>
      write(id, version, key, "adopt", { confirmed: true }),
    discard: (id, version, key) => write(id, version, key, "discard", {}),
    reorder: (id, version, episodeIds, key) =>
      write(id, version, key, "reorder", { confirmed: true, episodeIds }),
  };
}
