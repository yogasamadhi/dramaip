import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MEDIA_AUDIO_TRACK_SERVICE,
  MEDIA_RECORD_SERVICE,
  type MediaAudioTrackService,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecord,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  AudioAssemblyApplyInputSchema,
  AudioAssemblyPreviewSchema,
  ExportDocumentSchema,
  TimelineCommandInputSchema,
  TimelineDeliveryManifestSchema,
  TimelineHistoryAvailabilitySchema,
  TimelineManifestSchema,
  TimelineMediaPreviewSchema,
  TIMELINE_SERVICE,
  type AudioAssemblyPreview,
  type TimelineClip,
  type TimelineEditCommand,
  type TimelineManifest,
  type TimelineService,
  type TimelineTrack,
} from "@dramaip/contracts/timeline";
import {
  defineRouteContribution,
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface TimelineRow {
  id: string;
  episode_id: string;
  manifest_json: string;
  undo_json: string;
  redo_json: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
}

type RouteHandler = (context: RouteContext) => Response | Promise<Response>;
const idParams = z.object({ id: z.string().uuid() });
const episodeParams = z.object({ episodeId: z.string().uuid() });
const timelineExportParams = episodeParams.extend({
  format: z.enum(["manifest", "fcpxml", "otio", "edl", "srt", "vtt", "relink"]),
});

function problem(
  context: RouteContext,
  status: number,
  code: string,
  title: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      detail: title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    status,
  );
}

function openapi(input: {
  method: "get" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
}): unknown {
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["timeline"],
    request: {
      ...(input.params ? { params: input.params } : {}),
      ...(input.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: input.body } },
            },
          }
        : {}),
    },
    responses: {
      200: {
        description: "Success",
        content: { "application/json": { schema: input.response } },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      409: {
        description: "Conflict",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  } as never);
}

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  declaration: unknown,
  handler: RouteHandler,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration, handler });
}

function duration(record: ProductionRecord): number {
  const value = Number(
    record.payload["时长秒"] ??
      String(record.payload["时长"] ?? "").replace(/[^\d.]/gu, ""),
  );
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function createInitialTimeline(
  episode: ProductionRecord,
  production: ProductionRecordService,
): TimelineManifest {
  const scripts = production.list("scripts", { parentId: episode.id });
  const scriptIds = new Set(scripts.map((record) => record.id));
  const scenes = production
    .list("scenes", { projectId: episode.projectId })
    .filter((record) => record.parentId && scriptIds.has(record.parentId));
  const sceneIds = new Set(scenes.map((record) => record.id));
  const shots = production
    .list("shots", { projectId: episode.projectId })
    .filter((record) => record.parentId && sceneIds.has(record.parentId));
  let cursor = 0;
  const clips: TimelineClip[] = shots.map((shot) => {
    const startSeconds = cursor;
    const durationSeconds = duration(shot);
    cursor += durationSeconds;
    return {
      id: crypto.randomUUID(),
      sourceClipId: shot.id,
      shotId: shot.id,
      name: shot.title,
      startSeconds,
      durationSeconds,
      sourceOffsetSeconds: 0,
      mediaStatus: "unattached",
      manuallyEdited: false,
    };
  });
  const now = new Date().toISOString();
  const track = (
    kind: TimelineTrack["kind"],
    label: string,
    values: TimelineClip[] = [],
  ): TimelineTrack => ({
    id: crypto.randomUUID(),
    kind,
    label,
    muted: false,
    solo: false,
    clips: values,
  });
  return {
    format: "dramaip-timeline",
    schemaVersion: 1,
    id: crypto.randomUUID(),
    projectId: episode.projectId,
    adaptationId: episode.parentId ?? episode.id,
    episodeId: episode.id,
    sourceFingerprint: JSON.stringify(
      shots.map((shot) => [shot.id, shot.version]),
    ),
    frameRate: 25,
    timebase: "seconds",
    durationSeconds: Math.max(cursor, 1),
    tracks: [
      track("video", "视频", clips),
      track("dialogue", "对白"),
      track("narration", "旁白"),
      track("bgm", "配乐"),
      track("sfx", "音效"),
      track("subtitle", "字幕"),
    ],
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function appendTimelineEvent(
  transaction: UnitOfWorkTransaction,
  action: string,
  timeline: TimelineManifest,
): void {
  transaction.append({
    type: `timeline.${action}.v1`,
    pluginId: "timeline",
    aggregateType: "timeline",
    aggregateId: timeline.id,
    aggregateVersion: timeline.version,
    payload: JSON.parse(JSON.stringify(timeline)),
  });
}

function parseManifest(row: TimelineRow): TimelineManifest {
  return TimelineManifestSchema.parse(JSON.parse(row.manifest_json));
}

function getById(
  context: PluginContext,
  id: string,
): { row: TimelineRow; timeline: TimelineManifest } | undefined {
  return context.uow.execute((transaction) => {
    const row = transaction.get<TimelineRow>(
      "SELECT * FROM timelines WHERE id = ?",
      id,
    );
    return row ? { row, timeline: parseManifest(row) } : undefined;
  });
}

function getOrCreate(
  context: PluginContext,
  episodeId: string,
  production: ProductionRecordService,
): TimelineManifest | undefined {
  const found = context.uow.execute((transaction) =>
    transaction.get<TimelineRow>(
      "SELECT * FROM timelines WHERE episode_id = ?",
      episodeId,
    ),
  );
  if (found) return parseManifest(found);
  const episode = production.get(episodeId);
  if (!episode || episode.kind !== "episodes") return undefined;
  const timeline = createInitialTimeline(episode, production);
  return context.uow.execute((transaction) => {
    const concurrent = transaction.get<TimelineRow>(
      "SELECT * FROM timelines WHERE episode_id = ?",
      episodeId,
    );
    if (concurrent) return parseManifest(concurrent);
    transaction.run(
      "INSERT INTO timelines(id, episode_id, manifest_json, undo_json, redo_json) VALUES (?, ?, ?, '[]', '[]')",
      timeline.id,
      episodeId,
      JSON.stringify(timeline),
    );
    appendTimelineEvent(transaction, "created", timeline);
    return timeline;
  });
}

function findClip(
  timeline: TimelineManifest,
  id: string,
): { track: TimelineTrack; clip: TimelineClip } | undefined {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (clip) return { track, clip };
  }
  return undefined;
}

function applyCommand(
  source: TimelineManifest,
  command: TimelineEditCommand,
): TimelineManifest | undefined {
  const timeline = structuredClone(source);
  if (command.type === "set-track-audio") {
    const track = timeline.tracks.find((item) => item.id === command.trackId);
    if (!track) return undefined;
    if (command.muted !== undefined) track.muted = command.muted;
    if (command.solo !== undefined) track.solo = command.solo;
  } else {
    const found = findClip(timeline, command.clipId);
    if (!found) return undefined;
    if (command.type === "move") {
      found.clip.startSeconds = command.startSeconds;
      found.clip.manuallyEdited = true;
    }
    if (command.type === "trim") {
      if (command.startSeconds !== undefined)
        found.clip.startSeconds = command.startSeconds;
      found.clip.durationSeconds = command.durationSeconds;
      found.clip.manuallyEdited = true;
    }
    if (command.type === "relink") {
      found.clip.assetId = command.assetId;
      found.clip.mediaStatus = "linked";
      found.clip.manuallyEdited = true;
    }
    if (command.type === "set-clip-audio") {
      if (command.volume !== undefined) found.clip.volume = command.volume;
      if (command.locked !== undefined) found.clip.locked = command.locked;
      found.clip.manuallyEdited = true;
    }
    if (command.type === "split") {
      const relative = command.atSeconds - found.clip.startSeconds;
      if (relative <= 0 || relative >= found.clip.durationSeconds)
        return undefined;
      const second = {
        ...structuredClone(found.clip),
        id: crypto.randomUUID(),
        startSeconds: command.atSeconds,
        durationSeconds: found.clip.durationSeconds - relative,
        sourceOffsetSeconds: found.clip.sourceOffsetSeconds + relative,
        manuallyEdited: true,
      };
      found.clip.durationSeconds = relative;
      found.clip.manuallyEdited = true;
      const index = found.track.clips.indexOf(found.clip);
      found.track.clips.splice(index + 1, 0, second);
    }
  }
  timeline.durationSeconds = Math.max(
    1,
    ...timeline.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startSeconds + clip.durationSeconds),
    ),
  );
  return timeline;
}

function saveForward(
  context: PluginContext,
  current: TimelineManifest,
  next: TimelineManifest,
  action: string,
): TimelineManifest | "conflict" {
  return context.uow.execute((transaction) => {
    const row = transaction.get<TimelineRow>(
      "SELECT * FROM timelines WHERE id = ?",
      current.id,
    );
    if (!row || parseManifest(row).version !== current.version)
      return "conflict" as const;
    const undo = JSON.parse(row.undo_json) as TimelineManifest[];
    undo.push(current);
    next.version = current.version + 1;
    next.createdAt = current.createdAt;
    next.updatedAt = new Date().toISOString();
    transaction.run(
      "UPDATE timelines SET manifest_json = ?, undo_json = ?, redo_json = '[]' WHERE id = ?",
      JSON.stringify(next),
      JSON.stringify(undo.slice(-100)),
      current.id,
    );
    appendTimelineEvent(transaction, action, next);
    return next;
  });
}

function restoreHistory(
  context: PluginContext,
  id: string,
  direction: "undo" | "redo",
): TimelineManifest | undefined {
  return context.uow.execute((transaction) => {
    const row = transaction.get<TimelineRow>(
      "SELECT * FROM timelines WHERE id = ?",
      id,
    );
    if (!row) return undefined;
    const current = parseManifest(row);
    const undo = JSON.parse(row.undo_json) as TimelineManifest[];
    const redo = JSON.parse(row.redo_json) as TimelineManifest[];
    const source = direction === "undo" ? undo : redo;
    const destination = direction === "undo" ? redo : undo;
    const restored = source.pop();
    if (!restored) return undefined;
    destination.push(current);
    restored.version = current.version + 1;
    restored.updatedAt = new Date().toISOString();
    transaction.run(
      "UPDATE timelines SET manifest_json = ?, undo_json = ?, redo_json = ? WHERE id = ?",
      JSON.stringify(restored),
      JSON.stringify(undo.slice(-100)),
      JSON.stringify(redo.slice(-100)),
      id,
    );
    appendTimelineEvent(transaction, direction, restored);
    return restored;
  });
}

function timecode(seconds: number): string {
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return (
    [hours, minutes, secs]
      .map((value) => String(value).padStart(2, "0"))
      .join(":") + `,${String(millis).padStart(3, "0")}`
  );
}

function frameTimecode(seconds: number): string {
  const frames = Math.max(0, Math.round(seconds * 25));
  const hours = Math.floor(frames / 90_000);
  const minutes = Math.floor((frames % 90_000) / 1_500);
  const secs = Math.floor((frames % 1_500) / 25);
  const remainder = frames % 25;
  return [hours, minutes, secs, remainder]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function exportDocument(
  timeline: TimelineManifest,
  media: MediaRecordService,
  format: z.infer<typeof timelineExportParams>["format"],
) {
  const manifest = deliveryManifest(timeline, media);
  const base = `timeline-${timeline.episodeId}-v${timeline.version}`;
  const videoClips = timeline.tracks
    .filter((track) => track.kind === "video")
    .flatMap((track) => track.clips)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const subtitles = timeline.tracks
    .filter((track) => track.kind === "subtitle")
    .flatMap((track) => track.clips)
    .filter((clip) => clip.text?.trim())
    .sort((left, right) => left.startSeconds - right.startSeconds);
  if (format === "manifest")
    return {
      fileName: `${base}-delivery-manifest.json`,
      mimeType: "application/json",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    };
  if (format === "fcpxml") {
    const clips = videoClips
      .map(
        (clip) =>
          `        <gap name="${escapeXml(clip.name)}" offset="${Math.round(clip.startSeconds * 25)}/25s" duration="${Math.max(1, Math.round(clip.durationSeconds * 25))}/25s" />`,
      )
      .join("\n");
    return {
      fileName: `${base}.fcpxml`,
      mimeType: "application/xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<fcpxml version="1.10"><resources><format id="r1" frameDuration="1/25s" width="1080" height="1920" /></resources><library><event name="DramaIP"><project name="${escapeXml(base)}"><sequence format="r1" duration="${Math.max(1, Math.round(timeline.durationSeconds * 25))}/25s"><spine>\n${clips}\n</spine></sequence></project></event></library></fcpxml>\n`,
    };
  }
  if (format === "otio")
    return {
      fileName: `${base}.otio`,
      mimeType: "application/json",
      content: `${JSON.stringify(
        {
          OTIO_SCHEMA: "Timeline.1",
          name: base,
          tracks: {
            OTIO_SCHEMA: "Stack.1",
            children: timeline.tracks.map((track) => ({
              OTIO_SCHEMA: "Track.1",
              name: track.label,
              kind:
                track.kind === "video" || track.kind === "subtitle"
                  ? "Video"
                  : "Audio",
              children: track.clips.map((clip) => ({
                OTIO_SCHEMA: "Clip.2",
                name: clip.name,
                source_range: {
                  OTIO_SCHEMA: "TimeRange.1",
                  start_time: {
                    OTIO_SCHEMA: "RationalTime.1",
                    value: Math.round(clip.sourceOffsetSeconds * 25),
                    rate: 25,
                  },
                  duration: {
                    OTIO_SCHEMA: "RationalTime.1",
                    value: Math.max(1, Math.round(clip.durationSeconds * 25)),
                    rate: 25,
                  },
                },
                media_reference: { OTIO_SCHEMA: "MissingReference.1" },
                metadata: {
                  dramaip: {
                    clipId: clip.id,
                    timelineStartFrames: Math.round(clip.startSeconds * 25),
                  },
                },
              })),
            })),
          },
        },
        null,
        2,
      )}\n`,
    };
  if (format === "edl")
    return {
      fileName: `${base}.edl`,
      mimeType: "text/plain",
      content: [
        `TITLE: ${base}`,
        "FCM: NON-DROP FRAME",
        "",
        ...videoClips.flatMap((clip, index) => [
          `${String(index + 1).padStart(3, "0")}  AX       V     C        ${frameTimecode(clip.sourceOffsetSeconds)} ${frameTimecode(clip.sourceOffsetSeconds + clip.durationSeconds)} ${frameTimecode(clip.startSeconds)} ${frameTimecode(clip.startSeconds + clip.durationSeconds)}`,
          `* FROM CLIP NAME: ${clip.name}`,
        ]),
        "",
      ].join("\n"),
    };
  if (format === "srt" || format === "vtt") {
    const content = subtitles
      .map((clip, index) => {
        const start = timecode(clip.startSeconds);
        const end = timecode(clip.startSeconds + clip.durationSeconds);
        return `${index + 1}\n${format === "vtt" ? start.replace(",", ".") : start} --> ${format === "vtt" ? end.replace(",", ".") : end}\n${clip.text!.trim()}`;
      })
      .join("\n\n");
    return {
      fileName: `${base}.${format}`,
      mimeType: format === "srt" ? "application/x-subrip" : "text/vtt",
      content: `${format === "vtt" ? "WEBVTT\n\n" : ""}${content}${content ? "\n" : ""}`,
    };
  }
  return {
    fileName: `${base}-media-relink.json`,
    mimeType: "application/json",
    content: `${JSON.stringify(
      {
        format: "dramaip-media-relink",
        schemaVersion: 1,
        timelineId: timeline.id,
        timelineVersion: timeline.version,
        media: manifest.media,
        unsupportedFeatures: manifest.unsupportedFeatures,
      },
      null,
      2,
    )}\n`,
  };
}

function assembly(
  timeline: TimelineManifest,
  audioTracks: MediaAudioTrackService,
): AudioAssemblyPreview {
  const tracks = audioTracks
    .list(timeline.episodeId)
    .filter((track) => track.status === "adopted");
  const clips = tracks.flatMap((track) =>
    track.clips.map((clip) => ({
      id: clip.id,
      audioTrackId: track.id,
      sourceClipId: clip.id,
      kind: track.kind,
      name: track.label,
      ...(clip.shotId ? { shotId: clip.shotId } : {}),
      ...(clip.assetId ? { assetId: clip.assetId } : {}),
      ...(clip.voiceProfileId ? { voiceProfileId: clip.voiceProfileId } : {}),
      ...(clip.text ? { text: clip.text } : {}),
      startSeconds: clip.startSeconds,
      durationSeconds: clip.durationSeconds,
      volume: track.kind === "bgm" ? 0.7 : 1,
      fadeInSeconds: track.kind === "bgm" ? 0.3 : 0,
      fadeOutSeconds: track.kind === "bgm" ? 0.3 : 0,
      ...(track.kind === "bgm" ? { duckingGain: 0.55 } : {}),
      overflowSeconds: Math.max(
        0,
        clip.startSeconds + clip.durationSeconds - timeline.durationSeconds,
      ),
      provider: "manual",
      rightsStatus: "unknown" as const,
    })),
  );
  const subtitleCues = clips
    .filter(
      (clip) =>
        (clip.kind === "dialogue" || clip.kind === "narration") && clip.text,
    )
    .map((clip) => ({
      id: crypto.randomUUID(),
      audioTrackId: clip.audioTrackId,
      sourceClipId: clip.sourceClipId,
      ...(clip.shotId ? { shotId: clip.shotId } : {}),
      startSeconds: clip.startSeconds,
      durationSeconds: clip.durationSeconds,
      text: clip.text!,
    }));
  const srt = subtitleCues
    .map(
      (cue, index) =>
        `${index + 1}\n${timecode(cue.startSeconds)} --> ${timecode(cue.startSeconds + cue.durationSeconds)}\n${cue.text}\n`,
    )
    .join("\n");
  return {
    timelineId: timeline.id,
    timelineVersion: timeline.version,
    sourceFingerprint: JSON.stringify(
      tracks.map((track) => [track.id, track.version]),
    ),
    clips,
    subtitleCues,
    srt,
    webVtt: `WEBVTT\n\n${srt.replace(/,/gu, ".")}`,
    warnings: clips.length ? ["部分音轨权利待核验。"] : [],
    protectedClipIds: timeline.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.locked)
      .map((clip) => clip.id),
    staleTrackIds: tracks
      .filter((track) => track.stale)
      .map((track) => track.id),
  };
}

function deliveryManifest(
  timeline: TimelineManifest,
  media: MediaRecordService,
) {
  const assetIds = [
    ...new Set(
      timeline.tracks
        .flatMap((track) => track.clips)
        .flatMap((clip) => (clip.assetId ? [clip.assetId] : [])),
    ),
  ];
  return {
    format: "dramaip-timeline-delivery" as const,
    schemaVersion: 1 as const,
    timeline,
    media: assetIds.flatMap((assetId) => {
      const record = media.get(assetId);
      return record
        ? [
            {
              assetId,
              title: record.title,
              sourceVersion: record.version,
              relativePath: `media/${assetId}`,
              mediaStatus: "unattached" as const,
              rightsStatus:
                record.payload["权利状态"] === "已核验"
                  ? ("cleared" as const)
                  : ("unknown" as const),
              lineage: [record.kind, record.id],
            },
          ]
        : [];
    }),
    unsupportedFeatures: ["timeline_render"],
    warnings: assetIds.length
      ? []
      : ["时间线当前只包含受控引用，媒体需在剪辑软件中重新链接。"],
  };
}

function timelineRoutes(
  context: PluginContext,
  production: ProductionRecordService,
  media: MediaRecordService,
  audioTracks: MediaAudioTrackService,
): RouteContribution[] {
  const getTimeline = (episodeId: string) =>
    getOrCreate(context, episodeId, production);
  const routes: RouteContribution[] = [
    route(
      {
        id: "timeline:get",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/timeline",
        operationId: "timeline.get",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/timeline",
        operationId: "timeline.get",
        params: episodeParams,
        response: TimelineManifestSchema,
      }),
      (requestContext) => {
        const value = getTimeline(requestContext.req.param("episodeId"));
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到分集。");
      },
    ),
    route(
      {
        id: "timeline:command",
        pluginId: "timeline",
        method: "post",
        path: "/api/v2/timelines/{id}/commands",
        operationId: "timeline.command",
      },
      openapi({
        method: "post",
        path: "/api/v2/timelines/{id}/commands",
        operationId: "timeline.command",
        params: idParams,
        body: TimelineCommandInputSchema,
        response: TimelineManifestSchema,
      }),
      async (requestContext) => {
        const input = TimelineCommandInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const found = getById(context, requestContext.req.param("id"));
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "时间线命令无效。",
          );
        if (!found)
          return problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
        if (input.data.version !== found.timeline.version)
          return problem(requestContext, 409, "CONFLICT", "时间线版本已更新。");
        const next = applyCommand(found.timeline, input.data.command);
        if (!next)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "时间线命令无法应用。",
          );
        const saved = saveForward(context, found.timeline, next, "commanded");
        return saved === "conflict"
          ? problem(requestContext, 409, "CONFLICT", "时间线版本已更新。")
          : requestContext.json(saved);
      },
    ),
    ...[
      {
        direction: "undo" as const,
        id: "timeline:undo",
        path: "/api/v2/timelines/{id}/undo" as const,
        operationId: "timeline.undo",
      },
      {
        direction: "redo" as const,
        id: "timeline:redo",
        path: "/api/v2/timelines/{id}/redo" as const,
        operationId: "timeline.redo",
      },
    ].map(({ direction, id, path, operationId }) =>
      route(
        {
          id,
          pluginId: "timeline",
          method: "post",
          path,
          operationId,
        },
        openapi({
          method: "post",
          path,
          operationId,
          params: idParams,
          response: TimelineManifestSchema,
        }),
        (requestContext) => {
          const value = restoreHistory(
            context,
            requestContext.req.param("id"),
            direction,
          );
          return value
            ? requestContext.json(value)
            : problem(
                requestContext,
                409,
                "HISTORY_EMPTY",
                direction === "undo" ? "没有可撤销操作。" : "没有可重做操作。",
              );
        },
      ),
    ),
    route(
      {
        id: "timeline:media-preview",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/timeline-media/{id}/preview",
        operationId: "timeline.preview",
      },
      openapi({
        method: "get",
        path: "/api/v2/timeline-media/{id}/preview",
        operationId: "timeline.preview",
        params: idParams,
        response: TimelineMediaPreviewSchema,
      }),
      (requestContext) => {
        const value = media.get(requestContext.req.param("id"));
        const dataUrl = value?.payload["预览数据"];
        const kind = value?.payload["预览类型"];
        if (
          !value ||
          typeof dataUrl !== "string" ||
          !dataUrl.startsWith("data:") ||
          (kind !== "image" && kind !== "audio" && kind !== "video")
        )
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "该媒体没有可用的安全预览。",
          );
        return requestContext.json({ id: value.id, kind, dataUrl });
      },
    ),
    route(
      {
        id: "timeline:history",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/timelines/{id}/history",
        operationId: "timeline.history",
      },
      openapi({
        method: "get",
        path: "/api/v2/timelines/{id}/history",
        operationId: "timeline.history",
        params: idParams,
        response: TimelineHistoryAvailabilitySchema,
      }),
      (requestContext) => {
        const found = getById(context, requestContext.req.param("id"));
        return found
          ? requestContext.json({
              canUndo:
                (JSON.parse(found.row.undo_json) as unknown[]).length > 0,
              canRedo:
                (JSON.parse(found.row.redo_json) as unknown[]).length > 0,
            })
          : problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
      },
    ),
    route(
      {
        id: "timeline:delivery-manifest",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/timeline-delivery/manifest",
        operationId: "timeline.deliveryManifest",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/timeline-delivery/manifest",
        operationId: "timeline.deliveryManifest",
        params: episodeParams,
        response: TimelineDeliveryManifestSchema,
      }),
      (requestContext) => {
        const timeline = getTimeline(requestContext.req.param("episodeId"));
        return timeline
          ? requestContext.json(deliveryManifest(timeline, media))
          : problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
      },
    ),
    route(
      {
        id: "timeline:audio-assembly-preview",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/audio-assembly/preview",
        operationId: "timeline.audioAssemblyPreview",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/audio-assembly/preview",
        operationId: "timeline.audioAssemblyPreview",
        params: episodeParams,
        response: AudioAssemblyPreviewSchema,
      }),
      (requestContext) => {
        const timeline = getTimeline(requestContext.req.param("episodeId"));
        return timeline
          ? requestContext.json(assembly(timeline, audioTracks))
          : problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
      },
    ),
    route(
      {
        id: "timeline:audio-assembly-apply",
        pluginId: "timeline",
        method: "post",
        path: "/api/v2/episodes/{episodeId}/audio-assembly/apply",
        operationId: "timeline.applyAudioAssembly",
      },
      openapi({
        method: "post",
        path: "/api/v2/episodes/{episodeId}/audio-assembly/apply",
        operationId: "timeline.applyAudioAssembly",
        params: episodeParams,
        body: AudioAssemblyApplyInputSchema,
        response: TimelineManifestSchema,
      }),
      async (requestContext) => {
        const input = AudioAssemblyApplyInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = getTimeline(requestContext.req.param("episodeId"));
        if (!input.success || !current)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "音频编排参数无效。",
          );
        if (input.data.timelineVersion !== current.version)
          return problem(requestContext, 409, "CONFLICT", "时间线版本已更新。");
        const preview = assembly(current, audioTracks);
        const chosen = preview.clips.filter((clip) =>
          input.data.audioTrackIds.includes(clip.audioTrackId),
        );
        const next = structuredClone(current);
        for (const kind of ["dialogue", "narration", "bgm", "sfx"] as const) {
          const track = next.tracks.find((item) => item.kind === kind)!;
          const locked = track.clips.filter((clip) => clip.locked);
          track.clips = [
            ...locked,
            ...chosen
              .filter((clip) => clip.kind === kind)
              .filter(
                (clip) =>
                  !locked.some(
                    (protectedClip) =>
                      protectedClip.audioTrackId === clip.audioTrackId,
                  ),
              )
              .map((clip) => ({
                id: crypto.randomUUID(),
                sourceClipId: clip.sourceClipId,
                audioTrackId: clip.audioTrackId,
                ...(clip.shotId ? { shotId: clip.shotId } : {}),
                ...(clip.assetId ? { assetId: clip.assetId } : {}),
                name: clip.name,
                startSeconds: clip.startSeconds,
                durationSeconds: clip.durationSeconds,
                sourceOffsetSeconds: 0,
                mediaStatus: clip.assetId
                  ? ("linked" as const)
                  : ("unattached" as const),
                ...(clip.text ? { text: clip.text } : {}),
                volume: clip.volume,
                fadeInSeconds: clip.fadeInSeconds,
                fadeOutSeconds: clip.fadeOutSeconds,
                ...(clip.duckingGain !== undefined
                  ? { duckingGain: clip.duckingGain }
                  : {}),
                manuallyEdited: false,
              })),
          ];
        }
        const subtitle = next.tracks.find(
          (track) => track.kind === "subtitle",
        )!;
        if (input.data.includeSubtitles)
          subtitle.clips = preview.subtitleCues.map((cue) => ({
            id: crypto.randomUUID(),
            sourceClipId: cue.sourceClipId,
            audioTrackId: cue.audioTrackId,
            ...(cue.shotId ? { shotId: cue.shotId } : {}),
            name: cue.text,
            text: cue.text,
            startSeconds: cue.startSeconds,
            durationSeconds: cue.durationSeconds,
            sourceOffsetSeconds: 0,
            mediaStatus: "unattached",
            manuallyEdited: false,
          }));
        const saved = saveForward(context, current, next, "audio-assembled");
        return saved === "conflict"
          ? problem(requestContext, 409, "CONFLICT", "时间线版本已更新。")
          : requestContext.json(saved);
      },
    ),
  ];

  routes.push(
    route(
      {
        id: "timeline:export-delivery",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/timeline-delivery/export/{format}",
        operationId: "timeline.exportDelivery",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/timeline-delivery/export/{format}",
        operationId: "timeline.exportDelivery",
        params: timelineExportParams,
        response: ExportDocumentSchema,
      }),
      (requestContext) => {
        const params = timelineExportParams.safeParse({
          episodeId: requestContext.req.param("episodeId"),
          format: requestContext.req.param("format"),
        });
        if (!params.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "不支持的时间线导出格式。",
          );
        const timeline = getTimeline(params.data.episodeId);
        return timeline
          ? requestContext.json(
              exportDocument(timeline, media, params.data.format),
            )
          : problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
      },
    ),
  );
  return routes;
}

const timelineMigrations = [
  {
    id: "timeline.0001.canonical",
    pluginId: "timeline",
    version: "3.0.0-alpha.3",
    dependsOn: ["media.0001.records"],
    sql: `
      CREATE TABLE IF NOT EXISTS timelines (
        id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL UNIQUE,
        manifest_json TEXT NOT NULL,
        undo_json TEXT NOT NULL DEFAULT '[]',
        redo_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS timelines_episode
        ON timelines(episode_id);
    `,
  },
] as const;

export const timelinePlugin = defineFirstPartyPlugin({
  descriptor: {
    id: "timeline",
    version: "3.0.0-alpha.3",
    apiVersion: "2",
    requires: ["foundation", "production", "media"],
    provides: ["timeline.canonical", "timeline.audio-assembly"],
    stability: "internal",
  },
  ui: [
    {
      id: "timeline.editor.canonical",
      pluginId: "timeline",
      kind: "editor",
      metadata: { target: "episode", title: "多轨时间线" },
    },
    {
      id: "timeline.toolbar.commands",
      pluginId: "timeline",
      kind: "toolbar",
      metadata: { slot: "timeline.toolbar", title: "时间线命令" },
    },
  ],
  migrations: timelineMigrations,
  activate: (context) => {
    const production = context.services.optional<ProductionRecordService>(
      PRODUCTION_RECORD_SERVICE,
    );
    const media =
      context.services.optional<MediaRecordService>(MEDIA_RECORD_SERVICE);
    const audioTracks = context.services.optional<MediaAudioTrackService>(
      MEDIA_AUDIO_TRACK_SERVICE,
    );
    if (!production || !media || !audioTracks)
      throw new Error("timeline requires production and media services");
    const service: TimelineService = {
      get: (episodeId) => getOrCreate(context, episodeId, production),
    };
    context.effect(`service:${TIMELINE_SERVICE}`, () =>
      context.services.provide(TIMELINE_SERVICE, service),
    );
    for (const contribution of timelineRoutes(
      context,
      production,
      media,
      audioTracks,
    ))
      context.effect(`route:${contribution.id}`, () =>
        context.http.register(contribution),
      );
  },
});
