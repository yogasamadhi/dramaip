import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentUsageObservationPageSchema,
  type AgentUsageObservationPage,
} from "@dramaip/contracts";
import { createAgentUsageClient } from "../../client/src/agent-usage";
import { AgentUsageObservationView } from "./features/AgentUsagePanel";

function page(): AgentUsageObservationPage {
  return AgentUsageObservationPageSchema.parse({
    format: "agent-usage-observation-page-v1",
    runId: "original-run",
    projectId: "original-project",
    observationCount: 1,
    coverage: "partial-or-unknown",
    billingStatus: "unknown",
    items: [
      {
        format: "agent-usage-observation-v1",
        runId: "original-run",
        sessionId: "original-session",
        projectId: "original-project",
        engineKind: "codex",
        cursor: 3,
        measurementScope: "session-total",
        inputAccounting: "unspecified",
        inputTokens: { status: "reported", value: 0 },
        outputTokens: { status: "unreported" },
        cachedTokens: { status: "invalid" },
        source: "engine-reported",
        runClassification: "unknown",
        billingStatus: "unknown",
        recordedAt: "2026-10-04T00:00:00.000Z",
      },
    ],
  });
}
describe("readonly exact run usage observations", () => {
  test("view shows only actually reported estimates, distinguishes zero and missing currency, and never upgrades legacy or settlement", () => {
    const value = page();
    value.items[0]!.costEstimate = {
      source: "engine-reported-estimate",
      amount: { status: "reported", value: 0 },
      currency: { status: "unreported" },
      billingStatus: "unknown",
    };
    let html = renderToStaticMarkup(
      <AgentUsageObservationView pages={[value]} />,
    );
    expect(html).toContain("引擎报告费用估值：0");
    expect(html).toContain("币种未报告");
    expect(html).toContain("不是报价、账单或结算");
    expect(html).not.toContain("USD");
    value.items[0]!.costEstimate.currency = {
      status: "reported",
      value: "EUR",
    };
    html = renderToStaticMarkup(<AgentUsageObservationView pages={[value]} />);
    expect(html).toContain("EUR");
    const legacy = renderToStaticMarkup(
      <AgentUsageObservationView pages={[page()]} />,
    );
    expect(legacy).toContain("本条没有已记录的费用估值");
    expect(legacy).not.toContain("引擎报告费用估值：0");
  });
  test("SDK binds project, run, order, pagination and strict fields, and sends only a GET", async () => {
    const calls: string[] = [];
    let value: unknown = page();
    const sdk = createAgentUsageClient(async <T,>(path: string) => {
      calls.push(path);
      return value as T;
    });
    await expect(
      sdk.list("original-run", "original-project", undefined, 25),
    ).resolves.toEqual(page());
    expect(calls).toEqual([
      "/api/v2/agent-runs/original-run/usage-observations?projectId=original-project&limit=25",
    ]);
    for (const changed of [
      { ...page(), runId: "newest-run" },
      { ...page(), projectId: "other-project" },
      { ...page(), items: [{ ...page().items[0], runId: "newest-run" }] },
      { ...page(), items: [page().items[0], page().items[0]] },
      { ...page(), nextCursor: 4 },
      {
        ...page(),
        items: [
          {
            ...page().items[0],
            inputTokens: { status: "unreported", value: 0 },
          },
        ],
      },
      { ...page(), items: [{ ...page().items[0], prompt: "private" }] },
      { ...page(), billingStatus: "settled" },
    ]) {
      value = changed;
      await expect(
        sdk.list("original-run", "original-project"),
      ).rejects.toThrow();
    }
    value = page();
    await expect(
      sdk.list("original-run", "original-project", 3),
    ).rejects.toThrow();
    await expect(sdk.list("original-run")).rejects.toThrow();
  });
  test("view separates zero, unreported, invalid and cumulative scope without a fictional total or currency", () => {
    const html = renderToStaticMarkup(
      <AgentUsageObservationView pages={[page()]} />,
    );
    for (const label of [
      "输入 0",
      "输出 未报告",
      "缓存读取 报告值无效",
      "不是本次运行用量",
      "覆盖可能不完整",
      "运行来源分类未知",
      "费用与结算未知",
      "original-run",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain("USD");
    const empty = renderToStaticMarkup(
      <AgentUsageObservationView
        pages={[{ ...page(), observationCount: 0, items: [] }]}
      />,
    );
    expect(empty).toContain("用量未知；不等于零");
    expect(empty).not.toContain("输入 0");
  });
});
