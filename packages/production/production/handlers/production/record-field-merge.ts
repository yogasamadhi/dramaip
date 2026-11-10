import { createHash } from "node:crypto";
import type {
  EpisodeDevelopmentResult,
  ProductionRecordMergeComparison,
  ProductionRecordMergeField,
  StoryboardPackageContent,
  ProductionRecordMergeStructure,
  ProductionRecordMergeShotPlan,
  ProductionRecordMergeTopologyPlan,
} from "@dramaip/contracts/production";
import {
  ProductionRecordMergeStructureSchema,
  ProductionRecordMergeShotPlanSchema,
  ProductionRecordMergeTopologyPlanSchema,
} from "@dramaip/contracts/production";
import {
  canonicalProductionRecordJSON,
  inspectProductionRecordBaselines,
  type BaselineRecordRow,
  type ProductionRecordBaseline,
} from "./record-baselines.js";

type Binding = NonNullable<
  EpisodeDevelopmentResult["productionRecords"]
>[number];
type Unit = ProductionRecordMergeComparison["units"][number];
export const productionRecordFieldHash = (value: unknown) =>
  createHash("sha256")
    .update(canonicalProductionRecordJSON(value))
    .digest("hex");
const commonProtected = ["stableId", "storyboardResultId", "sourceWorkflowId"];
const shotFields = [
  "镜头描述",
  "构图",
  "机位",
  "运镜",
  "生成提示",
  "负面提示",
  "声音",
] as const;
const protectedFields = {
  scenes: [...commonProtected, "scriptBlockIds", "视觉方向"],
  shots: [
    ...commonProtected,
    "sourceBlockIds",
    "assetIds",
    "镜头序号",
    "时长",
    "角色",
  ],
};
const fieldValue = (
  payload: Record<string, unknown>,
  key: string,
): Unit["base"] => {
  const present = Object.hasOwn(payload, key),
    value = payload[key];
  const hash = productionRecordFieldHash(
    present ? { present, value } : { present },
  );
  return !present
    ? { state: "absent", hash }
    : typeof value === "string"
      ? { state: "text", text: value, hash }
      : { state: "unsupported", hash };
};
export interface ProductionRecordFieldPlan {
  records: ProductionRecordMergeComparison["records"];
  units: Unit[];
  // Owner-only, never returned by the HTTP projection or passed to a model.
  currentFields: Map<string, ProductionRecordBaseline["fields"]>;
  // Derived from the original validated structural patch, never field choices.
  protectedWrites: Map<string, Record<string, string[]>>;
  shotPlanWrites?: Map<
    string,
    { orderIndex: number; payload: Record<string, unknown> }
  >;
}

/** Actual-row three-way fields, not reconstruction of the author's baseline
 * from a model proposal. Only frozen selected shots and their real scenes are
 * editable; private/custom keys stay in the owner and are retained from main. */
export function planProductionRecordFields(input: {
  projectId: string;
  scriptId: string;
  bindings: Binding[];
  baselines: unknown;
  rows: BaselineRecordRow[];
  selectedRecordIds: string[];
  candidate: StoryboardPackageContent;
  confirmedStructure?: ProductionRecordMergeStructure;
  confirmedShotPlan?: ProductionRecordMergeShotPlan;
  confirmedTopologyPlan?: ProductionRecordMergeTopologyPlan;
}): ProductionRecordFieldPlan {
  const report = inspectProductionRecordBaselines(input);
  if (
    !Array.isArray(input.baselines) ||
    input.baselines.length !== input.bindings.length ||
    report.records.some(
      (item) => !["unchanged", "changed"].includes(item.state),
    )
  )
    throw new Error("实际原字段基准缺失或未核全，不用模型字段重建旧人工内容。");
  const bases = new Map(
    (input.baselines as ProductionRecordBaseline[]).map((item) => [
      item.id,
      item,
    ]),
  );
  const bindings = new Map(input.bindings.map((item) => [item.id, item]));
  const observations = new Map(report.records.map((item) => [item.id, item]));
  if (
    bindings.size !== input.bindings.length ||
    bases.size !== input.bindings.length ||
    [...bases.keys()].some((id) => !bindings.has(id))
  )
    throw new Error("实际原基准集合不完整或有其他身份。");
  const rows = new Map(input.rows.map((row) => [row.id, row]));
  const selected = new Set(input.selectedRecordIds);
  if (
    !selected.size ||
    selected.size !== input.selectedRecordIds.length ||
    input.selectedRecordIds.some((id) => bindings.get(id)?.kind !== "shots")
  )
    throw new Error("实际选中镜头身份重复或超出冻结范围。");
  const structure =
    input.confirmedStructure &&
    ProductionRecordMergeStructureSchema.parse(input.confirmedStructure);
  const shotPlan =
    input.confirmedShotPlan &&
    ProductionRecordMergeShotPlanSchema.parse(input.confirmedShotPlan);
  const topology =
    input.confirmedTopologyPlan &&
    ProductionRecordMergeTopologyPlanSchema.parse(input.confirmedTopologyPlan);
  if ([structure, shotPlan, topology].filter(Boolean).length > 1)
    throw new Error("字段合并只能绑定原候选的一种明确结构协议。");
  const proof = structure ?? shotPlan;
  const scopedProof = proof ?? topology;
  if (
    scopedProof &&
    (scopedProof.scriptRecordId !== input.scriptId ||
      scopedProof.receipt.shots.length !== selected.size ||
      new Set(scopedProof.receipt.shots.map((shot) => shot.recordId)).size !==
        selected.size ||
      scopedProof.receipt.shots.some((shot) => {
        const binding = bindings.get(shot.recordId);
        return (
          !selected.has(shot.recordId) ||
          binding?.kind !== "shots" ||
          binding.stableId !== shot.shotId ||
          binding.version !== shot.version
        );
      }))
  )
    throw new Error("已确认结构的原镜头选择与实际基准不一致。");
  const mappings = new Map(
    proof?.receipt.sceneMappings.map((mapping) => [mapping.sceneId, mapping]),
  );
  if (proof && mappings.size !== proof.receipt.sceneMappings.length)
    throw new Error("已确认场内块映射重复。");
  const protectedWrites = new Map<string, Record<string, string[]>>();
  const shotPlanWrites = new Map<
    string,
    { orderIndex: number; payload: Record<string, unknown> }
  >();
  const editable = topology
    ? new Set(
        topology.receipt.topologyPlan.scenes
          .filter((scene) => scene.mode === "generate")
          .flatMap((scene) => [
            ...(scene.retains ? [scene.retains.recordId] : []),
            ...scene.shots.flatMap((shot) =>
              shot.retains ? [shot.retains.recordId] : [],
            ),
          ]),
      )
    : shotPlan
      ? new Set(
          shotPlan.receipt.scenePlans.flatMap((scene) =>
            scene.shots.flatMap((shot) =>
              shot.retains ? [shot.retains.recordId] : [],
            ),
          ),
        )
      : new Set(selected);
  for (const id of selected) {
    const parentId = bases.get(id)!.fields.parentId;
    if (!parentId || bindings.get(parentId)?.kind !== "scenes")
      throw new Error("选中实际镜头的场景归属未核全。");
    if (!topology) editable.add(parentId);
  }
  const allowedChanged = new Set([
    ...selected,
    ...editable,
    ...(topology?.receipt.selectedScenes.map((scene) => scene.recordId) ?? []),
  ]);
  const plannedScenes = new Map(
    shotPlan?.receipt.scenePlans.map((scene) => [scene.sceneId, scene]),
  );
  const scenes = new Map(
    input.candidate.scenes.map((scene) => [scene.sceneId, scene]),
  );
  const shots = new Map(
    input.candidate.scenes.flatMap((scene) =>
      scene.shots.map((shot) => [shot.id, shot] as const),
    ),
  );
  if (
    scenes.size !== input.candidate.scenes.length ||
    shots.size !==
      input.candidate.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)
  )
    throw new Error("候选正式场景或镜头稳定身份重复。");
  const sceneBindings = new Map(
    input.bindings
      .filter((item) => item.kind === "scenes")
      .map((item) => [item.stableId, item]),
  );
  const shotBindings = new Map(
    input.bindings
      .filter((item) => item.kind === "shots")
      .map((item) => [item.stableId, item]),
  );
  if (
    (!topology && sceneBindings.size !== scenes.size) ||
    (!shotPlan && !topology && shotBindings.size !== shots.size) ||
    sceneBindings.size + shotBindings.size !== input.bindings.length
  )
    throw new Error("完整场景／镜头绑定有遗漏或重复，不推定冻结范围。");
  if (shotPlan) {
    const expectedShots = new Set([
      ...input.bindings
        .filter(
          (binding) => binding.kind === "shots" && !selected.has(binding.id),
        )
        .map((binding) => binding.stableId),
      ...shotPlan.receipt.scenePlans.flatMap((scene) =>
        scene.shots.map((shot) => shot.id),
      ),
    ]);
    if (
      expectedShots.size !== shots.size ||
      [...shots.keys()].some((id) => !expectedShots.has(id))
    )
      throw new Error("新候选未恰好覆盖作者镜头计划和全部未选原身份。");
  }
  if (topology) {
    const plan = topology.receipt.topologyPlan;
    if (
      input.candidate.scenes.length !== plan.scenes.length ||
      plan.scenes.reduce((sum, scene) => sum + scene.shots.length, 0) !==
        shots.size ||
      plan.scenes.flatMap((scene) =>
        scene.retains ? [scene.retains.recordId] : [],
      ).length +
        plan.retiredScenes.length !==
        sceneBindings.size ||
      plan.scenes.flatMap((scene) => scene.shots.filter((shot) => shot.retains))
        .length +
        plan.retiredShots.length !==
        shotBindings.size
    )
      throw new Error("场景拓扑候选或全部真实旧绑定遗漏，不重建虚拟原字段。");
    for (const retired of plan.retiredScenes) {
      const binding = sceneBindings.get(retired.sceneId);
      if (
        binding?.id !== retired.recordId ||
        binding.version !== retired.version ||
        editable.has(binding.id)
      )
        throw new Error("退役场景不是明确只读原记录。");
    }
    for (const retired of plan.retiredShots) {
      const binding = shotBindings.get(retired.shotId);
      if (
        binding?.id !== retired.recordId ||
        binding.version !== retired.version ||
        editable.has(binding.id)
      )
        throw new Error("退役镜头不是明确只读原记录。");
    }
    for (const [index, scene] of input.candidate.scenes.entries()) {
      const planned = plan.scenes[index]!,
        binding = sceneBindings.get(scene.sceneId),
        base = binding && bases.get(binding.id);
      if (
        scene.sceneId !== planned.sceneId ||
        planned.orderIndex !== index ||
        scene.shots.length !== planned.shots.length ||
        (planned.retains
          ? !base ||
            binding!.id !== planned.retains.recordId ||
            binding!.version !== planned.retains.version ||
            base.fields.parentId !== input.scriptId
          : Boolean(binding))
      )
        throw new Error("新场景复用、顺序或实际剧本归属与冻结拓扑不一致。");
      if (base) {
        const previous = base.fields.payload.scriptBlockIds;
        if (
          !Array.isArray(previous) ||
          previous[0] !== scene.scriptBlockIds[0] ||
          (planned.mode === "retain" &&
            (base.fields.orderIndex !== index ||
              productionRecordFieldHash(previous) !==
                productionRecordFieldHash(scene.scriptBlockIds)))
        )
          throw new Error("拓扑复用场景改变稳定标题身份或未选场景顺序／来源。");
        if (planned.mode === "generate") {
          protectedWrites.set(base.id, {
            scriptBlockIds: [...scene.scriptBlockIds],
          });
          shotPlanWrites.set(base.id, { orderIndex: index, payload: {} });
        }
      }
      for (const [shotIndex, shot] of scene.shots.entries()) {
        const meta = planned.shots[shotIndex]!,
          old = shotBindings.get(shot.id),
          shotBase = old && bases.get(old.id);
        if (
          shot.id !== meta.id ||
          shot.orderIndex !== meta.orderIndex ||
          shot.durationSeconds !== meta.durationSeconds ||
          productionRecordFieldHash(shot.assetIds) !==
            productionRecordFieldHash(meta.assetIds) ||
          new Set(shot.sourceBlockIds).size !== shot.sourceBlockIds.length ||
          !shot.sourceBlockIds.length ||
          shot.sourceBlockIds.some(
            (id) => !scene.scriptBlockIds.includes(id),
          ) ||
          shot.assetIds.some(
            (id) => !input.candidate.assets.some((asset) => asset.id === id),
          ) ||
          (meta.retains
            ? !base ||
              !shotBase ||
              old!.id !== meta.retains.recordId ||
              old!.version !== meta.retains.version ||
              shotBase.fields.parentId !== base.id
            : Boolean(old))
        )
          throw new Error(
            "拓扑候选镜头不属于原同场复用或明确新身份／时长／资产／来源。",
          );
        if (shotBase && planned.mode === "retain") {
          if (
            shotBase.fields.orderIndex !== shot.orderIndex ||
            productionRecordFieldHash(
              shotBase.fields.payload.sourceBlockIds,
            ) !== productionRecordFieldHash(shot.sourceBlockIds) ||
            productionRecordFieldHash(shotBase.fields.payload.assetIds) !==
              productionRecordFieldHash(shot.assetIds) ||
            shotBase.fields.payload.时长 !== shot.durationSeconds
          )
            throw new Error("未选拓扑镜头改变冻结顺序、时长、资产或来源。");
        } else if (shotBase) {
          protectedWrites.set(shotBase.id, {
            sourceBlockIds: [...shot.sourceBlockIds],
          });
          shotPlanWrites.set(shotBase.id, {
            orderIndex: meta.orderIndex,
            payload: {
              镜头序号: meta.orderIndex + 1,
              时长: meta.durationSeconds,
              assetIds: [...meta.assetIds],
              角色: meta.assetIds
                .flatMap((id) =>
                  input.candidate.assets
                    .filter(
                      (asset) => asset.id === id && asset.kind === "character",
                    )
                    .map((asset) => asset.title),
                )
                .join("、"),
            },
          });
        }
      }
    }
  } else
    for (const [sceneIndex, scene] of input.candidate.scenes.entries()) {
      const binding = sceneBindings.get(scene.sceneId),
        base = binding && bases.get(binding.id);
      if (
        !base ||
        base.fields.parentId !== input.scriptId ||
        base.fields.orderIndex !== sceneIndex
      )
        throw new Error("候选与实际场景归属／顺序不符。");
      const mapping = mappings.get(scene.sceneId);
      const scenePlan = plannedScenes.get(scene.sceneId);
      if (
        shotPlan &&
        (Boolean(scenePlan) !== editable.has(base.id) ||
          (scenePlan &&
            (scenePlan.recordId !== base.id ||
              scenePlan.version !== binding!.version ||
              scenePlan.shots.length !== scene.shots.length ||
              input.bindings.some(
                (record) =>
                  record.kind === "shots" &&
                  bases.get(record.id)!.fields.parentId === base.id &&
                  !selected.has(record.id),
              ) ||
              scene.shots.some((shot, index) => {
                const planned = scenePlan.shots[index];
                return (
                  !planned ||
                  planned.id !== shot.id ||
                  planned.orderIndex !== shot.orderIndex ||
                  planned.durationSeconds !== shot.durationSeconds ||
                  productionRecordFieldHash(planned.assetIds) !==
                    productionRecordFieldHash(shot.assetIds)
                );
              }))))
      )
        throw new Error("实际场景／完整旧选择或新冻结镜头元数据不一致。");
      if (
        productionRecordFieldHash(base.fields.payload.scriptBlockIds) !==
          productionRecordFieldHash(
            mapping?.previousBlockIds ?? scene.scriptBlockIds,
          ) ||
        (mapping &&
          (productionRecordFieldHash(mapping.currentBlockIds) !==
            productionRecordFieldHash(scene.scriptBlockIds) ||
            mapping.previousBlockIds[0] !== mapping.currentBlockIds[0] ||
            productionRecordFieldHash(mapping.previousBlockIds) ===
              productionRecordFieldHash(mapping.currentBlockIds) ||
            (!shotPlan &&
              scene.shots.some(
                (shot) => !selected.has(shotBindings.get(shot.id)!.id),
              )) ||
            mapping.currentBlockIds.some(
              (id) =>
                !scene.shots.some((shot) => shot.sourceBlockIds.includes(id)),
            )))
      )
        throw new Error(
          "原／新场内块映射或完整选中范围未核全，不能覆盖保护字段。",
        );
      if (proof && editable.has(base.id))
        protectedWrites.set(base.id, { scriptBlockIds: scene.scriptBlockIds });
      for (const shot of scene.shots) {
        const planned = scenePlan?.shots.find((entry) => entry.id === shot.id);
        if (planned && !planned.retains) {
          if (
            shotBindings.has(shot.id) ||
            shot.assetIds.some(
              (id) => !input.candidate.assets.some((asset) => asset.id === id),
            ) ||
            !shot.sourceBlockIds.length ||
            new Set(shot.sourceBlockIds).size !== shot.sourceBlockIds.length ||
            shot.sourceBlockIds.some((id) => !scene.scriptBlockIds.includes(id))
          )
            throw new Error(
              "新增镜头仅绑定原冻结新身份，不补造实际原字段或外场来源。",
            );
          continue;
        }
        const shotBinding = shotBindings.get(shot.id),
          shotBase = shotBinding && bases.get(shotBinding.id);
        if (
          !shotBase ||
          shotBase.fields.parentId !== base.id ||
          (!planned && shotBase.fields.orderIndex !== shot.orderIndex) ||
          (!planned &&
            fieldValue(shotBase.fields.payload, "时长").hash !==
              fieldValue({ 时长: shot.durationSeconds }, "时长").hash) ||
          (!planned &&
            fieldValue(shotBase.fields.payload, "assetIds").hash !==
              fieldValue({ assetIds: shot.assetIds }, "assetIds").hash) ||
          (!(proof && selected.has(shotBinding!.id)) &&
            fieldValue(shotBase.fields.payload, "sourceBlockIds").hash !==
              fieldValue(
                { sourceBlockIds: shot.sourceBlockIds },
                "sourceBlockIds",
              ).hash) ||
          new Set(shot.sourceBlockIds).size !== shot.sourceBlockIds.length ||
          !shot.sourceBlockIds.length ||
          shot.sourceBlockIds.some((id) => !scene.scriptBlockIds.includes(id))
        )
          throw new Error("候选镜头身份、时长、资产或来源与实际原基准不符。");
        if (
          planned &&
          (planned.retains?.recordId !== shotBase.id ||
            planned.retains.version !== shotBase.version)
        )
          throw new Error("复用镜头与同场真实原身份／版本不符。");
        if (proof && selected.has(shotBinding!.id))
          protectedWrites.set(shotBase.id, {
            sourceBlockIds: shot.sourceBlockIds,
          });
        if (planned) {
          if (
            shot.assetIds.some(
              (id) => !input.candidate.assets.some((asset) => asset.id === id),
            )
          )
            throw new Error("冻结引用没有原方案资产定义。");
          shotPlanWrites.set(shotBase.id, {
            orderIndex: planned.orderIndex,
            payload: {
              镜头序号: planned.orderIndex + 1,
              时长: planned.durationSeconds,
              assetIds: [...planned.assetIds],
              角色: planned.assetIds
                .flatMap((id) =>
                  input.candidate.assets
                    .filter(
                      (asset) => asset.id === id && asset.kind === "character",
                    )
                    .map((asset) => asset.title),
                )
                .join("、"),
            },
          });
        }
      }
    }
  if ([...mappings.keys()].some((id) => !scenes.has(id)))
    throw new Error("已确认块映射含其他场景。");
  const currentFields = new Map<string, ProductionRecordBaseline["fields"]>();
  const units: Unit[] = [];
  for (const binding of input.bindings) {
    const base = bases.get(binding.id)!,
      row = rows.get(binding.id)!;
    const current = {
      title: row.title,
      parentId: row.parent_id,
      orderIndex: row.order_index,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    };
    const observation = observations.get(binding.id)!;
    if (!allowedChanged.has(binding.id) && observation.state !== "unchanged")
      throw new Error("未选实际记录已变化，不能将其他作者修改静默局部化。");
    if (
      current.parentId !== base.fields.parentId ||
      current.orderIndex !== base.fields.orderIndex ||
      ((shotPlan || topology) && row.version < binding.version) ||
      !current.parentId ||
      protectedFields[binding.kind].some(
        (key) =>
          fieldValue(current.payload, key).hash !==
          fieldValue(base.fields.payload, key).hash,
      )
    )
      throw new Error(
        "实际归属、顺序、时长、资产或来源结构变化，不能按创作字段合并。",
      );
    currentFields.set(binding.id, current);
    if (!editable.has(binding.id)) continue;
    const fields: ProductionRecordMergeField[] =
      binding.kind === "scenes"
        ? ["title", "场景动作"]
        : ["title", ...shotFields];
    const scene = scenes.get(binding.stableId),
      shot = shots.get(binding.stableId);
    if (binding.kind === "scenes" ? !scene : !shot)
      throw new Error("候选未覆盖实际稳定记录。");
    const candidatePayload =
      binding.kind === "scenes"
        ? { 场景动作: scene!.shots.map((shot) => shot.visualAction).join("\n") }
        : {
            镜头描述: shot!.visualAction,
            构图: shot!.composition,
            机位: shot!.camera,
            运镜: shot!.movement,
            生成提示: shot!.prompt,
            负面提示: shot!.negativePrompt,
            声音: shot!.sound,
          };
    for (const field of fields) {
      const baseValue = fieldValue(
        field === "title" ? { title: base.fields.title } : base.fields.payload,
        field,
      );
      const main = fieldValue(
        field === "title" ? { title: current.title } : current.payload,
        field,
      );
      const branch = fieldValue(
        field === "title" ? { title: base.fields.title } : candidatePayload,
        field,
      );
      units.push({
        id: `${binding.id}:${field}`,
        recordId: binding.id,
        kind: binding.kind,
        field,
        base: baseValue,
        current: main,
        candidate: branch,
        conflict:
          main.hash !== baseValue.hash &&
          branch.hash !== baseValue.hash &&
          main.hash !== branch.hash,
        defaultChoice: main.hash !== baseValue.hash ? "main" : "branch",
      });
    }
  }
  return {
    currentFields,
    protectedWrites,
    ...(shotPlan || topology ? { shotPlanWrites } : {}),
    units,
    records: report.records.map((item) => ({
      id: item.id,
      stableId: item.stableId,
      kind: item.kind,
      frozenVersion: item.frozenVersion,
      currentVersion: item.current!.version,
      frozenHash: item.frozen!.contentHash,
      currentHash: item.current!.contentHash,
      parentId: item.current!.parentId!,
      orderIndex: item.current!.orderIndex,
      editable: editable.has(item.id),
    })),
  };
}

/** Strict resolution is owner-only; the future commit still needs current
 * basis/CAS and separate review. No custom values leave through comparison. */
export function resolveProductionRecordFields(
  plan: ProductionRecordFieldPlan,
  choices: Record<string, "main" | "branch">,
) {
  const ids = new Set(plan.units.map((unit) => unit.id));
  if (
    Object.keys(choices).some(
      (id) => !ids.has(id) || !["main", "branch"].includes(choices[id]!),
    )
  )
    throw new Error("字段选择包含未知身份或无效选择。");
  const merged = new Map(
    [...plan.currentFields].map(([id, fields]) => [
      id,
      structuredClone(fields),
    ]),
  );
  for (const [id, writes] of plan.protectedWrites) {
    const fields = merged.get(id);
    if (!fields) throw new Error("已确认来源映射缺少实际记录。");
    for (const [key, ids] of Object.entries(writes))
      fields.payload[key] = [...ids];
  }
  for (const [id, writes] of plan.shotPlanWrites ?? []) {
    const fields = merged.get(id);
    if (!fields) throw new Error("冻结镜头计划缺少真实复用记录。");
    fields.orderIndex = writes.orderIndex;
    for (const [key, value] of Object.entries(writes.payload))
      Object.defineProperty(fields.payload, key, {
        value: structuredClone(value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  for (const unit of plan.units) {
    if (unit.conflict && !Object.hasOwn(choices, unit.id))
      throw new Error("请明确选择全部真实字段冲突。");
    const side = choices[unit.id] ?? unit.defaultChoice;
    const selected = side === "main" ? unit.current : unit.candidate;
    if (selected.state !== "text" || !selected.text.trim())
      throw new Error(
        "所选字段缺失或不是有效文本，不能静默恢复或删除必需字段。",
      );
    if (
      selected.text.length >
      (unit.field === "title"
        ? 240
        : unit.field === "场景动作"
          ? 4000000
          : 4000)
    )
      throw new Error(
        "所选创作字段超出正式记录／候选协议长度，不截断人工原稿。",
      );
    const fields = merged.get(unit.recordId)!;
    if (unit.field === "title") fields.title = selected.text;
    else
      Object.defineProperty(fields.payload, unit.field, {
        value: selected.text,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return merged;
}
