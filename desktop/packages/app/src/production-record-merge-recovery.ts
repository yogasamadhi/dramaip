import { z } from "zod";
import {
  ProductionRecordMergeRequestSchema,
  type ProductionRecordMergeRequest,
} from "@dramaip/contracts/production";
import { CreationWorkflowSchema } from "@dramaip/contracts/creation";
import { canonicalCreativeMetricJSON } from "@dramaip/contracts/insights";
import type { StudioClient } from "@dramaip/client";

// Body-free local recovery. Do not store the comparison, candidate or prose.
export const ProductionRecordMergeRecoverySchema = z
  .object({
    format: z.literal("storyboard-record-field-merge-recovery-v1"),
    key: z.string().uuid(),
    input: ProductionRecordMergeRequestSchema,
  })
  .strict();
export type ProductionRecordMergeRecovery = z.infer<
  typeof ProductionRecordMergeRecoverySchema
>;
export const productionRecordMergeStorageKey = (
  projectId: string,
  workflowId: string,
) => `dramaip-record-field-merge:${projectId}:${workflowId}`;
export function freezeProductionRecordMergeRequest(
  input: ProductionRecordMergeRequest,
  key = crypto.randomUUID(),
) {
  return ProductionRecordMergeRecoverySchema.parse({
    format: "storyboard-record-field-merge-recovery-v1",
    key,
    input,
  });
}
export function readProductionRecordMergeRequest(
  raw: string | null,
  projectId: string,
  workflowId: string,
  episodeId: string,
  baseId: string,
) {
  if (!raw) return undefined;
  const value = ProductionRecordMergeRecoverySchema.parse(JSON.parse(raw));
  if (
    value.input.projectId !== projectId ||
    value.input.workflow.id !== workflowId ||
    value.input.episodeId !== episodeId ||
    value.input.base.id !== baseId
  )
    throw new Error(
      "原字段合并请求不属于当前候选／项目／分集／基准，不自动换源。",
    );
  return value;
}
export async function resendProductionRecordMerge(
  client: StudioClient["episodeDevelopments"],
  request: ProductionRecordMergeRecovery,
) {
  const value = CreationWorkflowSchema.parse(
    await client.mergeRecords(
      request.input.workflow.id,
      request.input,
      request.key,
    ),
  );
  if (
    !value.recordMergeSource ||
    value.sourceWorkflowId !== request.input.workflow.id ||
    value.input.projectId !== request.input.projectId ||
    value.input.operation !== "storyboard-package" ||
    value.episodeDevelopmentBasis?.episode.id !== request.input.episodeId ||
    canonicalCreativeMetricJSON(value.recordMergeSource.request) !==
      canonicalCreativeMetricJSON(request.input)
  )
    throw new Error("实际回执与原字段合并请求不一致，不能显示其他运行。");
  return value;
}
export function clearExactProductionRecordMergeRequest(
  storage: Pick<Storage, "getItem" | "removeItem">,
  request: ProductionRecordMergeRecovery,
) {
  const key = productionRecordMergeStorageKey(
    request.input.projectId,
    request.input.workflow.id,
  );
  if (storage.getItem(key) !== JSON.stringify(request)) return false;
  storage.removeItem(key);
  return true;
}
