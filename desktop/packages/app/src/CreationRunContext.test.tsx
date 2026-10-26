import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  agentContextManifestJSON,
  type AgentContextSnapshot,
} from "@dramaip/contracts/agent-context";
import {
  CreationExecutionReceiptSchema,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import { createCreationExecutionClient } from "../../client/src/creation-execution";
import { CreationRunContextView } from "./features/CreationRunContextPanel";

const phases = ["generating", "checking", "revising", "rechecking"] as const;
const workflow = {
  id: crypto.randomUUID(),
  version: 3,
  runIds: phases.map(() => crypto.randomUUID()),
  input: {
    projectId: crypto.randomUUID(),
    operation: "chapter",
    engineKind: "codex",
  },
} as CreationWorkflow;
const snapshotIds = phases.map(() => crypto.randomUUID());
function receipt() {
  return CreationExecutionReceiptSchema.parse({
    format: "creation-execution-receipt-v1",
    workflowId: workflow.id,
    projectId: workflow.input.projectId,
    version: workflow.version,
    operation: workflow.input.operation,
    coverage: "exact-workflow-attempt",
    billingStatus: "unknown",
    runs: phases.map((phase, index) => ({
      state: "recorded",
      runId: workflow.runIds[index],
      phase,
      execution: {
        format: "agent-run-execution-v1",
        runId: workflow.runIds[index],
        sessionId: `original-${phase}`,
        projectId: workflow.input.projectId,
        contextSnapshotId: snapshotIds[index],
        engineKind: "codex",
        taskType: `creation_${phase}`,
        status: "completed",
        model: { status: "unrecorded" },
        timing: { status: "unrecorded" },
        source: "persisted-agent-run",
      },
    })),
  });
}
const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
async function snapshot(index = 0): Promise<AgentContextSnapshot> {
  const body = {
    projectId: workflow.input.projectId,
    destination: {
      kind: "local" as const,
      provider: "controlled",
      model: "original-model",
    },
    tokenBudget: 128,
    entries: [
      {
        sourceKind: "chapter" as const,
        sourceId: "original-chapter",
        sourceVersion: 4,
        fieldPath: "/chapters/original-chapter/paragraphs/p-1",
        value: { representation: "paragraphs", content: "原选段落" },
        mode: "always" as const,
        included: true,
        reason: "明确原选择",
        estimatedTokens: 4,
        sensitivity: "project" as const,
      },
      {
        sourceKind: "knowledge" as const,
        sourceId: "excluded",
        sourceVersion: 1,
        fieldPath: "/knowledge/excluded",
        value: "PRIVATE excluded body",
        mode: "never" as const,
        included: false,
        reason: "原隐私拒绝，未纳入",
        estimatedTokens: 0,
        sensitivity: "personal" as const,
      },
    ],
  };
  const finalPrompt = `原${phases[index]}完整提示：原选段落`;
  return {
    ...body,
    id: snapshotIds[index]!,
    previewId: crypto.randomUUID(),
    estimatedTokens: 20,
    finalPrompt,
    finalPromptSha256: await sha256(finalPrompt),
    manifestSha256: await sha256(agentContextManifestJSON(body)),
    createdAt: "2026-10-07T00:00:00.000Z",
  };
}

describe("exact original context for every creation phase", () => {
  test("SDK reads all four original runs independently with GET and the same cancellation signal, rather than first/latest substitution", async () => {
    const originals = await Promise.all(
      phases.map((_, index) => snapshot(index)),
    );
    const calls: { path: string; init?: RequestInit }[] = [];
    const sdk = createCreationExecutionClient(
      async <T,>(path: string, init?: RequestInit) => {
        calls.push({ path, init });
        const index = workflow.runIds.findIndex(
          (id) => path === `/api/v2/agent-runs/${id}/context-snapshot`,
        );
        return (index >= 0 ? originals[index] : receipt()) as T;
      },
    );
    const controller = new AbortController();
    for (const [index, runId] of workflow.runIds.entries())
      await expect(
        sdk.readContext(workflow, runId, controller.signal),
      ).resolves.toEqual(originals[index]);
    expect(calls).toHaveLength(12);
    expect(
      calls
        .filter((call) => call.path.endsWith("/context-snapshot"))
        .map((call) => call.path),
    ).toEqual(
      workflow.runIds.map((id) => `/api/v2/agent-runs/${id}/context-snapshot`),
    );
    expect(
      calls.every(
        (call) =>
          call.init?.signal === controller.signal &&
          !call.init.method &&
          !call.init.body,
      ),
    ).toBe(true);
  });
  test("SDK refuses foreign/first snapshot, same-ID changed prompt or expression bytes, unknown project, invalid original receipt and absent snapshot", async () => {
    const original = await snapshot();
    let value: unknown = original;
    let record: unknown = receipt();
    const sdk = createCreationExecutionClient(
      async <T,>(path: string) =>
        (path.endsWith("/context-snapshot") ? value : record) as T,
    );
    for (const bad of [
      { ...original, id: snapshotIds[1] },
      { ...original, projectId: crypto.randomUUID() },
      { ...original, projectId: undefined },
      { ...original, finalPrompt: "later changed prompt" },
      {
        ...original,
        entries: original.entries.map((entry) => ({
          ...entry,
          value: "later changed body",
        })),
      },
      undefined,
    ]) {
      value = bad;
      await expect(
        sdk.readContext(workflow, workflow.runIds[0]!),
      ).rejects.toThrow();
    }
    value = original;
    record = { ...receipt(), workflowId: crypto.randomUUID() };
    await expect(
      sdk.readContext(workflow, workflow.runIds[0]!),
    ).rejects.toThrow();
  });
  test("missing original run or snapshot remains unknown and cannot trigger a context GET or invent a zero-input snapshot", async () => {
    let record = receipt();
    const calls: string[] = [];
    const sdk = createCreationExecutionClient(async <T,>(path: string) => {
      calls.push(path);
      return record as T;
    });
    await expect(
      sdk.readContext(workflow, crypto.randomUUID()),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    record.runs[0] = { state: "missing", runId: workflow.runIds[0]! };
    await expect(
      sdk.readContext(workflow, workflow.runIds[0]!),
    ).rejects.toThrow("实际输入未知");
    record = receipt();
    const run = record.runs[0]!;
    if (run.state !== "recorded") throw Error("Original fixture required");
    delete run.execution.contextSnapshotId;
    await expect(
      sdk.readContext(workflow, workflow.runIds[0]!),
    ).rejects.toThrow("实际输入未知");
    expect(calls.every((path) => !path.endsWith("/context-snapshot"))).toBe(
      true,
    );
  });
  test("binding replaced during the awaited snapshot read is rejected after a second original receipt observation", async () => {
    const original = await snapshot();
    const record = receipt();
    let reads = 0;
    const sdk = createCreationExecutionClient(async <T,>(path: string) => {
      if (path.endsWith("/context-snapshot")) {
        const run = record.runs[0]!;
        if (run.state !== "recorded") throw Error("Original fixture required");
        run.execution.contextSnapshotId = crypto.randomUUID();
        return original as T;
      }
      reads++;
      return structuredClone(record) as T;
    });
    await expect(
      sdk.readContext(workflow, workflow.runIds[0]!),
    ).rejects.toThrow("读取期间");
    expect(reads).toBe(2);
  });
  test("snapshot view displays exact identity, expressions, exclusions, hashes and estimates without revealing excluded values or certifying full-book reading", async () => {
    const original = await snapshot(3);
    const html = renderToStaticMarkup(
      <CreationRunContextView
        runId={workflow.runIds[3]!}
        snapshot={original}
      />,
    );
    for (const expected of [
      snapshotIds[3]!,
      workflow.runIds[3]!,
      "原rechecking完整提示",
      "原选段落",
      "原隐私拒绝",
      "未纳入",
      "不是实际用量",
      "不是全书章节覆盖率",
      "不证明模型已经读取或理解",
      original.finalPromptSha256,
      original.manifestSha256,
    ])
      expect(html).toContain(expected);
    expect(html).not.toContain("PRIVATE excluded body");
    expect(html).not.toContain("已经读完整本原著");
  });
});
