import { describe, expect, test } from "bun:test";
import {
  interpretRenderVideoProbe,
  VideoFrameHashVerifier,
  type RenderVideoProbe,
} from "./video-proof";

const metadata = () => ({
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      pix_fmt: "yuv420p",
      width: 1080,
      height: 1920,
      time_base: "1/12800",
      start_pts: 0,
      duration_ts: 12800,
      sample_aspect_ratio: "1:1",
      avg_frame_rate: "25/1",
      r_frame_rate: "25/1",
      disposition: { attached_pic: 0 },
    },
    {
      index: 1,
      codec_type: "audio",
      codec_name: "aac",
      channels: 2,
      sample_rate: "48000",
    },
  ],
  format: { start_time: "0.000000", duration: "999.000000" },
});
const profile = { width: 1080, height: 1920, durationFrames: 25 };
const probe = () => interpretRenderVideoProbe(metadata(), profile);
const header = (p: RenderVideoProbe) =>
  `#format: frame checksums\n#version: 2\n#hash: SHA256\n#software: Lavf-controlled\n#tb 0: ${p.timeBase.n}/${p.timeBase.d}\n#media_type 0: video\n#codec_id 0: rawvideo\n#dimensions 0: ${p.width}x${p.height}\n#sar 0: 1/1\n#stream#, dts, pts, duration, size, hash\n`;
const row = (pts: bigint, duration = 512n, size = (1080 * 1920 * 3) / 2) =>
  `0, ${pts}, ${pts}, ${duration}, ${size}, ${"a".repeat(64)}\n`;
const output = () =>
  header(probe()) +
  Array.from({ length: 25 }, (_, n) => row(BigInt(n) * 512n)).join("");
function verify(
  text: string,
  p = probe(),
  outputFrames: number | undefined = 25,
) {
  const parser = new VideoFrameHashVerifier({ probe: p, outputFrames });
  parser.push(Buffer.from(text));
  return parser.finish();
}

describe("actual decoded video proof", () => {
  test("whole frame sequence and arbitrary chunk/CRLF boundaries preserve the same canonical receipt", () => {
    const expected = verify(output());
    expect(expected).toMatchObject({
      format: "dramaip-decoded-video-frames",
      version: 1,
      frames: 25,
    });
    expect(expected.frameSequenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    for (const size of [1, 2, 7, 31, 1024]) {
      const bytes = Buffer.from(output().replaceAll("\n", "\r\n"));
      const parser = new VideoFrameHashVerifier({
        probe: probe(),
        outputFrames: 25,
      });
      for (let offset = 0; offset < bytes.length; offset += size)
        parser.push(bytes.subarray(offset, offset + size));
      expect(parser.finish()).toEqual(expected);
      expect(() => parser.finish()).toThrow("twice");
      expect(() => parser.push(Buffer.alloc(0))).toThrow("finalized");
    }
    expect(
      verify(output().replace("a".repeat(64), "b".repeat(64)))
        .frameSequenceSha256,
    ).not.toBe(expected.frameSequenceSha256);
  });
  test("probe refuses guessed first streams, attached pictures, unknown clocks and format-duration fallback", () => {
    for (const change of [
      (m: ReturnType<typeof metadata>) => {
        m.streams.push({ ...m.streams[0]! });
      },
      (m: ReturnType<typeof metadata>) => {
        m.streams = [m.streams[1]!];
      },
      (m: ReturnType<typeof metadata>) => {
        delete m.streams[0]!.duration_ts;
      },
      (m: ReturnType<typeof metadata>) => {
        m.streams[0]!.start_pts = Number.MAX_SAFE_INTEGER + 1;
      },
      (m: ReturnType<typeof metadata>) => {
        m.streams[0]!.time_base = "0/0";
      },
      (m: ReturnType<typeof metadata>) => {
        m.streams[0]!.disposition = { attached_pic: 1 };
      },
      (m: ReturnType<typeof metadata>) => {
        m.format.start_time = "unknown";
      },
      (m: ReturnType<typeof metadata>) => {
        m.streams[0]!.duration_ts = 86401 * 12800;
      },
      (m: ReturnType<typeof metadata>) => {
        m.streams[0]!.width = 8193;
      },
    ]) {
      const m = metadata();
      change(m);
      expect(() => interpretRenderVideoProbe(m)).toThrow();
    }
  });
  test("output rejects extra streams and profile contradictions even with apparently matching duration metadata", () => {
    for (const patch of [
      { codec_name: "hevc" },
      { pix_fmt: "yuv444p" },
      { start_pts: 512 },
      { duration_ts: 12799 },
      { width: 720 },
      { height: 1080 },
      { avg_frame_rate: "25000/1000" },
      { r_frame_rate: "50/1" },
      { sample_aspect_ratio: "2:1" },
    ]) {
      const m = metadata();
      Object.assign(m.streams[0]!, patch);
      expect(() => interpretRenderVideoProbe(m, profile)).toThrow("profile");
    }
    for (const patch of [
      { codec_type: "subtitle" },
      { codec_name: "mp3" },
      { channels: 1 },
      { sample_rate: "44100" },
    ]) {
      const m = metadata();
      Object.assign(m.streams[1]!, patch);
      expect(() => interpretRenderVideoProbe(m, profile)).toThrow("profile");
    }
    const extra = metadata();
    extra.streams.push({ ...extra.streams[1]!, index: 2 });
    expect(() => interpretRenderVideoProbe(extra, profile)).toThrow(
      "inventory",
    );
  });
  test("zero frames, short decode, extra frames and partial EOF are not complete video", () => {
    expect(() => verify(header(probe()))).toThrow("complete");
    expect(() => verify(output().replace(row(24n * 512n), ""))).toThrow(
      "complete",
    );
    expect(() => verify(output() + row(25n * 512n))).toThrow("budget");
    expect(() => verify(output().trimEnd())).toThrow("truncated");
  });
  test("all frame clocks are checked: gaps, duplicates, reordered frames and wrong durations fail", () => {
    for (const replacement of [
      row(12n * 512n + 1n),
      row(11n * 512n),
      row(13n * 512n),
      row(12n * 512n, 511n),
      row(12n * 512n, 0n),
    ])
      expect(() =>
        verify(output().replace(row(12n * 512n), replacement)),
      ).toThrow();
    expect(() => verify(output().replace("0, 0, 0,", "0, -1, 0,"))).toThrow(
      "clock",
    );
  });
  test("no header retiming, copied compressed packets, wrong dimensions or another stream can masquerade as decoded pixels", () => {
    for (const [from, to] of [
      ["SHA256", "MD5"],
      ["rawvideo", "h264"],
      ["1/12800", "1/25"],
      ["1080x1920", "1920x1080"],
      ["#version: 2", "#version: 3"],
    ])
      expect(() => verify(output().replace(from!, to!))).toThrow();
    expect(() =>
      verify(output().replace(row(0n), row(0n).replace(/^0/u, "1"))),
    ).toThrow("another stream");
    expect(() => verify(output() + "#hash: SHA256\n")).toThrow("changed");
    expect(() =>
      verify(
        output().replace("#hash: SHA256\n", "#hash: SHA256\n#hash: SHA256\n"),
      ),
    ).toThrow("duplicate");
  });
  test("decoded output byte sizes and per-frame hashes are mandatory, not just a count", () => {
    for (const replacement of [
      row(0n, 512n, 0),
      row(0n, 512n, 1080 * 1920 * 3),
      row(0n).replace("a".repeat(64), "x".repeat(64)),
    ])
      expect(() => verify(output().replace(row(0n), replacement))).toThrow();
  });
  test("source presentation uses exact container origin, retains nonzero clocks and checks every requested split range", () => {
    const p = { ...probe(), startTicks: 5120n, origin: { n: 2n, d: 5n } };
    const text =
      header(p) +
      Array.from({ length: 25 }, (_, n) => row(5120n + BigInt(n) * 512n)).join(
        "",
      );
    const parser = new VideoFrameHashVerifier({
      probe: p,
      requiredRanges: [
        { sourceOffsetFrame: 0, durationFrames: 10 },
        { sourceOffsetFrame: 10, durationFrames: 15 },
      ],
    });
    parser.push(Buffer.from(text));
    expect(parser.finish().frames).toBe(25);
    const short = new VideoFrameHashVerifier({
      probe: p,
      requiredRanges: [{ sourceOffsetFrame: 1, durationFrames: 25 }],
    });
    short.push(Buffer.from(text));
    expect(() => short.finish()).toThrow("source range");
    const delayed = new VideoFrameHashVerifier({
      probe: { ...p, origin: { n: 0n, d: 1n } },
      requiredRanges: [{ sourceOffsetFrame: 0, durationFrames: 25 }],
    });
    delayed.push(Buffer.from(text));
    expect(() => delayed.finish()).toThrow("source range");
  });
  test("source cannot use a nominal long duration to pass fewer decoded frames", () => {
    const p = { ...probe(), durationTicks: 25600n };
    expect(() => verify(output(), p, undefined)).toThrow("complete");
  });
  test("explicit frame/line/ASCII budgets refuse the whole proof without truncating it", () => {
    expect(
      () =>
        new VideoFrameHashVerifier({
          probe: probe(),
          maximumFrames: 1_000_001,
        }),
    ).toThrow("budget");
    expect(
      () =>
        new VideoFrameHashVerifier({
          probe: probe(),
          requiredRanges: [{ sourceOffsetFrame: -1, durationFrames: 1 }],
        }),
    ).toThrow("range");
    const parser = new VideoFrameHashVerifier({ probe: probe() });
    expect(() => parser.push(Buffer.from("x".repeat(1025)))).toThrow("budget");
    const other = new VideoFrameHashVerifier({ probe: probe() });
    expect(() => other.push(Buffer.from([0xff]))).toThrow("ASCII");
  });
});
