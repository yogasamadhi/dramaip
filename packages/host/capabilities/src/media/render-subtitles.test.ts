import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildRenderSubtitleFilters,
  validateRenderSubtitleCues,
} from "./render-subtitles";
import { FONT_FIXTURE_ID, fontFixture, fontSha } from "./renderer-font.fixture";
import { readFontGlyphMap } from "./font-cmap";

const bytes = fontFixture();
const ref = {
  id: FONT_FIXTURE_ID,
  packVersion: "0.0.0-local-test",
  sha256: fontSha(bytes),
};
const font = {
  descriptor: {
    ...ref,
    label: "Test",
    sizeBytes: bytes.length,
    license: "TEST-ONLY",
    sourceUrl: "https://fixtures.invalid/font",
  },
  glyph: readFontGlyphMap(bytes),
  bytes: () => Buffer.from(bytes),
};
const cue = {
  clipId: "88888888-8888-4888-8888-888888888888",
  startFrame: 5,
  durationFrames: 7,
  text: "AB字\n😀",
};
test("exact font reference and original half-open cues validate without normalizing or mutating text", () => {
  const original = JSON.stringify(cue);
  validateRenderSubtitleCues(25, [cue], font, ref);
  assert.equal(JSON.stringify(cue), original);
  const filters = buildRenderSubtitleFilters([cue]);
  assert.match(filters[0]!, /expansion=none/u);
  assert.match(filters[0]!, /textfile=subtitle-0000.txt/u);
  assert.match(filters[0]!, /gte\(n,5\)\*lt\(n,12\)/u);
  assert.doesNotMatch(filters[0]!, /AB字|😀/u);
});
test("font ID, original version or SHA substitution rejects without fallback", () => {
  for (const patch of [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { packVersion: "0.0.1" },
    { sha256: "0".repeat(64) },
    { path: "/private/font.ttf" },
  ])
    assert.throws(() =>
      validateRenderSubtitleCues(25, [cue], font, { ...ref, ...patch }),
    );
});
test("overlap, duplicate IDs, malformed ranges, controls and missing glyphs refuse the full plan", () => {
  for (const patch of [
    { startFrame: -1 },
    { startFrame: 25 },
    { durationFrames: 0 },
    { durationFrames: 1.5 },
    { startFrame: Number.MAX_SAFE_INTEGER },
    { text: "D" },
    { text: "A\u0000" },
    { path: "/private" },
  ])
    assert.throws(() =>
      validateRenderSubtitleCues(25, [{ ...cue, ...patch }], font, ref),
    );
  assert.throws(() => validateRenderSubtitleCues(25, [cue, cue], font, ref));
  assert.throws(
    () =>
      validateRenderSubtitleCues(
        25,
        [cue, { ...cue, clipId: FONT_FIXTURE_ID, startFrame: 11 }],
        font,
        ref,
      ),
    /Overlapping/u,
  );
  validateRenderSubtitleCues(
    25,
    [cue, { ...cue, clipId: FONT_FIXTURE_ID, startFrame: 12 }],
    font,
    ref,
  );
});
test("full cue, text and graph budgets refuse rather than truncating", () => {
  assert.throws(() => validateRenderSubtitleCues(25, [], font, ref));
  assert.throws(
    () => validateRenderSubtitleCues(25, Array(257).fill(cue), font, ref),
    /cue count/u,
  );
  assert.throws(() => validateRenderSubtitleCues(1_000_001, [cue], font, ref));
  assert.throws(
    () => buildRenderSubtitleFilters(Array(400).fill(cue)),
    /budget/u,
  );
});
test("standalone graph builder rejects numeric filter injection rather than trusting TypeScript casts", () => {
  for (const patch of [
    { startFrame: "0);movie=/private" },
    { durationFrames: "1" },
    { startFrame: NaN },
    { durationFrames: Infinity },
  ])
    assert.throws(
      () =>
        buildRenderSubtitleFilters([
          { ...cue, ...patch } as unknown as typeof cue,
        ]),
      /integer frames/u,
    );
});
