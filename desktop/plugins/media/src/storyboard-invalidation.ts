import { z } from "zod";
import type { PluginContext } from "@dramaip/plugin-api/internal";
import { sourceBinding } from "./source-bindings.js";

/** Media owns its derivations. Durable replay never writes Production tables,
 * deletes artifacts, cancels a paid job or launches another provider call. */
export function registerStoryboardInvalidation(context: PluginContext) {
  const input = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    shots: z
      .array(
        z.object({
          id: z.string().uuid(),
          version: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(1000),
  });
  context.effect(
    () =>
      context.domainEvents.registerConsumer({
        id: "media:selected-storyboard-derivation-staleness.v1",
        pluginId: "media",
        critical: false,
        eventTypes: ["production.storyboard-shots-redone.v1"],
        handle(event) {
          const value = input.parse(event.payload);
          const selected = new Map(
            value.shots.map((shot) => [shot.id, shot.version]),
          );
          context.uow.execute((tx) => {
            const at = new Date().toISOString();
            const affectedMedia: string[] = [];
            for (const row of tx.all<{
              id: string;
              parent_id: string;
              payload_json: string;
              version: number;
              created_at: string;
            }>(
              "SELECT id, parent_id, payload_json, version, created_at FROM media_records WHERE project_id = ? AND kind IN ('shot-stills','image','audio','video','assets')",
              value.projectId,
            )) {
              const payload = JSON.parse(row.payload_json) as Record<
                string,
                unknown
              >;
              const binding = sourceBinding(tx, row.id);
              const shotId =
                binding?.shotId ??
                (typeof payload.sourceShotId === "string"
                  ? payload.sourceShotId
                  : typeof payload["关联分镜"] === "string"
                    ? payload["关联分镜"]
                    : row.parent_id);
              const version = selected.get(shotId as string);
              if (version === undefined) continue;
              if (
                payload.invalidatedByStoryboardResultId === value.id ||
                (binding
                  ? binding.shotVersion >= version
                  : row.created_at > event.occurredAt)
              )
                continue;
              tx.run(
                "UPDATE media_records SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
                JSON.stringify({
                  ...payload,
                  stale: true,
                  staleReason: "关联镜头已局部重做，旧素材保留待复核。",
                  invalidatedByStoryboardResultId: value.id,
                  invalidatedShotVersion: version,
                }),
                at,
                row.id,
                row.version,
              );
              affectedMedia.push(row.id);
            }
            const affectedTracks: string[] = [];
            for (const row of tx.all<{ id: string; clips_json: string }>(
              "SELECT id, clips_json FROM media_audio_tracks WHERE project_id = ? AND stale = 0 AND created_at <= ?",
              value.projectId,
              event.occurredAt,
            )) {
              const clips = JSON.parse(row.clips_json) as {
                shotId?: string;
                assetId?: string;
              }[];
              if (
                !clips.some(
                  (clip) =>
                    (clip.shotId && selected.has(clip.shotId)) ||
                    (clip.assetId && affectedMedia.includes(clip.assetId)),
                )
              )
                continue;
              tx.run(
                "UPDATE media_audio_tracks SET stale = 1, stale_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND stale = 0",
                "包含局部重做镜头的旧音轨，保留待复核。",
                at,
                row.id,
              );
              affectedTracks.push(row.id);
            }
            const affectedAnimatics: string[] = [];
            for (const row of tx.all<{
              id: string;
              clips_json: string;
              review_note: string | null;
            }>(
              "SELECT id, clips_json, review_note FROM media_animatic_drafts WHERE project_id = ? AND created_at <= ?",
              value.projectId,
              event.occurredAt,
            )) {
              const note = `关联镜头局部重做，原动态分镜保留待复核（${value.id}）。`;
              const clips = JSON.parse(row.clips_json) as { shotId: string }[];
              if (
                row.review_note === note ||
                !clips.some((clip) => selected.has(clip.shotId))
              )
                continue;
              tx.run(
                "UPDATE media_animatic_drafts SET status = 'returned', review_note = ?, version = version + 1, updated_at = ? WHERE id = ?",
                note,
                at,
                row.id,
              );
              affectedAnimatics.push(row.id);
            }
            if (
              affectedMedia.length ||
              affectedTracks.length ||
              affectedAnimatics.length
            )
              tx.append({
                type: "media.storyboard-derivations-stale.v1",
                pluginId: "media",
                aggregateType: "storyboard-derivations",
                aggregateId: value.id,
                aggregateVersion: event.aggregateVersion,
                payload: {
                  storyboardResultId: value.id,
                  projectId: value.projectId,
                  shotIds: [...selected.keys()],
                  mediaIds: affectedMedia,
                  audioTrackIds: affectedTracks,
                  animaticIds: affectedAnimatics,
                },
              });
          });
        },
      }),
    "consumer:media-selected-storyboard-derivation-staleness",
  );
}
