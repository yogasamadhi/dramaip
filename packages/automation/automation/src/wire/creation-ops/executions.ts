/**
 * The shapes the creation execution operation declares.
 *
 * @module @dramaip/automation-automation/wire/creation-ops/executions
 */
/** Query of `automation/creationExecution` (`creation.execution`). */
export type CreationExecutionQuery = {
  projectId: string;
};

/** Answer of `automation/creationExecution` (`creation.execution`). */
export type CreationExecutionResult = {
  format: "creation-execution-receipt-v1";
  workflowId: string;
  projectId: string;
  version: number;
  operation:
    | "author-intent"
    | "chapter"
    | "characters"
    | "book-outline"
    | "chapter-outline"
    | "story-arc"
    | "episode"
    | "adaptation-diagnosis"
    | "adaptation-strategy"
    | "quality-review"
    | "season-plan"
    | "episode-outline"
    | "episode-script"
    | "storyboard-package"
    | "script-revision"
    | "review-check"
    | "shot-prompt"
    | "delivery-copy"
    | "localization"
    | "creator-content"
    | "chapter-memory"
    | "knowledge-plan"
    | "narrative-summary";
  sourceWorkflowId?: string;
  runs: (
    | {
        state: "recorded";
        runId: string;
        phase: "generating" | "checking" | "revising" | "rechecking";
        execution: {
          format: "agent-run-execution-v1";
          runId: string;
          sessionId: string;
          projectId?: string;
          contextSnapshotId?: string;
          engineKind: "pi";
          taskType: string;
          status:
            | "created"
            | "queued"
            | "preparing"
            | "running"
            | "waiting_approval"
            | "committing"
            | "completed"
            | "interrupted"
            | "failed"
            | "aborted"
            | "canceled"
            | "orphaned"
            | "recoverable";
          model:
            | {
                status: "recorded";
                modelId: string;
                providerId?: string;
                profileId?: string;
              }
            | {
                status: "unrecorded";
              }
            | {
                status: "invalid";
              };
          timing:
            | {
                status: "measured";
                startedAt: string;
                completedAt: string;
                durationMs: number;
              }
            | {
                status: "in-progress";
                startedAt: string;
              }
            | {
                status: "unrecorded";
              }
            | {
                status: "invalid";
              };
          source: "persisted-agent-run";
        };
      }
    | {
        state: "missing";
        runId: string;
      }
  )[];
  coverage: "exact-workflow-attempt";
  billingStatus: "unknown";
};
