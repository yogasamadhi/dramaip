/**
 * Transitional (P4/P5, deleted in P6): the `/api/v2` operations the
 * `insights` namespace replaced and how each method's arguments travelled over
 * HTTP. Pure data, Client-safe: the controller builds its in-process calls
 * from it and the existing app's bridge maps the old requests onto the
 * methods.
 * @module @dramaip/insights-insights/legacy
 */
import type { LegacyRouteTable } from "@dramaip/infra-operations/legacy-routes";

const id = { from: "param", name: "id" } as const;
const projectId = { from: "param", name: "projectId" } as const;
const query = { from: "query", name: "query", numbers: ["limit"] } as const;
const body = { from: "body", name: "input" } as const;

/** The `insights` namespace's replaced operations. */
export const insightsLegacyRoutes = {
  namespace: "insights",
  routes: [
    {
      operationId: "feedback.preview",
      method: "POST",
      path: "/api/v2/feedback/preview",
      status: 201,
      remote: "feedbackPreview",
      args: [
        body,
        { from: "ifMatch", name: "ifMatch" },
        { from: "idempotencyKey", name: "idempotencyKey" },
      ],
    },
    {
      operationId: "feedback.commit",
      method: "POST",
      path: "/api/v2/feedback/{id}/commit",
      status: 201,
      remote: "feedbackCommit",
      args: [
        id,
        body,
        { from: "ifMatch", name: "ifMatch" },
        { from: "idempotencyKey", name: "idempotencyKey" },
      ],
    },
    {
      operationId: "feedback.dashboard",
      method: "GET",
      path: "/api/v2/projects/{id}/feedback",
      status: 200,
      remote: "feedbackDashboard",
      args: [id],
    },
    {
      operationId: "feedback.cluster",
      method: "POST",
      path: "/api/v2/feedback/clusters",
      status: 201,
      remote: "feedbackCluster",
      args: [
        body,
        { from: "ifMatch", name: "ifMatch" },
        { from: "idempotencyKey", name: "idempotencyKey" },
      ],
    },
    {
      operationId: "feedback.createRevisionTask",
      method: "POST",
      path: "/api/v2/feedback/clusters/{id}/revision-task",
      status: 201,
      remote: "feedbackRevisionTask",
      args: [
        id,
        { from: "ifMatch", name: "ifMatch" },
        { from: "idempotencyKey", name: "idempotencyKey" },
      ],
    },
    {
      operationId: "generation.list",
      method: "GET",
      path: "/api/v2/projects/{id}/generation-ledger",
      status: 200,
      remote: "generationList",
      args: [id],
    },
    {
      operationId: "generation.update",
      method: "PATCH",
      path: "/api/v2/generation-ledger/{id}",
      status: 200,
      remote: "generationUpdate",
      args: [
        id,
        body,
        { from: "ifMatch", name: "ifMatch" },
        { from: "idempotencyKey", name: "idempotencyKey" },
      ],
    },
    {
      operationId: "generation.costObservations",
      method: "GET",
      path: "/api/v2/generation-ledger/{id}/cost-observations",
      status: 200,
      remote: "generationCostObservations",
      args: [
        id,
        { from: "query", name: "query", numbers: ["cursor", "limit"] },
      ],
    },
    {
      operationId: "creativeOutcomes.continuationSummary",
      method: "GET",
      path: "/api/v2/creative-continuations/summary",
      status: 200,
      remote: "continuationSummary",
      args: [],
    },
    {
      operationId: "creativeOutcomes.summary",
      method: "GET",
      path: "/api/v2/projects/{projectId}/creative-outcomes/summary",
      status: 200,
      remote: "outcomeSummary",
      args: [projectId],
    },
    {
      operationId: "creativeOutcomes.list",
      method: "GET",
      path: "/api/v2/projects/{projectId}/creative-outcomes",
      status: 200,
      remote: "outcomes",
      args: [projectId, query],
    },
    {
      operationId: "creativeOutcomes.executions",
      method: "GET",
      path: "/api/v2/projects/{projectId}/creative-outcomes/executions",
      status: 200,
      remote: "executions",
      args: [projectId, query],
    },
    {
      operationId: "creativeOutcomes.execution",
      method: "GET",
      path: "/api/v2/projects/{projectId}/creative-outcomes/executions/{workflowId}",
      status: 200,
      remote: "execution",
      args: [projectId, { from: "param", name: "workflowId" }, query],
    },
    {
      operationId: "creativeOutcomes.revisionEffort",
      method: "GET",
      path: "/api/v2/projects/{projectId}/creative-outcomes/revision-effort",
      status: 200,
      remote: "revisionEffort",
      args: [projectId, query],
    },
  ],
} as const satisfies LegacyRouteTable;

/** A Remote method of the `insights` namespace. */
export type InsightsLegacyMethod =
  (typeof insightsLegacyRoutes.routes)[number]["remote"];
