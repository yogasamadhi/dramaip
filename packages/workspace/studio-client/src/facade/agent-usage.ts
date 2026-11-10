import {
  AgentUsageObservationPageSchema,
  type AgentUsageObservationPage,
} from "@dramaip/contracts";

export interface AgentUsageClient {
  list(
    runId: string,
    projectId?: string,
    cursor?: number,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<AgentUsageObservationPage>;
}
export function createAgentUsageClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): AgentUsageClient {
  return {
    list: async (runId, projectId, cursor, limit, signal) => {
      const query = new URLSearchParams();
      if (projectId !== undefined) query.set("projectId", projectId);
      if (cursor !== undefined) query.set("cursor", String(cursor));
      if (limit !== undefined) query.set("limit", String(limit));
      const value = AgentUsageObservationPageSchema.parse(
        await request(
          `/api/v2/agent-runs/${encodeURIComponent(runId)}/usage-observations${query.size ? `?${query}` : ""}`,
          { signal },
        ),
      );
      if (
        value.runId !== runId ||
        value.projectId !== projectId ||
        value.items.some(
          (item) =>
            item.runId !== runId ||
            item.projectId !== projectId ||
            (cursor !== undefined && item.cursor >= cursor) ||
            item.sessionId !== value.items[0]?.sessionId ||
            item.engineKind !== value.items[0]?.engineKind,
        ) ||
        new Set(value.items.map((item) => item.cursor)).size !==
          value.items.length ||
        value.items.some(
          (item, index) =>
            index > 0 && item.cursor >= value.items[index - 1]!.cursor,
        ) ||
        value.observationCount < value.items.length ||
        (value.nextCursor !== undefined &&
          value.nextCursor !== value.items.at(-1)?.cursor)
      )
        throw new Error("用量观测不属于原运行、项目或分页顺序。");
      return value;
    },
  };
}
