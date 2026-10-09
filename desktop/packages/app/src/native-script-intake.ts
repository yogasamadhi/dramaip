import { z } from "zod";
import {
  ScreenplayIntakePreviewSchema,
  type ScreenplayIntakePreview,
} from "@dramaip/contracts/production";
import { StudioClientError, type StudioClient } from "@dramaip/client";

export const NativeScriptIntakeBindingSchema = z
  .object({
    previewId: z.string().uuid(),
    etag: z.string().min(1).optional(),
    requestKey: z.string().uuid().optional(),
  })
  .strict();
export type NativeScriptIntakeBinding = z.infer<
  typeof NativeScriptIntakeBindingSchema
>;
export function resolveNativeScriptIntake(
  raw: ScreenplayIntakePreview,
  binding: NativeScriptIntakeBinding,
) {
  const preview = ScreenplayIntakePreviewSchema.parse(raw);
  const started = ["creating", "materialized", "committed"].includes(
    preview.status,
  );
  if (
    preview.id !== binding.previewId ||
    (binding.etag && preview.etag !== binding.etag) ||
    (preview.requestKey && preview.requestKey !== binding.requestKey) ||
    (started &&
      (!preview.requestKey ||
        !preview.request ||
        preview.request.previewId !== preview.id)) ||
    (["materialized", "committed"].includes(preview.status) &&
      !preview.receipt) ||
    (!started &&
      Boolean(preview.requestKey || preview.request || preview.receipt))
  )
    throw new Error("同一预览／版本／创建恢复键尚未核验，不换文件或项目。");
  const originals = preview.episodes ?? [{ blocks: preview.blocks }];
  const allBlocks = originals.flatMap((original) => original.blocks);
  const hasStory =
    new Set(allBlocks.map((block) => block.id)).size === allBlocks.length &&
    originals.every((original) =>
      original.blocks.some(
        (block) =>
          (block.type === "action" || block.type === "dialogue") &&
          block.text.trim(),
      ),
    );
  return {
    preview,
    canCreate: preview.status === "pending" && hasStory,
    canResume:
      hasStory &&
      ["creating", "materialized"].includes(preview.status) &&
      (preview.status === "creating" || preview.sourceState === "current"),
    canOpen:
      hasStory &&
      preview.status === "committed" &&
      preview.sourceState === "current" &&
      Boolean(preview.receipt),
  };
}
export async function readNativeScriptIntake(
  client: Pick<StudioClient, "screenplayIntakes">,
  binding: NativeScriptIntakeBinding,
) {
  return resolveNativeScriptIntake(
    await client.screenplayIntakes.get(binding.previewId),
    binding,
  );
}

/** A verified owner 404 is not a timeout, generic route 404 or permission failure. */
export async function readNativeScriptIntakeRecovery(
  client: Pick<StudioClient, "screenplayIntakes">,
  binding: NativeScriptIntakeBinding,
) {
  const identity = NativeScriptIntakeBindingSchema.parse(binding);
  try {
    return {
      kind: "verified" as const,
      session: await readNativeScriptIntake(client, identity),
    };
  } catch (cause) {
    if (
      !identity.requestKey &&
      cause instanceof StudioClientError &&
      cause.status === 404 &&
      cause.body.code === "SCREENPLAY_INTAKE"
    )
      return {
        kind: "missing-before-create" as const,
        previewId: identity.previewId,
      };
    throw cause;
  }
}
