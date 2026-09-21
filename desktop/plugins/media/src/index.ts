import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  CONFIGURED_PROVIDER_SERVICE,
  type ConfiguredProvider,
  type ConfiguredProviderService,
} from "@dramaip/contracts";
import {
  AUTOMATION_TASK_SERVICE,
  PROVIDER_ACTION_EXECUTOR_SERVICE,
  type AutomationTaskService,
  type ProviderActionExecutorService,
} from "@dramaip/contracts/automation";
import {
  INSIGHTS_GENERATION_SERVICE,
  type InsightsGenerationService,
} from "@dramaip/contracts/insights";
import {
  AssetCenterActionInputSchema,
  AssetCenterPreviewMediaSchema,
  AssetCenterSchema,
  AnimaticDraftInputSchema,
  AnimaticDraftSchema,
  AnimaticInitializationSchema,
  AnimaticReviewInputSchema,
  AudioTrackInputSchema,
  AudioTrackSchema,
  EpisodeRenderPreflightSchema,
  ImageGenerationInputSchema,
  ImageGenerationRunSchema,
  LikenessConsentInputSchema,
  LikenessPhotoAttachInputSchema,
  LikenessPhotoSchema,
  LikenessReferencePreflightInputSchema,
  LikenessReferencePreflightSchema,
  LikenessSubjectInputSchema,
  LikenessSubjectSchema,
  MEDIA_LIKENESS_SERVICE,
  MEDIA_AUDIO_TRACK_SERVICE,
  MEDIA_RECORD_SERVICE,
  MediaRecordInputSchema,
  MediaRecordPatchSchema,
  MediaRecordSchema,
  TtsGenerationInputSchema,
  TtsGenerationRunSchema,
  VideoGenerationBatchPreflightInputSchema,
  VideoGenerationBatchPreflightSchema,
  VideoGenerationInputSchema,
  VideoGenerationJobSchema,
  VideoGenerationPreflightSchema,
  VideoGenerationRetryInputSchema,
  VoiceProfileInputSchema,
  VoiceProfileSchema,
  type AssetCenter,
  type AssetCenterAsset,
  type AnimaticClip,
  type AnimaticDraft,
  type AnimaticInitialization,
  type AudioTrack,
  type AudioTrackInput,
  type MediaAudioTrackService,
  type MediaRecord,
  type MediaRecordInput,
  type MediaRecordKind,
  type MediaRecordService,
  type MediaLikenessService,
  type LikenessPhoto,
  type LikenessSubject,
  type VideoGenerationInput,
  type VideoGenerationJob,
  type VideoGenerationPreflight,
  type VoiceProfile,
} from "@dramaip/contracts/media";
import type {
  DesktopHostClient,
  ProviderHttpResponse,
} from "@dramaip/desktop-host";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  definePlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import {
  videoProviderAdapter,
  type MediaVideoProviderKind,
} from "./video-provider-adapters.js";

interface MediaRow {
  id: string;
  kind: MediaRecordKind;
  project_id: string;
  parent_id: string | null;
  title: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface LikenessSubjectRow {
  id: string;
  project_id: string;
  display_name: string;
  relationship: LikenessSubject["relationship"];
  age_band: LikenessSubject["ageBand"];
  consent_status: LikenessSubject["consentStatus"];
  content_restrictions: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface LikenessPhotoRow {
  id: string;
  subject_id: string;
  media_ref: string;
  sha256: string;
  mime_type: "image/png";
  width: number;
  height: number;
  size: number;
  status: LikenessPhoto["status"];
  created_at: string;
  removed_at: string | null;
}

interface AudioTrackRow {
  id: string;
  project_id: string;
  episode_id: string;
  kind: AudioTrack["kind"];
  label: string;
  source_fingerprint: string;
  clips_json: string;
  status: AudioTrack["status"];
  stale: number;
  stale_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface VoiceProfileRow {
  id: string;
  project_id: string;
  character_id: string | null;
  sample_asset_id: string | null;
  title: string;
  provider_voice: string | null;
  description: string | null;
  status: VoiceProfile["status"];
  version: number;
  created_at: string;
  updated_at: string;
}

interface AnimaticRow {
  id: string;
  project_id: string;
  episode_id: string;
  source_fingerprint: string;
  clips_json: string;
  annotations: string;
  status: AnimaticDraft["status"];
  review_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface VideoJobRow {
  id: string;
  task_id: string;
  project_id: string;
  episode_id: string | null;
  shot_id: string | null;
  provider_id: string;
  provider_kind: MediaVideoProviderKind | null;
  model_revision: string | null;
  idempotency_key: string | null;
  request_sha256: string | null;
  remote_job_id: string;
  prompt: string;
  request_json: string;
  status: VideoGenerationJob["status"];
  remote_status: VideoGenerationJob["remoteStatus"];
  archive_status: VideoGenerationJob["archiveStatus"];
  results_json: string;
  error: string | null;
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
  body(value: null, status?: number): Response;
}

type RouteHandler = (context: RouteContext) => Response | Promise<Response>;

const idParams = z.object({ id: z.string().uuid() });
const mediaKinds: readonly MediaRecordKind[] = [
  "shot-stills",
  "visual-assets",
  "assets",
  "rights",
  "image",
  "audio",
  "video",
  "renders",
];

function toRecord(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    kind: row.kind,
    domain: row.kind,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function likenessSubject(row: LikenessSubjectRow): LikenessSubject {
  return {
    id: row.id,
    projectId: row.project_id,
    displayName: row.display_name,
    relationship: row.relationship,
    ageBand: row.age_band,
    consentStatus: row.consent_status,
    ...(row.content_restrictions
      ? { contentRestrictions: row.content_restrictions }
      : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function likenessPhoto(row: LikenessPhotoRow): LikenessPhoto {
  return {
    id: row.id,
    subjectId: row.subject_id,
    mediaRef: row.media_ref,
    sha256: row.sha256,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    size: row.size,
    status: row.status,
    createdAt: row.created_at,
    ...(row.removed_at ? { removedAt: row.removed_at } : {}),
  };
}

function toAudioTrack(row: AudioTrackRow): AudioTrack {
  return {
    id: row.id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    kind: row.kind,
    label: row.label,
    sourceFingerprint: row.source_fingerprint,
    clips: JSON.parse(row.clips_json) as AudioTrack["clips"],
    status: row.status,
    stale: Boolean(row.stale),
    ...(row.stale_reason ? { staleReason: row.stale_reason } : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVoiceProfile(row: VoiceProfileRow): VoiceProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.character_id ? { characterId: row.character_id } : {}),
    ...(row.sample_asset_id ? { sampleAssetId: row.sample_asset_id } : {}),
    title: row.title,
    ...(row.provider_voice ? { providerVoice: row.provider_voice } : {}),
    ...(row.description ? { description: row.description } : {}),
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAnimatic(row: AnimaticRow): AnimaticDraft {
  return {
    id: row.id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    sourceFingerprint: row.source_fingerprint,
    clips: JSON.parse(row.clips_json) as AnimaticClip[],
    annotations: row.annotations,
    status: row.status,
    ...(row.review_note ? { reviewNote: row.review_note } : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createAudioTrack(
  context: PluginContext,
  input: AudioTrackInput,
): AudioTrack {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const clips = input.clips.map((clip) => ({
    ...clip,
    id: crypto.randomUUID(),
    sourceFingerprint: JSON.stringify({
      shotId: clip.shotId,
      assetId: clip.assetId,
      text: clip.text,
    }),
  }));
  return context.uow.execute((transaction) => {
    transaction.run(
      `INSERT INTO media_audio_tracks(
        id, project_id, episode_id, kind, label, source_fingerprint,
        clips_json, status, stale, stale_reason, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, NULL, 0, ?, ?)`,
      id,
      input.projectId,
      input.episodeId,
      input.kind,
      input.label.trim(),
      JSON.stringify(input.clips),
      JSON.stringify(clips),
      now,
      now,
    );
    const value = toAudioTrack(
      transaction.get<AudioTrackRow>(
        "SELECT * FROM media_audio_tracks WHERE id = ?",
        id,
      )!,
    );
    transaction.append({
      type: "media.audio-track-created.v1",
      pluginId: "media",
      aggregateType: "audio-track",
      aggregateId: value.id,
      aggregateVersion: value.version,
      payload: JSON.parse(JSON.stringify(value)),
    });
    return value;
  });
}

function appendEvent(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: MediaRecord,
): void {
  transaction.append({
    type: `media.${action}.v1`,
    pluginId: "media",
    aggregateType: value.kind,
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function createRecord(
  context: PluginContext,
  kind: MediaRecordKind,
  input: MediaRecordInput,
): MediaRecord {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return context.uow.execute((transaction) => {
    transaction.run(
      `INSERT INTO media_records(
        id, kind, project_id, parent_id, title, payload_json, version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      kind,
      input.projectId,
      input.parentId ?? null,
      input.title.trim(),
      JSON.stringify(input.payload ?? {}),
      now,
      now,
    );
    const value = toRecord(
      transaction.get<MediaRow>(
        "SELECT * FROM media_records WHERE id = ?",
        id,
      )!,
    );
    appendEvent(transaction, `${kind}-created`, value);
    return value;
  });
}

function registerArchivedArtifact(
  context: PluginContext,
  input: Parameters<MediaRecordService["registerArchivedArtifact"]>[0],
): MediaRecord {
  return context.uow.execute((transaction) => {
    const existing = transaction.get<MediaRow>(
      `SELECT records.* FROM media_records records
       JOIN media_artifacts artifacts ON artifacts.media_record_id = records.id
       WHERE artifacts.media_ref = ?`,
      input.descriptor.mediaRef,
    );
    if (existing) return toRecord(existing);
    const mediaRecordId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      ...input.descriptor,
      artifactId,
      lineage: input.lineage,
    };
    transaction.run(
      `INSERT INTO media_records(
        id, kind, project_id, parent_id, title, payload_json, version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      mediaRecordId,
      input.descriptor.kind === "video" ? "video" : "assets",
      input.projectId,
      input.parentId ?? null,
      input.title.trim(),
      JSON.stringify(payload),
      now,
      now,
    );
    transaction.run(
      `INSERT INTO media_artifacts(
        artifact_id, media_record_id, project_id, media_ref, kind,
        mime_type, extension, size_bytes, sha256, width, height,
        duration_frames, frame_rate_numerator, frame_rate_denominator,
        drop_frame, status, created_at, removed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      artifactId,
      mediaRecordId,
      input.projectId,
      input.descriptor.mediaRef,
      input.descriptor.kind,
      input.descriptor.mimeType,
      input.descriptor.extension,
      input.descriptor.sizeBytes,
      input.descriptor.sha256,
      input.descriptor.width ?? null,
      input.descriptor.height ?? null,
      input.descriptor.durationFrames ?? null,
      input.descriptor.frameRate?.numerator ?? null,
      input.descriptor.frameRate?.denominator ?? null,
      input.descriptor.frameRate
        ? input.descriptor.frameRate.dropFrame
          ? 1
          : 0
        : null,
      input.descriptor.status,
      now,
    );
    const record = toRecord(
      transaction.get<MediaRow>(
        "SELECT * FROM media_records WHERE id = ?",
        mediaRecordId,
      )!,
    );
    appendEvent(transaction, `${record.kind}-created`, record);
    transaction.append({
      type: "media.artifact-archived.v1",
      pluginId: "media",
      aggregateType: "media-artifact",
      aggregateId: artifactId,
      aggregateVersion: 0,
      payload: {
        artifactId,
        mediaRecordId,
        mediaRef: input.descriptor.mediaRef,
        sha256: input.descriptor.sha256,
        lineage: input.lineage,
      },
    });
    return record;
  });
}

function listRecords(
  context: PluginContext,
  kind: MediaRecordKind,
  filter: { projectId?: string; parentId?: string },
): readonly MediaRecord[] {
  return context.uow.execute((transaction) =>
    (filter.parentId
      ? transaction.all<MediaRow>(
          "SELECT * FROM media_records WHERE kind = ? AND parent_id = ? ORDER BY created_at, id",
          kind,
          filter.parentId,
        )
      : transaction.all<MediaRow>(
          "SELECT * FROM media_records WHERE kind = ? AND project_id = ? ORDER BY created_at, id",
          kind,
          filter.projectId,
        )
    ).map(toRecord),
  );
}

function likenessPreflight(
  context: PluginContext,
  subjectIds: readonly string[],
): z.infer<typeof LikenessReferencePreflightSchema> {
  return context.uow.execute((transaction) => {
    const subjects = subjectIds.map((id) =>
      transaction.get<LikenessSubjectRow>(
        "SELECT * FROM media_likeness_subjects WHERE id = ?",
        id,
      ),
    );
    const blockers: string[] = [];
    const mediaRefs: string[] = [];
    for (let index = 0; index < subjectIds.length; index += 1) {
      const id = subjectIds[index]!;
      const subject = subjects[index];
      if (!subject) {
        blockers.push(`未找到照片人物 ${id}。`);
        continue;
      }
      if (subject.consent_status !== "active") {
        blockers.push(`${subject.display_name} 的肖像授权未生效。`);
        continue;
      }
      const consent = transaction.get<{
        valid_until: string;
        revoked_at: string | null;
      }>(
        `SELECT valid_until, revoked_at FROM media_likeness_consents
         WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1`,
        subject.id,
      );
      if (
        !consent ||
        consent.revoked_at ||
        Date.parse(consent.valid_until) <= Date.now()
      ) {
        blockers.push(`${subject.display_name} 的肖像授权已撤回或过期。`);
        continue;
      }
      const photos = transaction.all<LikenessPhotoRow>(
        `SELECT * FROM media_likeness_photos
         WHERE subject_id = ? AND status = 'active' ORDER BY created_at`,
        subject.id,
      );
      if (!photos.length) {
        blockers.push(`${subject.display_name} 尚未附加可用照片。`);
        continue;
      }
      mediaRefs.push(...photos.map((photo) => photo.media_ref));
    }
    return {
      ok: blockers.length === 0,
      subjectIds: [...subjectIds],
      mediaRefs,
      blockers,
      warnings: [
        "照片仅以 Host 受控的不透明引用参与生成；不会写入项目数据库、日志或项目包。",
      ],
    };
  });
}

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
  method: "delete" | "get" | "patch" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["media"],
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
      [status]: {
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

function category(
  payload: Record<string, unknown>,
): AssetCenterAsset["category"] {
  const value = String(
    payload["资产类型"] ?? payload["category"] ?? "character",
  );
  if (value === "场景" || value === "scene") return "scene";
  if (value === "道具" || value === "prop") return "prop";
  if (value === "音色" || value === "voice") return "voice";
  return "character";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function assetCenter(
  projectId: string,
  records: MediaRecordService,
  production: ProductionRecordService,
): AssetCenter {
  const assets = records.list("visual-assets", { projectId });
  return {
    projectId,
    assets: assets.map((record) => {
      const payload = record.payload;
      const usages = stringList(payload["镜头用途"])
        .map((shotId) => production.get(shotId))
        .filter((shot) => shot?.kind === "shots")
        .map((shot) => ({
          shotId: shot!.id,
          shotTitle: shot!.title,
          ...(shot!.parentId
            ? { sceneTitle: production.get(shot!.parentId)?.title }
            : {}),
        }));
      const previewKind =
        payload["预览类型"] === "audio"
          ? "audio"
          : payload["预览类型"] === "image"
            ? "image"
            : "none";
      return {
        id: record.id,
        title: record.title,
        category: category(payload),
        subject: String(
          payload["关联对象"] ?? payload["subject"] ?? record.title,
        ),
        assetVersion: String(payload["资产版本"] ?? `v${record.version + 1}`),
        adopted:
          payload["采用状态"] === "已采用" || payload["adopted"] === true,
        lockStatus:
          payload["锁定状态"] === "已锁定" || payload["locked"] === true
            ? "locked"
            : "unlocked",
        stale: payload["stale"] === true || payload["过期状态"] === "已过期",
        preview: {
          kind: previewKind,
          status:
            typeof payload["预览数据"] === "string"
              ? "available"
              : payload["预览状态"] === "缺失"
                ? "missing"
                : "unattached",
          ...(payload["预览说明"]
            ? { label: String(payload["预览说明"]) }
            : {}),
        },
        rightsStatus:
          payload["权利状态"] === "已核验"
            ? "verified"
            : payload["权利状态"] === "受限"
              ? "restricted"
              : "unknown",
        costStatus: payload["费用状态"] === "已知" ? "known" : "unknown",
        providerStatus:
          payload["服务状态"] === "不可用"
            ? "unavailable"
            : payload["服务状态"] === "无需服务"
              ? "not-required"
              : "available",
        usages,
        version: record.version,
      };
    }),
  };
}

function resourceRoutes(
  workspace: WorkspaceProjectService,
  records: MediaRecordService,
): RouteContribution[] {
  const result: RouteContribution[] = [];
  for (const kind of mediaKinds) {
    const collectionPath = `/api/v2/${kind}` as `/api/v2/${string}`;
    const itemPath = `/api/v2/${kind}/{id}` as `/api/v2/${string}`;
    result.push(
      route(
        {
          id: `media:${kind}-list`,
          pluginId: "media",
          method: "get",
          path: collectionPath,
          operationId: `${kind}.list`,
        },
        openapi({
          method: "get",
          path: collectionPath,
          operationId: `${kind}.list`,
          response: z.array(MediaRecordSchema),
        }),
        (requestContext) => {
          const projectId = requestContext.req.query("projectId");
          const parentId = requestContext.req.query("parentId");
          if (!projectId || !workspace.get(projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          return requestContext.json(
            records.list(kind, parentId ? { parentId } : { projectId }),
          );
        },
      ),
      route(
        {
          id: `media:${kind}-get`,
          pluginId: "media",
          method: "get",
          path: itemPath,
          operationId: `${kind}.get`,
        },
        openapi({
          method: "get",
          path: itemPath,
          operationId: `${kind}.get`,
          params: idParams,
          response: MediaRecordSchema,
        }),
        (requestContext) => {
          const value = records.get(requestContext.req.param("id"));
          return value?.kind === kind
            ? requestContext.json(value)
            : problem(requestContext, 404, "NOT_FOUND", "未找到媒体条目。");
        },
      ),
      route(
        {
          id: `media:${kind}-create`,
          pluginId: "media",
          method: "post",
          path: collectionPath,
          operationId: `${kind}.create`,
        },
        openapi({
          method: "post",
          path: collectionPath,
          operationId: `${kind}.create`,
          body: MediaRecordInputSchema,
          response: MediaRecordSchema,
          status: 201,
        }),
        async (requestContext) => {
          const input = MediaRecordInputSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success || !workspace.get(input.data.projectId))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "媒体条目内容无效。",
            );
          return requestContext.json(records.create(kind, input.data), 201);
        },
      ),
      route(
        {
          id: `media:${kind}-update`,
          pluginId: "media",
          method: "patch",
          path: itemPath,
          operationId: `${kind}.update`,
        },
        openapi({
          method: "patch",
          path: itemPath,
          operationId: `${kind}.update`,
          params: idParams,
          body: MediaRecordPatchSchema,
          response: MediaRecordSchema,
        }),
        async (requestContext) => {
          const input = MediaRecordPatchSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "媒体条目修改无效。",
            );
          const current = records.get(requestContext.req.param("id"));
          if (!current || current.kind !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到媒体条目。",
            );
          const value = records.update(current.id, input.data);
          return value === "conflict"
            ? problem(
                requestContext,
                409,
                "CONFLICT",
                "媒体条目已更新，请刷新。",
              )
            : requestContext.json(value);
        },
      ),
      route(
        {
          id: `media:${kind}-remove`,
          pluginId: "media",
          method: "delete",
          path: itemPath,
          operationId: `${kind}.remove`,
        },
        openapi({
          method: "delete",
          path: itemPath,
          operationId: `${kind}.remove`,
          params: idParams,
          response: z.unknown(),
          status: 204,
        }),
        (requestContext) => {
          const current = records.get(requestContext.req.param("id"));
          if (!current || current.kind !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到媒体条目。",
            );
          return records.remove(current.id)
            ? requestContext.body(null, 204)
            : problem(requestContext, 409, "CONFLICT", "媒体条目无法删除。");
        },
      ),
    );
  }
  return result;
}

function likenessRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  host: DesktopHostClient | undefined,
): readonly RouteContribution[] {
  const projectParams = z.object({ projectId: z.string().uuid() });
  const subjectParams = z.object({ id: z.string().uuid() });
  const subject = (id: string) =>
    context.uow.execute((transaction) =>
      transaction.get<LikenessSubjectRow>(
        "SELECT * FROM media_likeness_subjects WHERE id = ?",
        id,
      ),
    );
  return [
    route(
      {
        id: "media:likeness-subjects-list",
        pluginId: "media",
        method: "get",
        path: "/api/v2/projects/{projectId}/likeness-subjects",
        operationId: "likenessSubjects.list",
      },
      openapi({
        method: "get",
        path: "/api/v2/projects/{projectId}/likeness-subjects",
        operationId: "likenessSubjects.list",
        params: projectParams,
        response: z.array(LikenessSubjectSchema),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("projectId");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<LikenessSubjectRow>(
                "SELECT * FROM media_likeness_subjects WHERE project_id = ? ORDER BY created_at, id",
                projectId,
              )
              .map(likenessSubject),
          ),
        );
      },
    ),
    route(
      {
        id: "media:likeness-subjects-create",
        pluginId: "media",
        method: "post",
        path: "/api/v2/projects/{projectId}/likeness-subjects",
        operationId: "likenessSubjects.create",
      },
      openapi({
        method: "post",
        path: "/api/v2/projects/{projectId}/likeness-subjects",
        operationId: "likenessSubjects.create",
        params: projectParams,
        body: LikenessSubjectInputSchema.omit({ projectId: true }),
        response: LikenessSubjectSchema,
        status: 201,
      }),
      async (requestContext) => {
        const projectId = requestContext.req.param("projectId");
        const input = LikenessSubjectInputSchema.omit({
          projectId: true,
        }).safeParse(await requestContext.req.json());
        if (!input.success || !workspace.get(projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "人物信息无效。",
          );
        if (
          (input.data.relationship === "minor") !==
          (input.data.ageBand !== "adult")
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "未成年人必须标记为未成年人关系；成年人不能使用该关系。",
          );
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO media_likeness_subjects(
              id, project_id, display_name, relationship, age_band,
              consent_status, content_restrictions, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'missing', ?, 0, ?, ?)`,
            id,
            projectId,
            input.data.displayName.trim(),
            input.data.relationship,
            input.data.ageBand,
            input.data.contentRestrictions ?? null,
            now,
            now,
          );
          const created = likenessSubject(
            transaction.get<LikenessSubjectRow>(
              "SELECT * FROM media_likeness_subjects WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: "media.likeness-subject-created.v1",
            pluginId: "media",
            aggregateType: "likeness-subject",
            aggregateId: id,
            aggregateVersion: created.version,
            payload: JSON.parse(JSON.stringify(created)),
          });
          return created;
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "media:likeness-subjects-consent",
        pluginId: "media",
        method: "post",
        path: "/api/v2/likeness-subjects/{id}/consent",
        operationId: "likenessSubjects.consent",
      },
      openapi({
        method: "post",
        path: "/api/v2/likeness-subjects/{id}/consent",
        operationId: "likenessSubjects.consent",
        params: subjectParams,
        body: LikenessConsentInputSchema,
        response: LikenessSubjectSchema,
      }),
      async (requestContext) => {
        const input = LikenessConsentInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = subject(requestContext.req.param("id"));
        if (!input.success || !current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到照片人物。");
        if (
          !input.data.participantConfirmed ||
          Date.parse(input.data.validUntil) <= Date.now() ||
          (current.age_band !== "adult" && !input.data.guardianConfirmed) ||
          (current.age_band === "under_14" &&
            !input.data.under14SeparateConsentConfirmed)
        )
          return problem(
            requestContext,
            400,
            "CONSENT_REQUIRED",
            "授权必须确认用途、有效期；所有未成年人需监护人确认，未满14岁还需单独确认。",
          );
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO media_likeness_consents(
              id, subject_id, purpose_scopes_json, valid_until,
              participant_confirmed, guardian_confirmed, under14_confirmed,
              created_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            crypto.randomUUID(),
            current.id,
            JSON.stringify(input.data.purposeScopes),
            input.data.validUntil,
            input.data.participantConfirmed ? 1 : 0,
            input.data.guardianConfirmed ? 1 : 0,
            input.data.under14SeparateConsentConfirmed ? 1 : 0,
            now,
          );
          transaction.run(
            `UPDATE media_likeness_subjects
             SET consent_status = 'active', version = version + 1, updated_at = ?
             WHERE id = ?`,
            now,
            current.id,
          );
          return likenessSubject(
            transaction.get<LikenessSubjectRow>(
              "SELECT * FROM media_likeness_subjects WHERE id = ?",
              current.id,
            )!,
          );
        });
        return requestContext.json(value);
      },
    ),
    route(
      {
        id: "media:likeness-subjects-attach-photo",
        pluginId: "media",
        method: "post",
        path: "/api/v2/likeness-subjects/{id}/photos",
        operationId: "likenessSubjects.attachPhoto",
      },
      openapi({
        method: "post",
        path: "/api/v2/likeness-subjects/{id}/photos",
        operationId: "likenessSubjects.attachPhoto",
        params: subjectParams,
        body: LikenessPhotoAttachInputSchema,
        response: LikenessPhotoSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = LikenessPhotoAttachInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = subject(requestContext.req.param("id"));
        if (!current || !input.success)
          return problem(requestContext, 404, "NOT_FOUND", "未找到照片人物。");
        if (!host)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "当前运行模式没有可用的 Desktop Host 媒体库。",
          );
        let managed;
        try {
          managed = await host.importPortraitMedia(input.data.grantId);
        } catch {
          return problem(
            requestContext,
            400,
            "INVALID_PORTRAIT_MEDIA",
            "照片格式、大小、尺寸或短期文件授权不符合安全要求。",
          );
        }
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          transaction.run(
            `INSERT INTO media_likeness_photos(
              id, subject_id, media_ref, sha256, mime_type, width, height,
              size, status, created_at, removed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`,
            id,
            current.id,
            managed.mediaRef,
            managed.sha256,
            managed.mimeType,
            managed.width,
            managed.height,
            managed.size,
            now,
          );
          return likenessPhoto(
            transaction.get<LikenessPhotoRow>(
              "SELECT * FROM media_likeness_photos WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "media:likeness-reference-preflight",
        pluginId: "media",
        method: "post",
        path: "/api/v2/projects/{projectId}/likeness-reference-preflight",
        operationId: "likenessSubjects.referencePreflight",
      },
      openapi({
        method: "post",
        path: "/api/v2/projects/{projectId}/likeness-reference-preflight",
        operationId: "likenessSubjects.referencePreflight",
        params: projectParams,
        body: LikenessReferencePreflightInputSchema,
        response: LikenessReferencePreflightSchema,
      }),
      async (requestContext) => {
        const input = LikenessReferencePreflightInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const projectId = requestContext.req.param("projectId");
        if (!input.success || !workspace.get(projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "肖像预检参数无效。",
          );
        const ownership = context.uow.execute((transaction) =>
          input.data.subjectIds.every(
            (id) =>
              transaction.get<{ project_id: string }>(
                "SELECT project_id FROM media_likeness_subjects WHERE id = ?",
                id,
              )?.project_id === projectId,
          ),
        );
        if (!ownership)
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "照片人物不属于当前项目。",
          );
        return requestContext.json(
          likenessPreflight(context, input.data.subjectIds),
        );
      },
    ),
    route(
      {
        id: "media:likeness-subjects-revoke",
        pluginId: "media",
        method: "post",
        path: "/api/v2/likeness-subjects/{id}/revoke",
        operationId: "likenessSubjects.revoke",
      },
      openapi({
        method: "post",
        path: "/api/v2/likeness-subjects/{id}/revoke",
        operationId: "likenessSubjects.revoke",
        params: subjectParams,
        response: LikenessSubjectSchema,
      }),
      async (requestContext) => {
        const current = subject(requestContext.req.param("id"));
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到照片人物。");
        const photos = context.uow.execute((transaction) =>
          transaction.all<LikenessPhotoRow>(
            "SELECT * FROM media_likeness_photos WHERE subject_id = ? AND status = 'active'",
            current.id,
          ),
        );
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            "UPDATE media_likeness_consents SET revoked_at = ? WHERE subject_id = ? AND revoked_at IS NULL",
            now,
            current.id,
          );
          transaction.run(
            `UPDATE media_likeness_subjects
             SET consent_status = 'revoked', version = version + 1, updated_at = ?
             WHERE id = ?`,
            now,
            current.id,
          );
          transaction.run(
            "UPDATE media_likeness_photos SET status = 'removed', removed_at = ? WHERE subject_id = ? AND status = 'active'",
            now,
            current.id,
          );
          const updated = likenessSubject(
            transaction.get<LikenessSubjectRow>(
              "SELECT * FROM media_likeness_subjects WHERE id = ?",
              current.id,
            )!,
          );
          transaction.append({
            type: "media.likeness-consent-revoked.v1",
            pluginId: "media",
            aggregateType: "likeness-subject",
            aggregateId: updated.id,
            aggregateVersion: updated.version,
            payload: { subjectId: updated.id, status: "revoked" },
          });
          return updated;
        });
        if (host)
          await Promise.all(
            photos.map((photo) => host.removeManagedMedia(photo.media_ref)),
          );
        return requestContext.json(value);
      },
    ),
  ];
}

function assetCenterRoutes(
  records: MediaRecordService,
  production: ProductionRecordService,
): RouteContribution[] {
  const centerPath = "/api/v2/projects/{id}/asset-center";
  const previewPath = "/api/v2/asset-center/{id}/preview";
  const actionPath = "/api/v2/asset-center/{id}/action";
  return [
    route(
      {
        id: "media:asset-center-get",
        pluginId: "media",
        method: "get",
        path: centerPath,
        operationId: "asset-center.get",
      },
      openapi({
        method: "get",
        path: centerPath,
        operationId: "asset-center.get",
        params: idParams,
        response: AssetCenterSchema,
      }),
      (requestContext) =>
        requestContext.json(
          assetCenter(requestContext.req.param("id"), records, production),
        ),
    ),
    route(
      {
        id: "media:asset-center-preview",
        pluginId: "media",
        method: "get",
        path: previewPath,
        operationId: "asset-center.preview",
      },
      openapi({
        method: "get",
        path: previewPath,
        operationId: "asset-center.preview",
        params: idParams,
        response: AssetCenterPreviewMediaSchema,
      }),
      (requestContext) => {
        const value = records.get(requestContext.req.param("id"));
        const dataUrl = value?.payload["预览数据"];
        const kind = value?.payload["预览类型"];
        if (
          !value ||
          typeof dataUrl !== "string" ||
          (kind !== "image" && kind !== "audio")
        )
          return problem(
            requestContext,
            404,
            "PREVIEW_UNAVAILABLE",
            "该资产没有可用的本地预览。",
          );
        return requestContext.json({ id: value.id, kind, dataUrl });
      },
    ),
    route(
      {
        id: "media:asset-center-action",
        pluginId: "media",
        method: "post",
        path: actionPath,
        operationId: "asset-center.action",
      },
      openapi({
        method: "post",
        path: actionPath,
        operationId: "asset-center.action",
        params: idParams,
        body: AssetCenterActionInputSchema,
        response: AssetCenterSchema,
      }),
      async (requestContext) => {
        const input = AssetCenterActionInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = records.get(requestContext.req.param("id"));
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "资产操作参数无效。",
          );
        if (!current || current.kind !== "visual-assets")
          return problem(requestContext, 404, "NOT_FOUND", "未找到资产版本。");
        if (input.data.version !== current.version)
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "资产版本已更新，请刷新。",
          );
        const payload = { ...current.payload };
        if (input.data.action === "adopt") payload["采用状态"] = "已采用";
        if (input.data.action === "lock") {
          if (payload["采用状态"] !== "已采用")
            return problem(
              requestContext,
              409,
              "ASSET_NOT_ADOPTED",
              "请先采用资产版本，再执行锁定。",
            );
          payload["锁定状态"] = "已锁定";
        }
        if (input.data.action === "unlock") payload["锁定状态"] = "未锁定";
        if (
          input.data.action === "assign-shot" ||
          input.data.action === "remove-shot"
        ) {
          if (
            !input.data.shotId ||
            production.get(input.data.shotId)?.kind !== "shots"
          )
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到目标镜头。",
            );
          const usages = new Set(stringList(payload["镜头用途"]));
          if (input.data.action === "assign-shot") {
            if (payload["锁定状态"] !== "已锁定")
              return problem(
                requestContext,
                409,
                "ASSET_NOT_LOCKED",
                "只有已锁定版本可以分配到镜头。",
              );
            usages.add(input.data.shotId);
          } else usages.delete(input.data.shotId);
          payload["镜头用途"] = [...usages];
        }
        const updated = records.update(current.id, {
          version: current.version,
          payload,
        });
        if (!updated || updated === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "资产版本已更新，请刷新。",
          );
        return requestContext.json(
          assetCenter(current.projectId, records, production),
        );
      },
    ),
  ];
}

function audioTrackRoutes(
  workspace: WorkspaceProjectService,
  production: ProductionRecordService,
  tracks: MediaAudioTrackService,
): RouteContribution[] {
  const episodeParams = z.object({ episodeId: z.string().uuid() });
  return [
    route(
      {
        id: "media:audio-tracks-list",
        pluginId: "media",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/audio-tracks",
        operationId: "episode-media.listAudioTracks",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/audio-tracks",
        operationId: "episode-media.listAudioTracks",
        params: episodeParams,
        response: z.array(AudioTrackSchema),
      }),
      (requestContext) => {
        const episodeId = requestContext.req.param("episodeId");
        return production.get(episodeId)?.kind === "episodes"
          ? requestContext.json(tracks.list(episodeId))
          : problem(requestContext, 404, "NOT_FOUND", "未找到分集。");
      },
    ),
    route(
      {
        id: "media:audio-tracks-create",
        pluginId: "media",
        method: "post",
        path: "/api/v2/audio-tracks",
        operationId: "episode-media.createAudioTrack",
      },
      openapi({
        method: "post",
        path: "/api/v2/audio-tracks",
        operationId: "episode-media.createAudioTrack",
        body: AudioTrackInputSchema,
        response: AudioTrackSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = AudioTrackInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (
          !input.success ||
          !workspace.get(input.data.projectId) ||
          production.get(input.data.episodeId)?.kind !== "episodes" ||
          input.data.clips.some(
            (clip) =>
              clip.shotId && production.get(clip.shotId)?.kind !== "shots",
          )
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "音轨内容或制作谱系无效。",
          );
        return requestContext.json(tracks.create(input.data), 201);
      },
    ),
    route(
      {
        id: "media:audio-tracks-adopt",
        pluginId: "media",
        method: "post",
        path: "/api/v2/audio-tracks/{id}/adopt",
        operationId: "episode-media.adoptAudioTrack",
      },
      openapi({
        method: "post",
        path: "/api/v2/audio-tracks/{id}/adopt",
        operationId: "episode-media.adoptAudioTrack",
        params: idParams,
        response: AudioTrackSchema,
      }),
      (requestContext) => {
        const value = tracks.adopt(requestContext.req.param("id"));
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到音轨草案。");
      },
    ),
  ];
}

function visualActionRoutes(records: MediaRecordService): RouteContribution[] {
  return [
    ["shot-stills", "adopt", "visuals.adoptStill"],
    ["visual-assets", "adopt", "visuals.adoptVisualAsset"],
    ["visual-assets", "lock", "visuals.lockVisualAsset"],
    ["video", "adopt", "visuals.adoptVideo"],
  ].map(([kind, action, operationId]) => {
    const path =
      `/api/v2/${kind === "video" ? "videos" : kind}/{id}/${action}` as `/api/v2/${string}`;
    return route(
      {
        id: `media:${kind}-${action}`,
        pluginId: "media",
        method: "post",
        path,
        operationId: operationId!,
      },
      openapi({
        method: "post",
        path,
        operationId: operationId!,
        params: idParams,
        response: MediaRecordSchema,
      }),
      (requestContext) => {
        const current = records.get(requestContext.req.param("id"));
        if (!current || current.kind !== kind)
          return problem(requestContext, 404, "NOT_FOUND", "未找到视觉候选。");
        const payload = {
          ...current.payload,
          ...(action === "adopt" ? { 采用状态: "已采用" } : {}),
          ...(action === "lock" ? { 锁定状态: "已锁定" } : {}),
        };
        const updated = records.update(current.id, {
          version: current.version,
          payload,
        });
        return updated && updated !== "conflict"
          ? requestContext.json(updated)
          : problem(
              requestContext,
              409,
              "CONFLICT",
              "视觉候选已更新，请刷新。",
            );
      },
    );
  });
}

function stableFingerprint(value: unknown): string {
  const source = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `media-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function shotDuration(payload: Record<string, unknown>): number {
  const value = payload["时长秒数"] ?? payload["时长"] ?? 3;
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value;
  const parsed = Number(String(value).match(/\d+(?:\.\d+)?/u)?.[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function episodeShots(production: ProductionRecordService, episodeId: string) {
  const episode = production.get(episodeId);
  if (!episode || episode.kind !== "episodes") return undefined;
  const scripts = production.list("scripts", { parentId: episodeId });
  const scenes = scripts.flatMap((script) =>
    production.list("scenes", { parentId: script.id }),
  );
  const shots = scenes.flatMap((scene) =>
    production.list("shots", { parentId: scene.id }),
  );
  return { episode, scripts, scenes, shots };
}

function initializeAnimatic(
  production: ProductionRecordService,
  records: MediaRecordService,
  episodeId: string,
): AnimaticInitialization | undefined {
  const source = episodeShots(production, episodeId);
  if (!source) return undefined;
  let cursor = 0;
  const clips: AnimaticClip[] = source.shots.map((shot) => {
    const durationSeconds = shotDuration(shot.payload);
    const adopted = (kind: "video" | "shot-stills") =>
      records
        .list(kind, { parentId: shot.id })
        .find((candidate) => candidate.payload["采用状态"] === "已采用");
    const video = adopted("video");
    const still = adopted("shot-stills");
    const media = video ?? still;
    const clip: AnimaticClip = {
      shotId: shot.id,
      title: shot.title,
      startSeconds: cursor,
      durationSeconds,
      ...(media ? { mediaAssetId: media.id } : {}),
      mediaKind: video ? "video" : still ? "still" : "missing",
    };
    cursor += durationSeconds;
    return clip;
  });
  return {
    projectId: source.episode.projectId,
    episodeId,
    sourceFingerprint: stableFingerprint({
      episode: [source.episode.id, source.episode.version],
      scripts: source.scripts.map((item) => [item.id, item.version]),
      scenes: source.scenes.map((item) => [item.id, item.version]),
      shots: source.shots.map((item) => [item.id, item.version, item.payload]),
      media: clips.map((item) => [item.shotId, item.mediaAssetId]),
    }),
    clips,
  };
}

function episodeMediaRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  production: ProductionRecordService,
  records: MediaRecordService,
  tracks: MediaAudioTrackService,
): RouteContribution[] {
  return [
    route(
      {
        id: "media:voice-profiles-list",
        pluginId: "media",
        method: "get",
        path: "/api/v2/projects/{id}/voice-profiles",
        operationId: "episode-media.listVoiceProfiles",
      },
      openapi({
        method: "get",
        path: "/api/v2/projects/{id}/voice-profiles",
        operationId: "episode-media.listVoiceProfiles",
        params: idParams,
        response: z.array(VoiceProfileSchema),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<VoiceProfileRow>(
                "SELECT * FROM media_voice_profiles WHERE project_id = ? ORDER BY updated_at DESC, id",
                projectId,
              )
              .map(toVoiceProfile),
          ),
        );
      },
    ),
    route(
      {
        id: "media:voice-profiles-create",
        pluginId: "media",
        method: "post",
        path: "/api/v2/voice-profiles",
        operationId: "episode-media.createVoiceProfile",
      },
      openapi({
        method: "post",
        path: "/api/v2/voice-profiles",
        operationId: "episode-media.createVoiceProfile",
        body: VoiceProfileInputSchema,
        response: VoiceProfileSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = VoiceProfileInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success || !workspace.get(input.data.projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "音色档案内容无效。",
          );
        if (
          input.data.sampleAssetId &&
          records.get(input.data.sampleAssetId)?.kind !== "assets"
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "声音样本不属于素材台账。",
          );
        const value = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          transaction.run(
            `INSERT INTO media_voice_profiles(
              id, project_id, character_id, sample_asset_id, title,
              provider_voice, description, status, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)`,
            id,
            input.data.projectId,
            input.data.characterId ?? null,
            input.data.sampleAssetId ?? null,
            input.data.title.trim(),
            input.data.providerVoice ?? null,
            input.data.description ?? null,
            now,
            now,
          );
          const created = toVoiceProfile(
            transaction.get<VoiceProfileRow>(
              "SELECT * FROM media_voice_profiles WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: "media.voice-profile-created.v1",
            pluginId: "media",
            aggregateType: "voice-profile",
            aggregateId: id,
            aggregateVersion: 0,
            payload: JSON.parse(JSON.stringify(created)),
          });
          return created;
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "media:voice-profiles-adopt",
        pluginId: "media",
        method: "post",
        path: "/api/v2/voice-profiles/{id}/adopt",
        operationId: "episode-media.adoptVoiceProfile",
      },
      openapi({
        method: "post",
        path: "/api/v2/voice-profiles/{id}/adopt",
        operationId: "episode-media.adoptVoiceProfile",
        params: idParams,
        response: VoiceProfileSchema,
      }),
      (requestContext) => {
        const value = context.uow.execute((transaction) => {
          const current = transaction.get<VoiceProfileRow>(
            "SELECT * FROM media_voice_profiles WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!current) return undefined;
          const now = new Date().toISOString();
          transaction.run(
            `UPDATE media_voice_profiles SET status = 'draft',
             version = version + 1, updated_at = ?
             WHERE project_id = ? AND character_id IS ? AND id != ?`,
            now,
            current.project_id,
            current.character_id,
            current.id,
          );
          transaction.run(
            `UPDATE media_voice_profiles SET status = 'adopted',
             version = version + 1, updated_at = ? WHERE id = ?`,
            now,
            current.id,
          );
          const adopted = toVoiceProfile(
            transaction.get<VoiceProfileRow>(
              "SELECT * FROM media_voice_profiles WHERE id = ?",
              current.id,
            )!,
          );
          transaction.append({
            type: "media.voice-profile-adopted.v1",
            pluginId: "media",
            aggregateType: "voice-profile",
            aggregateId: adopted.id,
            aggregateVersion: adopted.version,
            payload: JSON.parse(JSON.stringify(adopted)),
          });
          return adopted;
        });
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到音色档案。");
      },
    ),
    route(
      {
        id: "media:animatic-initialize",
        pluginId: "media",
        method: "get",
        path: "/api/v2/episodes/{id}/animatic-initialization",
        operationId: "episode-media.initializeAnimatic",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{id}/animatic-initialization",
        operationId: "episode-media.initializeAnimatic",
        params: idParams,
        response: AnimaticInitializationSchema,
      }),
      (requestContext) => {
        const value = initializeAnimatic(
          production,
          records,
          requestContext.req.param("id"),
        );
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到分集。");
      },
    ),
    route(
      {
        id: "media:episode-animatics-list",
        pluginId: "media",
        method: "get",
        path: "/api/v2/episodes/{id}/animatics",
        operationId: "episode-media.listAnimatics",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{id}/animatics",
        operationId: "episode-media.listAnimatics",
        params: idParams,
        response: z.array(AnimaticDraftSchema),
      }),
      (requestContext) => {
        const episodeId = requestContext.req.param("id");
        if (!episodeShots(production, episodeId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到分集。");
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<AnimaticRow>(
                "SELECT * FROM media_animatic_drafts WHERE episode_id = ? ORDER BY created_at DESC, id",
                episodeId,
              )
              .map(toAnimatic),
          ),
        );
      },
    ),
    route(
      {
        id: "media:episode-animatics-create",
        pluginId: "media",
        method: "post",
        path: "/api/v2/animatics",
        operationId: "episode-media.createAnimatic",
      },
      openapi({
        method: "post",
        path: "/api/v2/animatics",
        operationId: "episode-media.createAnimatic",
        body: AnimaticDraftInputSchema,
        response: AnimaticDraftSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = AnimaticDraftInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = input.success
          ? initializeAnimatic(production, records, input.data.episodeId)
          : undefined;
        if (
          !input.success ||
          !current ||
          current.projectId !== input.data.projectId ||
          current.sourceFingerprint !== input.data.sourceFingerprint ||
          input.data.clips.some(
            (clip) =>
              !current.clips.some((item) => item.shotId === clip.shotId),
          )
        )
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "镜头或素材已更新，请重新初始化动态分镜。",
          );
        const value = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          transaction.run(
            `INSERT INTO media_animatic_drafts(
              id, project_id, episode_id, source_fingerprint, clips_json,
              annotations, status, review_note, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, 0, ?, ?)`,
            id,
            input.data.projectId,
            input.data.episodeId,
            input.data.sourceFingerprint,
            JSON.stringify(input.data.clips),
            input.data.annotations ?? "",
            now,
            now,
          );
          const created = toAnimatic(
            transaction.get<AnimaticRow>(
              "SELECT * FROM media_animatic_drafts WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: "media.animatic-created.v1",
            pluginId: "media",
            aggregateType: "animatic",
            aggregateId: id,
            aggregateVersion: 0,
            payload: JSON.parse(JSON.stringify(created)),
          });
          return created;
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "media:animatics-review",
        pluginId: "media",
        method: "post",
        path: "/api/v2/animatics/{id}/review",
        operationId: "episode-media.reviewAnimatic",
      },
      openapi({
        method: "post",
        path: "/api/v2/animatics/{id}/review",
        operationId: "episode-media.reviewAnimatic",
        params: idParams,
        body: AnimaticReviewInputSchema,
        response: AnimaticDraftSchema,
      }),
      async (requestContext) => {
        const input = AnimaticReviewInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "审核结论无效。",
          );
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<AnimaticRow>(
            "SELECT * FROM media_animatic_drafts WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== input.data.version)
            return { state: "conflict" as const };
          const initialized = initializeAnimatic(
            production,
            records,
            current.episode_id,
          );
          if (
            input.data.status === "approved" &&
            initialized?.sourceFingerprint !== current.source_fingerprint
          )
            return { state: "stale" as const };
          const now = new Date().toISOString();
          transaction.run(
            `UPDATE media_animatic_drafts SET status = ?, review_note = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
            input.data.status,
            input.data.reviewNote ?? null,
            now,
            current.id,
            current.version,
          );
          const value = toAnimatic(
            transaction.get<AnimaticRow>(
              "SELECT * FROM media_animatic_drafts WHERE id = ?",
              current.id,
            )!,
          );
          transaction.append({
            type: "media.animatic-reviewed.v1",
            pluginId: "media",
            aggregateType: "animatic",
            aggregateId: value.id,
            aggregateVersion: value.version,
            payload: JSON.parse(JSON.stringify(value)),
          });
          return { state: "updated" as const, value };
        });
        if (result.state === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到动态分镜。");
        if (result.state !== "updated")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            result.state === "stale"
              ? "镜头或素材已更新，不能通过过期草案。"
              : "动态分镜已更新，请刷新。",
          );
        return requestContext.json(result.value);
      },
    ),
    route(
      {
        id: "media:render-preflight",
        pluginId: "media",
        method: "get",
        path: "/api/v2/episodes/{id}/render-preflight",
        operationId: "episode-media.renderPreflight",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{id}/render-preflight",
        operationId: "episode-media.renderPreflight",
        params: idParams,
        response: EpisodeRenderPreflightSchema,
      }),
      (requestContext) => {
        const initialized = initializeAnimatic(
          production,
          records,
          requestContext.req.param("id"),
        );
        if (!initialized)
          return problem(requestContext, 404, "NOT_FOUND", "未找到分集。");
        const drafts = context.uow.execute((transaction) =>
          transaction
            .all<AnimaticRow>(
              `SELECT * FROM media_animatic_drafts
               WHERE episode_id = ? AND status = 'approved'
               ORDER BY updated_at DESC, id LIMIT 1`,
              initialized.episodeId,
            )
            .map(toAnimatic),
        );
        const animatic = drafts[0];
        const adoptedTracks = tracks
          .list(initialized.episodeId)
          .filter((track) => track.status === "adopted" && !track.stale);
        const blockers: string[] = [];
        const warnings: string[] = [];
        if (!animatic) blockers.push("请先通过一版动态分镜。");
        else if (animatic.sourceFingerprint !== initialized.sourceFingerprint)
          blockers.push("已通过的动态分镜基于旧镜头或素材版本。");
        if (initialized.clips.some((clip) => clip.mediaKind === "missing"))
          blockers.push("部分镜头尚未采用视频或静帧候选。");
        if (!adoptedTracks.length) warnings.push("尚未采用音轨版本。");
        return requestContext.json({
          projectId: initialized.projectId,
          episodeId: initialized.episodeId,
          sourceFingerprint: initialized.sourceFingerprint,
          ok: blockers.length === 0,
          blockers,
          warnings,
          ...(animatic ? { animaticId: animatic.id } : {}),
          audioTrackIds: adoptedTracks.map((track) => track.id),
          durationSeconds: initialized.clips.reduce(
            (sum, clip) => sum + clip.durationSeconds,
            0,
          ),
        });
      },
    ),
  ];
}

function providerEndpoint(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("服务商地址必须是无账号密码的 HTTP 或 HTTPS 地址。");
  const base = url.pathname.replace(/\/+$/u, "");
  if (!base.endsWith(suffix)) url.pathname = `${base}${suffix}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function providerFor(
  context: PluginContext,
  id: string,
): ConfiguredProvider | undefined {
  return optionalService<ConfiguredProviderService>(
    context,
    CONFIGURED_PROVIDER_SERVICE,
  )?.get(id);
}

function providerCredential(provider: ConfiguredProvider): string {
  if (!provider.credentialRef)
    throw new Error("媒体生成不支持无密钥的本地文本模型服务商。");
  return provider.credentialRef;
}

function upstream(response: ProviderHttpResponse): unknown {
  if (response.status < 200 || response.status >= 300) {
    const message =
      response.json && typeof response.json === "object"
        ? JSON.stringify(response.json).slice(0, 400)
        : `HTTP ${response.status}`;
    throw new Error(`服务商调用失败：${message}`);
  }
  return response.json;
}

type Claim =
  | { state: "claimed" }
  | { state: "replay"; value: unknown }
  | { state: "pending" | "conflict" };

function claimRequest(
  context: PluginContext,
  scope: string,
  key: string,
  request: unknown,
): Claim {
  const requestJson = JSON.stringify(request);
  return context.uow.execute((transaction) => {
    const row = transaction.get<{
      request_json: string;
      response_json: string | null;
    }>(
      "SELECT request_json, response_json FROM media_idempotency WHERE scope = ? AND idempotency_key = ?",
      scope,
      key,
    );
    if (row)
      return row.request_json !== requestJson
        ? { state: "conflict" as const }
        : row.response_json
          ? {
              state: "replay" as const,
              value: JSON.parse(row.response_json) as unknown,
            }
          : { state: "pending" as const };
    transaction.run(
      "INSERT INTO media_idempotency(scope, idempotency_key, request_json, response_json, created_at) VALUES (?, ?, ?, NULL, ?)",
      scope,
      key,
      requestJson,
      new Date().toISOString(),
    );
    return { state: "claimed" as const };
  });
}

function completeRequest(
  context: PluginContext,
  scope: string,
  key: string,
  value: unknown,
): void {
  context.uow.execute((transaction) =>
    transaction.run(
      "UPDATE media_idempotency SET response_json = ? WHERE scope = ? AND idempotency_key = ?",
      JSON.stringify(value),
      scope,
      key,
    ),
  );
}

function idempotencyKey(context: RouteContext): string | undefined {
  const value = context.req.header("Idempotency-Key")?.trim();
  return value && value.length >= 8 && value.length <= 200 ? value : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function imageOutputs(value: unknown): Array<{
  preview?: string;
  remoteUrl?: string;
}> {
  const object = jsonObject(value);
  const data = Array.isArray(object.data)
    ? object.data
    : Array.isArray(object.images)
      ? object.images.map((image) => ({ b64_json: image }))
      : [];
  return data.flatMap((entry) => {
    const item = jsonObject(entry);
    const base64 =
      typeof item.b64_json === "string"
        ? item.b64_json
        : typeof item.base64 === "string"
          ? item.base64
          : undefined;
    const remoteUrl = typeof item.url === "string" ? item.url : undefined;
    if (!base64 && !remoteUrl) return [];
    return [
      {
        ...(base64 ? { preview: `data:image/png;base64,${base64}` } : {}),
        ...(remoteUrl ? { remoteUrl } : {}),
      },
    ];
  });
}

function recordGeneration(
  context: PluginContext,
  input: Parameters<InsightsGenerationService["record"]>[0],
): void {
  optionalService<InsightsGenerationService>(
    context,
    INSIGHTS_GENERATION_SERVICE,
  )?.record(input);
}

async function runImageGeneration(input: {
  context: PluginContext;
  host: DesktopHostClient;
  records: MediaRecordService;
  tasks: AutomationTaskService;
  value: z.infer<typeof ImageGenerationInputSchema>;
}) {
  const provider = providerFor(input.context, input.value.providerId);
  if (!provider?.baseUrl) throw new Error("图片服务商配置不完整。");
  const referenceMedia = input.value.referenceSubjectIds
    ? likenessPreflight(input.context, input.value.referenceSubjectIds)
    : undefined;
  if (
    input.value.referenceSubjectIds &&
    !input.value.portraitPreflightConfirmed
  )
    throw new Error("肖像参考图生成需要先完成并确认预检。");
  if (referenceMedia && !referenceMedia.ok)
    throw new Error(
      `肖像参考图生成被阻止：${referenceMedia.blockers.join("；")}`,
    );
  if (
    referenceMedia &&
    provider.serviceType !== "image-reference" &&
    provider.protocol !== "image-reference"
  )
    throw new Error(
      "CAPABILITY_UNAVAILABLE：所选图片服务商未声明支持参考图，不能降级为无参考图生成。",
    );
  const task = input.tasks.start({
    kind: "image-generation",
    title: "图片候选生成",
    projectId: input.value.projectId,
    result: { providerId: provider.id, shotId: input.value.shotId },
  });
  try {
    const response = await input.host.providerRequest({
      credentialRef: providerCredential(provider),
      url: providerEndpoint(provider.baseUrl, "/images/generations"),
      method: "POST",
      body: {
        model: provider.model,
        prompt: input.value.prompt,
        ...(input.value.negativePrompt
          ? { negative_prompt: input.value.negativePrompt }
          : {}),
        ...(input.value.size ? { size: input.value.size } : {}),
        ...(input.value.quality ? { quality: input.value.quality } : {}),
        response_format: "b64_json",
      },
      accept: "json",
      maximumBytes: 48 * 1024 * 1024,
      ...(referenceMedia ? { mediaRefs: referenceMedia.mediaRefs } : {}),
    });
    const outputs = imageOutputs(upstream(response));
    if (!outputs.length) throw new Error("服务商未返回可归档的图片候选。");
    const assets = outputs.map((output, index) =>
      input.records.create("assets", {
        projectId: input.value.projectId,
        parentId: input.value.shotId,
        title: `生成图片素材 ${index + 1}`,
        payload: {
          素材类型: "生成图片",
          服务商: provider.title,
          模型: provider.model,
          生成任务标识: task.id,
          ...(output.preview
            ? { 预览类型: "image", 预览数据: output.preview }
            : {}),
          ...(output.remoteUrl ? { 远端资源: output.remoteUrl } : {}),
        },
      }),
    );
    const candidates = outputs.map((output, index) =>
      input.records.create("shot-stills", {
        projectId: input.value.projectId,
        parentId: input.value.shotId,
        title: `静帧候选 ${index + 1}`,
        payload: {
          候选类型: input.value.kind,
          采用状态: "未采用",
          生成提示: input.value.prompt,
          来源素材: assets[index]!.id,
          ...(output.preview
            ? { 预览类型: "image", 预览数据: output.preview }
            : {}),
          ...(output.remoteUrl ? { 远端资源: output.remoteUrl } : {}),
        },
      }),
    );
    const completed = input.tasks.update(task.id, {
      status: "succeeded",
      progress: 1,
      result: {
        assetIds: assets.map((item) => item.id),
        candidateIds: candidates.map((item) => item.id),
      },
    })!;
    recordGeneration(input.context, {
      projectId: input.value.projectId,
      taskId: task.id,
      kind: "图片生成",
      title: "图片候选生成",
      status: "已完成",
      summary: `已归档 ${candidates.length} 个静帧候选，等待人工采用。`,
      ...(provider.estimatedUnitCost !== undefined
        ? {
            actualCost: provider.estimatedUnitCost,
            currency: provider.currency,
          }
        : {}),
    });
    return { task: completed, assets, candidates };
  } catch (error) {
    input.tasks.update(task.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "图片生成失败",
    });
    throw error;
  }
}

async function runTtsGeneration(input: {
  context: PluginContext;
  host: DesktopHostClient;
  records: MediaRecordService;
  tasks: AutomationTaskService;
  value: z.infer<typeof TtsGenerationInputSchema>;
}) {
  const provider = providerFor(input.context, input.value.providerId);
  if (!provider?.baseUrl) throw new Error("语音服务商配置不完整。");
  const task = input.tasks.start({
    kind: "tts-generation",
    title: "语音生成",
    projectId: input.value.projectId,
    result: { providerId: provider.id, episodeId: input.value.episodeId },
  });
  try {
    const format = input.value.responseFormat ?? "mp3";
    const response = await input.host.providerRequest({
      credentialRef: providerCredential(provider),
      url: providerEndpoint(provider.baseUrl, "/audio/speech"),
      method: "POST",
      body: {
        model: provider.model,
        input: input.value.input,
        voice: input.value.voice,
        response_format: format,
        ...(input.value.instructions
          ? { instructions: input.value.instructions }
          : {}),
        ...(input.value.speed ? { speed: input.value.speed } : {}),
      },
      accept: "binary",
      maximumBytes: 50 * 1024 * 1024,
    });
    if (response.status < 200 || response.status >= 300 || !response.base64)
      throw new Error(`语音服务商调用失败：HTTP ${response.status}`);
    const mime = response.contentType.split(";")[0] || `audio/${format}`;
    const asset = input.records.create("assets", {
      projectId: input.value.projectId,
      parentId: input.value.episodeId,
      title: `${input.value.kind === "dialogue" ? "对白" : "旁白"}音频`,
      payload: {
        素材类型: input.value.kind === "dialogue" ? "对白音频" : "旁白音频",
        生成任务标识: task.id,
        服务商: provider.title,
        预览类型: "audio",
        预览数据: `data:${mime};base64,${response.base64}`,
        ...(input.value.shotId ? { 关联分镜: input.value.shotId } : {}),
        ...(input.value.voiceProfileId
          ? { 音色档案: input.value.voiceProfileId }
          : {}),
      },
    });
    const completed = input.tasks.update(task.id, {
      status: "succeeded",
      progress: 1,
      result: { assetId: asset.id },
    })!;
    recordGeneration(input.context, {
      projectId: input.value.projectId,
      taskId: task.id,
      kind: "语音生成",
      title: "语音生成",
      status: "已完成",
      summary: "语音素材已安全归档，可绑定到音轨草案。",
    });
    return { task: completed, asset };
  } catch (error) {
    input.tasks.update(task.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "语音生成失败",
    });
    throw error;
  }
}

function videoPreflight(
  context: PluginContext,
  production: ProductionRecordService,
  records: MediaRecordService,
  input: VideoGenerationInput,
  shotId: string,
): VideoGenerationPreflight | undefined {
  const shot = production.get(shotId);
  const provider = providerFor(context, input.providerId);
  if (
    !shot ||
    shot.kind !== "shots" ||
    shot.projectId !== input.projectId ||
    !provider
  )
    return undefined;
  const adoptedStill = records
    .list("shot-stills", { parentId: shotId })
    .find((item) => item.payload["采用状态"] === "已采用");
  const lockedAssetIds = records
    .list("visual-assets", { projectId: input.projectId })
    .filter(
      (item) =>
        item.payload["锁定状态"] === "已锁定" &&
        stringList(item.payload["镜头用途"]).includes(shotId),
    )
    .map((item) => item.id);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const adapter = provider ? videoProviderAdapter(provider) : undefined;
  if (!provider.baseUrl) blockers.push("服务商尚未配置调用地址。");
  if (!adapter)
    blockers.push(
      "视频服务商必须明确使用 Seedance 或 MiniMax H3 Cloud 协议；不再支持通用 /videos 猜测合同。",
    );
  if (!adoptedStill) blockers.push("请先采用一张静帧候选。");
  if (!lockedAssetIds.length) warnings.push("当前分镜没有已锁定的视觉资产。");
  const costStatus =
    provider.estimatedUnitCost === undefined ? "unknown" : "known";
  if (costStatus === "unknown" && !input.confirmUnknownCost)
    blockers.push("费用未知；必须明确确认后才能提交。 ");
  const snapshotHash = stableFingerprint({
    shot: [shot.id, shot.version, shot.payload],
    provider: [provider.id, provider.model, provider.estimatedUnitCost],
    adoptedStill: adoptedStill
      ? [adoptedStill.id, adoptedStill.version]
      : undefined,
    lockedAssetIds,
    request: input,
  });
  return {
    shotId,
    providerId: provider.id,
    snapshotHash,
    ready: blockers.length === 0,
    ...(adoptedStill ? { adoptedStillId: adoptedStill.id } : {}),
    lockedAssetIds,
    blockers,
    warnings,
    ...(adapter
      ? {
          providerKind: adapter.kind,
          providerCapabilities: {
            cancellation: adapter.capabilities.cancellation,
            nativeAudio: adapter.capabilities.nativeAudio,
            durationSeconds: adapter.capabilities.durationSeconds,
            resolutions: [...adapter.capabilities.resolutions],
            aspectRatios: [...adapter.capabilities.aspectRatios],
          },
        }
      : {}),
    costStatus,
    ...(provider.estimatedUnitCost === undefined
      ? {}
      : { estimatedCost: provider.estimatedUnitCost }),
    ...(provider.currency ? { currency: provider.currency } : {}),
  };
}

function toVideoJob(
  row: VideoJobRow,
  records: MediaRecordService,
): VideoGenerationJob {
  const ids = JSON.parse(row.results_json) as string[];
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    ...(row.episode_id ? { episodeId: row.episode_id } : {}),
    ...(row.shot_id ? { shotId: row.shot_id } : {}),
    providerId: row.provider_id,
    ...(row.provider_kind ? { providerKind: row.provider_kind } : {}),
    ...(row.model_revision ? { modelRevision: row.model_revision } : {}),
    remoteJobId: row.remote_job_id,
    prompt: row.prompt,
    status: row.status,
    remoteStatus: row.remote_status,
    archiveStatus: row.archive_status,
    results: ids
      .map((id) => records.get(id))
      .filter((item): item is MediaRecord => Boolean(item)),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createVideoGeneration(input: {
  context: PluginContext;
  host: DesktopHostClient;
  production: ProductionRecordService;
  records: MediaRecordService;
  tasks: AutomationTaskService;
  value: VideoGenerationInput;
  idempotencyKey: string;
  parentTaskId?: string;
}): Promise<VideoGenerationJob> {
  const shotId = input.value.shotId;
  if (!shotId) throw new Error("视频生成需要指定分镜。");
  const preflight = videoPreflight(
    input.context,
    input.production,
    input.records,
    input.value,
    shotId,
  );
  if (!preflight?.ready) throw new Error("视频提交前置条件未满足。");
  if (preflight.snapshotHash !== input.value.readinessHash)
    throw new Error("视频预检快照已变化，请重新预检。");
  const provider = providerFor(input.context, input.value.providerId)!;
  const adapter = videoProviderAdapter(provider);
  if (!adapter)
    throw new Error(
      "视频服务商未声明 Seedance 或 MiniMax H3 Cloud 协议，已拒绝猜测端点。",
    );
  const requestDraft = adapter.create(provider, input.value);
  const requestJson = JSON.stringify(input.value);
  const requestSha256 = await sha256Text(requestJson);
  const task = input.tasks.start({
    kind: "video-generation",
    title: "视频生成",
    projectId: input.value.projectId,
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    result: { shotId, preflight },
  });
  try {
    const response = await input.host.providerRequest({
      credentialRef: providerCredential(provider),
      url: providerEndpoint(provider.baseUrl!, requestDraft.suffix),
      method: requestDraft.method,
      ...(requestDraft.body ? { body: requestDraft.body } : {}),
      idempotencyKey: input.idempotencyKey,
      accept: "json",
    });
    const remote = adapter.parseCreate(upstream(response));
    const overallStatus =
      remote.status === "succeeded" ? "running" : remote.status;
    const archiveStatus =
      remote.status === "succeeded" ? "pending" : "not_started";
    const row = input.context.uow.execute((transaction) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      transaction.run(
        `INSERT INTO media_video_jobs(
          id, task_id, project_id, episode_id, shot_id, provider_id,
          provider_kind, model_revision, idempotency_key, request_sha256,
          remote_job_id, prompt, request_json, status, remote_status,
          archive_status, results_json, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)`,
        id,
        task.id,
        input.value.projectId,
        input.value.episodeId ?? null,
        shotId,
        provider.id,
        adapter.kind,
        remote.modelRevision ?? provider.model,
        input.idempotencyKey,
        requestSha256,
        remote.remoteJobId,
        input.value.prompt,
        requestJson,
        overallStatus,
        remote.status,
        archiveStatus,
        now,
        now,
      );
      const created = transaction.get<VideoJobRow>(
        "SELECT * FROM media_video_jobs WHERE id = ?",
        id,
      )!;
      transaction.append({
        type: "media.video-generation-created.v1",
        pluginId: "media",
        aggregateType: "video-generation",
        aggregateId: id,
        aggregateVersion: 0,
        payload: {
          providerId: provider.id,
          providerKind: adapter.kind,
          remoteJobId: remote.remoteJobId,
          remoteStatus: remote.status,
          archiveStatus,
          modelRevision: remote.modelRevision ?? provider.model,
          requestSha256,
        },
      });
      return created;
    });
    input.tasks.update(task.id, {
      status: remote.status === "failed" ? "failed" : "running",
      progress: remote.status === "running" ? 0.3 : 0.1,
      result: { videoJobId: row.id },
    });
    recordGeneration(input.context, {
      projectId: input.value.projectId,
      taskId: task.id,
      kind: "视频生成",
      title: "视频生成",
      status: "已提交",
      summary: `已固定静帧 ${preflight.adoptedStillId ?? "无"} 与 ${preflight.lockedAssetIds.length} 个锁定资产。`,
    });
    return toVideoJob(row, input.records);
  } catch (error) {
    input.tasks.update(task.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "视频生成失败",
    });
    throw error;
  }
}

async function refreshVideoJob(input: {
  context: PluginContext;
  host: DesktopHostClient;
  records: MediaRecordService;
  tasks: AutomationTaskService;
  id: string;
}): Promise<VideoGenerationJob | undefined> {
  const current = input.context.uow.execute((transaction) =>
    transaction.get<VideoJobRow>(
      "SELECT * FROM media_video_jobs WHERE id = ?",
      input.id,
    ),
  );
  if (!current) return undefined;
  if (["succeeded", "failed", "canceled"].includes(current.status))
    return toVideoJob(current, input.records);
  const provider = providerFor(input.context, current.provider_id);
  if (!provider?.baseUrl) throw new Error("视频服务商配置已删除。");
  const adapter = videoProviderAdapter(provider);
  if (
    !adapter ||
    (current.provider_kind && current.provider_kind !== adapter.kind)
  )
    throw new Error("视频任务的服务商协议与已保存任务不一致。");
  const poll = adapter.poll(current.remote_job_id);
  const response = await input.host.providerRequest({
    credentialRef: providerCredential(provider),
    url: providerEndpoint(provider.baseUrl, poll.suffix),
    method: poll.method,
    ...(poll.body ? { body: poll.body } : {}),
    accept: "json",
  });
  const remote = adapter.parsePoll(upstream(response));
  let archived:
    Awaited<ReturnType<DesktopHostClient["archiveRemoteMedia"]>> | undefined;
  let archiveError: string | undefined;
  if (remote.status === "succeeded" && remote.outputUrl) {
    try {
      const providerOrigin = new URL(provider.baseUrl).origin;
      const outputOrigin = new URL(remote.outputUrl).origin;
      archived = await input.host.archiveRemoteMedia({
        url: remote.outputUrl,
        kind: "video",
        maximumBytes: 2 * 1024 * 1024 * 1024,
        // A provider credential may only follow a same-origin output. Signed
        // CDN URLs are archived without Authorization to avoid credential
        // disclosure across origin boundaries.
        ...(providerOrigin === outputOrigin
          ? { credentialRef: providerCredential(provider) }
          : {}),
      });
    } catch (cause) {
      archiveError =
        cause instanceof Error && cause.message.includes("503")
          ? "远端视频已生成，但本机尚未安装通过校验的媒体归档/探测 sidecar；未保存易失 URL。"
          : "远端视频已生成，但本地归档校验失败；未保存易失 URL。";
    }
  }
  const result = input.context.uow.execute((transaction) => {
    const now = new Date().toISOString();
    const latest = transaction.get<VideoJobRow>(
      "SELECT * FROM media_video_jobs WHERE id = ?",
      current.id,
    )!;
    if (["succeeded", "failed", "canceled"].includes(latest.status))
      return { row: latest, adopted: false };
    const resultIds = JSON.parse(latest.results_json) as string[];
    let archiveStatus = latest.archive_status;
    let overallStatus = remote.status;
    let normalizedError =
      remote.status === "failed"
        ? (remote.errorMessage ?? "视频生成失败")
        : undefined;
    if (remote.status === "succeeded" && archived) {
      const mediaRecordId = crypto.randomUUID();
      const artifactId = crypto.randomUUID();
      const modelRevision =
        remote.modelRevision ?? latest.model_revision ?? provider.model;
      const payload = {
        mediaRef: archived.mediaRef,
        artifactId,
        mimeType: archived.mimeType,
        extension: archived.extension,
        sizeBytes: archived.sizeBytes,
        sha256: archived.sha256,
        width: archived.width,
        height: archived.height,
        durationFrames: archived.durationFrames,
        frameRate: archived.frameRate,
        status: archived.status,
        lineage: {
          videoJobId: latest.id,
          providerId: latest.provider_id,
          providerKind: adapter.kind,
          modelRevision,
          remoteJobId: latest.remote_job_id,
          requestSha256: latest.request_sha256,
        },
      };
      transaction.run(
        `INSERT INTO media_records(
          id, kind, project_id, parent_id, title, payload_json, version,
          created_at, updated_at
        ) VALUES (?, 'video', ?, ?, ?, ?, 0, ?, ?)`,
        mediaRecordId,
        latest.project_id,
        latest.shot_id,
        `生成视频 ${latest.remote_job_id.slice(0, 12)}`,
        JSON.stringify(payload),
        now,
        now,
      );
      transaction.run(
        `INSERT INTO media_artifacts(
          artifact_id, media_record_id, project_id, media_ref, kind,
          mime_type, extension, size_bytes, sha256, width, height,
          duration_frames, frame_rate_numerator, frame_rate_denominator,
          drop_frame, status, created_at, removed_at
        ) VALUES (?, ?, ?, ?, 'video', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'archived', ?, NULL)`,
        artifactId,
        mediaRecordId,
        latest.project_id,
        archived.mediaRef,
        archived.mimeType,
        archived.extension,
        archived.sizeBytes,
        archived.sha256,
        archived.width,
        archived.height,
        archived.durationFrames,
        archived.frameRate.numerator,
        archived.frameRate.denominator,
        archived.frameRate.dropFrame ? 1 : 0,
        now,
      );
      resultIds.push(mediaRecordId);
      const record = toRecord(
        transaction.get<MediaRow>(
          "SELECT * FROM media_records WHERE id = ?",
          mediaRecordId,
        )!,
      );
      appendEvent(transaction, "video-created", record);
      transaction.append({
        type: "media.artifact-archived.v1",
        pluginId: "media",
        aggregateType: "media-artifact",
        aggregateId: artifactId,
        aggregateVersion: 0,
        payload: {
          artifactId,
          mediaRecordId,
          mediaRef: archived.mediaRef,
          sha256: archived.sha256,
          videoJobId: latest.id,
        },
      });
      archiveStatus = "archived";
      overallStatus = "succeeded";
    } else if (remote.status === "succeeded") {
      archiveStatus = remote.outputUrl
        ? archiveError?.includes("尚未安装")
          ? "unavailable"
          : "failed"
        : "failed";
      overallStatus = "failed";
      normalizedError =
        archiveError ?? "视频服务商报告成功，但未返回可归档的输出。";
    }
    transaction.run(
      `UPDATE media_video_jobs SET status = ?, remote_status = ?,
       archive_status = ?, model_revision = COALESCE(?, model_revision),
       results_json = ?, error = ?, updated_at = ? WHERE id = ?`,
      overallStatus,
      remote.status,
      archiveStatus,
      remote.modelRevision ?? null,
      JSON.stringify(resultIds),
      normalizedError ?? null,
      now,
      latest.id,
    );
    const row = transaction.get<VideoJobRow>(
      "SELECT * FROM media_video_jobs WHERE id = ?",
      current.id,
    )!;
    transaction.append({
      type: "media.video-generation-updated.v1",
      pluginId: "media",
      aggregateType: "video-generation",
      aggregateId: row.id,
      aggregateVersion: 1,
      payload: {
        remoteStatus: remote.status,
        archiveStatus,
        resultIds,
        ...(remote.errorCode ? { errorCode: remote.errorCode } : {}),
      },
    });
    return { row, adopted: Boolean(archived) };
  });
  if (archived && !result.adopted)
    await input.host
      .removeManagedMedia(archived.mediaRef)
      .catch(() => undefined);
  const updated = result.row;
  const resultIds = JSON.parse(updated.results_json) as string[];
  input.tasks.update(current.task_id, {
    status:
      updated.status === "failed"
        ? "failed"
        : updated.status === "canceled"
          ? "canceled"
          : updated.status === "succeeded"
            ? "succeeded"
            : "running",
    progress:
      updated.status === "succeeded"
        ? 1
        : remote.status === "succeeded"
          ? 0.8
          : remote.status === "running"
            ? 0.6
            : 0.2,
    ...(updated.error ? { error: updated.error } : {}),
    result: { videoJobId: current.id, resultIds },
  });
  return toVideoJob(updated, input.records);
}

function generationRoutes(
  context: PluginContext,
  host: DesktopHostClient | undefined,
  production: ProductionRecordService,
  records: MediaRecordService,
  tasks: AutomationTaskService,
): RouteContribution[] {
  const requireHost = (requestContext: RouteContext) =>
    host
      ? undefined
      : problem(
          requestContext,
          503,
          "CAPABILITY_UNAVAILABLE",
          "当前模式无法调用本地服务商能力。",
        );
  const claim = (
    requestContext: RouteContext,
    scope: string,
    body: unknown,
  ) => {
    const key = idempotencyKey(requestContext);
    if (!key)
      return {
        response: problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "服务商操作必须提供 Idempotency-Key。",
        ),
      };
    const claimed = claimRequest(context, scope, key, body);
    if (claimed.state === "replay")
      return { response: requestContext.json(claimed.value), key };
    if (claimed.state !== "claimed")
      return {
        response: problem(
          requestContext,
          409,
          claimed.state === "pending"
            ? "IDEMPOTENCY_OUTCOME_PENDING"
            : "IDEMPOTENCY_CONFLICT",
          claimed.state === "pending"
            ? "同一请求的服务商结果尚未确认，请先检查任务状态。"
            : "幂等键已用于不同请求。",
        ),
        key,
      };
    return { key };
  };
  return [
    route(
      {
        id: "media:image-generation-run",
        pluginId: "media",
        method: "post",
        path: "/api/v2/image-generation/runs",
        operationId: "image-generation.run",
      },
      openapi({
        method: "post",
        path: "/api/v2/image-generation/runs",
        operationId: "image-generation.run",
        body: ImageGenerationInputSchema,
        response: ImageGenerationRunSchema,
        status: 201,
      }),
      async (requestContext) => {
        const unavailable = requireHost(requestContext);
        if (unavailable) return unavailable;
        const input = ImageGenerationInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (
          !input.success ||
          production.get(input.data.shotId)?.kind !== "shots"
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "图片生成参数或目标分镜无效。",
          );
        const claimed = claim(requestContext, "image-generation", input.data);
        if (claimed.response) return claimed.response;
        try {
          const value = await runImageGeneration({
            context,
            host: host!,
            production,
            records,
            tasks,
            value: input.data,
          } as Parameters<typeof runImageGeneration>[0]);
          completeRequest(context, "image-generation", claimed.key!, value);
          return requestContext.json(value, 201);
        } catch (error) {
          return problem(
            requestContext,
            502,
            "PROVIDER_ERROR",
            error instanceof Error ? error.message : "图片生成失败。",
          );
        }
      },
    ),
    route(
      {
        id: "media:tts-generation-run",
        pluginId: "media",
        method: "post",
        path: "/api/v2/tts-generation/runs",
        operationId: "tts-generation.run",
      },
      openapi({
        method: "post",
        path: "/api/v2/tts-generation/runs",
        operationId: "tts-generation.run",
        body: TtsGenerationInputSchema,
        response: TtsGenerationRunSchema,
        status: 201,
      }),
      async (requestContext) => {
        const unavailable = requireHost(requestContext);
        if (unavailable) return unavailable;
        const input = TtsGenerationInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success || !episodeShots(production, input.data.episodeId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "语音生成参数或目标分集无效。",
          );
        const claimed = claim(requestContext, "tts-generation", input.data);
        if (claimed.response) return claimed.response;
        try {
          const value = await runTtsGeneration({
            context,
            host: host!,
            records,
            tasks,
            value: input.data,
          });
          completeRequest(context, "tts-generation", claimed.key!, value);
          return requestContext.json(value, 201);
        } catch (error) {
          return problem(
            requestContext,
            502,
            "PROVIDER_ERROR",
            error instanceof Error ? error.message : "语音生成失败。",
          );
        }
      },
    ),
    route(
      {
        id: "media:video-batch-preflight",
        pluginId: "media",
        method: "post",
        path: "/api/v2/projects/{id}/video-generation/batch-preflight",
        operationId: "video-generation.batchPreflight",
      },
      openapi({
        method: "post",
        path: "/api/v2/projects/{id}/video-generation/batch-preflight",
        operationId: "video-generation.batchPreflight",
        params: idParams,
        body: VideoGenerationBatchPreflightInputSchema,
        response: VideoGenerationBatchPreflightSchema,
      }),
      async (requestContext) => {
        const input = VideoGenerationBatchPreflightInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const projectId = requestContext.req.param("id");
        if (!input.success || input.data.projectId !== projectId)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "批量视频预检参数无效。",
          );
        const items = input.data.submissions.map((submission) =>
          submission.shotId
            ? videoPreflight(
                context,
                production,
                records,
                submission,
                submission.shotId,
              )
            : undefined,
        );
        if (items.some((item) => !item))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "批量预检包含无效分镜或服务商。",
          );
        const values = items as VideoGenerationPreflight[];
        const providerCounts = new Map<string, number>();
        for (const item of values)
          providerCounts.set(
            item.providerId,
            (providerCounts.get(item.providerId) ?? 0) + 1,
          );
        for (const [providerId, requested] of providerCounts) {
          const provider = providerFor(context, providerId);
          if (!provider?.concurrencyLimit) continue;
          const active = context.uow.execute(
            (transaction) =>
              transaction.get<{ count: number }>(
                "SELECT count(*) AS count FROM media_video_jobs WHERE provider_id = ? AND status IN ('queued','running')",
                providerId,
              )?.count ?? 0,
          );
          if (active + requested <= provider.concurrencyLimit) continue;
          for (const item of values.filter(
            (entry) => entry.providerId === providerId,
          )) {
            item.ready = false;
            item.blockers.push(
              `服务商并发上限为 ${provider.concurrencyLimit}，当前任务与本批提交会超限。`,
            );
          }
        }
        return requestContext.json({
          projectId,
          ready: values.every((item) => item.ready),
          items: values,
          blockers: values.flatMap((item) =>
            item.blockers.map((blocker) => `分镜 ${item.shotId}：${blocker}`),
          ),
          knownEstimatedCost: values.reduce(
            (sum, item) => sum + (item.estimatedCost ?? 0),
            0,
          ),
          unknownCostCount: values.filter(
            (item) => item.costStatus === "unknown",
          ).length,
        });
      },
    ),
    route(
      {
        id: "media:video-preflight",
        pluginId: "media",
        method: "post",
        path: "/api/v2/shots/{id}/video-generation/preflight",
        operationId: "video-generation.preflight",
      },
      openapi({
        method: "post",
        path: "/api/v2/shots/{id}/video-generation/preflight",
        operationId: "video-generation.preflight",
        params: idParams,
        body: VideoGenerationInputSchema,
        response: VideoGenerationPreflightSchema,
      }),
      async (requestContext) => {
        const input = VideoGenerationInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const value = input.success
          ? videoPreflight(
              context,
              production,
              records,
              input.data,
              requestContext.req.param("id"),
            )
          : undefined;
        return value
          ? requestContext.json(value)
          : problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "视频预检参数无效。",
            );
      },
    ),
    route(
      {
        id: "media:video-generation-create",
        pluginId: "media",
        method: "post",
        path: "/api/v2/video-generation/runs",
        operationId: "video-generation.create",
      },
      openapi({
        method: "post",
        path: "/api/v2/video-generation/runs",
        operationId: "video-generation.create",
        body: VideoGenerationInputSchema,
        response: VideoGenerationJobSchema,
        status: 201,
      }),
      async (requestContext) => {
        const unavailable = requireHost(requestContext);
        if (unavailable) return unavailable;
        const input = VideoGenerationInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "视频生成参数无效。",
          );
        const claimed = claim(requestContext, "video-generation", input.data);
        if (claimed.response) return claimed.response;
        try {
          const value = await createVideoGeneration({
            context,
            host: host!,
            production,
            records,
            tasks,
            value: input.data,
            idempotencyKey: claimed.key!,
          });
          completeRequest(context, "video-generation", claimed.key!, value);
          return requestContext.json(value, 201);
        } catch (error) {
          return problem(
            requestContext,
            409,
            "VIDEO_NOT_READY",
            error instanceof Error ? error.message : "视频生成失败。",
          );
        }
      },
    ),
    route(
      {
        id: "media:video-list-by-shot",
        pluginId: "media",
        method: "get",
        path: "/api/v2/shots/{id}/video-generation/runs",
        operationId: "video-generation.listByShot",
      },
      openapi({
        method: "get",
        path: "/api/v2/shots/{id}/video-generation/runs",
        operationId: "video-generation.listByShot",
        params: idParams,
        response: z.array(VideoGenerationJobSchema),
      }),
      (requestContext) => {
        const shotId = requestContext.req.param("id");
        if (production.get(shotId)?.kind !== "shots")
          return problem(requestContext, 404, "NOT_FOUND", "未找到分镜。");
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<VideoJobRow>(
                "SELECT * FROM media_video_jobs WHERE shot_id = ? ORDER BY created_at DESC, id",
                shotId,
              )
              .map((row) => toVideoJob(row, records)),
          ),
        );
      },
    ),
    route(
      {
        id: "media:video-generation-get",
        pluginId: "media",
        method: "get",
        path: "/api/v2/video-generation/runs/{id}",
        operationId: "video-generation.get",
      },
      openapi({
        method: "get",
        path: "/api/v2/video-generation/runs/{id}",
        operationId: "video-generation.get",
        params: idParams,
        response: VideoGenerationJobSchema,
      }),
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<VideoJobRow>(
            "SELECT * FROM media_video_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        return row
          ? requestContext.json(toVideoJob(row, records))
          : problem(requestContext, 404, "NOT_FOUND", "未找到视频任务。");
      },
    ),
    route(
      {
        id: "media:video-refresh",
        pluginId: "media",
        method: "post",
        path: "/api/v2/video-generation/runs/{id}/refresh",
        operationId: "video-generation.refresh",
      },
      openapi({
        method: "post",
        path: "/api/v2/video-generation/runs/{id}/refresh",
        operationId: "video-generation.refresh",
        params: idParams,
        response: VideoGenerationJobSchema,
      }),
      async (requestContext) => {
        const unavailable = requireHost(requestContext);
        if (unavailable) return unavailable;
        try {
          const value = await refreshVideoJob({
            context,
            host: host!,
            records,
            tasks,
            id: requestContext.req.param("id"),
          });
          return value
            ? requestContext.json(value)
            : problem(requestContext, 404, "NOT_FOUND", "未找到视频任务。");
        } catch (error) {
          return problem(
            requestContext,
            502,
            "PROVIDER_ERROR",
            error instanceof Error ? error.message : "视频状态查询失败。",
          );
        }
      },
    ),
    route(
      {
        id: "media:video-cancel",
        pluginId: "media",
        method: "post",
        path: "/api/v2/video-generation/runs/{id}/cancel",
        operationId: "video-generation.cancel",
      },
      openapi({
        method: "post",
        path: "/api/v2/video-generation/runs/{id}/cancel",
        operationId: "video-generation.cancel",
        params: idParams,
        response: VideoGenerationJobSchema,
      }),
      async (requestContext) => {
        const unavailable = requireHost(requestContext);
        if (unavailable) return unavailable;
        const current = context.uow.execute((transaction) =>
          transaction.get<VideoJobRow>(
            "SELECT * FROM media_video_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到视频任务。");
        if (["succeeded", "failed", "canceled"].includes(current.status))
          return requestContext.json(toVideoJob(current, records));
        const provider = providerFor(context, current.provider_id);
        if (!provider?.baseUrl)
          return problem(
            requestContext,
            409,
            "PROVIDER_UNAVAILABLE",
            "视频服务商配置已删除。",
          );
        const adapter = videoProviderAdapter(provider);
        if (
          !adapter ||
          (current.provider_kind && current.provider_kind !== adapter.kind)
        )
          return problem(
            requestContext,
            409,
            "PROVIDER_CONTRACT_DRIFT",
            "视频任务的服务商协议与已保存任务不一致。",
          );
        if (
          adapter.capabilities.cancellation === "unsupported" ||
          (adapter.capabilities.cancellation === "queued_only" &&
            current.remote_status !== "queued")
        )
          return problem(
            requestContext,
            422,
            "UNSUPPORTED_OPERATION",
            adapter.capabilities.cancellation === "queued_only"
              ? "该服务商只允许取消仍在排队的任务，当前远端任务不能取消。"
              : "该 Seedance 模型未声明原生取消能力；本地不会伪装取消付费任务。",
          );
        const cancel = adapter.cancel(current.remote_job_id);
        if (!cancel)
          return problem(
            requestContext,
            422,
            "UNSUPPORTED_OPERATION",
            "服务商未提供可验证的原生取消操作。",
          );
        try {
          const response = await host!.providerRequest({
            credentialRef: providerCredential(provider),
            url: providerEndpoint(provider.baseUrl, cancel.suffix),
            method: cancel.method,
            ...(cancel.body ? { body: cancel.body } : {}),
            accept: "json",
          });
          upstream(response);
          const row = context.uow.execute((transaction) => {
            transaction.run(
              `UPDATE media_video_jobs SET status = 'canceled',
               remote_status = 'canceled', updated_at = ? WHERE id = ?`,
              new Date().toISOString(),
              current.id,
            );
            const value = transaction.get<VideoJobRow>(
              "SELECT * FROM media_video_jobs WHERE id = ?",
              current.id,
            )!;
            transaction.append({
              type: "media.video-generation-canceled.v1",
              pluginId: "media",
              aggregateType: "video-generation",
              aggregateId: current.id,
              aggregateVersion: 1,
              payload: { remoteJobId: current.remote_job_id },
            });
            return value;
          });
          tasks.update(current.task_id, { status: "canceled" });
          return requestContext.json(toVideoJob(row, records));
        } catch (error) {
          return problem(
            requestContext,
            502,
            "PROVIDER_ERROR",
            error instanceof Error ? error.message : "取消视频任务失败。",
          );
        }
      },
    ),
    route(
      {
        id: "media:video-retry",
        pluginId: "media",
        method: "post",
        path: "/api/v2/video-generation/runs/{id}/retry",
        operationId: "video-generation.retry",
      },
      openapi({
        method: "post",
        path: "/api/v2/video-generation/runs/{id}/retry",
        operationId: "video-generation.retry",
        params: idParams,
        body: VideoGenerationRetryInputSchema,
        response: VideoGenerationJobSchema,
        status: 201,
      }),
      async (requestContext) => {
        const unavailable = requireHost(requestContext);
        if (unavailable) return unavailable;
        const retry = VideoGenerationRetryInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = context.uow.execute((transaction) =>
          transaction.get<VideoJobRow>(
            "SELECT * FROM media_video_jobs WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!retry.success || !current)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到可重试的视频任务。",
          );
        if (current.remote_status === "succeeded")
          return problem(
            requestContext,
            409,
            "ARCHIVE_RETRY_REQUIRED",
            "远端付费任务已经成功；必须重试归档，不能重新提交生成造成重复扣费。",
          );
        const original = VideoGenerationInputSchema.parse(
          JSON.parse(current.request_json),
        );
        const value = {
          ...original,
          providerId: retry.data.providerId ?? original.providerId,
        };
        const claimed = claim(
          requestContext,
          `video-generation-retry:${current.id}`,
          value,
        );
        if (claimed.response) return claimed.response;
        try {
          const created = await createVideoGeneration({
            context,
            host: host!,
            production,
            records,
            tasks,
            value,
            idempotencyKey: claimed.key!,
            parentTaskId: current.task_id,
          });
          tasks.update(current.task_id, { attentionStatus: "acknowledged" });
          completeRequest(
            context,
            `video-generation-retry:${current.id}`,
            claimed.key!,
            created,
          );
          return requestContext.json(created, 201);
        } catch (error) {
          return problem(
            requestContext,
            409,
            "VIDEO_NOT_READY",
            error instanceof Error ? error.message : "视频重试失败。",
          );
        }
      },
    ),
  ];
}

const mediaMigrations = [
  {
    id: "media.0001.records",
    pluginId: "media",
    version: "3.0.0-alpha.3",
    dependsOn: ["production.0001.records"],
    sql: `
      CREATE TABLE IF NOT EXISTS media_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN (
          'shot-stills', 'visual-assets', 'assets', 'rights', 'image',
          'audio', 'video', 'animatics', 'renders'
        )),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_records_project_kind
        ON media_records(project_id, kind, created_at, id);
      CREATE INDEX IF NOT EXISTS media_records_parent_kind
        ON media_records(parent_id, kind, created_at, id);
      CREATE TABLE IF NOT EXISTS media_audio_tracks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('dialogue', 'narration', 'bgm', 'sfx')),
        label TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        clips_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft', 'adopted')),
        stale INTEGER NOT NULL DEFAULT 0,
        stale_reason TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_audio_tracks_episode
        ON media_audio_tracks(episode_id, created_at, id);
    `,
  },
  {
    id: "media.0002.voice-and-animatics",
    pluginId: "media",
    version: "3.0.0-alpha.3",
    dependsOn: ["media.0001.records"],
    sql: `
      CREATE TABLE IF NOT EXISTS media_voice_profiles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        character_id TEXT,
        sample_asset_id TEXT,
        title TEXT NOT NULL,
        provider_voice TEXT,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'adopted')),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_voice_profiles_project
        ON media_voice_profiles(project_id, updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS media_animatic_drafts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        clips_json TEXT NOT NULL,
        annotations TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('draft', 'approved', 'returned')),
        review_note TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_animatic_drafts_episode
        ON media_animatic_drafts(episode_id, updated_at DESC, id);
    `,
  },
  {
    id: "media.0003.provider-generation",
    pluginId: "media",
    version: "3.0.0-alpha.3",
    dependsOn: ["media.0002.voice-and-animatics"],
    sql: `
      CREATE TABLE IF NOT EXISTS media_video_jobs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT,
        shot_id TEXT,
        provider_id TEXT NOT NULL,
        remote_job_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        request_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','canceled')),
        results_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_video_jobs_shot
        ON media_video_jobs(shot_id, created_at DESC, id);
      CREATE INDEX IF NOT EXISTS media_video_jobs_provider_status
        ON media_video_jobs(provider_id, status, created_at, id);
      CREATE TABLE IF NOT EXISTS media_idempotency (
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, idempotency_key)
      );
    `,
  },
  {
    id: "media.0004.personal-theater-likeness",
    pluginId: "media",
    version: "3.0.0-alpha.3",
    dependsOn: [
      "media.0003.provider-generation",
      "workspace.0005.project-modes",
    ],
    sql: `
      CREATE TABLE IF NOT EXISTS media_likeness_subjects (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        relationship TEXT NOT NULL CHECK(relationship IN ('self', 'adult_relative_or_friend', 'minor')),
        age_band TEXT NOT NULL CHECK(age_band IN ('adult', 'minor_14_to_17', 'under_14')),
        consent_status TEXT NOT NULL CHECK(consent_status IN ('missing', 'active', 'revoked', 'expired')),
        content_restrictions TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_likeness_subjects_project
        ON media_likeness_subjects(project_id, created_at, id);
      CREATE TABLE IF NOT EXISTS media_likeness_consents (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES media_likeness_subjects(id) ON DELETE CASCADE,
        purpose_scopes_json TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        participant_confirmed INTEGER NOT NULL,
        guardian_confirmed INTEGER NOT NULL DEFAULT 0,
        under14_confirmed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS media_likeness_consents_subject
        ON media_likeness_consents(subject_id, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS media_likeness_photos (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES media_likeness_subjects(id) ON DELETE CASCADE,
        media_ref TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL CHECK(mime_type = 'image/png'),
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'removed')),
        created_at TEXT NOT NULL,
        removed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS media_likeness_photos_subject
        ON media_likeness_photos(subject_id, status, created_at, id);
    `,
  },
  {
    id: "media.0005.artifact-archive-and-provider-jobs",
    pluginId: "media",
    version: "3.0.0-alpha.3",
    dependsOn: ["media.0004.personal-theater-likeness"],
    sql: `
      CREATE TABLE media_artifacts (
        artifact_id TEXT PRIMARY KEY,
        media_record_id TEXT REFERENCES media_records(id) ON DELETE SET NULL,
        project_id TEXT NOT NULL,
        media_ref TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('image','audio','video','subtitle','project-package')),
        mime_type TEXT NOT NULL,
        extension TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
        width INTEGER,
        height INTEGER,
        duration_frames INTEGER,
        frame_rate_numerator INTEGER,
        frame_rate_denominator INTEGER,
        drop_frame INTEGER,
        status TEXT NOT NULL CHECK(status IN ('archived','quarantined','removed')),
        created_at TEXT NOT NULL,
        removed_at TEXT
      );
      CREATE INDEX media_artifacts_project_status
        ON media_artifacts(project_id, status, created_at DESC, artifact_id);
      ALTER TABLE media_video_jobs ADD COLUMN provider_kind TEXT
        CHECK(provider_kind IN ('seedance','minimax_h3_cloud'));
      ALTER TABLE media_video_jobs ADD COLUMN model_revision TEXT;
      ALTER TABLE media_video_jobs ADD COLUMN idempotency_key TEXT;
      ALTER TABLE media_video_jobs ADD COLUMN request_sha256 TEXT
        CHECK(request_sha256 IS NULL OR length(request_sha256) = 64);
      ALTER TABLE media_video_jobs ADD COLUMN remote_status TEXT NOT NULL
        DEFAULT 'queued'
        CHECK(remote_status IN ('queued','running','succeeded','failed','canceled'));
      ALTER TABLE media_video_jobs ADD COLUMN archive_status TEXT NOT NULL
        DEFAULT 'not_started'
        CHECK(archive_status IN ('not_started','pending','archived','failed','unavailable'));
      UPDATE media_video_jobs
        SET remote_status = status,
            archive_status = CASE
              WHEN status = 'succeeded' THEN 'unavailable'
              ELSE 'not_started'
            END;
      CREATE UNIQUE INDEX media_video_jobs_provider_idempotency
        ON media_video_jobs(provider_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `,
  },
] as const;

export function createMediaPlugin(host?: DesktopHostClient) {
  return definePlugin({
    inject: [
      AUTOMATION_TASK_SERVICE.id,
      PRODUCTION_RECORD_SERVICE.id,
      WORKSPACE_PROJECT_SERVICE.id,
    ],
    descriptor: {
      id: "media",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation", "workspace", "automation", "production"],
      provides: ["media.records", "media.asset-center", "media.audio-tracks"],
      stability: "internal",
    },
    ui: [
      {
        id: "media.route.workspace",
        pluginId: "media",
        kind: "route",
        metadata: { path: "/produce", title: "制作" },
      },
      {
        id: "media.navigation.workspace",
        pluginId: "media",
        kind: "navigation",
        metadata: { section: "main", order: 40, label: "制作", to: "/produce" },
      },
      {
        id: "media.panel.asset-center",
        pluginId: "media",
        kind: "panel",
        metadata: { slot: "production.assets", title: "资产中心" },
      },
    ],
    migrations: mediaMigrations,
    apply: (context) => {
      const workspace = optionalService<WorkspaceProjectService>(
        context,
        WORKSPACE_PROJECT_SERVICE,
      );
      const production = optionalService<ProductionRecordService>(
        context,
        PRODUCTION_RECORD_SERVICE,
      );
      if (!workspace || !production)
        throw new Error("media requires workspace and production services");
      const tasks = optionalService<AutomationTaskService>(
        context,
        AUTOMATION_TASK_SERVICE,
      );
      if (!tasks) throw new Error("media requires automation task service");
      const service: MediaRecordService = {
        create: (kind, input) => createRecord(context, kind, input),
        registerArchivedArtifact: (input) =>
          registerArchivedArtifact(context, input),
        list: (kind, filter) => listRecords(context, kind, filter),
        get: (id) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<MediaRow>(
              "SELECT * FROM media_records WHERE id = ?",
              id,
            );
            return row ? toRecord(row) : undefined;
          }),
        update: (id, patch) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<MediaRow>(
              "SELECT * FROM media_records WHERE id = ?",
              id,
            );
            if (!row) return undefined;
            if (row.version !== patch.version) return "conflict" as const;
            transaction.run(
              `UPDATE media_records SET title = ?, payload_json = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
              patch.title?.trim() ?? row.title,
              JSON.stringify(patch.payload ?? JSON.parse(row.payload_json)),
              new Date().toISOString(),
              id,
              row.version,
            );
            const value = toRecord(
              transaction.get<MediaRow>(
                "SELECT * FROM media_records WHERE id = ?",
                id,
              )!,
            );
            appendEvent(transaction, `${row.kind}-updated`, value);
            return value;
          }),
        remove: (id, expectedVersion) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<MediaRow>(
              "SELECT * FROM media_records WHERE id = ?",
              id,
            );
            if (
              !row ||
              (expectedVersion !== undefined && row.version !== expectedVersion)
            )
              return false;
            const value = toRecord(row);
            transaction.run("DELETE FROM media_records WHERE id = ?", id);
            transaction.append({
              type: `media.${row.kind}-removed.v1`,
              pluginId: "media",
              aggregateType: row.kind,
              aggregateId: row.id,
              aggregateVersion: row.version,
              payload: JSON.parse(JSON.stringify(value)),
            });
            return true;
          }),
      };
      context.effect(
        () => provideService(context, MEDIA_RECORD_SERVICE, service),
        `service:${MEDIA_RECORD_SERVICE}`,
      );
      const likeness: MediaLikenessService = {
        getSubject: (id) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<LikenessSubjectRow>(
              "SELECT * FROM media_likeness_subjects WHERE id = ?",
              id,
            );
            return row ? likenessSubject(row) : undefined;
          }),
        listSubjects: (projectId) =>
          context.uow.execute((transaction) =>
            transaction
              .all<LikenessSubjectRow>(
                "SELECT * FROM media_likeness_subjects WHERE project_id = ? ORDER BY created_at, id",
                projectId,
              )
              .map(likenessSubject),
          ),
        preflight: (input) => likenessPreflight(context, input.subjectIds),
      };
      context.effect(
        () => provideService(context, MEDIA_LIKENESS_SERVICE, likeness),
        `service:${MEDIA_LIKENESS_SERVICE}`,
      );
      const audioTracks: MediaAudioTrackService = {
        list: (episodeId) =>
          context.uow.execute((transaction) =>
            transaction
              .all<AudioTrackRow>(
                "SELECT * FROM media_audio_tracks WHERE episode_id = ? ORDER BY created_at, id",
                episodeId,
              )
              .map(toAudioTrack),
          ),
        create: (input) => createAudioTrack(context, input),
        adopt: (id) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<AudioTrackRow>(
              "SELECT * FROM media_audio_tracks WHERE id = ?",
              id,
            );
            if (!row || row.stale) return undefined;
            const now = new Date().toISOString();
            transaction.run(
              `UPDATE media_audio_tracks SET status = 'adopted',
             version = version + 1, updated_at = ? WHERE id = ?`,
              now,
              id,
            );
            const value = toAudioTrack(
              transaction.get<AudioTrackRow>(
                "SELECT * FROM media_audio_tracks WHERE id = ?",
                id,
              )!,
            );
            transaction.append({
              type: "media.audio-track-adopted.v1",
              pluginId: "media",
              aggregateType: "audio-track",
              aggregateId: value.id,
              aggregateVersion: value.version,
              payload: JSON.parse(JSON.stringify(value)),
            });
            return value;
          }),
      };
      context.effect(
        () => provideService(context, MEDIA_AUDIO_TRACK_SERVICE, audioTracks),
        `service:${MEDIA_AUDIO_TRACK_SERVICE}`,
      );
      if (host) {
        const executor: ProviderActionExecutorService = {
          execute: (preview) => {
            const accepted = tasks.start({
              kind: `provider.${preview.kind}`,
              title: "已确认的厂商任务",
              projectId: preview.projectId,
              result: { providerActionPreviewId: preview.id },
            });
            queueMicrotask(() => {
              const run =
                preview.kind === "image"
                  ? runImageGeneration({
                      context,
                      host,
                      records: service,
                      tasks,
                      value: ImageGenerationInputSchema.parse({
                        ...preview.parameters,
                        projectId: preview.projectId,
                        providerId: preview.providerId,
                      }),
                    })
                  : preview.kind === "audio"
                    ? runTtsGeneration({
                        context,
                        host,
                        records: service,
                        tasks,
                        value: TtsGenerationInputSchema.parse({
                          ...preview.parameters,
                          projectId: preview.projectId,
                          providerId: preview.providerId,
                        }),
                      })
                    : preview.kind === "video"
                      ? createVideoGeneration({
                          context,
                          host,
                          production,
                          records: service,
                          tasks,
                          value: VideoGenerationInputSchema.parse({
                            ...preview.parameters,
                            projectId: preview.projectId,
                            providerId: preview.providerId,
                          }),
                          idempotencyKey: `provider-action:${preview.id}`,
                        })
                      : Promise.reject(
                          new Error("远程渲染厂商执行器尚未配置。"),
                        );
              void run
                .then((result) =>
                  tasks.update(accepted.id, {
                    status: "succeeded",
                    progress: 1,
                    result,
                  }),
                )
                .catch((error) =>
                  tasks.update(accepted.id, {
                    status: "failed",
                    error:
                      error instanceof Error ? error.message : "厂商任务失败",
                  }),
                );
            });
            return { taskId: accepted.id };
          },
        };
        context.effect(
          () =>
            provideService(context, PROVIDER_ACTION_EXECUTOR_SERVICE, executor),
          `service:${PROVIDER_ACTION_EXECUTOR_SERVICE}`,
        );
      }
      for (const contribution of [
        ...resourceRoutes(workspace, service),
        ...likenessRoutes(context, workspace, host),
        ...assetCenterRoutes(service, production),
        ...visualActionRoutes(service),
        ...audioTrackRoutes(workspace, production, audioTracks),
        ...episodeMediaRoutes(
          context,
          workspace,
          production,
          service,
          audioTracks,
        ),
        ...generationRoutes(context, host, production, service, tasks),
      ])
        context.effect(
          () => context.http.register(contribution),
          `route:${contribution.id}`,
        );
    },
  });
}

export const mediaPlugin = createMediaPlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "media-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createMediaPlugin(
        ctx.pluginEnvironment.host as Parameters<typeof createMediaPlugin>[0],
      ),
      config,
    );
  },
};
