import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import type { AgentContextEntry } from "@dramaip/contracts/agent-context";
import type { StoryboardAttributionLink } from "@dramaip/contracts/production";
import { canonicalStoryNodeReferenceJSON } from "@dramaip/contracts/knowledge";
import {
  attributionImpactState,
  compareAttributionQuote,
} from "./storyboard-attribution-impact-content.js";
import { storyboardAttributionHash } from "./storyboard-attribution-content.js";

const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
function sample(
  kind: "chapter" | "knowledge" | "production" | "project" = "chapter",
) {
  const quote = "😀原句",
    prose = `${quote}中间${quote}结尾`;
  const start = prose.lastIndexOf(quote),
    end = start + quote.length;
  const value =
    kind === "chapter"
      ? {
          representation: "paragraphs",
          paragraphId: "p-1",
          start: 12,
          end: 12 + prose.length,
          content: prose,
        }
      : kind === "knowledge"
        ? { summary: prose }
        : kind === "project"
          ? { content: { synopsis: prose } }
          : { blocks: [{ id: id(2), type: "action", text: prose }] };
  const source = {
    sourceKind: kind,
    sourceId: id(1),
    sourceVersion: 2,
    fieldPath:
      kind === "chapter"
        ? `/chapters/${id(1)}/paragraphs/p-1`
        : `/source/${id(1)}`,
    contentHash: sha(JSON.stringify(value)),
  };
  const link: StoryboardAttributionLink = {
    sceneId: "scene-1",
    shotId: "shot-1",
    blockIds: [id(3)],
    evidenceId: "quote-1",
    matchIndex: 1,
    evidence: {
      sceneId: "scene-1",
      evidenceId: "quote-1",
      source,
      valuePath:
        kind === "knowledge"
          ? "/summary"
          : kind === "project"
            ? "/content/synopsis"
            : kind === "production"
              ? "/blocks/0/text"
              : "/content",
      quoteHash: sha(quote),
      quoteCharacters: quote.length,
      offsetUnit: "utf16-code-unit",
      match: {
        start,
        end,
        ...(kind === "chapter"
          ? { chapterStart: start + 12, chapterEnd: end + 12 }
          : {}),
      },
      ...(kind === "chapter" ? { paragraphId: "p-1" } : {}),
      ...(kind === "production" ? { sourceBlockId: id(2) } : {}),
      attribution: "model-declared",
      matchVerification: "rule",
      semanticVerification: "unverified",
    },
    attribution: "human-declared",
    matchVerification: "rule",
    semanticVerification: "unverified",
  };
  const entry = { ...source, included: true, value } as Pick<
    AgentContextEntry,
    | "included"
    | "sourceKind"
    | "sourceId"
    | "sourceVersion"
    | "fieldPath"
    | "value"
  >;
  const text = kind === "chapter" ? "x".repeat(12) + prose : prose;
  return { link, entry, text, quote, prose };
}
describe("exact original attribution impact comparison", () => {
  for (const kind of [
    "chapter",
    "knowledge",
    "production",
    "project",
  ] as const) {
    test(`actual ${kind} expression compares the explicit second UTF-16 position and never returns text`, () => {
      const { link, entry, text, quote } = sample(kind);
      const result = compareAttributionQuote({
        link,
        frozenEntries: [entry],
        current: {
          readState: "available",
          version: 2,
          text,
          ...(kind === "production"
            ? { sourceBlock: { id: id(2), index: 0, type: "action" } }
            : {}),
          ...(kind === "chapter"
            ? {
                paragraph: {
                  id: "p-1",
                  present: true,
                  start: 12,
                  end: 12 + sample(kind).prose.length,
                },
              }
            : {}),
        },
      });
      expect(result.quote.frozenVerified).toBe(true);
      expect(result.quote.comparison).toBe("same-position-match");
      expect(result.reasonCodes).toEqual([]);
      expect(link.matchIndex).toBe(1);
      expect(JSON.stringify(result)).not.toContain(quote);
      expect(result.quote).not.toHaveProperty("text");
      expect(attributionImpactState(result.reasonCodes)).toBe(
        "no-observed-change",
      );
    });
  }
  test("current version drift remains an impact even with the same literal at the original position", () => {
    const { link, entry, text } = sample("knowledge");
    const result = compareAttributionQuote({
      link,
      frozenEntries: [entry],
      current: { readState: "available", version: 3, text },
    });
    expect(result.quote.comparison).toBe("same-position-match");
    expect(result.reasonCodes).toEqual(["source-version-changed"]);
    expect(attributionImpactState(result.reasonCodes)).toBe("affected");
  });
  test("inserting a prefix does not rematch a later identical quote or change original second occurrence", () => {
    const { link, entry, text } = sample("knowledge");
    const original = structuredClone(link);
    const result = compareAttributionQuote({
      link,
      frozenEntries: [entry],
      current: { readState: "available", version: 3, text: "移位" + text },
    });
    expect(result.quote.comparison).toBe("position-changed");
    expect(result.reasonCodes).toContain("quote-position-changed");
    expect(link).toEqual(original);
  });
  test("missing/duplicate/wrong frozen entries remain unknown, never historic quote proof", () => {
    const { link, entry, text } = sample("knowledge");
    for (const frozenEntries of [
      undefined,
      [],
      [entry, entry],
      [{ ...entry, value: { summary: text + "private extra" } }],
    ]) {
      const result = compareAttributionQuote({
        link,
        frozenEntries,
        current: { readState: "available", version: 2, text },
      });
      expect(result.quote.frozenVerified).toBe(false);
      expect(result.quote.comparison).toBe("unverified");
      expect(result.reasonCodes).toContain("original-source-unverified");
      expect(attributionImpactState(result.reasonCodes)).toBe("unresolved");
    }
  });
  test("an owner outage retains unknown without a cached expression or guessed missing identity", () => {
    const { link, entry } = sample("knowledge");
    const result = compareAttributionQuote({
      link,
      frozenEntries: [entry],
      current: { readState: "unavailable", version: null },
    });
    expect(result.quote).toMatchObject({
      readState: "unavailable",
      comparison: "unavailable",
      expressionHash: null,
      currentSliceHash: null,
      currentSourceVersion: null,
    });
    expect(result.reasonCodes).toEqual(["source-read-unavailable"]);
  });
  test("stable source block reordered does not change quote position or follow a different block", () => {
    const { link, entry, text } = sample("production");
    const result = compareAttributionQuote({
      link,
      frozenEntries: [entry],
      current: {
        readState: "available",
        version: 2,
        text,
        sourceBlock: { id: id(2), index: 4, type: "action" },
      },
    });
    expect(result.quote.comparison).toBe("same-position-match");
    expect(result.reasonCodes).toEqual(["source-block-reordered"]);
    expect(result.quote.sourceBlock?.id).toBe(link.evidence.sourceBlockId);
  });
  test("the same source block with an actual non-expression type retains known type/order drift and unknown expression qualification", () => {
    const { link, entry } = sample("production");
    const result = compareAttributionQuote({
      link,
      frozenEntries: [entry],
      current: {
        readState: "unverified",
        version: 3,
        sourceBlock: { id: id(2), index: 4, type: "note" },
      },
    });
    expect(result.quote.comparison).toBe("unverified");
    expect(result.reasonCodes).toContain("source-expression-unverified");
    expect(result.reasonCodes).toContain("source-block-type-changed");
    expect(result.reasonCodes).toContain("source-block-reordered");
    expect(result.reasonCodes).not.toContain("source-block-missing");
    expect(attributionImpactState(result.reasonCodes)).toBe("unresolved");
  });
  test("node reference canonical serializer exactly matches the already persisted attribution hash regardless of insertion order", () => {
    const reference = {
      value: {
        statement: "PRIVATE never emitted",
        z: 5,
        a: [{ d: true, a: 1 }],
      },
      policyDependencies: [
        { fieldPath: "/x", sourceVersion: 0, sourceId: id(1) },
      ],
      sourceKind: "knowledge",
      sourceId: id(2),
      sourceVersion: 1,
      fieldPath: "/declaration",
      sensitivity: "project",
    };
    const actual = sha(canonicalStoryNodeReferenceJSON(reference));
    expect(actual).toBe(storyboardAttributionHash(reference));
    expect(actual).toBe(
      sha(
        canonicalStoryNodeReferenceJSON({
          ...reference,
          value: {
            a: reference.value.a,
            z: 5,
            statement: reference.value.statement,
          },
        }),
      ),
    );
  });
});
