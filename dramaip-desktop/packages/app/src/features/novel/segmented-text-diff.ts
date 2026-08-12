export type SegmentedDiffKind = "same" | "add" | "remove" | "replace";

export interface SegmentedDiffBlock {
  id: string;
  kind: SegmentedDiffKind;
  before: string;
  after: string;
}

/**
 * Legacy 小说工作台使用的段落级差异语义。这里只在附近寻找锚点，
 * 长章节不会因为全量 LCS 计算而阻塞编辑器。
 */
export function buildSegmentedTextDiff(
  previous: string,
  next: string,
): SegmentedDiffBlock[] {
  if (previous === next) return [];
  const before = splitParagraphs(previous);
  const after = splitParagraphs(next);
  const blocks: SegmentedDiffBlock[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let sequence = 0;
  const push = (kind: SegmentedDiffKind, oldText = "", newText = ""): void => {
    blocks.push({
      id: `change-${sequence++}`,
      kind,
      before: oldText,
      after: newText,
    });
  };

  while (oldIndex < before.length || newIndex < after.length) {
    if (before[oldIndex] === after[newIndex]) {
      push("same", before[oldIndex], after[newIndex]);
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    const anchor = findNearbyAnchor(before, after, oldIndex, newIndex);
    const oldEnd = anchor?.oldIndex ?? before.length;
    const newEnd = anchor?.newIndex ?? after.length;
    const oldChunk = before.slice(oldIndex, oldEnd);
    const newChunk = after.slice(newIndex, newEnd);
    const length = Math.max(oldChunk.length, newChunk.length);
    for (let index = 0; index < length; index += 1) {
      const oldText = oldChunk[index] ?? "";
      const newText = newChunk[index] ?? "";
      if (!oldText) push("add", "", newText);
      else if (!newText) push("remove", oldText, "");
      else push("replace", oldText, newText);
    }
    oldIndex = oldEnd;
    newIndex = newEnd;
  }
  return blocks;
}

export function changedBlockIds(blocks: SegmentedDiffBlock[]): string[] {
  return blocks
    .filter((block) => block.kind !== "same")
    .map((block) => block.id);
}

export function selectedText(
  blocks: SegmentedDiffBlock[],
  selectedIds: ReadonlySet<string>,
): string {
  return blocks
    .map((block) =>
      block.kind === "same" || selectedIds.has(block.id)
        ? block.after
        : block.before,
    )
    .filter(Boolean)
    .join("\n\n");
}

function splitParagraphs(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized
    ? normalized
        .split(/\n\s*\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function findNearbyAnchor(
  before: string[],
  after: string[],
  oldStart: number,
  newStart: number,
): { oldIndex: number; newIndex: number } | undefined {
  const oldEnd = Math.min(before.length, oldStart + 80);
  const newEnd = Math.min(after.length, newStart + 80);
  let best:
    { oldIndex: number; newIndex: number; distance: number } | undefined;
  for (let oldIndex = oldStart; oldIndex < oldEnd; oldIndex += 1) {
    for (let newIndex = newStart; newIndex < newEnd; newIndex += 1) {
      if (before[oldIndex] !== after[newIndex]) continue;
      const distance = oldIndex - oldStart + newIndex - newStart;
      if (!best || distance < best.distance)
        best = { oldIndex, newIndex, distance };
      if (distance === 0) return best;
    }
  }
  return best;
}
