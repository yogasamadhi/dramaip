import { createHash } from "node:crypto";

export class VideoFrameProofError extends Error {
  readonly code = "VIDEO_FRAME_PROOF_INVALID";
}

export interface RenderVideoProbe {
  streamIndex: number;
  width: number;
  height: number;
  codecName: string;
  pixelFormat: string;
  timeBase: { n: bigint; d: bigint };
  startTicks: bigint;
  durationTicks: bigint;
  origin: { n: bigint; d: bigint };
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
function ratio(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,16}\/\d{1,16}$/u.test(value))
    throw Error("Video has no exact stream timebase");
  const [n, d] = value.split("/").map(BigInt);
  if (!n || !d) throw Error("Video timebase is invalid");
  return { n, d };
}
function decimal(value: unknown) {
  if (typeof value !== "string" || !/^-?\d{1,16}(?:\.\d{1,9})?$/u.test(value))
    throw Error("Video has no exact container origin");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return {
    n:
      (BigInt(whole!) * 10n ** BigInt(fraction.length) +
        BigInt(fraction || "0")) *
      (negative ? -1n : 1n),
    d: 10n ** BigInt(fraction.length),
  };
}

/** Actual signed-probe stream inventory. Format duration and average fps are not decoded-frame evidence. */
export function interpretRenderVideoProbe(
  value: unknown,
  output?: { width: number; height: number; durationFrames: number },
): RenderVideoProbe {
  if (
    !object(value) ||
    !Array.isArray(value.streams) ||
    value.streams.length > 1024 ||
    !value.streams.every(object) ||
    !object(value.format)
  )
    throw Error("Video stream inventory is invalid");
  const videos = value.streams.filter(
    (stream) => stream.codec_type === "video",
  );
  if (videos.length !== 1)
    throw Error(
      "Video stream is missing or ambiguous; no first-stream fallback",
    );
  const stream = videos[0]!;
  if (
    !Number.isSafeInteger(stream.index) ||
    Number(stream.index) < 0 ||
    !Number.isSafeInteger(stream.width) ||
    !Number.isSafeInteger(stream.height) ||
    Number(stream.width) < 1 ||
    Number(stream.width) > 8192 ||
    Number(stream.height) < 1 ||
    Number(stream.height) > 8192 ||
    Number(stream.width) * Number(stream.height) > 16_777_216 ||
    typeof stream.codec_name !== "string" ||
    !/^[a-z0-9_]{1,80}$/u.test(stream.codec_name) ||
    typeof stream.pix_fmt !== "string" ||
    !/^[a-z0-9_]{1,80}$/u.test(stream.pix_fmt) ||
    !Number.isSafeInteger(stream.start_pts) ||
    !Number.isSafeInteger(stream.duration_ts) ||
    Number(stream.duration_ts) < 1 ||
    (object(stream.disposition) && stream.disposition.attached_pic === 1)
  )
    throw Error(
      "Video stream dimensions, codec or exact clock are unsupported",
    );
  const timeBase = ratio(stream.time_base);
  const durationTicks = BigInt(Number(stream.duration_ts));
  if (durationTicks * timeBase.n > 86400n * timeBase.d)
    throw Error("Video source exceeds the explicit 24-hour decode budget");
  const origin = decimal(value.format.start_time);
  if (output) {
    const audio = value.streams.filter((item) => item.codec_type === "audio");
    if (
      value.streams.length !== 2 ||
      audio.length !== 1 ||
      audio[0]!.codec_name !== "aac" ||
      audio[0]!.channels !== 2 ||
      audio[0]!.sample_rate !== "48000" ||
      stream.codec_name !== "h264" ||
      stream.pix_fmt !== "yuv420p" ||
      stream.width !== output.width ||
      stream.height !== output.height ||
      stream.sample_aspect_ratio !== "1:1" ||
      stream.avg_frame_rate !== "25/1" ||
      stream.r_frame_rate !== "25/1" ||
      stream.start_pts !== 0 ||
      origin.n !== 0n ||
      durationTicks * timeBase.n * 25n !==
        BigInt(output.durationFrames) * timeBase.d
    )
      throw Error(
        "Encoded output stream inventory, format or exact clock did not match the frozen profile",
      );
  }
  return {
    streamIndex: Number(stream.index),
    width: Number(stream.width),
    height: Number(stream.height),
    codecName: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    timeBase,
    startTicks: BigInt(Number(stream.start_pts)),
    durationTicks,
    origin,
  };
}

export interface VideoFrameProof {
  format: "dramaip-decoded-video-frames";
  version: 1;
  frames: number;
  /** SHA of the canonical sequence of actual raw-frame SHA256 values, sizes and clocks, not the encoded MP4. */
  frameSequenceSha256: string;
}

/** Bounded incremental parser for FFmpeg's SHA256 framehash of decoded rawvideo. No fps/setpts/pad filters. */
export class VideoFrameHashVerifier {
  private pending = "";
  private bytes = 0;
  private frames = 0;
  private headers = new Map<string, string>();
  private endTicks?: bigint;
  private firstTicks?: bigint;
  private finished = false;
  private digest = createHash("sha256");
  private readonly maximumFrames: number;
  constructor(
    private readonly input: {
      probe: RenderVideoProbe;
      requiredRanges?: ReadonlyArray<{
        sourceOffsetFrame: number;
        durationFrames: number;
      }>;
      outputFrames?: number;
      maximumFrames?: number;
    },
  ) {
    this.maximumFrames = input.outputFrames ?? input.maximumFrames ?? 1_000_000;
    if (
      !Number.isSafeInteger(this.maximumFrames) ||
      this.maximumFrames < 1 ||
      this.maximumFrames > 1_000_000
    )
      throw Error("Video frame count exceeds the explicit decode budget");
    if (input.outputFrames !== undefined && input.requiredRanges !== undefined)
      throw Error("Source and output video proof scopes cannot be mixed");
    for (const range of input.requiredRanges ?? [])
      if (
        !Number.isSafeInteger(range.sourceOffsetFrame) ||
        range.sourceOffsetFrame < 0 ||
        !Number.isSafeInteger(range.durationFrames) ||
        range.durationFrames < 1 ||
        !Number.isSafeInteger(range.sourceOffsetFrame + range.durationFrames)
      )
        throw Error("Frozen video range is invalid");
  }
  push(chunk: Uint8Array): void {
    if (this.finished) throw Error("Video proof is already finalized");
    this.bytes += chunk.byteLength;
    if (
      this.bytes > 4096 + this.maximumFrames * 256 ||
      chunk.some((byte) => byte > 127 || byte === 0)
    )
      throw Error("Video framehash exceeds the bounded ASCII proof budget");
    const text = Buffer.from(chunk).toString("ascii");
    // Process each line before retaining the tail; a large read does not make an unbounded pending buffer.
    let cursor = 0;
    for (
      let next = text.indexOf("\n");
      next !== -1;
      next = text.indexOf("\n", cursor)
    ) {
      const line = this.pending + text.slice(cursor, next);
      this.pending = "";
      if (line.length > 1024)
        throw Error("Video framehash line exceeds its budget");
      this.line(line.replace(/\r$/u, ""));
      cursor = next + 1;
    }
    this.pending += text.slice(cursor);
    if (this.pending.length > 1024)
      throw Error("Video framehash tail exceeds its budget");
  }
  private line(line: string): void {
    if (!line) return;
    if (line.startsWith("#")) {
      if (this.frames) throw Error("Video proof header changed after frames");
      if (/^#(?:software:|sar 0:|stream#,)/u.test(line)) return;
      const header =
        /^#(format|version|hash|tb 0|media_type 0|codec_id 0|dimensions 0):\s*(.+)$/u.exec(
          line,
        );
      if (!header || this.headers.has(header[1]!))
        throw Error("Video proof has unknown or duplicate headers");
      this.headers.set(header[1]!, header[2]!);
      return;
    }
    this.checkHeaders();
    const frame =
      /^0,\s*(-?\d{1,16}),\s*(-?\d{1,16}),\s*(\d{1,16}),\s*(\d{1,16}),\s*([a-f0-9]{64})$/u.exec(
        line,
      );
    if (!frame)
      throw Error(
        "Video proof frame is malformed or belongs to another stream",
      );
    const pts = BigInt(frame[2]!);
    const duration = BigInt(frame[3]!);
    const size = BigInt(frame[4]!);
    if (
      BigInt(frame[1]!) !== pts ||
      duration < 1n ||
      size < 1n ||
      size > BigInt(this.input.probe.width * this.input.probe.height * 16)
    )
      throw Error(
        "Decoded frame has no exact finite size or presentation clock",
      );
    if (this.frames >= this.maximumFrames)
      throw Error("Decoded video exceeds the exact frame budget");
    if (this.endTicks !== undefined && pts !== this.endTicks)
      throw Error(
        "Decoded video has a gap, overlap, duplicate or reordered presentation frame",
      );
    const { n, d } = this.input.probe.timeBase;
    if (
      this.input.outputFrames !== undefined &&
      (pts * n * 25n !== BigInt(this.frames) * d ||
        duration * n * 25n !== d ||
        size !==
          BigInt((this.input.probe.width * this.input.probe.height * 3) / 2))
    )
      throw Error(
        "Decoded output is not the exact zero-origin 25fps yuv420p frame sequence",
      );
    this.firstTicks ??= pts;
    this.endTicks = pts + duration;
    this.frames++;
    this.digest.update(`${pts}:${duration}:${size}:${frame[5]}\n`);
  }
  private checkHeaders(): void {
    const h = this.headers,
      p = this.input.probe;
    const clock = ratio(h.get("tb 0"));
    if (
      h.get("format") !== "frame checksums" ||
      h.get("version") !== "2" ||
      h.get("hash") !== "SHA256" ||
      h.get("media_type 0") !== "video" ||
      h.get("codec_id 0") !== "rawvideo" ||
      h.get("dimensions 0") !== `${p.width}x${p.height}` ||
      clock.n * p.timeBase.d !== p.timeBase.n * clock.d
    )
      throw Error(
        "Video framehash does not prove the original decoded stream and timebase",
      );
  }
  finish(): VideoFrameProof {
    if (this.finished) throw Error("Video proof cannot be finalized twice");
    this.finished = true;
    if (this.pending)
      throw Error("Video proof ends in a truncated frame or header");
    this.checkHeaders();
    const p = this.input.probe;
    if (
      !this.frames ||
      this.firstTicks !== p.startTicks ||
      this.endTicks !== p.startTicks + p.durationTicks ||
      (this.input.outputFrames !== undefined &&
        this.frames !== this.input.outputFrames)
    )
      throw Error(
        "Actual decoded video does not cover its complete declared presentation",
      );
    for (const range of this.input.requiredRanges ?? []) {
      const start = BigInt(range.sourceOffsetFrame),
        end = start + BigInt(range.durationFrames);
      // The file's container origin is subtracted exactly; no rounding, guessed fps, or padded source duration.
      const beginN =
        this.firstTicks * p.timeBase.n * p.origin.d - p.origin.n * p.timeBase.d;
      const endN =
        this.endTicks * p.timeBase.n * p.origin.d - p.origin.n * p.timeBase.d;
      const denominator = p.timeBase.d * p.origin.d;
      if (beginN * 25n > start * denominator || endN * 25n < end * denominator)
        throw Error(
          "Actual decoded video presentation does not cover the frozen source range",
        );
    }
    return {
      format: "dramaip-decoded-video-frames",
      version: 1,
      frames: this.frames,
      frameSequenceSha256: this.digest.digest("hex"),
    };
  }
}
