import { createHash } from "node:crypto";
import {
  canonicalImportRequestJSON,
  WritingVolumeSchema,
  WritingVolumeInputSchema,
  WritingVolumeAssignmentInputSchema,
  WritingVolumeAssignmentReceiptSchema,
  type Chapter,
  type WritingVolumeService,
  type WritingVolumeWriteResult,
} from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import type { z } from "zod";

export const writingVolumeRequestsMigration: PluginMigration = {
  id: "writing.0007.volume-requests",
  pluginId: "writing",
  version: "3.0.0-alpha.4",
  dependsOn: ["writing.0006.ordinary-import-batches"],
  sql: `CREATE TABLE writing_volume_requests (
    scope TEXT NOT NULL, request_key TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
    response_hash TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(scope, request_key)
  );`,
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const validVolumeRequestKey = (key: string) =>
  key.length >= 8 && key.length <= 200 && key === key.trim();

export function chapterVolumeScopeIsValid(
  tx: UnitOfWorkTransaction,
  projectId: string,
  volumeId?: string,
) {
  return (
    !volumeId ||
    tx.get<{ project_id: string }>(
      "SELECT project_id FROM writing_volumes WHERE id = ?",
      volumeId,
    )?.project_id === projectId
  );
}
export class ChapterVolumeScopeError extends Error {
  constructor() {
    super("章节只能归属当前项目中存在的卷。");
  }
}

/** Both tables and their events have the Writing owner; one durable transaction. */
export function volumeWrites(
  context: PluginContext,
  create: (
    input: z.infer<typeof WritingVolumeInputSchema>,
    tx: UnitOfWorkTransaction,
  ) => z.infer<typeof WritingVolumeSchema>,
  getChapter: (tx: UnitOfWorkTransaction, id: string) => Chapter | undefined,
  projectExists: (id: string) => boolean,
): Pick<WritingVolumeService, "createOnce" | "assignChapters"> {
  const once = <T>(
    scope: string,
    projectId: string,
    key: string,
    input: unknown,
    parse: (value: unknown) => T,
    commit: (tx: UnitOfWorkTransaction) => T,
  ): WritingVolumeWriteResult<T> => {
    if (!validVolumeRequestKey(key) || !projectExists(projectId))
      return { state: "conflict", code: "CONFLICT" };
    const requestHash = hash(canonicalImportRequestJSON({ projectId, input }));
    return context.uow.execute((tx) => {
      const old = tx.get<{
        project_id: string;
        request_hash: string;
        response_json: string;
        response_hash: string;
      }>(
        "SELECT project_id, request_hash, response_json, response_hash FROM writing_volume_requests WHERE scope = ? AND request_key = ?",
        scope,
        key,
      );
      if (old) {
        if (old.project_id !== projectId || old.request_hash !== requestHash)
          return {
            state: "conflict" as const,
            code: "IDEMPOTENCY_CONFLICT" as const,
          };
        try {
          if (hash(old.response_json) !== old.response_hash)
            throw new Error("Changed receipt");
          const value = parse(JSON.parse(old.response_json));
          if ((value as { projectId: string }).projectId !== projectId)
            throw new Error("Foreign receipt");
          return { state: "committed" as const, value };
        } catch {
          return {
            state: "conflict" as const,
            code: "INVALID_RECEIPT" as const,
          };
        }
      }
      const value = commit(tx),
        response = JSON.stringify(parse(value));
      tx.run(
        "INSERT INTO writing_volume_requests(scope,request_key,project_id,request_hash,response_json,response_hash,created_at) VALUES(?,?,?,?,?,?,?)",
        scope,
        key,
        projectId,
        requestHash,
        response,
        hash(response),
        new Date().toISOString(),
      );
      return { state: "committed" as const, value };
    });
  };
  return {
    createOnce(raw, key) {
      const parsed = WritingVolumeInputSchema.safeParse(raw);
      if (!parsed.success) return { state: "conflict", code: "CONFLICT" };
      return once(
        "create",
        parsed.data.projectId,
        key,
        parsed.data,
        (value) => {
          const result = WritingVolumeSchema.parse(value);
          if (
            result.title !== parsed.data.title ||
            result.outline !== (parsed.data.outline ?? "") ||
            result.version !== 0
          )
            throw new Error("Creation receipt does not match original input");
          return result;
        },
        (tx) => create(parsed.data, tx),
      );
    },
    assignChapters(projectId, raw, key) {
      const parsed = WritingVolumeAssignmentInputSchema.safeParse(raw);
      if (!parsed.success) return { state: "conflict", code: "CONFLICT" };
      const input = parsed.data;
      try {
        return once(
          "assign",
          projectId,
          key,
          input,
          (value) => {
            const result = WritingVolumeAssignmentReceiptSchema.parse(value);
            if (
              canonicalImportRequestJSON(result.input) !==
              canonicalImportRequestJSON(input)
            )
              throw new Error(
                "Assignment receipt does not match original input",
              );
            return result;
          },
          (tx) => {
            // Validate the entire selection before any version/history/event write.
            for (const expected of input.volumes) {
              const volume = tx.get<{ project_id: string; version: number }>(
                "SELECT project_id, version FROM writing_volumes WHERE id = ?",
                expected.id,
              );
              if (
                !volume ||
                volume.project_id !== projectId ||
                volume.version !== expected.version
              )
                throw new ChapterVolumeScopeError();
            }
            const originals = input.chapters.map((expected) => {
              const current = getChapter(tx, expected.chapterId);
              if (
                !current ||
                current.projectId !== projectId ||
                current.version !== expected.version
              )
                throw new ChapterVolumeScopeError();
              return current;
            });
            const at = new Date().toISOString();
            const chapters = input.chapters.map((expected, index) => {
              const original = originals[index]!;
              tx.run(
                "INSERT INTO writing_chapter_versions(id,chapter_id,version_number,snapshot_json,created_at) VALUES(?,?,?,?,?)",
                crypto.randomUUID(),
                original.id,
                original.version,
                JSON.stringify(original),
                at,
              );
              tx.run(
                "UPDATE chapters SET volume_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
                expected.volumeId,
                at,
                original.id,
                original.version,
              );
              const actual = getChapter(tx, original.id);
              if (
                !actual ||
                actual.version !== original.version + 1 ||
                (actual.volumeId ?? null) !== expected.volumeId
              )
                throw new ChapterVolumeScopeError();
              const { volumeId: _originalVolumeId, ...unassigned } = original;
              const updated = {
                ...unassigned,
                ...(expected.volumeId ? { volumeId: expected.volumeId } : {}),
                version: original.version + 1,
                updatedAt: at,
              };
              tx.append({
                type: "writing.chapter-updated.v1",
                pluginId: "writing",
                aggregateType: "chapter",
                aggregateId: original.id,
                aggregateVersion: updated.version,
                payload: JSON.parse(JSON.stringify(updated)),
              });
              return {
                chapterId: original.id,
                version: updated.version,
                volumeId: expected.volumeId,
              };
            });
            return WritingVolumeAssignmentReceiptSchema.parse({
              id: crypto.randomUUID(),
              projectId,
              input,
              chapters,
              committedAt: at,
            });
          },
        );
      } catch (error) {
        if (error instanceof ChapterVolumeScopeError)
          return { state: "conflict", code: "CONFLICT" };
        throw error; // Storage/event faults unwind the whole batch, not a partial receipt.
      }
    },
  };
}
