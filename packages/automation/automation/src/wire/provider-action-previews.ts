/**
 * The shapes the provider action preview operations declare.
 *
 * @module @dramaip/automation-automation/wire/provider-action-previews
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `automation/providerActionPreviewsDiscard` (`provider-action-previews.discard`). */
export type ProviderActionPreviewsDiscardResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  kind: "image" | "audio" | "video" | "remote_render";
  providerId: string;
  modelId?: string;
  parameters: Record<string, JsonValue>;
  estimatedCost?: number;
  currency?: string;
  status: "pending" | "executed" | "discarded" | "expired";
  createdAt: string;
  executedAt?: string;
};

/** Answer of `automation/providerActionPreviewsExecute` (`provider-action-previews.execute`). */
export type ProviderActionPreviewsExecuteResult = {
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

/** Answer of `automation/providerActionPreviewsGet` (`provider-action-previews.get`). */
export type ProviderActionPreviewsGetResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  kind: "image" | "audio" | "video" | "remote_render";
  providerId: string;
  modelId?: string;
  parameters: Record<string, JsonValue>;
  estimatedCost?: number;
  currency?: string;
  status: "pending" | "executed" | "discarded" | "expired";
  createdAt: string;
  executedAt?: string;
};

/** Query of `automation/providerActionPreviewsSummaries` (`provider-action-previews.summaries`). */
export type ProviderActionPreviewsSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `automation/providerActionPreviewsSummaries` (`provider-action-previews.summaries`). */
export type ProviderActionPreviewsSummariesResult = {
  projectId: string;
  items: {
    id: string;
    projectId: string;
    sessionId?: string;
    runId?: string;
    taskId?: string;
    kind: "image" | "audio" | "video" | "remote_render";
    providerId: string;
    modelId?: string;
    estimatedCost?: number;
    currency?: string;
    status: "pending" | "executed" | "discarded" | "expired";
    createdAt: string;
    executedAt?: string;
  }[];
  nextCursor?: string;
};
