import { describe, expect, it } from "vitest";
import type {
  SeasonPlanBasis,
  SeasonPlanContent,
} from "@dramaip/contracts/production";
import {
  inspectSeasonPlanContent,
  reorderSeasonPlanContent,
} from "./season-plan-content.js";

const sourceIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const basis: SeasonPlanBasis = {
  scope: "selected-chapters",
  target: { format: "short-drama", episodeCount: 2, durationSeconds: 90 },
  rightsDeclared: true,
  chapters: sourceIds.slice(0, 2).map((id, orderIndex) => ({
    id,
    version: orderIndex,
    title: `章${orderIndex}`,
    orderIndex,
    contentHash: "a".repeat(64),
    characters: 100,
  })),
  omittedChapters: [
    {
      id: sourceIds[2]!,
      version: 2,
      title: "诊断未读章节",
      orderIndex: 2,
      contentHash: "b".repeat(64),
      characters: 100,
    },
  ],
  diagnosis: {
    id: crypto.randomUUID(),
    version: 1,
    strategyId: "chosen-reorder",
  },
  diagnosisContentHash: "c".repeat(64),
  authorIntent: { id: crypto.randomUUID(), version: 1 },
};
const content = (): SeasonPlanContent => ({
  theme: "求证与信任",
  mainConflict: "真实警告与可疑来电",
  emotionalPromise: "主动选择",
  risks: ["只涵盖本轮局部来源，不能冒充全书"],
  omittedSources: [],
  episodes: [0, 1].map((orderIndex) => ({
    id: `episode-${orderIndex}`,
    orderIndex,
    title: `第${orderIndex + 1}集`,
    logline: orderIndex === 0 ? "接到失联警告" : "主动核对通话",
    goal: "求证",
    mainConflict: "是否相信来电者",
    turningPoint: orderIndex === 0 ? "电话中断" : "线索相互矛盾",
    endingHook: orderIndex === 0 ? "留下警告" : "发现有人跟踪",
    sourceChapters: [
      {
        id: sourceIds[orderIndex]!,
        version: orderIndex,
        adaptationAction: "preserve",
        rationale: "保留已发生行动",
      },
    ],
    characterProgress: [
      {
        character: "林晚",
        before: "犹疑",
        after: "求证",
        relationshipChange: "不放弃姐姐",
      },
    ],
    plantedForeshadowing: [],
    paidOffForeshadowing: [],
    estimatedScenes: 2,
    estimatedCharacters: 2,
    durationSeconds: 90,
    productionRisk: "unknown",
    productionNotes: "尚需实际试制，不是报价",
  })),
});

describe("formal season plan deterministic content foundation", () => {
  it("mixed plans declare all exact expressions and human reorder preserves them, while raw plans cannot invent declarations", () => {
    const sourceBasis: NonNullable<SeasonPlanBasis["sourceBasis"]> = {
      kind: "author-selected-narrative-sources",
      projectId: crypto.randomUUID(),
      omitted: [],
      chapters: basis.chapters.map(({ id, version, contentHash }) => ({
        id,
        version,
        contentHash,
        representation: "original",
      })),
      references: basis.chapters.map(({ id, version }) => ({
        sourceKind: "chapter",
        sourceId: id,
        sourceVersion: version,
        fieldPath: `/chapters/${id}`,
        contentHash: "d".repeat(64),
      })),
    };
    const mixed = { ...basis, sourceBasis };
    const reviewedSources = sourceBasis.references.map(
      ({ sourceId, sourceVersion, fieldPath }) => ({
        sourceId,
        sourceVersion,
        fieldPath,
      }),
    );
    expect(inspectSeasonPlanContent(content(), mixed).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "实际表达" }),
      ]),
    );
    for (const reviewed of [
      reviewedSources.slice(0, 1),
      [reviewedSources[0]!, reviewedSources[0]!],
      reviewedSources.map((item) => ({ ...item, sourceVersion: 9 })),
    ])
      expect(
        inspectSeasonPlanContent(
          { ...content(), reviewedSources: reviewed },
          mixed,
        ).issues,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: "实际表达" }),
        ]),
      );
    const value = { ...content(), reviewedSources };
    expect(inspectSeasonPlanContent(value, mixed).issues).toEqual([]);
    const reordered = reorderSeasonPlanContent(value, [
      "episode-1",
      "episode-0",
    ]);
    expect(reordered.reviewedSources).toEqual(reviewedSources);
    expect(inspectSeasonPlanContent(reordered, mixed).issues).toEqual([]);
    expect(inspectSeasonPlanContent(value, basis).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "实际表达" }),
      ]),
    );
  });
  it("rejects contradictory full-book or overlapping frozen scope claims", () => {
    expect(
      inspectSeasonPlanContent(content(), { ...basis, scope: "whole-book" })
        .issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "全书基准不能同时包含诊断未覆盖章节。",
        }),
      ]),
    );
    expect(
      inspectSeasonPlanContent(content(), {
        ...basis,
        omittedChapters: [...basis.omittedChapters, basis.chapters[0]!],
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "同一章节不能同时属于诊断已读与未覆盖范围。",
        }),
      ]),
    );
    expect(
      inspectSeasonPlanContent(content(), {
        ...basis,
        scope: "whole-book",
        omittedChapters: [],
      }).issues,
    ).toEqual([]);
  });
  it("derives real chapter-version coverage in episode order without expanding a partial diagnosis", () => {
    const value = content();
    const result = inspectSeasonPlanContent(
      { ...value, coverage: "100% WHOLE BOOK" },
      basis,
    );
    expect(result.issues).toEqual([]);
    expect(result.coverage).toEqual(
      sourceIds.slice(0, 2).map((chapterId, chapterVersion) => ({
        chapterId,
        chapterVersion,
        episodeIds: [`episode-${chapterVersion}`],
        disposition: "used",
      })),
    );
    expect(result.content).not.toHaveProperty("coverage");
    expect(
      result.coverage.some((item) => item.chapterId === sourceIds[2]),
    ).toBe(false);
    expect(value).toEqual(content());
  });
  it("requires every frozen source to be used or explicitly omitted; omission is not coverage", () => {
    const value = content();
    value.episodes[1]!.sourceChapters = [...value.episodes[0]!.sourceChapters];
    expect(inspectSeasonPlanContent(value, basis).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: "来源覆盖" }),
      ]),
    );
    value.omittedSources = [
      { id: sourceIds[1]!, version: 1, reason: "按所选策略删去支线" },
    ];
    const result = inspectSeasonPlanContent(value, basis);
    expect(result.issues).toEqual([]);
    expect(result.coverage[0]!.episodeIds).toEqual(["episode-0", "episode-1"]);
    expect(result.coverage[1]).toMatchObject({
      disposition: "omitted",
      episodeIds: [],
      omissionReason: "按所选策略删去支线",
    });
  });
  it("rejects foreign, unselected, old-version and internally duplicated chapter references", () => {
    for (const source of [
      { id: crypto.randomUUID(), version: 0 },
      { id: sourceIds[2]!, version: 2 },
      { id: sourceIds[0]!, version: 9 },
    ]) {
      const value = content();
      value.episodes[0]!.sourceChapters[0] = {
        ...value.episodes[0]!.sourceChapters[0]!,
        ...source,
      };
      expect(
        inspectSeasonPlanContent(value, basis).issues.some((item) =>
          item.message.includes("冻结诊断范围或版本"),
        ),
      ).toBe(true);
    }
    const value = content();
    value.episodes[0]!.sourceChapters.push({
      ...value.episodes[0]!.sourceChapters[0]!,
    });
    expect(
      inspectSeasonPlanContent(value, basis).issues.some((item) =>
        item.message.includes("重复引用"),
      ),
    ).toBe(true);
  });
  it("rejects inconsistent or duplicated omissions, duplicate episode identities and repeated beats", () => {
    const value = content();
    value.omittedSources = [0, 1].map(() => ({
      id: sourceIds[0]!,
      version: 0,
      reason: "删去",
    }));
    expect(
      inspectSeasonPlanContent(value, basis).issues.map((item) => item.message),
    ).toEqual(
      expect.arrayContaining([
        "同一来源不能同时标为已使用与已删减。",
        "同一章节的遗漏说明重复。",
      ]),
    );
    value.episodes[1] = { ...value.episodes[0]!, orderIndex: 1 };
    expect(
      inspectSeasonPlanContent(value, basis).issues.map(
        (item) => item.location,
      ),
    ).toEqual(expect.arrayContaining(["分集标识", "分集 episode-0"]));
    value.episodes[1] = {
      ...value.episodes[0]!,
      id: "renamed",
      title: "只有名字不同",
      orderIndex: 1,
    };
    expect(
      inspectSeasonPlanContent(value, basis).issues.some((item) =>
        item.message.includes("核心节拍完全重复"),
      ),
    ).toBe(true);
  });
  it("requires the frozen count/duration and an explicit contiguous saved order", () => {
    const value = content();
    value.episodes.pop();
    value.episodes[0]!.orderIndex = 7;
    value.episodes[0]!.durationSeconds = 120;
    expect(
      inspectSeasonPlanContent(value, basis).issues.map(
        (item) => item.location,
      ),
    ).toEqual(
      expect.arrayContaining(["整季集数", "分集顺序", "分集 episode-0"]),
    );
    expect(inspectSeasonPlanContent({ episodes: [] }, basis)).toMatchObject({
      coverage: [],
      issues: [expect.objectContaining({ source: "rule", severity: "error" })],
    });
  });
  it("full-list reorder preserves stable ids, all content and original snapshot; invalid orders fail", () => {
    const value = content();
    const reordered = reorderSeasonPlanContent(value, [
      "episode-1",
      "episode-0",
    ]);
    expect(
      reordered.episodes.map((item) => [item.id, item.orderIndex]),
    ).toEqual([
      ["episode-1", 0],
      ["episode-0", 1],
    ]);
    expect(reordered.episodes[0]).toEqual({
      ...value.episodes[1]!,
      orderIndex: 0,
    });
    expect(inspectSeasonPlanContent(reordered, basis).issues).toEqual([]);
    expect(value).toEqual(content());
    for (const ids of [
      [],
      ["episode-0"],
      ["episode-0", "episode-0"],
      ["episode-0", "foreign"],
      ["episode-0", "episode-1", "extra"],
    ])
      expect(() => reorderSeasonPlanContent(value, ids)).toThrow();
  });
});
