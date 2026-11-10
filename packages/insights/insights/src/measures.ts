/**
 * Whole-ledger measures the insights page reads in one call: each walks every
 * page of the recorded outcomes, requests or revisions, fences the walk with
 * a second read of the head, and measures with the shared contract functions.
 * A changed checkpoint, a page that does not advance or an oversized ledger
 * fails the read; no partial denominator is ever answered.
 * @module @dramaip/insights-insights/measures
 */
import {
  CreativeExecutionRequestPageSchema,
  CreativeOutcomePageSchema,
  CreativeOutcomeSummarySchema,
  CreativeWorkflowExecutionSchema,
  NovelRevisionEffortPageSchema,
  NovelRevisionEffortResultSchema,
  canonicalCreativeMetricJSON,
  creativeExecutionOperation,
  measureCreativeConfigurationFunnel,
  measureCreativeDeliveryCoverage,
  measureCreativeDeliveryWindow,
  measureCreativeExecution,
  measureNovelRevisionConfigurations,
  type CreativeConfigurationFunnel,
  type CreativeDeliveryCoverage,
  type CreativeDeliveryWindow,
  type CreativeExecutionRequestPage,
  type CreativeExecutionStatistics,
  type CreativeOutcomePage,
  type CreativeOutcomeSummary,
  type CreativeWorkflowExecution,
  type NovelRevisionConfiguration,
  type NovelRevisionEffortPage,
  type NovelRevisionEffortResult,
} from "@dramaip/contracts/insights";
import type { InsightsPageQuery } from "./types.ts";

/** The single-page reads the measures walk. */
export interface OutcomeReads {
  outcomeSummary(projectId: string): Promise<unknown>;
  outcomes(projectId: string, query: InsightsPageQuery): Promise<unknown>;
  executions(projectId: string, query: InsightsPageQuery): Promise<unknown>;
  execution(
    projectId: string,
    workflowId: string,
    query: InsightsPageQuery,
  ): Promise<unknown>;
  revisionEffort(projectId: string, query: InsightsPageQuery): Promise<unknown>;
}

/** A request page with each request's operation named. */
export type CreativeExecutionRequestList = CreativeExecutionRequestPage & {
  /** The operation of each listed request, by workflow id. */
  operations: Record<string, string>;
};

/** One workflow's page of executions, its operation and its run statistics. */
export interface CreativeWorkflowExecutionDetail {
  execution: CreativeWorkflowExecution;
  operation: string;
  statistics: CreativeExecutionStatistics;
}

const query = (cursor: number | string | undefined, limit: number) => ({
  ...(cursor === undefined ? {} : { cursor: String(cursor) }),
  limit,
});

/** The measures over `reads`, one project at a time. */
export function outcomeMeasures(reads: OutcomeReads) {
  const summary = async (
    projectId: string,
  ): Promise<CreativeOutcomeSummary> => {
    const value = CreativeOutcomeSummarySchema.parse(
      await reads.outcomeSummary(projectId),
    );
    if (value.projectId !== projectId)
      throw new Error("结果摘要不属于当前项目。");
    return value;
  };
  const outcomes = async (
    projectId: string,
    cursor: number | undefined,
    limit: number,
  ): Promise<CreativeOutcomePage> => {
    const value = CreativeOutcomePageSchema.parse(
      await reads.outcomes(projectId, query(cursor, limit)),
    );
    if (
      value.projectId !== projectId ||
      value.items.some((item) => item.projectId !== projectId) ||
      new Set(value.items.map((item) => item.eventId)).size !==
        value.items.length
    )
      throw new Error("结果回执范围或事件标识不匹配。");
    return value;
  };
  const executions = async (
    projectId: string,
    cursor: number | undefined,
    limit: number,
  ): Promise<CreativeExecutionRequestPage> => {
    const value = CreativeExecutionRequestPageSchema.parse(
      await reads.executions(projectId, query(cursor, limit)),
    );
    if (
      value.projectId !== projectId ||
      value.items.some(
        (item) => cursor !== undefined && item.record.cursor >= cursor,
      )
    )
      throw new Error("原请求页不属于当前项目或原分页。");
    return value;
  };
  const execution = async (
    projectId: string,
    workflowId: string,
    cursor: number | undefined,
    limit: number,
  ): Promise<CreativeWorkflowExecution> => {
    const value = CreativeWorkflowExecutionSchema.parse(
      await reads.execution(projectId, workflowId, query(cursor, limit)),
    );
    if (
      value.projectId !== projectId ||
      value.workflowId !== workflowId ||
      value.facts.items.some(
        (item) => cursor !== undefined && item.record.cursor >= cursor,
      )
    )
      throw new Error("原运行关联不属于当前项目、工作流或原分页。");
    return value;
  };

  const deliveryCoverageAt = async (projectId: string) => {
    const before = await summary(projectId);
    if (before.projection.state !== "healthy")
      throw new Error("原投影尚未追平或异常，不能建立完整交付分母。");
    const pages: CreativeOutcomePage[] = [];
    let cursor: number | undefined;
    let total = 0;
    do {
      const page = await outcomes(projectId, cursor, 100);
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
    const coverage = measureCreativeDeliveryCoverage(projectId, {
      projection: before.projection,
      counts: before.counts,
      pages,
    });
    const head = await outcomes(projectId, undefined, 100);
    const after = await summary(projectId);
    const counts = (value: CreativeOutcomeSummary) =>
      value.counts
        .map((count) => [count.kind, count.total])
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
    return { coverage, asOf: before.asOf };
  };

  const configurationFunnel = async (
    projectId: string,
  ): Promise<CreativeConfigurationFunnel> => {
    const requestPages: CreativeExecutionRequestPage[] = [];
    const workflowPages: {
      workflowId: string;
      pages: CreativeWorkflowExecution[];
    }[] = [];
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
    let cursor: number | undefined;
    do {
      const page = await executions(projectId, cursor, 25);
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
    const originals = requestPages.flatMap((page) => page.items);
    if (
      new Set(originals.map((item) => item.record.fact.workflowId)).size !==
      originals.length
    )
      throw new Error("原工作流在分页中重复；不重复读取或补分母。");
    for (const original of originals) {
      const workflowId = original.record.fact.workflowId;
      const pages: CreativeWorkflowExecution[] = [];
      cursor = undefined;
      do {
        const page = await execution(projectId, workflowId, cursor, 25);
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
    // The head read again is the projection fence: a changed or failing
    // checkpoint leaves no partial denominator.
    const head = await executions(projectId, undefined, 25);
    sameCheckpoint(head.projection);
    if (JSON.stringify(head) !== JSON.stringify(requestPages[0]))
      throw new Error("原请求读取期间变化；请明确重新读取。");
    return measureCreativeConfigurationFunnel(projectId, {
      requestPages,
      workflowPages,
    });
  };

  const revisionEffort = async (
    projectId: string,
  ): Promise<NovelRevisionEffortResult> => {
    let first: NovelRevisionEffortPage | undefined;
    let cursor: string | undefined;
    let last: string | undefined;
    const items: NovelRevisionEffortPage["items"] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    do {
      const page = NovelRevisionEffortPageSchema.parse(
        await reads.revisionEffort(projectId, query(cursor, 100)),
      );
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
    if (items.length !== first.totalTargets)
      throw new Error("原修订分页不完整，不显示部分或旧结果。");
    return NovelRevisionEffortResultSchema.parse({
      format: "novel-revision-effort-result-v1",
      projectId,
      projection: first.projection,
      totalTargets: first.totalTargets,
      items,
      policy: first.policy,
      modelRevisions: "excluded",
      qualityState: "unverified",
    });
  };

  return {
    /** Each adopted version and whether the same version was later saved. */
    deliveryCoverage: async (
      projectId: string,
    ): Promise<CreativeDeliveryCoverage> =>
      (await deliveryCoverageAt(projectId)).coverage,
    /** The fixed seven-day window over the delivery coverage. */
    deliveryWindow: async (
      projectId: string,
    ): Promise<CreativeDeliveryWindow> => {
      const { coverage, asOf } = await deliveryCoverageAt(projectId);
      return measureCreativeDeliveryWindow(coverage, asOf);
    },
    configurationFunnel,
    revisionEffort,
    /** The chapter revisions grouped by each target's first configuration. */
    revisionConfigurations: async (
      projectId: string,
    ): Promise<NovelRevisionConfiguration> => {
      const revisions = await revisionEffort(projectId);
      const funnel = await configurationFunnel(projectId);
      const requestPages: CreativeExecutionRequestPage[] = [];
      let cursor: number | undefined;
      do {
        const page = await executions(projectId, cursor, 25);
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
        funnel,
        requestPages,
      });
      const fence = await revisionEffort(projectId);
      if (
        canonicalCreativeMetricJSON(revisions) !==
        canonicalCreativeMetricJSON(fence)
      )
        throw new Error("原修订读取期间变化，请明确重新读取；不显示旧分组。");
      return result;
    },
    /** One page of requests, each with its operation named. */
    executionList: async (
      projectId: string,
      cursor: number | undefined,
    ): Promise<CreativeExecutionRequestList> => {
      const page = await executions(projectId, cursor, 25);
      return {
        ...page,
        operations: Object.fromEntries(
          page.items.map((item) => [
            item.record.fact.workflowId,
            creativeExecutionOperation(item),
          ]),
        ),
      };
    },
    /** One page of a workflow's executions with its operation and statistics. */
    executionDetail: async (
      projectId: string,
      workflowId: string,
      cursor: number | undefined,
    ): Promise<CreativeWorkflowExecutionDetail> => {
      const value = await execution(projectId, workflowId, cursor, 25);
      return {
        execution: value,
        operation: creativeExecutionOperation(value.request),
        statistics: measureCreativeExecution(value),
      };
    },
  };
}
