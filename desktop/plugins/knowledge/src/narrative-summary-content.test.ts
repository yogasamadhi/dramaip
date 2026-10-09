import { describe, expect, it } from "vitest";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import type { NarrativeSummaryBasis } from "@dramaip/contracts/knowledge";
import {
  summaryHash,
  inspectNarrativeSummary,
} from "./narrative-summary-content.js";

const first = { id: crypto.randomUUID(), version: 1 },
  second = { id: crypto.randomUUID(), version: 2 };
const record = { id: crypto.randomUUID(), version: 0 };
const references: AgentContextReference[] = [
  {
    sourceKind: "chapter",
    sourceId: first.id,
    sourceVersion: first.version,
    fieldPath: `/chapters/${first.id}`,
    value: { title: "不是正文依据", content: "🙂人物归还钥匙。" },
    sensitivity: "project",
  },
  {
    sourceKind: "knowledge",
    sourceId: record.id,
    sourceVersion: record.version,
    fieldPath: `/knowledge/${record.id}`,
    value: { title: "不是摘要依据", summary: "人物继续保管旧书。" },
    sensitivity: "project",
  },
];
const basis: NarrativeSummaryBasis = {
  request: {
    target: { kind: "book", id: crypto.randomUUID(), version: 0 },
    scopeFingerprint: "a".repeat(64),
    expectedHead: null,
    chapters: [
      { ...first, representation: "original" },
      { ...second, representation: "summary", record },
    ],
  },
  scopeTitle: "全书",
  directory: [
    { ...first, orderIndex: 0, contentHash: "b".repeat(64), hasContent: true },
    {
      id: crypto.randomUUID(),
      version: 0,
      orderIndex: 1,
      contentHash: "c".repeat(64),
      hasContent: false,
    },
    { ...second, orderIndex: 2, contentHash: "d".repeat(64), hasContent: true },
  ],
  references: references.map((entry, index) => ({
    chapter: index ? second : first,
    representation: index ? "summary" : "original",
    sourceKind: entry.sourceKind as "chapter" | "knowledge",
    sourceId: entry.sourceId,
    sourceVersion: entry.sourceVersion,
    fieldPath: entry.fieldPath,
    contentHash: summaryHash(entry.value),
  })),
};
const content = () => ({
  summary: "两章中人物归还钥匙，继续保管旧书；摘要仍须作者审阅。",
  coveredChapters: [first, second],
  evidence: basis.references.map((entry, index) => ({
    chapter: entry.chapter,
    sourceId: entry.sourceId,
    sourceVersion: entry.sourceVersion,
    fieldPath: entry.fieldPath,
    quote: index ? "继续保管旧书" : "🙂人物归还钥匙",
  })),
});
describe("hierarchical narrative summary provenance", () => {
  it("accepts full actual mixed original/adopted-summary coverage without pretending an empty chapter was read", () => {
    expect(inspectNarrativeSummary(content(), basis, references)).toEqual(
      content(),
    );
  });
  it("rejects prefix, reordered, repeated, old or invented chapter coverage", () => {
    for (const coveredChapters of [
      [first],
      [second, first],
      [first, first],
      [first, { ...second, version: 1 }],
      [first, second, basis.directory[1]!],
    ])
      expect(() =>
        inspectNarrativeSummary(
          { ...content(), coveredChapters },
          basis,
          references,
        ),
      ).toThrow();
  });
  it("requires exact evidence from every included chapter, not only an opening quote", () => {
    expect(() =>
      inspectNarrativeSummary(
        { ...content(), evidence: content().evidence.slice(0, 1) },
        basis,
        references,
      ),
    ).toThrow();
    expect(() =>
      inspectNarrativeSummary(
        {
          ...content(),
          evidence: [content().evidence[0], ...content().evidence],
        },
        basis,
        references,
      ),
    ).toThrow();
  });
  it("rejects metadata, guessed quotes, foreign and old reference identities", () => {
    for (const change of [
      { quote: "不是正文依据" },
      { quote: "猜测人物新能力" },
      { sourceId: crypto.randomUUID() },
      { sourceVersion: 5 },
      { fieldPath: "/chapters/not-selected" },
    ])
      expect(() =>
        inspectNarrativeSummary(
          {
            ...content(),
            evidence: [
              { ...content().evidence[0], ...change },
              content().evidence[1],
            ],
          },
          basis,
          references,
        ),
      ).toThrow();
  });
  it("does not use original prose or unselected values to validate an adopted summary quote", () => {
    expect(() =>
      inspectNarrativeSummary(
        {
          ...content(),
          evidence: [
            content().evidence[0],
            { ...content().evidence[1], quote: "🙂人物归还钥匙" },
          ],
        },
        basis,
        references,
      ),
    ).toThrow();
    expect(() =>
      inspectNarrativeSummary(
        content(),
        basis,
        references.map((entry) => ({
          ...entry,
          value: { content: "人物继续保管旧书。" },
        })),
      ),
    ).toThrow();
  });
});
