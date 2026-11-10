import { z } from "zod";
import {
  StoryboardBlockStructureReceiptSchema,
  StoryboardShotPlanReceiptSchema,
  StoryboardTopologyPlanReceiptSchema,
} from "./storyboard-package.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.number().int().nonnegative();
const ref = z.object({ id: z.string().uuid(), version }).strict();
export const ProductionRecordMergeFieldSchema = z.enum([
  "title",
  "场景动作",
  "镜头描述",
  "构图",
  "机位",
  "运镜",
  "生成提示",
  "负面提示",
  "声音",
]);
const value = z.discriminatedUnion("state", [
  z.object({ state: z.literal("text"), text: z.string(), hash }).strict(),
  z.object({ state: z.enum(["absent", "unsupported"]), hash }).strict(),
]);
const comparisonSchema = z
  .object({
    format: z.literal("storyboard-record-field-comparison-v1"),
    projectId: z.string().uuid(),
    episodeId: z.string().min(1),
    workflow: ref,
    base: ref,
    candidateHash: hash,
    frozenBasisHash: hash,
    contextHash: hash,
    records: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            kind: z.enum(["scenes", "shots"]),
            stableId: z.string().min(1).max(64),
            frozenVersion: version,
            currentVersion: version,
            frozenHash: hash,
            currentHash: hash,
            parentId: z.string().uuid(),
            orderIndex: version,
            editable: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(60120),
    units: z
      .array(
        z
          .object({
            id: z.string().min(1),
            recordId: z.string().uuid(),
            kind: z.enum(["scenes", "shots"]),
            field: ProductionRecordMergeFieldSchema,
            base: value,
            current: value,
            candidate: value,
            conflict: z.boolean(),
            defaultChoice: z.enum(["main", "branch"]),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
    comparisonHash: hash,
    semanticVerification: z.literal("unverified"),
    automaticCommit: z.literal(false),
  })
  .strict();
const validateComparison = (
  report: Pick<z.infer<typeof comparisonSchema>, "records" | "units">,
  ctx: z.RefinementCtx,
  shotPlanScope?: { scenes: Set<string>; shots: Set<string> },
) => {
  const ids = new Set(report.records.map((item) => item.id));
  const byId = new Map(report.records.map((item) => [item.id, item]));
  const unitsByRecord = new Map<string, Set<string>>();
  for (const item of report.units) {
    const fields = unitsByRecord.get(item.recordId) ?? new Set<string>();
    fields.add(item.field);
    unitsByRecord.set(item.recordId, fields);
  }
  const editableParents = new Set(
    report.records
      .filter((item) => item.kind === "shots" && item.editable)
      .map((item) => item.parentId),
  );
  if (
    ids.size !== report.records.length ||
    new Set(report.units.map((item) => item.id)).size !== report.units.length ||
    new Set(report.records.map((item) => `${item.kind}:${item.stableId}`))
      .size !== report.records.length ||
    report.records.some((item) => {
      const fields = unitsByRecord.get(item.id);
      const required =
        item.kind === "scenes"
          ? ["title", "场景动作"]
          : [
              "title",
              "镜头描述",
              "构图",
              "机位",
              "运镜",
              "生成提示",
              "负面提示",
              "声音",
            ];
      return (
        (shotPlanScope !== undefined &&
          item.editable !==
            (item.kind === "scenes"
              ? shotPlanScope.scenes.has(item.id)
              : shotPlanScope.shots.has(item.id))) ||
        (item.kind === "shots" &&
          (byId.get(item.parentId)?.kind !== "scenes" ||
            (item.editable && !byId.get(item.parentId)?.editable))) ||
        (item.kind === "scenes" &&
          item.editable !==
            (shotPlanScope?.scenes ?? editableParents).has(item.id)) ||
        (item.editable &&
          (!fields ||
            fields.size !== required.length ||
            required.some((field) => !fields.has(field)))) ||
        (!item.editable && Boolean(fields))
      );
    }) ||
    report.units.some((item) => {
      const record = byId.get(item.recordId);
      const conflict =
        item.base.hash !== item.current.hash &&
        item.base.hash !== item.candidate.hash &&
        item.current.hash !== item.candidate.hash;
      const expectedChoice =
        item.base.hash !== item.current.hash ? "main" : "branch";
      return (
        !record?.editable ||
        record.kind !== item.kind ||
        item.id !== `${item.recordId}:${item.field}` ||
        item.conflict !== conflict ||
        item.defaultChoice !== expectedChoice ||
        (item.kind === "scenes" &&
          !["title", "场景动作"].includes(item.field)) ||
        (item.kind === "shots" && item.field === "场景动作")
      );
    })
  )
    ctx.addIssue({
      code: "custom",
      message: "实际字段比较身份、范围或三方冲突信息不完整。",
    });
};
export const ProductionRecordMergeStructureSchema = z
  .object({
    receipt: StoryboardBlockStructureReceiptSchema,
    script: ref,
    scriptRecordId: z.string().uuid(),
    documentVersion: version,
  })
  .strict();
const mappedComparisonSchema = comparisonSchema
  .extend({
    format: z.literal("storyboard-record-field-comparison-v2"),
    structure: ProductionRecordMergeStructureSchema,
    structureHash: hash,
  })
  .superRefine(validateComparison)
  .superRefine((report, ctx) => {
    const receipt = report.structure.receipt;
    const selected = report.records.filter(
      (record) => record.kind === "shots" && record.editable,
    );
    const records = new Map(
      report.records
        .filter((record) => record.kind === "scenes")
        .map((record) => [record.stableId, record]),
    );
    const owners = new Map<string, string>();
    let invalid =
      receipt.base.id !== report.base.id ||
      receipt.base.version !== report.base.version ||
      selected.length !== receipt.shots.length ||
      new Set(receipt.shots.map((shot) => shot.recordId)).size !==
        receipt.shots.length ||
      receipt.shots.some(
        (shot) =>
          !selected.some(
            (record) =>
              record.id === shot.recordId &&
              record.stableId === shot.shotId &&
              record.frozenVersion === shot.version,
          ),
      ) ||
      report.records.some(
        (record) =>
          record.kind === "scenes" &&
          record.parentId !== report.structure.scriptRecordId,
      ) ||
      new Set(receipt.sceneMappings.map((mapping) => mapping.sceneId)).size !==
        receipt.sceneMappings.length;
    for (const mapping of receipt.sceneMappings) {
      const scene = records.get(mapping.sceneId);
      invalid ||=
        !scene ||
        scene.kind !== "scenes" ||
        !scene.editable ||
        report.records.some(
          (record) =>
            record.kind === "shots" &&
            record.parentId === scene.id &&
            !record.editable,
        ) ||
        mapping.previousBlockIds[0] !== mapping.currentBlockIds[0] ||
        JSON.stringify(mapping.previousBlockIds) ===
          JSON.stringify(mapping.currentBlockIds) ||
        new Set(mapping.previousBlockIds).size !==
          mapping.previousBlockIds.length ||
        new Set(mapping.currentBlockIds).size !==
          mapping.currentBlockIds.length;
      for (const id of [
        ...mapping.previousBlockIds,
        ...mapping.currentBlockIds,
      ]) {
        invalid ||= owners.has(id) && owners.get(id) !== mapping.sceneId;
        owners.set(id, mapping.sceneId);
      }
    }
    if (invalid)
      ctx.addIssue({
        code: "custom",
        message: "已确认块映射与实际冻结镜头范围不一致，不自动升级协议。",
      });
  });
export const ProductionRecordMergeShotPlanSchema = z
  .object({
    receipt: StoryboardShotPlanReceiptSchema,
    script: ref,
    scriptRecordId: z.string().uuid(),
    documentVersion: version,
  })
  .strict();
const shotPlanComparisonSchema = comparisonSchema
  .extend({
    format: z.literal("storyboard-record-field-comparison-v3"),
    structure: ProductionRecordMergeShotPlanSchema,
    structureHash: hash,
  })
  .superRefine((report, ctx) => {
    const receipt = report.structure.receipt;
    const plannedScenes = new Set(
      receipt.scenePlans.map((scene) => scene.recordId),
    );
    const retained = receipt.scenePlans.flatMap((scene) =>
      scene.shots.flatMap((shot) =>
        shot.retains ? [shot.retains.recordId] : [],
      ),
    );
    validateComparison(report, ctx, {
      scenes: plannedScenes,
      shots: new Set(retained),
    });
    const byId = new Map(report.records.map((record) => [record.id, record]));
    const selectedOld = new Set(receipt.shots.map((shot) => shot.recordId));
    let invalid =
      receipt.base.id !== report.base.id ||
      receipt.base.version !== report.base.version ||
      report.records.some(
        (record) =>
          record.kind === "scenes" &&
          record.parentId !== report.structure.scriptRecordId,
      ) ||
      receipt.shots.some((shot) => {
        const record = byId.get(shot.recordId);
        return (
          record?.kind !== "shots" ||
          record.stableId !== shot.shotId ||
          record.frozenVersion !== shot.version ||
          !plannedScenes.has(record.parentId)
        );
      }) ||
      report.records.some(
        (record) =>
          record.kind === "shots" &&
          plannedScenes.has(record.parentId) &&
          !selectedOld.has(record.id),
      );
    for (const scene of receipt.scenePlans) {
      const record = byId.get(scene.recordId);
      invalid ||=
        record?.kind !== "scenes" ||
        record.stableId !== scene.sceneId ||
        record.frozenVersion !== scene.version;
      for (const shot of scene.shots) {
        const old = shot.retains && byId.get(shot.retains.recordId);
        invalid ||= shot.retains
          ? !old ||
            old.kind !== "shots" ||
            old.stableId !== shot.id ||
            old.parentId !== scene.recordId ||
            old.frozenVersion !== shot.retains.version
          : report.records.some((record) => record.stableId === shot.id);
      }
    }
    const owners = new Map<string, string>();
    invalid ||=
      new Set(receipt.sceneMappings.map((map) => map.sceneId)).size !==
      receipt.sceneMappings.length;
    for (const map of receipt.sceneMappings) {
      invalid ||=
        !receipt.scenePlans.some((scene) => scene.sceneId === map.sceneId) ||
        map.previousBlockIds[0] !== map.currentBlockIds[0] ||
        JSON.stringify(map.previousBlockIds) ===
          JSON.stringify(map.currentBlockIds) ||
        new Set(map.previousBlockIds).size !== map.previousBlockIds.length ||
        new Set(map.currentBlockIds).size !== map.currentBlockIds.length;
      for (const id of [...map.previousBlockIds, ...map.currentBlockIds]) {
        invalid ||= owners.has(id) && owners.get(id) !== map.sceneId;
        owners.set(id, map.sceneId);
      }
    }
    if (invalid)
      ctx.addIssue({
        code: "custom",
        message:
          "作者镜头计划与完整旧身份／实际字段范围不一致，不补造新增或退役的原字段。",
      });
  });
export const ProductionRecordMergeTopologyPlanSchema = z
  .object({
    receipt: StoryboardTopologyPlanReceiptSchema,
    script: ref,
    scriptRecordId: z.string().uuid(),
    documentVersion: version,
  })
  .strict()
  .superRefine((proof, ctx) => {
    if (
      proof.script.id !== proof.receipt.script.id ||
      proof.script.version !== proof.receipt.script.version
    )
      ctx.addIssue({
        code: "custom",
        message: "场景拓扑字段证明必须保留实际新正式剧本版本。",
      });
  });
const topologyComparisonSchema = comparisonSchema
  .extend({
    format: z.literal("storyboard-record-field-comparison-v4"),
    structure: ProductionRecordMergeTopologyPlanSchema,
    structureHash: hash,
    // A replacement consisting only of new and retired rows has no fabricated
    // old creative fields. It still requires an explicit metadata-only review.
    units: z.array(comparisonSchema.shape.units.element).max(10000),
  })
  .superRefine((report, ctx) => {
    const { receipt } = report.structure,
      plan = receipt.topologyPlan,
      byId = new Map(report.records.map((record) => [record.id, record])),
      selected = new Set(receipt.selectedScenes.map((scene) => scene.recordId)),
      selectedShots = new Set(receipt.shots.map((shot) => shot.recordId));
    const editableScenes = new Set(
        plan.scenes.flatMap((scene) =>
          scene.mode === "generate" && scene.retains
            ? [scene.retains.recordId]
            : [],
        ),
      ),
      editableShots = new Set(
        plan.scenes
          .filter((scene) => scene.mode === "generate")
          .flatMap((scene) =>
            scene.shots.flatMap((shot) =>
              shot.retains ? [shot.retains.recordId] : [],
            ),
          ),
      );
    validateComparison(report, ctx, {
      scenes: editableScenes,
      shots: editableShots,
    });
    const scenes = [
        ...plan.scenes.flatMap((scene) =>
          scene.retains ? [{ sceneId: scene.sceneId, ...scene.retains }] : [],
        ),
        ...plan.retiredScenes,
      ],
      shots = [
        ...plan.scenes.flatMap((scene) =>
          scene.shots.flatMap((shot) =>
            shot.retains
              ? [{ shotId: shot.id, sceneId: scene.sceneId, ...shot.retains }]
              : [],
          ),
        ),
        ...plan.retiredShots,
      ];
    const oldRef = (
      id: string,
      stableId: string,
      kind: "scenes" | "shots",
      frozenVersion: number,
    ) => {
      const record = byId.get(id);
      return (
        record?.kind === kind &&
        record.stableId === stableId &&
        record.frozenVersion === frozenVersion
      );
    };
    if (
      receipt.base.id !== report.base.id ||
      receipt.base.version !== report.base.version ||
      scenes.length + shots.length !== report.records.length ||
      new Set([...scenes, ...shots].map((row) => row.recordId)).size !==
        report.records.length ||
      scenes.some(
        (scene) =>
          !oldRef(scene.recordId, scene.sceneId, "scenes", scene.version),
      ) ||
      shots.some(
        (shot) => !oldRef(shot.recordId, shot.shotId, "shots", shot.version),
      ) ||
      receipt.selectedScenes.some(
        (scene) =>
          !oldRef(scene.recordId, scene.sceneId, "scenes", scene.version),
      ) ||
      receipt.shots.some(
        (shot) =>
          !oldRef(shot.recordId, shot.shotId, "shots", shot.version) ||
          !selected.has(byId.get(shot.recordId)!.parentId),
      ) ||
      report.records.some((record) =>
        record.kind === "scenes"
          ? record.parentId !== report.structure.scriptRecordId
          : selected.has(record.parentId) && !selectedShots.has(record.id),
      ) ||
      plan.scenes.some(
        (scene) =>
          !scene.retains &&
          report.records.some((record) => record.stableId === scene.sceneId),
      ) ||
      plan.scenes.some((scene) =>
        scene.shots.some((shot) =>
          shot.retains
            ? !scene.retains ||
              byId.get(shot.retains.recordId)?.parentId !==
                scene.retains.recordId
            : report.records.some((record) => record.stableId === shot.id),
        ),
      ) ||
      plan.retiredScenes.some((scene) =>
        report.records.some(
          (record) =>
            record.parentId === scene.recordId &&
            !plan.retiredShots.some((shot) => shot.recordId === record.id),
        ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "场景拓扑字段比较必须覆盖全部真实旧基准、同场复用与明确退役，不补造新增记录的原字段。",
      });
  });
export const ProductionRecordMergeComparisonSchema = z.discriminatedUnion(
  "format",
  [
    comparisonSchema.superRefine(validateComparison),
    mappedComparisonSchema,
    shotPlanComparisonSchema,
    topologyComparisonSchema,
  ],
);
export type ProductionRecordMergeTopologyPlan = z.infer<
  typeof ProductionRecordMergeTopologyPlanSchema
>;
export type ProductionRecordMergeShotPlan = z.infer<
  typeof ProductionRecordMergeShotPlanSchema
>;
export type ProductionRecordMergeStructure = z.infer<
  typeof ProductionRecordMergeStructureSchema
>;
export type ProductionRecordMergeField = z.infer<
  typeof ProductionRecordMergeFieldSchema
>;
export type ProductionRecordMergeComparison = z.infer<
  typeof ProductionRecordMergeComparisonSchema
>;

// Validate the raw keys before Zod's record parser can normalize unsafe keys.
const choiceKey = z
  .string()
  .regex(
    /^[a-f0-9-]{36}:(?:title|场景动作|镜头描述|构图|机位|运镜|生成提示|负面提示|声音)$/u,
  );
const choices = z
  .unknown()
  .superRefine((input, ctx) => {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Object.keys(input).length > 10000 ||
      Object.keys(input).some((key) => !choiceKey.safeParse(key).success)
    )
      ctx.addIssue({
        code: "custom",
        message: "字段选择必须使用完整实际字段身份。",
      });
  })
  .pipe(z.record(choiceKey, z.enum(["main", "branch"])));
const requestSchema = z
  .object({
    format: z.literal("storyboard-record-field-merge-request-v1"),
    projectId: z.string().uuid(),
    episodeId: z.string().min(1),
    workflow: ref,
    base: ref,
    comparisonHash: hash,
    choices,
    reviewed: z.literal(true),
    modelDisclosureConfirmed: z.literal(true),
  })
  .strict();
export const ProductionRecordMergeRequestSchema = z.discriminatedUnion(
  "format",
  [
    requestSchema,
    requestSchema.extend({
      format: z.literal("storyboard-record-field-merge-request-v2"),
      structureHash: hash,
    }),
    requestSchema.extend({
      format: z.literal("storyboard-record-field-merge-request-v3"),
      structureHash: hash,
    }),
    requestSchema.extend({
      format: z.literal("storyboard-record-field-merge-request-v4"),
      structureHash: hash,
    }),
  ],
);
export const ProductionRecordMergeSourceSchema = z
  .object({
    format: z.enum([
      "storyboard-record-field-merge-v1",
      "storyboard-record-field-merge-v2",
      "storyboard-record-field-merge-v3",
      "storyboard-record-field-merge-v4",
    ]),
    request: ProductionRecordMergeRequestSchema,
    comparison: ProductionRecordMergeComparisonSchema,
    outputHash: hash,
  })
  .strict()
  .superRefine((source, ctx) => {
    const { request, comparison } = source;
    if (
      request.projectId !== comparison.projectId ||
      request.episodeId !== comparison.episodeId ||
      request.workflow.id !== comparison.workflow.id ||
      request.workflow.version !== comparison.workflow.version ||
      request.base.id !== comparison.base.id ||
      request.base.version !== comparison.base.version ||
      request.comparisonHash !== comparison.comparisonHash ||
      Object.keys(request.choices).length !== comparison.units.length ||
      comparison.units.some(
        (unit) => !Object.hasOwn(request.choices, unit.id),
      ) ||
      (comparison.format === "storyboard-record-field-comparison-v4"
        ? source.format !== "storyboard-record-field-merge-v4" ||
          request.format !== "storyboard-record-field-merge-request-v4" ||
          request.structureHash !== comparison.structureHash
        : comparison.format === "storyboard-record-field-comparison-v3"
          ? source.format !== "storyboard-record-field-merge-v3" ||
            request.format !== "storyboard-record-field-merge-request-v3" ||
            request.structureHash !== comparison.structureHash
          : comparison.format === "storyboard-record-field-comparison-v2"
            ? source.format !== "storyboard-record-field-merge-v2" ||
              request.format !== "storyboard-record-field-merge-request-v2" ||
              request.structureHash !== comparison.structureHash
            : source.format !== "storyboard-record-field-merge-v1" ||
              request.format !== "storyboard-record-field-merge-request-v1")
    )
      ctx.addIssue({
        code: "custom",
        message: "字段合并原请求与完整冻结比较不一致。",
      });
  });
export type ProductionRecordMergeRequest = z.infer<
  typeof ProductionRecordMergeRequestSchema
>;
export type ProductionRecordMergeSource = z.infer<
  typeof ProductionRecordMergeSourceSchema
>;
