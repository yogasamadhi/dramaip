import { describe, expect, it } from "vitest";
import {
  providerEstimate,
  providerIdentity,
  providerStatusText,
  readTaskProviderReview,
  requireUnchangedProviderReview,
} from "../src/client/confirmations/provider-review.ts";
import type {
  ProviderActionPreview,
  Task,
  TaskRemotes,
} from "../src/client/confirmations/remote.ts";
import {
  readActualTaskResult,
  readTaskConfirmationContext,
  taskConfirmationKey,
  taskResultReferenceKey,
} from "../src/client/confirmations/task-context.ts";
import { ok, shown, t } from "./support/confirmations.ts";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProject = "10000000-0000-4000-8000-000000000002";
const taskId = "20000000-0000-4000-8000-000000000001";
const otherTask = "20000000-0000-4000-8000-000000000002";
const id = "30000000-0000-4000-8000-000000000001";
function preview(
  patch: Partial<Record<keyof ProviderActionPreview, unknown>> = {},
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
  } as ProviderActionPreview;
}
function task(patch: Partial<Record<keyof Task, unknown>> = {}): Task {
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
  } as Task;
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
): TaskRemotes {
  return {
    workspace: { projectsGet: (requested: string) => ok({ id: requested }) },
    automation: {
      tasksList: () => ok(options.tasks ?? [task()]),
      providerActionPreviewsGet: () => ok(options.provider ?? preview()),
      creationGet: () =>
        ok(
          options.workflow ?? { id: "workflow", taskId, input: { projectId } },
        ),
      revisionsGet: () =>
        ok(
          options.revision ?? {
            id: "revision",
            chapterId: "chapter",
            baseVersion: 1,
            status: "pending",
          },
        ),
      changePreviewsGet: () =>
        ok(
          options.change ?? {
            id: "change",
            projectId,
            taskId,
            status: "pending",
          },
        ),
    },
    writing: {
      chaptersGet: () =>
        ok(options.chapter ?? { id: "chapter", projectId, version: 1 }),
    },
  } as unknown as TaskRemotes;
}

describe("actual task and provider review", () => {
  it("never labels provider acceptance as adopted content or a settled bill", () => {
    expect(providerStatusText(t, "executed")).toBe("已创建任务（账单未知）");
    expect(providerStatusText(t, "discarded")).toBe(
      "已放弃（不证明无历史费用）",
    );
    for (const status of [
      "pending",
      "executed",
      "discarded",
      "expired",
    ] as const)
      expect(providerStatusText(t, status)).not.toMatch(/已应用|已采用|已结算/);
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
      expect(providerEstimate(value, t).known).toBe(false);
      expect(providerEstimate(value, t).label).not.toContain("USD");
    }
    expect(providerEstimate({ estimatedCost: 0, currency: "CNY" }, t)).toEqual({
      known: true,
      label: "0.0000 CNY",
    });
  });
  it("canonicalizes memory-only review identity without ignoring parameters", () => {
    expect(providerIdentity(preview({ parameters: { b: 2, a: 1 } }))).toBe(
      providerIdentity(preview({ parameters: { a: 1, b: 2 } })),
    );
    expect(() =>
      requireUnchangedProviderReview(preview(), preview(), t),
    ).not.toThrow();
    for (const patch of [
      { parameters: { prompt: "changed" } },
      { estimatedCost: 2 },
      { currency: "USD" },
      { status: "executed" },
      { estimatedCost: undefined },
      { currency: undefined },
    ])
      expect(() =>
        requireUnchangedProviderReview(preview(patch), preview(), t),
      ).toThrow(expect.objectContaining({ copy: "mismatch.providerChanged" }));
    expect(t("mismatch.providerChanged")).toContain("未执行原确认");
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
      shown(
        readTaskProviderReview(reader({ provider: preview(patch) }), {
          id,
          projectId,
          task: task(),
        }),
      ),
    ).rejects.toThrow("归属不符");
  });
  it("requires an authoritative task pointer and rejects conflicting pointers", async () => {
    for (const result of [
      {},
      { providerActionPreviewId: "foreign" },
      { providerActionPreviewId: id, providerActionPreview: { id: "foreign" } },
    ])
      await expect(
        shown(
          readTaskProviderReview(reader(), {
            id,
            projectId,
            task: task({ result }),
          }),
        ),
      ).rejects.toThrow("未授权另一次调用");
    await expect(
      shown(
        readActualTaskResult(
          reader(),
          task({
            result: {
              providerActionPreviewId: id,
              providerActionPreview: { id: "foreign" },
            },
          }),
        ),
      ),
    ).rejects.toThrow("相互冲突");
  });
  it("recognizes original pointer after execute rewrites taskId to the accepted task", async () => {
    const actual = preview({ status: "executed", taskId: otherTask });
    expect(
      await readTaskProviderReview(reader({ provider: actual }), {
        id,
        projectId,
        task: task(),
      }),
    ).toEqual(actual);
    await expect(
      shown(
        readTaskProviderReview(reader({ provider: actual }), {
          id,
          projectId,
          task: task({ projectId: otherProject }),
        }),
      ),
    ).rejects.toThrow("归属不符");
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
      ) as TaskRemotes;
      for (const search of [`?${key}=`, `?${key}=a&${key}=b`, `?${key}=%20`])
        await expect(
          shown(readTaskConfirmationContext(forbidden, projectId, search)),
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
        shown(
          readTaskConfirmationContext(
            reader({ tasks: [linked], workflow }),
            projectId,
            search,
          ),
        ),
      ).rejects.toThrow("绑定不符");
    await expect(
      shown(
        readTaskConfirmationContext(reader({ tasks: [] }), projectId, search),
      ),
    ).rejects.toThrow("对应任务不存在");
  });
  it("does not silently prefer a workflow over a mixed old revision", async () => {
    await expect(
      shown(
        readTaskConfirmationContext(
          reader(),
          projectId,
          "?workflowId=workflow&revisionId=revision",
        ),
      ),
    ).rejects.toThrow("未忽略任何引用");
  });
  it("checks actual change, revision chapter and project ownership", async () => {
    await expect(
      shown(
        readActualTaskResult(
          reader({ change: { id: "change", projectId: otherProject, taskId } }),
          task({ result: { changePreview: { id: "change" } } }),
        ),
      ),
    ).rejects.toThrow("归属不符");
    await expect(
      shown(
        readActualTaskResult(
          reader({
            chapter: { id: "chapter", projectId: otherProject, version: 1 },
          }),
          task({ result: { revisionPreview: { id: "revision" } } }),
        ),
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
      shown(
        readTaskConfirmationContext(
          reader(),
          projectId,
          `?taskId=${taskId}&revisionId=revision`,
        ),
      ),
    ).rejects.toThrow("绑定不符");
  });
});
