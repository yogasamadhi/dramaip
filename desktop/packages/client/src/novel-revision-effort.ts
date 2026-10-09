import {
  NovelRevisionEffortPageSchema,
  NovelRevisionEffortResultSchema,
  measureNovelRevisionConfigurations,
  canonicalCreativeMetricJSON,
  type NovelRevisionConfiguration,
  type NovelRevisionEffortResult,
  type NovelRevisionEffortPage,
  type CreativeExecutionRequestPage,
} from "@dramaip/contracts/insights";
import { createCreativeOutcomeClient } from "./creative-outcomes.js";
export type { NovelRevisionEffortResult } from "@dramaip/contracts/insights";
export interface NovelRevisionEffortClient {
  configurationGroups(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<NovelRevisionConfiguration>;
  read(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<NovelRevisionEffortResult>;
}
export function createNovelRevisionEffortClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): NovelRevisionEffortClient {
  const client: NovelRevisionEffortClient = {
    configurationGroups: async (projectId, signal) => {
      const revisions = await client.read(projectId, signal);
      signal?.throwIfAborted();
      const outcomes = createCreativeOutcomeClient(request),
        configurations = await outcomes.configurationFunnel(projectId, signal);
      signal?.throwIfAborted();
      const requestPages: CreativeExecutionRequestPage[] = [];
      let cursor: number | undefined;
      do {
        const page = await outcomes.executions(projectId, cursor, 25, signal);
        signal?.throwIfAborted();
        if (
          page.nextCursor !== undefined &&
          ((cursor !== undefined && page.nextCursor >= cursor) ||
            !page.items.length)
        )
          throw new Error("原配置请求分页未推进。");
        requestPages.push(page);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      const result = measureNovelRevisionConfigurations(projectId, revisions, {
        funnel: configurations,
        requestPages,
      });
      const fence = await client.read(projectId, signal);
      signal?.throwIfAborted();
      if (
        canonicalCreativeMetricJSON(revisions) !==
        canonicalCreativeMetricJSON(fence)
      )
        throw new Error("原修订读取期间变化，请明确重新读取；不显示旧分组。");
      return result;
    },
    read: async (projectId, signal) => {
      let first: NovelRevisionEffortPage | undefined,
        cursor: string | undefined,
        last: string | undefined;
      const items: NovelRevisionEffortPage["items"] = [],
        cursors = new Set<string>(),
        ids = new Set<string>();
      do {
        signal?.throwIfAborted();
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const page = NovelRevisionEffortPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(projectId)}/creative-outcomes/revision-effort?${query}`,
            { signal },
          ),
        );
        signal?.throwIfAborted();
        if (
          page.projectId !== projectId ||
          (first &&
            (page.projection.checkpoint !== first.projection.checkpoint ||
              page.projection.state !== first.projection.state ||
              page.totalTargets !== first.totalTargets))
        )
          throw new Error("原修订范围或检查点变化，请明确重新读取。");
        first ??= page;
        for (const row of page.items) {
          if (ids.has(row.targetKey) || (last && row.targetKey >= last))
            throw new Error("原修订分页重复或未推进。");
          ids.add(row.targetKey);
          last = row.targetKey;
          items.push(row);
        }
        if (
          page.nextCursor &&
          (cursors.has(page.nextCursor) || !page.items.length)
        )
          throw new Error("原修订分页未推进。");
        if (page.nextCursor) cursors.add(page.nextCursor);
        cursor = page.nextCursor;
        if (items.length > page.totalTargets)
          throw new Error("原修订目标数不一致。");
      } while (cursor);
      if (items.length !== first!.totalTargets)
        throw new Error("原修订分页不完整，不显示部分或旧结果。");
      return NovelRevisionEffortResultSchema.parse({
        format: "novel-revision-effort-result-v1",
        projectId,
        projection: first!.projection,
        totalTargets: first!.totalTargets,
        items,
        policy: first!.policy,
        modelRevisions: "excluded",
        qualityState: "unverified",
      });
    },
  };
  return client;
}
