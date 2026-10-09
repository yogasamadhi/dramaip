import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreationExecutionReceiptSchema,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import { createCreationExecutionClient } from "../../client/src/creation-execution";
import { CreationExecutionView } from "./features/CreationExecutionPanel";

const workflow = {
  id: crypto.randomUUID(),
  version: 0,
  runIds: [crypto.randomUUID(), crypto.randomUUID()],
  input: {
    projectId: crypto.randomUUID(),
    operation: "season-plan",
    engineKind: "codex",
  },
} as CreationWorkflow;
function receipt() {
  return CreationExecutionReceiptSchema.parse({
    format: "creation-execution-receipt-v1",
    workflowId: workflow.id,
    version: workflow.version,
    projectId: workflow.input.projectId,
    operation: workflow.input.operation,
    runs: [
      {
        state: "recorded",
        runId: workflow.runIds[0],
        phase: "generating",
        execution: {
          format: "agent-run-execution-v1",
          runId: workflow.runIds[0],
          sessionId: "original-session",
          projectId: workflow.input.projectId,
          taskType: "creation_generating",
          engineKind: "codex",
          status: "completed",
          model: { status: "recorded", modelId: "original-model" },
          timing: {
            status: "measured",
            startedAt: "2026-10-06T00:00:00.000Z",
            completedAt: "2026-10-06T00:00:00.000Z",
            durationMs: 0,
          },
          source: "persisted-agent-run",
        },
      },
      { state: "missing", runId: workflow.runIds[1] },
    ],
    coverage: "exact-workflow-attempt",
    billingStatus: "unknown",
  });
}
describe("exact workflow execution receipts", () => {
  test("SDK accepts only original project/workflow/version/operation/ordered runs/engine, sends GET and abort signal, and refuses private or inconsistent metadata", async () => {
    let value: unknown = receipt();
    const calls: { path: string; init?: RequestInit }[] = [];
    const sdk = createCreationExecutionClient(
      async <T,>(path: string, init?: RequestInit) => {
        calls.push({ path, init });
        return value as T;
      },
    );
    const controller = new AbortController();
    await expect(sdk.read(workflow, controller.signal)).resolves.toEqual(
      receipt(),
    );
    expect(calls[0]).toEqual({
      path: `/api/v2/workflows/creation/${workflow.id}/execution?projectId=${workflow.input.projectId}`,
      init: { signal: controller.signal },
    });
    const r = receipt(),
      actual = r.runs[0]!;
    if (actual.state !== "recorded") throw new Error("原测试阶段记录缺失");
    for (const bad of [
      { ...r, workflowId: crypto.randomUUID() },
      { ...r, projectId: crypto.randomUUID() },
      { ...r, version: 1 },
      { ...r, operation: "chapter" },
      { ...r, sourceWorkflowId: crypto.randomUUID() },
      { ...r, runs: [...r.runs].reverse() },
      { ...r, runs: [actual, actual] },
      {
        ...r,
        runs: [
          { ...actual, execution: { ...actual.execution, engineKind: "pi" } },
          r.runs[1],
        ],
      },
      {
        ...r,
        runs: [
          {
            ...actual,
            execution: {
              ...actual.execution,
              model: { status: "unrecorded", apiKey: "PRIVATE" },
            },
          },
          r.runs[1],
        ],
      },
      {
        ...r,
        runs: [
          {
            ...actual,
            execution: {
              ...actual.execution,
              timing: { ...actual.execution.timing, durationMs: 100 },
            },
          },
          r.runs[1],
        ],
      },
      { ...r, billingStatus: "settled" },
    ]) {
      value = bad;
      await expect(sdk.read(workflow)).rejects.toThrow();
    }
  });
  test("view distinguishes actual zero duration and persisted model from missing phases without invented totals or latest-run fallback", () => {
    const r = receipt();
    const html = renderToStaticMarkup(
      <CreationExecutionView
        receipt={r}
        renderUsage={(runId) => <p>用量原身份 {runId}</p>}
        renderContext={(runId) => <p>上下文原身份 {runId}</p>}
      />,
    );
    expect(html).toContain("original-model");
    expect(html).toContain("0 ms");
    expect(html).toContain("阶段未知");
    expect(html).toContain("模型、时间和用量未知");
    expect(html).toContain("不是跨重试总量");
    expect(html).toContain("费用与结算未知");
    expect(html).not.toContain(`用量原身份 ${workflow.runIds[1]}`);
    expect(html).toContain(`上下文原身份 ${workflow.runIds[0]}`);
    expect(html).not.toContain(`上下文原身份 ${workflow.runIds[1]}`);
    expect(
      renderToStaticMarkup(
        <CreationExecutionView receipt={{ ...r, runs: [] }} />,
      ),
    ).toContain("尚无已分配运行");
  });
});
