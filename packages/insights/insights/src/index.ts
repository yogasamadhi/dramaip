/**
 * Host face of the insights domain. It owns the `insights` Remote namespace:
 * audience feedback (import preview and commit, the dashboard, comment
 * clusters and the revision task they suggest), the generation ledger and its
 * cost history, and the read-only creative outcome reports. Each method names
 * the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * insights plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/insights-insights
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import { outcomeMeasures } from "./measures.ts";
import type {
  CreativeConfigurationFunnel,
  CreativeContinuationGlobal,
  CreativeDeliveryCoverage,
  CreativeDeliveryWindow,
  CreativeExecutionRequestList,
  CreativeExecutionRequestPage,
  CreativeOutcomePage,
  CreativeOutcomeSummary,
  CreativeWorkflowExecution,
  CreativeWorkflowExecutionDetail,
  FeedbackBatch,
  FeedbackCluster,
  FeedbackClusterInput,
  FeedbackCommitInput,
  FeedbackDashboard,
  FeedbackPreview,
  FeedbackPreviewInput,
  GenerationCostObservationPage,
  GenerationRecord,
  GenerationRecordPatch,
  InsightsCursorQuery,
  InsightsPageQuery,
  InsightsTask,
  NovelRevisionConfiguration,
  NovelRevisionEffortPage,
  NovelRevisionEffortResult,
} from "./types.ts";
import { insightsLegacyRoutes, type InsightsLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `insights` Remote namespace. */
    insightsController: InsightsController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  insightsLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.insights` namespace. */
export class InsightsController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;
  private readonly measures = outcomeMeasures({
    outcomeSummary: (projectId) => this.run("outcomeSummary", projectId),
    outcomes: (projectId, query) => this.run("outcomes", projectId, query),
    executions: (projectId, query) => this.run("executions", projectId, query),
    execution: (projectId, workflowId, query) =>
      this.run("execution", projectId, workflowId, query),
    revisionEffort: (projectId, query) =>
      this.run("revisionEffort", projectId, query),
  });

  constructor(ctx: Context) {
    super(ctx, "insightsController", { namespace: "insights" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: InsightsLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = insightsLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Read a granted feedback file (metrics or comments, CSV or JSON) into a
   * preview that expires after 15 minutes.
   * @replaces feedback.preview
   * @param input - the project, the kind and the granted file.
   * @returns the preview with its first rows and warnings.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feedbackPreview(
    input: FeedbackPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<FeedbackPreview> {
    return this.run("feedbackPreview", input, ifMatch, idempotencyKey);
  }

  /**
   * Commit a preview as a feedback batch.
   * @replaces feedback.commit
   * @param id - the preview.
   * @param input - the project the preview must belong to.
   * @returns the committed batch.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feedbackCommit(
    id: string,
    input: FeedbackCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<FeedbackBatch> {
    return this.run("feedbackCommit", id, input, ifMatch, idempotencyKey);
  }

  /**
   * A project's feedback batches, latest metrics and comments, and clusters.
   * @replaces feedback.dashboard
   * @param id - the project.
   */
  @Remote
  feedbackDashboard(id: string): Promise<FeedbackDashboard> {
    return this.run("feedbackDashboard", id);
  }

  /**
   * Group a comment batch by category, replacing its earlier clusters.
   * @replaces feedback.cluster
   * @param input - the project and the comment batch.
   * @returns the clusters, largest first.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feedbackCluster(
    input: FeedbackClusterInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<FeedbackCluster[]> {
    return this.run("feedbackCluster", input, ifMatch, idempotencyKey);
  }

  /**
   * Record a completed revision-suggestion task for one feedback cluster.
   * @replaces feedback.createRevisionTask
   * @param id - the cluster.
   * @returns the task.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  feedbackRevisionTask(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InsightsTask> {
    return this.run("feedbackRevisionTask", id, ifMatch, idempotencyKey);
  }

  /**
   * A project's generation ledger, newest first.
   * @replaces generation.list
   * @param id - the project.
   */
  @Remote
  generationList(id: string): Promise<GenerationRecord[]> {
    return this.run("generationList", id);
  }

  /**
   * Record a ledger entry's actual cost, its currency or a cost note.
   * @replaces generation.update
   * @param id - the record.
   * @param input - the fields to change.
   * @returns the record after the change.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  generationUpdate(
    id: string,
    input: GenerationRecordPatch,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<GenerationRecord> {
    return this.run("generationUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * One ledger record's cost observations, newest first, a page at a time.
   * @replaces generation.costObservations
   * @param id - the record.
   * @param query - its project, and the page.
   */
  @Remote
  generationCostObservations(
    id: string,
    query: { projectId: string; cursor?: number; limit?: number },
  ): Promise<GenerationCostObservationPage> {
    return this.run("generationCostObservations", id, query);
  }

  /**
   * Continuation outcomes across every project.
   * @replaces creativeOutcomes.continuationSummary
   */
  @Remote
  continuationSummary(): Promise<CreativeContinuationGlobal> {
    return this.run("continuationSummary");
  }

  /**
   * A project's creative outcome summary.
   * @replaces creativeOutcomes.summary
   * @param projectId - the project.
   */
  @Remote
  outcomeSummary(projectId: string): Promise<CreativeOutcomeSummary> {
    return this.run("outcomeSummary", projectId);
  }

  /**
   * A project's creative outcomes, newest first, a page at a time.
   * @replaces creativeOutcomes.list
   * @param projectId - the project.
   * @param query - the page.
   */
  @Remote
  outcomes(
    projectId: string,
    query: InsightsPageQuery,
  ): Promise<CreativeOutcomePage> {
    return this.run("outcomes", projectId, query);
  }

  /**
   * A project's creative execution requests, a page at a time.
   * @replaces creativeOutcomes.executions
   * @param projectId - the project.
   * @param query - the page.
   */
  @Remote
  executions(
    projectId: string,
    query: InsightsPageQuery,
  ): Promise<CreativeExecutionRequestPage> {
    return this.run("executions", projectId, query);
  }

  /**
   * One workflow's executions, a page at a time.
   * @replaces creativeOutcomes.execution
   * @param projectId - the project.
   * @param workflowId - the workflow.
   * @param query - the page.
   */
  @Remote
  execution(
    projectId: string,
    workflowId: string,
    query: InsightsPageQuery,
  ): Promise<CreativeWorkflowExecution> {
    return this.run("execution", projectId, workflowId, query);
  }

  /**
   * A project's novel revision effort, a page at a time.
   * @replaces creativeOutcomes.revisionEffort
   * @param projectId - the project.
   * @param query - the page.
   */
  @Remote
  revisionEffort(
    projectId: string,
    query: InsightsPageQuery,
  ): Promise<NovelRevisionEffortPage> {
    return this.run("revisionEffort", projectId, query);
  }

  /**
   * Whether each adopted version of a project was later saved as the same
   * version, read over the whole outcome ledger.
   * @param projectId - the project.
   */
  @Remote
  deliveryCoverage(projectId: string): Promise<CreativeDeliveryCoverage> {
    return this.measures.deliveryCoverage(projectId);
  }

  /**
   * The fixed seven-day window over a project's delivery coverage, with the
   * time from adoption to the first save.
   * @param projectId - the project.
   */
  @Remote
  deliveryWindow(projectId: string): Promise<CreativeDeliveryWindow> {
    return this.measures.deliveryWindow(projectId);
  }

  /**
   * A project's requests grouped by each target's first configuration, read
   * over every request and workflow page.
   * @param projectId - the project.
   */
  @Remote
  configurationFunnel(projectId: string): Promise<CreativeConfigurationFunnel> {
    return this.measures.configurationFunnel(projectId);
  }

  /**
   * A project's chapter revisions before each first adoption, every page.
   * @param projectId - the project.
   */
  @Remote
  revisionEffortResult(projectId: string): Promise<NovelRevisionEffortResult> {
    return this.measures.revisionEffort(projectId);
  }

  /**
   * A project's chapter revisions grouped by each target's first
   * configuration.
   * @param projectId - the project.
   */
  @Remote
  revisionConfigurations(
    projectId: string,
  ): Promise<NovelRevisionConfiguration> {
    return this.measures.revisionConfigurations(projectId);
  }

  /**
   * A page of a project's recorded requests, each with its operation named.
   * @param projectId - the project.
   * @param query - the page.
   */
  @Remote
  executionList(
    projectId: string,
    query?: InsightsCursorQuery,
  ): Promise<CreativeExecutionRequestList> {
    return this.measures.executionList(projectId, query?.cursor);
  }

  /**
   * A page of one workflow's executions with its operation and run
   * statistics.
   * @param projectId - the project.
   * @param workflowId - the workflow.
   * @param query - the page.
   */
  @Remote
  executionDetail(
    projectId: string,
    workflowId: string,
    query?: InsightsCursorQuery,
  ): Promise<CreativeWorkflowExecutionDetail> {
    return this.measures.executionDetail(projectId, workflowId, query?.cursor);
  }
}

export default InsightsController;
