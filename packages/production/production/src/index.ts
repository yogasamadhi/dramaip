/**
 * Host face of the production domain. It owns the `production` Remote namespace:
 * adaptations, episodes, scripts, scenes and shots, seasons and season plans, diagnoses, adaptation strategies, episode developments and their revisions, storyboard attribution, screenplay imports, intakes and sources, quality sources and the production graph. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * production plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/production-production
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AdaptationsCreateInput,
  AdaptationsCreateResult,
  AdaptationsGetResult,
  AdaptationsListQuery,
  AdaptationsListResult,
  AdaptationsUpdateInput,
  AdaptationsUpdateResult,
  AdaptationStrategiesAdoptInput,
  AdaptationStrategiesAdoptResult,
  AdaptationStrategiesDiscardInput,
  AdaptationStrategiesDiscardResult,
  AdaptationStrategiesGetResult,
  AdaptationStrategiesListQuery,
  AdaptationStrategiesListResult,
  AdaptationStrategiesSourcesResult,
  AdaptationStrategiesSummariesQuery,
  AdaptationStrategiesSummariesResult,
  DiagnosesAdoptInput,
  DiagnosesAdoptResult,
  DiagnosesDiscardInput,
  DiagnosesDiscardResult,
  DiagnosesGetResult,
  DiagnosesListQuery,
  DiagnosesListResult,
  DiagnosesSourcesResult,
  DiagnosesSummariesQuery,
  DiagnosesSummariesResult,
  EpisodeDevelopmentsAdoptScriptRevisionInput,
  EpisodeDevelopmentsAdoptScriptRevisionResult,
  EpisodeDevelopmentsAdoptSourceRevisionInput,
  EpisodeDevelopmentsAdoptSourceRevisionResult,
  EpisodeDevelopmentsAdoptTopologyRevisionInput,
  EpisodeDevelopmentsAdoptTopologyRevisionResult,
  EpisodeDevelopmentsDiscardScriptRevisionInput,
  EpisodeDevelopmentsDiscardScriptRevisionResult,
  EpisodeDevelopmentsDiscardSourceRevisionInput,
  EpisodeDevelopmentsDiscardSourceRevisionResult,
  EpisodeDevelopmentsDiscardTopologyRevisionInput,
  EpisodeDevelopmentsDiscardTopologyRevisionResult,
  EpisodeDevelopmentsGetResult,
  EpisodeDevelopmentsGetScriptRevisionResult,
  EpisodeDevelopmentsGetSourceRevisionResult,
  EpisodeDevelopmentsGetSourceRevisionContextResult,
  EpisodeDevelopmentsGetTopologyRevisionResult,
  EpisodeDevelopmentsImpactQuery,
  EpisodeDevelopmentsImpactResult,
  EpisodeDevelopmentsListQuery,
  EpisodeDevelopmentsListResult,
  EpisodeDevelopmentsListScriptRevisionsQuery,
  EpisodeDevelopmentsListScriptRevisionsResult,
  EpisodeDevelopmentsListSourceRevisionsQuery,
  EpisodeDevelopmentsListSourceRevisionsResult,
  EpisodeDevelopmentsListTopologyRevisionsQuery,
  EpisodeDevelopmentsListTopologyRevisionsResult,
  EpisodeDevelopmentsPreviewScriptRevisionInput,
  EpisodeDevelopmentsPreviewScriptRevisionResult,
  EpisodeDevelopmentsPreviewSourceRevisionInput,
  EpisodeDevelopmentsPreviewSourceRevisionResult,
  EpisodeDevelopmentsPreviewTopologyRevisionInput,
  EpisodeDevelopmentsPreviewTopologyRevisionResult,
  EpisodeDevelopmentsScriptRevisionSummariesQuery,
  EpisodeDevelopmentsScriptRevisionSummariesResult,
  EpisodeDevelopmentsSourceRevisionSummariesQuery,
  EpisodeDevelopmentsSourceRevisionSummariesResult,
  EpisodeDevelopmentsSourcesResult,
  EpisodeDevelopmentsSummariesQuery,
  EpisodeDevelopmentsSummariesResult,
  EpisodeDevelopmentsTopologyRevisionSummariesQuery,
  EpisodeDevelopmentsTopologyRevisionSummariesResult,
  EpisodesCreateInput,
  EpisodesCreateResult,
  EpisodesGetResult,
  EpisodesListQuery,
  EpisodesListResult,
  EpisodesUpdateInput,
  EpisodesUpdateResult,
  StructureReorderEpisodesInput,
  StructureReorderEpisodesResult,
  StructureReorderScenesInput,
  StructureReorderScenesResult,
  StructureReorderShotsInput,
  StructureReorderShotsResult,
  StructureSelectCurrentAdaptationInput,
  StructureSelectCurrentAdaptationResult,
  GraphResult,
  ImpactInput,
  ImpactResult,
  ProductionQualitySourcesGetResult,
  ProductionQualitySourcesListQuery,
  ProductionQualitySourcesListResult,
  ProjectsProgressQuery,
  ProjectsProgressResult,
  ScenesCreateInput,
  ScenesCreateResult,
  ScenesGetResult,
  ScenesListQuery,
  ScenesListResult,
  ScenesUpdateInput,
  ScenesUpdateResult,
  ScreenplayImportCommitInput,
  ScreenplayImportCommitResult,
  ScreenplayImportCreatePreviewInput,
  ScreenplayImportCreatePreviewResult,
  ScreenplayImportDiscardResult,
  ScreenplayImportGetPreviewResult,
  ScreenplayIntakesCommitInput,
  ScreenplayIntakesCommitResult,
  ScreenplayIntakesDiscardResult,
  ScreenplayIntakesGetResult,
  ScreenplayIntakesPreviewInput,
  ScreenplayIntakesPreviewResult,
  ScreenplaysExportResult,
  ScreenplaysGetResult,
  ScreenplaysUpdateInput,
  ScreenplaysUpdateResult,
  ScreenplaySourcesGetResult,
  ScreenplaySourcesListQuery,
  ScreenplaySourcesListResult,
  ScriptsCreateInput,
  ScriptsCreateResult,
  ScriptsGetResult,
  ScriptsListQuery,
  ScriptsListResult,
  ScriptsUpdateInput,
  ScriptsUpdateResult,
  SeasonPlansAdoptInput,
  SeasonPlansAdoptResult,
  SeasonPlansDiscardInput,
  SeasonPlansDiscardResult,
  SeasonPlansGetResult,
  SeasonPlansListQuery,
  SeasonPlansListResult,
  SeasonPlansReorderInput,
  SeasonPlansReorderResult,
  SeasonPlansSourcesResult,
  SeasonPlansSummariesQuery,
  SeasonPlansSummariesResult,
  SeasonsCreateInput,
  SeasonsCreateResult,
  SeasonsListQuery,
  SeasonsListResult,
  SeasonsMapChapterInput,
  SeasonsMapChapterResult,
  SeasonsUpdateInput,
  SeasonsUpdateResult,
  ShotsCreateInput,
  ShotsCreateResult,
  ShotsGetResult,
  ShotsListQuery,
  ShotsListResult,
  ShotsUpdateInput,
  ShotsUpdateResult,
  StoryboardAttributionCreateInput,
  StoryboardAttributionCreateResult,
  StoryboardAttributionDecideInput,
  StoryboardAttributionDecideResult,
  StoryboardAttributionGetResult,
  StoryboardAttributionListQuery,
  StoryboardAttributionListResult,
  StoryboardAttributionSourcesQuery,
  StoryboardAttributionSourcesResult,
  StoryboardAttributionSummariesQuery,
  StoryboardAttributionSummariesResult,
} from "./types.ts";
import {
  productionLegacyRoutes,
  type ProductionLegacyMethod,
} from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `production` Remote namespace. */
    productionController: ProductionController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  productionLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.production` namespace. */
export class ProductionController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "productionController", { namespace: "production" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: ProductionLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = productionLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `POST /api/v2/adaptations`.
   * @replaces adaptations.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationsCreate(
    input: AdaptationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AdaptationsCreateResult> {
    return this.run("adaptationsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/adaptations/{id}`.
   * @replaces adaptations.get
   * @param id - the `id` path parameter.
   */
  @Remote
  adaptationsGet(id: string): Promise<AdaptationsGetResult> {
    return this.run("adaptationsGet", id);
  }

  /**
   * Runs `GET /api/v2/adaptations`.
   * @replaces adaptations.list
   * @param query - the query parameters.
   */
  @Remote
  adaptationsList(
    query?: AdaptationsListQuery,
  ): Promise<AdaptationsListResult> {
    return this.run("adaptationsList", query);
  }

  /**
   * Runs `DELETE /api/v2/adaptations/{id}`.
   * @replaces adaptations.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("adaptationsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/adaptations/{id}`.
   * @replaces adaptations.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationsUpdate(
    id: string,
    input: AdaptationsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AdaptationsUpdateResult> {
    return this.run("adaptationsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Independent adaptation strategy. Runs `POST /api/v2/adaptation-strategies/{id}/adopt`.
   * @replaces adaptationStrategies.adopt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationStrategiesAdopt(
    id: string,
    input: AdaptationStrategiesAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AdaptationStrategiesAdoptResult> {
    return this.run(
      "adaptationStrategiesAdopt",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Independent adaptation strategy. Runs `POST /api/v2/adaptation-strategies/{id}/discard`.
   * @replaces adaptationStrategies.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationStrategiesDiscard(
    id: string,
    input: AdaptationStrategiesDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AdaptationStrategiesDiscardResult> {
    return this.run(
      "adaptationStrategiesDiscard",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Independent adaptation strategy. Runs `GET /api/v2/adaptation-strategies/{id}`.
   * @replaces adaptationStrategies.get
   * @param id - the `id` path parameter.
   */
  @Remote
  adaptationStrategiesGet(id: string): Promise<AdaptationStrategiesGetResult> {
    return this.run("adaptationStrategiesGet", id);
  }

  /**
   * Independent adaptation strategy. Runs `GET /api/v2/projects/{projectId}/adaptation-strategies`.
   * @replaces adaptationStrategies.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  adaptationStrategiesList(
    projectId: string,
    query?: AdaptationStrategiesListQuery,
  ): Promise<AdaptationStrategiesListResult> {
    return this.run("adaptationStrategiesList", projectId, query);
  }

  /**
   * Independent adaptation strategy. Runs `GET /api/v2/projects/{projectId}/adaptation-strategy-sources`.
   * @replaces adaptationStrategies.sources
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  adaptationStrategiesSources(
    projectId: string,
  ): Promise<AdaptationStrategiesSourcesResult> {
    return this.run("adaptationStrategiesSources", projectId);
  }

  /**
   * Independent adaptation strategy. Runs `GET /api/v2/projects/{projectId}/adaptation-strategy-previews`.
   * @replaces adaptationStrategies.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  adaptationStrategiesSummaries(
    projectId: string,
    query?: AdaptationStrategiesSummariesQuery,
  ): Promise<AdaptationStrategiesSummariesResult> {
    return this.run("adaptationStrategiesSummaries", projectId, query);
  }

  /**
   * Diagnosis result. Runs `POST /api/v2/diagnoses/{id}/adopt`.
   * @replaces diagnoses.adopt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  diagnosesAdopt(
    id: string,
    input: DiagnosesAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<DiagnosesAdoptResult> {
    return this.run("diagnosesAdopt", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Diagnosis result. Runs `POST /api/v2/diagnoses/{id}/discard`.
   * @replaces diagnoses.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  diagnosesDiscard(
    id: string,
    input: DiagnosesDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<DiagnosesDiscardResult> {
    return this.run("diagnosesDiscard", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Diagnosis result. Runs `GET /api/v2/diagnoses/{id}`.
   * @replaces diagnoses.get
   * @param id - the `id` path parameter.
   */
  @Remote
  diagnosesGet(id: string): Promise<DiagnosesGetResult> {
    return this.run("diagnosesGet", id);
  }

  /**
   * Diagnosis result. Runs `GET /api/v2/projects/{projectId}/diagnoses`.
   * @replaces diagnoses.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  diagnosesList(
    projectId: string,
    query?: DiagnosesListQuery,
  ): Promise<DiagnosesListResult> {
    return this.run("diagnosesList", projectId, query);
  }

  /**
   * Diagnosis result. Runs `GET /api/v2/projects/{projectId}/diagnosis-sources`.
   * @replaces diagnoses.sources
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  diagnosesSources(projectId: string): Promise<DiagnosesSourcesResult> {
    return this.run("diagnosesSources", projectId);
  }

  /**
   * Diagnosis result. Runs `GET /api/v2/projects/{projectId}/diagnosis-previews`.
   * @replaces diagnoses.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  diagnosesSummaries(
    projectId: string,
    query?: DiagnosesSummariesQuery,
  ): Promise<DiagnosesSummariesResult> {
    return this.run("diagnosesSummaries", projectId, query);
  }

  /**
   * Author-confirmed script revision. Runs `POST /api/v2/episode-script-revisions/{id}/adopt`.
   * @replaces episodeDevelopments.adoptScriptRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsAdoptScriptRevision(
    id: string,
    input?: EpisodeDevelopmentsAdoptScriptRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsAdoptScriptRevisionResult> {
    return this.run(
      "episodeDevelopmentsAdoptScriptRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Explicit author source revision. Runs `POST /api/v2/episode-source-revisions/{id}/adopt`.
   * @replaces episodeDevelopments.adoptSourceRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsAdoptSourceRevision(
    id: string,
    input?: EpisodeDevelopmentsAdoptSourceRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsAdoptSourceRevisionResult> {
    return this.run(
      "episodeDevelopmentsAdoptSourceRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Author-confirmed outline/script topology revision. Runs `POST /api/v2/episode-topology-revisions/{id}/adopt`.
   * @replaces episodeDevelopments.adoptTopologyRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsAdoptTopologyRevision(
    id: string,
    input?: EpisodeDevelopmentsAdoptTopologyRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsAdoptTopologyRevisionResult> {
    return this.run(
      "episodeDevelopmentsAdoptTopologyRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Author-confirmed script revision. Runs `POST /api/v2/episode-script-revisions/{id}/discard`.
   * @replaces episodeDevelopments.discardScriptRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsDiscardScriptRevision(
    id: string,
    input?: EpisodeDevelopmentsDiscardScriptRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsDiscardScriptRevisionResult> {
    return this.run(
      "episodeDevelopmentsDiscardScriptRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Explicit author source revision. Runs `POST /api/v2/episode-source-revisions/{id}/discard`.
   * @replaces episodeDevelopments.discardSourceRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsDiscardSourceRevision(
    id: string,
    input?: EpisodeDevelopmentsDiscardSourceRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsDiscardSourceRevisionResult> {
    return this.run(
      "episodeDevelopmentsDiscardSourceRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Author-confirmed outline/script topology revision. Runs `POST /api/v2/episode-topology-revisions/{id}/discard`.
   * @replaces episodeDevelopments.discardTopologyRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsDiscardTopologyRevision(
    id: string,
    input?: EpisodeDevelopmentsDiscardTopologyRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsDiscardTopologyRevisionResult> {
    return this.run(
      "episodeDevelopmentsDiscardTopologyRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Explicitly adopted episode development. Runs `GET /api/v2/episode-development/{id}`.
   * @replaces episodeDevelopments.get
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeDevelopmentsGet(id: string): Promise<EpisodeDevelopmentsGetResult> {
    return this.run("episodeDevelopmentsGet", id);
  }

  /**
   * Author-confirmed script revision. Runs `GET /api/v2/episode-script-revisions/{id}`.
   * @replaces episodeDevelopments.getScriptRevision
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeDevelopmentsGetScriptRevision(
    id: string,
  ): Promise<EpisodeDevelopmentsGetScriptRevisionResult> {
    return this.run("episodeDevelopmentsGetScriptRevision", id);
  }

  /**
   * Explicit author source revision. Runs `GET /api/v2/episode-source-revisions/{id}`.
   * @replaces episodeDevelopments.getSourceRevision
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeDevelopmentsGetSourceRevision(
    id: string,
  ): Promise<EpisodeDevelopmentsGetSourceRevisionResult> {
    return this.run("episodeDevelopmentsGetSourceRevision", id);
  }

  /**
   * Explicit author source revision. Runs `GET /api/v2/episode-source-revisions/{id}/source-context`.
   * @replaces episodeDevelopments.getSourceRevisionContext
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeDevelopmentsGetSourceRevisionContext(
    id: string,
  ): Promise<EpisodeDevelopmentsGetSourceRevisionContextResult> {
    return this.run("episodeDevelopmentsGetSourceRevisionContext", id);
  }

  /**
   * Author-confirmed outline/script topology revision. Runs `GET /api/v2/episode-topology-revisions/{id}`.
   * @replaces episodeDevelopments.getTopologyRevision
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeDevelopmentsGetTopologyRevision(
    id: string,
  ): Promise<EpisodeDevelopmentsGetTopologyRevisionResult> {
    return this.run("episodeDevelopmentsGetTopologyRevision", id);
  }

  /**
   * Explicitly adopted episode development. Runs `GET /api/v2/episode-development/{id}/impact`.
   * @replaces episodeDevelopments.impact
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsImpact(
    id: string,
    query?: EpisodeDevelopmentsImpactQuery,
  ): Promise<EpisodeDevelopmentsImpactResult> {
    return this.run("episodeDevelopmentsImpact", id, query);
  }

  /**
   * Explicitly adopted episode development. Runs `GET /api/v2/projects/{projectId}/episode-development`.
   * @replaces episodeDevelopments.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsList(
    projectId: string,
    query?: EpisodeDevelopmentsListQuery,
  ): Promise<EpisodeDevelopmentsListResult> {
    return this.run("episodeDevelopmentsList", projectId, query);
  }

  /**
   * Author-confirmed script revision. Runs `GET /api/v2/projects/{projectId}/episode-script-revisions`.
   * @replaces episodeDevelopments.listScriptRevisions
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsListScriptRevisions(
    projectId: string,
    query?: EpisodeDevelopmentsListScriptRevisionsQuery,
  ): Promise<EpisodeDevelopmentsListScriptRevisionsResult> {
    return this.run("episodeDevelopmentsListScriptRevisions", projectId, query);
  }

  /**
   * Explicit author source revision. Runs `GET /api/v2/projects/{projectId}/episode-source-revisions`.
   * @replaces episodeDevelopments.listSourceRevisions
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsListSourceRevisions(
    projectId: string,
    query?: EpisodeDevelopmentsListSourceRevisionsQuery,
  ): Promise<EpisodeDevelopmentsListSourceRevisionsResult> {
    return this.run("episodeDevelopmentsListSourceRevisions", projectId, query);
  }

  /**
   * Author-confirmed outline/script topology revision. Runs `GET /api/v2/projects/{projectId}/episode-topology-revisions`.
   * @replaces episodeDevelopments.listTopologyRevisions
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsListTopologyRevisions(
    projectId: string,
    query?: EpisodeDevelopmentsListTopologyRevisionsQuery,
  ): Promise<EpisodeDevelopmentsListTopologyRevisionsResult> {
    return this.run(
      "episodeDevelopmentsListTopologyRevisions",
      projectId,
      query,
    );
  }

  /**
   * Author-confirmed script revision. Runs `POST /api/v2/episode-development/{id}/script-revision-previews`.
   * @replaces episodeDevelopments.previewScriptRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsPreviewScriptRevision(
    id: string,
    input?: EpisodeDevelopmentsPreviewScriptRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsPreviewScriptRevisionResult> {
    return this.run(
      "episodeDevelopmentsPreviewScriptRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Explicit author source revision. Runs `POST /api/v2/episode-development/{id}/source-revision-previews`.
   * @replaces episodeDevelopments.previewSourceRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsPreviewSourceRevision(
    id: string,
    input?: EpisodeDevelopmentsPreviewSourceRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsPreviewSourceRevisionResult> {
    return this.run(
      "episodeDevelopmentsPreviewSourceRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Author-confirmed outline/script topology revision. Runs `POST /api/v2/episode-development/{id}/topology-revision-previews`.
   * @replaces episodeDevelopments.previewTopologyRevision
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeDevelopmentsPreviewTopologyRevision(
    id: string,
    input?: EpisodeDevelopmentsPreviewTopologyRevisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeDevelopmentsPreviewTopologyRevisionResult> {
    return this.run(
      "episodeDevelopmentsPreviewTopologyRevision",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Author-confirmed script revision. Runs `GET /api/v2/projects/{projectId}/episode-script-revision-summaries`.
   * @replaces episodeDevelopments.scriptRevisionSummaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsScriptRevisionSummaries(
    projectId: string,
    query?: EpisodeDevelopmentsScriptRevisionSummariesQuery,
  ): Promise<EpisodeDevelopmentsScriptRevisionSummariesResult> {
    return this.run(
      "episodeDevelopmentsScriptRevisionSummaries",
      projectId,
      query,
    );
  }

  /**
   * Explicit author source revision. Runs `GET /api/v2/projects/{projectId}/episode-source-revision-summaries`.
   * @replaces episodeDevelopments.sourceRevisionSummaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsSourceRevisionSummaries(
    projectId: string,
    query?: EpisodeDevelopmentsSourceRevisionSummariesQuery,
  ): Promise<EpisodeDevelopmentsSourceRevisionSummariesResult> {
    return this.run(
      "episodeDevelopmentsSourceRevisionSummaries",
      projectId,
      query,
    );
  }

  /**
   * Explicitly adopted episode development. Runs `GET /api/v2/projects/{projectId}/episode-development-sources`.
   * @replaces episodeDevelopments.sources
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  episodeDevelopmentsSources(
    projectId: string,
  ): Promise<EpisodeDevelopmentsSourcesResult> {
    return this.run("episodeDevelopmentsSources", projectId);
  }

  /**
   * Explicitly adopted episode development. Runs `GET /api/v2/projects/{projectId}/episode-development-summaries`.
   * @replaces episodeDevelopments.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsSummaries(
    projectId: string,
    query?: EpisodeDevelopmentsSummariesQuery,
  ): Promise<EpisodeDevelopmentsSummariesResult> {
    return this.run("episodeDevelopmentsSummaries", projectId, query);
  }

  /**
   * Author-confirmed outline/script topology revision. Runs `GET /api/v2/projects/{projectId}/episode-topology-revision-summaries`.
   * @replaces episodeDevelopments.topologyRevisionSummaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  episodeDevelopmentsTopologyRevisionSummaries(
    projectId: string,
    query?: EpisodeDevelopmentsTopologyRevisionSummariesQuery,
  ): Promise<EpisodeDevelopmentsTopologyRevisionSummariesResult> {
    return this.run(
      "episodeDevelopmentsTopologyRevisionSummaries",
      projectId,
      query,
    );
  }

  /**
   * Runs `POST /api/v2/episodes`.
   * @replaces episodes.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodesCreate(
    input: EpisodesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodesCreateResult> {
    return this.run("episodesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/episodes/{id}`.
   * @replaces episodes.get
   * @param id - the `id` path parameter.
   */
  @Remote
  episodesGet(id: string): Promise<EpisodesGetResult> {
    return this.run("episodesGet", id);
  }

  /**
   * Runs `GET /api/v2/episodes`.
   * @replaces episodes.list
   * @param query - the query parameters.
   */
  @Remote
  episodesList(query?: EpisodesListQuery): Promise<EpisodesListResult> {
    return this.run("episodesList", query);
  }

  /**
   * Runs `DELETE /api/v2/episodes/{id}`.
   * @replaces episodes.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("episodesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/episodes/{id}`.
   * @replaces episodes.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodesUpdate(
    id: string,
    input: EpisodesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodesUpdateResult> {
    return this.run("episodesUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/adaptations/{id}/episodes/reorder`.
   * @replaces production-structure.reorderEpisodes
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  structureReorderEpisodes(
    id: string,
    input: StructureReorderEpisodesInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StructureReorderEpisodesResult> {
    return this.run(
      "structureReorderEpisodes",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/scripts/{id}/scenes/reorder`.
   * @replaces production-structure.reorderScenes
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  structureReorderScenes(
    id: string,
    input: StructureReorderScenesInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StructureReorderScenesResult> {
    return this.run(
      "structureReorderScenes",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/scenes/{id}/shots/reorder`.
   * @replaces production-structure.reorderShots
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  structureReorderShots(
    id: string,
    input: StructureReorderShotsInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StructureReorderShotsResult> {
    return this.run(
      "structureReorderShots",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/current-adaptation`.
   * @replaces production-structure.selectCurrentAdaptation
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  structureSelectCurrentAdaptation(
    projectId: string,
    input: StructureSelectCurrentAdaptationInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StructureSelectCurrentAdaptationResult> {
    return this.run(
      "structureSelectCurrentAdaptation",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{id}/production-graph`.
   * @replaces production.graph
   * @param id - the `id` path parameter.
   */
  @Remote
  graph(id: string): Promise<GraphResult> {
    return this.run("graph", id);
  }

  /**
   * Runs `POST /api/v2/production/impact`.
   * @replaces production.impact
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  impact(
    input: ImpactInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImpactResult> {
    return this.run("impact", input, ifMatch, idempotencyKey);
  }

  /**
   * Actual read-only saved evidence, not semantic quality. Runs `GET /api/v2/projects/{projectId}/production-quality-sources/{recordId}`.
   * @replaces productionQualitySources.get
   * @param projectId - the `projectId` path parameter.
   * @param recordId - the `recordId` path parameter.
   */
  @Remote
  productionQualitySourcesGet(
    projectId: string,
    recordId: string,
  ): Promise<ProductionQualitySourcesGetResult> {
    return this.run("productionQualitySourcesGet", projectId, recordId);
  }

  /**
   * Actual read-only saved evidence, not semantic quality. Runs `GET /api/v2/projects/{projectId}/production-quality-sources`.
   * @replaces productionQualitySources.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  productionQualitySourcesList(
    projectId: string,
    query?: ProductionQualitySourcesListQuery,
  ): Promise<ProductionQualitySourcesListResult> {
    return this.run("productionQualitySourcesList", projectId, query);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/progress`.
   * @replaces projects.progress
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  projectsProgress(
    id: string,
    query?: ProjectsProgressQuery,
  ): Promise<ProjectsProgressResult> {
    return this.run("projectsProgress", id, query);
  }

  /**
   * Runs `POST /api/v2/scenes`.
   * @replaces scenes.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  scenesCreate(
    input: ScenesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScenesCreateResult> {
    return this.run("scenesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/scenes/{id}`.
   * @replaces scenes.get
   * @param id - the `id` path parameter.
   */
  @Remote
  scenesGet(id: string): Promise<ScenesGetResult> {
    return this.run("scenesGet", id);
  }

  /**
   * Runs `GET /api/v2/scenes`.
   * @replaces scenes.list
   * @param query - the query parameters.
   */
  @Remote
  scenesList(query?: ScenesListQuery): Promise<ScenesListResult> {
    return this.run("scenesList", query);
  }

  /**
   * Runs `DELETE /api/v2/scenes/{id}`.
   * @replaces scenes.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  scenesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("scenesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/scenes/{id}`.
   * @replaces scenes.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  scenesUpdate(
    id: string,
    input: ScenesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScenesUpdateResult> {
    return this.run("scenesUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/screenplay-import-previews/{id}/commit`.
   * @replaces screenplayImport.commit
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplayImportCommit(
    id: string,
    input: ScreenplayImportCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplayImportCommitResult> {
    return this.run(
      "screenplayImportCommit",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/screenplay-import-previews`.
   * @replaces screenplayImport.createPreview
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplayImportCreatePreview(
    input: ScreenplayImportCreatePreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplayImportCreatePreviewResult> {
    return this.run(
      "screenplayImportCreatePreview",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `DELETE /api/v2/screenplay-import-previews/{id}`.
   * @replaces screenplayImport.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplayImportDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplayImportDiscardResult> {
    return this.run("screenplayImportDiscard", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/screenplay-import-previews/{id}`.
   * @replaces screenplayImport.getPreview
   * @param id - the `id` path parameter.
   */
  @Remote
  screenplayImportGetPreview(
    id: string,
  ): Promise<ScreenplayImportGetPreviewResult> {
    return this.run("screenplayImportGetPreview", id);
  }

  /**
   * Exact intake state. Runs `POST /api/v2/screenplay-intakes/{id}/commit`.
   * @replaces screenplayIntakes.commit
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplayIntakesCommit(
    id: string,
    input: ScreenplayIntakesCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplayIntakesCommitResult> {
    return this.run(
      "screenplayIntakesCommit",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Exact intake state. Runs `DELETE /api/v2/screenplay-intakes/{id}`.
   * @replaces screenplayIntakes.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplayIntakesDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplayIntakesDiscardResult> {
    return this.run("screenplayIntakesDiscard", id, ifMatch, idempotencyKey);
  }

  /**
   * Exact intake state. Runs `GET /api/v2/screenplay-intakes/{id}`.
   * @replaces screenplayIntakes.get
   * @param id - the `id` path parameter.
   */
  @Remote
  screenplayIntakesGet(id: string): Promise<ScreenplayIntakesGetResult> {
    return this.run("screenplayIntakesGet", id);
  }

  /**
   * Exact intake state. Runs `POST /api/v2/screenplay-intakes`.
   * @replaces screenplayIntakes.preview
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplayIntakesPreview(
    input: ScreenplayIntakesPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplayIntakesPreviewResult> {
    return this.run("screenplayIntakesPreview", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/scripts/{id}/screenplay/export/{format}`.
   * @replaces screenplays.export
   * @param id - the `id` path parameter.
   * @param format - the `format` path parameter.
   */
  @Remote
  screenplaysExport(
    id: string,
    format: "fountain" | "fdx",
  ): Promise<ScreenplaysExportResult> {
    return this.run("screenplaysExport", id, format);
  }

  /**
   * Runs `GET /api/v2/scripts/{id}/screenplay`.
   * @replaces screenplays.get
   * @param id - the `id` path parameter.
   */
  @Remote
  screenplaysGet(id: string): Promise<ScreenplaysGetResult> {
    return this.run("screenplaysGet", id);
  }

  /**
   * Runs `PATCH /api/v2/scripts/{id}/screenplay`.
   * @replaces screenplays.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  screenplaysUpdate(
    id: string,
    input: ScreenplaysUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScreenplaysUpdateResult> {
    return this.run("screenplaysUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Read the exact already-saved screenplay source without initialization. Runs `GET /api/v2/projects/{projectId}/screenplay-sources/{scriptId}`.
   * @replaces screenplaySources.get
   * @param projectId - the `projectId` path parameter.
   * @param scriptId - the `scriptId` path parameter.
   */
  @Remote
  screenplaySourcesGet(
    projectId: string,
    scriptId: string,
  ): Promise<ScreenplaySourcesGetResult> {
    return this.run("screenplaySourcesGet", projectId, scriptId);
  }

  /**
   * Read the exact already-saved screenplay source without initialization. Runs `GET /api/v2/projects/{projectId}/screenplay-sources`.
   * @replaces screenplaySources.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  screenplaySourcesList(
    projectId: string,
    query?: ScreenplaySourcesListQuery,
  ): Promise<ScreenplaySourcesListResult> {
    return this.run("screenplaySourcesList", projectId, query);
  }

  /**
   * Runs `POST /api/v2/scripts`.
   * @replaces scripts.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  scriptsCreate(
    input: ScriptsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScriptsCreateResult> {
    return this.run("scriptsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/scripts/{id}`.
   * @replaces scripts.get
   * @param id - the `id` path parameter.
   */
  @Remote
  scriptsGet(id: string): Promise<ScriptsGetResult> {
    return this.run("scriptsGet", id);
  }

  /**
   * Runs `GET /api/v2/scripts`.
   * @replaces scripts.list
   * @param query - the query parameters.
   */
  @Remote
  scriptsList(query?: ScriptsListQuery): Promise<ScriptsListResult> {
    return this.run("scriptsList", query);
  }

  /**
   * Runs `DELETE /api/v2/scripts/{id}`.
   * @replaces scripts.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  scriptsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("scriptsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/scripts/{id}`.
   * @replaces scripts.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  scriptsUpdate(
    id: string,
    input: ScriptsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ScriptsUpdateResult> {
    return this.run("scriptsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Season plan result. Runs `POST /api/v2/season-plans/{id}/adopt`.
   * @replaces seasonPlans.adopt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seasonPlansAdopt(
    id: string,
    input: SeasonPlansAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeasonPlansAdoptResult> {
    return this.run("seasonPlansAdopt", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Season plan result. Runs `POST /api/v2/season-plans/{id}/discard`.
   * @replaces seasonPlans.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seasonPlansDiscard(
    id: string,
    input: SeasonPlansDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeasonPlansDiscardResult> {
    return this.run("seasonPlansDiscard", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Season plan result. Runs `GET /api/v2/season-plans/{id}`.
   * @replaces seasonPlans.get
   * @param id - the `id` path parameter.
   */
  @Remote
  seasonPlansGet(id: string): Promise<SeasonPlansGetResult> {
    return this.run("seasonPlansGet", id);
  }

  /**
   * Season plan result. Runs `GET /api/v2/projects/{projectId}/season-plans`.
   * @replaces seasonPlans.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  seasonPlansList(
    projectId: string,
    query?: SeasonPlansListQuery,
  ): Promise<SeasonPlansListResult> {
    return this.run("seasonPlansList", projectId, query);
  }

  /**
   * Season plan result. Runs `POST /api/v2/season-plans/{id}/reorder`.
   * @replaces seasonPlans.reorder
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seasonPlansReorder(
    id: string,
    input: SeasonPlansReorderInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeasonPlansReorderResult> {
    return this.run("seasonPlansReorder", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Season plan result. Runs `GET /api/v2/projects/{projectId}/season-plan-sources`.
   * @replaces seasonPlans.sources
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  seasonPlansSources(projectId: string): Promise<SeasonPlansSourcesResult> {
    return this.run("seasonPlansSources", projectId);
  }

  /**
   * Season plan result. Runs `GET /api/v2/projects/{projectId}/season-plan-previews`.
   * @replaces seasonPlans.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  seasonPlansSummaries(
    projectId: string,
    query?: SeasonPlansSummariesQuery,
  ): Promise<SeasonPlansSummariesResult> {
    return this.run("seasonPlansSummaries", projectId, query);
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/seasons`.
   * @replaces seasons.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seasonsCreate(
    projectId: string,
    input: SeasonsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeasonsCreateResult> {
    return this.run("seasonsCreate", projectId, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/seasons`.
   * @replaces seasons.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  seasonsList(
    projectId: string,
    query?: SeasonsListQuery,
  ): Promise<SeasonsListResult> {
    return this.run("seasonsList", projectId, query);
  }

  /**
   * Runs `POST /api/v2/seasons/{id}/chapter-mappings`.
   * @replaces seasons.mapChapter
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seasonsMapChapter(
    id: string,
    input: SeasonsMapChapterInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeasonsMapChapterResult> {
    return this.run("seasonsMapChapter", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/seasons/{id}`.
   * @replaces seasons.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  seasonsUpdate(
    id: string,
    input: SeasonsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SeasonsUpdateResult> {
    return this.run("seasonsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/shots`.
   * @replaces shots.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  shotsCreate(
    input: ShotsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ShotsCreateResult> {
    return this.run("shotsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/shots/{id}`.
   * @replaces shots.get
   * @param id - the `id` path parameter.
   */
  @Remote
  shotsGet(id: string): Promise<ShotsGetResult> {
    return this.run("shotsGet", id);
  }

  /**
   * Runs `GET /api/v2/shots`.
   * @replaces shots.list
   * @param query - the query parameters.
   */
  @Remote
  shotsList(query?: ShotsListQuery): Promise<ShotsListResult> {
    return this.run("shotsList", query);
  }

  /**
   * Runs `DELETE /api/v2/shots/{id}`.
   * @replaces shots.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  shotsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("shotsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/shots/{id}`.
   * @replaces shots.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  shotsUpdate(
    id: string,
    input: ShotsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ShotsUpdateResult> {
    return this.run("shotsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Exact human-declared shot association; semantics remain unverified. Runs `POST /api/v2/projects/{projectId}/storyboard-attributions`.
   * @replaces storyboardAttribution.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyboardAttributionCreate(
    projectId: string,
    input: StoryboardAttributionCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryboardAttributionCreateResult> {
    return this.run(
      "storyboardAttributionCreate",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Exact human-declared shot association; semantics remain unverified. Runs `POST /api/v2/projects/{projectId}/storyboard-attributions/{id}/decision`.
   * @replaces storyboardAttribution.decide
   * @param projectId - the `projectId` path parameter.
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyboardAttributionDecide(
    projectId: string,
    id: string,
    input: StoryboardAttributionDecideInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryboardAttributionDecideResult> {
    return this.run(
      "storyboardAttributionDecide",
      projectId,
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Exact human-declared shot association; semantics remain unverified. Runs `GET /api/v2/projects/{projectId}/storyboard-attributions/{id}`.
   * @replaces storyboardAttribution.get
   * @param projectId - the `projectId` path parameter.
   * @param id - the `id` path parameter.
   */
  @Remote
  storyboardAttributionGet(
    projectId: string,
    id: string,
  ): Promise<StoryboardAttributionGetResult> {
    return this.run("storyboardAttributionGet", projectId, id);
  }

  /**
   * Exact human-declared shot association; semantics remain unverified. Runs `GET /api/v2/projects/{projectId}/storyboard-attributions`.
   * @replaces storyboardAttribution.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  storyboardAttributionList(
    projectId: string,
    query?: StoryboardAttributionListQuery,
  ): Promise<StoryboardAttributionListResult> {
    return this.run("storyboardAttributionList", projectId, query);
  }

  /**
   * Exact human-declared shot association; semantics remain unverified. Runs `GET /api/v2/projects/{projectId}/storyboard-attribution-sources/{id}`.
   * @replaces storyboardAttribution.sources
   * @param projectId - the `projectId` path parameter.
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  storyboardAttributionSources(
    projectId: string,
    id: string,
    query: StoryboardAttributionSourcesQuery,
  ): Promise<StoryboardAttributionSourcesResult> {
    return this.run("storyboardAttributionSources", projectId, id, query);
  }

  /**
   * Exact human-declared shot association; semantics remain unverified. Runs `GET /api/v2/projects/{projectId}/storyboard-attributions/summaries`.
   * @replaces storyboardAttribution.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  storyboardAttributionSummaries(
    projectId: string,
    query?: StoryboardAttributionSummariesQuery,
  ): Promise<StoryboardAttributionSummariesResult> {
    return this.run("storyboardAttributionSummaries", projectId, query);
  }
}

export default ProductionController;
