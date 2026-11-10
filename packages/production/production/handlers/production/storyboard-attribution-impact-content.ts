import { createHash } from "node:crypto";
import type { AgentContextEntry } from "@dramaip/contracts/agent-context";
import type {
  StoryboardAttributionLink,
  StoryboardAttributionImpactLink,
  StoryboardAttributionImpactReason,
} from "@dramaip/contracts/production";
export { attributionImpactState } from "@dramaip/contracts/production";

const textHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const valueHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const attributionExpressionKey = (ref: {
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  fieldPath: string;
}) =>
  JSON.stringify([
    ref.sourceKind,
    ref.sourceId,
    ref.sourceVersion,
    ref.fieldPath,
  ]);
/** Private actual owner input; only hashes/positions are returned. Text is never a report field. */
export interface AttributionExpressionRead {
  readState: "available" | "missing" | "unavailable" | "unverified";
  version: number | null;
  text?: string;
  sourceBlock?: NonNullable<
    StoryboardAttributionImpactLink["quote"]["sourceBlock"]
  >;
  paragraph?: NonNullable<
    StoryboardAttributionImpactLink["quote"]["paragraph"]
  >;
}
export function compareAttributionQuote(input: {
  link: StoryboardAttributionLink;
  frozenEntries:
    | readonly Pick<
        AgentContextEntry,
        | "included"
        | "sourceKind"
        | "sourceId"
        | "sourceVersion"
        | "fieldPath"
        | "value"
      >[]
    | undefined;
  current: AttributionExpressionRead;
}): {
  quote: StoryboardAttributionImpactLink["quote"];
  reasonCodes: StoryboardAttributionImpactReason[];
} {
  const { evidence } = input.link;
  const entries = input.frozenEntries?.filter(
    (entry) =>
      entry.included &&
      attributionExpressionKey(entry) ===
        attributionExpressionKey(evidence.source),
  );
  const entry = entries?.length === 1 ? entries[0] : undefined;
  const value = object(entry?.value);
  let original: unknown, frozenBlockIndex: number | undefined;
  if (
    evidence.source.sourceKind === "chapter" &&
    evidence.valuePath === "/content"
  )
    original = value.content;
  else if (
    evidence.source.sourceKind === "knowledge" &&
    evidence.valuePath === "/summary"
  )
    original = value.summary;
  else if (
    evidence.source.sourceKind === "project" &&
    ["/content/synopsis", "/content/productionBrief"].includes(
      evidence.valuePath,
    )
  )
    original = object(value.content)[
      evidence.valuePath.slice("/content/".length)
    ];
  else if (evidence.source.sourceKind === "production") {
    if (evidence.valuePath === "/content") original = value.content;
    else {
      const index = /^\/blocks\/(0|[1-9]\d*)\/text$/u.exec(evidence.valuePath);
      frozenBlockIndex = index ? Number(index[1]) : undefined;
      const block =
        frozenBlockIndex !== undefined && Array.isArray(value.blocks)
          ? object(value.blocks[frozenBlockIndex])
          : {};
      if (
        block.id === evidence.sourceBlockId &&
        ["action", "dialogue"].includes(String(block.type))
      )
        original = block.text;
    }
  }
  const paragraph =
    evidence.source.sourceKind === "chapter" &&
    value.representation === "paragraphs";
  const start = evidence.match.start,
    end = evidence.match.end;
  const validChapter =
    evidence.source.sourceKind !== "chapter" ||
    (evidence.match.chapterStart ===
      start + (paragraph ? Number(value.start) : 0) &&
      evidence.match.chapterEnd ===
        end + (paragraph ? Number(value.start) : 0) &&
      (!paragraph ||
        (value.paragraphId === evidence.paragraphId &&
          typeof original === "string" &&
          Number.isInteger(value.start) &&
          Number.isInteger(value.end) &&
          Number(value.start) >= 0 &&
          Number(value.end) - Number(value.start) === original.length &&
          evidence.source.fieldPath ===
            `/chapters/${evidence.source.sourceId}/paragraphs/${encodeURIComponent(evidence.paragraphId!)}`)));
  const frozenVerified = Boolean(
    entry &&
    valueHash(entry.value) === evidence.source.contentHash &&
    typeof original === "string" &&
    end - start === evidence.quoteCharacters &&
    end <= original.length &&
    textHash(original.slice(start, end)) === evidence.quoteHash &&
    validChapter,
  );
  const current = input.current;
  const hasText =
    current.readState === "available" && typeof current.text === "string";
  const absoluteStart =
    evidence.source.sourceKind === "chapter"
      ? evidence.match.chapterStart
      : start;
  const absoluteEnd =
    evidence.source.sourceKind === "chapter" ? evidence.match.chapterEnd : end;
  const currentSliceHash =
    hasText &&
    absoluteStart !== undefined &&
    absoluteEnd !== undefined &&
    absoluteEnd <= current.text!.length
      ? textHash(current.text!.slice(absoluteStart, absoluteEnd))
      : null;
  const comparison = !frozenVerified
    ? "unverified"
    : current.readState === "unavailable"
      ? "unavailable"
      : current.readState === "missing"
        ? "missing"
        : !hasText
          ? "unverified"
          : currentSliceHash === evidence.quoteHash
            ? "same-position-match"
            : "position-changed";
  const reasonCodes: StoryboardAttributionImpactReason[] = [];
  if (!frozenVerified) reasonCodes.push("original-source-unverified");
  if (current.readState === "unavailable")
    reasonCodes.push("source-read-unavailable");
  if (current.readState === "missing") reasonCodes.push("source-missing");
  if (
    current.readState === "unverified" ||
    (current.readState === "available" && !hasText)
  )
    reasonCodes.push("source-expression-unverified");
  if (
    current.version !== null &&
    current.version !== evidence.source.sourceVersion
  )
    reasonCodes.push("source-version-changed");
  if (frozenVerified && hasText && currentSliceHash !== evidence.quoteHash)
    reasonCodes.push("quote-position-changed");
  if (evidence.sourceBlockId && current.readState !== "unavailable") {
    if (!current.sourceBlock) {
      if (current.readState === "missing")
        reasonCodes.push("source-block-missing");
    } else {
      if (current.sourceBlock.index !== frozenBlockIndex)
        reasonCodes.push("source-block-reordered");
      if (!["action", "dialogue"].includes(current.sourceBlock.type))
        reasonCodes.push("source-block-type-changed");
    }
  }
  if (evidence.paragraphId && current.paragraph) {
    if (!current.paragraph.present)
      reasonCodes.push("source-paragraph-missing");
    else if (
      current.paragraph.start !== value.start ||
      current.paragraph.end !== value.end
    )
      reasonCodes.push("source-paragraph-position-changed");
  }
  return {
    quote: {
      frozenVerified,
      readState: current.readState,
      currentSourceVersion: current.version,
      expressionHash: hasText ? textHash(current.text!) : null,
      currentSliceHash,
      comparison,
      sourceBlock: current.sourceBlock ?? null,
      paragraph: current.paragraph ?? null,
    },
    reasonCodes,
  };
}
