/**
 * Host face of the creative-quality domain. It owns the `quality` Remote namespace:
 * story analysis, beats, highlights, feasibility, trends, evaluations, pacing marks, narrative quality, originality risks, creative fingerprints and experiments. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * creative-quality plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/writing-quality
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AdaptationAnalysisGetResult,
  AdaptationAnalysisRunResult,
  AnalysisCreateInput,
  AnalysisCreateResult,
  AnalysisGetResult,
  AnalysisListQuery,
  AnalysisListResult,
  AnalysisUpdateInput,
  AnalysisUpdateResult,
  BeatsCreateInput,
  BeatsCreateResult,
  BeatsGetResult,
  BeatsListQuery,
  BeatsListResult,
  BeatsUpdateInput,
  BeatsUpdateResult,
  CreativeExperimentsCreateInput,
  CreativeExperimentsCreateResult,
  CreativeExperimentsListQuery,
  CreativeExperimentsListResult,
  CreativeExperimentsReviewInput,
  CreativeExperimentsReviewResult,
  CreativeFingerprintGetResult,
  CreativeFingerprintUpdateInput,
  CreativeFingerprintUpdateResult,
  CreativeFingerprintUpdateSettingsInput,
  CreativeFingerprintUpdateSettingsResult,
  CreativeAcknowledgeIssueInput,
  CreativeAcknowledgeIssueResult,
  CreativeCreateCaseStudyInput,
  CreativeCreateCaseStudyResult,
  CreativeListCaseStudiesResult,
  CreativeListDiagnosticsResult,
  CreativeListIssueAcknowledgementsResult,
  CreativeRunDiagnosticsInput,
  CreativeRunDiagnosticsResult,
  CreativeUpdateCaseStudyInput,
  CreativeUpdateCaseStudyResult,
  EpisodePacingMarksCreateInput,
  EpisodePacingMarksCreateResult,
  EpisodePacingMarksGetResult,
  EpisodePacingMarksListQuery,
  EpisodePacingMarksListResult,
  EpisodePacingMarksUpdateInput,
  EpisodePacingMarksUpdateResult,
  EvaluationsCreateInput,
  EvaluationsCreateResult,
  EvaluationsGetResult,
  EvaluationsListQuery,
  EvaluationsListResult,
  EvaluationsUpdateInput,
  EvaluationsUpdateResult,
  FeasibilityCreateInput,
  FeasibilityCreateResult,
  FeasibilityGetResult,
  FeasibilityListQuery,
  FeasibilityListResult,
  FeasibilityUpdateInput,
  FeasibilityUpdateResult,
  HighlightsCreateInput,
  HighlightsCreateResult,
  HighlightsGetResult,
  HighlightsListQuery,
  HighlightsListResult,
  HighlightsUpdateInput,
  HighlightsUpdateResult,
  NarrativeLocalQualityCreateInput,
  NarrativeLocalQualityCreateResult,
  NarrativeLocalQualityDecideInput,
  NarrativeLocalQualityDecideResult,
  NarrativeLocalQualityDispositionInput,
  NarrativeLocalQualityDispositionResult,
  NarrativeLocalQualityGetResult,
  NarrativeLocalQualityListResult,
  NarrativeLocalQualityPreviewInput,
  NarrativeLocalQualityPreviewResult,
  NarrativeLocalQualitySummariesQuery,
  NarrativeLocalQualitySummariesResult,
  NarrativeQualityDispositionInput,
  NarrativeQualityDispositionResult,
  NarrativeQualityGetResult,
  NarrativeQualityListQuery,
  NarrativeQualityListResult,
  NarrativeQualitySourcesResult,
  NarrativeQualitySummariesQuery,
  NarrativeQualitySummariesResult,
  OriginalityRisksListResult,
  CreateInput,
  CreateResult,
  GetResult,
  ListQuery,
  ListResult,
  UpdateInput,
  UpdateResult,
  TrendsCreateInput,
  TrendsCreateResult,
  TrendsGetResult,
  TrendsListQuery,
  TrendsListResult,
  TrendsUpdateInput,
  TrendsUpdateResult,
} from "./types.ts";
import {
  creativeQualityLegacyRoutes,
  type CreativeQualityLegacyMethod,
} from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `quality` Remote namespace. */
    qualityController: QualityController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  creativeQualityLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.quality` namespace. */
export class QualityController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "qualityController", { namespace: "quality" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: CreativeQualityLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = creativeQualityLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `GET /api/v2/adaptations/{id}/episode-analysis`.
   * @replaces adaptation-analysis.get
   * @param id - the `id` path parameter.
   */
  @Remote
  adaptationAnalysisGet(id: string): Promise<AdaptationAnalysisGetResult> {
    return this.run("adaptationAnalysisGet", id);
  }

  /**
   * Runs `DELETE /api/v2/adaptations/{id}/episode-analysis`.
   * @replaces adaptation-analysis.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationAnalysisRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("adaptationAnalysisRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/adaptations/{id}/episode-analysis`.
   * @replaces adaptation-analysis.run
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  adaptationAnalysisRun(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AdaptationAnalysisRunResult> {
    return this.run("adaptationAnalysisRun", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/analysis`.
   * @replaces analysis.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  analysisCreate(
    input: AnalysisCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AnalysisCreateResult> {
    return this.run("analysisCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/analysis/{id}`.
   * @replaces analysis.get
   * @param id - the `id` path parameter.
   */
  @Remote
  analysisGet(id: string): Promise<AnalysisGetResult> {
    return this.run("analysisGet", id);
  }

  /**
   * Runs `GET /api/v2/analysis`.
   * @replaces analysis.list
   * @param query - the query parameters.
   */
  @Remote
  analysisList(query?: AnalysisListQuery): Promise<AnalysisListResult> {
    return this.run("analysisList", query);
  }

  /**
   * Runs `DELETE /api/v2/analysis/{id}`.
   * @replaces analysis.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  analysisRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("analysisRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/analysis/{id}`.
   * @replaces analysis.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  analysisUpdate(
    id: string,
    input: AnalysisUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AnalysisUpdateResult> {
    return this.run("analysisUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/beats`.
   * @replaces beats.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  beatsCreate(
    input: BeatsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<BeatsCreateResult> {
    return this.run("beatsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/beats/{id}`.
   * @replaces beats.get
   * @param id - the `id` path parameter.
   */
  @Remote
  beatsGet(id: string): Promise<BeatsGetResult> {
    return this.run("beatsGet", id);
  }

  /**
   * Runs `GET /api/v2/beats`.
   * @replaces beats.list
   * @param query - the query parameters.
   */
  @Remote
  beatsList(query?: BeatsListQuery): Promise<BeatsListResult> {
    return this.run("beatsList", query);
  }

  /**
   * Runs `DELETE /api/v2/beats/{id}`.
   * @replaces beats.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  beatsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("beatsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/beats/{id}`.
   * @replaces beats.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  beatsUpdate(
    id: string,
    input: BeatsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<BeatsUpdateResult> {
    return this.run("beatsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creative-experiments`.
   * @replaces creative-experiments.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeExperimentsCreate(
    input: CreativeExperimentsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeExperimentsCreateResult> {
    return this.run(
      "creativeExperimentsCreate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/creative-experiments`.
   * @replaces creative-experiments.list
   * @param query - the query parameters.
   */
  @Remote
  creativeExperimentsList(
    query?: CreativeExperimentsListQuery,
  ): Promise<CreativeExperimentsListResult> {
    return this.run("creativeExperimentsList", query);
  }

  /**
   * Runs `POST /api/v2/creative-experiments/{id}/review`.
   * @replaces creative-experiments.review
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeExperimentsReview(
    id: string,
    input: CreativeExperimentsReviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeExperimentsReviewResult> {
    return this.run(
      "creativeExperimentsReview",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `DELETE /api/v2/creative-fingerprint`.
   * @replaces creative-fingerprint.clear
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeFingerprintClear(
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("creativeFingerprintClear", ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creative-fingerprint`.
   * @replaces creative-fingerprint.get
   */
  @Remote
  creativeFingerprintGet(): Promise<CreativeFingerprintGetResult> {
    return this.run("creativeFingerprintGet");
  }

  /**
   * Runs `PATCH /api/v2/creative-fingerprint`.
   * @replaces creative-fingerprint.update
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeFingerprintUpdate(
    input: CreativeFingerprintUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeFingerprintUpdateResult> {
    return this.run(
      "creativeFingerprintUpdate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PUT /api/v2/creative-fingerprint/settings`.
   * @replaces creative-fingerprint.updateSettings
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeFingerprintUpdateSettings(
    input: CreativeFingerprintUpdateSettingsInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeFingerprintUpdateSettingsResult> {
    return this.run(
      "creativeFingerprintUpdateSettings",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/creative/issue-acknowledgements`.
   * @replaces creative.acknowledgeIssue
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeAcknowledgeIssue(
    input: CreativeAcknowledgeIssueInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeAcknowledgeIssueResult> {
    return this.run("creativeAcknowledgeIssue", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creative/case-studies`.
   * @replaces creative.createCaseStudy
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeCreateCaseStudy(
    input: CreativeCreateCaseStudyInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeCreateCaseStudyResult> {
    return this.run("creativeCreateCaseStudy", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creative/case-studies`.
   * @replaces creative.listCaseStudies
   */
  @Remote
  creativeListCaseStudies(): Promise<CreativeListCaseStudiesResult> {
    return this.run("creativeListCaseStudies");
  }

  /**
   * Runs `GET /api/v2/projects/{id}/creative-diagnostics`.
   * @replaces creative.listDiagnostics
   * @param id - the `id` path parameter.
   */
  @Remote
  creativeListDiagnostics(id: string): Promise<CreativeListDiagnosticsResult> {
    return this.run("creativeListDiagnostics", id);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/creative-issue-acknowledgements`.
   * @replaces creative.listIssueAcknowledgements
   * @param id - the `id` path parameter.
   */
  @Remote
  creativeListIssueAcknowledgements(
    id: string,
  ): Promise<CreativeListIssueAcknowledgementsResult> {
    return this.run("creativeListIssueAcknowledgements", id);
  }

  /**
   * Runs `DELETE /api/v2/creative/case-studies/{id}`.
   * @replaces creative.removeCaseStudy
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeRemoveCaseStudy(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("creativeRemoveCaseStudy", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creative/diagnostics`.
   * @replaces creative.runDiagnostics
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeRunDiagnostics(
    input: CreativeRunDiagnosticsInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeRunDiagnosticsResult> {
    return this.run("creativeRunDiagnostics", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/creative/case-studies/{id}`.
   * @replaces creative.updateCaseStudy
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeUpdateCaseStudy(
    id: string,
    input: CreativeUpdateCaseStudyInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeUpdateCaseStudyResult> {
    return this.run(
      "creativeUpdateCaseStudy",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/episode-pacing-marks`.
   * @replaces episode-pacing-marks.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodePacingMarksCreate(
    input: EpisodePacingMarksCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodePacingMarksCreateResult> {
    return this.run("episodePacingMarksCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/episode-pacing-marks/{id}`.
   * @replaces episode-pacing-marks.get
   * @param id - the `id` path parameter.
   */
  @Remote
  episodePacingMarksGet(id: string): Promise<EpisodePacingMarksGetResult> {
    return this.run("episodePacingMarksGet", id);
  }

  /**
   * Runs `GET /api/v2/episode-pacing-marks`.
   * @replaces episode-pacing-marks.list
   * @param query - the query parameters.
   */
  @Remote
  episodePacingMarksList(
    query?: EpisodePacingMarksListQuery,
  ): Promise<EpisodePacingMarksListResult> {
    return this.run("episodePacingMarksList", query);
  }

  /**
   * Runs `DELETE /api/v2/episode-pacing-marks/{id}`.
   * @replaces episode-pacing-marks.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodePacingMarksRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("episodePacingMarksRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/episode-pacing-marks/{id}`.
   * @replaces episode-pacing-marks.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodePacingMarksUpdate(
    id: string,
    input: EpisodePacingMarksUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodePacingMarksUpdateResult> {
    return this.run(
      "episodePacingMarksUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/evaluations`.
   * @replaces evaluations.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  evaluationsCreate(
    input: EvaluationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EvaluationsCreateResult> {
    return this.run("evaluationsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/evaluations/{id}`.
   * @replaces evaluations.get
   * @param id - the `id` path parameter.
   */
  @Remote
  evaluationsGet(id: string): Promise<EvaluationsGetResult> {
    return this.run("evaluationsGet", id);
  }

  /**
   * Runs `GET /api/v2/evaluations`.
   * @replaces evaluations.list
   * @param query - the query parameters.
   */
  @Remote
  evaluationsList(
    query?: EvaluationsListQuery,
  ): Promise<EvaluationsListResult> {
    return this.run("evaluationsList", query);
  }

  /**
   * Runs `DELETE /api/v2/evaluations/{id}`.
   * @replaces evaluations.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  evaluationsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("evaluationsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/evaluations/{id}`.
   * @replaces evaluations.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  evaluationsUpdate(
    id: string,
    input: EvaluationsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EvaluationsUpdateResult> {
    return this.run("evaluationsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/feasibility`.
   * @replaces feasibility.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feasibilityCreate(
    input: FeasibilityCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<FeasibilityCreateResult> {
    return this.run("feasibilityCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/feasibility/{id}`.
   * @replaces feasibility.get
   * @param id - the `id` path parameter.
   */
  @Remote
  feasibilityGet(id: string): Promise<FeasibilityGetResult> {
    return this.run("feasibilityGet", id);
  }

  /**
   * Runs `GET /api/v2/feasibility`.
   * @replaces feasibility.list
   * @param query - the query parameters.
   */
  @Remote
  feasibilityList(
    query?: FeasibilityListQuery,
  ): Promise<FeasibilityListResult> {
    return this.run("feasibilityList", query);
  }

  /**
   * Runs `DELETE /api/v2/feasibility/{id}`.
   * @replaces feasibility.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feasibilityRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("feasibilityRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/feasibility/{id}`.
   * @replaces feasibility.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feasibilityUpdate(
    id: string,
    input: FeasibilityUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<FeasibilityUpdateResult> {
    return this.run("feasibilityUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/highlights`.
   * @replaces highlights.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  highlightsCreate(
    input: HighlightsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<HighlightsCreateResult> {
    return this.run("highlightsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/highlights/{id}`.
   * @replaces highlights.get
   * @param id - the `id` path parameter.
   */
  @Remote
  highlightsGet(id: string): Promise<HighlightsGetResult> {
    return this.run("highlightsGet", id);
  }

  /**
   * Runs `GET /api/v2/highlights`.
   * @replaces highlights.list
   * @param query - the query parameters.
   */
  @Remote
  highlightsList(query?: HighlightsListQuery): Promise<HighlightsListResult> {
    return this.run("highlightsList", query);
  }

  /**
   * Runs `DELETE /api/v2/highlights/{id}`.
   * @replaces highlights.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  highlightsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("highlightsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/highlights/{id}`.
   * @replaces highlights.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  highlightsUpdate(
    id: string,
    input: HighlightsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<HighlightsUpdateResult> {
    return this.run("highlightsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `POST /api/v2/projects/{id}/narrative-local-reviews`.
   * @replaces narrativeLocalQuality.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  narrativeLocalQualityCreate(
    id: string,
    input: NarrativeLocalQualityCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NarrativeLocalQualityCreateResult> {
    return this.run(
      "narrativeLocalQualityCreate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `POST /api/v2/narrative-local-reviews/{id}/decision`.
   * @replaces narrativeLocalQuality.decide
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  narrativeLocalQualityDecide(
    id: string,
    input: NarrativeLocalQualityDecideInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NarrativeLocalQualityDecideResult> {
    return this.run(
      "narrativeLocalQualityDecide",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `POST /api/v2/narrative-local-reviews/{id}/dispositions`.
   * @replaces narrativeLocalQuality.disposition
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  narrativeLocalQualityDisposition(
    id: string,
    input: NarrativeLocalQualityDispositionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NarrativeLocalQualityDispositionResult> {
    return this.run(
      "narrativeLocalQualityDisposition",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `GET /api/v2/narrative-local-reviews/{id}`.
   * @replaces narrativeLocalQuality.get
   * @param id - the `id` path parameter.
   */
  @Remote
  narrativeLocalQualityGet(
    id: string,
  ): Promise<NarrativeLocalQualityGetResult> {
    return this.run("narrativeLocalQualityGet", id);
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `GET /api/v2/projects/{id}/narrative-local-reviews`.
   * @replaces narrativeLocalQuality.list
   * @param id - the `id` path parameter.
   */
  @Remote
  narrativeLocalQualityList(
    id: string,
  ): Promise<NarrativeLocalQualityListResult> {
    return this.run("narrativeLocalQualityList", id);
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `POST /api/v2/projects/{id}/narrative-local-review-sources`.
   * @replaces narrativeLocalQuality.preview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  narrativeLocalQualityPreview(
    id: string,
    input: NarrativeLocalQualityPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NarrativeLocalQualityPreviewResult> {
    return this.run(
      "narrativeLocalQualityPreview",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Local declaration or exact structural rule; no semantic certification. Runs `GET /api/v2/projects/{id}/narrative-local-review-summaries`.
   * @replaces narrativeLocalQuality.summaries
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  narrativeLocalQualitySummaries(
    id: string,
    query?: NarrativeLocalQualitySummariesQuery,
  ): Promise<NarrativeLocalQualitySummariesResult> {
    return this.run("narrativeLocalQualitySummaries", id, query);
  }

  /**
   * Version-bound narrative review; not a quality guarantee. Runs `POST /api/v2/narrative-quality-reports/{id}/dispositions`.
   * @replaces narrativeQuality.disposition
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  narrativeQualityDisposition(
    id: string,
    input: NarrativeQualityDispositionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NarrativeQualityDispositionResult> {
    return this.run(
      "narrativeQualityDisposition",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Version-bound narrative review; not a quality guarantee. Runs `GET /api/v2/narrative-quality-reports/{id}`.
   * @replaces narrativeQuality.get
   * @param id - the `id` path parameter.
   */
  @Remote
  narrativeQualityGet(id: string): Promise<NarrativeQualityGetResult> {
    return this.run("narrativeQualityGet", id);
  }

  /**
   * Version-bound narrative review; not a quality guarantee. Runs `GET /api/v2/projects/{id}/narrative-quality-reports`.
   * @replaces narrativeQuality.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  narrativeQualityList(
    id: string,
    query?: NarrativeQualityListQuery,
  ): Promise<NarrativeQualityListResult> {
    return this.run("narrativeQualityList", id, query);
  }

  /**
   * Version-bound narrative review; not a quality guarantee. Runs `GET /api/v2/projects/{id}/narrative-quality-sources`.
   * @replaces narrativeQuality.sources
   * @param id - the `id` path parameter.
   */
  @Remote
  narrativeQualitySources(id: string): Promise<NarrativeQualitySourcesResult> {
    return this.run("narrativeQualitySources", id);
  }

  /**
   * Version-bound narrative review; not a quality guarantee. Runs `GET /api/v2/projects/{id}/narrative-quality-summaries`.
   * @replaces narrativeQuality.summaries
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  narrativeQualitySummaries(
    id: string,
    query?: NarrativeQualitySummariesQuery,
  ): Promise<NarrativeQualitySummariesResult> {
    return this.run("narrativeQualitySummaries", id, query);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/originality-risks`.
   * @replaces originality-risks.list
   * @param id - the `id` path parameter.
   */
  @Remote
  originalityRisksList(id: string): Promise<OriginalityRisksListResult> {
    return this.run("originalityRisksList", id);
  }

  /**
   * Runs `POST /api/v2/quality`.
   * @replaces quality.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  create(
    input: CreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreateResult> {
    return this.run("create", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/quality/{id}`.
   * @replaces quality.get
   * @param id - the `id` path parameter.
   */
  @Remote
  get(id: string): Promise<GetResult> {
    return this.run("get", id);
  }

  /**
   * Runs `GET /api/v2/quality`.
   * @replaces quality.list
   * @param query - the query parameters.
   */
  @Remote
  list(query?: ListQuery): Promise<ListResult> {
    return this.run("list", query);
  }

  /**
   * Runs `DELETE /api/v2/quality/{id}`.
   * @replaces quality.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  qualityRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("qualityRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/quality/{id}`.
   * @replaces quality.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  update(
    id: string,
    input: UpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<UpdateResult> {
    return this.run("update", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/trends`.
   * @replaces trends.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  trendsCreate(
    input: TrendsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TrendsCreateResult> {
    return this.run("trendsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/trends/{id}`.
   * @replaces trends.get
   * @param id - the `id` path parameter.
   */
  @Remote
  trendsGet(id: string): Promise<TrendsGetResult> {
    return this.run("trendsGet", id);
  }

  /**
   * Runs `GET /api/v2/trends`.
   * @replaces trends.list
   * @param query - the query parameters.
   */
  @Remote
  trendsList(query?: TrendsListQuery): Promise<TrendsListResult> {
    return this.run("trendsList", query);
  }

  /**
   * Runs `DELETE /api/v2/trends/{id}`.
   * @replaces trends.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  trendsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("trendsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/trends/{id}`.
   * @replaces trends.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  trendsUpdate(
    id: string,
    input: TrendsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TrendsUpdateResult> {
    return this.run("trendsUpdate", id, input, ifMatch, idempotencyKey);
  }
}

export default QualityController;
