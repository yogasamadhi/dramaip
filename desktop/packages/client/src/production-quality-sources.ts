import {
  ProductionQualitySourceSchema,
  ProductionQualitySourcePageSchema,
} from "@dramaip/contracts/production";

/** Explicit read-only evidence; this does not start or adopt a quality report. */
export function createProductionQualitySourcesClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}/production-quality-sources`;
  return {
    async get(projectId: string, id: string) {
      const value = ProductionQualitySourceSchema.parse(
        await request(`${path(projectId)}/${encodeURIComponent(id)}`),
      );
      if (value.projectId !== projectId || value.id !== id)
        throw new Error(
          "指定实际剧本／场景来源身份无法核对，不更换为最新对象。",
        );
      return value;
    },
    async list(
      projectId: string,
      options: { cursor?: string; limit?: number } = {},
    ) {
      const query = new URLSearchParams();
      if (options.cursor) query.set("cursor", options.cursor);
      if (options.limit !== undefined)
        query.set("limit", String(options.limit));
      const value = ProductionQualitySourcePageSchema.parse(
        await request(`${path(projectId)}${query.size ? `?${query}` : ""}`),
      );
      if (
        value.projectId !== projectId ||
        value.items.some((item) => item.projectId !== projectId) ||
        new Set(value.items.map((item) => item.id)).size !==
          value.items.length ||
        (value.nextCursor && value.nextCursor !== value.items.at(-1)?.id)
      )
        throw new Error("剧本／场景来源目录归属或游标未核全。");
      return value;
    },
  };
}
export type ProductionQualitySourcesClient = ReturnType<
  typeof createProductionQualitySourcesClient
>;
