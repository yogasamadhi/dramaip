/** Bounded single-face OpenType Unicode cmap (4/12). No OS fallback, last-resort map or guessed collection face. */
export function readFontGlyphMap(
  source: Uint8Array,
): (codePoint: number) => number {
  if (source.byteLength < 12 || source.byteLength > 32 * 1024 * 1024)
    throw Error("Font bytes exceed the single-face size budget");
  const b = Buffer.from(source); // Keep an independent immutable snapshot behind the lookup closure.
  const u16 = (at: number) => {
    if (at < 0 || at + 2 > b.length) throw Error("Font table is truncated");
    return b.readUInt16BE(at);
  };
  const u32 = (at: number) => {
    if (at < 0 || at + 4 > b.length) throw Error("Font table is truncated");
    return b.readUInt32BE(at);
  };
  const magic = u32(0);
  if (magic !== 0x00010000 && magic !== 0x4f54544f)
    throw Error(
      "Font requires a supported single OpenType face, not a collection or unknown format",
    );
  const count = u16(4);
  if (count < 1 || count > 256 || 12 + count * 16 > b.length)
    throw Error("Font directory is invalid");
  const tables = new Map<string, { offset: number; length: number }>();
  for (let n = 0; n < count; n++) {
    const at = 12 + n * 16,
      name = b.toString("ascii", at, at + 4),
      offset = u32(at + 8),
      length = u32(at + 12);
    if (
      tables.has(name) ||
      offset < 12 + count * 16 ||
      length < 1 ||
      offset + length > b.length
    )
      throw Error("Font table bounds or identity are invalid");
    tables.set(name, { offset, length });
  }
  const ranges = [...tables.values()].sort(
    (left, right) => left.offset - right.offset,
  );
  for (let n = 1; n < ranges.length; n++)
    if (ranges[n]!.offset < ranges[n - 1]!.offset + ranges[n - 1]!.length)
      throw Error("Font tables overlap");
  const cmap = tables.get("cmap"),
    maxp = tables.get("maxp");
  if (
    !cmap ||
    !maxp ||
    maxp.length < 6 ||
    cmap.length < 4 ||
    u16(cmap.offset) !== 0
  )
    throw Error("Font is missing its original cmap or glyph inventory");
  const glyphCount = u16(maxp.offset + 4),
    records = u16(cmap.offset + 2);
  if (!glyphCount || !records || records > 256 || 4 + records * 8 > cmap.length)
    throw Error("Font Unicode directory is invalid");
  const candidates: { at: number; format: number; priority: number }[] = [];
  for (let n = 0; n < records; n++) {
    const at = cmap.offset + 4 + n * 8,
      platform = u16(at),
      encoding = u16(at + 2),
      relative = u32(at + 4);
    if (relative < 4 + records * 8 || relative + 2 > cmap.length)
      throw Error("Font cmap record points outside its table");
    if (
      (platform === 3 && (encoding === 1 || encoding === 10)) ||
      (platform === 0 && encoding <= 4)
    ) {
      const start = cmap.offset + relative,
        format = u16(start);
      if (format === 4 || format === 12)
        candidates.push({
          at: start,
          format,
          priority: (format === 12 ? 10 : 0) + (platform === 3 ? 1 : 0),
        });
    }
  }
  candidates.sort(
    (left, right) => right.priority - left.priority || left.at - right.at,
  );
  const chosen = candidates[0];
  if (!chosen)
    throw Error(
      "Font has no supported exclusive Unicode cmap; symbol or last-resort fallback is not accepted",
    );
  const endOfCmap = cmap.offset + cmap.length;
  const validGlyph = (glyph: number) =>
    glyph >= 0 && glyph < glyphCount ? glyph : 0;
  const validPoint = (cp: number) =>
    Number.isInteger(cp) &&
    cp >= 0 &&
    cp <= 0x10ffff &&
    !(cp >= 0xd800 && cp <= 0xdfff);
  if (chosen.format === 12) {
    const at = chosen.at;
    if (at + 16 > endOfCmap) throw Error("Font format-12 header is truncated");
    const length = u32(at + 4),
      groups = u32(at + 12);
    if (
      u16(at + 2) !== 0 ||
      length < 16 ||
      at + length > endOfCmap ||
      groups > 100_000 ||
      16 + groups * 12 !== length
    )
      throw Error("Font format-12 bounds are invalid");
    let previous = -1;
    for (let n = 0; n < groups; n++) {
      const entry = at + 16 + n * 12,
        start = u32(entry),
        end = u32(entry + 4),
        glyph = u32(entry + 8);
      if (
        start <= previous ||
        end < start ||
        end > 0x10ffff ||
        glyph + end - start >= glyphCount
      )
        throw Error("Font format-12 ranges or glyph inventory are invalid");
      previous = end;
    }
    return (cp) => {
      if (!validPoint(cp)) return 0;
      let low = 0,
        high = groups - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1,
          entry = at + 16 + mid * 12,
          start = u32(entry),
          end = u32(entry + 4);
        if (cp < start) high = mid - 1;
        else if (cp > end) low = mid + 1;
        else return validGlyph(u32(entry + 8) + cp - start);
      }
      return 0;
    };
  }
  const at = chosen.at;
  if (at + 16 > endOfCmap) throw Error("Font format-4 header is truncated");
  const length = u16(at + 2),
    segmentsX2 = u16(at + 6),
    segments = segmentsX2 / 2;
  if (
    length < 16 ||
    at + length > endOfCmap ||
    !Number.isInteger(segments) ||
    segments < 1 ||
    16 + segments * 8 > length
  )
    throw Error("Font format-4 bounds are invalid");
  const ends = at + 14,
    starts = ends + segments * 2 + 2,
    deltas = starts + segments * 2,
    offsets = deltas + segments * 2;
  if (
    u16(ends + segments * 2) !== 0 ||
    u16(ends + (segments - 1) * 2) !== 0xffff
  )
    throw Error("Font format-4 reserved word or sentinel is invalid");
  let previous = -1;
  for (let n = 0; n < segments; n++) {
    const start = u16(starts + n * 2),
      end = u16(ends + n * 2),
      distance = u16(offsets + n * 2);
    if (
      end <= previous ||
      start <= previous ||
      start > end ||
      distance % 2 !== 0 ||
      (distance &&
        (offsets + n * 2 + distance < offsets + segments * 2 ||
          offsets + n * 2 + distance + (end - start) * 2 + 2 > at + length))
    )
      throw Error("Font format-4 ranges or glyph pointers are invalid");
    previous = end;
  }
  return (cp) => {
    if (!validPoint(cp) || cp > 0xffff) return 0;
    let low = 0,
      high = segments - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1,
        start = u16(starts + mid * 2),
        end = u16(ends + mid * 2);
      if (cp < start) high = mid - 1;
      else if (cp > end) low = mid + 1;
      else {
        const distance = u16(offsets + mid * 2),
          delta = b.readInt16BE(deltas + mid * 2);
        const glyph = distance
          ? u16(offsets + mid * 2 + distance + (cp - start) * 2)
          : cp;
        return validGlyph(
          distance && glyph === 0 ? 0 : (glyph + delta) & 0xffff,
        );
      }
    }
    return 0;
  };
}

export function assertFontTextCoverage(
  text: string,
  glyph: (cp: number) => number,
): void {
  if (!text.trim() || Buffer.byteLength(text, "utf8") > 16 * 1024)
    throw Error(
      "Subtitle text is empty, malformed or contains unsupported control bytes",
    );
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (
      (point >= 0xd800 && point <= 0xdfff) ||
      (point < 32 && point !== 10) ||
      point === 127
    )
      throw Error(
        "Subtitle text contains a lone surrogate or unsupported control bytes",
      );
    if (character === "\n") continue;
    if (!glyph(point))
      throw Error(
        "Selected exact font does not contain every subtitle glyph; no fallback or replacement is allowed",
      );
  }
}
