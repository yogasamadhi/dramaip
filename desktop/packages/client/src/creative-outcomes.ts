import {
  CreativeOutcomePageSchema,
  CreativeOutcomeSummarySchema,
  CreativeContinuationGlobalSchema,
  type CreativeContinuationGlobal,
  type CreativeOutcomePage,
  type CreativeOutcomeSummary,
  CreativeExecutionRequestPageSchema,
  CreativeWorkflowExecutionSchema,
  measureCreativeConfigurationFunnel,
  type CreativeConfigurationFunnel,
  type CreativeExecutionRequestPage,
  type CreativeWorkflowExecution,
  measureCreativeDeliveryCoverage,
  canonicalCreativeMetricJSON,
  type CreativeDeliveryCoverage,
  measureCreativeDeliveryWindow,
  type CreativeDeliveryWindow,
} from "@dramaip/contracts/insights";

export interface CreativeOutcomeClient {
  deliveryWindow(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CreativeDeliveryWindow>;
  deliveryCoverage(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CreativeDeliveryCoverage>;
  configurationFunnel(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CreativeConfigurationFunnel>;
  executions(
    projectId: string,
    cursor?: number,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<CreativeExecutionRequestPage>;
  execution(
    projectId: string,
    workflowId: string,
    cursor?: number,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<CreativeWorkflowExecution>;
  continuationSummary(
    signal?: AbortSignal,
  ): Promise<CreativeContinuationGlobal>;
  summary(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CreativeOutcomeSummary>;
  list(
    projectId: string,
    cursor?: number,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<CreativeOutcomePage>;
}
export function createCreativeOutcomeClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): CreativeOutcomeClient {
  const path = (id: string) =>
    `/api/v2/projects/${encodeURIComponent(id)}/creative-outcomes`;
  const readDeliveryCoverage = async (id: string, signal?: AbortSignal) => {
    const check = () => signal?.throwIfAborted();
    check();
    const before = await client.summary(id, signal);
    check();
    if (before.projection.state !== "healthy")
      throw new Error("原投影尚未追平或异常，不能建立完整交付分母。");
    const pages: CreativeOutcomePage[] = [];
    let cursor: number | undefined,
      total = 0;
    do {
      check();
      const page = await client.list(id, cursor, 100, signal);
      check();
      if (
        page.nextCursor !== undefined &&
        (!page.items.length ||
          (cursor !== undefined && page.nextCursor >= cursor))
      )
        throw new Error("原采用交付分页未推进。");
      total += page.items.length;
      if (total > 100_000 || pages.length >= 10_000)
        throw new Error("原采用交付读取超限，不返回部分分母。");
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    const result = measureCreativeDeliveryCoverage(id, {
      projection: before.projection,
      counts: before.counts,
      pages,
    });
    check();
    const head = await client.list(id, undefined, 100, signal);
    check();
    const after = await client.summary(id, signal);
    check();
    const counts = (v: CreativeOutcomeSummary) =>
      v.counts
        .map((c) => [c.kind, c.total])
        .sort(([a], [b]) => String(a).localeCompare(String(b)));
    if (
      canonicalCreativeMetricJSON(head) !==
        canonicalCreativeMetricJSON(pages[0]) ||
      canonicalCreativeMetricJSON(before.projection) !==
        canonicalCreativeMetricJSON(after.projection) ||
      canonicalCreativeMetricJSON(counts(before)) !==
        canonicalCreativeMetricJSON(counts(after))
    )
      throw new Error(
        "原采用交付读取期间变化，请明确重新读取；不显示旧覆盖率。",
      );
    return { coverage: result, asOf: before.asOf };
  };
  const client: CreativeOutcomeClient = {
    deliveryCoverage: async (id, signal) =>
      (await readDeliveryCoverage(id, signal)).coverage,
    deliveryWindow: async (id, signal) => {
      const { coverage, asOf } = await readDeliveryCoverage(id, signal);
      signal?.throwIfAborted();
      return measureCreativeDeliveryWindow(coverage, asOf);
    },
    configurationFunnel: async (id, signal) => {
      const requestPages: CreativeExecutionRequestPage[] = [];
      const workflowPages: {
        workflowId: string;
        pages: CreativeWorkflowExecution[];
      }[] = [];
      let cursor: number | undefined;
      const checkAbort = () => signal?.throwIfAborted();
      const sameCheckpoint = (
        projection: CreativeExecutionRequestPage["projection"],
      ) => {
        const first = requestPages[0]?.projection;
        if (
          first &&
          (first.checkpoint !== projection.checkpoint ||
            first.state !== projection.state)
        )
          throw new Error("原配置漏斗检查点变化；请明确重新读取。");
      };
      do {
        checkAbort();
        const page = await client.executions(id, cursor, 25, signal);
        checkAbort();
        sameCheckpoint(page.projection);
        if (
          page.nextCursor !== undefined &&
          ((cursor !== undefined && page.nextCursor >= cursor) ||
            page.items.length === 0)
        )
          throw new Error("原请求分页没有推进。");
        requestPages.push(page);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      const originals = requestPages.flatMap((p) => p.items);
      if (
        new Set(originals.map((r) => r.record.fact.workflowId)).size !==
        originals.length
      )
        throw new Error("原工作流在分页中重复；不重复读取或补分母。");
      for (const original of originals) {
        const workflowId = original.record.fact.workflowId;
        const pages: CreativeWorkflowExecution[] = [];
        cursor = undefined;
        do {
          checkAbort();
          const page = await client.execution(
            id,
            workflowId,
            cursor,
            25,
            signal,
          );
          checkAbort();
          sameCheckpoint(page.projection);
          if (
            page.facts.nextCursor !== undefined &&
            ((cursor !== undefined && page.facts.nextCursor >= cursor) ||
              page.facts.items.length === 0)
          )
            throw new Error("原工作流分页没有推进。");
          pages.push(page);
          cursor = page.facts.nextCursor;
        } while (cursor !== undefined);
        workflowPages.push({ workflowId, pages });
      }
      // Re-read the original head as a final projection fence. No automatic
      // retry or partial denominator survives a changed/failing checkpoint.
      checkAbort();
      const head = await client.executions(id, undefined, 25, signal);
      checkAbort();
      sameCheckpoint(head.projection);
      if (JSON.stringify(head) !== JSON.stringify(requestPages[0]))
        throw new Error("原请求读取期间变化；请明确重新读取。");
      return measureCreativeConfigurationFunnel(id, {
        requestPages,
        workflowPages,
      });
    },
    executions: async (id, cursor, limit, signal) => {
      const query = new URLSearchParams();
      if (cursor !== undefined) query.set("cursor", String(cursor));
      if (limit !== undefined) query.set("limit", String(limit));
      const value = CreativeExecutionRequestPageSchema.parse(
        await request(
          `${path(id)}/executions${query.size ? `?${query}` : ""}`,
          { signal },
        ),
      );
      if (
        value.projectId !== id ||
        value.items.some(
          (i) => cursor !== undefined && i.record.cursor >= cursor,
        )
      )
        throw new Error("原请求页不属于当前项目或原分页。");
      return value;
    },
    execution: async (id, workflowId, cursor, limit, signal) => {
      const query = new URLSearchParams();
      if (cursor !== undefined) query.set("cursor", String(cursor));
      if (limit !== undefined) query.set("limit", String(limit));
      const value = CreativeWorkflowExecutionSchema.parse(
        await request(
          `${path(id)}/executions/${encodeURIComponent(workflowId)}${query.size ? `?${query}` : ""}`,
          { signal },
        ),
      );
      if (
        value.projectId !== id ||
        value.workflowId !== workflowId ||
        value.facts.items.some(
          (i) => cursor !== undefined && i.record.cursor >= cursor,
        )
      )
        throw new Error("原运行关联不属于当前项目、工作流或原分页。");
      return value;
    },
    continuationSummary: async (signal) =>
      CreativeContinuationGlobalSchema.parse(
        await request("/api/v2/creative-continuations/summary", { signal }),
      ),
    summary: async (id, signal) => {
      const value = CreativeOutcomeSummarySchema.parse(
        await request(`${path(id)}/summary`, { signal }),
      );
      if (value.projectId !== id) throw new Error("结果摘要不属于当前项目。");
      return value;
    },
    list: async (id, cursor, limit, signal) => {
      const query = new URLSearchParams();
      if (cursor !== undefined) query.set("cursor", String(cursor));
      if (limit !== undefined) query.set("limit", String(limit));
      const value = CreativeOutcomePageSchema.parse(
        await request(`${path(id)}${query.size ? `?${query}` : ""}`, {
          signal,
        }),
      );
      if (
        value.projectId !== id ||
        value.items.some((item) => item.projectId !== id) ||
        new Set(value.items.map((item) => item.eventId)).size !==
          value.items.length
      )
        throw new Error("结果回执范围或事件标识不匹配。");
      return value;
    },
  };
  return client;
}
