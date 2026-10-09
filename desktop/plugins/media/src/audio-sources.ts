import { createHash } from "node:crypto";
import {
  optionalService,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import type {
  AudioTrack,
  AudioTrackInput,
  MediaAudioTrackService,
  MediaRecordService,
} from "@dramaip/contracts/media";
import type { ProductionRecordService } from "@dramaip/contracts/production";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import { WRITING_RESOURCE_SERVICE } from "@dramaip/contracts/writing";
import {
  inspectShot,
  mediaContentHash,
  mediaSourceStatus,
} from "./source-bindings.js";

export const audioSourceMigration: PluginMigration = {
  id: "media.0008.audio-source-snapshots",
  pluginId: "media",
  version: "3.0.0-alpha.4",
  dependsOn: ["media.0007.immutable-source-bindings"],
  // Legacy IDs/text cannot establish historical versions. Never backfill proof.
  sql: `CREATE TABLE media_audio_track_sources (
    track_id TEXT PRIMARY KEY REFERENCES media_audio_tracks(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL, fingerprint TEXT NOT NULL
  );
  CREATE TRIGGER media_audio_source_immutable BEFORE UPDATE ON media_audio_track_sources
    BEGIN SELECT RAISE(ABORT, 'audio sources are immutable'); END;
  CREATE TABLE media_audio_adoption_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    track_id TEXT NOT NULL REFERENCES media_audio_tracks(id) ON DELETE CASCADE
  );`,
};

interface TrackRow {
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
interface ProofRow {
  value_json: string;
  fingerprint: string;
}
type SourceVersion = NonNullable<
  AudioTrack["clips"][number]["sourceVersions"]
>[number];
interface ClipProof {
  id: string;
  inputHash: string;
  versions: SourceVersion[];
  shot?: { id: string; version: number; sceneId?: string; scriptId?: string };
  assets: { id: string; version: number; hash: string; bindingId?: string }[];
}
interface Proof {
  schemaVersion: 1;
  projectId: string;
  episodeId: string;
  episodeVersion: number;
  clips: ClipProof[];
}
export interface PreparedAudioTrack {
  track: AudioTrack;
  proof: Proof;
}
export interface AudioSourceInternals {
  read(id: string): AudioTrack | undefined;
  prepare(input: AudioTrackInput): PreparedAudioTrack;
  assertPrepared(value: PreparedAudioTrack): void;
  persistPrepared(tx: UnitOfWorkTransaction, value: PreparedAudioTrack): void;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class AudioSourceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createAudioSourceService(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  production: ProductionRecordService,
  records: MediaRecordService,
): MediaAudioTrackService & AudioSourceInternals {
  const raw = (id: string) =>
    context.uow.execute((tx) =>
      tx.get<TrackRow>("SELECT * FROM media_audio_tracks WHERE id = ?", id),
    );
  const proof = (id: string) =>
    context.uow.execute((tx) =>
      tx.get<ProofRow>(
        "SELECT * FROM media_audio_track_sources WHERE track_id = ?",
        id,
      ),
    );
  const inputHash = (clip: AudioTrack["clips"][number]) =>
    hash({
      shotId: clip.shotId,
      assetId: clip.assetId,
      voiceProfileId: clip.voiceProfileId,
      startSeconds: clip.startSeconds,
      durationSeconds: clip.durationSeconds,
      text: clip.text,
    });
  // All cross-owner reads occur before the Media write transaction. No await
  // between the final source check and synchronous CAS/receipt/event commit.
  const capture = (
    projectId: string,
    episodeId: string,
    clips: AudioTrack["clips"],
  ) => {
    const reasons: string[] = [];
    const episode = production.get(episodeId);
    if (
      !workspace.get(projectId) ||
      episode?.kind !== "episodes" ||
      episode.projectId !== projectId
    )
      reasons.push("实际分集不存在或不属于本项目。");
    const clipProofs = clips.map((clip) => {
      const value: ClipProof = {
        id: clip.id,
        inputHash: inputHash(clip),
        versions: [],
        assets: [],
      };
      const checkShot = (id: string) => {
        const source = inspectShot(context, projectId, id);
        reasons.push(...source.reasons);
        if (source.episodeId !== episodeId)
          reasons.push("片段镜头不属于音轨实际分集。");
        if (source.shot) {
          const shot = {
            id: source.shot.id,
            version: source.shot.version,
            sceneId: source.sceneId,
            scriptId: source.scriptId,
          };
          if (value.shot && value.shot.id !== id)
            reasons.push("片段与素材的不可编辑镜头来源不一致。");
          else value.shot = shot;
          if (
            !value.versions.some(
              (item) => item.kind === "shot" && item.id === id,
            )
          )
            value.versions.push({
              kind: "shot",
              id,
              version: source.shot.version,
            });
        }
      };
      if (clip.shotId) checkShot(clip.shotId);
      const checkAsset = (id: string, kind: "asset" | "voice-sample") => {
        const asset = records.get(id);
        if (
          !asset ||
          asset.projectId !== projectId ||
          !["assets", "audio"].includes(asset.kind)
        ) {
          reasons.push("片段音频素材／音色样本不存在、类型不符或跨项目。");
          return;
        }
        const status = mediaSourceStatus(context, asset);
        const declaredType = asset.payload["预览类型"];
        const mime = asset.payload["mimeType"];
        if (
          (typeof declaredType === "string" && declaredType !== "audio") ||
          (typeof mime === "string" && !mime.startsWith("audio/"))
        )
          reasons.push("片段／音色样本声明为非音频，不能作为音轨音频来源。");
        if (
          ["stale", "unverified"].includes(status.state) ||
          asset.payload.stale === true
        )
          reasons.push("片段音频素材／音色样本来源过期或未核验。");
        if (status.binding && kind === "asset")
          checkShot(status.binding.shotId);
        value.assets.push({
          id,
          version: asset.version,
          hash: mediaContentHash(asset),
          ...(status.binding ? { bindingId: status.binding.id } : {}),
        });
        value.versions.push({ kind, id, version: asset.version });
      };
      if (clip.assetId) checkAsset(clip.assetId, "asset");
      if (clip.voiceProfileId) {
        const voice = context.uow.execute((tx) =>
          tx.get<{
            id: string;
            project_id: string;
            version: number;
            sample_asset_id: string | null;
            character_id: string | null;
          }>(
            "SELECT * FROM media_voice_profiles WHERE id = ?",
            clip.voiceProfileId,
          ),
        );
        if (!voice || voice.project_id !== projectId)
          reasons.push("音色不存在或跨项目。");
        else {
          value.versions.push({
            kind: "voice-profile",
            id: voice.id,
            version: voice.version,
          });
          if (voice.sample_asset_id)
            checkAsset(voice.sample_asset_id, "voice-sample");
          if (voice.character_id) {
            const character = optionalService(
              context,
              WRITING_RESOURCE_SERVICE,
            )?.get(voice.character_id);
            if (
              !character ||
              character.domain !== "characters" ||
              character.projectId !== projectId
            )
              reasons.push("音色人物不存在或跨项目。");
            else
              value.versions.push({
                kind: "voice-character",
                id: character.id,
                version: character.version,
              });
          }
        }
      }
      return value;
    });
    const value: Proof = {
      schemaVersion: 1,
      projectId,
      episodeId,
      episodeVersion: episode?.version ?? -1,
      clips: clipProofs,
    };
    return { value, fingerprint: hash(value), reasons: [...new Set(reasons)] };
  };
  const project = (row: TrackRow): AudioTrack => {
    const clips = JSON.parse(row.clips_json) as AudioTrack["clips"];
    const frozen = proof(row.id);
    const reasons: string[] = [];
    let sourceState: AudioTrack["sourceState"] = "current";
    const revision = context.uow.execute((tx) =>
      tx.get<{ value_json: string }>(
        "SELECT value_json FROM media_audio_track_revision_links WHERE track_id = ?",
        row.id,
      ),
    );
    const link = revision
      ? (JSON.parse(revision.value_json) as NonNullable<AudioTrack["revision"]>)
      : undefined;
    const currentRevision = link
      ? context.uow.execute(
          (tx) =>
            tx.get<{ review_id: string }>(
              "SELECT review_id FROM media_audio_revision_heads WHERE source_track_id = ?",
              link.sourceTrackId,
            )?.review_id,
        )
      : undefined;
    const superseded = context.uow.execute((tx) =>
      tx.get<{ track_id: string }>(
        "SELECT track_id FROM media_audio_revision_adopted_heads WHERE source_track_id = ?",
        row.id,
      ),
    );
    if (!frozen) {
      sourceState = "unverified";
      reasons.push(
        "历史音轨没有实际来源版本冻结，旧 ID／文本不构成证明；请保留旧轨并明确新建。 ",
      );
    } else {
      const current = capture(row.project_id, row.episode_id, clips);
      reasons.push(...current.reasons);
      if (
        current.fingerprint !== frozen.fingerprint ||
        row.source_fingerprint !== frozen.fingerprint
      )
        reasons.push("实际镜头、素材、音色或片段内容已不同于冻结版本。");
      if (row.stale) reasons.push(row.stale_reason ?? "音轨已标记过期。");
      if (superseded)
        reasons.push("已有明确确认并另行采用的替换音轨，旧轨保留为历史。");
      if (link && row.status === "draft" && currentRevision !== link.reviewId)
        reasons.push("该草稿已有另一份明确确认的竞争修订，保留为历史候选。");
      if (reasons.length) sourceState = "stale";
    }
    return {
      id: row.id,
      projectId: row.project_id,
      episodeId: row.episode_id,
      kind: row.kind,
      label: row.label,
      sourceFingerprint: row.source_fingerprint,
      clips,
      status: row.status,
      stale: sourceState !== "current",
      ...(reasons.length ? { staleReason: reasons.join("；") } : {}),
      sourceState,
      sourceReasons: reasons,
      ...(link ? { revision: link } : {}),
      ...(superseded ? { supersededBy: superseded.track_id } : {}),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };
  const prepare = (input: AudioTrackInput): PreparedAudioTrack => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clips: AudioTrack["clips"] = input.clips.map((clip) => ({
      ...clip,
      id: crypto.randomUUID(),
    }));
    const captured = capture(input.projectId, input.episodeId, clips);
    if (captured.reasons.length)
      throw new AudioSourceError(
        400,
        "AUDIO_SOURCE_INVALID",
        captured.reasons.join("；"),
      );
    for (const clip of clips) {
      const source = captured.value.clips.find((item) => item.id === clip.id)!;
      clip.sourceFingerprint = hash(source);
      clip.sourceVersions = source.versions;
    }
    return {
      proof: captured.value,
      track: {
        id,
        ...input,
        label: input.label.trim(),
        clips,
        sourceFingerprint: captured.fingerprint,
        status: "draft",
        stale: false,
        sourceState: "current",
        sourceReasons: [],
        version: 0,
        createdAt: now,
        updatedAt: now,
      },
    };
  };
  const persistPrepared = (
    tx: UnitOfWorkTransaction,
    value: PreparedAudioTrack,
  ) => {
    const track = value.track;
    tx.run(
      `INSERT INTO media_audio_tracks(id,project_id,episode_id,kind,label,source_fingerprint,clips_json,status,stale,stale_reason,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'draft',0,NULL,0,?,?)`,
      track.id,
      track.projectId,
      track.episodeId,
      track.kind,
      track.label.trim(),
      track.sourceFingerprint,
      JSON.stringify(track.clips),
      track.createdAt,
      track.createdAt,
    );
    tx.run(
      "INSERT INTO media_audio_track_sources VALUES (?,?,?)",
      track.id,
      JSON.stringify(value.proof),
      track.sourceFingerprint,
    );
    tx.append({
      type: "media.audio-track-created.v1",
      pluginId: "media",
      aggregateType: "audio-track",
      aggregateId: track.id,
      aggregateVersion: 0,
      payload: {
        id: track.id,
        projectId: track.projectId,
        episodeId: track.episodeId,
        sourceFingerprint: track.sourceFingerprint,
      },
    });
  };
  return {
    read: (id) => {
      const row = raw(id);
      return row ? project(row) : undefined;
    },
    prepare,
    assertPrepared(value) {
      const current = capture(
        value.track.projectId,
        value.track.episodeId,
        value.track.clips,
      );
      if (
        current.reasons.length ||
        current.fingerprint !== value.track.sourceFingerprint
      )
        throw new AudioSourceError(
          409,
          "AUDIO_REVISION_SOURCE_STALE",
          current.reasons.join("；") || "复核后的实际来源已变化。",
        );
    },
    persistPrepared,
    list: (episodeId) =>
      context.uow
        .execute((tx) =>
          tx.all<TrackRow>(
            "SELECT * FROM media_audio_tracks WHERE episode_id = ? ORDER BY created_at, id",
            episodeId,
          ),
        )
        .map(project),
    create(input: AudioTrackInput) {
      const prepared = prepare(input);
      context.uow.execute((tx) => persistPrepared(tx, prepared));
      return project(raw(prepared.track.id)!);
    },
    adopt(id, version, key) {
      const requestHash = hash({ id, version });
      const replay = context.uow.execute((tx) =>
        tx.get<{ request_hash: string; track_id: string }>(
          "SELECT * FROM media_audio_adoption_requests WHERE request_key = ?",
          key,
        ),
      );
      if (replay && replay.request_hash !== requestHash)
        throw new AudioSourceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "同一采用键不能换音轨或版本。",
        );
      const row = raw(id);
      if (!row) return undefined;
      if (replay) return project(row); // Read current projection; never resurrect stale proof.
      if (row.version !== version)
        throw new AudioSourceError(
          412,
          "PRECONDITION_FAILED",
          "音轨版本已变化，请重新核对。",
        );
      const current = project(row);
      if (current.stale)
        throw new AudioSourceError(
          409,
          "AUDIO_SOURCE_STALE",
          current.sourceReasons.join("；"),
        );
      context.uow.execute((tx) => {
        const actual = tx.get<TrackRow>(
          "SELECT * FROM media_audio_tracks WHERE id = ?",
          id,
        );
        if (
          !actual ||
          actual.version !== version ||
          actual.clips_json !== row.clips_json ||
          actual.source_fingerprint !== row.source_fingerprint ||
          actual.stale
        )
          throw new AudioSourceError(
            412,
            "PRECONDITION_FAILED",
            "音轨已变化。",
          );
        if (row.status !== "adopted") {
          tx.run(
            "UPDATE media_audio_tracks SET status = 'adopted', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            new Date().toISOString(),
            id,
            version,
          );
          tx.append({
            type: "media.audio-track-adopted.v1",
            pluginId: "media",
            aggregateType: "audio-track",
            aggregateId: id,
            aggregateVersion: version + 1,
            payload: {
              id,
              projectId: row.project_id,
              episodeId: row.episode_id,
              sourceFingerprint: row.source_fingerprint,
            },
          });
        }
        const revision = tx.get<{ value_json: string }>(
          "SELECT value_json FROM media_audio_track_revision_links WHERE track_id = ?",
          id,
        );
        if (revision) {
          const link = JSON.parse(revision.value_json) as NonNullable<
            AudioTrack["revision"]
          >;
          const confirmed = tx.get<{ review_id: string }>(
            "SELECT review_id FROM media_audio_revision_heads WHERE source_track_id = ?",
            link.sourceTrackId,
          );
          if (confirmed?.review_id !== link.reviewId)
            throw new AudioSourceError(
              409,
              "AUDIO_REVISION_CONFLICT",
              "已有另一份明确确认的修订，请核对当前候选；不能采用旧竞争候选。",
            );
          tx.run(
            "INSERT INTO media_audio_revision_adopted_heads VALUES (?,?) ON CONFLICT(source_track_id) DO UPDATE SET track_id = excluded.track_id",
            link.sourceTrackId,
            id,
          );
        }
        tx.run(
          "INSERT INTO media_audio_adoption_requests VALUES (?,?,?)",
          key,
          requestHash,
          id,
        );
      });
      return project(raw(id)!);
    },
  };
}
