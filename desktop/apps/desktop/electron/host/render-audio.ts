/** Host-side mixer. Inputs must already be exact, staged owner sources. */
export interface ResolvedRenderAudioClip {
  inputIndex: number;
  channels: 1 | 2;
  kind: "video" | "dialogue" | "narration" | "bgm" | "sfx";
  startFrame: number;
  durationFrames: number;
  sourceOffsetFrame: number;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  duckingGain: number;
}

const samplesPerFrame = 1_920;
export const MAX_AUDIO_MIX_CLIPS = 10_000;
export const MAX_AUDIO_FILTER_BYTES = 1024 * 1024;

function samples(frames: number): number {
  if (
    !Number.isSafeInteger(frames) ||
    frames < 0 ||
    !Number.isSafeInteger(frames * samplesPerFrame)
  )
    throw new Error(
      "Audio frame range cannot be represented as exact P0 samples",
    );
  return frames * samplesPerFrame;
}

/** Half-open union; overlapping/adjacent voice clips duck only once. */
function voiceIntervals(
  clips: readonly ResolvedRenderAudioClip[],
): [number, number][] {
  const intervals = clips
    .filter((clip) => clip.kind === "dialogue" || clip.kind === "narration")
    .map(
      (clip) =>
        [
          samples(clip.startFrame),
          samples(clip.startFrame + clip.durationFrames),
        ] as [number, number],
    )
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const union: [number, number][] = [];
  for (const interval of intervals) {
    const previous = union.at(-1);
    if (previous && interval[0] <= previous[1])
      previous[1] = Math.max(previous[1], interval[1]);
    else union.push([...interval]);
  }
  return union;
}

/** No paths, text, arbitrary expressions, fallback sources or hidden normalization. */
export function buildTimelineAudioMix(
  durationFrames: number,
  clips: readonly ResolvedRenderAudioClip[],
): {
  filters: string[];
  outputLabel: "dramaip_audio_out";
  samplesPerChannel: number;
} {
  const total = samples(durationFrames);
  if (!total || !Array.isArray(clips) || clips.length > MAX_AUDIO_MIX_CLIPS)
    throw new Error("Audio mix duration or clip count is unsupported");
  const expectedKeys = [
    "inputIndex",
    "channels",
    "kind",
    "startFrame",
    "durationFrames",
    "sourceOffsetFrame",
    "volume",
    "fadeInFrames",
    "fadeOutFrames",
    "duckingGain",
  ];
  for (const clip of clips) {
    if (
      !clip ||
      Object.keys(clip).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(clip, key)) ||
      !Number.isSafeInteger(clip.inputIndex) ||
      clip.inputIndex < 0 ||
      ![1, 2].includes(clip.channels) ||
      !["video", "dialogue", "narration", "bgm", "sfx"].includes(clip.kind) ||
      !Number.isFinite(clip.volume) ||
      !Number.isFinite(clip.duckingGain)
    )
      throw new Error(
        "Audio mix requires validated finite controls and mono/stereo stream bindings",
      );
    const length = samples(clip.durationFrames);
    samples(clip.startFrame);
    samples(clip.sourceOffsetFrame);
    samples(clip.fadeInFrames);
    samples(clip.fadeOutFrames);
    samples(clip.sourceOffsetFrame + clip.durationFrames);
    if (!length || samples(clip.startFrame + clip.durationFrames) > total)
      throw new Error("Audio clip extends beyond the frozen timeline");
  }
  const voices = voiceIntervals(clips);
  const filters = [
    `anullsrc=r=48000:cl=stereo,atrim=end_sample=${total}[dramaip_audio_base]`,
  ];
  const labels = ["[dramaip_audio_base]"];
  let bytes = Buffer.byteLength(filters[0]!, "utf8");
  for (const [index, clip] of clips.entries()) {
    const start = samples(clip.startFrame);
    const length = samples(clip.durationFrames);
    const offset = samples(clip.sourceOffsetFrame);
    const fadeIn = clip.fadeInFrames
      ? `min(1,n/${samples(clip.fadeInFrames)})`
      : "1";
    const fadeOut = clip.fadeOutFrames
      ? `min(1,(${length}-n)/${samples(clip.fadeOutFrames)})`
      : "1";
    const intervals =
      clip.kind === "bgm"
        ? voices
            .filter(
              (interval) => interval[0] < start + length && interval[1] > start,
            )
            .map(
              (interval) =>
                [
                  Math.max(0, interval[0] - start),
                  Math.min(length, interval[1] - start),
                ] as [number, number],
            )
        : [];
    const active = intervals
      .map(([from, to]) => `gte(n,${from})*lt(n,${to})`)
      .join("+");
    const duck = active ? `if(gt(${active},0),${clip.duckingGain},1)` : "1";
    const gain = `${clip.volume}*${fadeIn}*${fadeOut}*${duck}`;
    // WebAudio mono speaker upmix duplicates at unity, not the default centre attenuation.
    const channelMap = clip.channels === 1 ? "pan=stereo|c0=c0|c1=c0," : "";
    const label = `dramaip_audio_${index}`;
    const filter = `[${clip.inputIndex}:a:0]${channelMap}aresample=48000:async=0:first_pts=0,aformat=sample_fmts=flt:channel_layouts=stereo,atrim=start_sample=${offset}:end_sample=${offset + length},asetpts=PTS-STARTPTS,aeval='val(ch)*(${gain})':c=same,adelay=delays=${start}S:all=1,apad=whole_len=${total},atrim=end_sample=${total}[${label}]`;
    bytes += Buffer.byteLength(filter, "utf8") + 1;
    if (bytes > MAX_AUDIO_FILTER_BYTES)
      throw new Error(
        "Audio filter graph exceeds the explicit resource budget; no clips were truncated",
      );
    filters.push(filter);
    labels.push(`[${label}]`);
  }
  const final = `${labels.join("")}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0[dramaip_audio_out]`;
  if (bytes + Buffer.byteLength(final, "utf8") + 1 > MAX_AUDIO_FILTER_BYTES)
    throw new Error(
      "Audio filter graph exceeds the explicit resource budget; no clips were truncated",
    );
  filters.push(final);
  return {
    filters,
    outputLabel: "dramaip_audio_out",
    samplesPerChannel: total,
  };
}
