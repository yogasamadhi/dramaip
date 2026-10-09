import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PRODUCTION_PROJECT_LINEAGE_SERVICE,
  ProductionProjectLineageItemSchema,
  ProductionProjectLineagePageSchema,
} from "@dramaip/contracts/creation-project-lineage";
import {
  EpisodeDevelopmentResultSchema,
  StoryboardAttributionSchema,
  ScreenplayBlockSchema,
} from "@dramaip/contracts/production";
import {
  provideService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
const identity = ({ id, version }: { id: string; version: number }) => ({
  id,
  version,
});
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parentKinds: Record<string, string> = {
  episodes: "adaptations",
  scripts: "episodes",
  scenes: "scripts",
  shots: "scenes",
};
function record(tx: UnitOfWorkTransaction, row: Record<string, unknown>) {
  const parent = row.parent_id
    ? tx.get<{ id: string; kind: string; version: number }>(
        "SELECT id,kind,version FROM production_records WHERE id=? AND project_id=?",
        row.parent_id,
        row.project_id,
      )
    : undefined;
  const value: Record<string, unknown> = {
    kind: "record",
    id: row.id,
    projectId: row.project_id,
    recordKind: row.kind,
    version: row.version,
    orderIndex: row.order_index,
    observation: "current-saved-row-not-historical-proof",
    parent: row.parent_id
      ? parent && parent.kind === parentKinds[String(row.kind)]
        ? { state: "available", ...parent }
        : { state: "unresolved", id: row.parent_id }
      : { state: "none" },
  };
  if (row.retired_result_id || row.retired_at)
    value.retirement = {
      resultId: row.retired_result_id,
      retiredAt: row.retired_at,
      ...(row.retired_reason ? { reason: row.retired_reason } : {}),
    };
  if (row.kind === "scripts") {
    const document = tx.get<Record<string, unknown>>(
      "SELECT * FROM screenplay_documents WHERE script_record_id=?",
      row.id,
    );
    if (!document)
      value.document = {
        state: "unavailable",
        reason: "saved-document-missing",
      };
    else
      try {
        const blocks = z
          .array(ScreenplayBlockSchema)
          .parse(JSON.parse(String(document.blocks_json)));
        if (
          document.project_id !== row.project_id ||
          document.script_record_id !== row.id ||
          new Set(blocks.map((block) => block.id)).size !== blocks.length
        )
          throw Error("Invalid saved structure");
        value.document = {
          state: "available",
          id: document.id,
          version: document.version,
          sourceFormat: document.source_format,
          blocks: blocks.map((block, index) => ({
            id: block.id,
            type: block.type,
            index,
          })),
          fingerprint: {
            format: "derived-current-saved-document-v1",
            sha256: hash({
              id: document.id,
              projectId: document.project_id,
              scriptId: document.script_record_id,
              version: document.version,
              sourceFormat: document.source_format,
              blocksJson: document.blocks_json,
              lossReportJson: document.loss_report_json,
            }),
          },
        };
      } catch {
        value.document = {
          state: "unavailable",
          reason: "invalid-saved-document",
        };
      }
  }
  return ProductionProjectLineageItemSchema.parse(value);
}
function result(row: Record<string, unknown>) {
  const raw = JSON.parse(String(row.value_json));
  // These validation-only read-state placeholders are never exported, written,
  // or treated as current/semantic evidence. Original optional fields stay absent.
  const value = EpisodeDevelopmentResultSchema.parse({
    ...raw,
    isCurrent: false,
    sourceState: "stale",
    staleReasons: [],
  });
  if (
    value.id !== row.id ||
    value.projectId !== row.project_id ||
    value.version !== row.version ||
    value.operation !== row.operation ||
    value.episodeId !== row.episode_key ||
    value.adoptedAt !== row.adopted_at ||
    value.workflowId !== (row.workflow_id ?? undefined)
  )
    throw Error("Invalid original owner receipt");
  const parents: Record<string, unknown> = Object.fromEntries(
    ["outline", "script", "seasonPlan"].flatMap((key) => {
      const ref = (value.basis.request as unknown as Record<string, unknown>)[
        key
      ];
      return ref
        ? [[key, identity(ref as { id: string; version: number })]]
        : [];
    }),
  );
  for (const key of [
    "baseOutlineId",
    "baseScriptId",
    "baseScriptDocumentVersion",
    "baseStoryboardId",
    "direct",
  ]) {
    const original = (
      value.basis.request as unknown as Record<string, unknown>
    )[key];
    if (original !== undefined) parents[key] = original;
  }
  const confirmation =
    value.scriptRevision ?? value.topologyRevision ?? value.sourceRevision;
  const authorConfirmation = confirmation
    ? {
        kind: value.origin,
        previewId: confirmation.previewId,
        document: confirmation.document,
        ...("sourceResult" in confirmation
          ? { sourceResult: confirmation.sourceResult }
          : {}),
        ...("sourceScript" in confirmation
          ? { sourceScript: confirmation.sourceScript }
          : {}),
        ...("sourceOutline" in confirmation
          ? { sourceOutline: confirmation.sourceOutline }
          : {}),
        ...("results" in confirmation ? { results: confirmation.results } : {}),
        semanticVerification: confirmation.semanticVerification,
      }
    : undefined;
  return ProductionProjectLineageItemSchema.parse({
    kind: "formal-result",
    id: value.id,
    projectId: value.projectId,
    version: value.version,
    episodeId: value.episodeId,
    operation: value.operation,
    ...(value.origin ? { origin: value.origin } : {}),
    ...(value.workflowId ? { workflowId: value.workflowId } : {}),
    adoptedAt: value.adoptedAt,
    sourceSnapshotId: value.sourceSnapshotId,
    ...(value.sourceContextIntegrity
      ? { sourceContextIntegrity: value.sourceContextIntegrity }
      : {}),
    runIds: value.runIds,
    ...(value.scriptId ? { scriptId: value.scriptId } : {}),
    ...(value.episodeRecordId
      ? { episodeRecordId: value.episodeRecordId }
      : {}),
    ...(value.scriptDocumentVersion !== undefined
      ? { scriptDocumentVersion: value.scriptDocumentVersion }
      : {}),
    references: value.basis.references.map(
      ({ sourceKind, sourceId, sourceVersion, fieldPath, contentHash }) => ({
        sourceKind,
        sourceId,
        sourceVersion,
        fieldPath,
        contentHash,
      }),
    ),
    ...(value.productionRecords
      ? { productionRecords: value.productionRecords }
      : {}),
    parents,
    ...(authorConfirmation ? { authorConfirmation } : {}),
    ...(value.content.kind === "episode-script"
      ? {
          sceneBlocks: value.content.value.sceneLinks.map(
            ({ sceneId, blockIds }) => ({ sceneId, blockIds }),
          ),
        }
      : {}),
    ...(value.content.kind === "storyboard-package"
      ? {
          shotBlocks: value.content.value.scenes.flatMap((scene) =>
            scene.shots.map((shot) => ({
              sceneId: scene.sceneId,
              shotId: shot.id,
              blockIds: shot.sourceBlockIds,
            })),
          ),
        }
      : {}),
    ...(value.sourceEvidence ? { evidence: value.sourceEvidence } : {}),
    semanticVerification: "unverified",
  });
}
function attribution(row: Record<string, unknown>) {
  const value = StoryboardAttributionSchema.parse({
    ...JSON.parse(String(row.value_json)),
    isCurrent: false,
    sourceState: "unavailable",
    sourceReasons: [],
  });
  if (
    value.id !== row.id ||
    value.projectId !== row.project_id ||
    value.version !== row.version ||
    value.source.storyboard.id !== row.storyboard_id ||
    value.createdAt !== row.created_at ||
    value.updatedAt !== row.updated_at
  )
    throw Error("Invalid original attribution receipt");
  return ProductionProjectLineageItemSchema.parse({
    kind: "shot-attribution",
    id: value.id,
    projectId: value.projectId,
    version: value.version,
    status: value.status,
    origin: value.origin,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.adoptedAt ? { adoptedAt: value.adoptedAt } : {}),
    storyboard: identity(value.source.storyboard),
    outline: identity(value.source.outline),
    script: identity(value.source.script),
    document: value.source.document,
    sourceFingerprint: value.source.sourceFingerprint,
    associationFingerprint: value.associationFingerprint,
    links: value.links.map(
      ({ sceneId, shotId, blockIds, evidence, storyNode }) => {
        const { match, ...source } = evidence;
        return {
          sceneId,
          shotId,
          blockIds,
          evidence: { ...source, matches: [match] },
          ...(storyNode ? { storyNode } : {}),
        };
      },
    ),
    coverage: value.coverage,
    semanticVerification: "unverified",
  });
}
export function registerProductionProjectLineage(context: PluginContext) {
  const tables = {
    records: "production_records",
    results: "production_episode_results",
    attributions: "production_storyboard_attributions",
  };
  const service = {
    list(
      projectId: string,
      category: "records" | "results" | "attributions",
      options: { cursor?: string; limit: number },
    ) {
      z.string().uuid().parse(projectId);
      z.enum(["records", "results", "attributions"]).parse(category);
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100),
      })
        .strict()
        .parse(options);
      return context.uow.execute((tx) => {
        const table = tables[category];
        if (
          options.cursor &&
          !tx.get(
            "SELECT id FROM " + table + " WHERE id=? AND project_id=?",
            options.cursor,
            projectId,
          )
        )
          throw Error("Invalid original owner cursor");
        const rows = tx.all<Record<string, unknown>>(
          "SELECT * FROM " +
            table +
            " WHERE project_id=?" +
            (options.cursor ? " AND id>?" : "") +
            " ORDER BY id LIMIT ?",
          projectId,
          ...(options.cursor ? [options.cursor] : []),
          options.limit + 1,
        );
        const selected = rows.slice(0, options.limit);
        return ProductionProjectLineagePageSchema.parse({
          category,
          items: selected.map((row) =>
            category === "records"
              ? record(tx, row)
              : category === "results"
                ? result(row)
                : attribution(row),
          ),
          ...(rows.length > options.limit
            ? { nextCursor: selected.at(-1)!.id }
            : {}),
        });
      });
    },
  };
  context.effect(
    () => provideService(context, PRODUCTION_PROJECT_LINEAGE_SERVICE, service),
    "service:" + PRODUCTION_PROJECT_LINEAGE_SERVICE.id,
  );
}
