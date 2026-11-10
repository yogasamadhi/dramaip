import { createHash } from "node:crypto";
import {
  EpisodeScriptRevisionReceiptSchema,
  EpisodeTopologyRevisionReceiptSchema,
  type EpisodeDevelopmentResult,
  type EpisodeDevelopmentBasis,
  type EpisodeScriptContent,
  type EpisodeTopologyRevision,
  type EpisodeScriptRevision,
} from "@dramaip/contracts/production";
import { inspectEpisodeScriptContent } from "./episode-script-content.js";

type Stored = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
>;
type Revision = Omit<EpisodeTopologyRevision, "sourceState" | "staleReasons">;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string): never {
  throw new Error(message);
}
const storyIdentity = (basis: EpisodeDevelopmentBasis) => ({
  diagnosis: basis.diagnosis,
  strategy: basis.strategy,
  authorIntent: basis.authorIntent,
  episode: basis.episode,
  chapters: basis.chapters,
  sourceBasis: basis.sourceBasis,
  contextChapters: basis.contextChapters,
  direct: basis.request.direct,
  seasonPlan: basis.request.seasonPlan,
  inheritSeasonNarrative: basis.request.inheritSeasonNarrative,
  episodeNarrativeContext: basis.request.episodeNarrativeContext,
  sourceEvidenceFormat: basis.request.sourceEvidenceFormat,
  // Only the explicitly replaced formal outline is allowed to differ. All
  // original expression, intent, Bible and other frozen dependencies remain.
  references: basis.references.filter(
    (ref) =>
      !(
        ref.sourceKind === "production" &&
        ref.sourceId === basis.request.outline?.id
      ),
  ),
});

/** Owner supplies real immutable rows. This is not a current-source or actual
 * baseline check: those checks belong to the same owner at prepare/commit.
 * Every hop is checked, so cross-scene movement cannot be hidden by moving a
 * block back in a later version. No model-generated parent is guessed. */
export function inspectStoryboardTopologyAncestry(input: {
  base: Stored;
  script: Stored;
  outline: Stored;
  read(id: string): Stored | undefined;
  readRevision(id: string): Revision | undefined;
  readScriptRevision(
    id: string,
  ): Omit<EpisodeScriptRevision, "sourceState" | "staleReasons"> | undefined;
}) {
  const { base } = input;
  const originalScript = base.basis.request.script,
    originalOutline = base.basis.request.outline;
  if (
    !originalScript ||
    !originalOutline ||
    base.content.kind !== "storyboard-package"
  )
    fail("原分镜的双正式来源未核全，不推定拓扑祖先。");
  const valid = (
    value: Stored | undefined,
    operation: Stored["operation"],
  ): Stored => {
    if (
      !value ||
      value.projectId !== base.projectId ||
      value.episodeId !== base.episodeId ||
      value.operation !== operation ||
      value.content.kind !== operation
    )
      fail("场景拓扑祖先不是同一项目／分集的实际正式结果。");
    if (
      operation === "episode-script" &&
      (value.scriptId !== base.scriptId ||
        value.episodeRecordId !== base.episodeRecordId)
    )
      fail("场景拓扑祖先改变实际剧本或分集归属。");
    return value;
  };
  const old = valid(input.read(originalScript.id), "episode-script"),
    oldOutline = valid(input.read(originalOutline.id), "episode-outline");
  if (
    old.version !== originalScript.version ||
    oldOutline.version !== originalOutline.version ||
    old.scriptDocumentVersion !== base.scriptDocumentVersion ||
    old.basis.request.outline?.id !== oldOutline.id ||
    old.basis.request.outline.version !== oldOutline.version
  )
    fail("原分镜双正式版本或实际文档基准不一致。");
  const identity = hash(storyIdentity(old.basis)),
    outlineIdentity = hash(storyIdentity(oldOutline.basis));
  const seen = new Set<string>(),
    confirmedRefs: EpisodeDevelopmentBasis["references"] = [];
  const ancestors: { script: Stored; outline: Stored }[] = [];
  let script = valid(input.script, "episode-script"),
    outline = valid(input.outline, "episode-outline"),
    topologySteps = 0;
  while (true) {
    if (
      seen.has(script.id) ||
      seen.size >= 1000 ||
      hash(storyIdentity(script.basis)) !== identity ||
      hash(storyIdentity(outline.basis)) !== outlineIdentity ||
      script.basis.request.outline?.id !== outline.id ||
      script.basis.request.outline.version !== outline.version ||
      script.content.kind !== "episode-script" ||
      outline.content.kind !== "episode-outline"
    )
      fail("场景拓扑确认链循环、缺失或改变原故事／作者意图／冻结来源。");
    seen.add(script.id);
    inspectEpisodeScriptContent(script.content.value, outline.content.value);
    ancestors.push({ script, outline });
    for (const value of [script, outline])
      confirmedRefs.push({
        sourceKind: "production",
        sourceId: value.id,
        sourceVersion: value.version,
        fieldPath: `/production/${value.id}`,
        contentHash: hash(value.content.value),
      });
    if (script.id === old.id) {
      if (
        script.version !== old.version ||
        outline.id !== oldOutline.id ||
        outline.version !== oldOutline.version
      )
        fail("确认链没有回到原分镜的双正式版本。");
      break;
    }
    if (script.origin === "human-script-revision") {
      const receipt = EpisodeScriptRevisionReceiptSchema.parse(
          script.scriptRevision,
        ),
        preview = input.readScriptRevision(receipt.previewId);
      if (
        receipt.document.scriptId !== script.scriptId ||
        receipt.document.version !== script.scriptDocumentVersion ||
        receipt.contentHash !== hash(script.content.value) ||
        script.workflowId ||
        script.runIds.length ||
        !preview ||
        preview.id !== receipt.previewId ||
        preview.projectId !== base.projectId ||
        preview.episodeId !== base.episodeId ||
        preview.status !== "adopted" ||
        preview.stateVersion !== 1 ||
        preview.resultId !== script.id ||
        preview.sourceResult.id !== receipt.sourceResult.id ||
        preview.sourceResult.version !== receipt.sourceResult.version ||
        preview.outline.id !== outline.id ||
        preview.outline.version !== outline.version ||
        preview.document.id !== receipt.document.id ||
        preview.document.scriptId !== receipt.document.scriptId ||
        preview.document.version !== receipt.document.version ||
        preview.scriptRecordVersion !== receipt.scriptRecordVersion ||
        preview.contentHash !== receipt.contentHash ||
        hash(preview.content) !== receipt.contentHash ||
        preview.sourceSnapshotId !== script.sourceSnapshotId ||
        hash(preview.confirmation) !== hash(receipt.humanReview) ||
        hash(preview.basis) !== hash(script.basis)
      )
        fail("原场内人工确认回执与实际正式快照不一致。");
      const parent = valid(
        input.read(receipt.sourceResult.id),
        "episode-script",
      );
      if (
        parent.version !== receipt.sourceResult.version ||
        parent.sourceSnapshotId !== script.sourceSnapshotId ||
        parent.scriptDocumentVersion === undefined ||
        receipt.document.version <= parent.scriptDocumentVersion
      )
        fail("场内人工确认没有保留实际父版本和原快照。");
      confirmedRefs.push({
        sourceKind: "production",
        sourceId: preview.id,
        sourceVersion: preview.stateVersion,
        fieldPath: `/production/${preview.id}`,
        contentHash: hash(preview),
      });
      script = parent;
    } else if (script.origin === "human-topology-revision") {
      const receipt = EpisodeTopologyRevisionReceiptSchema.parse(
          script.topologyRevision,
        ),
        preview = input.readRevision(receipt.previewId);
      if (
        outline.origin !== "human-topology-revision" ||
        hash(outline.topologyRevision) !== hash(receipt) ||
        receipt.results.script.id !== script.id ||
        receipt.results.script.version !== script.version ||
        receipt.results.outline.id !== outline.id ||
        receipt.results.outline.version !== outline.version ||
        receipt.scriptContentHash !== hash(script.content.value) ||
        receipt.outlineContentHash !== hash(outline.content.value) ||
        receipt.document.scriptId !== script.scriptId ||
        receipt.document.version !== script.scriptDocumentVersion ||
        script.sourceSnapshotId !== receipt.inheritedSnapshots.script ||
        outline.sourceSnapshotId !== receipt.inheritedSnapshots.outline ||
        script.workflowId ||
        outline.workflowId ||
        script.runIds.length ||
        outline.runIds.length ||
        !preview ||
        preview.id !== receipt.previewId ||
        preview.projectId !== base.projectId ||
        preview.episodeId !== base.episodeId ||
        preview.status !== "adopted" ||
        preview.stateVersion !== 1 ||
        hash(preview.results) !== hash(receipt.results) ||
        hash(preview.sourceScript) !== hash(receipt.sourceScript) ||
        hash(preview.sourceOutline) !== hash(receipt.sourceOutline) ||
        hash(preview.confirmation) !== hash(receipt.humanReview) ||
        preview.document.id !== receipt.document.id ||
        preview.document.scriptId !== receipt.document.scriptId ||
        preview.document.version !== receipt.document.version ||
        hash(preview.inheritedSnapshots) !== hash(receipt.inheritedSnapshots) ||
        preview.scriptContentHash !== receipt.scriptContentHash ||
        preview.outlineContentHash !== receipt.outlineContentHash ||
        preview.scriptRecordHash !== receipt.scriptRecordHash ||
        preview.scriptRecordVersion !== receipt.scriptRecordVersion ||
        hash(preview.scriptContent) !== receipt.scriptContentHash ||
        hash(preview.outlineContent) !== receipt.outlineContentHash ||
        hash(preview.outlineBasis) !== hash(outline.basis)
      )
        fail("双正式实际采用记录、不可变内容或原人工确认回执未核全。");
      const parent = valid(
          input.read(receipt.sourceScript.id),
          "episode-script",
        ),
        parentOutline = valid(
          input.read(receipt.sourceOutline.id),
          "episode-outline",
        );
      if (
        parent.version !== receipt.sourceScript.version ||
        parentOutline.version !== receipt.sourceOutline.version ||
        parent.sourceSnapshotId !== script.sourceSnapshotId ||
        parentOutline.sourceSnapshotId !== outline.sourceSnapshotId ||
        hash(preview.scriptBasis) !== hash(parent.basis) ||
        hash(preview.outlineBasis) !== hash(parentOutline.basis) ||
        parent.scriptDocumentVersion === undefined ||
        receipt.document.version <= parent.scriptDocumentVersion
      )
        fail("双正式人工确认父版本、冻结基准或继承快照不一致。");
      confirmedRefs.push({
        sourceKind: "production",
        sourceId: preview.id,
        sourceVersion: preview.stateVersion,
        fieldPath: `/production/${preview.id}`,
        contentHash: hash(preview),
      });
      script = parent;
      outline = parentOutline;
      topologySteps++;
    } else fail("新正式剧本不是原分镜的可核全人工拓扑确认链，不自动换源。");
  }
  if (!topologySteps)
    fail("缺少明确双正式场景拓扑确认，须使用原场内重做协议。");
  for (let index = ancestors.length - 1; index > 0; index--) {
    const previous = ancestors[index]!.script.content
        .value as EpisodeScriptContent,
      next = ancestors[index - 1]!.script.content.value as EpisodeScriptContent;
    const blocks = new Map(
        previous.sceneLinks.flatMap((link) =>
          link.blockIds.map((id) => [id, link.sceneId] as const),
        ),
      ),
      scenes = new Map(
        previous.sceneLinks.map((link) => [link.sceneId, link.blockIds[0]]),
      );
    for (const link of next.sceneLinks) {
      if (
        (scenes.has(link.sceneId) &&
          scenes.get(link.sceneId) !== link.blockIds[0]) ||
        link.blockIds.some(
          (id) => blocks.has(id) && blocks.get(id) !== link.sceneId,
        )
      )
        fail(
          "实际确认祖先曾改变稳定标题身份或跨场移动旧块，不按最终值掩盖历史。",
        );
    }
  }
  return {
    old,
    oldOutline,
    confirmedRefs: [
      ...new Map(confirmedRefs.map((ref) => [ref.sourceId, ref])).values(),
    ],
    topologySteps,
  };
}
