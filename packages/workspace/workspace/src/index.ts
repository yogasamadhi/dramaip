/**
 * Host face of the workspace domain. It owns the `workspace` Remote namespace:
 * projects and their trash, derivations and initialization, series and their story bibles, source and package imports, import extractions, author intents, backups, project exports, global search and the demo project. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * workspace plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/workspace-workspace
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AuthorIntentsAdoptInput,
  AuthorIntentsAdoptResult,
  AuthorIntentsCurrentResult,
  AuthorIntentsDiscardInput,
  AuthorIntentsDiscardResult,
  AuthorIntentsGetResult,
  AuthorIntentsListQuery,
  AuthorIntentsListResult,
  AuthorIntentsPreviewInput,
  AuthorIntentsPreviewResult,
  AuthorIntentsSourcesResult,
  BackupsCreateResult,
  BackupsListResult,
  BackupsRestoreResult,
  DesktopSupportCreateDemoResult,
  ExportsProjectResult,
  ImportExtractionsAdoptInput,
  ImportExtractionsAdoptResult,
  ImportExtractionsListResult,
  ImportExtractionsUndoResult,
  ImportExtractionsUpdateCandidateInput,
  ImportExtractionsUpdateCandidateResult,
  ProjectPackagesCommitInput,
  ProjectPackagesCommitResult,
  ProjectPackagesPreviewInput,
  ProjectPackagesPreviewResult,
  ProjectsCommitDerivationInput,
  ProjectsCommitDerivationResult,
  ProjectsCreateInput,
  ProjectsCreateResult,
  ProjectsGetResult,
  ProjectsInitializationResult,
  ProjectsListResult,
  ProjectsListTrashResult,
  ProjectsPreviewDerivationInput,
  ProjectsPreviewDerivationResult,
  ProjectsPurgeInput,
  ProjectsRestoreResult,
  ProjectsRetryInitializationResult,
  ProjectsTrashResult,
  ProjectsUpdateInput,
  ProjectsUpdateResult,
  SearchGlobalResult,
  SeriesCreateInput,
  SeriesCreateResult,
  SeriesCreateStoryBibleInput,
  SeriesCreateStoryBibleResult,
  SeriesLibraryResult,
  SeriesListResult,
  SeriesOverrideStoryBibleInput,
  SeriesOverrideStoryBibleResult,
  SeriesSetProjectSeriesInput,
  SeriesSetProjectSeriesResult,
  SeriesTransferAssetInput,
  SeriesTransferAssetResult,
  SeriesUpgradeStoryBibleInput,
  SeriesUpgradeStoryBibleResult,
  SourceImportsCommitInput,
  SourceImportsCommitResult,
  SourceImportsGetCommitQuery,
  SourceImportsGetCommitResult,
  SourceImportsPreviewInput,
  SourceImportsPreviewResult,
} from "./types.ts";
import { workspaceLegacyRoutes, type WorkspaceLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `workspace` Remote namespace. */
    workspaceController: WorkspaceController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  workspaceLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "workspaceController", { namespace: "workspace" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: WorkspaceLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = workspaceLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Author intent result. Runs `POST /api/v2/author-intents/{id}/adopt`.
   * @replaces author-intents.adopt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  authorIntentsAdopt(
    id: string,
    input: AuthorIntentsAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AuthorIntentsAdoptResult> {
    return this.run("authorIntentsAdopt", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Author intent result. Runs `GET /api/v2/projects/{projectId}/author-intent`.
   * @replaces author-intents.current
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  authorIntentsCurrent(projectId: string): Promise<AuthorIntentsCurrentResult> {
    return this.run("authorIntentsCurrent", projectId);
  }

  /**
   * Author intent result. Runs `POST /api/v2/author-intents/{id}/discard`.
   * @replaces author-intents.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  authorIntentsDiscard(
    id: string,
    input: AuthorIntentsDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AuthorIntentsDiscardResult> {
    return this.run("authorIntentsDiscard", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Author intent result. Runs `GET /api/v2/author-intents/{id}`.
   * @replaces author-intents.get
   * @param id - the `id` path parameter.
   */
  @Remote
  authorIntentsGet(id: string): Promise<AuthorIntentsGetResult> {
    return this.run("authorIntentsGet", id);
  }

  /**
   * Author intent result. Runs `GET /api/v2/projects/{projectId}/author-intents`.
   * @replaces author-intents.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  authorIntentsList(
    projectId: string,
    query?: AuthorIntentsListQuery,
  ): Promise<AuthorIntentsListResult> {
    return this.run("authorIntentsList", projectId, query);
  }

  /**
   * Author intent result. Runs `POST /api/v2/projects/{projectId}/author-intents`.
   * @replaces author-intents.preview
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  authorIntentsPreview(
    projectId: string,
    input: AuthorIntentsPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AuthorIntentsPreviewResult> {
    return this.run(
      "authorIntentsPreview",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Author intent result. Runs `GET /api/v2/projects/{projectId}/author-intent-sources`.
   * @replaces author-intents.sources
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  authorIntentsSources(projectId: string): Promise<AuthorIntentsSourcesResult> {
    return this.run("authorIntentsSources", projectId);
  }

  /**
   * Runs `POST /api/v2/backups`.
   * @replaces backups.create
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  backupsCreate(
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<BackupsCreateResult> {
    return this.run("backupsCreate", ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/backups`.
   * @replaces backups.list
   */
  @Remote
  backupsList(): Promise<BackupsListResult> {
    return this.run("backupsList");
  }

  /**
   * Runs `POST /api/v2/backups/{id}/restore`.
   * @replaces backups.restore
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  backupsRestore(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<BackupsRestoreResult> {
    return this.run("backupsRestore", id, ifMatch, idempotencyKey);
  }

  /**
   * Created example project. Runs `POST /api/v2/demo/projects`.
   * @replaces desktop-support.createDemo
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  desktopSupportCreateDemo(
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<DesktopSupportCreateDemoResult> {
    return this.run("desktopSupportCreateDemo", ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/exports/projects/{id}/{format}`.
   * @replaces exports.project
   * @param id - the `id` path parameter.
   * @param format - the `format` path parameter.
   */
  @Remote
  exportsProject(
    id: string,
    format:
      | "json"
      | "markdown"
      | "submission-markdown"
      | "submission-json"
      | "script"
      | "storyboard"
      | "delivery"
      | "automation",
  ): Promise<ExportsProjectResult> {
    return this.run("exportsProject", id, format);
  }

  /**
   * Runs `POST /api/v2/import-extractions/change-sets/{id}/adopt`.
   * @replaces import-extractions.adopt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  importExtractionsAdopt(
    id: string,
    input: ImportExtractionsAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImportExtractionsAdoptResult> {
    return this.run(
      "importExtractionsAdopt",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{id}/import-extractions/change-sets`.
   * @replaces import-extractions.list
   * @param id - the `id` path parameter.
   */
  @Remote
  importExtractionsList(id: string): Promise<ImportExtractionsListResult> {
    return this.run("importExtractionsList", id);
  }

  /**
   * Runs `POST /api/v2/import-extractions/change-sets/{id}/undo`.
   * @replaces import-extractions.undo
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  importExtractionsUndo(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImportExtractionsUndoResult> {
    return this.run("importExtractionsUndo", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/import-extractions/change-sets/{id}/candidates/{candidateId}`.
   * @replaces import-extractions.updateCandidate
   * @param id - the `id` path parameter.
   * @param candidateId - the `candidateId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  importExtractionsUpdateCandidate(
    id: string,
    candidateId: string,
    input: ImportExtractionsUpdateCandidateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImportExtractionsUpdateCandidateResult> {
    return this.run(
      "importExtractionsUpdateCandidate",
      id,
      candidateId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/project-packages/{id}/commit`.
   * @replaces project-packages.commit
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectPackagesCommit(
    id: string,
    input: ProjectPackagesCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectPackagesCommitResult> {
    return this.run(
      "projectPackagesCommit",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * No content. Runs `DELETE /api/v2/project-packages/{id}`.
   * @replaces project-packages.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectPackagesDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("projectPackagesDiscard", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/project-packages/preview`.
   * @replaces project-packages.preview
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectPackagesPreview(
    input: ProjectPackagesPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectPackagesPreviewResult> {
    return this.run("projectPackagesPreview", input, ifMatch, idempotencyKey);
  }

  /**
   * Derived project. Runs `POST /api/v2/projects/{id}/derivations`.
   * @replaces projects.commitDerivation
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsCommitDerivation(
    id: string,
    input: ProjectsCommitDerivationInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsCommitDerivationResult> {
    return this.run(
      "projectsCommitDerivation",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Created project. Runs `POST /api/v2/projects`.
   * @replaces projects.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsCreate(
    input: ProjectsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsCreateResult> {
    return this.run("projectsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Project. Runs `GET /api/v2/projects/{id}`.
   * @replaces projects.get
   * @param id - the `id` path parameter.
   */
  @Remote
  projectsGet(id: string): Promise<ProjectsGetResult> {
    return this.run("projectsGet", id);
  }

  /**
   * Project initialization progress. Runs `GET /api/v2/projects/{id}/initialization`.
   * @replaces projects.initialization
   * @param id - the `id` path parameter.
   */
  @Remote
  projectsInitialization(id: string): Promise<ProjectsInitializationResult> {
    return this.run("projectsInitialization", id);
  }

  /**
   * Projects. Runs `GET /api/v2/projects`.
   * @replaces projects.list
   */
  @Remote
  projectsList(): Promise<ProjectsListResult> {
    return this.run("projectsList");
  }

  /**
   * Trashed projects. Runs `GET /api/v2/projects/trash`.
   * @replaces projects.listTrash
   */
  @Remote
  projectsListTrash(): Promise<ProjectsListTrashResult> {
    return this.run("projectsListTrash");
  }

  /**
   * Derivation preview. Runs `POST /api/v2/projects/{id}/derivations/preview`.
   * @replaces projects.previewDerivation
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsPreviewDerivation(
    id: string,
    input: ProjectsPreviewDerivationInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsPreviewDerivationResult> {
    return this.run(
      "projectsPreviewDerivation",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Purged. Runs `DELETE /api/v2/projects/{id}`.
   * @replaces projects.purge
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsPurge(
    id: string,
    input: ProjectsPurgeInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("projectsPurge", id, input, ifMatch, idempotencyKey);
  }

  /**
   * restore project. Runs `POST /api/v2/projects/{id}/restore`.
   * @replaces projects.restore
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsRestore(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsRestoreResult> {
    return this.run("projectsRestore", id, ifMatch, idempotencyKey);
  }

  /**
   * Retried project initialization. Runs `POST /api/v2/projects/{id}/initialization/retry`.
   * @replaces projects.retryInitialization
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsRetryInitialization(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsRetryInitializationResult> {
    return this.run("projectsRetryInitialization", id, ifMatch, idempotencyKey);
  }

  /**
   * trash project. Runs `POST /api/v2/projects/{id}/trash`.
   * @replaces projects.trash
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsTrash(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsTrashResult> {
    return this.run("projectsTrash", id, ifMatch, idempotencyKey);
  }

  /**
   * Updated project. Runs `PATCH /api/v2/projects/{id}`.
   * @replaces projects.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectsUpdate(
    id: string,
    input: ProjectsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectsUpdateResult> {
    return this.run("projectsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/search/{query}`.
   * @replaces search.global
   * @param query - the `query` path parameter.
   */
  @Remote
  searchGlobal(query: string): Promise<SearchGlobalResult> {
    return this.run("searchGlobal", query);
  }

  /**
   * Runs `POST /api/v2/series`.
   * @replaces series.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seriesCreate(
    input: SeriesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeriesCreateResult> {
    return this.run("seriesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/series/{seriesId}/story-bible`.
   * @replaces series.createStoryBible
   * @param seriesId - the `seriesId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seriesCreateStoryBible(
    seriesId: string,
    input: SeriesCreateStoryBibleInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeriesCreateStoryBibleResult> {
    return this.run(
      "seriesCreateStoryBible",
      seriesId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{id}/series-library`.
   * @replaces series.library
   * @param id - the `id` path parameter.
   */
  @Remote
  seriesLibrary(id: string): Promise<SeriesLibraryResult> {
    return this.run("seriesLibrary", id);
  }

  /**
   * Runs `GET /api/v2/series`.
   * @replaces series.list
   */
  @Remote
  seriesList(): Promise<SeriesListResult> {
    return this.run("seriesList");
  }

  /**
   * Runs `PUT /api/v2/projects/{projectId}/series-story-bible/{id}/override`.
   * @replaces series.overrideStoryBible
   * @param projectId - the `projectId` path parameter.
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seriesOverrideStoryBible(
    projectId: string,
    id: string,
    input: SeriesOverrideStoryBibleInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeriesOverrideStoryBibleResult> {
    return this.run(
      "seriesOverrideStoryBible",
      projectId,
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PUT /api/v2/projects/{id}/series`.
   * @replaces series.setProjectSeries
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seriesSetProjectSeries(
    id: string,
    input: SeriesSetProjectSeriesInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeriesSetProjectSeriesResult> {
    return this.run(
      "seriesSetProjectSeries",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/projects/{id}/series-assets`.
   * @replaces series.transferAsset
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seriesTransferAsset(
    id: string,
    input: SeriesTransferAssetInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeriesTransferAssetResult> {
    return this.run("seriesTransferAsset", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/series-story-bible/{id}/upgrade`.
   * @replaces series.upgradeStoryBible
   * @param projectId - the `projectId` path parameter.
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seriesUpgradeStoryBible(
    projectId: string,
    id: string,
    input: SeriesUpgradeStoryBibleInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeriesUpgradeStoryBibleResult> {
    return this.run(
      "seriesUpgradeStoryBible",
      projectId,
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/source-imports/{id}/commit`.
   * @replaces source-imports.commit
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sourceImportsCommit(
    id: string,
    input: SourceImportsCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SourceImportsCommitResult> {
    return this.run("sourceImportsCommit", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `DELETE /api/v2/source-imports/{id}`.
   * @replaces source-imports.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sourceImportsDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("sourceImportsDiscard", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/source-imports/{id}/commit`.
   * @replaces source-imports.getCommit
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  sourceImportsGetCommit(
    id: string,
    query: SourceImportsGetCommitQuery,
  ): Promise<SourceImportsGetCommitResult> {
    return this.run("sourceImportsGetCommit", id, query);
  }

  /**
   * Runs `POST /api/v2/source-imports/preview`.
   * @replaces source-imports.preview
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sourceImportsPreview(
    input: SourceImportsPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SourceImportsPreviewResult> {
    return this.run("sourceImportsPreview", input, ifMatch, idempotencyKey);
  }
}

export default WorkspaceController;
