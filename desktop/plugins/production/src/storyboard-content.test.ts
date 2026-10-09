import { describe, expect, it } from "vitest";
import {
  StoryboardPackageContentSchema,
  StoryboardRedoReceiptSchema,
  type EpisodeOutlineContent,
  type EpisodeScriptContent,
  type StoryboardRedoReceipt,
} from "@dramaip/contracts/production";
import { inspectStoryboardContent } from "./storyboard-content.js";
import { inspectStoryboardRedo } from "./storyboard-redo.js";
import { confirmedStoryboardBlockMappings } from "./storyboard-block-structure.js";
import { freezeStoryboardShotPlan } from "./storyboard-shot-plan.js";

const bibleId = crypto.randomUUID();
const blocks: EpisodeScriptContent["blocks"] = [
  { id: crypto.randomUUID(), type: "scene_heading", text: "INT. 房间 - NIGHT" },
  { id: crypto.randomUUID(), type: "action", text: "林晚记录号码。" },
  { id: crypto.randomUUID(), type: "character", text: "林晚" },
  { id: crypto.randomUUID(), type: "dialogue", text: "我要亲自求证。" },
];
const script: EpisodeScriptContent = {
  blocks,
  sceneLinks: [
    { sceneId: "scene-1", blockIds: blocks.map((block) => block.id) },
  ],
};
const outline = {
  scenes: [{ id: "scene-1", durationSeconds: 20 }],
} as EpisodeOutlineContent;
function proposal() {
  return StoryboardPackageContentSchema.parse({
    title: "试制分镜",
    visualDirection: "现实夜景",
    productionNotes: ["先审阅静帧，不自动提交视频"],
    assets: [
      {
        id: "lin",
        kind: "character",
        title: "林晚",
        description: "保持人物一致性",
        sourceBibleIds: [bibleId],
      },
    ],
    scenes: [
      {
        sceneId: "scene-1",
        scriptBlockIds: blocks.map((item) => item.id),
        shots: [
          {
            id: "shot-1",
            orderIndex: 0,
            sourceBlockIds: blocks.map((item) => item.id),
            visualAction: "记录后作出决定",
            composition: "中近景",
            camera: "平视",
            movement: "固定",
            durationSeconds: 20,
            sound: "原对白与环境音",
            prompt: "夜间林晚记录号码",
            negativePrompt: "无水印",
            assetIds: ["lin"],
          },
        ],
      },
    ],
    subtitles: [
      {
        id: "sub-1",
        shotId: "shot-1",
        startSeconds: 10,
        endSeconds: 15,
        text: "我要亲自求证。",
        sourceBlockIds: [blocks[3]!.id],
      },
    ],
    costRisks: [
      {
        severity: "medium",
        reason: "低光一致性",
        shotIds: ["shot-1"],
        mitigation: "先验静帧",
      },
    ],
    externalDependencies: ["角色静帧待作者选定"],
  });
}
const inspect = (value: unknown) =>
  inspectStoryboardContent(value, outline, script, [bibleId]);
describe("author-frozen scene shot-plan reconstruction", () => {
  function planFixture() {
    const base = proposal(),
      recordId = crypto.randomUUID(),
      sceneRecordId = crypto.randomUUID(),
      newId: string = crypto.randomUUID();
    base.assets.push({
      ...base.assets[0]!,
      id: "phone",
      kind: "prop",
      title: "原正式电话",
    });
    base.scenes[0]!.shots[0]!.assetIds.push("phone");
    const bindings = [
      {
        id: sceneRecordId,
        stableId: "scene-1",
        kind: "scenes" as const,
        version: 0,
      },
      { id: recordId, stableId: "shot-1", kind: "shots" as const, version: 0 },
    ];
    const receipt = StoryboardRedoReceiptSchema.parse({
      base: { id: crypto.randomUUID(), version: 1 },
      baseContentHash: "a".repeat(64),
      shots: [{ shotId: "shot-1", recordId, version: 0 }],
      previousScript: { id: crypto.randomUUID(), version: 1 },
      scope: "author-frozen-scene-shot-plan-v1",
      semanticVerification: "unverified",
      sceneMappings: [],
      scenePlans: [
        {
          sceneId: "scene-1",
          recordId: sceneRecordId,
          version: 0,
          shots: [
            {
              id: newId,
              orderIndex: 0,
              durationSeconds: 20,
              assetIds: ["phone"],
            },
          ],
        },
      ],
    });
    if (receipt.scope !== "author-frozen-scene-shot-plan-v1")
      throw new Error("expected explicit receipt");
    const patch = {
      format: "selected-scene-shot-plan-v1",
      shots: [{ ...base.scenes[0]!.shots[0]!, id: newId, assetIds: ["phone"] }],
      subtitles: base.subtitles.map((item) => ({ ...item, shotId: newId })),
      costRisks: base.costRisks.map((item) => ({ ...item, shotIds: [newId] })),
    };
    const input = {
      request: {
        format: "author-scene-shot-plan-v1",
        scenePlans: receipt.scenePlans,
      },
      base,
      bindings,
      outline,
      script,
      reservedShotIds: ["shot-1"],
    };
    return { base, receipt, patch, input, newId };
  }
  it("freezes complete old identities, changes existing asset references and prunes only unused proposal definitions without mutating the original", () => {
    const value = planFixture(),
      original = structuredClone(value);
    expect(freezeStoryboardShotPlan(value.input).selectedShots).toEqual(
      value.receipt.shots,
    );
    const next = inspectStoryboardRedo(
      value.patch,
      value.base,
      value.receipt,
      outline,
      script,
      [bibleId],
    );
    expect(next.assets.map((asset) => asset.id)).toEqual(["phone"]);
    expect(next.assets[0]).toEqual(value.base.assets[1]);
    expect(next.subtitles[0]!.shotId).toBe(value.newId);
    expect(next.costRisks[0]!.shotIds).toEqual([value.newId]);
    expect(value).toEqual(original);
  });
  it("refuses historical UUID reuse, absent or foreign actual bindings, wrong scene durations and undeclared assets before freezing", () => {
    const value = planFixture();
    for (const input of [
      { ...value.input, reservedShotIds: [value.newId] },
      { ...value.input, bindings: [] },
      {
        ...value.input,
        request: {
          ...value.input.request,
          scenePlans: [{ ...value.receipt.scenePlans[0]!, version: 99 }],
        },
      },
      {
        ...value.input,
        request: {
          ...value.input.request,
          scenePlans: [
            {
              ...value.receipt.scenePlans[0]!,
              shots: [
                {
                  ...value.receipt.scenePlans[0]!.shots[0]!,
                  durationSeconds: 19,
                },
              ],
            },
          ],
        },
      },
      {
        ...value.input,
        request: {
          ...value.input.request,
          scenePlans: [
            {
              ...value.receipt.scenePlans[0]!,
              shots: [
                {
                  ...value.receipt.scenePlans[0]!.shots[0]!,
                  assetIds: ["unapproved-new-asset"],
                },
              ],
            },
          ],
        },
      },
      {
        ...value.input,
        request: {
          ...value.input.request,
          scenePlans: [
            {
              ...value.receipt.scenePlans[0]!,
              shots: [
                {
                  ...value.receipt.scenePlans[0]!.shots[0]!,
                  retains: {
                    recordId: value.receipt.shots[0]!.recordId,
                    version: 0,
                  },
                },
              ],
            },
          ],
        },
      },
    ])
      expect(() => freezeStoryboardShotPlan(input)).toThrow();
  });
  it("rejects model identity, order, duration, asset, global, source, caption and risk escapes without upgrading either old protocol", () => {
    const value = planFixture();
    for (const mutate of [
      (patch: typeof value.patch) => {
        patch.shots[0]!.id = crypto.randomUUID();
      },
      (patch: typeof value.patch) => {
        patch.shots[0]!.orderIndex = 1;
      },
      (patch: typeof value.patch) => {
        patch.shots[0]!.durationSeconds = 19;
      },
      (patch: typeof value.patch) => {
        patch.shots[0]!.assetIds = ["lin"];
      },
      (patch: typeof value.patch) => {
        patch.shots[0]!.sourceBlockIds = [crypto.randomUUID()];
      },
      (patch: typeof value.patch) => {
        patch.subtitles[0]!.shotId = "shot-1";
      },
      (patch: typeof value.patch) => {
        patch.costRisks[0]!.shotIds = ["shot-1"];
      },
      (patch: typeof value.patch) => {
        patch.subtitles[0]!.endSeconds = 21;
      },
      (patch: typeof value.patch) => {
        patch.subtitles[0]!.text = "不是正式对白";
      },
      (patch: typeof value.patch) => {
        patch.format = "selected-storyboard-shots-v1";
      },
      (patch: typeof value.patch) => {
        patch.format = "selected-storyboard-block-structure-v1";
      },
    ]) {
      const patch = structuredClone(value.patch);
      mutate(patch);
      expect(() =>
        inspectStoryboardRedo(
          patch,
          value.base,
          value.receipt,
          outline,
          script,
          [bibleId],
        ),
      ).toThrow();
    }
    expect(() =>
      inspectStoryboardRedo(
        { ...value.patch, assets: value.base.assets },
        value.base,
        value.receipt,
        outline,
        script,
        [bibleId],
      ),
    ).toThrow();
    expect(() =>
      inspectStoryboardRedo(
        { ...value.patch, shots: [...value.patch.shots, value.patch.shots[0]] },
        value.base,
        value.receipt,
        outline,
        script,
        [bibleId],
      ),
    ).toThrow();
    expect(() =>
      inspectStoryboardRedo(
        value.patch,
        value.base,
        {
          ...value.receipt,
          sceneMappings: [
            {
              sceneId: "scene-1",
              previousBlockIds: [blocks[0]!.id],
              currentBlockIds: script.sceneLinks[0]!.blockIds,
            },
          ],
        },
        outline,
        script,
        [bibleId],
      ),
    ).toThrow();
  });
  it("reconstructs a retained and a new shot with exact author durations instead of silently using the old one-to-one scope", () => {
    const base = proposal();
    const recordId = crypto.randomUUID();
    const newId = crypto.randomUUID();
    const next = {
      format: "selected-scene-shot-plan-v1",
      shots: [
        {
          ...base.scenes[0]!.shots[0]!,
          durationSeconds: 10,
          sourceBlockIds: blocks.slice(0, 2).map((block) => block.id),
        },
        {
          ...base.scenes[0]!.shots[0]!,
          id: newId,
          orderIndex: 1,
          durationSeconds: 10,
          sourceBlockIds: blocks.slice(2).map((block) => block.id),
          visualAction: "明确新增镜头表达原对白",
        },
      ],
      subtitles: [
        {
          ...base.subtitles[0]!,
          shotId: newId,
          startSeconds: 0,
          endSeconds: 5,
        },
      ],
      costRisks: base.costRisks,
    };
    const receipt: StoryboardRedoReceipt = {
      base: { id: crypto.randomUUID(), version: 1 },
      baseContentHash: "a".repeat(64),
      shots: [{ shotId: "shot-1", recordId, version: 0 }],
      previousScript: { id: crypto.randomUUID(), version: 1 },
      scope: "author-frozen-scene-shot-plan-v1",
      semanticVerification: "unverified",
      sceneMappings: [],
      scenePlans: [
        {
          sceneId: "scene-1",
          recordId: crypto.randomUUID(),
          version: 0,
          shots: [
            {
              id: "shot-1",
              orderIndex: 0,
              durationSeconds: 10,
              assetIds: ["lin"],
              retains: { recordId, version: 0 },
            },
            {
              id: newId,
              orderIndex: 1,
              durationSeconds: 10,
              assetIds: ["lin"],
            },
          ],
        },
      ],
    };
    expect(() =>
      inspectStoryboardRedo(next, base, receipt, outline, script, [bibleId]),
    ).not.toThrow();
    const result = inspectStoryboardRedo(next, base, receipt, outline, script, [
      bibleId,
    ]);
    expect(result.scenes[0]!.shots.map((shot) => shot.id)).toEqual([
      "shot-1",
      newId,
    ]);
    expect(result.scenes[0]!.shots.map((shot) => shot.durationSeconds)).toEqual(
      [10, 10],
    );
    expect(result.assets).toEqual(base.assets);
  });
});
describe("real selected storyboard patch", () => {
  const receipt: StoryboardRedoReceipt = {
    base: { id: crypto.randomUUID(), version: 1 },
    baseContentHash: "a".repeat(64),
    shots: [{ shotId: "shot-1", recordId: crypto.randomUUID(), version: 0 }],
    previousScript: { id: crypto.randomUUID(), version: 1 },
    scope: "stable-mapping-fixed-duration-existing-assets-v1",
    semanticVerification: "unverified",
  };
  const patch = () => {
    const base = proposal();
    return {
      format: "selected-storyboard-shots-v1" as const,
      shots: [{ ...base.scenes[0]!.shots[0]!, prompt: "明确选择的替换提示" }],
      subtitles: base.subtitles,
      costRisks: base.costRisks,
    };
  };
  const check = (value: unknown) =>
    inspectStoryboardRedo(value, proposal(), receipt, outline, script, [
      bibleId,
    ]);
  it("locally recombines selected expression and actual dialogue without global rewrites", () => {
    const result = check(patch());
    expect(result.assets).toEqual(proposal().assets);
    expect(result.externalDependencies).toEqual(
      proposal().externalDependencies,
    );
    expect(result.scenes[0]!.shots[0]!.prompt).toBe("明确选择的替换提示");
    const newer = {
      ...script,
      blocks: script.blocks.map((block) =>
        block.id === blocks[3]!.id
          ? { ...block, text: "人工确认的新对白。" }
          : block,
      ),
    } as EpisodeScriptContent;
    expect(() =>
      inspectStoryboardRedo(patch(), proposal(), receipt, outline, newer, [
        bibleId,
      ]),
    ).toThrow("字幕文本");
    const fresh = patch();
    fresh.subtitles[0]!.text = "人工确认的新对白。";
    expect(
      inspectStoryboardRedo(fresh, proposal(), receipt, outline, newer, [
        bibleId,
      ]).subtitles[0]!.text,
    ).toBe("人工确认的新对白。");
  });
  it("rejects missing duplicate or out-of-scope shots and any whole/global output", () => {
    expect(() => check({ ...patch(), shots: [] })).toThrow();
    const duplicate = patch();
    duplicate.shots.push({ ...duplicate.shots[0]! });
    expect(() => check(duplicate)).toThrow("恰好覆盖");
    const extra = patch();
    extra.shots[0]!.id = "not-selected";
    expect(() => check(extra)).toThrow("恰好覆盖");
    expect(() => check({ ...patch(), assets: proposal().assets })).toThrow();
    expect(() => check(proposal())).toThrow();
  });
  it("rejects structural duration asset caption and risk scope escapes", () => {
    for (const mutate of [
      (v: ReturnType<typeof patch>) => {
        v.shots[0]!.durationSeconds++;
      },
      (v: ReturnType<typeof patch>) => {
        v.shots[0]!.orderIndex++;
      },
      (v: ReturnType<typeof patch>) => {
        v.shots[0]!.sourceBlockIds.reverse();
      },
      (v: ReturnType<typeof patch>) => {
        v.shots[0]!.assetIds = ["new-global-asset"];
      },
      (v: ReturnType<typeof patch>) => {
        v.subtitles[0]!.shotId = "not-selected";
      },
      (v: ReturnType<typeof patch>) => {
        v.costRisks[0]!.shotIds.push("not-selected");
      },
    ]) {
      const value = patch();
      mutate(value);
      expect(() => check(value)).toThrow();
    }
  });
});
describe("explicit confirmed block structure redo", () => {
  const added = {
    id: crypto.randomUUID(),
    type: "action" as const,
    text: "林晚把号码交给警员。",
  };
  const variants: EpisodeScriptContent[] = [
    {
      blocks: [...blocks, added],
      sceneLinks: [
        {
          sceneId: "scene-1",
          blockIds: [...blocks.map((b) => b.id), added.id],
        },
      ],
    },
    {
      blocks: [blocks[0]!, blocks[2]!, blocks[3]!],
      sceneLinks: [
        {
          sceneId: "scene-1",
          blockIds: [blocks[0]!.id, blocks[2]!.id, blocks[3]!.id],
        },
      ],
    },
    {
      blocks: [blocks[0]!, blocks[2]!, blocks[3]!, blocks[1]!],
      sceneLinks: [
        {
          sceneId: "scene-1",
          blockIds: [
            blocks[0]!.id,
            blocks[2]!.id,
            blocks[3]!.id,
            blocks[1]!.id,
          ],
        },
      ],
    },
  ];
  const receiptFor = (current: EpisodeScriptContent) =>
    StoryboardRedoReceiptSchema.parse({
      base: { id: crypto.randomUUID(), version: 1 },
      baseContentHash: "a".repeat(64),
      shots: [{ shotId: "shot-1", recordId: crypto.randomUUID(), version: 0 }],
      previousScript: { id: crypto.randomUUID(), version: 1 },
      scope: "confirmed-block-structure-fixed-shots-duration-assets-v1",
      semanticVerification: "unverified",
      sceneMappings: [
        {
          sceneId: "scene-1",
          previousBlockIds: script.sceneLinks[0]!.blockIds,
          currentBlockIds: current.sceneLinks[0]!.blockIds,
        },
      ],
    });
  const patchFor = (current: EpisodeScriptContent) => ({
    format: "selected-storyboard-block-structure-v1",
    shots: [
      {
        ...proposal().scenes[0]!.shots[0]!,
        sourceBlockIds: current.sceneLinks[0]!.blockIds,
      },
    ],
    subtitles: proposal().subtitles,
    costRisks: proposal().costRisks,
  });
  for (const [index, current] of variants.entries()) {
    it(`recombines confirmed within-scene block structure variant ${index + 1} without changing topology, duration or assets`, () => {
      const result = inspectStoryboardRedo(
        patchFor(current),
        proposal(),
        receiptFor(current),
        outline,
        current,
        [bibleId],
      );
      expect(result.scenes[0]!.scriptBlockIds).toEqual(
        current.sceneLinks[0]!.blockIds,
      );
      expect(result.scenes[0]!.shots[0]!.sourceBlockIds).toEqual(
        current.sceneLinks[0]!.blockIds,
      );
      expect(result.assets).toEqual(proposal().assets);
      expect(result.scenes[0]!.shots[0]!.durationSeconds).toBe(20);
    });
  }
  it("rejects protocol upgrades, borrowed maps, partial scene selections and extra global fields", () => {
    const current = variants[0]!;
    const receipt = receiptFor(current);
    expect(() =>
      inspectStoryboardRedo(
        { ...patchFor(current), format: "selected-storyboard-shots-v1" },
        proposal(),
        receipt,
        outline,
        current,
        [bibleId],
      ),
    ).toThrow("协议");
    const borrowed = structuredClone(receipt);
    if (
      borrowed.scope !==
      "confirmed-block-structure-fixed-shots-duration-assets-v1"
    )
      throw new Error("expected explicit receipt");
    borrowed.sceneMappings[0]!.currentBlockIds = script.sceneLinks[0]!.blockIds;
    expect(() =>
      inspectStoryboardRedo(
        patchFor(current),
        proposal(),
        borrowed,
        outline,
        current,
        [bibleId],
      ),
    ).toThrow("冻结");
    expect(() =>
      inspectStoryboardRedo(
        { ...patchFor(current), scenes: proposal().scenes },
        proposal(),
        receipt,
        outline,
        current,
        [bibleId],
      ),
    ).toThrow();
    const expanded = proposal();
    expanded.scenes[0]!.shots.push({
      ...expanded.scenes[0]!.shots[0]!,
      id: "shot-2",
      orderIndex: 1,
      durationSeconds: 10,
    });
    expanded.scenes[0]!.shots[0]!.durationSeconds = 10;
    expect(() =>
      inspectStoryboardRedo(
        patchFor(current),
        expanded,
        receipt,
        outline,
        current,
        [bibleId],
      ),
    ).toThrow("完整选中");
  });
  it("checks every ancestor and rejects cross-scene stable IDs even after removal and reintroduction", () => {
    const second = [
      {
        id: crypto.randomUUID(),
        type: "scene_heading" as const,
        text: "INT. 楼道 - NIGHT",
      },
      { id: crypto.randomUUID(), type: "action" as const, text: "警员等待。" },
    ];
    const previous: EpisodeScriptContent = {
      blocks: [...blocks, ...second],
      sceneLinks: [
        ...script.sceneLinks,
        { sceneId: "scene-2", blockIds: second.map((b) => b.id) },
      ],
    };
    const first: EpisodeScriptContent = {
      blocks: [...blocks, added, ...second],
      sceneLinks: [
        {
          sceneId: "scene-1",
          blockIds: [...script.sceneLinks[0]!.blockIds, added.id],
        },
        previous.sceneLinks[1]!,
      ],
    };
    const moved: EpisodeScriptContent = {
      blocks: [...blocks, ...second, added],
      sceneLinks: [
        script.sceneLinks[0]!,
        {
          sceneId: "scene-2",
          blockIds: [...second.map((b) => b.id), added.id],
        },
      ],
    };
    expect(() =>
      confirmedStoryboardBlockMappings(previous, [first, previous, moved]),
    ).toThrow("跨场迁移");
    expect(
      confirmedStoryboardBlockMappings(previous, [first, previous, first]),
    ).toEqual([
      {
        sceneId: "scene-1",
        previousBlockIds: script.sceneLinks[0]!.blockIds,
        currentBlockIds: first.sceneLinks[0]!.blockIds,
      },
    ]);
    const heading = structuredClone(first);
    heading.blocks[0]!.id = crypto.randomUUID();
    heading.sceneLinks[0]!.blockIds[0] = heading.blocks[0]!.id;
    expect(() => confirmedStoryboardBlockMappings(previous, [heading])).toThrow(
      "标题身份",
    );
    expect(() =>
      confirmedStoryboardBlockMappings(previous, [previous]),
    ).toThrow("未变化");
    const incomplete = structuredClone(first);
    incomplete.sceneLinks[0]!.blockIds.pop();
    expect(() =>
      confirmedStoryboardBlockMappings(previous, [incomplete]),
    ).toThrow("连续完整");
  });
});
describe("structured storyboard coverage", () => {
  it("preserves actual stable blocks, captions, asset sources and model risk without requiring media", () => {
    const value = proposal();
    expect(inspect(value)).toEqual(value);
    expect(value).not.toHaveProperty("media");
    expect(value).not.toHaveProperty("price");
  });
  it("rejects missing scenes, wrong stable order and omitted/cross-scene blocks", () => {
    for (const mutate of [
      (v: ReturnType<typeof proposal>) => {
        v.scenes[0]!.sceneId = "other";
      },
      (v: ReturnType<typeof proposal>) => {
        v.scenes[0]!.scriptBlockIds.reverse();
      },
      (v: ReturnType<typeof proposal>) => {
        v.scenes[0]!.shots[0]!.sourceBlockIds = [blocks[0]!.id];
      },
      (v: ReturnType<typeof proposal>) => {
        v.scenes[0]!.shots[0]!.sourceBlockIds.push(crypto.randomUUID());
      },
    ]) {
      const value = proposal();
      mutate(value);
      expect(() => inspect(value)).toThrow();
    }
  });
  it("rejects duplicate shot IDs and incomplete order or duration", () => {
    const value = proposal();
    value.scenes[0]!.shots.push(structuredClone(value.scenes[0]!.shots[0]!));
    expect(() => inspect(value)).toThrow("镜头标识重复");
    const order = proposal();
    order.scenes[0]!.shots[0]!.orderIndex = 1;
    expect(() => inspect(order)).toThrow("镜头顺序");
    const time = proposal();
    time.scenes[0]!.shots[0]!.durationSeconds = 19;
    expect(() => inspect(time)).toThrow("镜头时长");
  });
  it("rejects unapproved Bible, dangling asset refs and unused assets", () => {
    const bible = proposal();
    bible.assets[0]!.sourceBibleIds = [crypto.randomUUID()];
    expect(() => inspect(bible)).toThrow("未批准");
    const refs = proposal();
    refs.scenes[0]!.shots[0]!.assetIds = ["missing"];
    expect(() => inspect(refs)).toThrow("资产引用不存在");
    const orphan = proposal();
    orphan.assets.push({ ...orphan.assets[0]!, id: "unused" });
    expect(() => inspect(orphan)).toThrow("孤立资产");
  });
  it("rejects invented, repeated, omitted or out-of-time captions", () => {
    for (const mutate of [
      (v: ReturnType<typeof proposal>) => {
        v.subtitles[0]!.text = "虚构对白";
      },
      (v: ReturnType<typeof proposal>) => {
        v.subtitles.push({ ...v.subtitles[0]!, id: "sub-2" });
      },
      (v: ReturnType<typeof proposal>) => {
        v.subtitles = [];
      },
      (v: ReturnType<typeof proposal>) => {
        v.subtitles[0]!.endSeconds = 21;
      },
      (v: ReturnType<typeof proposal>) => {
        v.subtitles[0]!.sourceBlockIds = [blocks[1]!.id];
      },
    ]) {
      const value = proposal();
      mutate(value);
      expect(() => inspect(value)).toThrow();
    }
  });
  it("rejects invented risk shot references", () => {
    const value = proposal();
    value.costRisks[0]!.shotIds = ["unknown"];
    expect(() => inspect(value)).toThrow("实际镜头");
  });
});
