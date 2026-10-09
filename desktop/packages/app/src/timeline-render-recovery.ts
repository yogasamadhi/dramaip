import type { StudioClient } from "@dramaip/client";
import { z } from "zod";
import {
  TimelineRenderCreateInputSchema,
  TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
  type TimelineRenderJob,
  type TimelineRenderPreflight,
} from "@dramaip/contracts/timeline";

// Persist only safe identity and the original opaque request, never Timeline, media bytes, consent or paths.
export const RenderRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    episodeId: z.string().uuid(),
    timelineId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    key: z.string().uuid(),
    input: TimelineRenderCreateInputSchema.strict(),
    retryJobId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.input.timelineProfileVersion ===
        TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION) ===
      Boolean(value.input.subtitlePolicy),
    { message: "原请求字幕策略与输出版本不一致。" },
  );
export type RenderRequest = z.infer<typeof RenderRequestSchema>;
export const RenderSelectionSchema = z
  .object({
    timelineId: z.string().uuid(),
    jobId: z.string().uuid(),
  })
  .strict();
export function parseRenderRequest(
  raw: string | null,
  projectId: string,
  episodeId: string,
) {
  if (!raw) return undefined;
  const value = RenderRequestSchema.parse(JSON.parse(raw));
  if (value.projectId !== projectId || value.episodeId !== episodeId)
    throw new Error("本地请求不属于当前项目／分集，不能恢复或重发。");
  return value;
}
export async function renderRequestFingerprint(key: string) {
  const bytes = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function freezeRenderRequest(
  projectId: string,
  episodeId: string,
  preflight: TimelineRenderPreflight,
  retry?: TimelineRenderJob,
): RenderRequest {
  if (
    !preflight.ready ||
    !preflight.sourceFingerprint ||
    !preflight.rendererVersion ||
    !preflight.sidecarArtifactVersion ||
    (preflight.profileVersion === TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION) !==
      Boolean(preflight.subtitlePolicy)
  )
    throw new Error("须先重新核对实际版本、签名 sidecar 与冻结来源。");
  if (
    retry &&
    (!["failed", "canceled", "interrupted"].includes(retry.status) ||
      retry.timelineId !== preflight.timelineId ||
      retry.timelineVersion !== preflight.timelineVersion ||
      retry.sourceFingerprint !== preflight.sourceFingerprint ||
      retry.timelineProfileVersion !== preflight.profileVersion ||
      retry.rendererVersion !== preflight.rendererVersion ||
      retry.sidecarArtifactVersion !== preflight.sidecarArtifactVersion ||
      JSON.stringify(retry.subtitlePolicy) !==
        JSON.stringify(preflight.subtitlePolicy))
  )
    throw new Error("原任务来源或时间线已变化，不能自动换源重试。");
  return RenderRequestSchema.parse({
    projectId,
    episodeId,
    timelineId: preflight.timelineId,
    version: preflight.timelineVersion,
    key: crypto.randomUUID(),
    input: {
      sourceFingerprint: preflight.sourceFingerprint,
      timelineProfileVersion: preflight.profileVersion,
      rendererVersion: preflight.rendererVersion,
      sidecarArtifactVersion: preflight.sidecarArtifactVersion,
      ...(preflight.subtitlePolicy
        ? { subtitlePolicy: preflight.subtitlePolicy }
        : {}),
    },
    ...(retry ? { retryJobId: retry.jobId } : {}),
  });
}
export async function findRenderReceipt(
  client: StudioClient["timelineRenders"],
  pending: RenderRequest,
  signal?: AbortSignal,
) {
  const fingerprint = await renderRequestFingerprint(pending.key);
  signal?.throwIfAborted();
  const page = await client.list(
    pending.projectId,
    pending.episodeId,
    { requestFingerprint: fingerprint },
    signal,
  );
  const job = page.items[0];
  if (
    job &&
    (job.requestFingerprint !== fingerprint ||
      job.timelineId !== pending.timelineId ||
      job.timelineVersion !== pending.version ||
      job.sourceFingerprint !== pending.input.sourceFingerprint ||
      job.timelineProfileVersion !== pending.input.timelineProfileVersion ||
      job.rendererVersion !== pending.input.rendererVersion ||
      job.sidecarArtifactVersion !== pending.input.sidecarArtifactVersion ||
      JSON.stringify(job.subtitlePolicy) !==
        JSON.stringify(pending.input.subtitlePolicy))
  )
    throw new Error("原请求与实际渲染回执不一致，不能恢复其他任务。");
  return job;
}
export async function readRenderHistory(
  client: StudioClient["timelineRenders"],
  projectId: string,
  episodeId: string,
  signal?: AbortSignal,
) {
  const head = await client.list(projectId, episodeId, {}, signal);
  let cursor = head.nextCursor;
  const cursors = new Set<string>();
  const ids = new Set(head.items.map((item) => item.jobId));
  const items = [...head.items];
  while (cursor) {
    if (cursors.has(cursor)) throw new Error("渲染历史游标重复，尚未核全。");
    cursors.add(cursor);
    const page = await client.list(projectId, episodeId, { cursor }, signal);
    if (
      page.timeline?.id !== head.timeline?.id ||
      page.timeline?.version !== head.timeline?.version
    )
      throw new Error("读取历史期间时间线已变化，请重新核对。");
    for (const item of page.items) {
      if (ids.has(item.jobId)) throw new Error("渲染历史重复，尚未核全。");
      ids.add(item.jobId);
      items.push(item);
    }
    cursor = page.nextCursor;
  }
  return { ...head, items, nextCursor: undefined };
}
