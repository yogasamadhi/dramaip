import { describe, expect, it } from "vitest";
import type { StudioClient } from "../facade/index";
import type { ProviderActionPreview, Task } from "@dramaip/contracts/product";
import {
  providerReviewStatusLabel,
  readAssistantProviderReview,
} from "./provider-action-review";

// The task and pending centers' copies of these checks moved to
// automation-client; the assistant panel still uses this one until it does.
const projectId = "10000000-0000-4000-8000-000000000001";
const otherProject = "10000000-0000-4000-8000-000000000002";
const taskId = "20000000-0000-4000-8000-000000000001";
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

describe("assistant provider review", () => {
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
});
