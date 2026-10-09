import { createHash } from "node:crypto";
import { CreationWorkflowSchema } from "@dramaip/contracts/creation";
import {
  CreationProjectLineageReceiptSchema,
  type CreationProjectLineageReceipt,
} from "@dramaip/contracts/creation-project-lineage";
import type {
  NarrativeSourceBasis,
  NarrativeContextBasis,
} from "@dramaip/contracts/creation";

const identity = ({ id, version }: { id: string; version: number }) => ({
  id,
  version,
});
const chapterIdentity = (value: {
  id: string;
  version: number;
  contentHash?: string;
  narrativeContentHash?: string;
}) => ({
  ...identity(value),
  ...(value.contentHash ? { contentHash: value.contentHash } : {}),
  ...(value.narrativeContentHash
    ? { narrativeContentHash: value.narrativeContentHash }
    : {}),
});
const reference = (value: {
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  fieldPath: string;
  contentHash: string;
}) => ({
  sourceKind: value.sourceKind,
  sourceId: value.sourceId,
  sourceVersion: value.sourceVersion,
  fieldPath: value.fieldPath,
  contentHash: value.contentHash,
});

/** Allowlist projection of the original persisted workflow. No source rereads,
 * adoption synchronization, prompt/body export, model calls or history upgrades. */
export function projectCreationLineage(
  raw: unknown,
  projectId: string,
): CreationProjectLineageReceipt {
  const value = CreationWorkflowSchema.parse(raw);
  if (value.input.projectId !== projectId)
    throw new Error("原项目谱系身份不能替换。");
  if (value.rebaseSource && value.recordMergeSource)
    throw new Error("无法核对互斥的原合并类型。");
  const frozenReferences: CreationProjectLineageReceipt["frozenReferences"] =
    [];
  const narrativeSelections: CreationProjectLineageReceipt["narrativeSelections"] =
    [];
  const chapterScopes: CreationProjectLineageReceipt["chapterScopes"] = [];
  const upstream: CreationProjectLineageReceipt["upstream"] = [];
  const contextBudgets: CreationProjectLineageReceipt["contextBudgets"] = [];
  type Origin =
    CreationProjectLineageReceipt["frozenReferences"][number]["origin"];
  const selected = (
    origin: Origin,
    basis: NarrativeSourceBasis | NarrativeContextBasis | undefined,
  ) => {
    if (!basis) return;
    narrativeSelections.push({
      origin,
      chapters: basis.chapters.map((chapter) => {
        const common = {
          ...identity(chapter),
          contentHash: chapter.contentHash,
        };
        if (chapter.representation === "summary")
          return {
            ...common,
            representation: chapter.representation,
            record: identity(chapter.record),
          };
        if (chapter.representation === "paragraphs")
          return {
            ...common,
            representation: chapter.representation,
            paragraphIds: [...chapter.paragraphIds],
          };
        return { ...common, representation: chapter.representation };
      }),
      ...(basis.summaries
        ? {
            summaries: basis.summaries.map((summary) => ({
              ...identity(summary),
              target: {
                ...identity(summary.target),
                kind: summary.target.kind,
              },
              scopeFingerprint: summary.scopeFingerprint,
              scopeState: summary.scopeState,
              chapters: summary.chapters.map((chapter) => ({
                ...identity(chapter),
                contentHash: chapter.contentHash,
              })),
            })),
          }
        : {}),
      ...(basis.story
        ? {
            story: basis.story.map((story) => ({
              selection: {
                ...identity(story.selection),
                kind: story.selection.kind,
              },
              record: { ...identity(story.record), kind: story.record.kind },
              sourceFingerprint: story.sourceFingerprint,
              sourceChapters: story.sourceChapters.map(identity),
              sourceScripts: story.sourceScripts.map(identity),
              contentHash: story.contentHash,
            })),
          }
        : {}),
      omitted: basis.omitted.map((chapter) => ({
        ...identity(chapter),
        reason: chapter.reason,
      })),
      references: basis.references.map(reference),
    });
  };
  const references = (
    origin: Origin,
    basis: { references: Parameters<typeof reference>[0][] } | undefined,
  ) => {
    if (basis)
      frozenReferences.push({
        origin,
        references: basis.references.map(reference),
      });
  };
  const scope = (
    origin: Origin,
    included:
      | readonly {
          id: string;
          version: number;
          contentHash?: string;
          narrativeContentHash?: string;
        }[]
      | undefined,
    omitted?: readonly {
      id: string;
      version: number;
      contentHash?: string;
      narrativeContentHash?: string;
    }[],
  ) => {
    if (included)
      chapterScopes.push({
        origin,
        included: included.map(chapterIdentity),
        ...(omitted ? { omitted: omitted.map(chapterIdentity) } : {}),
      });
  };
  const upstreamOf = (
    origin: Origin,
    basis:
      | {
          authorIntent?: { id: string; version: number };
          diagnosis?: { id: string; version: number };
          strategy?: { id: string; version: number };
          baseAdoptedId?: string;
          diagnosisContentHash?: string;
          strategyContentHash?: string;
        }
      | undefined,
  ) => {
    if (!basis) return;
    if (basis.authorIntent)
      upstream.push({
        origin,
        kind: "author-intent",
        ...identity(basis.authorIntent),
      });
    if (basis.diagnosis)
      upstream.push({
        origin,
        kind: "diagnosis",
        ...identity(basis.diagnosis),
        ...(basis.diagnosisContentHash
          ? { contentHash: basis.diagnosisContentHash }
          : {}),
      });
    if (basis.strategy)
      upstream.push({
        origin,
        kind: "strategy",
        ...identity(basis.strategy),
        ...(basis.strategyContentHash
          ? { contentHash: basis.strategyContentHash }
          : {}),
      });
    if (basis.baseAdoptedId)
      upstream.push({ origin, kind: "base-adopted", id: basis.baseAdoptedId });
  };
  references("author-intent", value.authorIntentBasis);
  selected("author-intent", value.authorIntentBasis?.sourceBasis);
  scope("author-intent", value.authorIntentBasis?.chapters);
  references("novel-context", value.narrativeContextBasis);
  selected("novel-context", value.narrativeContextBasis);
  references("novel-planning", value.narrativePlanningBasis);
  selected("novel-planning", value.narrativePlanningBasis?.sourceBasis);
  scope(
    "novel-planning",
    value.narrativePlanningBasis?.coverage.included,
    value.narrativePlanningBasis?.coverage.excluded,
  );
  references("production-narrative", value.productionNarrativeBasis);
  selected("production-narrative", value.productionNarrativeBasis?.sourceBasis);
  scope(
    "production-narrative",
    value.productionNarrativeBasis?.coverage.included,
    value.productionNarrativeBasis?.coverage.excluded,
  );
  references("quality", value.narrativeQualityBasis);
  selected("quality", value.narrativeQualityBasis?.sourceBasis);
  scope(
    "quality",
    value.narrativeQualityBasis?.chapterCoverage?.included,
    value.narrativeQualityBasis?.chapterCoverage?.excluded,
  );
  for (const [origin, basis] of [
    ["diagnosis", value.diagnosisBasis],
    ["strategy", value.adaptationStrategyBasis],
    ["season-plan", value.seasonPlanBasis],
  ] as const) {
    selected(origin, basis?.sourceBasis);
    scope(origin, basis?.chapters, basis?.omittedChapters);
    upstreamOf(origin, basis);
  }
  references("episode-development", value.episodeDevelopmentBasis);
  selected("episode-development", value.episodeDevelopmentBasis?.sourceBasis);
  scope("episode-development", value.episodeDevelopmentBasis?.chapters);
  upstreamOf("episode-development", value.episodeDevelopmentBasis);
  references("narrative-summary", value.narrativeSummaryBasis);
  scope("narrative-summary", value.narrativeSummaryBasis?.directory);
  for (const [origin, basis] of [
    ["novel-context", value.narrativeContextBasis],
    ["novel-planning", value.narrativePlanningBasis],
    ["production-narrative", value.productionNarrativeBasis],
  ] as const)
    if (basis?.contextBudget)
      contextBudgets.push({
        origin,
        source: basis.contextBudget.source,
        tokenBudget: basis.contextBudget.tokenBudget,
        estimatedTokens: basis.contextBudget.estimatedTokens,
      });
  const outputs: CreationProjectLineageReceipt["outputs"] = {};
  for (const key of [
    "authorIntentId",
    "diagnosisId",
    "adaptationStrategyId",
    "seasonPlanId",
    "episodeResultId",
    "narrativeReportId",
    "narrativeSummaryId",
    "previewId",
    "memoryWorkflowId",
    "adoptionCheckId",
  ] as const)
    if (value[key] !== undefined) outputs[key] = value[key];
  const rawObject = raw as Record<string, unknown>;
  return CreationProjectLineageReceiptSchema.parse({
    id: value.id,
    projectId,
    taskId: value.taskId,
    version: value.version,
    operation: value.input.operation,
    stage: value.stage,
    ...(value.input.targetId ? { targetId: value.input.targetId } : {}),
    ...(value.input.baseVersion !== undefined
      ? { baseVersion: value.input.baseVersion }
      : {}),
    ...(value.creationRequestReceipt
      ? { requestHash: value.creationRequestReceipt.requestHash }
      : {}),
    ...(value.sourceWorkflowId
      ? { sourceWorkflowId: value.sourceWorkflowId }
      : {}),

    ...(value.rebaseSource
      ? {
          mergeLineage: {
            kind: "creation-rebase",
            sourceWorkflowId: value.rebaseSource.id,
            baseVersion: value.rebaseSource.baseVersion,
            ...(value.rebaseSource.basis
              ? { comparisonBasis: structuredClone(value.rebaseSource.basis) }
              : {}),
            ...(value.rebaseSource.blockOrder
              ? { blockOrder: [...value.rebaseSource.blockOrder] }
              : {}),
            // This is explicitly derived from the persisted choice map, not an
            // invented historical original hash or a reread of current content.
            choiceFingerprint: {
              format: "derived-from-persisted-choice-map-v1",
              count: Object.keys(value.rebaseSource.choices).length,
              sha256: createHash("sha256")
                .update(
                  JSON.stringify(
                    Object.entries(value.rebaseSource.choices).sort(
                      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
                    ),
                  ),
                )
                .digest("hex"),
            },
          },
        }
      : value.recordMergeSource
        ? {
            mergeLineage: (() => {
              const source = value.recordMergeSource,
                comparison = source.comparison;
              const safeValue = ({
                state,
                hash,
              }: {
                state: string;
                hash: string;
              }) => ({ state, hash });
              return {
                kind: "storyboard-record-merge",
                sourceProjectId: source.request.projectId,
                format: source.format,
                workflow: identity(source.request.workflow),
                base: identity(source.request.base),
                episodeId: source.request.episodeId,
                comparisonHash: comparison.comparisonHash,
                candidateHash: comparison.candidateHash,
                frozenBasisHash: comparison.frozenBasisHash,
                contextHash: comparison.contextHash,
                outputHash: source.outputHash,
                ...(comparison.format !==
                "storyboard-record-field-comparison-v1"
                  ? {
                      structure: {
                        hash: comparison.structureHash,
                        script: identity(comparison.structure.script),
                        scriptRecordId: comparison.structure.scriptRecordId,
                        documentVersion: comparison.structure.documentVersion,
                      },
                    }
                  : {}),
                records: comparison.records.map((record) => ({
                  id: record.id,
                  kind: record.kind,
                  stableId: record.stableId,
                  frozenVersion: record.frozenVersion,
                  currentVersion: record.currentVersion,
                  frozenHash: record.frozenHash,
                  currentHash: record.currentHash,
                  parentId: record.parentId,
                  orderIndex: record.orderIndex,
                  editable: record.editable,
                })),
                choices: comparison.units.map((unit) => ({
                  recordId: unit.recordId,
                  kind: unit.kind,
                  field: unit.field,
                  choice: source.request.choices[unit.id],
                  base: safeValue(unit.base),
                  current: safeValue(unit.current),
                  candidate: safeValue(unit.candidate),
                })),
              };
            })(),
          }
        : {}),
    ...(value.continuationBasis
      ? {
          continuationBasis: {
            workflowPath: value.continuationBasis.workflowPath,
            source: { ...value.continuationBasis.source },
            target: { ...value.continuationBasis.target },
          },
        }
      : {}),
    ...(value.sourceSnapshotId
      ? { sourceSnapshotId: value.sourceSnapshotId }
      : {}),
    ...(value.sourceContextIntegrity
      ? { sourceContextIntegrity: { ...value.sourceContextIntegrity } }
      : {}),
    runIds: [...value.runIds],
    contextSnapshotIds: [...value.contextSnapshotIds],
    sourceVersions: value.sources.map((source) => ({
      kind: source.kind,
      id: source.id,
      version: source.version,
    })),
    referenceVersions: value.referenceVersions.map((source) => ({
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      fieldPath: source.fieldPath,
    })),
    ...(Object.hasOwn(rawObject, "contextEntries")
      ? {
          contextEntries: value.contextEntries.map((entry) => ({
            included: entry.included,
            ...(entry.estimatedTokens !== undefined
              ? { estimatedTokens: entry.estimatedTokens }
              : {}),
            ...(entry.fieldPath ? { fieldPath: entry.fieldPath } : {}),
            ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
            ...(entry.sourceVersion !== undefined
              ? { sourceVersion: entry.sourceVersion }
              : {}),
          })),
        }
      : {}),
    ...(value.authorIntent ? { authorIntent: { ...value.authorIntent } } : {}),
    outputs,
    frozenReferences,
    narrativeSelections,
    chapterScopes,
    contextBudgets,
    upstream,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}
