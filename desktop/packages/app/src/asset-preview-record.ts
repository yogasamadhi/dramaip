import type { StudioClient } from "@dramaip/client";
import { MediaRecordSchema } from "@dramaip/contracts/media";

/** A fresh owner read, never the asset's display label or a frozen audio replacement. */
export async function readAssetPreviewRecord(
  client: Pick<StudioClient, "mediaSources">,
  recordId: string,
  projectId: string,
  signal: AbortSignal,
) {
  const value = await client.mediaSources.record(recordId, signal);
  if (signal.aborted) return undefined;
  const record = MediaRecordSchema.safeParse(value);
  if (
    !record.success ||
    record.data.id !== recordId ||
    record.data.projectId !== projectId
  )
    throw new Error("实际素材身份、项目归属或版本无法核对，未恢复旧预览。");
  return { projectId, version: record.data.version };
}
