import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  await readFile(
    resolve(root, "tests/fixtures/lm6/lm6-22/timeline-delivery-fixture.json"),
    "utf8",
  ),
);

function attributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

function frameValue(value, rate) {
  const match = /^(\d+)\/(\d+)s$/.exec(value ?? "");
  assert.ok(match, `invalid FCPXML rational time: ${value}`);
  assert.equal(Number(match[2]), rate, "FCPXML frame rate must be canonical");
  return Number(match[1]);
}

function parseFcpxmlReference(document, rate) {
  const assets = new Map(
    [...document.matchAll(/<asset\s+([^>]+?)\s*\/?>(?:<\/asset>)?/g)].map(
      (match) => {
        const item = attributes(match[1]);
        return [item.id, item.src];
      },
    ),
  );
  return [
    ...document.matchAll(/<asset-clip\s+([^>]+?)\s*\/?>(?:<\/asset-clip>)?/g),
  ].map((match) => {
    const item = attributes(match[1]);
    return {
      mediaPath: assets.get(item.ref),
      startFrames: frameValue(item.offset, rate),
      sourceFrames: frameValue(item.start, rate),
      durationFrames: frameValue(item.duration, rate),
    };
  });
}

function parseOtioReference(document) {
  const clips = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.OTIO_SCHEMA === "Clip.2") {
      clips.push({
        id: value.metadata?.dramaip?.clipId,
        startFrames: value.metadata?.dramaip?.timelineStartFrames,
        sourceFrames: value.source_range?.start_time?.value,
        durationFrames: value.source_range?.duration?.value,
        mediaPath: value.media_reference?.target_url,
      });
    }
    Object.values(value).forEach((item) => {
      if (Array.isArray(item)) item.forEach(visit);
      else visit(item);
    });
  };
  visit(document);
  return clips;
}

function timecodeFrames(value, rate) {
  const parts = value.split(":").map(Number);
  assert.equal(parts.length, 4, `invalid CMX timecode: ${value}`);
  return (parts[0] * 60 * 60 + parts[1] * 60 + parts[2]) * rate + parts[3];
}

function parseEdlReference(document, rate) {
  const entry = document
    .split("\n")
    .find((line) => /^\d{3}\s+AX\s+V\s+C\s+/.test(line));
  assert.ok(entry, "CMX 3600 must contain a video edit entry");
  const codes = entry.match(/\d{2}:\d{2}:\d{2}:\d{2}/g);
  assert.equal(codes?.length, 4, "CMX 3600 entry must have four timecodes");
  return {
    sourceInFrames: timecodeFrames(codes[0], rate),
    sourceOutFrames: timecodeFrames(codes[1], rate),
    recordInFrames: timecodeFrames(codes[2], rate),
    recordOutFrames: timecodeFrames(codes[3], rate),
  };
}

function subtitleMilliseconds(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  assert.ok(match, `invalid subtitle time: ${value}`);
  return (
    (Number(match[1]) * 60 * 60 + Number(match[2]) * 60 + Number(match[3])) *
      1_000 +
    Number(match[4])
  );
}

function parseSubtitleReference(document, format) {
  if (format === "vtt") assert.match(document, /^WEBVTT\r?\n/);
  const cue =
    /(\d{2}:\d{2}:\d{2}[,.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,.]\d{3})\r?\n([^\r\n]+)/.exec(
      document,
    );
  assert.ok(cue, `${format} must contain a parseable cue`);
  return {
    startMilliseconds: subtitleMilliseconds(cue[1]),
    endMilliseconds: subtitleMilliseconds(cue[2]),
    text: cue[3],
  };
}

const { expected, frameRate } = fixture;
const [fcpxmlClip] = parseFcpxmlReference(fixture.fcpxml, frameRate);
assert.deepEqual(fcpxmlClip, {
  mediaPath: expected.clip.mediaPath,
  startFrames: expected.clip.startFrames,
  sourceFrames: expected.clip.sourceFrames,
  durationFrames: expected.clip.durationFrames,
});
const [otioClip] = parseOtioReference(fixture.otio);
assert.deepEqual(otioClip, expected.clip);
assert.deepEqual(parseEdlReference(fixture.edl, frameRate), expected.edl);
assert.deepEqual(parseSubtitleReference(fixture.srt, "srt"), expected.subtitle);
assert.deepEqual(parseSubtitleReference(fixture.vtt, "vtt"), expected.subtitle);
for (const document of [
  fixture.fcpxml,
  JSON.stringify(fixture.otio),
  fixture.edl,
])
  assert.doesNotMatch(document, /(?:file:\/\/|(?:^|["'])\/[A-Za-z])/);

console.log(
  "Timeline exports pass FCPXML / OTIO / CMX 3600 / SRT / WebVTT reference round-trip checks.",
);
