import assert from "node:assert/strict";
import { test } from "vitest";
import { interpretRenderAudioProbe } from "./audio-probe";
import { renderMediaInputOptions } from "./render-media-input";

test("private inputs bind their exact supported demuxer and disable external MP4 tracks, not auto-detected playlists", () => {
  assert.deepEqual(renderMediaInputOptions("/private/source.input.wav"), [
    "-protocol_whitelist",
    "file",
    "-f",
    "wav",
  ]);
  assert.deepEqual(renderMediaInputOptions("/private/source.input.mp4"), [
    "-protocol_whitelist",
    "file",
    "-f",
    "mov",
    "-enable_drefs",
    "0",
    "-use_absolute_path",
    "0",
  ]);
  for (const path of [
    "https://remote.invalid/audio.mp3",
    "../source.wav",
    "/private/file.m3u8",
    "/private/file.mp4?other=1",
    "/private/file",
  ])
    assert.throws(() => renderMediaInputOptions(path));
});
const stream = () => ({
  index: 0,
  codec_type: "audio",
  channels: 1,
  sample_rate: "44100",
  codec_name: "pcm_f32le",
  time_base: "1/44100",
  duration_ts: 176400,
});
test("mono stream duration maps to exact P0 sample clock without a format duration", () => {
  assert.deepEqual(
    interpretRenderAudioProbe({ streams: [stream()] }, "audio"),
    {
      hasAudio: true,
      sourceKind: "audio",
      streamIndex: 0,
      channels: 1,
      sampleRate: 44100,
      codecName: "pcm_f32le",
      presentationEndSamples: 192000,
    },
  );
});
test("video audio lead is measured relative to the container origin, not cut off", () => {
  const result = interpretRenderAudioProbe(
    {
      streams: [
        { index: 0, codec_type: "video" },
        {
          ...stream(),
          index: 1,
          channels: 2,
          sample_rate: "48000",
          codec_name: "aac",
          time_base: "1/48000",
          duration_ts: 97024,
          start_pts: 18144,
        },
      ],
      format: { start_time: "0.000000" },
    },
    "video",
  );
  assert(result.hasAudio);
  assert.equal(result.presentationEndSamples, 115168);
  assert.equal(result.streamIndex, 1);
});
test("known video with no audio is explicit, while missing standalone audio is an error", () => {
  assert.deepEqual(
    interpretRenderAudioProbe(
      { streams: [{ index: 0, codec_type: "video" }] },
      "video",
    ),
    { hasAudio: false, sourceKind: "video" },
  );
  assert.throws(
    () => interpretRenderAudioProbe({ streams: [] }, "audio"),
    /missing/u,
  );
});
test("ambiguous streams and wrong archived kind are rejected instead of selecting first", () => {
  for (const streams of [
    [stream(), { ...stream(), index: 1 }],
    [{ index: 0, codec_type: "video" }, stream()],
    [
      { index: 0, codec_type: "video" },
      { index: 1, codec_type: "video" },
      stream(),
    ],
  ])
    assert.throws(() => interpretRenderAudioProbe({ streams }, "audio"));
  assert.throws(() =>
    interpretRenderAudioProbe({ streams: [stream()] }, "video"),
  );
});
test("channels, rates, indexes and uncertain/overlarge clocks fail without format-duration fallback", () => {
  for (const patch of [
    { channels: 6 },
    { channels: "2" },
    { sample_rate: "N/A" },
    { sample_rate: "999999" },
    { index: -1 },
    { duration_ts: NaN },
    { duration_ts: Number.MAX_SAFE_INTEGER + 1 },
    { duration_ts: 0 },
    { time_base: "1/0" },
    { start_pts: 0.5 },
    { codec_name: "../secret" },
  ])
    assert.throws(() =>
      interpretRenderAudioProbe(
        {
          streams: [{ ...stream(), ...patch }],
          format: { duration: "1000.0" },
        },
        "audio",
      ),
    );
  const noDuration: Record<string, unknown> = stream();
  delete noDuration.duration_ts;
  assert.throws(() =>
    interpretRenderAudioProbe(
      { streams: [noDuration], format: { duration: "1000.0" } },
      "audio",
    ),
  );
});
test("rational MP3 clocks and decimal origin are interpreted with integer math", () => {
  const result = interpretRenderAudioProbe(
    {
      streams: [
        {
          ...stream(),
          codec_name: "mp3",
          time_base: "1/14112000",
          duration_ts: 1411200,
          start_time: "0.025000",
        },
      ],
      format: { start_time: "0.025000" },
    },
    "audio",
  );
  assert(result.hasAudio);
  assert.equal(result.presentationEndSamples, 4800);
});
test("malformed inventory and malicious presentation fields cannot produce a sample receipt", () => {
  for (const value of [
    null,
    { streams: "audio" },
    { streams: [null] },
    { streams: [{ ...stream(), start_time: "N/A" }] },
    {
      streams: [
        {
          ...stream(),
          time_base: "9999999999999999/1",
          duration_ts: Number.MAX_SAFE_INTEGER,
        },
      ],
    },
  ])
    assert.throws(() => interpretRenderAudioProbe(value, "audio"));
});
