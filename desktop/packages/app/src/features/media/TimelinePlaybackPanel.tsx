import { useEffect, useRef, useState } from "react";
import type { MediaPlaybackDescriptor } from "@dramaip/contracts/media";
import type {
  TimelineManifest,
  TimelinePlaybackPlan,
} from "@dramaip/contracts/timeline";
import { BareButton } from "@dramaip/ui-shared";
import {
  createTimelinePreviewClock,
  timelinePreviewFrame,
  timelinePreviewLimitations,
  waitTimelinePreviewPlay,
  type TimelinePreviewControls,
  type TimelinePreviewSource,
} from "../../timeline-preview";
import { message, useStudio } from "../../studio-shared";

type PlaybackLease = {
  abort: AbortController;
  urls: Set<string>;
  dispose?: () => void;
};
type Loaded = {
  plan: TimelinePlaybackPlan;
  files: Record<string, { descriptor: MediaPlaybackDescriptor; url: string }>;
};
const MAX_PREVIEW_BYTES = 256 * 1024 * 1024;

/** Entire frozen graph is checked and decoded before enabling the media-backed transport. */
export function TimelinePlaybackPanel(props: {
  timeline: TimelineManifest;
  position: number;
  controls: React.RefObject<TimelinePreviewControls | undefined>;
  onPosition(value: number): void;
  onPlaying(value: boolean): void;
  onReady(value: boolean): void;
}) {
  const client = useStudio();
  const lease = useRef<PlaybackLease | undefined>(undefined);
  const elements = useRef<
    Record<string, HTMLMediaElement | HTMLImageElement | null>
  >({});
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const output = useRef<GainNode | undefined>(undefined);
  const [error, setError] = useState<string>();
  const propsRef = useRef(props);
  propsRef.current = props;
  const release = () => {
    const active = lease.current;
    lease.current = undefined;
    active?.abort.abort();
    active?.dispose?.();
    for (const url of active?.urls ?? []) URL.revokeObjectURL(url);
    propsRef.current.controls.current = undefined;
    propsRef.current.onReady(false);
    propsRef.current.onPlaying(false);
    output.current = undefined;
  };
  const failure = (cause: unknown) => {
    release();
    setLoaded(undefined);
    setLoading(false);
    setReady(false);
    setError(message(cause));
  };
  useEffect(() => () => release(), []);
  useEffect(() => {
    if (output.current) output.current.gain.value = muted ? 0 : 1;
  }, [muted]);

  const load = async () => {
    release();
    setLoaded(undefined);
    setReady(false);
    setError(undefined);
    setLoading(true);
    const active: PlaybackLease = {
      abort: new AbortController(),
      urls: new Set(),
    };
    lease.current = active;
    const current = () =>
      lease.current === active && !active.abort.signal.aborted;
    try {
      const plan = await client.timeline.playbackPlan(
        props.timeline.id,
        props.timeline.projectId,
        props.timeline.version,
        active.abort.signal,
      );
      if (!current()) return;
      if (JSON.stringify(plan.timeline) !== JSON.stringify(props.timeline))
        throw new Error("实际时间线与当前编辑版本不一致，请重新核对；未播放。");
      const limitations = [
        ...plan.blockers.map((item) => item.message),
        ...timelinePreviewLimitations(plan.timeline),
      ];
      if (limitations.length)
        throw new Error([...new Set(limitations)].join("；"));
      if (!plan.bindings.length)
        throw new Error(
          "没有完整可读的实际媒体；仍可定位和编辑，但不运行空预览时钟。",
        );
      const unique = new Map(
        plan.bindings.map((binding) => [
          `${binding.assetId}:${binding.assetVersion}`,
          binding,
        ]),
      );
      if (unique.size > 16)
        throw new Error(
          "同步预览最多 16 个不同媒体文件；未加载部分文件冒充完整时间线。",
        );
      const descriptors = new Map<string, MediaPlaybackDescriptor>();
      let total = 0;
      for (const [key, binding] of unique) {
        const descriptor = await client.mediaPlayback.describe(
          binding.assetId,
          plan.timeline.projectId,
          binding.assetVersion,
          active.abort.signal,
        );
        if (!current()) return;
        total += descriptor.sizeBytes;
        if (total > MAX_PREVIEW_BYTES)
          throw new Error(
            "本次同步预览完整文件合计超过 256 MiB；未截断或绕过受控读取上限。",
          );
        descriptors.set(key, descriptor);
      }
      const files: Loaded["files"] = {};
      for (const [key, binding] of unique) {
        const result = await client.mediaPlayback.open(
          binding.assetId,
          plan.timeline.projectId,
          binding.assetVersion,
          active.abort.signal,
        );
        if (!current()) return;
        if (
          JSON.stringify(result.descriptor) !==
          JSON.stringify(descriptors.get(key))
        )
          throw new Error("媒体在读取期间变化，已释放全部预览。");
        const url = URL.createObjectURL(result.blob);
        active.urls.add(url);
        files[key] = { descriptor: result.descriptor, url };
      }
      for (const binding of plan.bindings) {
        const kind =
          files[`${binding.assetId}:${binding.assetVersion}`]!.descriptor.kind;
        if (
          binding.expectedKind === "audio"
            ? kind !== "audio"
            : kind !== "image" && kind !== "video"
        )
          throw new Error(
            "实际文件类型与时间线轨道不一致，不能自动换轨或替代素材。",
          );
      }
      const after = await client.timeline.playbackPlan(
        plan.timeline.id,
        plan.timeline.projectId,
        plan.timeline.version,
        active.abort.signal,
      );
      if (!current()) return;
      if (JSON.stringify(after) !== JSON.stringify(plan))
        throw new Error("时间线或冻结来源在完整读取期间变化，未启用播放。");
      setLoaded({ plan, files });
    } catch (cause) {
      if (current()) failure(cause);
    } finally {
      if (current()) setLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded) return;
    const active = lease.current!;
    const current = () =>
      lease.current === active && !active.abort.signal.aborted;
    let audio: AudioContext | undefined;
    let clock: ReturnType<typeof createTimelinePreviewClock> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    active.dispose = () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      clock?.dispose();
      for (const cleanup of cleanups) cleanup();
      for (const element of Object.values(elements.current))
        if (element instanceof HTMLMediaElement) element.pause();
      if (audio) void audio.close().catch(() => {});
    };
    const setup = async () => {
      try {
        const fps =
          loaded.plan.timeline.profile.frameRate.numerator /
          loaded.plan.timeline.profile.frameRate.denominator;
        for (const binding of loaded.plan.bindings) {
          const element = elements.current[binding.clipId];
          if (!element) throw new Error("实际媒体控件未就绪；未启用预览。");
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              cleanup();
              resolve();
            };
            const failed = () => {
              cleanup();
              reject(
                new Error(
                  "实际文件无法解码、读取超时或已取消；未启用同步预览。",
                ),
              );
            };
            const event =
              element instanceof HTMLImageElement ? "load" : "loadedmetadata";
            const timeout = setTimeout(failed, 30_000);
            const cleanup = () => {
              clearTimeout(timeout);
              element.removeEventListener(event, done);
              element.removeEventListener("error", failed);
              active.abort.signal.removeEventListener("abort", failed);
            };
            element.addEventListener(event, done);
            element.addEventListener("error", failed);
            active.abort.signal.addEventListener("abort", failed, {
              once: true,
            });
            if (
              active.abort.signal.aborted ||
              (element instanceof HTMLMediaElement && element.error)
            )
              failed();
            else if (
              element instanceof HTMLImageElement
                ? element.complete && element.naturalWidth > 0
                : element.readyState >= 1
            )
              done();
          });
          if (!current()) return;
          if (element instanceof HTMLImageElement) await element.decode();
          else {
            const clip = loaded.plan.timeline.tracks
              .flatMap((track) => track.clips)
              .find((item) => item.id === binding.clipId)!;
            if (
              !Number.isFinite(element.duration) ||
              element.duration <= 0 ||
              (clip.sourceOffsetFrame + clip.durationFrames) / fps >
                element.duration + 0.001
            )
              throw new Error(
                "片段裁切或源偏移超过实际媒体时长；不会自动裁短或运行空时钟。",
              );
          }
        }
        if (!current()) return;
        let master: GainNode | undefined;
        if (
          loaded.plan.bindings.some(
            (binding) =>
              elements.current[binding.clipId] instanceof HTMLMediaElement,
          )
        ) {
          audio = new AudioContext({
            sampleRate: loaded.plan.timeline.profile.audioSampleRate,
          });
          master = audio.createGain();
          master.gain.value = mutedRef.current ? 0 : 1;
          master.connect(audio.destination);
          output.current = master;
          const stateChanged = () => {
            if (current() && clock?.isPlaying() && audio!.state !== "running")
              failure(
                new Error("实际音频设备已停止或中断；同步时钟已停止并释放。"),
              );
          };
          audio.addEventListener("statechange", stateChanged);
          cleanups.push(() =>
            audio!.removeEventListener("statechange", stateChanged),
          );
        }
        const sources: Record<string, TimelinePreviewSource> = {};
        for (const binding of loaded.plan.bindings) {
          const element = elements.current[binding.clipId]!;
          if (element instanceof HTMLMediaElement) {
            const source = audio!.createMediaElementSource(element);
            const gain = audio!.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(master!);
            const error = () => {
              if (current())
                failure(
                  new Error("实际媒体解码或播放失败；同步预览已停止并释放。"),
                );
            };
            const waiting = () => {
              if (current() && clock?.isPlaying())
                failure(
                  new Error(
                    "实际媒体等待解码或停止供帧；同步时钟已停止，请重新加载核对。",
                  ),
                );
            };
            const ended = () => {
              const clip = loaded.plan.timeline.tracks
                .flatMap((track) => track.clips)
                .find((item) => item.id === binding.clipId)!;
              if (
                current() &&
                clock?.isPlaying() &&
                element.currentTime + 0.01 <
                  (clip.sourceOffsetFrame + clip.durationFrames) / fps
              )
                failure(
                  new Error(
                    "实际媒体提前结束，未按完整片段供帧；同步时钟已停止。",
                  ),
                );
            };
            element.addEventListener("error", error);
            element.addEventListener("waiting", waiting);
            element.addEventListener("ended", ended);
            cleanups.push(() => {
              element.removeEventListener("error", error);
              element.removeEventListener("waiting", waiting);
              element.removeEventListener("ended", ended);
              source.disconnect();
              gain.disconnect();
            });
            sources[binding.clipId] = {
              currentTime: () => element.currentTime,
              seek: (seconds) => {
                element.currentTime = seconds;
              },
              play: () =>
                waitTimelinePreviewPlay(
                  () => element.play(),
                  active.abort.signal,
                ),
              pause: () => element.pause(),
              gain: (value) => {
                gain.gain.setValueAtTime(value, audio!.currentTime);
              },
            };
          } else
            sources[binding.clipId] = {
              currentTime: () => 0,
              seek: () => {},
              play: async () => {},
              pause: () => {},
              gain: () => {},
            };
        }
        clock = createTimelinePreviewClock({
          timeline: loaded.plan.timeline,
          sources,
          scheduler: {
            now: () => performance.now(),
            schedule: (callback) => window.setTimeout(callback, 20),
            cancel: (handle) => window.clearTimeout(handle as number),
          },
          position: (value) => {
            if (current()) propsRef.current.onPosition(value);
          },
          playing: (value) => {
            if (current()) propsRef.current.onPlaying(value);
          },
          failure: (cause) => {
            if (current()) failure(cause);
          },
        });
        clock.seek(propsRef.current.position);
        if (!current()) return;
        const verify = async () => {
          const plan = await client.timeline.playbackPlan(
            loaded.plan.timeline.id,
            loaded.plan.timeline.projectId,
            loaded.plan.timeline.version,
            active.abort.signal,
          );
          if (JSON.stringify(plan) !== JSON.stringify(loaded.plan))
            throw new Error(
              "时间线或冻结音轨来源已变化；预览已停止，须重新核对。",
            );
          for (const { descriptor } of Object.values(loaded.files)) {
            const actual = await client.mediaPlayback.describe(
              descriptor.recordId,
              descriptor.projectId,
              descriptor.recordVersion,
              active.abort.signal,
            );
            if (JSON.stringify(actual) !== JSON.stringify(descriptor))
              throw new Error("实际媒体归属、版本或存档已变化；预览已停止。");
          }
        };
        await verify();
        if (!current()) return;
        let playRequest = 0,
          pendingPlay = false;
        propsRef.current.controls.current = {
          toggle: () => {
            if (!current()) return;
            const token = ++playRequest;
            if (clock!.isPlaying() || pendingPlay) {
              pendingPlay = false;
              clock!.stop();
              return;
            }
            pendingPlay = true;
            // Resume under the gesture, but freshly verify all owners before native playback.
            void Promise.all([
              audio
                ? waitTimelinePreviewPlay(
                    () => audio!.resume(),
                    active.abort.signal,
                  )
                : Promise.resolve(),
              verify(),
            ])
              .then(() => {
                if (current() && token === playRequest) {
                  if (audio && audio.state !== "running")
                    throw new Error("音频预览设备未运行；同步时钟未启动。");
                  pendingPlay = false;
                  clock!.toggle();
                }
              })
              .catch((cause) => {
                if (current() && token === playRequest) failure(cause);
              });
          },
          seek: (value) => {
            playRequest++;
            pendingPlay = false;
            clock!.seek(value);
          },
          stop: () => {
            playRequest++;
            pendingPlay = false;
            clock!.stop();
          },
        };
        setReady(true);
        propsRef.current.onReady(true);
        const poll = async () => {
          try {
            await verify();
          } catch (cause) {
            if (current()) failure(cause);
          }
          if (current()) timer = setTimeout(poll, 5000);
        };
        timer = setTimeout(poll, 5000);
      } catch (cause) {
        if (current()) failure(cause);
      }
    };
    void setup();
    return () => active.dispose?.();
  }, [loaded, client]);

  const frame = timelinePreviewFrame(props.timeline, props.position);
  const visible = new Set(
    frame.sources.filter((item) => item.visual).map((item) => item.clipId),
  );
  return (
    <section
      className="rounded-lg border border-line bg-surface p-2 text-xs text-muted"
      data-testid="timeline-actual-preview"
    >
      <p className="font-medium text-ink">预览主时钟 · 实际冻结媒体</p>
      <BareButton
        className="mt-2 rounded border border-line px-2 py-1 disabled:opacity-50"
        disabled={loading}
        onClick={() => void load()}
      >
        {loading
          ? "核对并完整读取中…"
          : loaded
            ? "重新加载同步预览"
            : "加载实际同步预览"}
      </BareButton>
      {(loaded || loading) && (
        <BareButton
          className="ml-2 mt-2 rounded border border-line px-2 py-1"
          onClick={() => {
            release();
            setLoaded(undefined);
            setLoading(false);
            setReady(false);
          }}
        >
          停止并释放预览
        </BareButton>
      )}
      <p className="mt-2">
        明确载入全部文件、核对冻结版本并解码后，才启用左侧播放。单文件 128
        MiB、合计 256 MiB；不自动播放或确认媒体质量／权利。
      </p>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={muted}
          onChange={(event) => setMuted(event.target.checked)}
        />
        静音预览（不修改轨道）
      </label>
      {loaded && (
        <div className="relative mt-2 rounded bg-canvas">
          {loaded.plan.bindings.map((binding) => {
            const file =
              loaded.files[`${binding.assetId}:${binding.assetVersion}`]!;
            const shown = visible.has(binding.clipId);
            const common = {
              key: binding.clipId,
              src: file.url,
              "data-testid": `timeline-preview-clip-${binding.clipId}`,
            };
            return file.descriptor.kind === "image" ? (
              <img
                {...common}
                ref={(node) => {
                  elements.current[binding.clipId] = node;
                }}
                className={shown ? "max-h-48 w-full object-contain" : "hidden"}
                alt="冻结时间线的实际图像"
              />
            ) : file.descriptor.kind === "video" ? (
              <video
                {...common}
                ref={(node) => {
                  elements.current[binding.clipId] = node;
                }}
                preload="auto"
                playsInline
                className={shown ? "max-h-48 w-full object-contain" : "hidden"}
              />
            ) : (
              <audio
                {...common}
                ref={(node) => {
                  elements.current[binding.clipId] = node;
                }}
                preload="auto"
                className="hidden"
              />
            );
          })}
          {frame.subtitles.length > 0 && (
            <p
              data-testid="timeline-preview-subtitles"
              className="bg-black/80 p-2 text-center text-white whitespace-pre-wrap"
            >
              {frame.subtitles.join("\n")}
            </p>
          )}
        </div>
      )}
      {loaded && (
        <p role="status" className="mt-2">
          {ready
            ? "全部实际媒体已解码；可以明确播放、暂停和定位。原生媒体与增益按同一时钟同步，此预览不等同正式渲染或质量验收。"
            : "文件已完整校验，正在核对实际解码与片段时长…"}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-amber-700">
          {error}
        </p>
      )}
    </section>
  );
}
