import { randomUUID } from "node:crypto";

import { ApiProblem } from "@dramaip/http";
import type {
  ProjectArchiveContributor,
  SourceImportAdopter,
  UnitOfWork,
  UnitOfWorkTransaction,
  WorkspaceProjectContract,
} from "@dramaip/plugin-api";

import {
  characterDataSchema,
  changeSetSchema,
  outlineDataSchema,
  storyArcDataSchema,
  storyBibleDataSchema,
  type ChangeSet,
  type KnowledgeKind,
  type KnowledgeRecord,
} from "./contracts.ts";

interface RecordRow {
  row_cursor: number;
  id: string;
  project_id: string;
  title: string;
  data_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ChangeSetRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  rationale: string;
  status: ChangeSet["status"];
  version: number;
  created_at: string;
  updated_at: string;
}

interface ChangeItemRow {
  id: string;
  target_kind: KnowledgeKind;
  target_id: string | null;
  operation: "create" | "update" | "delete";
  base_version: number | null;
  title: string;
  patch_json: string;
  before_json: string | null;
  applied: number;
}

const tables: Record<KnowledgeKind, string> = {
  character: "knowledge_characters",
  outline: "knowledge_outlines",
  "story-arc": "knowledge_story_arcs",
  "story-bible": "knowledge_story_bibles",
};
const schemas = {
  character: characterDataSchema,
  outline: outlineDataSchema,
  "story-arc": storyArcDataSchema,
  "story-bible": storyBibleDataSchema,
} as const;

function safeTable(kind: KnowledgeKind): string {
  return tables[kind];
}

function toRecord(kind: KnowledgeKind, row: RecordRow): KnowledgeRecord {
  return {
    kind,
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    data: schemas[kind].parse(JSON.parse(row.data_json)),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as KnowledgeRecord;
}

export class KnowledgeRepository {
  constructor(readonly uow: UnitOfWork) {}

  list(kind: KnowledgeKind, projectId: string, cursor?: string, limit = 50) {
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
    const rows = this.uow.execute((tx) =>
      tx.all<RecordRow>(
        `SELECT rowid AS row_cursor, * FROM ${safeTable(kind)}
       WHERE project_id = ? AND rowid > ? ORDER BY rowid LIMIT ?`,
        projectId,
        offset,
        limit + 1,
      ),
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map((row) => toRecord(kind, row)),
      ...(rows.length > limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    };
  }

  get(kind: KnowledgeKind, id: string): KnowledgeRecord {
    return this.uow.execute((tx) => this.getTx(tx, kind, id));
  }

  create(
    kind: KnowledgeKind,
    input: { projectId: string; title: string; data: unknown },
  ): KnowledgeRecord {
    return this.uow.execute((tx) => this.createTx(tx, kind, input));
  }

  createTx(
    tx: UnitOfWorkTransaction,
    kind: KnowledgeKind,
    input: { projectId: string; title: string; data: unknown },
    id: string = randomUUID(),
  ): KnowledgeRecord {
    if (
      !tx.get("SELECT id FROM workspace_projects WHERE id = ?", input.projectId)
    )
      throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
    const data = schemas[kind].parse(input.data);
    const now = new Date().toISOString();
    tx.run(
      `INSERT INTO ${safeTable(kind)} (id, project_id, title, data_json, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      id,
      input.projectId,
      input.title,
      JSON.stringify(data),
      now,
      now,
    );
    const record = {
      kind,
      id,
      projectId: input.projectId,
      title: input.title,
      data,
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as KnowledgeRecord;
    this.event(tx, kind, "created", record);
    return record;
  }

  update(
    kind: KnowledgeKind,
    id: string,
    expectedVersion: number,
    input: { title?: string; data?: unknown },
  ): KnowledgeRecord {
    return this.uow.execute((tx) =>
      this.updateTx(tx, kind, id, expectedVersion, input),
    );
  }

  updateTx(
    tx: UnitOfWorkTransaction,
    kind: KnowledgeKind,
    id: string,
    expectedVersion: number,
    input: { title?: string; data?: unknown },
  ): KnowledgeRecord {
    const current = this.getTx(tx, kind, id);
    if (current.version !== expectedVersion)
      throw new ApiProblem(412, "VERSION_CONFLICT", `${kind} version changed`);
    const data =
      input.data === undefined ? current.data : schemas[kind].parse(input.data);
    const record = {
      ...current,
      ...(input.title === undefined ? {} : { title: input.title }),
      data,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    } as KnowledgeRecord;
    tx.run(
      `UPDATE ${safeTable(kind)} SET title = ?, data_json = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?`,
      record.title,
      JSON.stringify(record.data),
      record.version,
      record.updatedAt,
      id,
      expectedVersion,
    );
    this.event(tx, kind, "updated", record);
    return record;
  }

  remove(kind: KnowledgeKind, id: string, expectedVersion: number): void {
    this.uow.execute((tx) => this.removeTx(tx, kind, id, expectedVersion));
  }

  removeTx(
    tx: UnitOfWorkTransaction,
    kind: KnowledgeKind,
    id: string,
    expectedVersion: number,
  ): KnowledgeRecord {
    const current = this.getTx(tx, kind, id);
    if (current.version !== expectedVersion)
      throw new ApiProblem(412, "VERSION_CONFLICT", `${kind} version changed`);
    tx.run(
      `DELETE FROM ${safeTable(kind)} WHERE id = ? AND version = ?`,
      id,
      expectedVersion,
    );
    tx.append({
      type: `knowledge.${kind}-deleted.v1`,
      pluginId: "knowledge",
      aggregateType: kind,
      aggregateId: id,
      aggregateVersion: expectedVersion + 1,
      payload: { id, projectId: current.projectId },
    });
    return current;
  }

  settings(projectId: string) {
    return this.uow.execute((tx) => {
      if (!tx.get("SELECT id FROM workspace_projects WHERE id = ?", projectId))
        throw new ApiProblem(
          404,
          "PROJECT_NOT_FOUND",
          "project does not exist",
        );
      tx.run(
        "INSERT INTO knowledge_story_bible_settings (project_id, auto_suggest, version, updated_at) VALUES (?, 1, 1, ?) ON CONFLICT(project_id) DO NOTHING",
        projectId,
        new Date().toISOString(),
      );
      const row = tx.get<{
        auto_suggest: number;
        version: number;
        updated_at: string;
      }>(
        "SELECT auto_suggest, version, updated_at FROM knowledge_story_bible_settings WHERE project_id = ?",
        projectId,
      )!;
      return {
        projectId,
        autoSuggest: Boolean(row.auto_suggest),
        version: row.version,
        updatedAt: row.updated_at,
      };
    });
  }

  updateSettings(
    projectId: string,
    expectedVersion: number,
    autoSuggest: boolean,
  ) {
    const current = this.settings(projectId);
    if (current.version !== expectedVersion)
      throw new ApiProblem(
        412,
        "VERSION_CONFLICT",
        "story bible settings changed",
      );
    return this.uow.execute((tx) => {
      const updatedAt = new Date().toISOString();
      tx.run(
        "UPDATE knowledge_story_bible_settings SET auto_suggest = ?, version = version + 1, updated_at = ? WHERE project_id = ? AND version = ?",
        autoSuggest ? 1 : 0,
        updatedAt,
        projectId,
        expectedVersion,
      );
      return {
        projectId,
        autoSuggest,
        version: expectedVersion + 1,
        updatedAt,
      };
    });
  }

  createChangeSet(input: {
    projectId: string;
    chapterId?: string | null;
    rationale: string;
    changes: Array<{
      targetKind: KnowledgeKind;
      targetId?: string | null;
      operation: "create" | "update" | "delete";
      baseVersion?: number | null;
      title: string;
      patch: Record<string, unknown>;
    }>;
  }): ChangeSet {
    return this.uow.execute((tx) => {
      if (
        !tx.get(
          "SELECT id FROM workspace_projects WHERE id = ?",
          input.projectId,
        )
      )
        throw new ApiProblem(
          404,
          "PROJECT_NOT_FOUND",
          "project does not exist",
        );
      const id = randomUUID();
      const now = new Date().toISOString();
      tx.run(
        "INSERT INTO knowledge_change_sets (id, project_id, chapter_id, rationale, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 1, ?, ?)",
        id,
        input.projectId,
        input.chapterId ?? null,
        input.rationale,
        now,
        now,
      );
      for (const change of input.changes)
        tx.run(
          `INSERT INTO knowledge_change_set_items
         (id, change_set_id, target_kind, target_id, operation, base_version, title,
          patch_json, before_json, applied) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
          randomUUID(),
          id,
          change.targetKind,
          change.targetId ?? null,
          change.operation,
          change.baseVersion ?? null,
          change.title,
          JSON.stringify(change.patch),
        );
      return this.changeSetTx(tx, id);
    });
  }

  getChangeSet(id: string): ChangeSet {
    return this.uow.execute((tx) => this.changeSetTx(tx, id));
  }

  listChangeSets(projectId: string) {
    return this.uow.execute((tx) =>
      tx
        .all<{
          id: string;
        }>(
          "SELECT id FROM knowledge_change_sets WHERE project_id = ? ORDER BY created_at DESC",
          projectId,
        )
        .map((row) => this.changeSetTx(tx, row.id)),
    );
  }

  applyChangeSet(
    id: string,
    expectedVersion: number,
    selectedIds: readonly string[],
  ): ChangeSet {
    return this.uow.execute((tx) => {
      const set = this.changeSetTx(tx, id);
      if (
        set.version !== expectedVersion ||
        !["queued", "paused"].includes(set.status)
      )
        throw new ApiProblem(412, "VERSION_CONFLICT", "change set changed");
      const selected = new Set(selectedIds);
      if (
        selected.size !== selectedIds.length ||
        selectedIds.some(
          (itemId) => !set.items.some((item) => item.id === itemId),
        )
      )
        throw new ApiProblem(
          400,
          "CHANGE_SELECTION_INVALID",
          "change selection is invalid",
        );
      const rows = tx.all<ChangeItemRow>(
        "SELECT id, target_kind, target_id, operation, base_version, title, patch_json, before_json, applied FROM knowledge_change_set_items WHERE change_set_id = ? ORDER BY rowid",
        id,
      );
      for (const item of rows.filter((row) => selected.has(row.id))) {
        let before: KnowledgeRecord | undefined;
        let targetId = item.target_id;
        if (item.operation === "create") {
          targetId = targetId ?? randomUUID();
          this.createTx(
            tx,
            item.target_kind,
            {
              projectId: set.projectId,
              title: item.title,
              data: JSON.parse(item.patch_json),
            },
            targetId,
          );
        } else {
          if (!targetId || !item.base_version)
            throw new ApiProblem(
              400,
              "CHANGE_TARGET_INVALID",
              "change target is incomplete",
            );
          before = this.getTx(tx, item.target_kind, targetId);
          if (item.operation === "delete")
            this.removeTx(tx, item.target_kind, targetId, item.base_version);
          else
            this.updateTx(tx, item.target_kind, targetId, item.base_version, {
              title: item.title,
              data: {
                ...(before.data as Record<string, unknown>),
                ...(JSON.parse(item.patch_json) as Record<string, unknown>),
              },
            });
        }
        tx.run(
          "UPDATE knowledge_change_set_items SET target_id = ?, before_json = ?, applied = 1 WHERE id = ?",
          targetId,
          before ? JSON.stringify(before) : null,
          item.id,
        );
      }
      const now = new Date().toISOString();
      tx.run(
        "UPDATE knowledge_change_sets SET status = 'applied', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        now,
        id,
        expectedVersion,
      );
      return this.changeSetTx(tx, id);
    });
  }

  undoChangeSet(id: string, expectedVersion: number): ChangeSet {
    return this.uow.execute((tx) => {
      const set = this.changeSetTx(tx, id);
      if (set.version !== expectedVersion || set.status !== "applied")
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "change set cannot be undone",
        );
      const rows = tx.all<ChangeItemRow>(
        "SELECT id, target_kind, target_id, operation, base_version, title, patch_json, before_json, applied FROM knowledge_change_set_items WHERE change_set_id = ? AND applied = 1 ORDER BY rowid DESC",
        id,
      );
      for (const item of rows) {
        if (!item.target_id) continue;
        if (item.operation === "create") {
          const current = this.getTx(tx, item.target_kind, item.target_id);
          this.removeTx(tx, item.target_kind, item.target_id, current.version);
        } else if (item.before_json) {
          const before = JSON.parse(item.before_json) as KnowledgeRecord;
          const existing = tx.get<RecordRow>(
            `SELECT rowid AS row_cursor, * FROM ${safeTable(item.target_kind)} WHERE id = ?`,
            item.target_id,
          );
          if (existing) {
            const current = toRecord(item.target_kind, existing);
            this.updateTx(
              tx,
              item.target_kind,
              item.target_id,
              current.version,
              { title: before.title, data: before.data },
            );
          } else {
            this.createTx(
              tx,
              item.target_kind,
              {
                projectId: before.projectId,
                title: before.title,
                data: before.data,
              },
              before.id,
            );
          }
        }
      }
      const now = new Date().toISOString();
      tx.run(
        "UPDATE knowledge_change_sets SET status = 'undone', version = version + 1, updated_at = ? WHERE id = ?",
        now,
        id,
      );
      return this.changeSetTx(tx, id);
    });
  }

  stale(projectId: string) {
    return this.uow.execute((tx) =>
      tx
        .all<{
          id: string;
          project_id: string;
          source_type: string;
          source_id: string;
          reason: string;
          created_at: string;
        }>(
          "SELECT * FROM knowledge_stale_marks WHERE project_id = ? ORDER BY created_at DESC",
          projectId,
        )
        .map((row) => ({
          id: row.id,
          projectId: row.project_id,
          sourceType: row.source_type,
          sourceId: row.source_id,
          reason: row.reason,
          createdAt: row.created_at,
        })),
    );
  }

  importExtraction(id: string) {
    const row = this.uow.execute((tx) =>
      tx.get<{
        id: string;
        project_id: string;
        source_import_id: string;
        candidate_json: string;
        created_resource_ids_json: string;
        created_at: string;
      }>("SELECT * FROM knowledge_import_extractions WHERE id = ?", id),
    );
    if (!row)
      throw new ApiProblem(
        404,
        "IMPORT_EXTRACTION_NOT_FOUND",
        "import extraction does not exist",
      );
    return {
      id: row.id,
      projectId: row.project_id,
      sourceImportId: row.source_import_id,
      candidate: JSON.parse(row.candidate_json),
      createdResourceIds: JSON.parse(row.created_resource_ids_json) as string[],
      status: "adopted" as const,
      createdAt: row.created_at,
    };
  }

  private getTx(
    tx: UnitOfWorkTransaction,
    kind: KnowledgeKind,
    id: string,
  ): KnowledgeRecord {
    const row = tx.get<RecordRow>(
      `SELECT rowid AS row_cursor, * FROM ${safeTable(kind)} WHERE id = ?`,
      id,
    );
    if (!row)
      throw new ApiProblem(
        404,
        "KNOWLEDGE_RECORD_NOT_FOUND",
        `${kind} does not exist`,
      );
    return toRecord(kind, row);
  }

  private changeSetTx(tx: UnitOfWorkTransaction, id: string): ChangeSet {
    const row = tx.get<ChangeSetRow>(
      "SELECT * FROM knowledge_change_sets WHERE id = ?",
      id,
    );
    if (!row)
      throw new ApiProblem(
        404,
        "CHANGE_SET_NOT_FOUND",
        "change set does not exist",
      );
    const items = tx
      .all<ChangeItemRow>(
        "SELECT id, target_kind, target_id, operation, base_version, title, patch_json, before_json, applied FROM knowledge_change_set_items WHERE change_set_id = ? ORDER BY rowid",
        id,
      )
      .map((item) => ({
        id: item.id,
        targetKind: item.target_kind,
        targetId: item.target_id,
        operation: item.operation,
        baseVersion: item.base_version,
        title: item.title,
        patch: JSON.parse(item.patch_json) as Record<string, unknown>,
        applied: Boolean(item.applied),
      }));
    return changeSetSchema.parse({
      id: row.id,
      projectId: row.project_id,
      chapterId: row.chapter_id,
      rationale: row.rationale,
      status: row.status,
      items,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private event(
    tx: UnitOfWorkTransaction,
    kind: KnowledgeKind,
    action: "created" | "updated",
    record: KnowledgeRecord,
  ): void {
    tx.append({
      type: `knowledge.${kind}-${action}.v1`,
      pluginId: "knowledge",
      aggregateType: kind,
      aggregateId: record.id,
      aggregateVersion: record.version,
      payload: record,
    });
  }
}

export function knowledgeSourceImportAdopter(
  repository: KnowledgeRepository,
): SourceImportAdopter {
  return {
    pluginId: "knowledge",
    adopt(tx, input) {
      const created: string[] = [];
      for (const candidate of input.candidates) {
        tx.run(
          "INSERT INTO knowledge_import_extractions (id, project_id, source_import_id, candidate_json, created_resource_ids_json, created_at) VALUES (?, ?, ?, ?, '[]', ?)",
          candidate.id,
          input.projectId,
          input.preview.id,
          JSON.stringify(candidate),
          new Date().toISOString(),
        );
        if (candidate.kind !== "character") continue;
        const names = Array.isArray(candidate.data.names)
          ? candidate.data.names.filter(
              (name): name is string => typeof name === "string",
            )
          : [];
        for (const name of names) {
          const record = repository.createTx(tx, "character", {
            projectId: input.projectId,
            title: name,
            data: {
              role: "",
              biography: "",
              traits: [],
              relationships: [],
              currentState: "",
              visualProfile: "",
            },
          });
          created.push(record.id);
        }
        tx.run(
          "UPDATE knowledge_import_extractions SET created_resource_ids_json = ? WHERE id = ?",
          JSON.stringify(created),
          candidate.id,
        );
      }
      return created;
    },
    undo(tx, resourceIds) {
      for (const id of resourceIds)
        tx.run("DELETE FROM knowledge_characters WHERE id = ?", id);
    },
  };
}

export function knowledgeArchiveContributor(
  repository: KnowledgeRepository,
): ProjectArchiveContributor {
  return {
    pluginId: "knowledge",
    export(tx, projectId) {
      return Object.fromEntries(
        (Object.keys(tables) as KnowledgeKind[]).map((kind) => [
          kind,
          tx
            .all<RecordRow>(
              `SELECT rowid AS row_cursor, * FROM ${safeTable(kind)} WHERE project_id = ? ORDER BY rowid`,
              projectId,
            )
            .map((row) => toRecord(kind, row)),
        ]),
      );
    },
    import(tx, project: WorkspaceProjectContract, payload) {
      if (!payload || typeof payload !== "object") return;
      for (const kind of Object.keys(tables) as KnowledgeKind[]) {
        const records = (payload as Record<string, unknown>)[kind];
        if (!Array.isArray(records)) continue;
        for (const value of records) {
          const record = value as KnowledgeRecord;
          repository.createTx(tx, kind, {
            projectId: project.id,
            title: record.title,
            data: record.data,
          });
        }
      }
    },
  };
}
