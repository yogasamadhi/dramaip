import {
  ScreenplaySourceSchema,
  ScreenplaySourcePageSchema,
} from "@dramaip/contracts/production";

export function createScreenplaySourcesClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}/screenplay-sources`;
  return {
    get: async (projectId: string, scriptId: string) => {
      const result = ScreenplaySourceSchema.parse(
        await request(`${path(projectId)}/${encodeURIComponent(scriptId)}`),
      );
      if (
        result.projectId !== projectId ||
        result.scriptId !== scriptId ||
        (result.source.state === "available" &&
          new Set(result.source.document.blocks.map((block) => block.id))
            .size !== result.source.document.blocks.length)
      )
        throw new Error("实际已保存剧本来源身份无法核对，未初始化或替换原稿。");
      return result;
    },
    list: async (
      projectId: string,
      options: { cursor?: string; limit?: number } = {},
    ) => {
      const query = new URLSearchParams();
      if (options.cursor) query.set("cursor", options.cursor);
      if (options.limit !== undefined)
        query.set("limit", String(options.limit));
      const result = ScreenplaySourcePageSchema.parse(
        await request(`${path(projectId)}${query.size ? `?${query}` : ""}`),
      );
      if (
        result.projectId !== projectId ||
        result.items.some((item) => item.projectId !== projectId) ||
        new Set(result.items.map((item) => item.scriptId)).size !==
          result.items.length ||
        (result.nextCursor &&
          result.nextCursor !== result.items.at(-1)?.scriptId)
      )
        throw new Error("实际剧本来源目录归属或游标无法核对。");
      return result;
    },
  };
}
export type ScreenplaySourcesClient = ReturnType<
  typeof createScreenplaySourcesClient
>;
