import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  MediaRecordSchema,
  AudioTrackSchema,
  type MediaArtifactDescriptor,
  type MediaRecordService,
  type MediaAudioTrackService,
  type MediaSourceStatus,
} from "@dramaip/contracts/media";
import { TimelineManifestSchema } from "@dramaip/contracts/timeline";
import { buildTimelineRenderAudioSources } from "./render-audio-sources.js";
import { validTimelineRenderAudioPlan } from "@dramaip/desktop-host";

function fixture() {
  const now = "2026-10-07T00:00:00.000Z";
  const projectId = randomUUID(),
    episodeId = randomUUID();
  const records = new Map();
  const artifacts = new Map<string, MediaArtifactDescriptor>();
  const statuses = new Map<string, MediaSourceStatus>();
  const archiveCalls: unknown[][] = [];
  const track = (
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx",
    startFrame: number,
  ) => {
    const id = randomUUID(),
      assetId = randomUUID();
    records.set(
      assetId,
      MediaRecordSchema.parse({
        id: assetId,
        kind: kind === "video" ? "video" : "audio",
        domain: kind === "video" ? "video" : "audio",
        projectId,
        parentId: episodeId,
        title: kind,
        payload: {},
        version: 3,
        createdAt: now,
        updatedAt: now,
      }),
    );
    artifacts.set(assetId, {
      artifactId: randomUUID(),
      mediaRef: randomUUID(),
      kind: kind === "video" ? "video" : "audio",
      mimeType: kind === "video" ? "video/mp4" : "audio/wav",
      extension: kind === "video" ? ".mp4" : ".wav",
      sizeBytes: 16,
      sha256: "a".repeat(64),
      status: "archived",
    });
    statuses.set(assetId, {
      recordId: assetId,
      recordVersion: 3,
      state: "unbound",
      verification: "actual-record-version-only",
      reasons: [],
    });
    return {
      id,
      kind,
      label: kind,
      muted: false,
      solo: false,
      clips: [
        {
          id: randomUUID(),
          trackId: id,
          name: kind,
          assetId,
          assetVersion: 3,
          mediaRef: "editable-FAKE-ref-never-use",
          startFrame,
          durationFrames: kind === "video" ? 75 : 20,
          sourceOffsetFrame: 2,
          mediaStatus: "linked",
          manuallyEdited: true,
          volume: 1.8,
          fadeInFrames: 90,
          fadeOutFrames: 80,
          duckingGain: 0.4,
        },
      ],
    };
  };
  const timeline = TimelineManifestSchema.parse({
    format: "dramaip-timeline",
    schemaVersion: 2,
    id: randomUUID(),
    projectId,
    adaptationId: randomUUID(),
    episodeId,
    sourceFingerprint: "controlled-owner-fixture",
    profile: {
      width: 1080,
      height: 1920,
      frameRate: { numerator: 25, denominator: 1, dropFrame: false },
      audioSampleRate: 48000,
      channels: 2,
    },
    timebase: "frames",
    durationFrames: 75,
    migrationWarnings: [],
    version: 4,
    createdAt: now,
    updatedAt: now,
    tracks: [
      track("video", 0),
      track("dialogue", 25),
      track("narration", 40),
      track("bgm", 5),
      track("sfx", 10),
    ],
  });
  const audioTracks: ReturnType<typeof AudioTrackSchema.parse>[] = [];
  const media: MediaRecordService = {
    get: (id) => records.get(id),
    sourceStatus: (id) => statuses.get(id),
    archivedArtifact(id, project, version) {
      archiveCalls.push([id, project, version]);
      return records.get(id)?.projectId === project &&
        records.get(id)?.version === version
        ? artifacts.get(id)
        : undefined;
    },
    create() {
      throw Error("Read path wrote a Media record");
    },
    list: () => [],
    update() {
      throw Error("Read path wrote a Media record");
    },
    remove() {
      throw Error("Read path removed a Media record");
    },
    registerArchivedArtifact() {
      throw Error("Read path registered an archive");
    },
  };
  const audio: MediaAudioTrackService = {
    list: () => audioTracks,
    create() {
      throw Error("Read path wrote an audio track");
    },
    adopt() {
      throw Error("Read path adopted an audio track");
    },
  };
  const videoClip = timeline.tracks[0]!.clips[0]!;
  const artifact = artifacts.get(videoClip.assetId!)!;
  const videoClips = [
    {
      mediaRef: artifact.mediaRef,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      mimeType: "video/mp4" as const,
      startFrame: videoClip.startFrame,
      durationFrames: videoClip.durationFrames,
      sourceOffsetFrame: videoClip.sourceOffsetFrame,
    },
  ];
  const read = () =>
    buildTimelineRenderAudioSources(timeline, media, audio, videoClips);
  return {
    timeline,
    records,
    artifacts,
    statuses,
    media,
    audio,
    audioTracks,
    archiveCalls,
    videoClips,
    read,
  };
}

test("all five audible kinds freeze exact original owner archives and unchanged saved controls", () => {
  const f = fixture();
  const before = JSON.stringify(f.timeline);
  const result = f.read();
  assert.deepEqual(result.blockers, []);
  assert.equal(result.audioPlan.clips.length, 5);
  assert(
    result.audioPlan.clips.every(
      (clip) =>
        clip.volume === 1.8 &&
        clip.fadeInFrames === 90 &&
        clip.fadeOutFrames === 80 &&
        clip.duckingGain === 0.4,
    ),
  );
  assert(
    f.archiveCalls.every(
      ([, project, version]) =>
        project === f.timeline.projectId && version === 3,
    ),
  );
  assert(!JSON.stringify(result.audioPlan).includes("editable-FAKE"));
  assert.equal(JSON.stringify(f.timeline), before);
  assert(validTimelineRenderAudioPlan(result.audioPlan, 75, f.videoClips));
});
test("muted or solo-excluded tracks have explicit excluded IDs and are not archived for mixing", () => {
  const f = fixture();
  f.timeline.tracks[0]!.muted = true;
  f.timeline.tracks[1]!.solo = true;
  const result = f.read();
  assert.deepEqual(result.blockers, []);
  assert.equal(result.audioPlan.clips.length, 1);
  assert.equal(result.audioPlan.clips[0]!.kind, "dialogue");
  assert.equal(result.snapshot.excludedClipIds.length, 4);
  assert.equal(f.archiveCalls.length, 1);
});
test("zero-volume dialogue is retained rather than being removed by acoustic guessing", () => {
  const f = fixture();
  f.timeline.tracks[1]!.clips[0]!.volume = 0;
  const result = f.read();
  assert.deepEqual(result.blockers, []);
  assert(
    result.audioPlan.clips.some(
      (clip) => clip.kind === "dialogue" && clip.volume === 0,
    ),
  );
});
test("all inaudible sources have a known empty versioned plan, not an unknown fallback", () => {
  const f = fixture();
  f.timeline.tracks.forEach((track) => {
    track.muted = true;
  });
  const result = f.read();
  assert.deepEqual(result.blockers, []);
  assert.equal(result.audioPlan.clips.length, 0);
  assert.equal(f.archiveCalls.length, 0);
  assert.equal(result.snapshot.excludedClipIds.length, 5);
  assert.equal(result.audioPlan.version, 1);
});
test("missing/cross-project/wrong-version/unverified owner sources prevent the whole render", () => {
  for (const fault of [
    "missing",
    "cross-project",
    "version",
    "unverified",
    "stale",
    "missing-version",
  ] as const) {
    const f = fixture();
    const clip = f.timeline.tracks[1]!.clips[0]!,
      id = clip.assetId!;
    if (fault === "missing") f.records.delete(id);
    if (fault === "cross-project") f.records.get(id).projectId = randomUUID();
    if (fault === "version") f.records.get(id).version = 4;
    if (fault === "unverified" || fault === "stale")
      f.statuses.get(id)!.state = fault;
    if (fault === "missing-version") delete clip.assetVersion;
    assert(f.read().blockers.length > 0, fault);
  }
});
test("bad/extra archive metadata, quarantine, conflicting MIME or descriptor identities are not accepted", () => {
  for (const fault of [
    { status: "quarantined" },
    { kind: "image" },
    { mimeType: "audio/wav", extension: ".mp3" },
    { mediaRef: "../secret" },
    { sizeBytes: 2 ** 31 + 1 },
    { sha256: "bad" },
    { credential: "never" },
  ]) {
    const f = fixture();
    const id = f.timeline.tracks[1]!.clips[0]!.assetId!;
    Object.assign(f.artifacts.get(id)!, fault);
    assert(f.read().blockers.length > 0);
  }
  const f = fixture();
  const first = f.artifacts.get(f.timeline.tracks[1]!.clips[0]!.assetId!)!;
  const second = f.artifacts.get(f.timeline.tracks[2]!.clips[0]!.assetId!)!;
  second.mediaRef = first.mediaRef;
  second.sha256 = "b".repeat(64);
  assert(f.read().blockers.some((value) => value.includes("冲突")));
});
test("source changes during owner archive reads are rechecked rather than trusted from the first plan", () => {
  const f = fixture();
  const original = f.media.archivedArtifact;
  f.media.archivedArtifact = (id, project, version) => {
    const result = original(id, project, version);
    f.statuses.get(id)!.state = "stale";
    return result;
  };
  assert(f.read().blockers.length > 0);
});
test("adopted audio-track source versions and original clip links are checked, not replaced", () => {
  const f = fixture();
  const clip = f.timeline.tracks[1]!.clips[0]!,
    sourceClipId = randomUUID(),
    trackId = randomUUID();
  const track = AudioTrackSchema.parse({
    id: trackId,
    projectId: f.timeline.projectId,
    episodeId: f.timeline.episodeId,
    kind: "dialogue",
    label: "controlled",
    sourceFingerprint: "original-audio-fingerprint",
    clips: [
      {
        id: sourceClipId,
        assetId: clip.assetId,
        startSeconds: 1,
        durationSeconds: 0.8,
        sourceVersions: [{ kind: "asset", id: clip.assetId, version: 3 }],
      },
    ],
    status: "adopted",
    stale: false,
    sourceState: "current",
    sourceReasons: [],
    version: 7,
    createdAt: f.timeline.createdAt,
    updatedAt: f.timeline.updatedAt,
  });
  f.audioTracks.push(track);
  Object.assign(clip, {
    audioTrackId: trackId,
    audioTrackVersion: 7,
    audioSourceFingerprint: track.sourceFingerprint,
    sourceClipId,
  });
  assert.deepEqual(f.read().blockers, []);
  track.version = 8;
  assert(f.read().blockers.length > 0);
});
test("duplicates, bad controls and audio/image role confusion reject the complete plan", () => {
  for (const patch of [
    { volume: NaN },
    { fadeInFrames: -1 },
    { durationFrames: 100 },
    { kind: "subtitle" },
  ]) {
    const f = fixture();
    const result = f.read();
    const plan = structuredClone(result.audioPlan);
    Object.assign(plan.clips[1]!, patch);
    assert(!validTimelineRenderAudioPlan(plan, 75, f.videoClips));
  }
  const f = fixture();
  f.timeline.tracks[1]!.clips[0]!.id = f.timeline.tracks[2]!.clips[0]!.id;
  assert(f.read().blockers.length > 0);
});
test("audio plan changes invalidate the fingerprint while repeated original reads are immutable", () => {
  const f = fixture();
  const original = f.read();
  assert.equal(f.read().sourceFingerprint, original.sourceFingerprint);
  f.timeline.tracks[1]!.clips[0]!.volume = 0.6;
  assert.notEqual(f.read().sourceFingerprint, original.sourceFingerprint);
  assert.equal(original.audioPlan.clips[1]!.volume, 1.8);
});
test("Host plan policy/version/extra keys and different video binding cannot silently become legacy silence", () => {
  const f = fixture(),
    plan = f.read().audioPlan;
  for (const patch of [
    { version: 2 },
    { policy: "auto-normalize" },
    { videoEmbeddedAudio: "drop" },
    { path: "/private" },
  ])
    assert(
      !validTimelineRenderAudioPlan({ ...plan, ...patch }, 75, f.videoClips),
    );
  assert(
    !validTimelineRenderAudioPlan(plan, 75, [
      { ...f.videoClips[0]!, sha256: "b".repeat(64) },
    ]),
  );
});
