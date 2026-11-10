import { describe, expect, it } from "vitest";
import {
  ProductionRecordMergeComparisonSchema,
  ProductionRecordMergeSourceSchema,
  type StoryboardPackageContent,
} from "@dramaip/contracts/production";
import {
  captureProductionRecordBaseline,
  type BaselineRecordRow,
} from "./record-baselines.js";
import {
  planProductionRecordFields,
  resolveProductionRecordFields,
} from "./record-field-merge.js";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const scriptId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sceneId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const shotId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const result = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", version: 1 };
const blockId = "99999999-9999-4999-8999-999999999999";
const addedId = "88888888-8888-4888-8888-888888888888";
function fixture() {
  const bindings = [
    { id: sceneId, kind: "scenes" as const, stableId: "scene", version: 0 },
    { id: shotId, kind: "shots" as const, stableId: "shot", version: 0 },
    { id: otherId, kind: "shots" as const, stableId: "other", version: 0 },
  ];
  const shot = {
    id: "shot",
    orderIndex: 0,
    sourceBlockIds: [blockId],
    visualAction: "原实际镜头",
    composition: "原构图",
    camera: "原机位",
    movement: "原运动",
    durationSeconds: 30,
    sound: "原声音",
    prompt: "原生成提示",
    negativePrompt: "原负面提示",
    assetIds: [],
  };
  const other = { ...shot, id: "other", orderIndex: 1 };
  const candidate: StoryboardPackageContent = {
    title: "纯规则测试候选，不是正式内容",
    visualDirection: "测试视觉",
    productionNotes: [],
    scenes: [
      {
        sceneId: "scene",
        scriptBlockIds: [blockId],
        shots: [{ ...shot, visualAction: "候选新动作" }, other],
      },
    ],
    assets: [],
    subtitles: [],
    costRisks: [],
    externalDependencies: [],
  };
  const rows: BaselineRecordRow[] = bindings.map((binding, index) => ({
    id: binding.id,
    project_id: projectId,
    kind: binding.kind,
    version: 0,
    parent_id: index === 0 ? scriptId : sceneId,
    order_index: index < 2 ? 0 : 1,
    title: `原人工标题${index}`,
    payload_json: JSON.stringify({
      stableId: binding.stableId,
      storyboardResultId: result.id,
      sourceWorkflowId: result.id,
      私有字段: { nested: [false, 0, null, "不外发"] },
      ...(index === 0
        ? {
            场景动作: "原实际场景",
            scriptBlockIds: [blockId],
            视觉方向: "原视觉",
          }
        : {
            镜头描述: shot.visualAction,
            构图: shot.composition,
            机位: shot.camera,
            运镜: shot.movement,
            声音: shot.sound,
            生成提示: shot.prompt,
            负面提示: shot.negativePrompt,
            镜头序号: index,
            时长: 30,
            角色: "",
            sourceBlockIds: [blockId],
            assetIds: [],
          }),
    }),
  }));
  const baselines = rows.map((row, index) =>
    captureProductionRecordBaseline({
      row,
      binding: bindings[index]!,
      projectId,
      result,
    }),
  );
  return {
    projectId,
    scriptId,
    bindings,
    baselines,
    rows,
    selectedRecordIds: [shotId],
    candidate,
  };
}
describe("actual-record creative-field three-way plan", () => {
  function shotPlanFixture() {
    const input = fixture();
    const newId = "66666666-6666-4666-8666-666666666666";
    input.selectedRecordIds = [shotId, otherId];
    for (const row of input.rows)
      if (row.kind === "shots")
        row.payload_json = JSON.stringify({
          ...JSON.parse(row.payload_json),
          assetIds: ["lin"],
        });
    input.baselines = input.rows.map((row, index) =>
      captureProductionRecordBaseline({
        row,
        binding: input.bindings[index]!,
        projectId,
        result,
      }),
    );
    const retained = {
      ...input.candidate.scenes[0]!.shots[0]!,
      orderIndex: 1,
      durationSeconds: 20,
      assetIds: ["lin"],
    };
    input.candidate.scenes[0]!.shots = [
      { ...retained, id: newId, orderIndex: 0, durationSeconds: 40 },
      retained,
    ];
    input.candidate.assets = [
      {
        id: "lin",
        kind: "character",
        title: "已定义角色",
        description: "原方案定义，不是权利证据",
        sourceBibleIds: [result.id],
      },
    ];
    input.rows[1]!.version = 1;
    input.rows[1]!.payload_json = JSON.stringify({
      ...JSON.parse(input.rows[1]!.payload_json),
      镜头描述: "当前复用镜头新稿",
      私有字段: { marker: "复用私有保留不外发" },
    });
    input.rows[2]!.version = 1;
    input.rows[2]!.title = "待退役作者新标题必须原样留存";
    return {
      ...input,
      confirmedShotPlan: {
        receipt: {
          base: result,
          baseContentHash: "a".repeat(64),
          previousScript: result,
          scope: "author-frozen-scene-shot-plan-v1" as const,
          semanticVerification: "unverified" as const,
          shots: input.bindings
            .filter((binding) => binding.kind === "shots")
            .map((binding) => ({
              shotId: binding.stableId,
              recordId: binding.id,
              version: binding.version,
            })),
          sceneMappings: [],
          scenePlans: [
            {
              sceneId: "scene",
              recordId: sceneId,
              version: 0,
              shots: [
                {
                  id: newId,
                  orderIndex: 0,
                  durationSeconds: 40,
                  assetIds: ["lin"],
                },
                {
                  id: "shot",
                  orderIndex: 1,
                  durationSeconds: 20,
                  assetIds: ["lin"],
                  retains: { recordId: shotId, version: 0 },
                },
              ],
            },
          ],
        },
        script: { id: "77777777-7777-4777-8777-777777777777", version: 1 },
        scriptRecordId: scriptId,
        documentVersion: 0,
      },
    };
  }
  it("author shot-plan fields compare only actual retained identities and preserve readonly new/retiring structure", () => {
    const input = shotPlanFixture(),
      before = JSON.stringify(input);
    const plan = planProductionRecordFields(input);
    expect(plan.units).toHaveLength(10);
    expect(plan.units.every((unit) => unit.recordId !== otherId)).toBe(true);
    expect(plan.records.find((row) => row.id === otherId)?.editable).toBe(
      false,
    );
    expect(plan.records.find((row) => row.id === otherId)?.currentVersion).toBe(
      1,
    );
    expect(JSON.stringify(plan.records)).not.toContain("私有");
    expect(JSON.stringify(plan.units)).not.toContain("复用私有保留");
    const resolved = resolveProductionRecordFields(
      plan,
      Object.fromEntries(plan.units.map((unit) => [unit.id, "main"])),
    );
    expect(resolved.get(shotId)!.orderIndex).toBe(1);
    expect(resolved.get(shotId)!.payload.时长).toBe(20);
    expect(resolved.get(shotId)!.payload.镜头描述).toBe("当前复用镜头新稿");
    expect(resolved.get(shotId)!.payload.私有字段).toEqual({
      marker: "复用私有保留不外发",
    });
    expect(resolved.get(otherId)!.title).toBe("待退役作者新标题必须原样留存");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("author shot-plan merge refuses partial original selection, candidate structural changes and current protected metadata", () => {
    const changes: Array<(input: ReturnType<typeof shotPlanFixture>) => void> =
      [
        (input) => {
          input.selectedRecordIds.pop();
        },
        (input) => {
          input.confirmedShotPlan.receipt.shots.pop();
        },
        (input) => {
          input.candidate.scenes[0]!.shots[0]!.durationSeconds++;
        },
        (input) => {
          input.candidate.scenes[0]!.shots[0]!.orderIndex = 1;
        },
        (input) => {
          input.candidate.scenes[0]!.shots[0]!.assetIds = ["foreign"];
        },
        (input) => {
          input.candidate.scenes[0]!.shots[0]!.sourceBlockIds = [addedId];
        },
        (input) => {
          input.confirmedShotPlan.receipt.scenePlans[0]!.shots[1]!.retains!.recordId =
            otherId;
        },
        (input) => {
          input.rows[2]!.parent_id = scriptId;
        },
        (input) => {
          input.rows[1]!.order_index = 7;
        },
        (input) => {
          input.rows[2]!.payload_json = JSON.stringify({
            ...JSON.parse(input.rows[2]!.payload_json),
            时长: 40,
          });
        },
      ];
    for (const change of changes) {
      const input = shotPlanFixture();
      change(input);
      const before = JSON.stringify(input);
      expect(() => planProductionRecordFields(input)).toThrow();
      expect(JSON.stringify(input)).toBe(before);
    }
  });
  it("v3 public comparison and source reject invented original units, omitted retiring bindings and protocol substitution", () => {
    const input = shotPlanFixture(),
      plan = planProductionRecordFields(input),
      hash = "a".repeat(64);
    const report = ProductionRecordMergeComparisonSchema.parse({
      format: "storyboard-record-field-comparison-v3",
      projectId,
      episodeId: "pilot",
      workflow: result,
      base: result,
      candidateHash: hash,
      frozenBasisHash: hash,
      contextHash: hash,
      comparisonHash: hash,
      structure: input.confirmedShotPlan,
      structureHash: hash,
      records: plan.records,
      units: plan.units,
      semanticVerification: "unverified",
      automaticCommit: false,
    });
    const request = {
      format: "storyboard-record-field-merge-request-v3" as const,
      projectId,
      episodeId: "pilot",
      workflow: result,
      base: result,
      comparisonHash: hash,
      structureHash: hash,
      choices: Object.fromEntries(plan.units.map((unit) => [unit.id, "main"])),
      reviewed: true,
      modelDisclosureConfirmed: true,
    };
    const source = {
      format: "storyboard-record-field-merge-v3",
      request,
      comparison: report,
      outputHash: hash,
    };
    expect(ProductionRecordMergeSourceSchema.safeParse(source).success).toBe(
      true,
    );
    for (const altered of [
      {
        ...report,
        records: report.records.filter((record) => record.id !== otherId),
      },
      {
        ...report,
        records: report.records.map((record) => ({
          ...record,
          editable: true,
        })),
      },
      {
        ...report,
        units: [
          ...report.units,
          {
            ...report.units[2]!,
            id: `${otherId}:title`,
            recordId: otherId,
            field: "title",
          },
        ],
      },
      {
        ...report,
        structure: {
          ...input.confirmedShotPlan,
          receipt: { ...input.confirmedShotPlan.receipt, scenePlans: [] },
        },
      },
    ])
      expect(
        ProductionRecordMergeComparisonSchema.safeParse(altered).success,
      ).toBe(false);
    for (const altered of [
      { ...source, format: "storyboard-record-field-merge-v2" },
      { ...source, request: { ...request, structureHash: "b".repeat(64) } },
      {
        ...source,
        request: {
          ...request,
          format: "storyboard-record-field-merge-request-v2",
        },
      },
    ])
      expect(ProductionRecordMergeSourceSchema.safeParse(altered).success).toBe(
        false,
      );
  });

  function mappedFixture() {
    const input = fixture();
    input.selectedRecordIds = [shotId, otherId];
    const blocks = [blockId, addedId];
    input.candidate.scenes[0]!.scriptBlockIds = blocks;
    for (const shot of input.candidate.scenes[0]!.shots)
      shot.sourceBlockIds = blocks;
    return {
      ...input,
      confirmedStructure: {
        receipt: {
          base: result,
          baseContentHash: "a".repeat(64),
          previousScript: result,
          scope:
            "confirmed-block-structure-fixed-shots-duration-assets-v1" as const,
          semanticVerification: "unverified" as const,
          shots: input.bindings
            .filter((binding) => binding.kind === "shots")
            .map((binding) => ({
              shotId: binding.stableId,
              recordId: binding.id,
              version: binding.version,
            })),
          sceneMappings: [
            {
              sceneId: "scene",
              previousBlockIds: [blockId],
              currentBlockIds: blocks,
            },
          ],
        },
        script: { id: "77777777-7777-4777-8777-777777777777", version: 2 },
        scriptRecordId: scriptId,
        documentVersion: 1,
      },
    };
  }
  it("derives only the exact confirmed block writes while field choices preserve current private values", () => {
    const input = mappedFixture(),
      before = JSON.stringify(input);
    const plan = planProductionRecordFields(input);
    expect(plan.protectedWrites.get(sceneId)).toEqual({
      scriptBlockIds: [blockId, addedId],
    });
    expect(plan.protectedWrites.get(shotId)).toEqual({
      sourceBlockIds: [blockId, addedId],
    });
    const fields = resolveProductionRecordFields(
      plan,
      Object.fromEntries(plan.units.map((unit) => [unit.id, "main"])),
    );
    expect(fields.get(shotId)!.payload.sourceBlockIds).toEqual([
      blockId,
      addedId,
    ]);
    expect(fields.get(shotId)!.payload.私有字段).toEqual(
      input.baselines[1]!.fields.payload.私有字段,
    );
    expect(fields.get(shotId)!.payload.镜头描述).toBe("原实际镜头");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not let a confirmed receipt authorize different maps, partial scenes, foreign sources or current protected-field edits", () => {
    for (const change of [
      (input: ReturnType<typeof mappedFixture>) => {
        input.confirmedStructure.receipt.sceneMappings[0]!.previousBlockIds = [
          addedId,
        ];
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.confirmedStructure.receipt.sceneMappings[0]!.currentBlockIds = [
          blockId,
        ];
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.confirmedStructure.receipt.sceneMappings[0]!.sceneId = "foreign";
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.confirmedStructure.scriptRecordId = shotId;
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.selectedRecordIds.pop();
        input.confirmedStructure.receipt.shots.pop();
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.candidate.scenes[0]!.shots[0]!.sourceBlockIds = [result.id];
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.candidate.scenes[0]!.shots[0]!.durationSeconds++;
      },
      (input: ReturnType<typeof mappedFixture>) => {
        input.rows[1]!.payload_json = JSON.stringify({
          ...JSON.parse(input.rows[1]!.payload_json),
          sourceBlockIds: [blockId, addedId],
        });
      },
    ]) {
      const input = mappedFixture();
      change(input);
      expect(() => planProductionRecordFields(input)).toThrow();
    }
  });
  it("uses original actual fields, finds only genuine conflicts and preserves private current fields without a public leak", () => {
    const input = fixture();
    input.rows[1]!.version = 1;
    input.rows[1]!.title = "新人工标题";
    input.rows[1]!.payload_json = JSON.stringify({
      ...JSON.parse(input.rows[1]!.payload_json),
      镜头描述: "新人工动作",
      私有字段: { nested: ["新的私有值", 0, false, null] },
    });
    const before = JSON.stringify(input),
      plan = planProductionRecordFields(input);
    expect(plan.units).toHaveLength(10);
    expect(plan.units.find((item) => item.field === "镜头描述")).toMatchObject({
      conflict: true,
      base: { text: "原实际镜头" },
      current: { text: "新人工动作" },
      candidate: { text: "候选新动作" },
    });
    expect(
      plan.units.find(
        (item) => item.recordId === shotId && item.field === "title",
      ),
    ).toMatchObject({ conflict: false, defaultChoice: "main" });
    expect(
      JSON.stringify({ records: plan.records, units: plan.units }),
    ).not.toContain("私有字段");
    expect(() => resolveProductionRecordFields(plan, {})).toThrow(
      "全部真实字段冲突",
    );
    const merged = resolveProductionRecordFields(plan, {
      [`${shotId}:镜头描述`]: "branch",
    });
    expect(merged.get(shotId)!.title).toBe("新人工标题");
    expect(merged.get(shotId)!.payload["镜头描述"]).toBe("候选新动作");
    expect(merged.get(shotId)!.payload["私有字段"]).toEqual({
      nested: ["新的私有值", 0, false, null],
    });
    expect(merged.get(otherId)).toEqual(input.baselines[2]!.fields);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not silently delete unsupported or absent required current text and rejects unknown choices", () => {
    for (const raw of [undefined, false, ["不是文本"]]) {
      const input = fixture(),
        payload = JSON.parse(input.rows[1]!.payload_json);
      if (raw === undefined) delete payload["构图"];
      else payload["构图"] = raw;
      input.rows[1]!.payload_json = JSON.stringify(payload);
      const plan = planProductionRecordFields(input);
      const unit = plan.units.find((item) => item.field === "构图")!;
      expect(unit.current.state).toBe(
        raw === undefined ? "absent" : "unsupported",
      );
      expect(() => resolveProductionRecordFields(plan, {})).toThrow("有效文本");
      expect(
        resolveProductionRecordFields(plan, { [unit.id]: "branch" }).get(
          shotId,
        )!.payload["构图"],
      ).toBe("原构图");
      expect(() =>
        resolveProductionRecordFields(plan, { foreign: "branch" }),
      ).toThrow("未知身份");
    }
  });
  it("rejects current protected structure, wrong selection and changes in unselected records", () => {
    for (const change of [
      (input: ReturnType<typeof fixture>) => {
        input.rows[1]!.parent_id = scriptId;
      },
      (input: ReturnType<typeof fixture>) => {
        input.rows[1]!.order_index = 1;
      },
      (input: ReturnType<typeof fixture>) => {
        input.rows[1]!.payload_json = JSON.stringify({
          ...JSON.parse(input.rows[1]!.payload_json),
          时长: 31,
        });
      },
      (input: ReturnType<typeof fixture>) => {
        input.rows[2]!.version = 1;
      },
      (input: ReturnType<typeof fixture>) => {
        input.selectedRecordIds = [sceneId];
      },
      (input: ReturnType<typeof fixture>) => {
        input.selectedRecordIds = [shotId, shotId];
      },
    ]) {
      const input = fixture();
      change(input);
      expect(() => planProductionRecordFields(input)).toThrow();
    }
  });
  it("refuses missing/corrupt historical baselines and incomplete actual/formal mappings", () => {
    for (const change of [
      (input: ReturnType<typeof fixture>) => {
        input.baselines = [];
      },
      (input: ReturnType<typeof fixture>) => {
        input.baselines[1]!.contentHash = "a".repeat(64);
      },
      (input: ReturnType<typeof fixture>) => {
        input.rows.pop();
      },
      (input: ReturnType<typeof fixture>) => {
        input.bindings.push(input.bindings[0]!);
      },
      (input: ReturnType<typeof fixture>) => {
        input.candidate.scenes[0]!.shots[0]!.sourceBlockIds = ["foreign"];
      },
      (input: ReturnType<typeof fixture>) => {
        input.candidate.scenes[0]!.shots[0]!.durationSeconds = 31;
      },
      (input: ReturnType<typeof fixture>) => {
        input.candidate.scenes[0]!.shots.pop();
      },
    ]) {
      const input = fixture();
      change(input);
      expect(() => planProductionRecordFields(input)).toThrow();
    }
  });
  it("checks chosen field limits without truncation and keeps both source sides immutable", () => {
    const input = fixture();
    input.rows[1]!.title = "长".repeat(241);
    input.rows[1]!.payload_json = JSON.stringify({
      ...JSON.parse(input.rows[1]!.payload_json),
      镜头描述: "长".repeat(4001),
    });
    const plan = planProductionRecordFields(input);
    expect(() => resolveProductionRecordFields(plan, {})).toThrow("长度");
    const merged = resolveProductionRecordFields(plan, {
      [`${shotId}:title`]: "branch",
      [`${shotId}:镜头描述`]: "branch",
    });
    expect(merged.get(shotId)!.title).toBe(input.baselines[1]!.fields.title);
    expect(input.rows[1]!.title).toHaveLength(241);
  });
});
