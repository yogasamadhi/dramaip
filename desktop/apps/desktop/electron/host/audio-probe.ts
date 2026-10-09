export type RenderAudioProbe =
  | { hasAudio: false; sourceKind: "video" }
  | {
      hasAudio: true;
      sourceKind: "audio" | "video";
      streamIndex: number;
      channels: 1 | 2;
      sampleRate: number;
      codecName: string;
      presentationEndSamples: number;
    };

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
type Rational = { n: bigint; d: bigint };
function decimal(value: unknown): Rational {
  if (typeof value !== "string" || !/^-?\d{1,16}(?:\.\d{1,9})?$/u.test(value))
    throw Error("Audio probe has no exact presentation clock");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const d = 10n ** BigInt(fraction.length);
  return {
    n: (BigInt(whole!) * d + BigInt(fraction || "0")) * (negative ? -1n : 1n),
    d,
  };
}
function timebase(value: unknown): Rational {
  if (typeof value !== "string" || !/^\d{1,16}\/\d{1,16}$/u.test(value))
    throw Error("Audio probe has no exact stream timebase");
  const [n, d] = value.split("/").map(BigInt);
  if (!n || !d) throw Error("Audio probe timebase is invalid");
  return { n, d };
}
function sum(left: Rational, right: Rational, sign = 1n): Rational {
  return { n: left.n * right.d + sign * right.n * left.d, d: left.d * right.d };
}

/** Pure interpretation of a verified sidecar's actual JSON, never format-duration fallback. */
export function interpretRenderAudioProbe(
  value: unknown,
  sourceKind: "audio" | "video",
): RenderAudioProbe {
  if (
    !object(value) ||
    !Array.isArray(value.streams) ||
    value.streams.length > 1024 ||
    !value.streams.every(object)
  )
    throw Error("Audio probe stream inventory is invalid");
  const audio = value.streams.filter((stream) => stream.codec_type === "audio");
  const video = value.streams.filter((stream) => stream.codec_type === "video");
  if (
    (sourceKind === "video" && video.length !== 1) ||
    (sourceKind === "audio" && video.length !== 0)
  )
    throw Error(
      "Archived source kind does not match its actual stream inventory",
    );
  if (audio.length === 0 && sourceKind === "video")
    return { hasAudio: false, sourceKind: "video" };
  if (audio.length !== 1)
    throw Error("Audio stream is missing or ambiguous; no stream was guessed");
  const stream = audio[0]!;
  if (
    !Number.isSafeInteger(stream.index) ||
    Number(stream.index) < 0 ||
    (stream.channels !== 1 && stream.channels !== 2) ||
    typeof stream.sample_rate !== "string" ||
    !/^\d{1,6}$/u.test(stream.sample_rate) ||
    Number(stream.sample_rate) < 1 ||
    Number(stream.sample_rate) > 384000 ||
    typeof stream.codec_name !== "string" ||
    !/^[a-z0-9_]{1,80}$/u.test(stream.codec_name)
  )
    throw Error("Audio stream channels, rate, codec or index are unsupported");
  const clock = timebase(stream.time_base);
  let duration: Rational;
  if (stream.duration_ts !== undefined) {
    if (
      !Number.isSafeInteger(stream.duration_ts) ||
      Number(stream.duration_ts) < 1
    )
      throw Error("Audio stream duration is invalid");
    duration = { n: BigInt(Number(stream.duration_ts)) * clock.n, d: clock.d };
  } else duration = decimal(stream.duration);
  if (duration.n <= 0n)
    throw Error("Audio stream duration is unknown or empty");
  let start: Rational;
  if (stream.start_pts !== undefined) {
    if (!Number.isSafeInteger(stream.start_pts))
      throw Error("Audio stream start clock is invalid");
    start = { n: BigInt(Number(stream.start_pts)) * clock.n, d: clock.d };
  } else
    start =
      stream.start_time === undefined
        ? { n: 0n, d: 1n }
        : decimal(stream.start_time);
  const format = object(value.format) ? value.format : {};
  const origin =
    format.start_time === undefined
      ? { n: 0n, d: 1n }
      : decimal(format.start_time);
  const end = sum(sum(start, origin, -1n), duration);
  const samples = (end.n * 48000n) / end.d;
  if (samples < 1n || samples > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Audio presentation duration exceeds the exact sample budget");
  return {
    hasAudio: true,
    sourceKind,
    streamIndex: Number(stream.index),
    channels: stream.channels,
    sampleRate: Number(stream.sample_rate),
    codecName: stream.codec_name,
    presentationEndSamples: Number(samples),
  };
}
