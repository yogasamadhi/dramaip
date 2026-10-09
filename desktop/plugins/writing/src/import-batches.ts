import { createHash } from "node:crypto";
import {
  canonicalImportRequestJSON,
  WritingImportBatchInputSchema,
  WritingImportBatchReceiptSchema,
  type Chapter,
  type ChapterInput,
  type WritingChapterService,
} from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const writingImportBatchMigration: PluginMigration = {
  id: "writing.0006.ordinary-import-batches",
  pluginId: "writing",
  version: "3.0.0-alpha.4",
  dependsOn: ["writing.0005.creation-adoption"],
  sql: `CREATE TABLE writing_import_batches (
    import_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
    created_at TEXT NOT NULL
  );`,
};

export function writingImportBatch(
  context: PluginContext,
  create: (tx: UnitOfWorkTransaction, input: ChapterInput) => Chapter,
  projectExists: (id: string) => boolean,
): WritingChapterService["importBatch"] {
  return (raw) => {
    const parsed = WritingImportBatchInputSchema.safeParse(raw);
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
        "SELECT project_id, request_hash, receipt_json FROM writing_import_batches WHERE import_id = ?",
        input.importId,
      );
      if (old) {
        if (old.project_id !== input.projectId || old.request_hash !== hash)
          return { state: "conflict" as const };
        try {
          const receipt = WritingImportBatchReceiptSchema.parse(
            JSON.parse(old.receipt_json),
          );
          if (
            receipt.importId !== input.importId ||
            receipt.projectId !== input.projectId ||
            receipt.chapters.length !== input.chapters.length ||
            receipt.chapters.some(
              (chapter, index) =>
                chapter.sourceKey !== input.chapters[index]?.sourceKey,
            )
          )
            return { state: "conflict" as const };
          return { state: "committed" as const, receipt };
        } catch {
          return { state: "conflict" as const };
        }
      }
      const chapters = input.chapters.map((source) => {
        const chapter = create(tx, {
          projectId: input.projectId,
          title: source.title,
          content: source.content,
        });
        return {
          sourceKey: source.sourceKey,
          chapterId: chapter.id,
          version: chapter.version,
        };
      });
      const receipt = WritingImportBatchReceiptSchema.parse({
        importId: input.importId,
        projectId: input.projectId,
        chapters,
        committedAt: new Date().toISOString(),
      });
      tx.run(
        "INSERT INTO writing_import_batches(import_id, project_id, request_hash, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)",
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
