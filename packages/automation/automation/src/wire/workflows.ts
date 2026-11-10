/**
 * The shapes the workflow operations declare.
 *
 * @module @dramaip/automation-automation/wire/workflows
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `automation/workflowsRunEpisode` (`workflows.runEpisode`). */
export type WorkflowsRunEpisodeInput = {
  projectId: string;
  episodeId: string;
  kind:
    | "quality-check"
    | "compliance-check"
    | "delivery-preflight"
    | "render-preflight"
    | "animatic-draft"
    | "minimal-redo-plan"
    | "review-package";
};

/** Answer of `automation/workflowsRunEpisode` (`workflows.runEpisode`). */
export type WorkflowsRunEpisodeResult = {
  task: {
    id: string;
    kind: string;
    status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "canceled"
      | "interrupted";
    attentionStatus: "open" | "acknowledged";
    resultStatus: "none" | "pending" | "applied" | "discarded" | "conflicted";
    title: string;
    progress: number;
    projectId?: string;
    parentTaskId?: string;
    conversationId?: string;
    assistantTurnId?: string;
    stage?: string;
    result?: JsonValue;
    error?: string;
    createdAt: string;
    updatedAt: string;
  };
  recordId?: string;
  recordOwner?: string;
  summary: string;
};
