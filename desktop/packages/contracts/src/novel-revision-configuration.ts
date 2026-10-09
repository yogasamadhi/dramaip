import { z } from "zod";
import {
  CreativeConfigurationFunnelSchema,
  CreativeGeneratingConfigurationSchema,
} from "./creative-configuration-funnel.js";
import { canonicalCreativeMetricJSON } from "./creative-funnel.js";
import { CreativeExecutionRequestPageSchema } from "./creative-executions.js";
import {
  NovelRevisionEffortPageSchema,
  NovelRevisionMeasureSchema,
} from "./novel-revision-effort.js";

export const NovelRevisionEffortResultSchema = z
  .object({
    format: z.literal("novel-revision-effort-result-v1"),
    projectId: NovelRevisionEffortPageSchema.shape.projectId,
    projection: NovelRevisionEffortPageSchema.shape.projection,
    totalTargets: NovelRevisionEffortPageSchema.shape.totalTargets,
    items: z.array(NovelRevisionMeasureSchema),
    policy: NovelRevisionEffortPageSchema.shape.policy,
    modelRevisions: NovelRevisionEffortPageSchema.shape.modelRevisions,
    qualityState: NovelRevisionEffortPageSchema.shape.qualityState,
  })
  .strict()
  .superRefine((v, c) => {
    const ids = v.items.flatMap((r) => r.workflowIds);
    if (
      v.totalTargets !== v.items.length ||
      new Set(ids).size !== ids.length ||
      v.items.some(
        (r, i) => i > 0 && r.targetKey >= v.items[i - 1]!.targetKey,
      ) ||
      v.items.some(
        (r) => r.adoption && r.adoption.cursor > v.projection.checkpoint,
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "Revision results require complete, unique original targets and workflows at one checkpoint.",
      });
  });
export type NovelRevisionEffortResult = z.infer<
  typeof NovelRevisionEffortResultSchema
>;

function summarize(items: z.infer<typeof NovelRevisionMeasureSchema>[]) {
  const values = items.flatMap((r) =>
    r.state === "measured" ? [r.localRevisionCount!] : [],
  );
  return {
    targets: items.length,
    measuredTargets: values.length,
    unknownAdoptedTargets: items.filter((r) => r.state === "unknown").length,
    pendingTargets: items.filter((r) => r.state === "pending").length,
    minimum: values.length ? values.reduce((a, b) => Math.min(a, b)) : null,
    maximum: values.length ? values.reduce((a, b) => Math.max(a, b)) : null,
    mean: values.length
      ? {
          numerator: values.reduce((n, v) => n + BigInt(v), 0n).toString(),
          denominator: values.length,
        }
      : null,
  };
}
const summary = z
  .object({
    targets: z.number().int().positive(),
    measuredTargets: z.number().int().nonnegative(),
    unknownAdoptedTargets: z.number().int().nonnegative(),
    pendingTargets: z.number().int().nonnegative(),
    minimum: z.number().int().nonnegative().nullable(),
    maximum: z.number().int().nonnegative().nullable(),
    mean: z
      .object({
        numerator: z.string().regex(/^(0|[1-9][0-9]*)$/u),
        denominator: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const NovelRevisionConfigurationSchema = z
  .object({
    format: z.literal("novel-revision-configuration-v1"),
    projectId: NovelRevisionEffortResultSchema.shape.projectId,
    projection: NovelRevisionEffortResultSchema.shape.projection,
    recordedTargets: z.number().int().nonnegative(),
    recordedWorkflows: z.number().int().nonnegative(),
    groupingPolicy: CreativeConfigurationFunnelSchema.shape.groupingPolicy,
    revisionPolicy: NovelRevisionEffortResultSchema.shape.policy,
    modelRevisions: z.literal("excluded"),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    groups: z.array(
      z
        .object({
          configuration: CreativeGeneratingConfigurationSchema,
          anchorWorkflowIds: z.array(z.string().uuid()).min(1),
          items: z.array(NovelRevisionMeasureSchema).min(1),
          summary,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((v, c) => {
    const items = v.groups.flatMap((g) => g.items),
      workflows = items.flatMap((r) => r.workflowIds),
      keys = v.groups.map((g) => canonicalCreativeMetricJSON(g.configuration));
    if (
      items.length !== v.recordedTargets ||
      workflows.length !== v.recordedWorkflows ||
      new Set(items.map((r) => r.targetKey)).size !== items.length ||
      new Set(workflows).size !== workflows.length ||
      new Set(keys).size !== keys.length ||
      items.some(
        (r) => r.adoption && r.adoption.cursor > v.projection.checkpoint,
      ) ||
      v.groups.some(
        (g) =>
          canonicalCreativeMetricJSON(g.summary) !==
            canonicalCreativeMetricJSON(summarize(g.items)) ||
          g.anchorWorkflowIds.length !== g.items.length ||
          g.items.some(
            (r, i) =>
              g.anchorWorkflowIds[i] !== r.workflowIds[0] ||
              (i > 0 && r.targetKey >= g.items[i - 1]!.targetKey),
          ),
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "Configuration revision groups must retain exact targets, first requests, unknowns and measured-only arithmetic.",
      });
  });
export type NovelRevisionConfiguration = z.infer<
  typeof NovelRevisionConfigurationSchema
>;

/** Only exact, complete public owner results; no current configuration or model attribution. */
export function measureNovelRevisionConfigurations(
  projectId: string,
  revisionInput: unknown,
  configurationInput: unknown,
): NovelRevisionConfiguration {
  const revisions = NovelRevisionEffortResultSchema.parse(revisionInput),
    source = z
      .object({
        funnel: CreativeConfigurationFunnelSchema,
        requestPages: z.array(CreativeExecutionRequestPageSchema).min(1),
      })
      .strict()
      .parse(configurationInput),
    configurations = source.funnel;
  if (
    revisions.projectId !== projectId ||
    configurations.projectId !== projectId ||
    canonicalCreativeMetricJSON(revisions.projection) !==
      canonicalCreativeMetricJSON(configurations.projection)
  )
    throw new Error("原修订与配置范围或检查点不一致，不显示部分分组。");
  let cursor = Infinity;
  const eventIds = new Set<string>();
  for (const [i, page] of source.requestPages.entries()) {
    if (
      page.projectId !== projectId ||
      canonicalCreativeMetricJSON(page.projection) !==
        canonicalCreativeMetricJSON(revisions.projection) ||
      (page.nextCursor !== undefined) !== i < source.requestPages.length - 1 ||
      (i > 0 && !page.items.length)
    )
      throw new Error("原配置请求范围／分页／检查点不完整。");
    for (const original of page.items) {
      if (
        original.record.cursor >= cursor ||
        original.record.cursor > revisions.projection.checkpoint ||
        eventIds.has(original.record.eventId)
      )
        throw new Error("原请求分页重复或未推进。");
      cursor = original.record.cursor;
      eventIds.add(original.record.eventId);
    }
    if (page.nextCursor !== undefined && page.nextCursor !== cursor)
      throw new Error("原请求分页游标不匹配。");
  }
  const requests = source.requestPages.flatMap((p) => p.items).reverse(),
    workflowIds = requests.map((r) => r.record.fact.workflowId),
    configuredIds = new Set(
      configurations.groups.flatMap((g) => g.workflowIds),
    );
  if (
    new Set(workflowIds).size !== workflowIds.length ||
    workflowIds.length !== configuredIds.size ||
    workflowIds.some((id) => !configuredIds.has(id))
  )
    throw new Error("原配置漏斗与完整原请求身份不一致。");
  const targets = new Map<string, string[]>();
  for (const original of requests)
    if (
      original.family === "creative" &&
      original.record.fact.kind === "request" &&
      original.record.fact.metric === "novel.chapter"
    ) {
      const f = original.record.fact;
      targets.set(f.targetKey, [
        ...(targets.get(f.targetKey) ?? []),
        f.workflowId,
      ]);
    }
  if (
    targets.size !== revisions.totalTargets ||
    revisions.items.some(
      (r) =>
        canonicalCreativeMetricJSON(r.workflowIds) !==
        canonicalCreativeMetricJSON(targets.get(r.targetKey)),
    )
  )
    throw new Error("原修订目标、完整尝试顺序与原请求不一致。");
  const assigned = new Set<string>();
  const groups = configurations.groups.flatMap((g) => {
    if (g.family !== "creative") return [];
    const novel = g.summary.measures.find((m) => m.metric === "novel.chapter");
    const ids = new Set(g.workflowIds),
      items = revisions.items.filter((r) =>
        r.workflowIds.some((id) => ids.has(id)),
      );
    if (
      items.length !== (novel?.requestedTargets ?? 0) ||
      items.flatMap((r) => r.workflowIds).length !==
        (novel?.recordedRequests ?? 0) ||
      items.some(
        (r) =>
          r.workflowIds.some((id) => !ids.has(id)) ||
          !g.anchorWorkflowIds.includes(r.workflowIds[0]!) ||
          assigned.has(r.targetKey),
      )
    )
      throw new Error(
        "原修订目标／尝试与完整配置漏斗不一致，不重分重试或补分母。",
      );
    for (const item of items) assigned.add(item.targetKey);
    return items.length
      ? [
          {
            configuration: g.configuration,
            anchorWorkflowIds: items.map((r) => r.workflowIds[0]!),
            items,
            summary: summarize(items),
          },
        ]
      : [];
  });
  if (assigned.size !== revisions.totalTargets)
    throw new Error("原修订目标未全部对应原请求配置，不返回部分统计。");
  return NovelRevisionConfigurationSchema.parse({
    format: "novel-revision-configuration-v1",
    projectId,
    projection: revisions.projection,
    recordedTargets: revisions.totalTargets,
    recordedWorkflows: revisions.items.flatMap((r) => r.workflowIds).length,
    groupingPolicy: configurations.groupingPolicy,
    revisionPolicy: revisions.policy,
    modelRevisions: "excluded",
    modelEvidence: "unknown",
    qualityState: "unverified",
    groups,
  });
}
