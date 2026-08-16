import { createHash, randomUUID } from "node:crypto";

import type { Page } from "@dramaip/contracts";
import { ApiProblem } from "@dramaip/http";
import type { UnitOfWork, UnitOfWorkTransaction } from "@dramaip/plugin-api";

import type {
  CreateProject,
  CreateSeries,
  Project,
  ProjectPackage,
  Series,
  SourceImportPreview,
  UpdateProject,
  UpdateSeries,
} from "./contracts.ts";
import type { WorkspaceExtensionRegistry } from "./services.ts";

interface ProjectRow {
  row_cursor: number;
  id: string;
  name: string;
  description: string;
  synopsis: string;
  genre: string;
  creation_mode: Project["creationMode"];
  target_word_count: number;
  target_episode_count: number;
  initial_script: string | null;
  status: Project["status"];
  version: number;
  created_at: string;
  updated_at: string;
}

interface SeriesRow {
  row_cursor: number;
  id: string;
  project_id: string;
  name: string;
  description: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SourceImportRow {
  preview_json: string;
  selected_candidate_ids_json: string;
  created_resource_ids_json: string;
}

interface PackagePreviewRow {
  package_json: string;
  file_name: string;
  expires_at: string;
  status: string;
}

const projectColumns = `rowid AS row_cursor, id, name, description, synopsis, genre,
  creation_mode, target_word_count, target_episode_count, initial_script,
  status, version, created_at, updated_at`;

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  description: row.description,
  synopsis: row.synopsis,
  genre: row.genre,
  creationMode: row.creation_mode,
  targetWordCount: row.target_word_count,
  targetEpisodeCount: row.target_episode_count,
  initialScript: row.initial_script,
  status: row.status,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toSeries = (row: SeriesRow): Series => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  description: row.description,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function cursorValue(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
  return value;
}

function packageChecksum(input: Omit<ProjectPackage, "checksum">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class WorkspaceRepository {
  constructor(
    readonly uow: UnitOfWork,
    private readonly extensions: WorkspaceExtensionRegistry,
  ) {}

  listProjects(
    cursor: string | undefined,
    limit: number,
    status: "active" | "archived" | "trashed" | undefined,
  ): Page<Project> {
    const rows = this.uow.execute((tx) =>
      tx.all<ProjectRow>(
        `SELECT ${projectColumns} FROM workspace_projects
          WHERE rowid > ? AND (? IS NULL OR status = ?)
          ORDER BY rowid ASC LIMIT ?`,
        cursorValue(cursor),
        status ?? null,
        status ?? null,
        limit + 1,
      ),
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(toProject),
      ...(rows.length > limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    };
  }

  getProject(id: string): Project {
    const row = this.uow.execute((tx) =>
      tx.get<ProjectRow>(
        `SELECT ${projectColumns} FROM workspace_projects WHERE id = ?`,
        id,
      ),
    );
    if (!row)
      throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
    return toProject(row);
  }

  createProject(input: CreateProject): Project {
    return this.uow.execute((tx) => this.insertProject(tx, input));
  }

  private insertProject(
    tx: UnitOfWorkTransaction,
    input: CreateProject,
    id = randomUUID(),
  ): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id,
      ...input,
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    tx.run(
      `INSERT INTO workspace_projects
       (id, name, description, synopsis, genre, creation_mode, target_word_count,
        target_episode_count, initial_script, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      project.id,
      project.name,
      project.description,
      project.synopsis,
      project.genre,
      project.creationMode,
      project.targetWordCount,
      project.targetEpisodeCount,
      project.initialScript,
      project.status,
      project.version,
      project.createdAt,
      project.updatedAt,
    );
    tx.append({
      type: "workspace.project-created.v1",
      pluginId: "workspace",
      aggregateType: "project",
      aggregateId: project.id,
      aggregateVersion: 1,
      payload: project,
    });
    return project;
  }

  updateProject(id: string, expectedVersion: number, input: UpdateProject) {
    return this.uow.execute((tx) => {
      const current = this.projectRow(tx, id);
      if (current.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "project version changed",
        );
      const project: Project = {
        ...toProject(current),
        ...input,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      tx.run(
        `UPDATE workspace_projects SET name = ?, description = ?, synopsis = ?, genre = ?,
          target_word_count = ?, target_episode_count = ?, initial_script = ?,
          version = ?, updated_at = ? WHERE id = ? AND version = ?`,
        project.name,
        project.description,
        project.synopsis,
        project.genre,
        project.targetWordCount,
        project.targetEpisodeCount,
        project.initialScript,
        project.version,
        project.updatedAt,
        id,
        expectedVersion,
      );
      this.appendProjectEvent(tx, "updated", project);
      return project;
    });
  }

  setProjectStatus(
    id: string,
    expectedVersion: number,
    status: Project["status"],
  ) {
    return this.uow.execute((tx) => {
      const current = this.projectRow(tx, id);
      if (current.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "project version changed",
        );
      const project: Project = {
        ...toProject(current),
        status,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      tx.run(
        "UPDATE workspace_projects SET status = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?",
        status,
        project.version,
        project.updatedAt,
        id,
        expectedVersion,
      );
      this.appendProjectEvent(tx, "status-changed", project);
      return project;
    });
  }

  purgeProject(
    id: string,
    expectedVersion: number,
    confirmation: string,
  ): void {
    this.uow.execute((tx) => {
      const current = this.projectRow(tx, id);
      if (current.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "project version changed",
        );
      if (current.status !== "trashed")
        throw new ApiProblem(
          409,
          "PROJECT_NOT_TRASHED",
          "project must be trashed first",
        );
      if (confirmation !== current.name)
        throw new ApiProblem(
          409,
          "PROJECT_CONFIRMATION_MISMATCH",
          "project name confirmation does not match",
        );
      tx.run(
        "DELETE FROM workspace_projects WHERE id = ? AND version = ?",
        id,
        expectedVersion,
      );
      tx.append({
        type: "workspace.project-purged.v1",
        pluginId: "workspace",
        aggregateType: "project",
        aggregateId: id,
        aggregateVersion: expectedVersion + 1,
        payload: { id },
      });
    });
  }

  saveSourceImport(preview: SourceImportPreview): SourceImportPreview {
    this.getProject(preview.projectId);
    this.uow.execute((tx) => {
      tx.run(
        `INSERT INTO workspace_source_imports
         (id, project_id, preview_json, selected_candidate_ids_json,
          created_resource_ids_json, status, created_at, expires_at)
         VALUES (?, ?, ?, '[]', '[]', 'preview', ?, ?)`,
        preview.id,
        preview.projectId,
        JSON.stringify(preview),
        preview.createdAt,
        preview.expiresAt,
      );
    });
    return preview;
  }

  getSourceImport(id: string): SourceImportPreview {
    const row = this.uow.execute((tx) =>
      tx.get<SourceImportRow>(
        "SELECT preview_json, selected_candidate_ids_json, created_resource_ids_json FROM workspace_source_imports WHERE id = ?",
        id,
      ),
    );
    if (!row)
      throw new ApiProblem(
        404,
        "SOURCE_IMPORT_NOT_FOUND",
        "source import does not exist",
      );
    return JSON.parse(row.preview_json) as SourceImportPreview;
  }

  commitSourceImport(id: string, selectedIds: readonly string[]) {
    return this.uow.execute((tx) => {
      const row = tx.get<
        SourceImportRow & { status: string; expires_at: string }
      >(
        `SELECT preview_json, selected_candidate_ids_json, created_resource_ids_json,
                status, expires_at FROM workspace_source_imports WHERE id = ?`,
        id,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "SOURCE_IMPORT_NOT_FOUND",
          "source import does not exist",
        );
      if (row.status !== "preview")
        throw new ApiProblem(
          409,
          "SOURCE_IMPORT_NOT_PENDING",
          "source import is not pending",
        );
      if (Date.parse(row.expires_at) <= Date.now())
        throw new ApiProblem(
          409,
          "SOURCE_IMPORT_EXPIRED",
          "source import preview expired",
        );
      const preview = JSON.parse(row.preview_json) as SourceImportPreview;
      const requested = new Set(selectedIds);
      const candidates = preview.candidates.filter((candidate) =>
        requested.has(candidate.id),
      );
      if (candidates.length !== requested.size)
        throw new ApiProblem(
          400,
          "SOURCE_IMPORT_SELECTION_INVALID",
          "candidate selection is invalid",
        );
      const created = this.extensions
        .sourceImportAdopters()
        .flatMap((adopter) =>
          adopter.adopt(tx, {
            projectId: preview.projectId,
            preview,
            candidates,
          }),
        );
      const committed = { ...preview, status: "committed" as const };
      tx.run(
        `UPDATE workspace_source_imports SET preview_json = ?, selected_candidate_ids_json = ?,
          created_resource_ids_json = ?, status = 'committed' WHERE id = ?`,
        JSON.stringify(committed),
        JSON.stringify(selectedIds),
        JSON.stringify(created),
        id,
      );
      tx.append({
        type: "workspace.source-import-committed.v1",
        pluginId: "workspace",
        aggregateType: "source-import",
        aggregateId: id,
        aggregateVersion: 1,
        payload: { projectId: preview.projectId, createdResourceIds: created },
      });
      return { preview: committed, createdResourceIds: created };
    });
  }

  undoSourceImport(id: string): SourceImportPreview {
    return this.uow.execute((tx) => {
      const row = tx.get<SourceImportRow & { status: string }>(
        "SELECT preview_json, selected_candidate_ids_json, created_resource_ids_json, status FROM workspace_source_imports WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "SOURCE_IMPORT_NOT_FOUND",
          "source import does not exist",
        );
      if (row.status !== "committed")
        throw new ApiProblem(
          409,
          "SOURCE_IMPORT_NOT_COMMITTED",
          "source import cannot be undone",
        );
      const created = JSON.parse(row.created_resource_ids_json) as string[];
      for (const adopter of [
        ...this.extensions.sourceImportAdopters(),
      ].reverse())
        adopter.undo(tx, created);
      const preview = {
        ...(JSON.parse(row.preview_json) as SourceImportPreview),
        status: "undone" as const,
      };
      tx.run(
        "UPDATE workspace_source_imports SET preview_json = ?, status = 'undone' WHERE id = ?",
        JSON.stringify(preview),
        id,
      );
      tx.append({
        type: "workspace.source-import-undone.v1",
        pluginId: "workspace",
        aggregateType: "source-import",
        aggregateId: id,
        aggregateVersion: 2,
        payload: { id, createdResourceIds: created },
      });
      return preview;
    });
  }

  exportProject(id: string): ProjectPackage {
    return this.uow.execute((tx) => {
      const project = toProject(this.projectRow(tx, id));
      const pluginData = Object.fromEntries(
        this.extensions
          .archiveContributors()
          .map((contributor) => [
            contributor.pluginId,
            contributor.export(tx, id),
          ]),
      );
      const unsigned = {
        format: "dramaip-next-project" as const,
        formatVersion: 2 as const,
        project,
        pluginData,
        exportedAt: new Date().toISOString(),
      };
      return { ...unsigned, checksum: packageChecksum(unsigned) };
    });
  }

  savePackagePreview(fileName: string, value: ProjectPackage) {
    const { checksum, ...unsigned } = value;
    if (packageChecksum(unsigned) !== checksum)
      throw new ApiProblem(
        400,
        "PROJECT_PACKAGE_CHECKSUM_INVALID",
        "project package checksum is invalid",
      );
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    this.uow.execute((tx) =>
      tx.run(
        `INSERT INTO workspace_package_previews
         (id, file_name, package_json, status, created_at, expires_at)
         VALUES (?, ?, ?, 'preview', ?, ?)`,
        id,
        fileName,
        JSON.stringify(value),
        new Date().toISOString(),
        expiresAt,
      ),
    );
    return {
      id,
      fileName,
      projectName: value.project.name,
      sourceProjectId: value.project.id,
      pluginIds: Object.keys(value.pluginData).sort(),
      checksum,
      expiresAt,
    };
  }

  commitPackage(id: string, name?: string): Project {
    return this.uow.execute((tx) => {
      const row = tx.get<PackagePreviewRow>(
        "SELECT package_json, file_name, expires_at, status FROM workspace_package_previews WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "PROJECT_PACKAGE_NOT_FOUND",
          "project package preview does not exist",
        );
      if (row.status !== "preview" || Date.parse(row.expires_at) <= Date.now())
        throw new ApiProblem(
          409,
          "PROJECT_PACKAGE_NOT_PENDING",
          "project package preview is unavailable",
        );
      const value = JSON.parse(row.package_json) as ProjectPackage;
      const project = this.insertProject(tx, {
        name: name?.trim() || value.project.name,
        description: value.project.description,
        synopsis: value.project.synopsis,
        genre: value.project.genre,
        creationMode: value.project.creationMode,
        targetWordCount: value.project.targetWordCount,
        targetEpisodeCount: value.project.targetEpisodeCount,
        initialScript: value.project.initialScript,
      });
      for (const contributor of this.extensions.archiveContributors()) {
        if (Object.hasOwn(value.pluginData, contributor.pluginId))
          contributor.import(
            tx,
            project,
            value.pluginData[contributor.pluginId],
          );
      }
      tx.run(
        "UPDATE workspace_package_previews SET status = 'committed' WHERE id = ?",
        id,
      );
      return project;
    });
  }

  listSeries(
    projectId: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Page<Series> {
    const rows = this.uow.execute((tx) =>
      tx.all<SeriesRow>(
        `SELECT rowid AS row_cursor, id, project_id, name, description, version, created_at, updated_at
           FROM workspace_series WHERE rowid > ? AND (? IS NULL OR project_id = ?)
           ORDER BY rowid ASC LIMIT ?`,
        cursorValue(cursor),
        projectId ?? null,
        projectId ?? null,
        limit + 1,
      ),
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(toSeries),
      ...(rows.length > limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    };
  }

  getSeries(id: string): Series {
    const row = this.uow.execute((tx) =>
      tx.get<SeriesRow>(
        "SELECT rowid AS row_cursor, id, project_id, name, description, version, created_at, updated_at FROM workspace_series WHERE id = ?",
        id,
      ),
    );
    if (!row)
      throw new ApiProblem(404, "SERIES_NOT_FOUND", "series does not exist");
    return toSeries(row);
  }

  createSeries(input: CreateSeries): Series {
    this.getProject(input.projectId);
    const now = new Date().toISOString();
    const series: Series = {
      id: randomUUID(),
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.uow.execute((tx) => {
      tx.run(
        "INSERT INTO workspace_series (id, project_id, name, description, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
        series.id,
        series.projectId,
        series.name,
        series.description,
        now,
        now,
      );
      tx.append({
        type: "workspace.series-created.v1",
        pluginId: "workspace",
        aggregateType: "series",
        aggregateId: series.id,
        aggregateVersion: 1,
        payload: series,
      });
    });
    return series;
  }

  updateSeries(
    id: string,
    expectedVersion: number,
    input: UpdateSeries,
  ): Series {
    return this.uow.execute((tx) => {
      const row = tx.get<SeriesRow>(
        "SELECT rowid AS row_cursor, id, project_id, name, description, version, created_at, updated_at FROM workspace_series WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(404, "SERIES_NOT_FOUND", "series does not exist");
      if (row.version !== expectedVersion)
        throw new ApiProblem(412, "VERSION_CONFLICT", "series version changed");
      const series: Series = {
        ...toSeries(row),
        ...input,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      };
      tx.run(
        "UPDATE workspace_series SET name = ?, description = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?",
        series.name,
        series.description,
        series.version,
        series.updatedAt,
        id,
        expectedVersion,
      );
      tx.append({
        type: "workspace.series-updated.v1",
        pluginId: "workspace",
        aggregateType: "series",
        aggregateId: id,
        aggregateVersion: series.version,
        payload: series,
      });
      return series;
    });
  }

  deleteSeries(id: string, expectedVersion: number): void {
    this.uow.execute((tx) => {
      const row = tx.get<SeriesRow>(
        "SELECT rowid AS row_cursor, id, project_id, name, description, version, created_at, updated_at FROM workspace_series WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(404, "SERIES_NOT_FOUND", "series does not exist");
      if (row.version !== expectedVersion)
        throw new ApiProblem(412, "VERSION_CONFLICT", "series version changed");
      tx.run(
        "DELETE FROM workspace_series WHERE id = ? AND version = ?",
        id,
        expectedVersion,
      );
    });
  }

  private projectRow(tx: UnitOfWorkTransaction, id: string): ProjectRow {
    const row = tx.get<ProjectRow>(
      `SELECT ${projectColumns} FROM workspace_projects WHERE id = ?`,
      id,
    );
    if (!row)
      throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
    return row;
  }

  private appendProjectEvent(
    tx: UnitOfWorkTransaction,
    action: string,
    project: Project,
  ) {
    tx.append({
      type: `workspace.project-${action}.v1`,
      pluginId: "workspace",
      aggregateType: "project",
      aggregateId: project.id,
      aggregateVersion: project.version,
      payload: project,
    });
  }
}
