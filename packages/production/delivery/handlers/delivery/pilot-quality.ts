import {
  ProductionQualitySourceSchema,
  type EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import {
  NarrativeQualityAssessmentSchema,
  type NarrativeQualityAssessment,
  type NarrativeQualityRequest,
} from "@dramaip/contracts/creative-quality";
import { pilotHash } from "./pilot-files.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const same = (left: unknown, right: unknown) =>
  pilotHash(JSON.stringify(canonical(left)) ?? "undefined") ===
  pilotHash(JSON.stringify(canonical(right)) ?? "undefined");
function fail(): never {
  // Do not include source text or a failed provider response in public errors.
  throw new Error("实际保存剧本／场景与正式试制内容无法精确核对。");
}

/** Supplemental saved-source reports cannot replace the three formal scopes. */
export function pilotProductionQuality(input: {
  projectId: string;
  script: EpisodeDevelopmentResult;
  storyboard: EpisodeDevelopmentResult;
  readSource(id: string): unknown;
  assess(target: NarrativeQualityRequest["target"]): unknown;
  onTarget?(target: NarrativeQualityRequest["target"]): void;
}): NarrativeQualityAssessment[] {
  const { script, storyboard, projectId } = input;
  if (
    script.projectId !== projectId ||
    storyboard.projectId !== projectId ||
    script.content.kind !== "episode-script" ||
    storyboard.content.kind !== "storyboard-package" ||
    !script.scriptId ||
    storyboard.scriptId !== script.scriptId ||
    storyboard.scriptDocumentVersion !== script.scriptDocumentVersion
  )
    fail();
  // Capture narrowed values before any callbacks; no generic record lookup or latest target.
  const scriptContent = script.content.value;
  const storyboardContent = storyboard.content.value;
  const bindings = (storyboard.productionRecords ?? []).filter(
    (binding) => binding.kind === "scenes",
  );
  if (
    bindings.length !== storyboardContent.scenes.length ||
    new Set(bindings.map((binding) => binding.id)).size !== bindings.length ||
    new Set(bindings.map((binding) => binding.stableId)).size !==
      bindings.length
  )
    fail();
  const assessments: NarrativeQualityAssessment[] = [];
  for (const binding of [
    { id: script.scriptId, kind: "script" as const },
    ...bindings.map((binding) => ({ ...binding, kind: "scene" as const })),
  ]) {
    const parsed = ProductionQualitySourceSchema.safeParse(
      input.readSource(binding.id),
    );
    if (!parsed.success) fail();
    const source = parsed.data;
    if (
      source.projectId !== projectId ||
      source.id !== binding.id ||
      source.kind !== binding.kind ||
      source.source.state !== "available"
    )
      fail();
    const actual = source.source;
    if (binding.kind === "script") {
      if (
        actual.record.parentId !== script.episodeRecordId ||
        actual.document?.version !== script.scriptDocumentVersion ||
        !same(actual.document?.blocks, scriptContent.blocks)
      )
        fail();
    } else {
      const scene = storyboardContent.scenes.find(
        (scene) => scene.sceneId === binding.stableId,
      );
      if (
        !scene ||
        source.version !== binding.version ||
        actual.record.parentId !== script.scriptId ||
        !same(actual.record.payload.scriptBlockIds, scene.scriptBlockIds) ||
        actual.record.payload["场景动作"] !==
          scene.shots.map((shot) => shot.visualAction).join("\n") ||
        ["对白与备注", "地点与时间"].some(
          (key) => actual.record.payload[key] !== undefined,
        )
      )
        fail();
    }
    const target: NarrativeQualityRequest["target"] = {
      kind: binding.kind,
      id: source.id,
      version: source.version,
      sourceFingerprint: actual.contentHash,
    };
    const assessment = NarrativeQualityAssessmentSchema.safeParse(
      input.assess(target),
    );
    if (!assessment.success || !same(assessment.data.target, target)) fail();
    input.onTarget?.(target);
    // Empty supplemental assessments must not upgrade historical fingerprints,
    // or downgrade a separately covered formal scope to an invented requirement.
    if (assessment.data.reports.length) assessments.push(assessment.data);
  }
  return assessments;
}
