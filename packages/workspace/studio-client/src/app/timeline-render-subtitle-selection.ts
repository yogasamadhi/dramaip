import {
  TimelineRenderSubtitlePolicySchema,
  TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
  type TimelineRendererFontRefSchema,
  type TimelineRenderJob,
  type TimelineRenderPreflight,
  type TimelineRenderSubtitlePolicy,
} from "@dramaip/contracts/timeline";
import type { z } from "zod";
export type RenderFontRef = z.infer<typeof TimelineRendererFontRefSchema>;
export type RenderSubtitleMode = TimelineRenderSubtitlePolicy["mode"];

/** Undefined is deliberately unchosen, not consent to omit. Never select a latest font by ID. */
export function selectedRenderSubtitlePolicy(
  mode?: RenderSubtitleMode,
  font?: RenderFontRef,
) {
  if (!mode) return undefined;
  return TimelineRenderSubtitlePolicySchema.parse(
    mode === "omit" ? { version: 1, mode } : { version: 1, mode, font },
  );
}
export function explicitRenderReady(
  preflight: TimelineRenderPreflight | undefined,
  mode?: RenderSubtitleMode,
  font?: RenderFontRef,
) {
  try {
    const policy = selectedRenderSubtitlePolicy(mode, font);
    if (
      !policy ||
      !preflight?.ready ||
      preflight.profileVersion !== TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION ||
      !preflight.sourceFingerprint ||
      !preflight.rendererVersion ||
      !preflight.sidecarArtifactVersion ||
      JSON.stringify(policy) !== JSON.stringify(preflight.subtitlePolicy)
    )
      return false;
    return (
      policy.mode === "omit" ||
      Boolean(
        preflight.subtitleBurnInAvailable &&
        preflight.subtitleFonts?.some(
          (item) =>
            item.id === policy.font.id &&
            item.packVersion === policy.font.packVersion &&
            item.sha256 === policy.font.sha256,
        ),
      )
    );
  } catch {
    return false;
  }
}
export function exactRenderRetryReady(
  job: TimelineRenderJob | undefined,
  preflight: TimelineRenderPreflight | undefined,
  mode?: RenderSubtitleMode,
  font?: RenderFontRef,
) {
  return Boolean(
    job &&
    preflight &&
    explicitRenderReady(preflight, mode, font) &&
    ["failed", "canceled", "interrupted"].includes(job.status) &&
    job.timelineId === preflight.timelineId &&
    job.timelineVersion === preflight.timelineVersion &&
    job.sourceFingerprint === preflight.sourceFingerprint &&
    job.timelineProfileVersion === preflight.profileVersion &&
    job.rendererVersion === preflight.rendererVersion &&
    job.sidecarArtifactVersion === preflight.sidecarArtifactVersion &&
    JSON.stringify(job.subtitlePolicy) ===
      JSON.stringify(preflight.subtitlePolicy),
  );
}
