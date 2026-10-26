import { describe, expect, it } from "vitest";
import type { StudioClient } from "@dramaip/client";
import type { ProviderActionPreview, Task } from "@dramaip/contracts/product";
import {
  providerEstimate,
  providerReviewIdentity,
  providerReviewStatusLabel,
  readProviderActionReview,
  readAssistantProviderReview,
  requireUnchangedProviderReview,
} from "./provider-action-review";
import {
  readActualTaskResult,
  readTaskConfirmationContext,
  taskConfirmationKey,
  taskResultReferenceKey,
} from "./task-confirmation-context";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProject = "10000000-0000-4000-8000-000000000002";
const taskId = "20000000-0000-4000-8000-000000000001";
const otherTask = "20000000-0000-4000-8000-000000000002";
const id = "30000000-0000-4000-8000-000000000001";
function preview(
  patch: Partial<ProviderActionPreview> = {},
): ProviderActionPreview {
  return {
    id,
    projectId,
    taskId,
    kind: "image",
    providerId: "40000000-0000-4000-8000-000000000001",
    parameters: { prompt: "actual parameters" },
    estimatedCost: 0,
    currency: "CNY",
    status: "pending",
    createdAt: "2026-10-03T00:00:00.000Z",
    ...patch,
  };
}
function task(patch: Partial<Task> = {}): Task {
  return {
    id: taskId,
    projectId,
    kind: "image-generation",
    status: "succeeded",
    attentionStatus: "open",
    resultStatus: "pending",
    title: "actual task",
    progress: 1,
    result: { providerActionPreviewId: id },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...patch,
  };
}
function reader(
  options: {
    provider?: ProviderActionPreview;
    tasks?: Task[];
    workflow?: Record<string, unknown>;
    chapter?: Record<string, unknown>;
    revision?: Record<string, unknown>;
    change?: Record<string, unknown>;
  } = {},
) {
  return {
    projects: { get: async (requested: string) => ({ id: requested }) },
    tasks: { list: async () => options.tasks ?? [task()] },
    providerActionPreviews: { get: async () => options.provider ?? preview() },
    creation: {
      get: async () =>
        options.workflow ?? { id: "workflow", taskId, input: { projectId } },
    },
    chapters: {
      get: async () =>
        options.chapter ?? { id: "chapter", projectId, version: 1 },
    },
    revisions: {
      get: async () =>
        options.revision ?? {
          id: "revision",
          chapterId: "chapter",
          baseVersion: 1,
          status: "pending",
        },
    },
    changePreviews: {
      get: async () =>
        options.change ?? {
          id: "change",
          projectId,
          taskId,
          status: "pending",
        },
    },
  } as unknown as StudioClient;
}

describe("actual task and provider review", () => {
  it("never labels provider acceptance as adopted content or a settled bill", () => {
    expect(providerReviewStatusLabel("executed")).toBe(
      "已创建任务（账单未知）",
    );
    expect(providerReviewStatusLabel("discarded")).toBe(
      "已放弃（不证明无历史费用）",
    );
    for (const status of [
      "pending",
      "executed",
      "discarded",
      "expired",
    ] as const)
      expect(providerReviewStatusLabel(status)).not.toMatch(
        /已应用|已采用|已结算/,
      );
  });
  it("requires actual assistant conversation, run and original task before exposing provider controls", async () => {
    const conversationId = "50000000-0000-4000-8000-000000000001";
    const runId = "60000000-0000-4000-8000-000000000001";
    const actual = preview({ sessionId: conversationId, runId });
    const detail = {
      conversation: { id: conversationId, projectId },
      runs: [{ id: runId, sessionId: conversationId, taskId }],
      providerActionPreviews: [actual],
    };
    const client = (patch: Record<string, unknown> = {}) =>
      ({
        ...reader({ provider: actual }),
        assistantConversations: { get: async () => ({ ...detail, ...patch }) },
      }) as unknown as StudioClient;
    expect(
      await readAssistantProviderReview(client(), {
        id,
        projectId,
        conversationId,
      }),
    ).toEqual({ task: task(), preview: actual });
    for (const patch of [
      { conversation: { id: conversationId, projectId: otherProject } },
      { runs: [] },
      { runs: [{ id: runId, sessionId: "foreign", taskId }] },
      { providerActionPreviews: [] },
    ])
      await expect(
        readAssistantProviderReview(client(patch), {
          id,
          projectId,
          conversationId,
        }),
      ).rejects.toThrow("绑定未核全");
    await expect(
      readAssistantProviderReview(client(), { id, conversationId }),
    ).rejects.toThrow("绑定未核全");
  });
  it("does not turn missing amount or currency into zero USD", () => {
    for (const value of [
      {},
      { estimatedCost: 0 },
      { estimatedCost: 1, currency: "" },
      { estimatedCost: 1, currency: "  " },
      { estimatedCost: Number.NaN, currency: "CNY" },
      { estimatedCost: Infinity, currency: "CNY" },
      { estimatedCost: -1, currency: "CNY" },
    ]) {
      expect(providerEstimate(value).known).toBe(false);
      expect(providerEstimate(value).label).not.toContain("USD");
    }
    expect(providerEstimate({ estimatedCost: 0, currency: "CNY" })).toEqual({
      known: true,
      label: "0.0000 CNY",
    });
  });
  it("canonicalizes memory-only review identity without ignoring parameters", () => {
    expect(
      providerReviewIdentity(preview({ parameters: { b: 2, a: 1 } })),
    ).toBe(providerReviewIdentity(preview({ parameters: { a: 1, b: 2 } })));
    expect(() =>
      requireUnchangedProviderReview(preview(), preview()),
    ).not.toThrow();
    for (const patch of [
      { parameters: { prompt: "changed" } },
      { estimatedCost: 2 },
      { currency: "USD" },
      { status: "executed" as const },
      { estimatedCost: undefined },
      { currency: undefined },
    ])
      expect(() =>
        requireUnchangedProviderReview(preview(patch), preview()),
      ).toThrow("未执行原确认");
  });
  it("reads actual provider parameters instead of embedded snapshots", async () => {
    const value = await readActualTaskResult(
      reader(),
      task({
        result: {
          providerActionPreview: preview({
            parameters: { prompt: "stale" },
            currency: "USD",
          }),
        },
      }),
    );
    expect(value.result).toEqual({ providerActionPreview: preview() });
  });
  it.each([
    { projectId: otherProject },
    { id: "30000000-0000-4000-8000-000000000002" },
    { taskId: otherTask },
  ])("rejects incorrect pending provider owner %j", async (patch) => {
    await expect(
      readProviderActionReview(reader({ provider: preview(patch) }), {
        id,
        projectId,
        task: task(),
      }),
    ).rejects.toThrow("归属不符");
  });
  it("requires an authoritative task pointer and rejects conflicting pointers", async () => {
    for (const result of [
      {},
      { providerActionPreviewId: "foreign" },
      { providerActionPreviewId: id, providerActionPreview: { id: "foreign" } },
    ])
      await expect(
        readProviderActionReview(reader(), {
          id,
          projectId,
          task: task({ result }),
        }),
      ).rejects.toThrow("未授权另一次调用");
    await expect(
      readActualTaskResult(
        reader(),
        task({
          result: {
            providerActionPreviewId: id,
            providerActionPreview: { id: "foreign" },
          },
        }),
      ),
    ).rejects.toThrow("相互冲突");
  });
  it("recognizes original pointer after execute rewrites taskId to the accepted task", async () => {
    const actual = preview({ status: "executed", taskId: otherTask });
    expect(
      await readProviderActionReview(reader({ provider: actual }), {
        id,
        projectId,
        task: task(),
      }),
    ).toEqual(actual);
    await expect(
      readProviderActionReview(reader({ provider: actual }), {
        id,
        projectId,
        task: task({ projectId: otherProject }),
      }),
    ).rejects.toThrow("归属不符");
  });
  it("rejects malformed actual records without reusing old parameters", async () => {
    await expect(
      readActualTaskResult(
        reader({ provider: preview({ estimatedCost: -1 }) }),
        task(),
      ),
    ).rejects.toThrow();
  });
  it("preserves tasks without preview objects", async () => {
    for (const result of [undefined, "plain result", ["plain"], null]) {
      const original = task({ result });
      expect(await readActualTaskResult(reader(), original)).toBe(original);
    }
    expect(
      taskResultReferenceKey({
        providerActionPreview: { id, parameters: "private" },
      }),
    ).not.toContain("private");
  });
  it.each(["projectId", "taskId", "workflowId", "revisionId"])(
    "rejects empty or duplicate %s before any lookup",
    async (key) => {
      const forbidden = new Proxy(
        {},
        {
          get: () => {
            throw new Error("lookup must not happen");
          },
        },
      ) as StudioClient;
      for (const search of [`?${key}=`, `?${key}=a&${key}=b`, `?${key}=%20`])
        await expect(
          readTaskConfirmationContext(forbidden, projectId, search),
        ).rejects.toThrow("重复／为空");
      expect(taskConfirmationKey(`?${key}=a`)).not.toBe(
        taskConfirmationKey(`?${key}=a&${key}=b`),
      );
    },
  );
  it("checks task and workflow together instead of ignoring task when workflow is supplied", async () => {
    const linked = task({ result: { creationWorkflowId: "workflow" } });
    const search = `?projectId=${projectId}&taskId=${taskId}&workflowId=workflow`;
    expect(
      (
        await readTaskConfirmationContext(
          reader({ tasks: [linked] }),
          projectId,
          search,
        )
      ).task?.id,
    ).toBe(taskId);
    for (const workflow of [
      { id: "workflow", taskId: otherTask, input: { projectId } },
      { id: "workflow", taskId, input: { projectId: otherProject } },
      { id: "wrong", taskId, input: { projectId } },
    ])
      await expect(
        readTaskConfirmationContext(
          reader({ tasks: [linked], workflow }),
          projectId,
          search,
        ),
      ).rejects.toThrow("绑定不符");
    await expect(
      readTaskConfirmationContext(reader({ tasks: [] }), projectId, search),
    ).rejects.toThrow("对应任务不存在");
  });
  it("does not silently prefer a workflow over a mixed old revision", async () => {
    await expect(
      readTaskConfirmationContext(
        reader(),
        projectId,
        "?workflowId=workflow&revisionId=revision",
      ),
    ).rejects.toThrow("未忽略任何引用");
  });
  it("checks actual change, revision chapter and project ownership", async () => {
    await expect(
      readActualTaskResult(
        reader({ change: { id: "change", projectId: otherProject, taskId } }),
        task({ result: { changePreview: { id: "change" } } }),
      ),
    ).rejects.toThrow("归属不符");
    await expect(
      readActualTaskResult(
        reader({
          chapter: { id: "chapter", projectId: otherProject, version: 1 },
        }),
        task({ result: { revisionPreview: { id: "revision" } } }),
      ),
    ).rejects.toThrow("归属不符");
    const revisionTask = task({
      result: { revisionPreview: { id: "revision" } },
    });
    const value = await readTaskConfirmationContext(
      reader({
        tasks: [revisionTask],
        chapter: { id: "chapter", projectId, version: 2 },
      }),
      projectId,
      `?taskId=${taskId}&revisionId=revision`,
    );
    expect(value.revision?.status).toBe("conflicted");
    await expect(
      readTaskConfirmationContext(
        reader(),
        projectId,
        `?taskId=${taskId}&revisionId=revision`,
      ),
    ).rejects.toThrow("绑定不符");
  });
});
