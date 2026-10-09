import { z } from "zod";
import type { StudioClient } from "@dramaip/client";
import {
  CreationInputSchema,
  CreationWorkflowSchema,
  type CreationInput,
} from "@dramaip/contracts/creation";
import { sameFrozenOwnerSnapshot } from "./current-owner-read";

const schema = z
  .object({
    format: z.literal("storyboard-source-redo-start-v1"),
    key: z.string().uuid(),
    input: CreationInputSchema.strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.input.operation !== "storyboard-package" ||
      !value.input.episodeDevelopmentRequest?.redoSourceReview ||
      !value.input.episodeDevelopmentRequest.redoShots ||
      !value.input.episodeDevelopmentRequest.baseStoryboardId
    )
      ctx.addIssue({
        code: "custom",
        message: "原创建请求必须包含完整来源审阅及原局部重做范围。",
      });
  });
export type StoryboardRedoStartRequest = z.infer<typeof schema>;
export const storyboardRedoStartStorageKey = (
  projectId: string,
  episodeId: string,
) => `dramaip-source-redo-start:${projectId}:${episodeId}`;
export function freezeStoryboardRedoStartRequest(
  input: CreationInput,
  key: string = crypto.randomUUID(),
) {
  return schema.parse({
    format: "storyboard-source-redo-start-v1",
    key,
    input,
  });
}
export function parseStoryboardRedoStartRequest(
  raw: string | null,
  projectId: string,
  episodeId: string,
) {
  if (raw === null) return undefined;
  if (raw.length > 2 * 1024 * 1024)
    throw new Error("原请求超出本机恢复范围，不截断或重建。");
  const value = schema.parse(JSON.parse(raw));
  if (
    value.input.projectId !== projectId ||
    value.input.episodeDevelopmentRequest?.episodeId !== episodeId
  )
    throw new Error("原创建请求不属于当前项目或分集，不换其他请求。");
  return value;
}
export function saveStoryboardRedoStartRequest(
  storage: Pick<Storage, "getItem" | "setItem">,
  request: StoryboardRedoStartRequest,
) {
  const key = storyboardRedoStartStorageKey(
    request.input.projectId,
    request.input.episodeDevelopmentRequest!.episodeId,
  );
  const raw = JSON.stringify(schema.parse(request));
  if (raw.length > 2 * 1024 * 1024 || storage.getItem(key) !== null)
    throw new Error(
      "本机已有未核对原请求或完整请求超限，未覆盖、未发出新创建。",
    );
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error("原完整请求与幂等键未持久保存，未发出创建。");
}
export function clearExactStoryboardRedoStartRequest(
  storage: Pick<Storage, "getItem" | "removeItem">,
  request: StoryboardRedoStartRequest,
) {
  const key = storyboardRedoStartStorageKey(
    request.input.projectId,
    request.input.episodeDevelopmentRequest!.episodeId,
  );
  if (storage.getItem(key) !== JSON.stringify(request)) return false;
  storage.removeItem(key);
  if (storage.getItem(key) !== null)
    throw new Error("原创建回执已取得，但本机待核对记录未解除。");
  return true;
}
export async function resendStoryboardRedoStart(
  client: StudioClient["creation"],
  request: StoryboardRedoStartRequest,
) {
  let original: StoryboardRedoStartRequest;
  try {
    original = schema.parse(request);
  } catch {
    throw new Error("本机原创建输入不能通过完整协议核对，未发出请求。");
  }
  let raw: unknown;
  try {
    raw = await client.start(original.input, original.key);
  } catch (cause) {
    const phase =
      cause instanceof SyntaxError
        ? "回复读取失败"
        : cause instanceof TypeError
          ? "请求或回复读取失败"
          : "请求未完成";
    throw new Error(`原创建${phase}，完整输入和幂等键仍保留。`);
  }
  let receipt: ReturnType<typeof CreationWorkflowSchema.parse>;
  try {
    receipt = CreationWorkflowSchema.parse(raw);
  } catch {
    throw new Error("实际创建回执未通过完整协议核对，未清除原请求。");
  }
  const requestHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ input: original.input })),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  // Workflow.input.model is the server-resolved execution configuration, not
  // the originally submitted model (which may be absent). The authoritative
  // receipt binds every original input field, including that exact model choice.
  if (
    receipt.creationRequestReceipt?.key !== original.key ||
    receipt.creationRequestReceipt?.requestHash !== requestHash
  )
    throw new Error(
      "实际创建缺少匹配的原输入哈希与幂等键回执，未解除待核对请求。",
    );
  const { model: _resolvedModel, ...actualInput } = receipt.input;
  const { model: _requestedModel, ...originalInput } = original.input;
  if (
    !sameFrozenOwnerSnapshot(actualInput, originalInput) ||
    !sameFrozenOwnerSnapshot(
      receipt.episodeDevelopmentBasis?.request,
      original.input.episodeDevelopmentRequest,
    ) ||
    !sameFrozenOwnerSnapshot(
      receipt.episodeDevelopmentBasis?.storyboardRedo?.sourceReview?.review,
      original.input.episodeDevelopmentRequest!.redoSourceReview,
    )
  )
    throw new Error("实际创建回执与原完整输入、来源审阅不符，未恢复其他候选。");
  return receipt;
}
