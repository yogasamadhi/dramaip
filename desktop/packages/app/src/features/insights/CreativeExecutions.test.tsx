import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreativeWorkflowExecutionSchema,
  CreativeExecutionRequestPageSchema,
  measureCreativeExecution,
  type CreativeWorkflowExecution,
} from "@dramaip/contracts/insights";
import { createCreativeOutcomeClient } from "../../../../client/src/creative-outcomes";
import { creativeExecutionLedgerFixture } from "../../../../../tests/fixtures/creative-execution-ledger";
import {
  CreativeWorkflowExecutionView,
  CreativeExecutionStatisticsView,
} from "./CreativeExecutions";

const clone = (value: CreativeWorkflowExecution) => structuredClone(value);
test("A07 SDK uses scoped GETs and abort signals, preserves immutable request pagination and refuses foreign workflows", async () => {
  const detail = creativeExecutionLedgerFixture();
  let value: unknown = detail;
  const controller = new AbortController();
  const calls: { path: string; init?: RequestInit }[] = [];
  const sdk = createCreativeOutcomeClient(
    async <T,>(path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return value as T;
    },
  );
  expect(
    await sdk.execution(
      detail.projectId,
      detail.workflowId,
      undefined,
      25,
      controller.signal,
    ),
  ).toEqual(detail);
  expect(calls[0]).toEqual({
    path: `/api/v2/projects/${detail.projectId}/creative-outcomes/executions/${detail.workflowId}?limit=25`,
    init: { signal: controller.signal },
  });
  await expect(
    sdk.execution(detail.projectId, crypto.randomUUID()),
  ).rejects.toThrow();
  await expect(
    sdk.execution(crypto.randomUUID(), detail.workflowId),
  ).rejects.toThrow();
  await expect(
    sdk.execution(detail.projectId, detail.workflowId, 3),
  ).rejects.toThrow();
  value = CreativeExecutionRequestPageSchema.parse({
    projectId: detail.projectId,
    historyPolicy: "recorded-original-requests-only",
    projection: detail.projection,
    items: [detail.request],
  });
  expect((await sdk.executions(detail.projectId)).items).toHaveLength(1);
  await expect(sdk.executions(detail.projectId, 1)).rejects.toThrow();
  value = { ...(value as object), items: [detail.request, detail.request] };
  await expect(sdk.executions(detail.projectId)).rejects.toThrow();
});
test("A07 schema and SDK reject leaked bodies, changed request lineage, lost phase usage and cumulative-page identity swaps", async () => {
  const detail = creativeExecutionLedgerFixture();
  const changes: ((value: any) => void)[] = [
    (v) => {
      v.request.record.fact.workflowId = crypto.randomUUID();
    },
    (v) => {
      v.request.record.fact.kind = "candidate-ready";
    },
    (v) => {
      v.execution.receipt.operation = "episode";
    },
    (v) => {
      v.execution.receipt.sourceWorkflowId = crypto.randomUUID();
    },
    (v) => {
      v.execution.receipt.runs[0].execution.finalPrompt = "PRIVATE";
    },
    (v) => {
      v.execution.usage.pop();
    },
    (v) => {
      v.execution.usage[0].page.runId = crypto.randomUUID();
    },
    (v) => {
      v.execution.usage[0].page.items[0].sessionId = "foreign-session";
    },
    (v) => {
      v.execution.usage[0].page.items[0].engineKind = "pi";
    },
    (v) => {
      v.execution.usage[0].page.items[0].projectId = crypto.randomUUID();
    },
    (v) => {
      v.execution.usage[0].page.items[0].inputTokens = {
        status: "unreported",
        value: 0,
      };
    },
    (v) => {
      v.execution.usage[0].page.items.push(v.execution.usage[0].page.items[0]);
    },
    (v) => {
      v.execution.usage[0].page.nextCursor = 3;
    },
    (v) => {
      v.facts.items[0].record.workflowId = crypto.randomUUID();
    },
    (v) => {
      v.facts.items[0].record.modelEvidence = "real-model";
    },
    (v) => {
      v.facts.items.reverse();
    },
    (v) => {
      v.facts.nextCursor = 3;
    },
    (v) => {
      v.aggregationPolicy = "sum";
    },
    (v) => {
      v.billingStatus = "settled";
    },
  ];
  for (const change of changes) {
    const value = clone(detail);
    change(value);
    expect(CreativeWorkflowExecutionSchema.safeParse(value).success).toBe(
      false,
    );
    const sdk = createCreativeOutcomeClient(async <T,>() => value as T);
    await expect(
      sdk.execution(detail.projectId, detail.workflowId),
    ).rejects.toThrow();
  }
});
test("A07 normal view keeps all four phase IDs, original requested model, formal versions and zero/missing/invalid distinct without totals or certification", () => {
  const value = creativeExecutionLedgerFixture();
  const html = renderToStaticMarkup(
    <CreativeWorkflowExecutionView value={value} />,
  );
  expect(html).toContain(value.workflowId);
  for (const text of [
    "生成",
    "检查",
    "修订",
    "复检",
    "输入 0",
    "输出 未报告",
    "缓存读取 报告值无效",
    "不是本次运行用量",
    "引擎报告费用估值：0",
    "EUR",
    "请求配置",
    "模型来源未知",
    "质量未核验",
    "没有汇总 Token",
    "正式版本",
    "1000 毫秒",
  ])
    expect(html).toContain(text);
  if (value.execution.state !== "recorded")
    throw Error("fixture receipt absent");
  for (const run of value.execution.receipt.runs)
    expect(html).toContain(run.runId);
  expect(html).not.toContain("USD");
  expect(html).not.toContain("已结算");
});
test("A07 view never turns missing execution, unavailable capabilities or failed original reads into zero or newest success", () => {
  for (const state of ["missing", "unavailable", "read-failed"] as const) {
    const value = creativeExecutionLedgerFixture();
    value.execution = { state };
    const html = renderToStaticMarkup(
      <CreativeWorkflowExecutionView value={value} />,
    );
    expect(html).toContain(
      state === "missing"
        ? "原记录缺失"
        : state === "unavailable"
          ? "暂不可用"
          : "原记录读取失败",
    );
    expect(html).not.toContain("输入 0");
    expect(html).not.toContain("阶段耗时：0");
  }
  const value = creativeExecutionLedgerFixture();
  if (value.execution.state !== "recorded")
    throw Error("fixture receipt absent");
  value.execution.usage = value.execution.usage.map((u) => ({
    state: "read-failed",
    runId: u.runId,
  }));
  const html = renderToStaticMarkup(
    <CreativeWorkflowExecutionView value={value} />,
  );
  expect(html).toContain("原记录读取失败");
  expect(html).not.toContain("输入 0");
});

const recorded = (value: CreativeWorkflowExecution) => {
  if (value.execution.state !== "recorded") throw Error("receipt absent");
  return value.execution;
};
const measured = (value: CreativeWorkflowExecution) => {
  const result = measureCreativeExecution(value);
  if (result.state !== "recorded") throw Error("statistics absent");
  return result;
};
test("A07 exact-attempt statistics group original engine/model/provider/profile, preserve IDs and do not depend on usage or adoption pages", () => {
  const value = creativeExecutionLedgerFixture(),
    before = clone(value);
  const result = measured(value);
  expect(result).toMatchObject({
    runCount: 4,
    recordedRunCount: 4,
    missingRunIds: [],
    modelEvidence: "unknown",
    scope: "exact-workflow-attempt",
    revisionRunIds: [recorded(value).receipt.runs[2]!.runId],
    groups: [
      {
        timing: {
          measuredCount: 4,
          inProgressCount: 0,
          unrecordedCount: 0,
          invalidCount: 0,
          minDurationMs: 1000,
          maxDurationMs: 1000,
        },
      },
    ],
  });
  expect(result.groups).toHaveLength(1);
  expect(result.groups.flatMap((g) => g.runs.map((r) => r.runId))).toEqual(
    recorded(value).receipt.runs.map((r) => r.runId),
  );
  expect(value).toEqual(before);
  value.facts = { items: [value.request] };
  recorded(value).usage = recorded(value).usage.map((u) => ({
    state: "read-failed",
    runId: u.runId,
  }));
  expect(measured(value)).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(
    /observationCount|inputTokens|totalTokens|totalCost|adoptionRate|qualityState|currency/u,
  );
});
test("A07 configuration grouping separates engines, missing IDs, profile/provider changes and delimiter-bearing model IDs", () => {
  const value = creativeExecutionLedgerFixture();
  const runs = recorded(value).receipt.runs;
  const configured = runs.map((r) => {
    if (r.state !== "recorded") throw Error("run absent");
    return r;
  });
  for (const run of configured) {
    if (run.execution.model.status !== "recorded") throw Error("model absent");
    run.execution.model.profileId = "original-profile";
  }
  for (const key of ["providerId", "profileId", "modelId"] as const) {
    const changed = clone(value),
      run = recorded(changed).receipt.runs[1]!;
    if (run.state !== "recorded" || run.execution.model.status !== "recorded")
      throw Error("model absent");
    run.execution.model[key] = "different";
    expect(measured(changed).groups).toHaveLength(2);
    delete run.execution.model[key];
    if (key !== "modelId") expect(measured(changed).groups).toHaveLength(2);
  }
  configured[1]!.execution.engineKind = "pi";
  recorded(value).usage[1] = {
    state: "unavailable",
    runId: configured[1]!.runId,
  };
  expect(measured(value).groups).toHaveLength(2);
  configured[0]!.execution.model = {
    status: "recorded",
    modelId: "a|b",
    providerId: "c",
  };
  configured[1]!.execution.engineKind = "codex";
  configured[1]!.execution.model = {
    status: "recorded",
    modelId: "a",
    providerId: "b|c",
  };
  configured[2]!.execution.model = { status: "invalid" };
  configured[3]!.execution.model = { status: "unrecorded" };
  expect(measured(value).groups).toHaveLength(4);
  const html = renderToStaticMarkup(
    <CreativeExecutionStatisticsView value={value} />,
  );
  expect(html).toContain("原模型配置无效");
  expect(html).toContain("原模型配置未记录");
});
test("A07 measured zero, invalid, unrecorded and active timing keep explicit denominators without wall-clock or successful-run totals", () => {
  const value = creativeExecutionLedgerFixture(),
    runs = recorded(value).receipt.runs;
  if (runs.some((r) => r.state !== "recorded")) throw Error("run absent");
  const executions = runs.map((r) => {
    if (r.state !== "recorded") throw Error("run absent");
    return r.execution;
  });
  const startedAt = "2026-10-07T00:00:00.000Z";
  executions[0]!.status = "failed";
  executions[0]!.timing = {
    status: "measured",
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
  };
  executions[1]!.timing = { status: "invalid" };
  executions[2]!.timing = { status: "unrecorded" };
  executions[3]!.status = "running";
  executions[3]!.timing = { status: "in-progress", startedAt };
  expect(measured(value).groups[0]!.timing).toEqual({
    measuredCount: 1,
    inProgressCount: 1,
    unrecordedCount: 1,
    invalidCount: 1,
    minDurationMs: 0,
    maxDurationMs: 0,
  });
  expect(measured(value).groups[0]!.runs[0]!.status).toBe("failed");
  executions[0]!.timing = { status: "unrecorded" };
  expect(measured(value).groups[0]!.timing).toMatchObject({
    measuredCount: 0,
    minDurationMs: null,
    maxDurationMs: null,
  });
  expect(
    renderToStaticMarkup(<CreativeExecutionStatisticsView value={value} />),
  ).toContain("已知阶段耗时范围 未知");
});
test("A07 missing run identities and absent/read-failed receipts cannot fabricate phase/configuration/timing denominators", () => {
  const value = creativeExecutionLedgerFixture(),
    execution = recorded(value),
    id = execution.receipt.runs[2]!.runId;
  execution.receipt.runs[2] = { state: "missing", runId: id };
  execution.usage = execution.usage.filter((u) => u.runId !== id);
  expect(measured(value)).toMatchObject({
    runCount: 4,
    recordedRunCount: 3,
    missingRunIds: [id],
    revisionRunIds: [],
    groups: [{ timing: { measuredCount: 3 } }],
  });
  execution.receipt.runs = [];
  execution.usage = [];
  expect(measured(value)).toMatchObject({
    runCount: 0,
    recordedRunCount: 0,
    groups: [],
  });
  for (const state of ["missing", "unavailable", "read-failed"] as const) {
    value.execution = { state };
    expect(measureCreativeExecution(value)).toEqual({
      format: "creative-execution-statistics-v1",
      projectId: value.projectId,
      workflowId: value.workflowId,
      scope: "exact-workflow-attempt",
      modelEvidence: "unknown",
      state,
    });
    expect(
      renderToStaticMarkup(<CreativeExecutionStatisticsView value={value} />),
    ).toContain("没有统计分母");
  }
});
test("A07 statistic derivation revalidates exact original scope and timing, rejects corrupt metadata without echoing it", () => {
  for (const change of [
    (v: any) => {
      v.workflowId = crypto.randomUUID();
    },
    (v: any) => {
      v.execution.receipt.runs[0].execution.timing.durationMs = 999;
    },
    (v: any) => {
      v.execution.receipt.runs[0].execution.model.finalPrompt = "PRIVATE";
    },
    (v: any) => {
      v.execution.receipt.runs[1] = v.execution.receipt.runs[0];
    },
  ]) {
    const value = clone(creativeExecutionLedgerFixture());
    change(value);
    expect(() => measureCreativeExecution(value)).toThrow(
      "原工作流统计归属无法核对",
    );
  }
});
test("A07 configuration statistics use the original response page while the view renders more than 100 separately validated historical facts", () => {
  const value = creativeExecutionLedgerFixture();
  const history = Array.from({ length: 101 }, (_, i) => {
    const item = structuredClone(value.request);
    item.record.eventId = crypto.randomUUID();
    item.record.cursor = 102 - i;
    return item;
  });
  const html = renderToStaticMarkup(
    <CreativeWorkflowExecutionView value={value} history={history} />,
  );
  expect(html.match(/原请求配置组 1/g)).toHaveLength(1);
  for (const item of history) expect(html).toContain(item.record.eventId);
});
