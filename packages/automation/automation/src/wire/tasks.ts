/**
 * The shapes the task operations declare.
 *
 * @module @dramaip/automation-automation/wire/tasks
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `automation/tasksCancel` (`tasks.cancel`). */
export type TasksCancelResult = {
  id: string;
  kind: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
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

/** Input of `automation/tasksCreate` (`tasks.create`). */
export type TasksCreateInput = {
  kind: string;
  title: string;
  projectId?: string;
  payload?: JsonValue;
};

/** Answer of `automation/tasksCreate` (`tasks.create`). */
export type TasksCreateResult = {
  id: string;
  kind: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
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

/** Answer of `automation/tasksList` (`tasks.list`). */
export type TasksListResult = {
  id: string;
  kind: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
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
}[];

/** Input of `automation/tasksRetry` (`tasks.retry`). */
export type TasksRetryInput = {
  engineKind: "pi";
};

/** Answer of `automation/tasksRetry` (`tasks.retry`). */
export type TasksRetryResult = {
  id: string;
  kind: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
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

/** Input of `automation/tasksSetAttention` (`tasks.setAttention`). */
export type TasksSetAttentionInput = {
  status: "open" | "acknowledged";
};

/** Answer of `automation/tasksSetAttention` (`tasks.setAttention`). */
export type TasksSetAttentionResult = {
  id: string;
  kind: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
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

/** Query of `automation/tasksWorklist` (`tasks.worklist`). */
export type TasksWorklistQuery = {
  projectId?: string;
  category?: "pending-result" | "running" | "attention" | "history";
  cursor?: string;
  limit?: number;
};

/** Answer of `automation/tasksWorklist` (`tasks.worklist`). */
export type TasksWorklistResult = {
  items: {
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
  }[];
  counts: {
    pendingResult: number;
    running: number;
    attention: number;
    history: number;
  };
  nextCursor?: string;
};
