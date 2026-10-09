import assert from "node:assert/strict";
import { test } from "bun:test";
import { assertFontTextCoverage, readFontGlyphMap } from "./font-cmap";
import { fontFixture } from "./renderer-font.fixture";

test("exclusive format-12 lookup covers BMP and supplementary scalar values without mutating its source", () => {
  const bytes = fontFixture(),
    glyph = readFontGlyphMap(bytes);
  bytes.fill(0);
  assert.equal(glyph(0x41), 1);
  assert.equal(glyph(0x43), 3);
  assert.equal(glyph(0x5b57), 4);
  assert.equal(glyph(0x1f600), 5);
  for (const point of [0x40, 0x44, 0xd800, -1, 0x110000, 1.5, NaN])
    assert.equal(glyph(point), 0);
});
test("format-4 delta and relative glyph array preserve notdef zero instead of applying fallback", () => {
  const direct = readFontGlyphMap(fontFixture(4)),
    array = readFontGlyphMap(fontFixture(4, true));
  assert.equal(direct(0x41), 1);
  assert.equal(direct(0x5b57), 4);
  assert.equal(direct(0xffff), 0);
  assert.equal(direct(0x1f600), 0);
  assert.equal(array(0x41), 6);
  assert.equal(array(0x42), 0);
  assert.equal(array(0x43), 7);
});
test("collections, unknown faces, overlapping directories and truncated tables fail closed", () => {
  const patches = [
    (b: Buffer) => b.write("ttcf", 0),
    (b: Buffer) => b.writeUInt16BE(0, 4),
    (b: Buffer) => b.writeUInt32BE(44, 36),
    (b: Buffer) => b.writeUInt32BE(b.length, 20),
    (b: Buffer) => b.writeUInt32BE(1, 52),
    (b: Buffer) => b.writeUInt16BE(3, 44),
  ];
  for (const patch of patches) {
    const bytes = fontFixture();
    patch(bytes);
    assert.throws(() => readFontGlyphMap(bytes));
  }
  assert.throws(() => readFontGlyphMap(fontFixture().subarray(0, 10)));
});
test("format-12 unsorted ranges, impossible glyph inventories and unbounded group counts reject", () => {
  for (const [at, value] of [
    [56 + 4, 15],
    [56 + 12, 100001],
    [56 + 16 + 12, 0x40],
    [56 + 16 + 8, 16],
  ] as const) {
    const bytes = fontFixture();
    bytes.writeUInt32BE(value, at);
    assert.throws(() => readFontGlyphMap(bytes));
  }
});
test("format-4 bad sentinels, overlapping segments, odd and out-of-table pointers reject", () => {
  for (const [at, value] of [
    [56 + 18, 0xfffe],
    [56 + 20, 1],
    [56 + 24, 0x40],
    [56 + 34, 1],
    [56 + 34, 1000],
  ] as const) {
    const bytes = fontFixture(4, true);
    bytes.writeUInt16BE(value, at);
    assert.throws(() => readFontGlyphMap(bytes));
  }
});
test("text coverage allows original Unicode and newline, but rejects absent glyphs, controls, lone surrogates and budgets", () => {
  const glyph = readFontGlyphMap(fontFixture());
  assertFontTextCoverage("AB字\n😀", glyph);
  for (const value of [
    "D",
    "",
    "\n",
    "A\u0000",
    "A\tB",
    "A\rB",
    "A\ud800",
    "A".repeat(16385),
  ])
    assert.throws(() => assertFontTextCoverage(value, glyph));
});
