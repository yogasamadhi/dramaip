import type { StudioClient } from "@dramaip/client";
import { ProviderActionPreviewSchema } from "@dramaip/contracts/automation";
import type { ProviderActionPreview, Task } from "@dramaip/contracts/product";

export function providerReviewStatusLabel(
  status: ProviderActionPreview["status"],
): string {
  return {
    pending: "待远程调用与费用确认",
    executed: "已创建任务（账单未知）",
    discarded: "已放弃（不证明无历史费用）",
    expired: "已过期",
  }[status];
}

export function providerEstimate(
  value: Pick<ProviderActionPreview, "estimatedCost" | "currency">,
): {
  known: boolean;
  label: string;
} {
  const amount = value.estimatedCost;
  const currency = value.currency?.trim();
  return typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    currency
    ? { known: true, label: `${amount.toFixed(4)} ${currency}` }
    : { known: false, label: "预估费用或币种未知；不能据此确认远程调用" };
}

export function providerReviewIdentity(value: ProviderActionPreview): string {
  const ordered = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, ordered(child)]),
          )
        : item;
  // Memory-only identity, never persisted as navigation, consent or a quote.
  return JSON.stringify(ordered(value));
}

export async function readProviderActionReview(
  client: Pick<StudioClient, "providerActionPreviews">,
  binding: { id: string; projectId: string; task: Task },
): Promise<ProviderActionPreview> {
  const value = ProviderActionPreviewSchema.parse(
    await client.providerActionPreviews.get(binding.id),
  );
  if (
    value.id !== binding.id ||
    value.projectId !== binding.projectId ||
    binding.task.projectId !== binding.projectId ||
    (value.status !== "executed" &&
      value.taskId &&
      value.taskId !== binding.task.id)
  )
    throw new Error(
      "厂商预览的实际身份、项目或原任务归属不符；未打开其他调用。",
    );
  // Executing rewrites taskId to the accepted provider task. The original
  // authoritative task's result pointer still binds this preview, not that
  // new task ID. Never fabricate equality between those two task identities.
  const result =
    binding.task.result &&
    typeof binding.task.result === "object" &&
    !Array.isArray(binding.task.result)
      ? (binding.task.result as Record<string, unknown>)
      : {};
  const embedded = result.providerActionPreview;
  const embeddedId =
    embedded && typeof embedded === "object" && !Array.isArray(embedded)
      ? (embedded as Record<string, unknown>).id
      : undefined;
  if (
    (result.providerActionPreviewId !== undefined &&
      result.providerActionPreviewId !== binding.id) ||
    (embeddedId !== undefined && embeddedId !== binding.id) ||
    (result.providerActionPreviewId !== binding.id && embeddedId !== binding.id)
  )
    throw new Error("实际任务未绑定指定厂商预览；未授权另一次调用。");
  return value;
}

/** Owner preview without an invented task/conversation: standalone previews
 * are valid, but their actual project must be read and matched every time. */
export async function readProjectProviderReview(
  client: {
    providerActionPreviews: Pick<StudioClient["providerActionPreviews"], "get">;
    projects: Pick<StudioClient["projects"], "get">;
  },
  binding: { id: string; projectId: string },
): Promise<ProviderActionPreview> {
  const [project, raw] = await Promise.all([
    client.projects.get(binding.projectId),
    client.providerActionPreviews.get(binding.id),
  ]);
  const value = ProviderActionPreviewSchema.parse(raw);
  if (
    !project ||
    project.id !== binding.projectId ||
    value.id !== binding.id ||
    value.projectId !== binding.projectId
  )
    throw new Error(
      "指定厂商预览或实际项目归属不符；未打开最新调用或另一项目。",
    );
  return value;
}

export function requireUnchangedProviderReview(
  current: ProviderActionPreview,
  reviewed: ProviderActionPreview,
): void {
  if (
    current.status !== "pending" ||
    !providerEstimate(current).known ||
    providerReviewIdentity(current) !== providerReviewIdentity(reviewed)
  )
    throw new Error(
      "实际预览、状态或费用已变化／未核全；请重新读取并另行确认，未执行原确认。",
    );
}

export async function readAssistantProviderReview(
  client: Pick<
    StudioClient,
    "providerActionPreviews" | "assistantConversations" | "tasks"
  >,
  binding: { id: string; projectId?: string; conversationId: string },
): Promise<{ task: Task; preview: ProviderActionPreview }> {
  const detail = await client.assistantConversations.get(
    binding.conversationId,
  );
  const preview = ProviderActionPreviewSchema.parse(
    await client.providerActionPreviews.get(binding.id),
  );
  const run = detail.runs.find((item) => item.id === preview.runId);
  if (
    !binding.projectId ||
    detail.conversation.id !== binding.conversationId ||
    detail.conversation.projectId !== binding.projectId ||
    preview.sessionId !== binding.conversationId ||
    !run ||
    run.sessionId !== binding.conversationId ||
    !detail.providerActionPreviews.some(
      (item) =>
        item &&
        typeof item === "object" &&
        "id" in item &&
        item.id === binding.id,
    )
  )
    throw new Error("实际对话、运行和厂商预览的绑定未核全；未授权远程调用。");
  const task = (await client.tasks.list()).find(
    (item) => item.id === run.taskId,
  );
  if (!task) throw new Error("厂商预览的原任务不存在；未授权远程调用。");
  return {
    task,
    preview: await readProviderActionReview(client, {
      id: binding.id,
      projectId: binding.projectId,
      task,
    }),
  };
}
