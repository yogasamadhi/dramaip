import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentExperimentUsageNotice,
  inspirationMemoryStatus,
  experimentExecutionTime,
} from "./features/AgentAuxiliaryUsage";

describe("auxiliary reports do not publish historical guesses or break blinding", () => {
  test("does not expose a supplied run or its read action before reveal, and missing historical reports remain unknown", () => {
    const hidden = renderToStaticMarkup(
      <AgentExperimentUsageNotice
        revealed={false}
        usageRunId="PRIVATE-RUN"
        projectId="PRIVATE-PROJECT"
      />,
    );
    expect(hidden).toContain("明确揭盲后");
    expect(hidden).not.toMatch(/PRIVATE|查看原运行|USD|待厂商结算/u);
    const historical = renderToStaticMarkup(
      <AgentExperimentUsageNotice revealed projectId="project" />,
    );
    expect(historical).toContain("历史计数不补成零");
    expect(historical).not.toContain("查看原运行");
  });
  test("memory UI does not add legacy estimates to a token total or invent missing execution time", () => {
    expect(
      inspirationMemoryStatus({
        id: "job",
        conversationId: "conversation",
        throughTurnCount: 1,
        reason: "manual",
        status: "completed",
        inputTokens: 777,
        outputTokens: 888,
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
      }),
    ).toBe("模型配置未记录 · 用量总量与费用未知");
    expect(experimentExecutionTime(0)).toBe("0.0 秒");
    for (const value of [undefined, -1, NaN, Infinity])
      expect(experimentExecutionTime(value)).toBe("未知");
  });
});
