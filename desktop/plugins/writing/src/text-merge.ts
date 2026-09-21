export interface TextMergeSegment {
  id: string;
  base: string;
  current: string;
  candidate: string;
  conflict: boolean;
  content: string;
}
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

function changes(base: string[], next: string[]): Hunk[] {
  const width = next.length + 1;
  const table = new Uint32Array((base.length + 1) * width);
  for (let i = base.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      table[i * width + j] =
        base[i] === next[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const hunks: Hunk[] = [];
  let i = 0,
    j = 0,
    active: Hunk | undefined;
  const flush = () => {
    if (active) {
      hunks.push(active);
      active = undefined;
    }
  };
  while (i < base.length || j < next.length) {
    if (i < base.length && j < next.length && base[i] === next[j]) {
      flush();
      i++;
      j++;
      continue;
    }
    active ??= { start: i, end: i, lines: [] };
    if (
      j < next.length &&
      (i === base.length ||
        table[i * width + j + 1]! >= table[(i + 1) * width + j]!)
    )
      active.lines.push(next[j++]!);
    else {
      i++;
      active.end = i;
    }
  }
  flush();
  return hunks;
}

/** Paragraphs have no stable identifiers. Ambiguous repetitions and large diffs
 * deliberately require a decision instead of guessing their correspondence. */
export function mergeChapterText(
  baseText: string,
  currentText: string,
  candidateText: string,
): TextMergeSegment[] {
  const segment = (
    id: string,
    base: string,
    current: string,
    candidate: string,
  ): TextMergeSegment => ({
    id,
    base,
    current,
    candidate,
    conflict: current !== base && candidate !== base && current !== candidate,
    content:
      current === base
        ? candidate
        : candidate === base || current === candidate
          ? current
          : "",
  });
  if (
    currentText === baseText ||
    candidateText === baseText ||
    currentText === candidateText
  )
    return [segment("whole", baseText, currentText, candidateText)];
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const base = lines(baseText),
    current = lines(currentText),
    candidate = lines(candidateText);
  const meaningful = base.filter((line) => line.trim());
  if (
    new Set(meaningful).size !== meaningful.length ||
    (base.length + 1) * (Math.max(current.length, candidate.length) + 1) >
      1_000_000
  )
    return [segment("ambiguous", baseText, currentText, candidateText)];
  const left = changes(base, current),
    right = changes(base, candidate);
  const all = [...left, ...right].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const groups: Array<{ start: number; end: number }> = [];
  for (const hunk of all) {
    const last = groups.at(-1);
    if (last && hunk.start <= last.end) last.end = Math.max(last.end, hunk.end);
    else groups.push({ start: hunk.start, end: hunk.end });
  }
  const apply = (start: number, end: number, hunks: Hunk[]) => {
    const out: string[] = [];
    let cursor = start;
    for (const hunk of hunks.filter(
      (item) => item.start >= start && item.end <= end,
    )) {
      out.push(...base.slice(cursor, hunk.start), ...hunk.lines);
      cursor = hunk.end;
    }
    out.push(...base.slice(cursor, end));
    return out.join("");
  };
  const result: TextMergeSegment[] = [];
  let cursor = 0;
  for (const group of groups) {
    if (group.start > cursor) {
      const unchanged = base.slice(cursor, group.start).join("");
      result.push(segment(`same:${cursor}`, unchanged, unchanged, unchanged));
    }
    result.push(
      segment(
        `change:${group.start}:${group.end}`,
        base.slice(group.start, group.end).join(""),
        apply(group.start, group.end, left),
        apply(group.start, group.end, right),
      ),
    );
    cursor = group.end;
  }
  if (cursor < base.length) {
    const unchanged = base.slice(cursor).join("");
    result.push(segment(`same:${cursor}`, unchanged, unchanged, unchanged));
  }
  return result;
}
