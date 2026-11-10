import type {
  NarrativeSummary,
  NarrativeSummaryPage,
  NarrativeSummaryScopes,
  NarrativeSummaryStatusPage,
} from "@dramaip/contracts/knowledge";
import { NarrativeSummaryStatusPageSchema } from "@dramaip/contracts/knowledge";

export interface NarrativeSummariesClient {
  scopes(projectId: string): Promise<NarrativeSummaryScopes>;
  list(
    projectId: string,
    input?: { cursor?: string; limit?: number },
  ): Promise<NarrativeSummaryPage>;
  get(projectId: string, id: string): Promise<NarrativeSummary>;
  summaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<NarrativeSummaryStatusPage>;
}
export function createNarrativeSummariesClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): NarrativeSummariesClient {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-summaries`;
  return {
    scopes: (id) => request(`${path(id)}/scopes`),
    get: (projectId, id) =>
      request(`${path(projectId)}/${encodeURIComponent(id)}`),
    list: (id, input = {}) => {
      const params = new URLSearchParams();
      if (input.cursor) params.set("cursor", input.cursor);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      return request(`${path(id)}${params.size ? `?${params}` : ""}`);
    },
    summaries: async (id, cursor, limit) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit !== undefined) params.set("limit", String(limit));
      const value = NarrativeSummaryStatusPageSchema.parse(
        await request(
          `${path(id)}/summaries${params.size ? `?${params}` : ""}`,
        ),
      );
      if (value.items.some((item) => item.projectId !== id))
        throw new Error("摘要来源状态不属于指定项目，未替换为其他项目。");
      if (
        new Set(value.items.map((item) => item.id)).size !== value.items.length
      )
        throw new Error("摘要来源状态身份重复，尚未核全。");
      return value;
    },
  };
}
