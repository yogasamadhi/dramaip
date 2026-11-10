import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  AudioTrackSchema,
  type MediaAudioTrackService,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  TimelineManifestSchema,
  TimelineRenderSubtitlePolicySchema,
  type TimelineClip,
} from "@dramaip/contracts/timeline";
import { buildTimelineRenderSubtitleSources } from "./render-subtitle-sources.js";
import { buildTimelineRenderSources } from "./render-sources.js";

function fixture() {
  const now = "2026-10-07T00:00:00.000Z",
    projectId = randomUUID(),
    episodeId = randomUUID(),
    trackId = randomUUID();
  const clip: TimelineClip = {
    id: randomUUID(),
    trackId,
    name: "subtitle",
    startFrame: 2,
    durationFrames: 5,
    sourceOffsetFrame: 0,
    mediaStatus: "unattached",
    manuallyEdited: true,
    text: ' 字幕 %{n}\n原文 ";[v] ',
  };
  const timeline = TimelineManifestSchema.parse({
    format: "dramaip-timeline",
    schemaVersion: 2,
    id: randomUUID(),
    projectId,
    episodeId,
    adaptationId: randomUUID(),
    sourceFingerprint: "original",
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
    version: 2,
    createdAt: now,
    updatedAt: now,
    tracks: [
      {
        id: trackId,
        kind: "subtitle",
        label: "原字幕",
        muted: false,
        solo: false,
        clips: [clip],
      },
    ],
  });
  const owners = [
    AudioTrackSchema.parse({
      id: randomUUID(),
      projectId,
      episodeId,
      kind: "dialogue",
      label: "原音轨",
      sourceFingerprint: "saved-owner",
      status: "adopted",
      stale: false,
      sourceState: "current",
      sourceReasons: [],
      version: 3,
      createdAt: now,
      updatedAt: now,
      clips: [
        {
          id: randomUUID(),
          shotId: randomUUID(),
          startSeconds: 0,
          durationSeconds: 1,
          text: "original upstream, manual text remains",
        },
      ],
    }),
  ];
  let reads = 0;
  const audio: MediaAudioTrackService = {
    list: (id) => {
      assert.equal(id, episodeId);
      reads++;
      return owners;
    },
    create: () => {
      throw Error("read path wrote");
    },
    adopt: () => {
      throw Error("read path wrote");
    },
  };
  const policy = TimelineRenderSubtitlePolicySchema.parse({
    version: 1,
    mode: "burn-in",
    font: {
      id: randomUUID(),
      packVersion: "1.2.3",
      sha256: "a".repeat(64),
    },
  });
  const read = () =>
    buildTimelineRenderSubtitleSources(timeline, audio, policy);
  return {
    timeline,
    clip: timeline.tracks[0]!.clips[0]!,
    owners,
    audio,
    policy,
    read,
    reads: () => reads,
  };
}
test("subtitle source freezes complete saved literal text, original font and frames without normalization or live aliases", () => {
  const f = fixture(),
    result = f.read();
  assert.deepEqual(result.blockers, []);
  assert.equal(result.subtitlePlan.mode, "burn-in");
  if (result.subtitlePlan.mode !== "burn-in" || f.policy.mode !== "burn-in")
    throw Error("burn required");
  assert.equal(result.subtitlePlan.cues[0]!.text, f.clip.text);
  const hash = result.sourceFingerprint;
  f.clip.text = "replacement";
  f.policy.font.sha256 = "b".repeat(64);
  assert.notEqual(f.read().sourceFingerprint, hash);
  assert.notEqual(result.subtitlePlan.cues[0]!.text, f.clip.text);
  assert.equal(result.subtitlePlan.font.sha256, "a".repeat(64));
});
test("subtitle uses only same-project adopted current exact Audio binding and preserves explicitly saved text", () => {
  const f = fixture(),
    owner = f.owners[0]!,
    source = owner.clips[0]!;
  Object.assign(f.clip, {
    audioTrackId: owner.id,
    audioTrackVersion: owner.version,
    audioSourceFingerprint: owner.sourceFingerprint,
    sourceClipId: source.id,
    shotId: source.shotId,
  });
  assert.deepEqual(f.read().blockers, []);
  for (const patch of [
    { projectId: randomUUID() },
    { episodeId: randomUUID() },
    { kind: "bgm" },
    { status: "draft" },
    { stale: true },
    { sourceState: "unverified" },
    { version: 4 },
    { sourceFingerprint: "replaced" },
  ]) {
    const previous = structuredClone(owner);
    Object.assign(owner, patch);
    assert(f.read().blockers.length);
    Object.assign(owner, previous);
  }
  f.clip.sourceClipId = randomUUID();
  assert(f.read().blockers.length);
});
test("explicit omit never reads excluded subtitle owners; muted burn cues remain excluded and cannot become empty success", () => {
  const f = fixture();
  Object.assign(f.clip, { audioTrackId: randomUUID(), audioTrackVersion: 9 });
  const omitted = buildTimelineRenderSubtitleSources(f.timeline, f.audio, {
    version: 1,
    mode: "omit",
  });
  assert.deepEqual(omitted.blockers, []);
  assert.equal(f.reads(), 0);
  assert.deepEqual(omitted.snapshot.excludedClipIds, [f.clip.id]);
  f.timeline.tracks[0]!.muted = true;
  assert(f.read().blockers.some((item) => item.includes("无参与字幕")));
});
test("subtitle empty/control/surrogate/frame/duplicate/overlap/byte/count failures reject rather than drop or repair", () => {
  for (const patch of [
    { text: " " },
    { text: "\u0000" },
    { text: "\ud800" },
    { text: "a".repeat(16 * 1024 + 1) },
    { startFrame: -1 },
    { durationFrames: 0 },
    { durationFrames: 100 },
    { startFrame: "2" },
    { trackId: randomUUID() },
    { audioTrackVersion: 3 },
  ]) {
    const f = fixture();
    Object.assign(f.clip, patch);
    assert(f.read().blockers.length);
  }
  for (const kind of ["overlap", "duplicate", "count"] as const) {
    const f = fixture(),
      clips = f.timeline.tracks[0]!.clips;
    if (kind === "count")
      for (let n = 0; n < 256; n++) clips.push({ ...f.clip, id: randomUUID() });
    else
      clips.push({
        ...f.clip,
        id: kind === "duplicate" ? f.clip.id : randomUUID(),
      });
    assert(f.read().blockers.length);
  }
});
test("complete source fingerprint includes explicit policy/font/text; absence remains historical snapshot and omit ignores stale subtitles", () => {
  const f = fixture(),
    id = randomUUID(),
    assetId = randomUUID();
  f.timeline.tracks.unshift({
    id,
    kind: "video",
    label: "video",
    muted: true,
    solo: false,
    clips: [
      {
        id: randomUUID(),
        trackId: id,
        name: "video",
        assetId,
        assetVersion: 0,
        startFrame: 0,
        durationFrames: 75,
        sourceOffsetFrame: 0,
        mediaStatus: "linked",
        manuallyEdited: false,
      },
    ],
  });
  const artifact = {
    mediaRef: randomUUID(),
    sha256: "a".repeat(64),
    sizeBytes: 100,
    kind: "video",
    mimeType: "video/mp4",
    extension: ".mp4",
  };
  const media = {
    get: () => ({ id: assetId, projectId: f.timeline.projectId, version: 0 }),
    archivedArtifact: () => artifact,
    sourceStatus: () => ({
      recordId: assetId,
      recordVersion: 0,
      state: "unbound",
    }),
  } as unknown as MediaRecordService;
  const old = buildTimelineRenderSources(f.timeline, media, f.audio);
  assert(!("subtitles" in old.snapshot));
  assert(!("subtitlePlan" in old));
  const burn = buildTimelineRenderSources(f.timeline, media, f.audio, f.policy);
  assert.deepEqual(burn.blockers, []);
  assert.notEqual(old.sourceFingerprint, burn.sourceFingerprint);
  const omit = buildTimelineRenderSources(f.timeline, media, f.audio, {
    version: 1,
    mode: "omit",
  });
  assert.notEqual(omit.sourceFingerprint, burn.sourceFingerprint);
  f.clip.audioTrackId = randomUUID();
  f.clip.audioTrackVersion = 100;
  assert(
    buildTimelineRenderSources(f.timeline, media, f.audio, f.policy).blockers
      .length,
  );
  assert.deepEqual(
    buildTimelineRenderSources(f.timeline, media, f.audio, {
      version: 1,
      mode: "omit",
    }).blockers,
    [],
  );
});
test("subtitle policy refuses unknown version, omit font, path fields and partial/forged font identity", () => {
  const f = fixture();
  for (const input of [
    { version: 2, mode: "omit" },
    { version: 1, mode: "omit", font: {} },
    { ...f.policy, path: "/private/font.ttf" },
    { version: 1, mode: "burn-in", font: { id: randomUUID() } },
  ])
    assert(!TimelineRenderSubtitlePolicySchema.safeParse(input).success);
});
