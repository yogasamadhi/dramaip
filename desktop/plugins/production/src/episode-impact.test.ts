import { describe, expect, it } from "vitest";
import {
  StoryboardPackageContentSchema,
  type EpisodeScriptContent,
  type ScreenplayBlock,
} from "@dramaip/contracts/production";
import { inspectEpisodeImpact, type ImpactRecord } from "./episode-impact.js";

function fixture() {
  const scriptId = crypto.randomUUID();
  const types = [
    "scene_heading",
    "action",
    "character",
    "dialogue",
    "scene_heading",
    "action",
  ] as const;
  const blocks: ScreenplayBlock[] = types.map((type, index) => ({
    id: crypto.randomUUID(),
    type,
    text: `PRIVATE SCRIPT ${index}`,
  }));
  const script: EpisodeScriptContent = {
    blocks,
    sceneLinks: [
      {
        sceneId: "scene-a",
        blockIds: blocks.slice(0, 4).map((block) => block.id),
      },
      {
        sceneId: "scene-b",
        blockIds: blocks.slice(4).map((block) => block.id),
      },
    ],
  };
  const shot = (id: string, ids: string[], orderIndex = 0) => ({
    id,
    orderIndex,
    sourceBlockIds: ids,
    visualAction: "PRIVATE SHOT",
    composition: "mid",
    camera: "eye",
    movement: "still",
    durationSeconds: 10,
    sound: "none",
    prompt: "PRIVATE PROMPT",
    negativePrompt: "none",
    assetIds: ["asset-a"],
  });
  const storyboard = StoryboardPackageContentSchema.parse({
    title: "test",
    visualDirection: "night",
    productionNotes: ["test notes"],
    assets: [
      {
        id: "asset-a",
        kind: "character",
        title: "actor",
        description: "test",
        sourceBibleIds: [crypto.randomUUID()],
      },
    ],
    scenes: [
      {
        sceneId: "scene-a",
        scriptBlockIds: script.sceneLinks[0]!.blockIds,
        shots: [
          shot("shot-a", script.sceneLinks[0]!.blockIds.slice(0, 3)),
          shot("shot-b", [blocks[3]!.id], 1),
        ],
      },
      {
        sceneId: "scene-b",
        scriptBlockIds: script.sceneLinks[1]!.blockIds,
        shots: [shot("shot-c", script.sceneLinks[1]!.blockIds)],
      },
    ],
    subtitles: [],
    costRisks: [],
    externalDependencies: [],
  });
  const bindings = [
    ...storyboard.scenes.map((scene) => ({
      id: crypto.randomUUID(),
      stableId: scene.sceneId,
      kind: "scenes" as const,
      version: 0,
    })),
    ...storyboard.scenes.flatMap((scene) =>
      scene.shots.map((shot) => ({
        id: crypto.randomUUID(),
        stableId: shot.id,
        kind: "shots" as const,
        version: 0,
      })),
    ),
  ];
  const records: ImpactRecord[] = bindings.map((binding) => ({
    id: binding.id,
    kind: binding.kind,
    version: 0,
    stableId: binding.stableId,
    parentId:
      binding.kind === "scenes"
        ? scriptId
        : bindings.find(
            (item) =>
              item.stableId ===
              storyboard.scenes.find((scene) =>
                scene.shots.some((shot) => shot.id === binding.stableId),
              )!.sceneId,
          )!.id,
  }));
  return {
    frozenScript: script,
    currentBlocks: structuredClone(blocks),
    storyboard,
    bindings,
    records,
    scriptId,
    globalReviewReasons: [] as string[],
  };
}
describe("read-only actual episode impact", () => {
  it("observes removed and new formal scenes only from exact verified current manuscript mappings, never from guessed headings", () => {
    const data = fixture();
    const blocks = data.currentBlocks.slice(0, 4);
    const current = {
      blocks,
      sceneLinks: [structuredClone(data.frozenScript.sceneLinks[0]!)],
    };
    const unknown = inspectEpisodeImpact({ ...data, currentBlocks: blocks });
    expect(
      unknown.shots.every((shot) => shot.associationImpact === "unresolved"),
    ).toBe(true);
    const removed = inspectEpisodeImpact({
      ...data,
      currentBlocks: blocks,
      confirmedCurrentScript: current,
    });
    expect(removed.globalReviewReasons).toEqual([]);
    expect(removed.shots.map((shot) => shot.associationImpact)).toEqual([
      "no-observed-change",
      "no-observed-change",
      "affected",
    ]);
    expect(removed.shots[2]!.reasonCodes).toContain("scene-structure-changed");
    const newBlocks: ScreenplayBlock[] = [
      {
        id: crypto.randomUUID(),
        type: "scene_heading",
        text: "INT. NEW - NIGHT",
      },
      { id: crypto.randomUUID(), type: "action", text: "PRIVATE NEW" },
    ];
    const addedScript = {
      blocks: [...data.currentBlocks, ...newBlocks],
      sceneLinks: [
        ...structuredClone(data.frozenScript.sceneLinks),
        { sceneId: "new", blockIds: newBlocks.map((block) => block.id) },
      ],
    };
    const added = inspectEpisodeImpact({
      ...data,
      currentBlocks: addedScript.blocks,
      confirmedCurrentScript: addedScript,
    });
    expect(added.globalReviewReasons).toEqual([]);
    expect(
      added.blockChanges.filter((block) => block.kind === "added"),
    ).toHaveLength(2);
    expect(
      added.shots.every(
        (shot) => shot.associationImpact === "no-observed-change",
      ),
    ).toBe(true);
    const invalid = inspectEpisodeImpact({
      ...data,
      currentBlocks: addedScript.blocks,
      confirmedCurrentScript: current,
    });
    expect(
      invalid.shots.every((shot) => shot.associationImpact === "unresolved"),
    ).toBe(true);
    expect(JSON.stringify(removed)).not.toContain("PRIVATE");
  });
  it("keeps verified source changes visible without inventing unknown mechanical changes, while every other uncertainty still refuses localization", () => {
    const data = fixture(),
      known = "已核实际新来源人工父链，仍须完整作者审阅";
    const observed = inspectEpisodeImpact({
      ...data,
      globalReviewReasons: [known],
      confirmedSourceReviewReasons: [known],
    });
    expect(observed.globalReviewReasons).toEqual([known]);
    expect(
      observed.shots.every(
        (shot) => shot.associationImpact === "no-observed-change",
      ),
    ).toBe(true);
    for (const input of [
      { ...data, globalReviewReasons: [known, "实际读取不可用"] },
      { ...data, currentBlocks: [], globalReviewReasons: [known] },
      { ...data, records: [], globalReviewReasons: [known] },
    ]) {
      const unknown = inspectEpisodeImpact({
        ...input,
        confirmedSourceReviewReasons: [known],
      });
      expect(
        unknown.shots.every((shot) => shot.associationImpact === "unresolved"),
      ).toBe(true);
    }
    expect(JSON.stringify(observed)).not.toContain("PRIVATE");
  });
  it("supports the full 10000-block formal contract and rejects overflow without claiming unchanged associations", () => {
    const data = fixture();
    const extra: ScreenplayBlock[] = Array.from(
      { length: 9994 },
      (_, index) => ({
        id: crypto.randomUUID(),
        type: "action",
        text: `PRIVATE BOUNDARY ${index}`,
      }),
    );
    data.frozenScript.blocks.splice(4, 0, ...extra);
    data.frozenScript.sceneLinks[0]!.blockIds.push(
      ...extra.map((block) => block.id),
    );
    data.storyboard.scenes[0]!.scriptBlockIds.push(
      ...extra.map((block) => block.id),
    );
    data.storyboard.scenes[0]!.shots[0]!.sourceBlockIds.push(
      ...extra.map((block) => block.id),
    );
    data.currentBlocks = structuredClone(data.frozenScript.blocks);
    const at = performance.now();
    const boundary = inspectEpisodeImpact(data);
    expect(boundary.globalReviewReasons).toEqual([]);
    expect(boundary.blockChanges).toEqual([]);
    expect(
      boundary.shots.every(
        (shot) => shot.associationImpact === "no-observed-change",
      ),
    ).toBe(true);
    // Loose regression ceiling, not a performance SLA or benchmark claim.
    expect(performance.now() - at).toBeLessThan(10000);
    data.currentBlocks.push({
      id: crypto.randomUUID(),
      type: "action",
      text: "PRIVATE OVERFLOW",
    });
    const overflow = inspectEpisodeImpact(data);
    expect(overflow.globalReviewReasons.length).toBeGreaterThan(0);
    expect(
      overflow.shots.every((shot) => shot.associationImpact === "unresolved"),
    ).toBe(true);
  });
  it("keeps exact unchanged associations and excludes every source/shot body", () => {
    const value = inspectEpisodeImpact(fixture());
    expect(value.blockChanges).toEqual([]);
    expect(value.globalReviewReasons).toEqual([]);
    expect(value.shots.map((shot) => shot.associationImpact)).toEqual([
      "no-observed-change",
      "no-observed-change",
      "no-observed-change",
    ]);
    expect(JSON.stringify(value)).not.toContain("PRIVATE");
  });
  it("localizes an action edit to only declared referencing shots", () => {
    const data = fixture();
    data.currentBlocks[1] = {
      ...data.currentBlocks[1]!,
      type: "action",
      text: "PRIVATE EDIT",
    };
    const value = inspectEpisodeImpact(data);
    expect(value.shots.map((shot) => shot.associationImpact)).toEqual([
      "affected",
      "no-observed-change",
      "no-observed-change",
    ]);
    expect(value.shots[0]!.changedBlockIds).toEqual([
      data.currentBlocks[1]!.id,
    ]);
    expect(value.blockChanges[0]).toMatchObject({
      kind: "changed",
      fields: ["text"],
    });
    expect(value.blockChanges[0]!.beforeHash).not.toBe(
      value.blockChanges[0]!.afterHash,
    );
    expect(JSON.stringify(value)).not.toContain("PRIVATE");
  });
  it.each([0, 2])(
    "expands control block %i content changes to its entire scene, not another scene",
    (index) => {
      const data = fixture();
      data.currentBlocks[index] = {
        ...data.currentBlocks[index]!,
        type: index === 0 ? "scene_heading" : "character",
        text: "changed context",
      };
      const value = inspectEpisodeImpact(data);
      expect(value.shots.map((shot) => shot.associationImpact)).toEqual([
        "affected",
        "affected",
        "no-observed-change",
      ]);
      expect(value.shots[1]!.reasonCodes).toContain("scene-context-changed");
    },
  );
  it("marks a newly inserted action scene-wide without falsely reordering all subsequent stable blocks", () => {
    const data = fixture();
    const extra: ScreenplayBlock = {
      id: crypto.randomUUID(),
      type: "action",
      text: "new action",
    };
    data.currentBlocks.splice(2, 0, extra);
    const value = inspectEpisodeImpact(data);
    expect(value.blockChanges).toHaveLength(1);
    expect(value.blockChanges[0]).toMatchObject({
      blockId: extra.id,
      kind: "added",
      beforeHash: null,
    });
    expect(value.shots.map((shot) => shot.associationImpact)).toEqual([
      "affected",
      "affected",
      "no-observed-change",
    ]);
  });
  it("marks removed action blocks scene-wide and never drops their stable identity", () => {
    const data = fixture();
    const removed = data.currentBlocks.splice(1, 1)[0]!;
    const value = inspectEpisodeImpact(data);
    expect(value.blockChanges[0]).toMatchObject({
      blockId: removed.id,
      kind: "removed",
      afterHash: null,
    });
    expect(value.shots[1]!.reasonCodes).toContain("scene-structure-changed");
    expect(value.shots[2]!.associationImpact).toBe("no-observed-change");
  });
  it("conservatively expands reordered blocks within a scene", () => {
    const data = fixture();
    [data.currentBlocks[1], data.currentBlocks[2]] = [
      data.currentBlocks[2]!,
      data.currentBlocks[1]!,
    ];
    const value = inspectEpisodeImpact(data);
    expect(value.blockChanges.map((change) => change.kind)).toEqual([
      "reordered",
      "reordered",
    ]);
    expect(value.shots.map((shot) => shot.associationImpact)).toEqual([
      "affected",
      "affected",
      "no-observed-change",
    ]);
  });
  it("does not count parser source locations or object key order as creative changes", () => {
    const data = fixture();
    data.currentBlocks[1] = {
      text: "PRIVATE SCRIPT 1",
      type: "action",
      sourceLocation: { line: 999, column: 2 },
      id: data.currentBlocks[1]!.id,
    };
    expect(inspectEpisodeImpact(data).blockChanges).toEqual([]);
  });
  it.each([
    "new-heading",
    "removed-heading",
    "cross-scene",
    "duplicate-id",
    "missing-document",
    "broken-frozen-mapping",
  ])(
    "keeps %s uncertainty as a full-package review, never a guessed unaffected subset",
    (fault) => {
      const data = fixture();
      if (fault === "new-heading")
        data.currentBlocks.splice(2, 0, {
          id: crypto.randomUUID(),
          type: "scene_heading",
          text: "new scene",
        });
      if (fault === "removed-heading") data.currentBlocks.splice(4, 1);
      if (fault === "cross-scene")
        data.currentBlocks.push(data.currentBlocks.splice(1, 1)[0]!);
      if (fault === "duplicate-id")
        data.currentBlocks[1]!.id = data.currentBlocks[0]!.id;
      if (fault === "missing-document") data.currentBlocks = [];
      if (fault === "broken-frozen-mapping")
        data.frozenScript.sceneLinks[0]!.blockIds.reverse();
      const value = inspectEpisodeImpact(data);
      // An empty actual document is observable removal, not an unavailable one:
      // deleted headings still make the original scene mapping unresolved.
      expect(value.globalReviewReasons.length).toBeGreaterThan(0);
      expect(
        value.shots.every((shot) => shot.associationImpact === "unresolved"),
      ).toBe(true);
    },
  );
  it("localizes actual shot version changes and expands scene record changes to its children", () => {
    const data = fixture();
    data.records.find((record) => record.stableId === "shot-b")!.version++;
    let value = inspectEpisodeImpact(data);
    expect(value.shots.map((shot) => shot.associationImpact)).toEqual([
      "no-observed-change",
      "affected",
      "no-observed-change",
    ]);
    data.records.find((record) => record.stableId === "scene-b")!.version++;
    value = inspectEpisodeImpact(data);
    expect(value.shots[2]!.reasonCodes).toEqual(["scene-record-changed"]);
  });
  it.each([
    "missing",
    "foreign-parent",
    "wrong-stable-id",
    "duplicate-binding",
  ])("does not guess the version of a %s record", (fault) => {
    const data = fixture();
    const row = data.records.find((record) => record.stableId === "shot-b")!;
    if (fault === "missing")
      data.records = data.records.filter((record) => record !== row);
    if (fault === "foreign-parent") row.parentId = crypto.randomUUID();
    if (fault === "wrong-stable-id") row.stableId = "foreign-shot";
    if (fault === "duplicate-binding")
      data.bindings.push({
        ...data.bindings.find((binding) => binding.id === row.id)!,
      });
    const value = inspectEpisodeImpact(data);
    expect(value.shots[1]!.associationImpact).toBe("unresolved");
    expect(value.shots[1]!.record?.currentVersion ?? null).toBeNull();
    expect(value.shots[0]!.associationImpact).toBe("no-observed-change");
  });
  it("keeps author intent, Bible, formal head and story source changes unlocalized", () => {
    const data = fixture();
    data.globalReviewReasons = [
      "正式作者意图已变化",
      "已批准 Story Bible 集合或版本已变化",
    ];
    const value = inspectEpisodeImpact(data);
    expect(value.globalReviewReasons).toEqual(data.globalReviewReasons);
    expect(
      value.shots.every((shot) => shot.associationImpact === "unresolved"),
    ).toBe(true);
    expect(
      value.shots.every((shot) =>
        shot.reasonCodes.includes("upstream-not-localized"),
      ),
    ).toBe(true);
  });
});
