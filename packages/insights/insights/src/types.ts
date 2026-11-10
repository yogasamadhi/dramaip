/**
 * Wire types of the `insights` Remote namespace: the shapes the replaced
 * `/api/v2` operations validate and answer, as the shared contracts declare
 * them.
 * @module @dramaip/insights-insights/types
 */
import type { z } from "zod";
import type { JsonValue } from "@dramaip/infra-values";
import type {
  FeedbackBatchSchema,
  FeedbackClusterInputSchema,
  FeedbackClusterSchema,
  FeedbackCommitInputSchema,
  FeedbackDashboardSchema,
  FeedbackMetricSchema,
  FeedbackPreviewInputSchema,
  FeedbackPreviewSchema,
  GenerationRecordPatchSchema,
} from "@dramaip/contracts/insights";
import type { Task } from "@dramaip/contracts/automation";
export type {
  AgentUsageNumber,
  AgentUsageObservationPage,
} from "@dramaip/contracts";
import type {} from "@dramaip/infra-operations/problem";

export type {
  CreativeConfigurationFunnel,
  CreativeContinuationGlobal,
  CreativeDeliveryCoverage,
  CreativeDeliveryWindow,
  CreativeExecutionStatistics,
  CreativeExecutionRequestPage,
  CreativeOutcomePage,
  CreativeOutcomeSummary,
  CreativeWorkflowExecution,
  GenerationCostObservationPage,
  GenerationRecord,
  NovelRevisionConfiguration,
  NovelRevisionEffortPage,
  NovelRevisionEffortResult,
} from "@dramaip/contracts/insights";
export type {
  CreativeExecutionRequestList,
  CreativeWorkflowExecutionDetail,
} from "./measures.ts";

/** Query of the paged reads whose cursor is a ledger position. */
export type InsightsCursorQuery = {
  /** Continue after this position; absent for the first page. */
  cursor?: number;
};

/** The completed revision-suggestion task; its result is parsed JSON. */
export type InsightsTask = Omit<Task, "result"> & { result?: JsonValue };

/** Input of `insights/feedbackPreview`. */
export type FeedbackPreviewInput = z.input<typeof FeedbackPreviewInputSchema>;
/** Answer of `insights/feedbackPreview`; the sample rows are parsed JSON. */
export type FeedbackPreview = Omit<
  z.infer<typeof FeedbackPreviewSchema>,
  "sample"
> & { sample: JsonValue[] };
/** Input of `insights/feedbackCommit`. */
export type FeedbackCommitInput = z.input<typeof FeedbackCommitInputSchema>;
/** A committed feedback batch. */
export type FeedbackBatch = z.infer<typeof FeedbackBatchSchema>;
/** One imported metric; its dimensions are parsed JSON. */
export type FeedbackMetric = Omit<
  z.infer<typeof FeedbackMetricSchema>,
  "dimensions"
> & { dimensions: JsonValue };
/** Answer of `insights/feedbackDashboard`. */
export type FeedbackDashboard = Omit<
  z.infer<typeof FeedbackDashboardSchema>,
  "metrics"
> & { metrics: FeedbackMetric[] };
/** Input of `insights/feedbackCluster`. */
export type FeedbackClusterInput = z.input<typeof FeedbackClusterInputSchema>;
/** One comment cluster. */
export type FeedbackCluster = z.infer<typeof FeedbackClusterSchema>;
/** Input of `insights/generationUpdate`. */
export type GenerationRecordPatch = z.input<typeof GenerationRecordPatchSchema>;

/** One page of a cursor-paged report. */
export type InsightsPageQuery = {
  /** Continue after this cursor; absent for the first page. */
  cursor?: string;
  /** Page size; the route's default when absent. */
  limit?: number;
};
