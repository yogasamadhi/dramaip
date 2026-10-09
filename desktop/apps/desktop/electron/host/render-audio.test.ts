import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  buildTimelineAudioMix,
  MAX_AUDIO_MIX_CLIPS,
  type ResolvedRenderAudioClip,
} from "./render-audio";
import { verifyMixedAudioPcm, verifySourceAudioPcm } from "./audio-pcm";

const clip = (
  patch: Partial<ResolvedRenderAudioClip> = {},
): ResolvedRenderAudioClip => ({
  inputIndex: 0,
  channels: 2,
  kind: "bgm",
  startFrame: 5,
  durationFrames: 55,
  sourceOffsetFrame: 25,
  volume: 0.7,
  fadeInFrames: 10,
  fadeOutFrames: 10,
  duckingGain: 0.55,
  ...patch,
});
const signal = () => new AbortController().signal;
async function* bytes(data: Buffer, size = 7) {
  for (let at = 0; at < data.length; at += size)
    yield data.subarray(at, at + size);
}
const pcm = (values: number[]) => {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => data.writeFloatLE(value, index * 4));
  return data;
};

test("exact P0 samples, original offset, two multiplicative fades and no hidden normalization", () => {
  const value = clip({ volume: 1.8, fadeInFrames: 90, fadeOutFrames: 80 });
  const before = JSON.stringify(value);
  const result = buildTimelineAudioMix(75, [value]);
  assert.equal(result.samplesPerChannel, 144000);
  assert.match(result.filters[1]!, /start_sample=48000:end_sample=153600/u);
  assert.match(
    result.filters[1]!,
    /1\.8\*min\(1,n\/172800\)\*min\(1,\(105600-n\)\/153600\)/u,
  );
  assert.match(result.filters[1]!, /adelay=delays=9600S:all=1/u);
  assert.match(result.filters.at(-1)!, /normalize=0/u);
  assert.equal(JSON.stringify(value), before);
});
test("merged half-open voice intervals are local to each BGM, including zero-volume voices", () => {
  const result = buildTimelineAudioMix(100, [
    clip(),
    clip({ kind: "dialogue", startFrame: 25, durationFrames: 20, volume: 0 }),
    clip({ kind: "narration", startFrame: 40, durationFrames: 15 }),
  ]);
  assert.match(result.filters[1]!, /gte\(n,38400\)\*lt\(n,96000\)/u);
  assert.equal((result.filters[1]!.match(/0\.55/gu) ?? []).length, 1);
  assert.doesNotMatch(result.filters[2]!, /gte\(/u);
});
test("video embedded audio participates at its saved gain and never triggers voice duck", () => {
  const result = buildTimelineAudioMix(75, [clip({ kind: "video" }), clip()]);
  assert.match(result.filters[1]!, /\[0:a:0\]/u);
  assert.doesNotMatch(result.filters.join(";"), /gte\(/u);
});
test("mono is explicitly duplicated at unity; stereo is not re-panned", () => {
  const result = buildTimelineAudioMix(75, [
    clip({ channels: 1 }),
    clip({ inputIndex: 1 }),
  ]);
  assert.match(result.filters[1]!, /pan=stereo\|c0=c0\|c1=c0/u);
  assert.doesNotMatch(result.filters[2]!, /pan=/u);
});
test("empty audible set keeps exact silence duration without a fabricated source", () => {
  const result = buildTimelineAudioMix(2, []);
  assert.equal(result.samplesPerChannel, 3840);
  assert.equal(result.filters.length, 2);
  assert.doesNotMatch(result.filters.join(";"), /\[0:a:0\]/u);
});
test("bad controls, shapes, unsupported channels and frame overflow fail before process construction", () => {
  for (const patch of [
    { volume: NaN },
    { duckingGain: Infinity },
    { channels: 6 },
    { kind: "subtitle" },
    { inputIndex: -1 },
    { inputIndex: "0" },
    { durationFrames: 0 },
    { startFrame: 74 },
    { sourceOffsetFrame: Number.MAX_SAFE_INTEGER },
    { fadeInFrames: -1 },
    { volume: "1);movie=/private" },
    { path: "/private" },
  ]) {
    assert.throws(() =>
      buildTimelineAudioMix(75, [
        { ...clip(), ...patch } as ResolvedRenderAudioClip,
      ]),
    );
  }
  assert.throws(() => buildTimelineAudioMix(Number.MAX_SAFE_INTEGER, []));
});
test("explicit count and graph budgets refuse full request without truncating or mutating clips", () => {
  assert.throws(
    () =>
      buildTimelineAudioMix(
        75,
        Array.from({ length: MAX_AUDIO_MIX_CLIPS + 1 }, () => clip()),
      ),
    /clip count/u,
  );
  const values = Array.from({ length: MAX_AUDIO_MIX_CLIPS }, () => clip());
  const before = JSON.stringify(values);
  assert.throws(() => buildTimelineAudioMix(75, values), /resource budget/u);
  assert.equal(JSON.stringify(values), before);
});
test("negative saved gain remains mathematical phase inversion, not coerced to zero", () => {
  assert.match(
    buildTimelineAudioMix(75, [clip({ volume: -0.2 })]).filters[1]!,
    /val\(ch\)\*\(-0\.2/u,
  );
});
test("PCM verifies all channels across partial-float chunk boundaries and preserves exact bytes", async () => {
  const result = await verifyMixedAudioPcm(
    bytes(pcm([0.5, -0.25, 1, -1])),
    2,
    signal(),
  );
  assert.equal(result.samplesPerChannel, 2);
  assert.equal(result.channels, 2);
  assert.equal(result.peak, 1);
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
});
test("PCM silence is a known zero peak, not a missing value", async () => {
  assert.equal(
    (await verifyMixedAudioPcm(bytes(pcm([0, 0])), 1, signal())).peak,
    0,
  );
});
test("PCM short, extra and fractional bytes cannot pass an exact duration receipt", async () => {
  for (const data of [pcm([0]), pcm([0, 0, 0]), Buffer.alloc(7)])
    await assert.rejects(
      verifyMixedAudioPcm(bytes(data), 1, signal()),
      /duration/u,
    );
});
test("PCM non-finite or over-unity outputs reject instead of quietly clipping or normalizing", async () => {
  for (const value of [NaN, Infinity, -Infinity, 1.001, -1.001])
    await assert.rejects(
      verifyMixedAudioPcm(bytes(pcm([value, 0])), 1, signal()),
      /non-finite|peak exceeds/u,
    );
});
test("PCM cancellation before reading and between chunks does not return a completed receipt", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    verifyMixedAudioPcm(bytes(pcm([0, 0])), 1, before.signal),
  );
  const during = new AbortController();
  async function* aborted() {
    yield pcm([0]);
    during.abort();
    yield pcm([0]);
  }
  await assert.rejects(verifyMixedAudioPcm(aborted(), 1, during.signal));
});
test("decoded source proof rejects short, half-stereo, non-finite or over-budget data before padding", async () => {
  for (const data of [
    pcm([0, 0]),
    pcm([0, 0, 0]),
    pcm([NaN, 0, 0, 0]),
    pcm([0, 0, 0, 0, 0, 0, 0, 0]),
  ])
    await assert.rejects(
      verifySourceAudioPcm(bytes(data), 2, 3, signal()),
      /duration|stereo|non-finite/u,
    );
});
test("source gain above unity can be preserved for later saved attenuation; only final mix has the unity gate", async () => {
  const result = await verifySourceAudioPcm(
    bytes(pcm([1.5, -1.2, 0, 0, 0.1, -0.1])),
    2,
    3,
    signal(),
  );
  assert.equal(result.samplesPerChannel, 3);
  assert.equal(result.peak, 1.5);
  await assert.rejects(
    verifyMixedAudioPcm(bytes(pcm([1.5, -1.2])), 1, signal()),
    /peak exceeds/u,
  );
});
