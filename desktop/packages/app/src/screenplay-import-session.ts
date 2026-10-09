import { z } from "zod";
import type { StudioClient } from "@dramaip/client";
import {
  ScreenplayImportPreviewSchema,
  ScreenplayImportTargetSchema,
  type EpisodeDevelopmentCatalog,
  type ScreenplayImportPreview,
} from "@dramaip/contracts/production";

// Persist identity only. Never persist grants, file paths, body or checked consent.
export const ScreenplayImportBindingSchema = z
  .object({
    previewId: z.string().uuid(),
    projectId: z.string().uuid(),
    episodeId: z.string().uuid(),
    etag: z.string().min(1),
    target: ScreenplayImportTargetSchema,
  })
  .strict();
export type ScreenplayImportBinding = z.infer<
  typeof ScreenplayImportBindingSchema
>;
export const screenplayImportStorageKey = (
  projectId: string,
  episodeId: string,
) => `dramaip-screenplay-import:${projectId}:${episodeId}`;
export function screenplayImportHasStory(preview: ScreenplayImportPreview) {
  return (
    new Set(preview.blocks.map((block) => block.id)).size ===
      preview.blocks.length &&
    preview.blocks.some(
      (block) =>
        (block.type === "action" || block.type === "dialogue") &&
        block.text.trim(),
    )
  );
}
export function resolveScreenplayImport(
  raw: ScreenplayImportPreview,
  binding: ScreenplayImportBinding,
  sources: EpisodeDevelopmentCatalog,
) {
  const preview = ScreenplayImportPreviewSchema.parse(raw);
  if (
    preview.previewId !== binding.previewId ||
    preview.projectId !== binding.projectId ||
    preview.parentId !== binding.episodeId ||
    preview.etag !== binding.etag ||
    !preview.target ||
    preview.target.projectVersion !== binding.target.projectVersion ||
    preview.target.episodeVersion !== binding.target.episodeVersion ||
    sources.projectId !== binding.projectId ||
    sources.direct?.project.id !== binding.projectId
  )
    throw new Error(
      "同一导入预览、实际项目／分集或冻结版本不一致；不会换稿、猜测回执或重新导入。",
    );
  const episodes = sources.direct.episodes.filter(
    (item) => item.id === binding.episodeId,
  );
  if (episodes.length > 1)
    throw new Error("实际分集身份重复，导入目标尚未核验。");
  const episode = episodes.length === 1 ? episodes[0] : undefined;
  const targetCurrent =
    sources.direct.project.version === binding.target.projectVersion &&
    episode?.version === binding.target.episodeVersion;
  const originals =
    episode?.scripts.filter((item) => item.id === preview.receipt?.scriptId) ??
    [];
  const receiptCurrent = Boolean(
    preview.status === "committed" &&
    preview.receipt &&
    originals.length === 1 &&
    originals[0]!.version === preview.receipt.scriptVersion &&
    originals[0]!.documentVersion === preview.receipt.documentVersion,
  );
  return {
    preview,
    targetCurrent,
    receiptCurrent,
    canCommit:
      preview.status === "pending" &&
      targetCurrent &&
      ["fountain", "fdx"].includes(preview.sourceFormat) &&
      screenplayImportHasStory(preview),
  };
}
export async function readScreenplayImportSession(
  client: Pick<StudioClient, "screenplayImports" | "episodeDevelopments">,
  binding: ScreenplayImportBinding,
) {
  const [preview, sources] = await Promise.all([
    client.screenplayImports.get(binding.previewId),
    client.episodeDevelopments.sources(binding.projectId),
  ]);
  return resolveScreenplayImport(preview, binding, sources);
}
