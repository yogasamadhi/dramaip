import { describe, expect, test } from "vitest";
import { normalizeTimelineManifest } from "./index";

const ids = {
  timeline: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  adaptation: "00000000-0000-4000-8000-000000000003",
  episode: "00000000-0000-4000-8000-000000000004",
  track: "00000000-0000-4000-8000-000000000005",
  clip: "00000000-0000-4000-8000-000000000006",
};

describe("Timeline v2 integer-frame migration", () => {
  test("converts a legacy seconds manifest deterministically and records rounding", () => {
    const migrated = normalizeTimelineManifest({
      format: "dramaip-timeline",
      schemaVersion: 1,
      id: ids.timeline,
      projectId: ids.project,
      adaptationId: ids.adaptation,
      episodeId: ids.episode,
      sourceFingerprint: "legacy",
      frameRate: 25,
      timebase: "seconds",
      durationSeconds: 3.07,
      tracks: [
        {
          id: ids.track,
          kind: "video",
          label: "视频",
          muted: false,
          solo: false,
          clips: [
            {
              id: ids.clip,
              name: "镜头 1",
              startSeconds: 0.03,
              durationSeconds: 3.04,
              sourceOffsetSeconds: 0.02,
              mediaStatus: "unattached",
              manuallyEdited: false,
            },
          ],
        },
      ],
      version: 4,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.profile).toEqual({
      width: 1080,
      height: 1920,
      frameRate: { numerator: 25, denominator: 1, dropFrame: false },
      audioSampleRate: 48_000,
      channels: 2,
    });
    expect(migrated.tracks[0]?.clips[0]).toMatchObject({
      trackId: ids.track,
      startFrame: 1,
      durationFrames: 76,
      sourceOffsetFrame: 1,
    });
    expect(migrated.durationFrames).toBe(77);
    expect(migrated.migrationWarnings[0]).toContain("round(seconds × 25)");
  });

  test("keeps an already canonical v2 manifest stable", () => {
    const migrated = normalizeTimelineManifest({
      format: "dramaip-timeline",
      schemaVersion: 2,
      id: ids.timeline,
      projectId: ids.project,
      adaptationId: ids.adaptation,
      episodeId: ids.episode,
      sourceFingerprint: "v2",
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48_000,
        channels: 2,
      },
      timebase: "frames",
      durationFrames: 25,
      migrationWarnings: [],
      tracks: [],
      version: 0,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(migrated.durationFrames).toBe(25);
    expect(migrated.migrationWarnings).toEqual([]);
  });
});
