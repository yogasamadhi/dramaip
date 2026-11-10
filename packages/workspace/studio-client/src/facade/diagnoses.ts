import type {
  AdaptationDiagnosis,
  DiagnosisCatalog,
  DiagnosisPage,
  DiagnosisSummaryPage,
} from "@dramaip/contracts/production";
export interface DiagnosisClient {
  sources(projectId: string): Promise<DiagnosisCatalog>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<DiagnosisPage>;
  summaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<DiagnosisSummaryPage>;
  get(id: string): Promise<AdaptationDiagnosis>;
  adopt(
    id: string,
    stateVersion: number,
    strategyId: string | undefined,
    key: string,
  ): Promise<AdaptationDiagnosis>;
  discard(
    id: string,
    stateVersion: number,
    key: string,
  ): Promise<AdaptationDiagnosis>;
}
export function createDiagnosisClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): DiagnosisClient {
  const project = (id: string) => `/api/v2/projects/${encodeURIComponent(id)}`;
  const diagnosis = (id: string) =>
    `/api/v2/diagnoses/${encodeURIComponent(id)}`;
  return {
    sources: (id) => request(`${project(id)}/diagnosis-sources`),
    list: (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return request(
        `${project(id)}/diagnoses${query.size ? `?${query}` : ""}`,
      );
    },
    get: (id) => request(diagnosis(id)),
    summaries: (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return request(
        `${project(id)}/diagnosis-previews${query.size ? `?${query}` : ""}`,
      );
    },
    adopt: (id, version, strategyId, key) =>
      request(`${diagnosis(id)}/adopt`, {
        method: "POST",
        headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
        body: JSON.stringify({ confirmed: true, strategyId }),
      }),
    discard: (id, version, key) =>
      request(`${diagnosis(id)}/discard`, {
        method: "POST",
        headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
        body: "{}",
      }),
  };
}
