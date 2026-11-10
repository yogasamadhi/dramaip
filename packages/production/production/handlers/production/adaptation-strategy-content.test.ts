import { describe, expect, it } from "vitest";
import type { CreationContent } from "@dramaip/contracts/creation";
import type { AdaptationStrategyBasis } from "@dramaip/contracts/production";
import { inspectAdaptationStrategy } from "./adaptation-strategy-content.js";
const chapterId = crypto.randomUUID();
const basis: AdaptationStrategyBasis = {
  scope: "selected-chapters",
  chapters: [
    {
      id: chapterId,
      version: 0,
      title: "明确来源",
      orderIndex: 0,
      contentHash: "a".repeat(64),
      characters: 10,
    },
  ],
  omittedChapters: [],
  rightsDeclared: true,
  target: { format: "short-drama", episodeCount: 2, durationSeconds: 90 },
  diagnosis: { id: crypto.randomUUID(), version: 1 },
  diagnosisContentHash: "b".repeat(64),
  authorIntent: { id: crypto.randomUUID(), version: 1 },
};
const diagnosis = { content: { findings: [{ id: "finding" }] } };
const output = (): CreationContent => ({
  title: "独立策略",
  content: "明确比较，未选择",
  items: [
    {
      ref: "strategy",
      kind: "adaptation-strategy",
      title: "两个不同动作",
      data: {
        summary: "保留或重排",
        options: [0, 1].map((index) => ({
          id: `option-${index}`,
          title: `方案 ${index}`,
          rationale: "保留人物动机",
          preserve: ["关系"],
          merge: [],
          remove: [],
          reorder: index ? ["前置求助行动"] : [],
          restructure: [],
          rhythm: "按动机推进",
          findingIds: ["finding"],
          risks: ["局部不代表全书"],
          productionRisk: "unknown",
          productionNotes: "需试制，不是报价",
        })),
      },
    },
  ],
});
describe("independent adaptation strategy deterministic content", () => {
  it("retains distinct actions without selecting an option or editing source", () => {
    const candidate = output();
    const original = structuredClone(candidate);
    const result = inspectAdaptationStrategy(candidate, basis, diagnosis);
    expect(result.options).toHaveLength(2);
    expect(candidate).toEqual(original);
    expect("selectedOptionId" in result).toBe(false);
  });
  it("rejects a relabelled identical action plan, including array-order disguises", () => {
    const candidate = output();
    const data = candidate.items[0]!.data as ReturnType<
      typeof inspectAdaptationStrategy
    >;
    data.options[1]!.reorder = [];
    data.options[1]!.rationale = "不同营销名称";
    expect(() =>
      inspectAdaptationStrategy(candidate, basis, diagnosis),
    ).toThrow("实际差别");
    data.options.forEach((item) => {
      item.preserve = ["甲", "乙"];
    });
    data.options[1]!.preserve.reverse();
    expect(() =>
      inspectAdaptationStrategy(candidate, basis, diagnosis),
    ).toThrow("实际差别");
  });
  it("rejects duplicate ids, invented or repeated finding ids, and model adoption claims", () => {
    for (const kind of [
      "duplicate",
      "invented",
      "repeated",
      "adoption",
    ] as const) {
      const candidate = output();
      const data = candidate.items[0]!.data as ReturnType<
        typeof inspectAdaptationStrategy
      >;
      if (kind === "duplicate") data.options[1]!.id = data.options[0]!.id;
      if (kind === "invented") data.options[1]!.findingIds = ["not-reviewed"];
      if (kind === "repeated")
        data.options[1]!.findingIds = ["finding", "finding"];
      if (kind === "adoption")
        candidate.items[0]!.data.selectedOptionId = "option-0";
      expect(() =>
        inspectAdaptationStrategy(candidate, basis, diagnosis),
      ).toThrow();
    }
  });
  it("rejects extra body/parent items and sets outside the 2–3 comparison range", () => {
    for (const kind of ["one", "four", "body", "parent", "extra"] as const) {
      const candidate = output();
      const data = candidate.items[0]!.data as ReturnType<
        typeof inspectAdaptationStrategy
      >;
      if (kind === "one") data.options.pop();
      if (kind === "four") data.options.push(...structuredClone(data.options));
      if (kind === "body") candidate.items[0]!.data.script = "不能混入正文";
      if (kind === "parent") candidate.items[0]!.parentRef = "episode";
      if (kind === "extra")
        candidate.items.push({
          ref: "episode",
          kind: "episode",
          title: "不能同时写季纲",
          data: {},
        });
      expect(() =>
        inspectAdaptationStrategy(candidate, basis, diagnosis),
      ).toThrow();
    }
  });
  it("requires the exact inherited mixed expressions and rejects invented raw declarations", () => {
    const sources: NonNullable<AdaptationStrategyBasis["sourceBasis"]> = {
      kind: "author-selected-narrative-sources",
      projectId: crypto.randomUUID(),
      chapters: [
        {
          id: chapterId,
          version: 0,
          contentHash: "a".repeat(64),
          representation: "paragraphs",
          paragraphIds: ["p1"],
        },
      ],
      omitted: [],
      references: [
        {
          sourceKind: "chapter",
          sourceId: chapterId,
          sourceVersion: 0,
          fieldPath: `/chapters/${chapterId}/paragraphs/p1`,
          contentHash: "c".repeat(64),
        },
      ],
    };
    const candidate = output();
    candidate.items[0]!.data.reviewedSources = sources.references.map(
      ({ sourceId, sourceVersion, fieldPath }) => ({
        sourceId,
        sourceVersion,
        fieldPath,
      }),
    );
    expect(
      inspectAdaptationStrategy(
        candidate,
        { ...basis, sourceBasis: sources },
        diagnosis,
      ).reviewedSources,
    ).toHaveLength(1);
    expect(() =>
      inspectAdaptationStrategy(candidate, basis, diagnosis),
    ).toThrow();
    candidate.items[0]!.data.reviewedSources = [];
    expect(() =>
      inspectAdaptationStrategy(
        candidate,
        { ...basis, sourceBasis: sources },
        diagnosis,
      ),
    ).toThrow();
  });
});
