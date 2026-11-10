import { createHash } from "node:crypto";
import {
  canonicalImportRequestJSON,
  ProductionImportBatchInputSchema,
  ProductionImportBatchReceiptSchema,
  ProductionRecordInputSchema,
  type ProductionRecord,
  type ProductionRecordKind,
  type ProductionRecordInput,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import type {
  PluginContext,
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const productionImportBatchMigration: PluginMigration = {
  id: "production.0013.ordinary-import-batches",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0012.storyboard-record-retirement"],
  sql: `CREATE TABLE production_import_batches (
    import_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
    created_at TEXT NOT NULL
  );`,
};

export function productionImportBatch(
  context: PluginContext,
  create: (
    tx: UnitOfWorkTransaction,
    kind: ProductionRecordKind,
    input: ProductionRecordInput,
  ) => ProductionRecord,
  projectExists: (id: string) => boolean,
): ProductionRecordService["importBatch"] {
  return (raw) => {
    const parsed = ProductionImportBatchInputSchema.safeParse(raw);
    if (!parsed.success || !projectExists(parsed.data.projectId))
      return { state: "conflict" };
    const input = parsed.data;
    const hash = createHash("sha256")
      .update(canonicalImportRequestJSON(input))
      .digest("hex");
    return context.uow.execute((tx) => {
      const old = tx.get<{
        project_id: string;
        request_hash: string;
        receipt_json: string;
      }>(
        "SELECT project_id, request_hash, receipt_json FROM production_import_batches WHERE import_id = ?",
        input.importId,
      );
      if (old) {
        if (old.project_id !== input.projectId || old.request_hash !== hash)
          return { state: "conflict" as const };
        try {
          const receipt = ProductionImportBatchReceiptSchema.parse(
            JSON.parse(old.receipt_json),
          );
          if (
            receipt.importId !== input.importId ||
            receipt.projectId !== input.projectId ||
            receipt.episodes.length !== input.episodes.length ||
            receipt.episodes.some(
              (episode, index) =>
                episode.sourceKey !== input.episodes[index]?.sourceKey ||
                episode.sceneIds.length !==
                  input.episodes[index]?.scenes.length,
            )
          )
            return { state: "conflict" as const };
          return { state: "committed" as const, receipt };
        } catch {
          return { state: "conflict" as const };
        }
      }
      const write = (
        kind: ProductionRecordKind,
        value: ProductionRecordInput,
      ) => create(tx, kind, ProductionRecordInputSchema.parse(value));
      const adaptation = write("adaptations", {
        projectId: input.projectId,
        title: `${input.title}·导入改编方案`,
        payload: {
          改编方向: "结构化剧本导入",
          目标集数: input.episodes.length,
          来源文件: input.sourceName,
        },
      });
      const episodes = input.episodes.map((source) => {
        const episode = write("episodes", {
          projectId: input.projectId,
          parentId: adaptation.id,
          title: source.title,
          payload: {
            集数: source.episodeNumber,
            分集简介: source.content.slice(0, 240),
            导入来源: input.sourceName,
          },
        });
        const script = write("scripts", {
          projectId: input.projectId,
          parentId: episode.id,
          title: `${source.title}剧本`,
          payload: {
            关联分集: source.title,
            剧本内容: source.content,
            导入来源: input.sourceName,
          },
        });
        const sceneIds = source.scenes.map(
          (scene, index) =>
            write("scenes", {
              projectId: input.projectId,
              parentId: script.id,
              title:
                typeof scene.title === "string" && scene.title.trim()
                  ? scene.title.trim()
                  : `场景 ${index + 1}`,
              payload: { ...scene, 场景顺序: index + 1 },
            }).id,
        );
        return {
          sourceKey: source.sourceKey,
          episodeId: episode.id,
          scriptId: script.id,
          sceneIds,
          version: 0,
        };
      });
      const receipt = ProductionImportBatchReceiptSchema.parse({
        importId: input.importId,
        projectId: input.projectId,
        adaptationId: adaptation.id,
        episodes,
        committedAt: new Date().toISOString(),
      });
      tx.run(
        "INSERT INTO production_import_batches(import_id, project_id, request_hash, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)",
        input.importId,
        input.projectId,
        hash,
        JSON.stringify(receipt),
        receipt.committedAt,
      );
      return { state: "committed" as const, receipt };
    });
  };
}
