import { createHash } from "node:crypto";
import { z } from "zod";
import {
  EpisodeScriptContentSchema,
  ScreenplayBlockSchema,
  type EpisodeDevelopmentImpact,
  type EpisodeDevelopmentResult,
  type EpisodeImpactReason,
  type EpisodeScriptContent,
  type ScreenplayBlock,
  type StoryboardPackageContent,
} from "@dramaip/contracts/production";

type Binding = NonNullable<
  EpisodeDevelopmentResult["productionRecords"]
>[number];
export interface ImpactRecord {
  id: string;
  kind: string;
  version: number;
  parentId: string | null;
  stableId: unknown;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Source locations are parser metadata, not creative content. Canonical fields
// also avoid mistaking JSON key order for a changed block.
const expression = (block: ScreenplayBlock) => ({
  type: block.type,
  text: "text" in block ? block.text : null,
  sceneNumber: "sceneNumber" in block ? (block.sceneNumber ?? null) : null,
});
const contextTypes = new Set([
  "scene_heading",
  "character",
  "parenthetical",
  "transition",
]);

/** Mechanical associations only; never certifies that an untouched shot is
 * semantically safe, re-adopts an edited script or changes downstream records. */
export function inspectEpisodeImpact(input: {
  frozenScript: unknown;
  currentBlocks: unknown;
  storyboard: StoryboardPackageContent;
  bindings: Binding[];
  records: ImpactRecord[];
  scriptId: string | undefined;
  globalReviewReasons: string[];
  // Only exact reasons covered by an actual verified formal source transition.
  // They remain visible and require full author review; new AST/record/read
  // uncertainties are never suppressed by this owner-supplied set.
  confirmedSourceReviewReasons?: string[];
  // Actual final formal manuscript from a completely verified human source
  // transition only. Never accept this mapping from a public request/review.
  confirmedCurrentScript?: EpisodeScriptContent;
}): Pick<
  EpisodeDevelopmentImpact,
  "blockChanges" | "shots" | "globalReviewReasons"
> {
  const globalReviewReasons = [...input.globalReviewReasons];
  const frozen = EpisodeScriptContentSchema.safeParse(input.frozenScript);
  const actual = z
    .array(ScreenplayBlockSchema)
    .max(10000)
    .safeParse(input.currentBlocks);
  const scenes = input.storyboard.scenes;
  const confirmed = input.confirmedCurrentScript
    ? EpisodeScriptContentSchema.safeParse(input.confirmedCurrentScript)
    : undefined;
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  let mappingValid = frozen.success && actual.success;
  if (frozen.success && actual.success) {
    const frozenBlocks = new Map(
      frozen.data.blocks.map((block) => [block.id, block]),
    );
    mappingValid =
      unique(frozen.data.blocks.map((block) => block.id)) &&
      unique(actual.data.map((block) => block.id)) &&
      unique(scenes.map((scene) => scene.sceneId)) &&
      unique(scenes.flatMap((scene) => scene.shots.map((shot) => shot.id))) &&
      frozen.data.sceneLinks.length === scenes.length &&
      JSON.stringify(
        frozen.data.sceneLinks.flatMap((link) => link.blockIds),
      ) === JSON.stringify(frozen.data.blocks.map((block) => block.id)) &&
      scenes.every((scene, index) => {
        const link = frozen.data.sceneLinks[index]!;
        const group = link.blockIds.map((id) => frozenBlocks.get(id));
        return (
          link.sceneId === scene.sceneId &&
          JSON.stringify(link.blockIds) ===
            JSON.stringify(scene.scriptBlockIds) &&
          group[0]?.type === "scene_heading" &&
          group
            .slice(1)
            .every((block) => block && block.type !== "scene_heading") &&
          scene.shots.every(
            (shot) =>
              unique(shot.sourceBlockIds) &&
              shot.sourceBlockIds.every((id) => link.blockIds.includes(id)),
          ) &&
          link.blockIds.every((id) =>
            scene.shots.some((shot) => shot.sourceBlockIds.includes(id)),
          )
        );
      });
  }
  if (!mappingValid)
    globalReviewReasons.push(
      "实际剧本缺失、重复稳定标识或冻结场景映射未核全；不猜测局部范围。",
    );
  let confirmedMappingValid = false;
  if (confirmed?.success && actual.success) {
    const byId = new Map(
      confirmed.data.blocks.map((block) => [block.id, block]),
    );
    confirmedMappingValid =
      hash(confirmed.data.blocks) === hash(actual.data) &&
      unique(confirmed.data.blocks.map((block) => block.id)) &&
      unique(confirmed.data.sceneLinks.map((link) => link.sceneId)) &&
      JSON.stringify(
        confirmed.data.sceneLinks.flatMap((link) => link.blockIds),
      ) === JSON.stringify(actual.data.map((block) => block.id)) &&
      confirmed.data.sceneLinks.every((link) => {
        const group = link.blockIds.map((id) => byId.get(id));
        return (
          group[0]?.type === "scene_heading" &&
          group
            .slice(1)
            .every((block) => block && block.type !== "scene_heading")
        );
      });
  }
  if (input.confirmedCurrentScript && !confirmedMappingValid)
    globalReviewReasons.push(
      "当前正式人工来源的实际连续映射未核全，不回退原标题猜测范围。",
    );

  const blockChanges: EpisodeDevelopmentImpact["blockChanges"] = [];
  const sceneReasons = new Map<string, Set<EpisodeImpactReason>>();
  const sceneChanges = new Map<string, Set<string>>();
  const markScene = (
    sceneId: string,
    blockId: string,
    reason: EpisodeImpactReason,
  ) => {
    const reasons = sceneReasons.get(sceneId) ?? new Set();
    reasons.add(reason);
    sceneReasons.set(sceneId, reasons);
    const changes = sceneChanges.get(sceneId) ?? new Set();
    changes.add(blockId);
    sceneChanges.set(sceneId, changes);
  };
  if (mappingValid && frozen.success && actual.success) {
    const before = new Map(
      frozen.data.blocks.map((block) => [block.id, block]),
    );
    const after = new Map(actual.data.map((block) => [block.id, block]));
    const oldScene = new Map(
      frozen.data.sceneLinks.flatMap((link) =>
        link.blockIds.map((id) => [id, link.sceneId] as const),
      ),
    );
    const headings = new Map(
      (confirmedMappingValid && confirmed?.success
        ? confirmed.data
        : frozen.data
      ).sceneLinks.map((link) => [link.blockIds[0]!, link.sceneId]),
    );
    if (
      !confirmedMappingValid &&
      [...headings.keys()].some((id) => after.get(id)?.type !== "scene_heading")
    )
      globalReviewReasons.push(
        "原场景标题已移除或改变类型；连续场景映射需重新确认。",
      );
    const newScene = new Map<string, string>();
    let activeScene: string | undefined;
    for (const block of actual.data) {
      if (block.type === "scene_heading") activeScene = headings.get(block.id);
      if (activeScene) newScene.set(block.id, activeScene);
      else
        globalReviewReasons.push(
          "新增场景标题、场景标题移除或场景外剧本块不能绑定原场景；全包需复核。",
        );
    }
    const commonBefore = frozen.data.blocks
      .filter((block) => after.has(block.id))
      .map((block) => block.id);
    const commonAfter = actual.data
      .filter((block) => before.has(block.id))
      .map((block) => block.id);
    const beforeOrder = new Map(commonBefore.map((id, index) => [id, index]));
    const afterOrder = new Map(commonAfter.map((id, index) => [id, index]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const left = before.get(id);
      const right = after.get(id);
      const fields: EpisodeDevelopmentImpact["blockChanges"][number]["fields"] =
        [];
      if (left && right) {
        const a = expression(left),
          b = expression(right);
        for (const field of ["type", "text", "sceneNumber"] as const)
          if (a[field] !== b[field]) fields.push(field);
        if (beforeOrder.get(id) !== afterOrder.get(id)) fields.push("order");
      }
      if (left && right && !fields.length) continue;
      const change = {
        blockId: id,
        kind: !left
          ? ("added" as const)
          : !right
            ? ("removed" as const)
            : fields.some((field) => field !== "order")
              ? ("changed" as const)
              : ("reordered" as const),
        fields,
        beforeHash: left ? hash(expression(left)) : null,
        afterHash: right ? hash(expression(right)) : null,
      };
      blockChanges.push(change);
      const structural =
        !left || !right || fields.includes("type") || fields.includes("order");
      const contextual =
        contextTypes.has(left?.type ?? "") ||
        contextTypes.has(right?.type ?? "");
      if (structural || contextual) {
        const linkedScenes = new Set([oldScene.get(id), newScene.get(id)]);
        for (const sceneId of linkedScenes)
          if (sceneId)
            markScene(
              sceneId,
              id,
              structural ? "scene-structure-changed" : "scene-context-changed",
            );
      }
      if (right && oldScene.has(id) && oldScene.get(id) !== newScene.get(id))
        globalReviewReasons.push(
          "实际稳定块跨越原场景或不再属于原场景；原连续映射需重新确认。",
        );
    }
  }
  const reasons = [...new Set(globalReviewReasons)];
  const confirmedReasons = new Set(input.confirmedSourceReviewReasons ?? []);
  const unresolvedReasons = reasons.filter(
    (reason) => !confirmedReasons.has(reason),
  );
  const binding = (kind: Binding["kind"], stableId: string) => {
    const values = input.bindings.filter(
      (item) => item.kind === kind && item.stableId === stableId,
    );
    return values.length === 1 &&
      input.bindings.filter((item) => item.id === values[0]!.id).length === 1
      ? values[0]
      : undefined;
  };
  const record = (value: Binding | undefined, parentId: string | undefined) => {
    const values = input.records.filter((item) => item.id === value?.id);
    const row = values.length === 1 ? values[0] : undefined;
    return row &&
      value &&
      row.kind === value.kind &&
      row.stableId === value.stableId &&
      parentId &&
      row.parentId === parentId
      ? row
      : undefined;
  };
  const shots: EpisodeDevelopmentImpact["shots"] = scenes.flatMap((scene) => {
    const sceneBinding = binding("scenes", scene.sceneId);
    const sceneRecord = record(sceneBinding, input.scriptId);
    return scene.shots.map((shot) => {
      const shotBinding = binding("shots", shot.id);
      const shotRecord = record(shotBinding, sceneBinding?.id);
      const reasonCodes = new Set<EpisodeImpactReason>(
        sceneReasons.get(scene.sceneId),
      );
      const changedBlockIds = new Set(sceneChanges.get(scene.sceneId));
      for (const change of blockChanges)
        if (shot.sourceBlockIds.includes(change.blockId)) {
          reasonCodes.add("source-block-changed");
          changedBlockIds.add(change.blockId);
        }
      if (!sceneBinding || !shotBinding) reasonCodes.add("mapping-unresolved");
      if (!sceneRecord || !shotRecord) reasonCodes.add("record-unavailable");
      if (sceneRecord && sceneRecord.version !== sceneBinding!.version)
        reasonCodes.add("scene-record-changed");
      if (shotRecord && shotRecord.version !== shotBinding!.version)
        reasonCodes.add("shot-record-changed");
      if (unresolvedReasons.length) reasonCodes.add("upstream-not-localized");
      const unresolved =
        unresolvedReasons.length ||
        reasonCodes.has("mapping-unresolved") ||
        reasonCodes.has("record-unavailable");
      return {
        sceneId: scene.sceneId,
        shotId: shot.id,
        record: shotBinding
          ? {
              id: shotBinding.id,
              frozenVersion: shotBinding.version,
              currentVersion: shotRecord?.version ?? null,
            }
          : null,
        associationImpact: unresolved
          ? ("unresolved" as const)
          : reasonCodes.size
            ? ("affected" as const)
            : ("no-observed-change" as const),
        changedBlockIds: [...changedBlockIds],
        reasonCodes: [...reasonCodes],
      };
    });
  });
  return { blockChanges, shots, globalReviewReasons: reasons };
}
