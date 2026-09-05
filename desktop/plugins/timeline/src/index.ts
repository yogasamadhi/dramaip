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
  TimelineRenderCreateInputSchema,
  TimelineRenderJobSchema,
  TimelineRenderPreflightSchema,
  TIMELINE_SERVICE,
  type AudioAssemblyPreview,
  type TimelineClip,
  type TimelineEditCommand,
  type TimelineManifest,
  type TimelineRenderJob,
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
import type {
  DesktopHostClient,
  HostTimelineRenderJob,
} from "@dramaip/desktop-host";
import { z, type ZodType } from "zod";

interface TimelineRow {
  id: string;
  episode_id: string;
  manifest_json: string;
  undo_json: string;
  redo_json: string;
}

interface TimelineRenderRow {
  id: string;
  timeline_id: string;
  timeline_version: number;
  timeline_profile_version: string;
  renderer_version: string;
  sidecar_artifact_version: string;
  idempotency_key: string;
  status: TimelineRenderJob["status"];
  progress: number;
  output_media_ref: string | null;
  output_sha256: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
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

function sseOpenapi(input: {
  path: string;
  operationId: string;
  params: ZodType;
}): unknown {
  return createRoute({
    method: "get",
    path: input.path,
    operationId: input.operationId,
    tags: ["timeline"],
    request: { params: input.params },
    responses: {
      200: {
        description: "Replayable render event stream",
        content: { "text/event-stream": { schema: z.string() } },
      },
      404: {
        description: "Not found",
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

const P0_TIMELINE_PROFILE = {
  width: 1080,
  height: 1920,
  frameRate: { numerator: 25, denominator: 1, dropFrame: false },
  audioSampleRate: 48_000,
  channels: 2,
} as const;

const framesFromSeconds = (seconds: number): number =>
  Math.max(0, Math.round(seconds * 25));
const secondsFromFrames = (frames: number): number => frames / 25;

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
  const videoTrackId = crypto.randomUUID();
  let cursorFrame = 0;
  const clips: TimelineClip[] = shots.map((shot) => {
    const startFrame = cursorFrame;
    const durationFrames = Math.max(1, framesFromSeconds(duration(shot)));
    cursorFrame += durationFrames;
    return {
      id: crypto.randomUUID(),
      sourceClipId: shot.id,
      shotId: shot.id,
      trackId: videoTrackId,
      name: shot.title,
      startFrame,
      durationFrames,
      sourceOffsetFrame: 0,
      mediaStatus: "unattached",
      manuallyEdited: false,
    };
  });
  const now = new Date().toISOString();
  const track = (
    kind: TimelineTrack["kind"],
    label: string,
    values: TimelineClip[] = [],
    id = crypto.randomUUID(),
  ): TimelineTrack => ({
    id,
    kind,
    label,
    muted: false,
    solo: false,
    clips: values,
  });
  return {
    format: "dramaip-timeline",
    schemaVersion: 2,
    id: crypto.randomUUID(),
    projectId: episode.projectId,
    adaptationId: episode.parentId ?? episode.id,
    episodeId: episode.id,
    sourceFingerprint: JSON.stringify(
      shots.map((shot) => [shot.id, shot.version]),
    ),
    profile: P0_TIMELINE_PROFILE,
    timebase: "frames",
    durationFrames: Math.max(cursorFrame, 1),
    migrationWarnings: [],
    tracks: [
      track("video", "视频", clips, videoTrackId),
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

export function normalizeTimelineManifest(value: unknown): TimelineManifest {
  if (
    value &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2
  ) {
    return TimelineManifestSchema.parse(value);
  }
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    throw new Error("unsupported timeline manifest schema");
  }
  const legacy = value as Record<string, unknown>;
  const legacyTracks = Array.isArray(legacy["tracks"])
    ? (legacy["tracks"] as Array<Record<string, unknown>>)
    : [];
  let maximumDeviation = 0;
  const tracks = legacyTracks.map((track) => {
    const trackId = String(track["id"] ?? "");
    const clips = Array.isArray(track["clips"])
      ? (track["clips"] as Array<Record<string, unknown>>).map((clip) => {
          const startSeconds = Number(clip["startSeconds"] ?? 0);
          const durationSeconds = Number(clip["durationSeconds"] ?? 0);
          const sourceOffsetSeconds = Number(clip["sourceOffsetSeconds"] ?? 0);
          const startFrame = framesFromSeconds(startSeconds);
          const durationFrames = Math.max(
            1,
            framesFromSeconds(durationSeconds),
          );
          const sourceOffsetFrame = framesFromSeconds(sourceOffsetSeconds);
          maximumDeviation = Math.max(
            maximumDeviation,
            Math.abs(secondsFromFrames(startFrame) - startSeconds),
            Math.abs(secondsFromFrames(durationFrames) - durationSeconds),
            Math.abs(
              secondsFromFrames(sourceOffsetFrame) - sourceOffsetSeconds,
            ),
          );
          const migrated = { ...clip };
          delete migrated["startSeconds"];
          delete migrated["durationSeconds"];
          delete migrated["sourceOffsetSeconds"];
          if (typeof migrated["fadeInSeconds"] === "number") {
            migrated["fadeInFrames"] = framesFromSeconds(
              migrated["fadeInSeconds"] as number,
            );
            delete migrated["fadeInSeconds"];
          }
          if (typeof migrated["fadeOutSeconds"] === "number") {
            migrated["fadeOutFrames"] = framesFromSeconds(
              migrated["fadeOutSeconds"] as number,
            );
            delete migrated["fadeOutSeconds"];
          }
          return {
            ...migrated,
            trackId,
            startFrame,
            durationFrames,
            sourceOffsetFrame,
          };
        })
      : [];
    return { ...track, clips };
  });
  const durationFrames = Math.max(
    1,
    ...tracks.flatMap((track) =>
      (track.clips as Array<Record<string, unknown>>).map(
        (clip) =>
          Number(clip["startFrame"] ?? 0) + Number(clip["durationFrames"] ?? 0),
      ),
    ),
  );
  const migrated = { ...legacy };
  delete migrated["frameRate"];
  delete migrated["durationSeconds"];
  return TimelineManifestSchema.parse({
    ...migrated,
    schemaVersion: 2,
    profile: P0_TIMELINE_PROFILE,
    timebase: "frames",
    durationFrames,
    tracks,
    migrationWarnings: [
      `旧秒制时间线已按 round(seconds × 25) 转换；最大偏差 ${maximumDeviation.toFixed(6)} 秒。`,
    ],
  });
}

function parseManifest(row: TimelineRow): TimelineManifest {
  return normalizeTimelineManifest(JSON.parse(row.manifest_json));
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
      found.clip.startFrame = command.startFrame;
      found.clip.manuallyEdited = true;
    }
    if (command.type === "trim") {
      if (command.startFrame !== undefined)
        found.clip.startFrame = command.startFrame;
      found.clip.durationFrames = command.durationFrames;
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
      const relative = command.atFrame - found.clip.startFrame;
      if (relative <= 0 || relative >= found.clip.durationFrames)
        return undefined;
      const second = {
        ...structuredClone(found.clip),
        id: crypto.randomUUID(),
        startFrame: command.atFrame,
        durationFrames: found.clip.durationFrames - relative,
        sourceOffsetFrame: found.clip.sourceOffsetFrame + relative,
        manuallyEdited: true,
      };
      found.clip.durationFrames = relative;
      found.clip.manuallyEdited = true;
      const index = found.track.clips.indexOf(found.clip);
      found.track.clips.splice(index + 1, 0, second);
    }
  }
  timeline.durationFrames = Math.max(
    1,
    ...timeline.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startFrame + clip.durationFrames),
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
    const undo = (JSON.parse(row.undo_json) as unknown[]).map(
      normalizeTimelineManifest,
    );
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
    const undo = (JSON.parse(row.undo_json) as unknown[]).map(
      normalizeTimelineManifest,
    );
    const redo = (JSON.parse(row.redo_json) as unknown[]).map(
      normalizeTimelineManifest,
    );
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

function frameTimecode(frame: number): string {
  const frames = Math.max(0, Math.round(frame));
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

function rationalTime(value: number) {
  return { OTIO_SCHEMA: "RationalTime.1", value, rate: 25 };
}

function timeRange(startFrame: number, durationFrames: number) {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rationalTime(startFrame),
    duration: rationalTime(durationFrames),
  };
}

function otioTrackChildren(
  track: TimelineTrack,
  mediaPaths: ReadonlyMap<string, string>,
): Array<Record<string, unknown>> {
  const children: Array<Record<string, unknown>> = [];
  let cursorFrame = 0;
  for (const clip of [...track.clips].sort(
    (left, right) => left.startFrame - right.startFrame,
  )) {
    const startFrame = clip.startFrame;
    const durationFrames = clip.durationFrames;
    if (startFrame > cursorFrame) {
      children.push({
        OTIO_SCHEMA: "Gap.1",
        name: "DramaIP gap",
        source_range: timeRange(0, startFrame - cursorFrame),
      });
    }
    const relativePath = clip.assetId
      ? mediaPaths.get(clip.assetId)
      : undefined;
    if (!relativePath) {
      children.push({
        OTIO_SCHEMA: "Gap.1",
        name: clip.name,
        source_range: timeRange(0, durationFrames),
        metadata: {
          dramaip: { clipId: clip.id, timelineStartFrames: startFrame },
        },
      });
    } else {
      children.push({
        OTIO_SCHEMA: "Clip.2",
        name: clip.name,
        source_range: timeRange(clip.sourceOffsetFrame, durationFrames),
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          target_url: relativePath,
          available_range: null,
        },
        metadata: {
          dramaip: { clipId: clip.id, timelineStartFrames: startFrame },
        },
      });
    }
    cursorFrame = Math.max(cursorFrame, startFrame + durationFrames);
  }
  return children;
}

function edlReel(assetId?: string): string {
  return assetId ? assetId.replaceAll("-", "").slice(0, 8).toUpperCase() : "AX";
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
    .sort((left, right) => left.startFrame - right.startFrame);
  const subtitles = timeline.tracks
    .filter((track) => track.kind === "subtitle")
    .flatMap((track) => track.clips)
    .filter((clip) => clip.text?.trim())
    .sort((left, right) => left.startFrame - right.startFrame);
  const mediaPaths = new Map(
    manifest.media.map((item) => [item.assetId, item.relativePath]),
  );
  if (format === "manifest")
    return {
      fileName: `${base}-delivery-manifest.json`,
      mimeType: "application/json",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    };
  if (format === "fcpxml") {
    const referencedAssets = videoClips.flatMap((clip) => {
      const relativePath = clip.assetId
        ? mediaPaths.get(clip.assetId)
        : undefined;
      return relativePath && clip.assetId
        ? [{ id: `asset-${clip.assetId}`, path: relativePath, name: clip.name }]
        : [];
    });
    const resources = [
      '<format id="r1" frameDuration="1/25s" width="1080" height="1920" />',
      ...referencedAssets.map(
        (asset) =>
          `<asset id="${asset.id}" name="${escapeXml(asset.name)}" src="${escapeXml(asset.path)}" />`,
      ),
    ].join("");
    const clips = videoClips
      .map((clip) => {
        const offset = clip.startFrame;
        const durationFrames = clip.durationFrames;
        const source = clip.sourceOffsetFrame;
        const relativePath = clip.assetId
          ? mediaPaths.get(clip.assetId)
          : undefined;
        return relativePath && clip.assetId
          ? `        <asset-clip name="${escapeXml(clip.name)}" ref="asset-${clip.assetId}" offset="${offset}/25s" start="${source}/25s" duration="${durationFrames}/25s" />`
          : `        <gap name="${escapeXml(clip.name)}" offset="${offset}/25s" duration="${durationFrames}/25s" />`;
      })
      .join("\n");
    return {
      fileName: `${base}.fcpxml`,
      mimeType: "application/xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<fcpxml version="1.10"><resources>${resources}</resources><library><event name="DramaIP"><project name="${escapeXml(base)}"><sequence format="r1" duration="${timeline.durationFrames}/25s"><spine>\n${clips}\n</spine></sequence></project></event></library></fcpxml>\n`,
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
              children: otioTrackChildren(track, mediaPaths),
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
          `${String(index + 1).padStart(3, "0")}  ${edlReel(clip.assetId)} V     C        ${frameTimecode(clip.sourceOffsetFrame)} ${frameTimecode(clip.sourceOffsetFrame + clip.durationFrames)} ${frameTimecode(clip.startFrame)} ${frameTimecode(clip.startFrame + clip.durationFrames)}`,
          `* FROM CLIP NAME: ${clip.name}`,
        ]),
        "",
      ].join("\n"),
    };
  if (format === "srt" || format === "vtt") {
    const content = subtitles
      .map((clip, index) => {
        const start = timecode(secondsFromFrames(clip.startFrame));
        const end = timecode(
          secondsFromFrames(clip.startFrame + clip.durationFrames),
        );
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
        clip.startSeconds +
          clip.durationSeconds -
          secondsFromFrames(timeline.durationFrames),
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
    schemaVersion: 2 as const,
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

const P0_PROFILE_VERSION = "1080x1920-25-48000-stereo-v1";

function timelineEtag(timeline: TimelineManifest): string {
  return `"timeline:${timeline.id}:${timeline.version}"`;
}

function toRenderJob(row: TimelineRenderRow): TimelineRenderJob {
  return {
    jobId: row.id,
    timelineId: row.timeline_id,
    timelineVersion: row.timeline_version,
    timelineProfileVersion: row.timeline_profile_version,
    rendererVersion: row.renderer_version,
    sidecarArtifactVersion: row.sidecar_artifact_version,
    status: row.status,
    progress: row.progress,
    ...(row.output_media_ref ? { outputMediaRef: row.output_media_ref } : {}),
    ...(row.output_sha256 ? { outputSha256: row.output_sha256 } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function videoRenderClips(timeline: TimelineManifest) {
  return timeline.tracks
    .filter((track) => track.kind === "video" && !track.muted)
    .flatMap((track) => track.clips)
    .sort((left, right) => left.startFrame - right.startFrame);
}

async function renderPreflight(
  timeline: TimelineManifest,
  host?: DesktopHostClient,
) {
  const clips = videoRenderClips(timeline);
  const blockers: string[] = [];
  const warnings = [
    "当前实验渲染器生成独立 SRT，且 P0 首版输出使用静音 AAC-LC 音轨；不会静默烧录字幕。",
  ];
  if (!clips.length) blockers.push("时间线没有可渲染的视频片段。");
  if (clips.some((clip) => !clip.mediaRef || clip.mediaStatus !== "linked"))
    blockers.push("所有视频片段必须先链接到已归档的 opaque mediaRef。");
  for (let index = 1; index < clips.length; index += 1) {
    const previous = clips[index - 1]!;
    const current = clips[index]!;
    if (current.startFrame < previous.startFrame + previous.durationFrames) {
      blockers.push("P0 实验渲染器尚不支持重叠视频片段。");
      break;
    }
  }
  let rendererVersion: string | undefined;
  if (!host) blockers.push("当前运行模式没有 Desktop Host 渲染能力。");
  else {
    try {
      const health = await host.health();
      const capability = health.capabilities.find(
        (item) => item.id === "renderer.ffmpeg-x264",
      );
      if (!capability?.available)
        blockers.push("尚未安装并校验项目签名的 FFmpeg+x264 sidecar。");
      else rendererVersion = capability.version;
    } catch {
      blockers.push("Desktop Host 渲染能力当前不可用。");
    }
  }
  return {
    timelineId: timeline.id,
    timelineVersion: timeline.version,
    timelineEtag: timelineEtag(timeline),
    profileVersion: P0_PROFILE_VERSION,
    ready: blockers.length === 0,
    blockers,
    warnings,
    ...(rendererVersion ? { rendererVersion } : {}),
    ...(rendererVersion ? { sidecarArtifactVersion: rendererVersion } : {}),
  };
}

function persistHostRender(
  context: PluginContext,
  media: MediaRecordService,
  row: TimelineRenderRow,
  hostJob: HostTimelineRenderJob,
): TimelineRenderRow {
  const found = getById(context, row.timeline_id);
  let outputMediaRef = row.output_media_ref;
  if (hostJob.status === "succeeded" && hostJob.output && found) {
    media.registerArchivedArtifact({
      projectId: found.timeline.projectId,
      parentId: found.timeline.episodeId,
      title: `时间线渲染 v${found.timeline.version}`,
      descriptor: hostJob.output,
      lineage: {
        timelineId: found.timeline.id,
        timelineVersion: row.timeline_version,
        rendererVersion: hostJob.rendererVersion,
        sidecarArtifactVersion: hostJob.sidecarArtifactVersion,
      },
    });
    outputMediaRef = hostJob.output.mediaRef;
  }
  return context.uow.execute((transaction) => {
    const changed =
      row.status !== hostJob.status ||
      row.progress !== hostJob.progress ||
      row.output_media_ref !== outputMediaRef ||
      row.output_sha256 !== (hostJob.output?.sha256 ?? row.output_sha256) ||
      row.failure_code !== (hostJob.failureCode ?? null);
    transaction.run(
      `UPDATE timeline_render_jobs SET status = ?, progress = ?,
       renderer_version = ?, sidecar_artifact_version = ?,
       output_media_ref = ?, output_sha256 = ?, failure_code = ?,
       updated_at = ? WHERE id = ?`,
      hostJob.status,
      hostJob.progress,
      hostJob.rendererVersion,
      hostJob.sidecarArtifactVersion,
      outputMediaRef,
      hostJob.output?.sha256 ?? row.output_sha256,
      hostJob.failureCode ?? null,
      hostJob.updatedAt,
      row.id,
    );
    const updated = transaction.get<TimelineRenderRow>(
      "SELECT * FROM timeline_render_jobs WHERE id = ?",
      row.id,
    )!;
    if (changed)
      transaction.append({
        type: "timeline.render-status-changed.v1",
        pluginId: "timeline",
        aggregateType: "timeline-render",
        aggregateId: row.id,
        aggregateVersion: 0,
        payload: {
          status: updated.status,
          progress: updated.progress,
          outputMediaRef: updated.output_media_ref,
          outputSha256: updated.output_sha256,
        },
      });
    return updated;
  });
}

function timelineRoutes(
  context: PluginContext,
  production: ProductionRecordService,
  media: MediaRecordService,
  audioTracks: MediaAudioTrackService,
  host?: DesktopHostClient,
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
        if (input.data.command.type === "relink") {
          const asset = media.get(input.data.command.assetId);
          const mediaRef = asset?.payload["mediaRef"];
          const linked = findClip(next, input.data.command.clipId);
          if (!asset || typeof mediaRef !== "string" || !linked)
            return problem(
              requestContext,
              409,
              "MEDIA_NOT_ARCHIVED",
              "目标媒体尚未完成 Host 归档，不能链接到可渲染时间线。",
            );
          linked.clip.mediaRef = mediaRef;
        }
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
        id: "timeline:render-preflight",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/timelines/{id}/render-preflight",
        operationId: "timeline.renderPreflight",
      },
      openapi({
        method: "get",
        path: "/api/v2/timelines/{id}/render-preflight",
        operationId: "timeline.renderPreflight",
        params: idParams,
        response: TimelineRenderPreflightSchema,
      }),
      async (requestContext) => {
        const found = getById(context, requestContext.req.param("id"));
        return found
          ? requestContext.json(await renderPreflight(found.timeline, host))
          : problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
      },
    ),
    route(
      {
        id: "timeline:render-create",
        pluginId: "timeline",
        method: "post",
        path: "/api/v2/timelines/{id}/renders",
        operationId: "timeline.createRender",
      },
      openapi({
        method: "post",
        path: "/api/v2/timelines/{id}/renders",
        operationId: "timeline.createRender",
        params: idParams,
        body: TimelineRenderCreateInputSchema,
        response: TimelineRenderJobSchema,
      }),
      async (requestContext) => {
        if (!host)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "当前模式无法执行本地时间线渲染。",
          );
        const found = getById(context, requestContext.req.param("id"));
        if (!found)
          return problem(requestContext, 404, "NOT_FOUND", "未找到时间线。");
        const parsed = TimelineRenderCreateInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const idempotencyKey = requestContext.req
          .header("Idempotency-Key")
          ?.trim();
        const ifMatch = requestContext.req.header("If-Match")?.trim();
        if (!parsed.success || !idempotencyKey || idempotencyKey.length > 200)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "渲染请求必须提供合法参数和 Idempotency-Key。",
          );
        if (ifMatch !== timelineEtag(found.timeline))
          return problem(
            requestContext,
            409,
            "TIMELINE_CONFLICT",
            "时间线版本已变化，请重新执行渲染预检。",
          );
        const preflight = await renderPreflight(found.timeline, host);
        if (!preflight.ready)
          return problem(
            requestContext,
            409,
            "RENDER_PREFLIGHT_FAILED",
            preflight.blockers.join("；"),
          );
        if (
          parsed.data.timelineProfileVersion !== preflight.profileVersion ||
          parsed.data.rendererVersion !== preflight.rendererVersion ||
          parsed.data.sidecarArtifactVersion !==
            preflight.sidecarArtifactVersion
        )
          return problem(
            requestContext,
            409,
            "RENDER_VERSION_CONFLICT",
            "渲染器或时间线配置版本已变化，请重新预检。",
          );
        const replay = context.uow.execute((transaction) =>
          transaction.get<TimelineRenderRow>(
            `SELECT * FROM timeline_render_jobs
             WHERE timeline_id = ? AND idempotency_key = ?`,
            found.timeline.id,
            idempotencyKey,
          ),
        );
        if (replay) return requestContext.json(toRenderJob(replay));
        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const row = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO timeline_render_jobs(
              id, timeline_id, timeline_version, timeline_profile_version,
              renderer_version, sidecar_artifact_version, idempotency_key,
              status, progress, output_media_ref, output_sha256, failure_code,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, ?, ?)`,
            jobId,
            found.timeline.id,
            found.timeline.version,
            parsed.data.timelineProfileVersion,
            parsed.data.rendererVersion,
            parsed.data.sidecarArtifactVersion,
            idempotencyKey,
            now,
            now,
          );
          transaction.append({
            type: "timeline.render-status-changed.v1",
            pluginId: "timeline",
            aggregateType: "timeline-render",
            aggregateId: jobId,
            aggregateVersion: 0,
            payload: { status: "queued", progress: 0 },
          });
          return transaction.get<TimelineRenderRow>(
            "SELECT * FROM timeline_render_jobs WHERE id = ?",
            jobId,
          )!;
        });
        try {
          const hostJob = await host.startTimelineRender({
            jobId,
            timelineId: found.timeline.id,
            durationFrames: found.timeline.durationFrames,
            profile: found.timeline.profile,
            clips: videoRenderClips(found.timeline).map((clip) => ({
              mediaRef: clip.mediaRef!,
              startFrame: clip.startFrame,
              durationFrames: clip.durationFrames,
              sourceOffsetFrame: clip.sourceOffsetFrame,
            })),
          });
          return requestContext.json(
            toRenderJob(persistHostRender(context, media, row, hostJob)),
          );
        } catch {
          const failed = context.uow.execute((transaction) => {
            transaction.run(
              `UPDATE timeline_render_jobs SET status = 'failed',
               failure_code = 'HOST_START_FAILED', updated_at = ? WHERE id = ?`,
              new Date().toISOString(),
              jobId,
            );
            return transaction.get<TimelineRenderRow>(
              "SELECT * FROM timeline_render_jobs WHERE id = ?",
              jobId,
            )!;
          });
          return requestContext.json(toRenderJob(failed));
        }
      },
    ),
    route(
      {
        id: "timeline:render-get",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/timeline-renders/{id}",
        operationId: "timeline.getRender",
      },
      openapi({
        method: "get",
        path: "/api/v2/timeline-renders/{id}",
        operationId: "timeline.getRender",
        params: idParams,
        response: TimelineRenderJobSchema,
      }),
      async (requestContext) => {
        let row = context.uow.execute((transaction) =>
          transaction.get<TimelineRenderRow>(
            "SELECT * FROM timeline_render_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到渲染任务。");
        if (host && ["queued", "running"].includes(row.status)) {
          try {
            row = persistHostRender(
              context,
              media,
              row,
              await host.getTimelineRender(row.id),
            );
          } catch (cause) {
            if (cause instanceof Error && cause.message.includes("404"))
              row = context.uow.execute((transaction) => {
                transaction.run(
                  `UPDATE timeline_render_jobs SET status = 'interrupted',
                   failure_code = 'HOST_RESTARTED', updated_at = ? WHERE id = ?`,
                  new Date().toISOString(),
                  row!.id,
                );
                return transaction.get<TimelineRenderRow>(
                  "SELECT * FROM timeline_render_jobs WHERE id = ?",
                  row!.id,
                )!;
              });
          }
        }
        return requestContext.json(toRenderJob(row));
      },
    ),
    route(
      {
        id: "timeline:render-cancel",
        pluginId: "timeline",
        method: "post",
        path: "/api/v2/timeline-renders/{id}/cancel",
        operationId: "timeline.cancelRender",
      },
      openapi({
        method: "post",
        path: "/api/v2/timeline-renders/{id}/cancel",
        operationId: "timeline.cancelRender",
        params: idParams,
        response: TimelineRenderJobSchema,
      }),
      async (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<TimelineRenderRow>(
            "SELECT * FROM timeline_render_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到渲染任务。");
        if (!host)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "当前模式无法取消本地渲染。",
          );
        try {
          const canceled = await host.cancelTimelineRender(row.id);
          return requestContext.json(
            toRenderJob(persistHostRender(context, media, row, canceled)),
          );
        } catch {
          return problem(
            requestContext,
            409,
            "RENDER_CANCEL_FAILED",
            "渲染任务当前无法取消。",
          );
        }
      },
    ),
    route(
      {
        id: "timeline:render-retry",
        pluginId: "timeline",
        method: "post",
        path: "/api/v2/timeline-renders/{id}/retry",
        operationId: "timeline.retryRender",
      },
      openapi({
        method: "post",
        path: "/api/v2/timeline-renders/{id}/retry",
        operationId: "timeline.retryRender",
        params: idParams,
        body: TimelineRenderCreateInputSchema,
        response: TimelineRenderJobSchema,
      }),
      async (requestContext) => {
        const previous = context.uow.execute((transaction) =>
          transaction.get<TimelineRenderRow>(
            "SELECT * FROM timeline_render_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!previous)
          return problem(requestContext, 404, "NOT_FOUND", "未找到渲染任务。");
        if (!["failed", "canceled", "interrupted"].includes(previous.status))
          return problem(
            requestContext,
            409,
            "RENDER_RETRY_NOT_ALLOWED",
            "只有失败、取消或中断的任务可以由用户显式重试。",
          );
        if (!host)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "当前模式无法重试本地渲染。",
          );
        const found = getById(context, previous.timeline_id);
        const parsed = TimelineRenderCreateInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const idempotencyKey = requestContext.req
          .header("Idempotency-Key")
          ?.trim();
        if (!found || !parsed.success || !idempotencyKey)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "重试请求缺少时间线、版本参数或 Idempotency-Key。",
          );
        if (
          found.timeline.version !== previous.timeline_version ||
          requestContext.req.header("If-Match")?.trim() !==
            timelineEtag(found.timeline)
        )
          return problem(
            requestContext,
            409,
            "TIMELINE_CONFLICT",
            "原任务的时间线版本已变化，请为当前版本创建新的渲染。",
          );
        const preflight = await renderPreflight(found.timeline, host);
        if (
          !preflight.ready ||
          parsed.data.timelineProfileVersion !== preflight.profileVersion ||
          parsed.data.rendererVersion !== preflight.rendererVersion ||
          parsed.data.sidecarArtifactVersion !==
            preflight.sidecarArtifactVersion
        )
          return problem(
            requestContext,
            409,
            "RENDER_VERSION_CONFLICT",
            "渲染器或配置版本已变化，请重新执行预检。",
          );
        const replay = context.uow.execute((transaction) =>
          transaction.get<TimelineRenderRow>(
            `SELECT * FROM timeline_render_jobs
             WHERE timeline_id = ? AND idempotency_key = ?`,
            found.timeline.id,
            idempotencyKey,
          ),
        );
        if (replay) return requestContext.json(toRenderJob(replay));
        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const row = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO timeline_render_jobs(
              id, timeline_id, timeline_version, timeline_profile_version,
              renderer_version, sidecar_artifact_version, idempotency_key,
              status, progress, output_media_ref, output_sha256, failure_code,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, ?, ?)`,
            jobId,
            found.timeline.id,
            found.timeline.version,
            parsed.data.timelineProfileVersion,
            parsed.data.rendererVersion,
            parsed.data.sidecarArtifactVersion,
            idempotencyKey,
            now,
            now,
          );
          transaction.append({
            type: "timeline.render-status-changed.v1",
            pluginId: "timeline",
            aggregateType: "timeline-render",
            aggregateId: jobId,
            aggregateVersion: 0,
            payload: { status: "queued", progress: 0, retryOf: previous.id },
          });
          return transaction.get<TimelineRenderRow>(
            "SELECT * FROM timeline_render_jobs WHERE id = ?",
            jobId,
          )!;
        });
        try {
          const hostJob = await host.startTimelineRender({
            jobId,
            timelineId: found.timeline.id,
            durationFrames: found.timeline.durationFrames,
            profile: found.timeline.profile,
            clips: videoRenderClips(found.timeline).map((clip) => ({
              mediaRef: clip.mediaRef!,
              startFrame: clip.startFrame,
              durationFrames: clip.durationFrames,
              sourceOffsetFrame: clip.sourceOffsetFrame,
            })),
          });
          return requestContext.json(
            toRenderJob(persistHostRender(context, media, row, hostJob)),
          );
        } catch {
          const failed = context.uow.execute((transaction) => {
            transaction.run(
              `UPDATE timeline_render_jobs SET status = 'failed',
               failure_code = 'HOST_START_FAILED', updated_at = ? WHERE id = ?`,
              new Date().toISOString(),
              jobId,
            );
            return transaction.get<TimelineRenderRow>(
              "SELECT * FROM timeline_render_jobs WHERE id = ?",
              jobId,
            )!;
          });
          return requestContext.json(toRenderJob(failed));
        }
      },
    ),
    route(
      {
        id: "timeline:render-events",
        pluginId: "timeline",
        method: "get",
        path: "/api/v2/timeline-renders/{id}/events",
        operationId: "timeline.renderEvents",
      },
      sseOpenapi({
        path: "/api/v2/timeline-renders/{id}/events",
        operationId: "timeline.renderEvents",
        params: idParams,
      }),
      async (requestContext) => {
        let row = context.uow.execute((transaction) =>
          transaction.get<TimelineRenderRow>(
            "SELECT * FROM timeline_render_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到渲染任务。");
        if (host && ["queued", "running"].includes(row.status)) {
          try {
            row = persistHostRender(
              context,
              media,
              row,
              await host.getTimelineRender(row.id),
            );
          } catch {
            // A transient Host failure does not rewrite durable state. The
            // client reconnects with the same cursor and can retry safely.
          }
        }
        const rawCursor =
          requestContext.req.query("cursor") ??
          requestContext.req.header("Last-Event-ID") ??
          "0";
        const cursor = /^\d+$/u.test(rawCursor) ? Number(rawCursor) : 0;
        const events = context.events
          .replay(cursor, 500)
          .filter(
            (event) =>
              event.aggregateType === "timeline-render" &&
              event.aggregateId === row!.id,
          );
        const body = `${events
          .map(
            (event) =>
              `id: ${event.cursor}\nevent: render\ndata: ${JSON.stringify(event.payload)}\n`,
          )
          .join("\n")}\nretry: 1000\n\n`;
        return new Response(body, {
          headers: {
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no",
          },
        });
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
                trackId: track.id,
                ...(clip.shotId ? { shotId: clip.shotId } : {}),
                ...(clip.assetId ? { assetId: clip.assetId } : {}),
                name: clip.name,
                startFrame: framesFromSeconds(clip.startSeconds),
                durationFrames: Math.max(
                  1,
                  framesFromSeconds(clip.durationSeconds),
                ),
                sourceOffsetFrame: 0,
                mediaStatus: clip.assetId
                  ? ("linked" as const)
                  : ("unattached" as const),
                ...(clip.text ? { text: clip.text } : {}),
                volume: clip.volume,
                fadeInFrames: framesFromSeconds(clip.fadeInSeconds),
                fadeOutFrames: framesFromSeconds(clip.fadeOutSeconds),
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
            trackId: subtitle.id,
            ...(cue.shotId ? { shotId: cue.shotId } : {}),
            name: cue.text,
            text: cue.text,
            startFrame: framesFromSeconds(cue.startSeconds),
            durationFrames: Math.max(1, framesFromSeconds(cue.durationSeconds)),
            sourceOffsetFrame: 0,
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
  {
    id: "timeline.0002.frame-profile-renders-and-deliveries",
    pluginId: "timeline",
    version: "3.0.0-alpha.4",
    dependsOn: [
      "timeline.0001.canonical",
      "media.0005.artifact-archive-and-provider-jobs",
    ],
    sql: `
      ALTER TABLE timelines ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE timelines ADD COLUMN migration_warnings_json TEXT NOT NULL DEFAULT '[]';
      UPDATE timelines
        SET migration_warnings_json = json_array(
          '旧秒制时间线将在读取时按 round(seconds × 25) 转换；首次写入后固定为整数帧。'
        )
        WHERE schema_version = 1;

      CREATE TABLE IF NOT EXISTS timeline_render_jobs (
        id TEXT PRIMARY KEY,
        timeline_id TEXT NOT NULL,
        timeline_version INTEGER NOT NULL,
        timeline_profile_version TEXT NOT NULL,
        renderer_version TEXT NOT NULL,
        sidecar_artifact_version TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        output_media_ref TEXT,
        output_sha256 TEXT,
        failure_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(timeline_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS timeline_render_jobs_timeline
        ON timeline_render_jobs(timeline_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS timeline_deliveries (
        id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        timeline_version INTEGER NOT NULL,
        directory_grant_ref TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS timeline_deliveries_episode
        ON timeline_deliveries(episode_id, created_at DESC);
    `,
  },
] as const;

export function createTimelinePlugin(host?: DesktopHostClient) {
  return defineFirstPartyPlugin({
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
      context.uow.execute((transaction) =>
        transaction.run(
          `UPDATE timeline_render_jobs SET status = 'interrupted',
         failure_code = 'RUNTIME_RESTARTED', updated_at = ?
         WHERE status IN ('queued', 'running')`,
          new Date().toISOString(),
        ),
      );
      context.effect(`service:${TIMELINE_SERVICE}`, () =>
        context.services.provide(TIMELINE_SERVICE, service),
      );
      for (const contribution of timelineRoutes(
        context,
        production,
        media,
        audioTracks,
        host,
      ))
        context.effect(`route:${contribution.id}`, () =>
          context.http.register(contribution),
        );
    },
  });
}

export const timelinePlugin = createTimelinePlugin();
