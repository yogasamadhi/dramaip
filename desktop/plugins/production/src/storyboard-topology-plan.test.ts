import { describe, expect, it } from "vitest";
import {
  EpisodeOutlineContentSchema,
  EpisodeScriptContentSchema,
  StoryboardPackageContentSchema,
  StoryboardTopologyPlanRequestSchema,
  type StoryboardTopologyPlanRequest,
  type EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import {
  freezeStoryboardTopologyPlan,
  inspectStoryboardTopologyPlan,
} from "./storyboard-topology-plan.js";

function fixture() {
  const chapter = { id: crypto.randomUUID(), version: 0 },
    bibleId = crypto.randomUUID();
  const oldIds = ["first", "removed", "last"],
    newSceneId = crypto.randomUUID(),
    newShotId = crypto.randomUUID();
  const scene = (id: string, orderIndex: number) => ({
    id,
    orderIndex,
    location: id,
    timeOfDay: "夜",
    goal: `${id} 求证`,
    conflict: "不能预知未知",
    outcome: `${id} 行动`,
    characters: ["林晚"],
    durationSeconds: 30,
    sourceChapters: [chapter],
    beats: [
      { id: `beat-${id}`, action: `${id}实际行动`, causalLink: "明确因果" },
    ],
  });
  const previousOutline = EpisodeOutlineContentSchema.parse({
    title: "原大纲",
    logline: "求证",
    goal: "求证",
    mainConflict: "未知",
    turningPoint: "行动",
    endingHook: "未知",
    scenes: oldIds.map(scene),
  });
  const blocks = oldIds.flatMap((id) => [
    {
      id: crypto.randomUUID(),
      type: "scene_heading" as const,
      text: `INT. ${id} - NIGHT`,
    },
    {
      id: crypto.randomUUID(),
      type: "action" as const,
      text: `${id} 私人作者原文`,
    },
  ]);
  const previousScript = EpisodeScriptContentSchema.parse({
    blocks,
    sceneLinks: oldIds.map((sceneId, index) => ({
      sceneId,
      blockIds: blocks.slice(index * 2, index * 2 + 2).map((block) => block.id),
    })),
  });
  const shot = (id: string, blockIds: string[]) => ({
    id,
    orderIndex: 0,
    sourceBlockIds: blockIds,
    visualAction: `PRIVATE ${id}`,
    composition: "中景",
    camera: "平视",
    movement: "固定",
    durationSeconds: 30,
    sound: "环境音",
    prompt: `PRIVATE PROMPT ${id}`,
    negativePrompt: "不含额外人物",
    assetIds: ["character"],
  });
  const base = StoryboardPackageContentSchema.parse({
    title: "原包",
    visualDirection: "现实",
    productionNotes: ["不是质量证明"],
    assets: [
      {
        id: "character",
        kind: "character",
        title: "林晚",
        description: "原正式资产",
        sourceBibleIds: [bibleId],
      },
    ],
    scenes: previousScript.sceneLinks.map((link) => ({
      sceneId: link.sceneId,
      scriptBlockIds: link.blockIds,
      shots: [shot(`shot-${link.sceneId}`, link.blockIds)],
    })),
    subtitles: [],
    costRisks: [
      {
        severity: "low",
        reason: "原待核验风险",
        mitigation: "明确审阅",
        shotIds: oldIds.map((id) => `shot-${id}`),
      },
    ],
    externalDependencies: ["原依赖"],
  });
  const bindings: NonNullable<EpisodeDevelopmentResult["productionRecords"]> =
    base.scenes.flatMap((scene) => [
      {
        id: crypto.randomUUID(),
        stableId: scene.sceneId,
        kind: "scenes" as const,
        version: 1,
      },
      ...scene.shots.map((shot) => ({
        id: crypto.randomUUID(),
        stableId: shot.id,
        kind: "shots" as const,
        version: 2,
      })),
    ]);
  const ref = (stableId: string) => {
    const record = bindings.find((binding) => binding.stableId === stableId)!;
    return { recordId: record.id, version: record.version };
  };
  const outline = structuredClone(previousOutline);
  outline.scenes[1] = scene(newSceneId, 1);
  const newBlocks = [
    {
      id: crypto.randomUUID(),
      type: "scene_heading" as const,
      text: "INT. 作者新场景 - NIGHT",
    },
    {
      id: crypto.randomUUID(),
      type: "action" as const,
      text: "作者明确新增行动",
    },
  ];
  const script = EpisodeScriptContentSchema.parse({
    blocks: [...blocks.slice(0, 2), ...newBlocks, ...blocks.slice(4)],
    sceneLinks: [
      previousScript.sceneLinks[0],
      { sceneId: newSceneId, blockIds: newBlocks.map((block) => block.id) },
      previousScript.sceneLinks[2],
    ],
  });
  const request: StoryboardTopologyPlanRequest = {
    format: "author-scene-topology-plan-v1",
    scenes: [
      {
        sceneId: "first",
        orderIndex: 0,
        durationSeconds: 30,
        mode: "retain",
        retains: ref("first"),
        shots: [
          {
            id: "shot-first",
            orderIndex: 0,
            durationSeconds: 30,
            assetIds: ["character"],
            retains: ref("shot-first"),
          },
        ],
      },
      {
        sceneId: newSceneId,
        orderIndex: 1,
        durationSeconds: 30,
        mode: "generate",
        shots: [
          {
            id: newShotId,
            orderIndex: 0,
            durationSeconds: 30,
            assetIds: ["character"],
          },
        ],
      },
      {
        sceneId: "last",
        orderIndex: 2,
        durationSeconds: 30,
        mode: "retain",
        retains: ref("last"),
        shots: [
          {
            id: "shot-last",
            orderIndex: 0,
            durationSeconds: 30,
            assetIds: ["character"],
            retains: ref("shot-last"),
          },
        ],
      },
    ],
    retiredScenes: [{ sceneId: "removed", ...ref("removed") }],
    retiredShots: [{ shotId: "shot-removed", ...ref("shot-removed") }],
  };
  const input = {
    request,
    base,
    bindings,
    previousOutline,
    previousScript,
    outline,
    script,
    reservedSceneIds: oldIds,
    reservedShotIds: oldIds.map((id) => `shot-${id}`),
  };
  const patch = {
    format: "selected-scene-topology-plan-v1",
    shots: [shot(newShotId, script.sceneLinks[1]!.blockIds)],
    subtitles: [],
    costRisks: [],
  };
  return { input, request, patch, ref, newSceneId, newShotId, bibleId };
}
describe("author scene topology mechanical plan (not Runtime admission)", () => {
  it("freezes all real old/new identities and explicit retirement without selecting or copying retained private expressions into generated scope", () => {
    const data = fixture(),
      frozen = freezeStoryboardTopologyPlan(data.input);
    expect(frozen).toMatchObject({
      selectedScenes: [{ sceneId: "removed", ...data.ref("removed") }],
      selectedShots: [{ shotId: "shot-removed", ...data.ref("shot-removed") }],
      semanticVerification: "unverified",
    });
    expect(JSON.stringify(frozen)).not.toMatch(/PRIVATE|私人作者|PROMPT/u);
    const before = structuredClone(data.input),
      output = inspectStoryboardTopologyPlan(
        data.patch,
        data.input.base,
        frozen.request,
        data.input.outline,
        data.input.script,
        [data.bibleId],
      );
    expect(output.scenes[0]).toEqual(data.input.base.scenes[0]);
    expect(output.scenes[2]).toEqual(data.input.base.scenes[2]);
    expect(output.scenes[1]?.sceneId).toBe(data.newSceneId);
    expect(output.scenes[1]?.shots[0]?.id).toBe(data.newShotId);
    expect(output.costRisks[0]?.shotIds).toEqual(["shot-first", "shot-last"]);
    expect(output.visualDirection).toBe(data.input.base.visualDirection);
    expect(output.assets).toEqual(data.input.base.assets);
    expect(output.externalDependencies).toEqual(
      data.input.base.externalDependencies,
    );
    expect(data.input).toEqual(before);
  });
  it.each([
    "missing-retired-scene",
    "missing-retired-shot",
    "retirement-version",
    "retained-version",
    "unknown-scene",
    "historic-scene",
    "historic-shot",
    "cross-scene-block",
    "cross-scene-shot",
    "duration",
    "changed-retained-text",
    "changed-retained-outline",
    "changed-retained-order",
    "missing-binding",
    "new-asset",
  ] as const)(
    "rejects %s without relaxing the old/new mechanical scope",
    (fault) => {
      const data = fixture(),
        { input } = data;
      if (fault === "missing-retired-scene") input.request.retiredScenes = [];
      if (fault === "missing-retired-shot") input.request.retiredShots = [];
      if (fault === "retirement-version")
        input.request.retiredShots[0]!.version++;
      if (fault === "retained-version")
        input.request.scenes[0]!.retains!.version++;
      if (fault === "unknown-scene")
        input.request.scenes[1]!.sceneId = crypto.randomUUID();
      if (fault === "historic-scene")
        input.reservedSceneIds.push(data.newSceneId);
      if (fault === "historic-shot") input.reservedShotIds.push(data.newShotId);
      if (fault === "cross-scene-block") {
        input.script.blocks[2] = input.previousScript.blocks[2]!;
        input.script.sceneLinks[1]!.blockIds[0] = input.script.blocks[2]!.id;
      }
      if (fault === "cross-scene-shot")
        input.request.scenes[1]!.shots[0] = {
          ...input.request.scenes[0]!.shots[0]!,
        };
      if (fault === "duration")
        input.request.scenes[1]!.shots[0]!.durationSeconds++;
      if (fault === "changed-retained-text") {
        const block = input.script.blocks[1]!;
        if ("text" in block) block.text += "实际新稿";
      }
      if (fault === "changed-retained-outline")
        input.outline.scenes[0]!.goal += "人工新目标";
      if (fault === "changed-retained-order") {
        input.request.scenes[0]!.orderIndex = 2;
      }
      if (fault === "missing-binding") input.bindings.pop();
      if (fault === "new-asset")
        input.request.scenes[1]!.shots[0]!.assetIds.push("unknown");
      expect(() => freezeStoryboardTopologyPlan(input)).toThrow();
    },
  );
  it.each([
    "extra-retained-output",
    "retired-output",
    "changed-duration",
    "cross-block",
    "retained-risk",
    "extra-protocol-field",
  ] as const)(
    "rejects model %s instead of reconstructing a false complete proposal",
    (fault) => {
      const data = fixture(),
        frozen = freezeStoryboardTopologyPlan(data.input);
      if (fault === "extra-retained-output")
        data.patch.shots.push(data.input.base.scenes[0]!.shots[0]!);
      if (fault === "retired-output") data.patch.shots[0]!.id = "shot-removed";
      if (fault === "changed-duration") data.patch.shots[0]!.durationSeconds++;
      if (fault === "cross-block")
        data.patch.shots[0]!.sourceBlockIds.push(
          data.input.previousScript.blocks[0]!.id,
        );
      const patch: unknown =
        fault === "extra-protocol-field"
          ? { ...data.patch, assets: data.input.base.assets }
          : fault === "retained-risk"
            ? { ...data.patch, costRisks: data.input.base.costRisks }
            : data.patch;
      expect(() =>
        inspectStoryboardTopologyPlan(
          patch,
          data.input.base,
          frozen.request,
          data.input.outline,
          data.input.script,
          [data.bibleId],
        ),
      ).toThrow();
    },
  );
  it("requires real topology change and an independent protocol instead of a permissive replacement for the old shot plan", () => {
    const data = fixture();
    const input = {
      ...data.input,
      outline: data.input.previousOutline,
      script: data.input.previousScript,
      request: {
        ...data.request,
        retiredScenes: [],
        retiredShots: [],
        scenes: data.input.base.scenes.map((scene, orderIndex) => ({
          sceneId: scene.sceneId,
          orderIndex,
          durationSeconds: 30,
          mode: "retain",
          retains: data.ref(scene.sceneId),
          shots: scene.shots.map((shot) => ({
            id: shot.id,
            orderIndex: shot.orderIndex,
            durationSeconds: shot.durationSeconds,
            assetIds: shot.assetIds,
            retains: data.ref(shot.id),
          })),
        })),
      },
    };
    expect(() => freezeStoryboardTopologyPlan(input)).toThrow("没有变化");
    expect(
      StoryboardTopologyPlanRequestSchema.safeParse({
        ...data.request,
        format: "author-scene-shot-plan-v1",
      }).success,
    ).toBe(false);
  });
});
