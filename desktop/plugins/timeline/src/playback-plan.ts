import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import type {
  MediaAudioTrackService,
  MediaRecordService,
} from "@dramaip/contracts/media";
import {
  TimelinePlaybackPlanSchema,
  type TimelineManifest,
  type TimelinePlaybackPlan,
} from "@dramaip/contracts/timeline";
import { defineRouteContribution } from "@dramaip/plugin-api/internal";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";

/** Public owner reads only. Never inspect Media tables or fill historical missing versions. */
export function buildTimelinePlaybackPlan(
  timeline: TimelineManifest,
  media: MediaRecordService,
  audio: MediaAudioTrackService,
): TimelinePlaybackPlan {
  const bindings: TimelinePlaybackPlan["bindings"] = [];
  const blockers: TimelinePlaybackPlan["blockers"] = [];
  const tracks = audio.list(timeline.episodeId);
  const solo = timeline.tracks.some(
    (track) => track.kind !== "subtitle" && track.solo,
  );
  for (const group of timeline.tracks) {
    if (
      group.kind !== "video" &&
      (group.muted || (group.kind !== "subtitle" && solo && !group.solo))
    )
      continue;
    for (const clip of group.clips) {
      const block = (
        code: TimelinePlaybackPlan["blockers"][number]["code"],
        message: string,
      ) => blockers.push({ clipId: clip.id, code, message });
      let version = clip.assetVersion;
      if (clip.audioTrackId) {
        const track = tracks.find((item) => item.id === clip.audioTrackId);
        const source = track?.clips.find(
          (item) => item.id === clip.sourceClipId,
        );
        if (
          !track ||
          track.projectId !== timeline.projectId ||
          track.episodeId !== timeline.episodeId ||
          track.status !== "adopted" ||
          track.stale ||
          track.sourceState !== "current" ||
          (group.kind !== "subtitle" && track.kind !== group.kind) ||
          (group.kind === "subtitle" &&
            track.kind !== "dialogue" &&
            track.kind !== "narration") ||
          track.version !== clip.audioTrackVersion ||
          track.sourceFingerprint !== clip.audioSourceFingerprint ||
          !source ||
          source.shotId !== clip.shotId ||
          (group.kind !== "subtitle" && source.assetId !== clip.assetId)
        ) {
          block(
            "STALE_SOURCE",
            "装配音轨的实际归属、采用状态或冻结版本已变化；须通过逐片段换源核对。",
          );
          continue;
        }
        version = source.sourceVersions?.find(
          (item) => item.kind === "asset" && item.id === clip.assetId,
        )?.version;
        if (clip.assetVersion !== undefined && version !== clip.assetVersion) {
          block(
            "STALE_SOURCE",
            "片段媒体版本与音轨冻结来源不一致，不能自动换成最新素材。",
          );
          continue;
        }
      }
      if (group.kind === "subtitle") continue;
      if (
        !clip.assetId ||
        (clip.mediaStatus !== "linked" && clip.mediaStatus !== "unattached")
      ) {
        block(
          "MISSING_MEDIA",
          "片段缺少明确可读素材或标记为缺失／不支持；不能用空时钟代替实际播放。",
        );
        continue;
      }
      if (version === undefined) {
        block(
          "UNVERIFIED_SOURCE",
          "历史媒体链接没有冻结的实际版本；须明确重新链接，不能猜测最新版本。",
        );
        continue;
      }
      const record = media.get(clip.assetId);
      if (
        !record ||
        record.projectId !== timeline.projectId ||
        record.version !== version
      ) {
        block(
          "STALE_SOURCE",
          "实际素材已移除、跨项目或版本变化；不会代替冻结片段。",
        );
        continue;
      }
      const status = media.sourceStatus(record.id);
      if (
        !status ||
        status.recordId !== record.id ||
        status.recordVersion !== record.version ||
        status.state === "stale" ||
        status.state === "unverified"
      ) {
        block(
          status?.state === "unverified" ? "UNVERIFIED_SOURCE" : "STALE_SOURCE",
          "Media owner 的实际镜头／内容来源已变化或未核验；请先明确复核素材，不从可编辑标记补证明。",
        );
        continue;
      }
      bindings.push({
        clipId: clip.id,
        assetId: record.id,
        assetVersion: version,
        expectedKind: group.kind === "video" ? "visual" : "audio",
        sourceProof: clip.audioTrackId
          ? "audio-source-version"
          : "timeline-asset-version",
      });
    }
  }
  return { timeline, bindings, blockers };
}

export function timelinePlaybackPlanRoute(
  read: (id: string) => TimelineManifest | undefined,
  media: MediaRecordService,
  audio: MediaAudioTrackService,
  workspace: WorkspaceProjectService,
) {
  const query = z.object({
    projectId: z.string().uuid(),
    timelineVersion: z.coerce.number().int().nonnegative(),
  });
  return defineRouteContribution({
    id: "timeline:playback-plan",
    pluginId: "timeline",
    method: "get",
    path: "/api/v2/timelines/{id}/playback-plan",
    operationId: "timeline.playbackPlan",
    declaration: createRoute({
      method: "get",
      path: "/api/v2/timelines/{id}/playback-plan",
      operationId: "timeline.playbackPlan",
      tags: ["timeline"],
      request: { params: z.object({ id: z.string().uuid() }), query },
      responses: {
        200: {
          description:
            "Exact timeline and frozen source proof, not actual bytes or quality",
          content: {
            "application/json": { schema: TimelinePlaybackPlanSchema },
          },
        },
        ...Object.fromEntries(
          [400, 404, 412].map((status) => [
            status,
            {
              description: "Invalid or changed identity",
              content: {
                "application/problem+json": { schema: ProblemDetailsSchema },
              },
            },
          ]),
        ),
      },
    }),
    handler: (request: {
      req: {
        query(name: string): string | undefined;
        param(name: string): string;
      };
    }) => {
      const input = query.safeParse({
        projectId: request.req.query("projectId"),
        timelineVersion: request.req.query("timelineVersion"),
      });
      const problem = (status: number, code: string, title: string) =>
        new Response(
          JSON.stringify({
            type: `https://dramaip.local/problems/${code.toLowerCase()}`,
            status,
            code,
            title,
            detail: title,
            traceId: crypto.randomUUID(),
          }),
          {
            status,
            headers: {
              "Content-Type": "application/problem+json",
              "Cache-Control": "no-store",
            },
          },
        );
      if (!input.success)
        return problem(
          400,
          "VALIDATION_ERROR",
          "须提供实际项目和明确时间线版本。",
        );
      const timeline = read(request.req.param("id"));
      if (
        !workspace.get(input.data.projectId) ||
        !timeline ||
        timeline.projectId !== input.data.projectId
      )
        return problem(404, "NOT_FOUND", "本项目未找到该时间线。");
      if (timeline.version !== input.data.timelineVersion)
        return problem(
          412,
          "PRECONDITION_FAILED",
          "时间线版本已变化，请重新核对。",
        );
      return new Response(
        JSON.stringify(buildTimelinePlaybackPlan(timeline, media, audio)),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ETag: `"timeline:${timeline.id}:${timeline.version}"`,
          },
        },
      );
    },
  });
}
