import { describe, expect, it } from "bun:test";
import type { TimelineManifest } from "@dramaip/contracts/timeline";
import {
  createTimelinePreviewClock,
  timelinePreviewFrame,
  timelinePreviewLimitations,
  waitTimelinePreviewPlay,
  type TimelinePreviewSource,
} from "./timeline-preview";

const id = () => crypto.randomUUID();
export const previewTimeline = (): TimelineManifest => {
  const video = id(),
    voice = id(),
    bgm = id(),
    subtitle = id();
  const clip = (trackId: string, startFrame = 0, durationFrames = 50) => ({
    id: id(),
    trackId,
    name: "受控片段",
    startFrame,
    durationFrames,
    sourceOffsetFrame: 25,
    mediaStatus: "linked" as const,
    manuallyEdited: false,
  });
  return {
    format: "dramaip-timeline",
    schemaVersion: 2,
    id: id(),
    projectId: id(),
    adaptationId: id(),
    episodeId: id(),
    sourceFingerprint: "bound",
    profile: {
      width: 1080,
      height: 1920,
      frameRate: { numerator: 25, denominator: 1, dropFrame: false },
      audioSampleRate: 48000,
      channels: 2,
    },
    timebase: "frames",
    durationFrames: 50,
    migrationWarnings: [],
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tracks: [
      {
        id: video,
        kind: "video",
        label: "视频",
        muted: true,
        solo: false,
        clips: [clip(video)],
      },
      {
        id: voice,
        kind: "dialogue",
        label: "对白",
        muted: false,
        solo: false,
        clips: [clip(voice, 25, 25)],
      },
      {
        id: bgm,
        kind: "bgm",
        label: "配乐",
        muted: false,
        solo: false,
        clips: [
          {
            ...clip(bgm),
            volume: 1.8,
            fadeInFrames: 25,
            fadeOutFrames: 25,
            duckingGain: 0.4,
          },
        ],
      },
      {
        id: subtitle,
        kind: "subtitle",
        label: "字幕",
        muted: false,
        solo: true,
        clips: [{ ...clip(subtitle, 25, 25), text: "实际字幕" }],
      },
    ],
  };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function clockFixture(timeline = previewTimeline()) {
  let now = 0,
    callback: (() => void) | undefined;
  const positions: number[] = [],
    playing: boolean[] = [],
    failures: unknown[] = [];
  const values = new Map<
    string,
    { time: number; gain: number; playing: boolean }
  >();
  const sources = Object.fromEntries(
    timeline.tracks
      .filter((track) => track.kind !== "subtitle")
      .flatMap((track) => track.clips)
      .map((clip) => {
        const value = { time: 0, gain: 0, playing: false };
        values.set(clip.id, value);
        return [
          clip.id,
          {
            currentTime: () => value.time,
            seek: (time: number) => {
              value.time = time;
            },
            gain: (gain: number) => {
              value.gain = gain;
            },
            play: async () => {
              value.playing = true;
            },
            pause: () => {
              value.playing = false;
            },
          } satisfies TimelinePreviewSource,
        ];
      }),
  );
  const clock = createTimelinePreviewClock({
    timeline,
    sources,
    scheduler: {
      now: () => now,
      schedule: (next) => {
        callback = next;
        return next;
      },
      cancel: () => {
        callback = undefined;
      },
    },
    position: (value) => positions.push(value),
    playing: (value) => playing.push(value),
    failure: (cause) => failures.push(cause),
  });
  return {
    clock,
    sources,
    values,
    positions,
    playing,
    failures,
    tick: (milliseconds: number) => {
      now += milliseconds;
      const next = callback;
      callback = undefined;
      next?.();
    },
  };
}

describe("actual media timeline preview", () => {
  it("bounds pending native play and cancels without starting an already aborted source", async () => {
    const controller = new AbortController();
    const pending = waitTimelinePreviewPlay(
      () => new Promise<void>(() => {}),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow("取消或启动超时");
    let calls = 0;
    await expect(
      waitTimelinePreviewPlay(async () => {
        calls++;
      }, controller.signal),
    ).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(
      waitTimelinePreviewPlay(
        () => Promise.reject(undefined),
        new AbortController().signal,
      ),
    ).rejects.toThrow("实际播放未成功启动");
    await expect(
      waitTimelinePreviewPlay(
        () => new Promise<void>(() => {}),
        new AbortController().signal,
        5,
      ),
    ).rejects.toThrow("取消或启动超时");
  });
  it("uses rational frames, source offsets, exclusive ends, independent subtitle and actual fades/ducking/gain over one", () => {
    const timeline = previewTimeline();
    const bgm = timeline.tracks[2]!.clips[0]!.id;
    const video = timeline.tracks[0]!.clips[0]!.id;
    expect(
      timelinePreviewFrame(timeline, 0.5).sources.find(
        (item) => item.clipId === bgm,
      )?.gain,
    ).toBe(0.9);
    const atVoice = timelinePreviewFrame(timeline, 1.5);
    expect(
      atVoice.sources.find((item) => item.clipId === bgm)?.gain,
    ).toBeCloseTo(0.36);
    expect(atVoice.sources.find((item) => item.clipId === video)).toMatchObject(
      { visual: true, gain: 0, sourceSeconds: 2.5 },
    );
    expect(atVoice.subtitles).toEqual(["实际字幕"]);
    expect(timelinePreviewFrame(timeline, 2).sources).toHaveLength(0);
    timeline.profile.frameRate = {
      numerator: 30000,
      denominator: 1001,
      dropFrame: false,
    };
    expect(
      timelinePreviewFrame(timeline, 0.5).sources[0]?.sourceSeconds,
    ).toBeCloseTo(0.5 + (25 * 1001) / 30000);
  });
  it("respects mute/solo without pausing video pictures or letting subtitle solo silence every sound", () => {
    const timeline = previewTimeline();
    timeline.tracks[1]!.muted = true;
    expect(timelinePreviewFrame(timeline, 1.5).sources).toHaveLength(2);
    expect(timelinePreviewFrame(timeline, 1.5).sources[1]?.gain).toBeCloseTo(
      0.9,
    );
    timeline.tracks[2]!.solo = true;
    timeline.tracks[1]!.muted = false;
    expect(timelinePreviewFrame(timeline, 1.5).sources).toHaveLength(2);
  });
  it("requires all active real ports and exposes rejected native play instead of advancing", async () => {
    for (const absent of [false, true]) {
      const value = clockFixture();
      const sourceId = Object.keys(value.sources)[0]!;
      if (absent) delete value.sources[sourceId];
      else
        value.sources[sourceId]!.play = async () => {
          throw new Error("native play rejected");
        };
      value.clock.toggle();
      await flush();
      value.tick(500);
      expect(value.clock.isPlaying()).toBe(false);
      expect(value.failures).toHaveLength(1);
      expect(value.positions).toEqual([0]);
      expect([...value.values.values()].every((item) => !item.playing)).toBe(
        true,
      );
    }
  });
  it("starts real ports before advancing, pauses at boundaries, and holds the exact endpoint", async () => {
    const value = clockFixture();
    value.clock.toggle();
    await flush();
    expect(value.clock.isPlaying()).toBe(true);
    value.tick(1200);
    await flush();
    expect(value.positions.at(-1)).toBe(1);
    value.tick(500);
    expect(value.positions.at(-1)).toBe(1.5);
    value.tick(800);
    await flush();
    expect(value.positions.at(-1)).toBe(2);
    expect(value.clock.isPlaying()).toBe(false);
    expect([...value.values.values()].every((item) => !item.playing)).toBe(
      true,
    );
  });
  it("manual seek pauses, resets the playback anchor and maps trimmed offsets instead of jumping back", async () => {
    const value = clockFixture();
    value.clock.toggle();
    await flush();
    value.tick(500);
    value.clock.seek(1.5);
    expect(value.clock.isPlaying()).toBe(false);
    expect(value.values.get(Object.keys(value.sources)[0]!)?.time).toBe(2.5);
    value.clock.toggle();
    await flush();
    value.tick(100);
    expect(value.positions.at(-1)).toBeCloseTo(1.6);
    value.clock.seek(100);
    expect(value.positions.at(-1)).toBe(2);
    value.clock.dispose();
    value.clock.toggle();
    value.tick(1000);
    expect(value.positions.at(-1)).toBe(2);
  });
  it("cancellation/disposal during pending play cannot resume or schedule a late clock", async () => {
    for (const dispose of [true, false]) {
      const value = clockFixture();
      let finish!: () => void;
      value.sources[Object.keys(value.sources)[0]!]!.play = () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        });
      value.clock.toggle();
      if (dispose) value.clock.dispose();
      else value.clock.toggle();
      finish();
      await flush();
      value.tick(1000);
      expect(value.clock.isPlaying()).toBe(false);
      expect(value.positions).toEqual([0]);
    }
  });
  it("refuses visual overlap and excessive clip graphs explicitly", () => {
    const timeline = previewTimeline();
    const clip = timeline.tracks[0]!.clips[0]!;
    timeline.tracks[0]!.clips.push({ ...clip, id: id(), startFrame: 25 });
    expect(timelinePreviewLimitations(timeline)).toHaveLength(1);
    timeline.tracks[0]!.clips = Array.from({ length: 65 }, (_, index) => ({
      ...clip,
      id: id(),
      startFrame: index * 50,
    }));
    expect(timelinePreviewLimitations(timeline)).toHaveLength(1);
  });
});
