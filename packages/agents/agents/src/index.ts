/**
 * Host face of the agents domain. It owns the `agents` Remote namespace:
 * agent runs, sessions, tasks, engines and settings, context previews, experiments, the assistant conversations and the inspiration space. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * agents plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/agents-agents
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import { readPiProviderCatalog } from "@dramaip/agent-host-adapters/pi-provider-runtime";
import type {
  ContextCreatePreviewInput,
  ContextCreatePreviewResult,
  ContextFreezePreviewInput,
  ContextFreezePreviewResult,
  ContextGetPoliciesResult,
  ContextGetPreviewResult,
  ContextGetRunSnapshotResult,
  ContextUpdatePoliciesInput,
  ContextUpdatePoliciesResult,
  ContextUpdatePreviewInput,
  ContextUpdatePreviewResult,
  EnginesGetGlobalSettingsResult,
  EnginesGetProjectSettingsResult,
  EnginesListResult,
  EnginesListTasksResult,
  EnginesUpdateGlobalSettingsInput,
  EnginesUpdateGlobalSettingsResult,
  EnginesUpdateProjectSettingsInput,
  EnginesUpdateProjectSettingsResult,
  ExperimentsCreateInput,
  ExperimentsGetResult,
  ExperimentsRevealInput,
  ExperimentsRevealResult,
  ExperimentsReviewInput,
  ExperimentsReviewResult,
  SessionsAbortInput,
  SessionsAbortResult,
  SessionsCreateInput,
  SessionsCreateResult,
  SessionsForkInput,
  SessionsForkResult,
  SessionsGetResult,
  SessionsGetRunResult,
  SessionsInterruptInput,
  SessionsInterruptResult,
  SessionsListItemsResult,
  SessionsResumeInput,
  SessionsResumeResult,
  SessionsRunInput,
  SessionsRunResult,
  SessionsSteerInput,
  SessionsSubscribeEvent,
  AgentUsageObservationsListQuery,
  AgentUsageObservationsListResult,
  AssistantConversationsBindProjectInput,
  AssistantConversationsBindProjectResult,
  AssistantConversationsCreateInput,
  AssistantConversationsCreateResult,
  AssistantConversationsGetResult,
  AssistantConversationsListQuery,
  AssistantConversationsListResult,
  AssistantConversationsSendMessageInput,
  AssistantConversationsSendMessageResult,
  AssistantConversationsUpdateInput,
  AssistantConversationsUpdateResult,
  AssistantWebResearchSettingsGetResult,
  AssistantWebResearchSettingsUpdateInput,
  AssistantWebResearchSettingsUpdateResult,
  InspirationCardsCreateInput,
  InspirationCardsCreateResult,
  InspirationCardsListQuery,
  InspirationCardsListResult,
  InspirationCardsUpdateInput,
  InspirationCardsUpdateResult,
  InspirationMemoriesClearInput,
  InspirationMemoriesListResult,
  InspirationMemoriesRebuildInput,
  InspirationMemoriesRebuildResult,
  InspirationMemoriesUpdateInput,
  InspirationMemoriesUpdateResult,
  InspirationMemoryJobsListQuery,
  InspirationMemoryJobsListResult,
  InspirationMemorySettingsGetResult,
  InspirationMemorySettingsUpdateInput,
  InspirationMemorySettingsUpdateResult,
  InspirationProjectPreviewsCommitInput,
  InspirationProjectPreviewsCommitResult,
  InspirationProjectPreviewsCreateInput,
  InspirationProjectPreviewsCreateResult,
  InspirationProjectPreviewsGetResult,
  ProvidersActivateForAgentInput,
  ProvidersActivateForAgentResult,
  ProvidersCatalogResult,
  ProvidersCreateInput,
  ProvidersCreateResult,
  ProvidersGetResult,
  ProvidersListQuery,
  ProvidersListResult,
  ProvidersTestConnectionInput,
  ProvidersTestConnectionResult,
  ProvidersUpdateInput,
  ProvidersUpdateResult,
} from "./types.ts";
import { agentsLegacyRoutes, type AgentsLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `agents` Remote namespace. */
    agentsController: AgentsController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  agentsLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.agents` namespace. */
export class AgentsController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "agentsController", { namespace: "agents" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: AgentsLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = agentsLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /** Read the events of the streaming operation behind `method`. */
  private stream<T>(
    method: AgentsLegacyMethod,
    signal: AbortSignal,
    ...args: readonly unknown[]
  ): AsyncIterable<T> {
    const route = agentsLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.stream(
      route.operationId,
      compatCallOf(route, args),
      signal,
    ) as AsyncIterable<T>;
  }

  /**
   * Runs `POST /api/v2/agent-context-previews`.
   * @replaces agent-context.createPreview
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  contextCreatePreview(
    input?: ContextCreatePreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ContextCreatePreviewResult> {
    return this.run("contextCreatePreview", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-context-previews/{id}/snapshots`.
   * @replaces agent-context.freezePreview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  contextFreezePreview(
    id: string,
    input?: ContextFreezePreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ContextFreezePreviewResult> {
    return this.run("contextFreezePreview", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/agent-context-policies`.
   * @replaces agent-context.getPolicies
   * @param id - the `id` path parameter.
   */
  @Remote
  contextGetPolicies(id: string): Promise<ContextGetPoliciesResult> {
    return this.run("contextGetPolicies", id);
  }

  /**
   * Runs `GET /api/v2/agent-context-previews/{id}`.
   * @replaces agent-context.getPreview
   * @param id - the `id` path parameter.
   */
  @Remote
  contextGetPreview(id: string): Promise<ContextGetPreviewResult> {
    return this.run("contextGetPreview", id);
  }

  /**
   * Runs `GET /api/v2/agent-runs/{id}/context-snapshot`.
   * @replaces agent-context.getRunSnapshot
   * @param id - the `id` path parameter.
   */
  @Remote
  contextGetRunSnapshot(id: string): Promise<ContextGetRunSnapshotResult> {
    return this.run("contextGetRunSnapshot", id);
  }

  /**
   * Runs `PUT /api/v2/projects/{id}/agent-context-policies`.
   * @replaces agent-context.updatePolicies
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  contextUpdatePolicies(
    id: string,
    input?: ContextUpdatePoliciesInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ContextUpdatePoliciesResult> {
    return this.run(
      "contextUpdatePolicies",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PATCH /api/v2/agent-context-previews/{id}`.
   * @replaces agent-context.updatePreview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  contextUpdatePreview(
    id: string,
    input?: ContextUpdatePreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ContextUpdatePreviewResult> {
    return this.run("contextUpdatePreview", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/agent-settings`.
   * @replaces agent-engines.getGlobalSettings
   */
  @Remote
  enginesGetGlobalSettings(): Promise<EnginesGetGlobalSettingsResult> {
    return this.run("enginesGetGlobalSettings");
  }

  /**
   * Runs `GET /api/v2/projects/{id}/agent-settings`.
   * @replaces agent-engines.getProjectSettings
   * @param id - the `id` path parameter.
   */
  @Remote
  enginesGetProjectSettings(
    id: string,
  ): Promise<EnginesGetProjectSettingsResult> {
    return this.run("enginesGetProjectSettings", id);
  }

  /**
   * Runs `GET /api/v2/agent-engines`.
   * @replaces agent-engines.list
   */
  @Remote
  enginesList(): Promise<EnginesListResult> {
    return this.run("enginesList");
  }

  /**
   * Runs `GET /api/v2/agent-tasks`.
   * @replaces agent-engines.listTasks
   */
  @Remote
  enginesListTasks(): Promise<EnginesListTasksResult> {
    return this.run("enginesListTasks");
  }

  /**
   * Runs `PUT /api/v2/agent-settings`.
   * @replaces agent-engines.updateGlobalSettings
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  enginesUpdateGlobalSettings(
    input?: EnginesUpdateGlobalSettingsInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EnginesUpdateGlobalSettingsResult> {
    return this.run(
      "enginesUpdateGlobalSettings",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PUT /api/v2/projects/{id}/agent-settings`.
   * @replaces agent-engines.updateProjectSettings
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  enginesUpdateProjectSettings(
    id: string,
    input?: EnginesUpdateProjectSettingsInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EnginesUpdateProjectSettingsResult> {
    return this.run(
      "enginesUpdateProjectSettings",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/agent-experiments`.
   * @replaces agent-experiments.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  experimentsCreate(
    input?: ExperimentsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("experimentsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/agent-experiments/{id}`.
   * @replaces agent-experiments.get
   * @param id - the `id` path parameter.
   */
  @Remote
  experimentsGet(id: string): Promise<ExperimentsGetResult> {
    return this.run("experimentsGet", id);
  }

  /**
   * Runs `POST /api/v2/agent-experiments/{id}/reveal`.
   * @replaces agent-experiments.reveal
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  experimentsReveal(
    id: string,
    input?: ExperimentsRevealInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ExperimentsRevealResult> {
    return this.run("experimentsReveal", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-experiments/{id}/review`.
   * @replaces agent-experiments.review
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  experimentsReview(
    id: string,
    input?: ExperimentsReviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ExperimentsReviewResult> {
    return this.run("experimentsReview", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-sessions/{id}/abort`.
   * @replaces agent-sessions.abort
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsAbort(
    id: string,
    input?: SessionsAbortInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SessionsAbortResult> {
    return this.run("sessionsAbort", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-sessions`.
   * @replaces agent-sessions.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsCreate(
    input?: SessionsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SessionsCreateResult> {
    return this.run("sessionsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `DELETE /api/v2/agent-sessions/{id}`.
   * @replaces agent-sessions.dispose
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsDispose(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("sessionsDispose", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-sessions/{id}/fork`.
   * @replaces agent-sessions.fork
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsFork(
    id: string,
    input?: SessionsForkInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SessionsForkResult> {
    return this.run("sessionsFork", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/agent-sessions/{id}`.
   * @replaces agent-sessions.get
   * @param id - the `id` path parameter.
   */
  @Remote
  sessionsGet(id: string): Promise<SessionsGetResult> {
    return this.run("sessionsGet", id);
  }

  /**
   * Runs `GET /api/v2/agent-runs/{id}`.
   * @replaces agent-sessions.getRun
   * @param id - the `id` path parameter.
   */
  @Remote
  sessionsGetRun(id: string): Promise<SessionsGetRunResult> {
    return this.run("sessionsGetRun", id);
  }

  /**
   * Runs `POST /api/v2/agent-runs/{id}/interrupt`.
   * @replaces agent-sessions.interrupt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsInterrupt(
    id: string,
    input?: SessionsInterruptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SessionsInterruptResult> {
    return this.run("sessionsInterrupt", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/agent-runs/{id}/items`.
   * @replaces agent-sessions.listItems
   * @param id - the `id` path parameter.
   */
  @Remote
  sessionsListItems(id: string): Promise<SessionsListItemsResult> {
    return this.run("sessionsListItems", id);
  }

  /**
   * Runs `POST /api/v2/agent-runs/{id}/resume`.
   * @replaces agent-sessions.resume
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsResume(
    id: string,
    input?: SessionsResumeInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SessionsResumeResult> {
    return this.run("sessionsResume", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-sessions/{id}/runs`.
   * @replaces agent-sessions.run
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsRun(
    id: string,
    input?: SessionsRunInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SessionsRunResult> {
    return this.run("sessionsRun", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/agent-runs/{id}/steer`.
   * @replaces agent-sessions.steer
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sessionsSteer(
    id: string,
    input?: SessionsSteerInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("sessionsSteer", id, input, ifMatch, idempotencyKey);
  }

  /**
   * The events the handler of `GET /api/v2/agent-runs/{id}/events` writes, replayed after
   * `cursor` and then live, until the caller cancels.
   * @replaces agent-sessions.subscribe
   * @param id - the `id` path parameter.
   * @param cursor - the last event cursor seen (the original `Last-Event-ID`); 0 for the whole log.
   * @param signal - stream cancellation.
   */
  @Remote({ mode: "stream" })
  async *sessionsSubscribe(
    id: string,
    cursor: number,
    signal: AbortSignal,
  ): AsyncIterable<SessionsSubscribeEvent> {
    yield* this.stream<SessionsSubscribeEvent>(
      "sessionsSubscribe",
      signal,
      id,
      cursor,
    );
  }

  /**
   * Sanitized engine observations, never billing or certified totals. Runs `GET /api/v2/agent-runs/{runId}/usage-observations`.
   * @replaces agentUsageObservations.list
   * @param runId - the `runId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  agentUsageObservationsList(
    runId: string,
    query?: AgentUsageObservationsListQuery,
  ): Promise<AgentUsageObservationsListResult> {
    return this.run("agentUsageObservationsList", runId, query);
  }

  /**
   * Runs `POST /api/v2/assistant-conversations/{id}/bind-project`.
   * @replaces assistant-conversations.bindProject
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assistantConversationsBindProject(
    id: string,
    input?: AssistantConversationsBindProjectInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssistantConversationsBindProjectResult> {
    return this.run(
      "assistantConversationsBindProject",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/assistant-conversations`.
   * @replaces assistant-conversations.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assistantConversationsCreate(
    input?: AssistantConversationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssistantConversationsCreateResult> {
    return this.run(
      "assistantConversationsCreate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/assistant-conversations/{id}`.
   * @replaces assistant-conversations.get
   * @param id - the `id` path parameter.
   */
  @Remote
  assistantConversationsGet(
    id: string,
  ): Promise<AssistantConversationsGetResult> {
    return this.run("assistantConversationsGet", id);
  }

  /**
   * Runs `GET /api/v2/assistant-conversations`.
   * @replaces assistant-conversations.list
   * @param query - the query parameters.
   */
  @Remote
  assistantConversationsList(
    query?: AssistantConversationsListQuery,
  ): Promise<AssistantConversationsListResult> {
    return this.run("assistantConversationsList", query);
  }

  /**
   * Runs `DELETE /api/v2/assistant-conversations/{id}`.
   * @replaces assistant-conversations.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assistantConversationsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run(
      "assistantConversationsRemove",
      id,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/assistant-conversations/{id}/messages`.
   * @replaces assistant-conversations.sendMessage
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assistantConversationsSendMessage(
    id: string,
    input?: AssistantConversationsSendMessageInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssistantConversationsSendMessageResult> {
    return this.run(
      "assistantConversationsSendMessage",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PATCH /api/v2/assistant-conversations/{id}`.
   * @replaces assistant-conversations.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assistantConversationsUpdate(
    id: string,
    input?: AssistantConversationsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssistantConversationsUpdateResult> {
    return this.run(
      "assistantConversationsUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/assistant-web-research-settings`.
   * @replaces assistant-web-research-settings.get
   */
  @Remote
  assistantWebResearchSettingsGet(): Promise<AssistantWebResearchSettingsGetResult> {
    return this.run("assistantWebResearchSettingsGet");
  }

  /**
   * Runs `PUT /api/v2/assistant-web-research-settings`.
   * @replaces assistant-web-research-settings.update
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assistantWebResearchSettingsUpdate(
    input?: AssistantWebResearchSettingsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssistantWebResearchSettingsUpdateResult> {
    return this.run(
      "assistantWebResearchSettingsUpdate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/inspiration-cards`.
   * @replaces inspiration-cards.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationCardsCreate(
    input?: InspirationCardsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationCardsCreateResult> {
    return this.run("inspirationCardsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/inspiration-cards`.
   * @replaces inspiration-cards.list
   * @param query - the query parameters.
   */
  @Remote
  inspirationCardsList(
    query?: InspirationCardsListQuery,
  ): Promise<InspirationCardsListResult> {
    return this.run("inspirationCardsList", query);
  }

  /**
   * Runs `DELETE /api/v2/inspiration-cards/{id}`.
   * @replaces inspiration-cards.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationCardsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("inspirationCardsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/inspiration-cards/{id}`.
   * @replaces inspiration-cards.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationCardsUpdate(
    id: string,
    input?: InspirationCardsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationCardsUpdateResult> {
    return this.run(
      "inspirationCardsUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/inspiration-memories/clear`.
   * @replaces inspiration-memories.clear
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationMemoriesClear(
    input?: InspirationMemoriesClearInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("inspirationMemoriesClear", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/inspiration-memories`.
   * @replaces inspiration-memories.list
   */
  @Remote
  inspirationMemoriesList(): Promise<InspirationMemoriesListResult> {
    return this.run("inspirationMemoriesList");
  }

  /**
   * Runs `POST /api/v2/inspiration-memories/rebuild`.
   * @replaces inspiration-memories.rebuild
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationMemoriesRebuild(
    input?: InspirationMemoriesRebuildInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationMemoriesRebuildResult> {
    return this.run(
      "inspirationMemoriesRebuild",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `DELETE /api/v2/inspiration-memories/{id}`.
   * @replaces inspiration-memories.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationMemoriesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("inspirationMemoriesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/inspiration-memories/{id}`.
   * @replaces inspiration-memories.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationMemoriesUpdate(
    id: string,
    input?: InspirationMemoriesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationMemoriesUpdateResult> {
    return this.run(
      "inspirationMemoriesUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/inspiration-memory-jobs`.
   * @replaces inspiration-memory-jobs.list
   * @param query - the query parameters.
   */
  @Remote
  inspirationMemoryJobsList(
    query?: InspirationMemoryJobsListQuery,
  ): Promise<InspirationMemoryJobsListResult> {
    return this.run("inspirationMemoryJobsList", query);
  }

  /**
   * Runs `GET /api/v2/inspiration-memory-settings`.
   * @replaces inspiration-memory-settings.get
   */
  @Remote
  inspirationMemorySettingsGet(): Promise<InspirationMemorySettingsGetResult> {
    return this.run("inspirationMemorySettingsGet");
  }

  /**
   * Runs `PUT /api/v2/inspiration-memory-settings`.
   * @replaces inspiration-memory-settings.update
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationMemorySettingsUpdate(
    input?: InspirationMemorySettingsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationMemorySettingsUpdateResult> {
    return this.run(
      "inspirationMemorySettingsUpdate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/inspiration-project-previews/{id}/commit`.
   * @replaces inspiration-project-previews.commit
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationProjectPreviewsCommit(
    id: string,
    input?: InspirationProjectPreviewsCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationProjectPreviewsCommitResult> {
    return this.run(
      "inspirationProjectPreviewsCommit",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/inspiration-project-previews`.
   * @replaces inspiration-project-previews.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationProjectPreviewsCreate(
    input?: InspirationProjectPreviewsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationProjectPreviewsCreateResult> {
    return this.run(
      "inspirationProjectPreviewsCreate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/inspiration-project-previews/{id}`.
   * @replaces inspiration-project-previews.get
   * @param id - the `id` path parameter.
   */
  @Remote
  inspirationProjectPreviewsGet(
    id: string,
  ): Promise<InspirationProjectPreviewsGetResult> {
    return this.run("inspirationProjectPreviewsGet", id);
  }

  /**
   * Runs `POST /api/v2/providers/{id}/activate-for-agent`.
   * @replaces providers.activateForAgent
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providersActivateForAgent(
    id: string,
    input?: ProvidersActivateForAgentInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProvidersActivateForAgentResult> {
    return this.run(
      "providersActivateForAgent",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Read the service providers and models from the prepared Pi 1.5 module.
   * Pi owns model metadata and defaults; the Client keeps no catalog copy.
   */
  @Remote
  async providersCatalog(): Promise<ProvidersCatalogResult> {
    const catalog = await readPiProviderCatalog(
      process.env.DRAMAIP_PI_RUNTIME_MODULE ?? "",
    );
    const keyPages: Record<string, string> = {
      openai: "https://platform.openai.com/api-keys",
      anthropic: "https://console.anthropic.com/settings/keys",
      google: "https://aistudio.google.com/app/apikey",
      deepseek: "https://platform.deepseek.com/api_keys",
      moonshotai: "https://platform.moonshot.ai/console/api-keys",
      "moonshotai-cn": "https://platform.moonshot.cn/console/api-keys",
      minimax:
        "https://platform.minimax.io/user-center/basic-information/interface-key",
      "minimax-cn":
        "https://platform.minimaxi.com/user-center/basic-information/interface-key",
      mistral: "https://console.mistral.ai/api-keys",
      xai: "https://console.x.ai/",
      openrouter: "https://openrouter.ai/settings/keys",
    };
    return {
      ...catalog,
      providers: catalog.providers.map((provider) => ({
        ...provider,
        ...(keyPages[provider.id] ? { apiKeyUrl: keyPages[provider.id]! } : {}),
      })),
    };
  }

  /**
   * Runs `POST /api/v2/providers`.
   * @replaces providers.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providersCreate(
    input?: ProvidersCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProvidersCreateResult> {
    return this.run("providersCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `DELETE /api/v2/providers/{id}`.
   * @replaces providers.delete
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providersDelete(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("providersDelete", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/providers/{id}`.
   * @replaces providers.get
   * @param id - the `id` path parameter.
   */
  @Remote
  providersGet(id: string): Promise<ProvidersGetResult> {
    return this.run("providersGet", id);
  }

  /**
   * Runs `GET /api/v2/providers`.
   * @replaces providers.list
   * @param query - the query parameters.
   */
  @Remote
  providersList(query?: ProvidersListQuery): Promise<ProvidersListResult> {
    return this.run("providersList", query);
  }

  /**
   * Runs `POST /api/v2/providers/{id}/test-connection`.
   * @replaces providers.testConnection
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providersTestConnection(
    id: string,
    input?: ProvidersTestConnectionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProvidersTestConnectionResult> {
    return this.run(
      "providersTestConnection",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PATCH /api/v2/providers/{id}`.
   * @replaces providers.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providersUpdate(
    id: string,
    input?: ProvidersUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProvidersUpdateResult> {
    return this.run("providersUpdate", id, input, ifMatch, idempotencyKey);
  }
}

export default AgentsController;
