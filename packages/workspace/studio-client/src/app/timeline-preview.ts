import type { TimelineManifest } from "@dramaip/contracts/timeline";

export interface TimelinePreviewSource {
  currentTime(): number;
  seek(seconds: number): void;
  play(): Promise<void>;
  pause(): void;
  gain(value: number): void;
}
export interface TimelinePreviewScheduler {
  now(): number;
  schedule(callback: () => void): unknown;
  cancel(handle: unknown): void;
}
export interface TimelinePreviewControls {
  toggle(): void;
  seek(seconds: number): void;
  stop(): void;
}

/** Native play promises must not leave the preview indefinitely pending after cancellation. */
export function waitTimelinePreviewPlay(
  play: () => Promise<void>,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (failed: boolean, cause?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (failed) reject(cause ?? new Error("实际播放未成功启动。"));
      else resolve();
    };
    const cancel = () =>
      finish(true, new Error("实际播放已取消或启动超时；未推进预览时钟。"));
    const timer = setTimeout(cancel, timeoutMs);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      void play().then(
        () => finish(false),
        (cause) => finish(true, cause),
      );
    } catch (cause) {
      finish(true, cause);
    }
  });
}

/** Rational project frame rate, exclusive clip ends, and timeline-relative fades. */
export function timelinePreviewFrame(
  timeline: TimelineManifest,
  seconds: number,
) {
  const fps =
    timeline.profile.frameRate.numerator /
    timeline.profile.frameRate.denominator;
  const frame = seconds * fps;
  const solo = timeline.tracks.some(
    (track) => track.kind !== "subtitle" && track.solo,
  );
  const active = timeline.tracks.flatMap((track) =>
    track.clips
      .filter(
        (clip) =>
          frame >= clip.startFrame &&
          frame < clip.startFrame + clip.durationFrames,
      )
      .map((clip) => ({ track, clip })),
  );
  const audible = (track: TimelineManifest["tracks"][number]) =>
    !track.muted && (!solo || track.solo);
  const hasVoice = active.some(
    ({ track }) =>
      (track.kind === "dialogue" || track.kind === "narration") &&
      audible(track),
  );
  return {
    subtitles: active
      .filter(({ track }) => track.kind === "subtitle" && !track.muted)
      .map(({ clip }) => clip.text ?? clip.name),
    sources: active
      .filter(
        ({ track }) =>
          track.kind !== "subtitle" &&
          (track.kind === "video" || audible(track)),
      )
      .map(({ track, clip }) => {
        const elapsed = frame - clip.startFrame;
        const remaining = clip.durationFrames - elapsed;
        const fade =
          (clip.fadeInFrames ? Math.min(1, elapsed / clip.fadeInFrames) : 1) *
          (clip.fadeOutFrames
            ? Math.min(1, remaining / clip.fadeOutFrames)
            : 1);
        return {
          clipId: clip.id,
          visual: track.kind === "video",
          sourceSeconds: (elapsed + clip.sourceOffsetFrame) / fps,
          gain: audible(track)
            ? (clip.volume ?? 1) *
              fade *
              (track.kind === "bgm" && hasVoice
                ? (clip.duckingGain ?? 0.55)
                : 1)
            : 0,
        };
      }),
  };
}

export function timelinePreviewLimitations(
  timeline: TimelineManifest,
): string[] {
  const visual = timeline.tracks
    .filter((track) => track.kind === "video")
    .flatMap((track) => track.clips)
    .sort((a, b) => a.startFrame - b.startFrame);
  const reasons: string[] = [];
  const clips = timeline.tracks.flatMap((track) => track.clips);
  if (new Set(clips.map((clip) => clip.id)).size !== clips.length)
    reasons.push("时间线片段身份不唯一，不能猜测对应播放器。");
  if (
    visual.some(
      (clip, index) =>
        index > 0 &&
        clip.startFrame <
          visual[index - 1]!.startFrame + visual[index - 1]!.durationFrames,
    )
  )
    reasons.push(
      "当前本地预览不支持重叠视频合成；请先明确处理重叠，不能只显示其中一个片段。",
    );
  if (timeline.tracks.flatMap((track) => track.clips).length > 64)
    reasons.push(
      "当前同步预览最多 64 个片段；未载入或截取部分时间线冒充完整预览。",
    );
  return reasons;
}

/** Media-backed clock. Missing ports and rejected native play never advance a fake timeline. */
export function createTimelinePreviewClock(input: {
  timeline: TimelineManifest;
  sources: Record<string, TimelinePreviewSource>;
  scheduler: TimelinePreviewScheduler;
  position(seconds: number): void;
  playing(value: boolean): void;
  failure(cause: unknown): void;
}) {
  const { timeline, sources, scheduler } = input;
  const fps =
    timeline.profile.frameRate.numerator /
    timeline.profile.frameRate.denominator;
  const duration = timeline.durationFrames / fps;
  const boundaries = [
    ...new Set([
      duration,
      ...timeline.tracks.flatMap((track) =>
        track.clips.flatMap((clip) => [
          clip.startFrame / fps,
          (clip.startFrame + clip.durationFrames) / fps,
        ]),
      ),
    ]),
  ].sort((a, b) => a - b);
  let position = 0;
  let running = false;
  let starting = false;
  let disposed = false;
  let generation = 0;
  let handle: unknown;
  let anchorTime = 0;
  let anchorPosition = 0;
  const pauseAll = () => {
    for (const source of Object.values(sources)) {
      source.pause();
      source.gain(0);
    }
  };
  const cancel = () => {
    generation++;
    running = false;
    starting = false;
    if (handle !== undefined) scheduler.cancel(handle);
    handle = undefined;
    pauseAll();
    input.playing(false);
  };
  const fail = (cause: unknown) => {
    cancel();
    if (!disposed) input.failure(cause);
  };
  const synchronize = (seconds: number, seekExactly: boolean) => {
    const current = timelinePreviewFrame(timeline, seconds);
    const active = new Set(current.sources.map((item) => item.clipId));
    for (const [id, source] of Object.entries(sources))
      if (!active.has(id)) {
        source.pause();
        source.gain(0);
      }
    for (const item of current.sources) {
      const source = sources[item.clipId];
      if (!source) throw new Error("实际片段未完整载入；已停止同步预览。");
      if (
        seekExactly ||
        Math.abs(source.currentTime() - item.sourceSeconds) > 0.15
      )
        source.seek(item.sourceSeconds);
      source.gain(item.gain);
    }
    return current.sources;
  };
  const start = async () => {
    if (disposed) return;
    const token = ++generation;
    starting = true;
    try {
      const active = synchronize(position, true);
      await Promise.all(active.map((item) => sources[item.clipId]!.play()));
      if (disposed || token !== generation) {
        if (!running && !starting) pauseAll();
        return;
      }
      starting = false;
      running = true;
      anchorPosition = position;
      anchorTime = scheduler.now();
      input.playing(true);
      handle = scheduler.schedule(tick);
    } catch (cause) {
      if (!disposed && token === generation) fail(cause);
    }
  };
  const tick = () => {
    handle = undefined;
    if (!running || disposed) return;
    const desired = Math.min(
      duration,
      anchorPosition + (scheduler.now() - anchorTime) / 1000,
    );
    const boundary = boundaries.find(
      (value) => value > position + 1e-7 && value <= desired,
    );
    const next = boundary ?? desired;
    try {
      if (boundary !== undefined) {
        // Freeze at the exact boundary while starting the next real native clip.
        cancel();
        position = next;
        synchronize(position, true);
        input.position(position);
        if (position < duration) void start();
      } else {
        synchronize(next, false);
        position = next;
        input.position(position);
        handle = scheduler.schedule(tick);
      }
    } catch (cause) {
      fail(cause);
    }
  };
  return {
    isPlaying: () => running,
    toggle: () => {
      if (disposed) return;
      if (running || starting) cancel();
      else {
        if (position >= duration) position = 0;
        input.position(position);
        void start();
      }
    },
    seek: (seconds: number) => {
      if (disposed) return;
      cancel();
      position = Math.max(0, Math.min(duration, seconds));
      try {
        synchronize(position, true);
        input.position(position);
      } catch (cause) {
        fail(cause);
      }
    },
    stop: cancel,
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}
