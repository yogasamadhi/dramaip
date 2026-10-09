import { z } from "zod";
import type { StudioClient } from "@dramaip/client";
import {
  CreationRebaseRequestSchema,
  CreationWorkflowSchema,
  type CreationRebaseRequest,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";

// Persist only IDs, choices, hashes and the original key. No prose, approval,
// credential, path or automatically refreshed comparison is stored here.
export const ScriptMergeRequestSchema = z
  .object({
    format: z.literal("script-merge-request-v1"),
    projectId: z.string().uuid(),
    targetId: z.string().uuid(),
    workflowId: z.string().uuid(),
    key: z.string().uuid(),
    input: CreationRebaseRequestSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const basis = value.input.basis;
    if (
      !basis ||
      basis.projectId !== value.projectId ||
      basis.workflowId !== value.workflowId ||
      basis.target.scriptId !== value.targetId ||
      basis.target.version !== value.input.baseVersion ||
      Object.keys(value.input.choices).some(
        (id) => !z.string().uuid().safeParse(id).success,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "原合并请求缺少精确比较归属，不能恢复或补造。",
      });
  });
export type ScriptMergeRequest = z.infer<typeof ScriptMergeRequestSchema>;
export const scriptMergeStorageKey = (projectId: string, targetId: string) =>
  `dramaip-script-merge-request:${projectId}:${targetId}`;
export function parseScriptMergeRequest(
  raw: string | null,
  projectId: string,
  targetId: string,
) {
  if (!raw) return undefined;
  const value = ScriptMergeRequestSchema.parse(JSON.parse(raw));
  if (value.projectId !== projectId || value.targetId !== targetId)
    throw new Error("本地原请求不属于当前项目／剧本，不能恢复或重发。");
  return value;
}
export function freezeScriptMergeRequest(
  projectId: string,
  targetId: string,
  workflowId: string,
  input: CreationRebaseRequest,
  key: string = crypto.randomUUID(),
): ScriptMergeRequest {
  return ScriptMergeRequestSchema.parse({
    format: "script-merge-request-v1",
    projectId,
    targetId,
    workflowId,
    key,
    input,
  });
}
export function verifyScriptMergeReceipt(
  raw: unknown,
  request: ScriptMergeRequest,
): CreationWorkflow {
  const receipt = CreationWorkflowSchema.parse(raw);
  const source = receipt.rebaseSource;
  const sourceInput = source
    ? (({ id: _id, ...input }) => input)(source)
    : undefined;
  if (
    receipt.input.operation !== "script-revision" ||
    receipt.input.projectId !== request.projectId ||
    receipt.input.targetId !== request.targetId ||
    receipt.input.baseVersion !== request.input.baseVersion ||
    receipt.sourceWorkflowId !== request.workflowId ||
    !source ||
    source.id !== request.workflowId ||
    JSON.stringify(CreationRebaseRequestSchema.parse(sourceInput)) !==
      JSON.stringify(request.input)
  )
    throw new Error("实际合并回执与原请求不一致，不能恢复其他候选。");
  return receipt;
}
export function clearExactScriptMergeRequest(
  storage: Pick<Storage, "getItem" | "removeItem">,
  request: ScriptMergeRequest,
) {
  const key = scriptMergeStorageKey(request.projectId, request.targetId);
  if (storage.getItem(key) !== JSON.stringify(request)) return false;
  storage.removeItem(key);
  return true;
}
export async function resendScriptMerge(
  client: StudioClient["creation"],
  request: ScriptMergeRequest,
) {
  return verifyScriptMergeReceipt(
    await client.rebase(request.workflowId, request.input, request.key),
    request,
  );
}
