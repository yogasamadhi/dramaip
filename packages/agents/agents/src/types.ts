/**
 * Wire types of the `agents` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/agents-agents/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `agents/contextCreatePreview` (`agent-context.createPreview`). */
export type ContextCreatePreviewInput = JsonValue;

/** Answer of `agents/contextCreatePreview` (`agent-context.createPreview`). */
export type ContextCreatePreviewResult = JsonValue;

/** Input of `agents/contextFreezePreview` (`agent-context.freezePreview`). */
export type ContextFreezePreviewInput = JsonValue;

/** Answer of `agents/contextFreezePreview` (`agent-context.freezePreview`). */
export type ContextFreezePreviewResult = JsonValue;

/** Answer of `agents/contextGetPolicies` (`agent-context.getPolicies`). */
export type ContextGetPoliciesResult = JsonValue;

/** Answer of `agents/contextGetPreview` (`agent-context.getPreview`). */
export type ContextGetPreviewResult = JsonValue;

/** Answer of `agents/contextGetRunSnapshot` (`agent-context.getRunSnapshot`). */
export type ContextGetRunSnapshotResult = JsonValue;

/** Input of `agents/contextUpdatePolicies` (`agent-context.updatePolicies`). */
export type ContextUpdatePoliciesInput = JsonValue;

/** Answer of `agents/contextUpdatePolicies` (`agent-context.updatePolicies`). */
export type ContextUpdatePoliciesResult = JsonValue;

/** Input of `agents/contextUpdatePreview` (`agent-context.updatePreview`). */
export type ContextUpdatePreviewInput = JsonValue;

/** Answer of `agents/contextUpdatePreview` (`agent-context.updatePreview`). */
export type ContextUpdatePreviewResult = JsonValue;

/** Answer of `agents/enginesGetGlobalSettings` (`agent-engines.getGlobalSettings`). */
export type EnginesGetGlobalSettingsResult = JsonValue;

/** Answer of `agents/enginesGetProjectSettings` (`agent-engines.getProjectSettings`). */
export type EnginesGetProjectSettingsResult = JsonValue;

/** Answer of `agents/enginesList` (`agent-engines.list`). */
export type EnginesListResult = JsonValue;

/** Answer of `agents/enginesListTasks` (`agent-engines.listTasks`). */
export type EnginesListTasksResult = JsonValue;

/** Input of `agents/enginesUpdateGlobalSettings` (`agent-engines.updateGlobalSettings`). */
export type EnginesUpdateGlobalSettingsInput = JsonValue;

/** Answer of `agents/enginesUpdateGlobalSettings` (`agent-engines.updateGlobalSettings`). */
export type EnginesUpdateGlobalSettingsResult = JsonValue;

/** Input of `agents/enginesUpdateProjectSettings` (`agent-engines.updateProjectSettings`). */
export type EnginesUpdateProjectSettingsInput = JsonValue;

/** Answer of `agents/enginesUpdateProjectSettings` (`agent-engines.updateProjectSettings`). */
export type EnginesUpdateProjectSettingsResult = JsonValue;

/** Input of `agents/experimentsCreate` (`agent-experiments.create`). */
export type ExperimentsCreateInput = JsonValue;

/** Answer of `agents/experimentsGet` (`agent-experiments.get`). */
export type ExperimentsGetResult = JsonValue;

/** Input of `agents/experimentsReveal` (`agent-experiments.reveal`). */
export type ExperimentsRevealInput = JsonValue;

/** Answer of `agents/experimentsReveal` (`agent-experiments.reveal`). */
export type ExperimentsRevealResult = JsonValue;

/** Input of `agents/experimentsReview` (`agent-experiments.review`). */
export type ExperimentsReviewInput = JsonValue;

/** Answer of `agents/experimentsReview` (`agent-experiments.review`). */
export type ExperimentsReviewResult = JsonValue;

/** Input of `agents/sessionsAbort` (`agent-sessions.abort`). */
export type SessionsAbortInput = JsonValue;

/** Answer of `agents/sessionsAbort` (`agent-sessions.abort`). */
export type SessionsAbortResult = JsonValue;

/** Input of `agents/sessionsCreate` (`agent-sessions.create`). */
export type SessionsCreateInput = JsonValue;

/** Answer of `agents/sessionsCreate` (`agent-sessions.create`). */
export type SessionsCreateResult = JsonValue;

/** Input of `agents/sessionsFork` (`agent-sessions.fork`). */
export type SessionsForkInput = JsonValue;

/** Answer of `agents/sessionsFork` (`agent-sessions.fork`). */
export type SessionsForkResult = JsonValue;

/** Answer of `agents/sessionsGet` (`agent-sessions.get`). */
export type SessionsGetResult = JsonValue;

/** Answer of `agents/sessionsGetRun` (`agent-sessions.getRun`). */
export type SessionsGetRunResult = JsonValue;

/** Input of `agents/sessionsInterrupt` (`agent-sessions.interrupt`). */
export type SessionsInterruptInput = JsonValue;

/** Answer of `agents/sessionsInterrupt` (`agent-sessions.interrupt`). */
export type SessionsInterruptResult = JsonValue;

/** Answer of `agents/sessionsListItems` (`agent-sessions.listItems`). */
export type SessionsListItemsResult = JsonValue;

/** Input of `agents/sessionsResume` (`agent-sessions.resume`). */
export type SessionsResumeInput = JsonValue;

/** Answer of `agents/sessionsResume` (`agent-sessions.resume`). */
export type SessionsResumeResult = JsonValue;

/** Input of `agents/sessionsRun` (`agent-sessions.run`). */
export type SessionsRunInput = JsonValue;

/** Answer of `agents/sessionsRun` (`agent-sessions.run`). */
export type SessionsRunResult = JsonValue;

/** Input of `agents/sessionsSteer` (`agent-sessions.steer`). */
export type SessionsSteerInput = JsonValue;

/** One event of `agents/sessionsSubscribe` (`agent-sessions.subscribe`), as its handler wrote it. */
export type SessionsSubscribeEvent = {
  event: string;
  id?: string;
  data: JsonValue;
};

/** Query of `agents/agentUsageObservationsList` (`agentUsageObservations.list`). */
export type AgentUsageObservationsListQuery = {
  projectId?: string;
  cursor?: number;
  limit?: number;
};

/** Answer of `agents/agentUsageObservationsList` (`agentUsageObservations.list`). */
export type AgentUsageObservationsListResult = {
  format: "agent-usage-observation-page-v1";
  runId: string;
  projectId?: string;
  observationCount: number;
  coverage: "partial-or-unknown";
  billingStatus: "unknown";
  items: {
    format: "agent-usage-observation-v1";
    runId: string;
    sessionId: string;
    projectId?: string;
    engineKind: "pi";
    cursor: number;
    measurementScope:
      "response-increment" | "run-total" | "session-total" | "unspecified";
    inputAccounting: "includes-cache" | "excludes-cache" | "unspecified";
    inputTokens:
      | {
          status: "reported";
          value: number;
        }
      | {
          status: "unreported";
        }
      | {
          status: "invalid";
        };
    outputTokens:
      | {
          status: "reported";
          value: number;
        }
      | {
          status: "unreported";
        }
      | {
          status: "invalid";
        };
    cachedTokens:
      | {
          status: "reported";
          value: number;
        }
      | {
          status: "unreported";
        }
      | {
          status: "invalid";
        };
    costEstimate?: {
      source: "engine-reported-estimate";
      amount:
        | {
            status: "reported";
            value: number;
          }
        | {
            status: "unreported";
          }
        | {
            status: "invalid";
          };
      currency:
        | {
            status: "reported";
            value: string;
          }
        | {
            status: "unreported";
          }
        | {
            status: "invalid";
          };
      billingStatus: "unknown";
    };
    source: "engine-reported";
    runClassification: "unknown";
    billingStatus: "unknown";
    recordedAt: string;
  }[];
  nextCursor?: number;
};

/** Input of `agents/assistantConversationsBindProject` (`assistant-conversations.bindProject`). */
export type AssistantConversationsBindProjectInput = JsonValue;

/** Answer of `agents/assistantConversationsBindProject` (`assistant-conversations.bindProject`). */
export type AssistantConversationsBindProjectResult = JsonValue;

/** Input of `agents/assistantConversationsCreate` (`assistant-conversations.create`). */
export type AssistantConversationsCreateInput = JsonValue;

/** Answer of `agents/assistantConversationsCreate` (`assistant-conversations.create`). */
export type AssistantConversationsCreateResult = JsonValue;

/** Answer of `agents/assistantConversationsGet` (`assistant-conversations.get`). */
export type AssistantConversationsGetResult = JsonValue;

/** Query of `agents/assistantConversationsList` (`assistant-conversations.list`). */
export type AssistantConversationsListQuery = {
  surface?: string;
  projectId?: string;
  archived?: string;
};

/** Answer of `agents/assistantConversationsList` (`assistant-conversations.list`). */
export type AssistantConversationsListResult = JsonValue;

/** Input of `agents/assistantConversationsSendMessage` (`assistant-conversations.sendMessage`). */
export type AssistantConversationsSendMessageInput = JsonValue;

/** Answer of `agents/assistantConversationsSendMessage` (`assistant-conversations.sendMessage`). */
export type AssistantConversationsSendMessageResult = JsonValue;

/** Input of `agents/assistantConversationsUpdate` (`assistant-conversations.update`). */
export type AssistantConversationsUpdateInput = JsonValue;

/** Answer of `agents/assistantConversationsUpdate` (`assistant-conversations.update`). */
export type AssistantConversationsUpdateResult = JsonValue;

/** Answer of `agents/assistantWebResearchSettingsGet` (`assistant-web-research-settings.get`). */
export type AssistantWebResearchSettingsGetResult = JsonValue;

/** Input of `agents/assistantWebResearchSettingsUpdate` (`assistant-web-research-settings.update`). */
export type AssistantWebResearchSettingsUpdateInput = JsonValue;

/** Answer of `agents/assistantWebResearchSettingsUpdate` (`assistant-web-research-settings.update`). */
export type AssistantWebResearchSettingsUpdateResult = JsonValue;

/** Input of `agents/inspirationCardsCreate` (`inspiration-cards.create`). */
export type InspirationCardsCreateInput = JsonValue;

/** Answer of `agents/inspirationCardsCreate` (`inspiration-cards.create`). */
export type InspirationCardsCreateResult = JsonValue;

/** Query of `agents/inspirationCardsList` (`inspiration-cards.list`). */
export type InspirationCardsListQuery = {
  conversationId?: string;
};

/** Answer of `agents/inspirationCardsList` (`inspiration-cards.list`). */
export type InspirationCardsListResult = JsonValue;

/** Input of `agents/inspirationCardsUpdate` (`inspiration-cards.update`). */
export type InspirationCardsUpdateInput = JsonValue;

/** Answer of `agents/inspirationCardsUpdate` (`inspiration-cards.update`). */
export type InspirationCardsUpdateResult = JsonValue;

/** Input of `agents/inspirationMemoriesClear` (`inspiration-memories.clear`). */
export type InspirationMemoriesClearInput = JsonValue;

/** Answer of `agents/inspirationMemoriesList` (`inspiration-memories.list`). */
export type InspirationMemoriesListResult = JsonValue;

/** Input of `agents/inspirationMemoriesRebuild` (`inspiration-memories.rebuild`). */
export type InspirationMemoriesRebuildInput = JsonValue;

/** Answer of `agents/inspirationMemoriesRebuild` (`inspiration-memories.rebuild`). */
export type InspirationMemoriesRebuildResult = JsonValue;

/** Input of `agents/inspirationMemoriesUpdate` (`inspiration-memories.update`). */
export type InspirationMemoriesUpdateInput = JsonValue;

/** Answer of `agents/inspirationMemoriesUpdate` (`inspiration-memories.update`). */
export type InspirationMemoriesUpdateResult = JsonValue;

/** Query of `agents/inspirationMemoryJobsList` (`inspiration-memory-jobs.list`). */
export type InspirationMemoryJobsListQuery = {
  conversationId?: string;
};

/** Answer of `agents/inspirationMemoryJobsList` (`inspiration-memory-jobs.list`). */
export type InspirationMemoryJobsListResult = JsonValue;

/** Answer of `agents/inspirationMemorySettingsGet` (`inspiration-memory-settings.get`). */
export type InspirationMemorySettingsGetResult = JsonValue;

/** Input of `agents/inspirationMemorySettingsUpdate` (`inspiration-memory-settings.update`). */
export type InspirationMemorySettingsUpdateInput = JsonValue;

/** Answer of `agents/inspirationMemorySettingsUpdate` (`inspiration-memory-settings.update`). */
export type InspirationMemorySettingsUpdateResult = JsonValue;

/** Input of `agents/inspirationProjectPreviewsCommit` (`inspiration-project-previews.commit`). */
export type InspirationProjectPreviewsCommitInput = JsonValue;

/** Answer of `agents/inspirationProjectPreviewsCommit` (`inspiration-project-previews.commit`). */
export type InspirationProjectPreviewsCommitResult = JsonValue;

/** Input of `agents/inspirationProjectPreviewsCreate` (`inspiration-project-previews.create`). */
export type InspirationProjectPreviewsCreateInput = JsonValue;

/** Answer of `agents/inspirationProjectPreviewsCreate` (`inspiration-project-previews.create`). */
export type InspirationProjectPreviewsCreateResult = JsonValue;

/** Answer of `agents/inspirationProjectPreviewsGet` (`inspiration-project-previews.get`). */
export type InspirationProjectPreviewsGetResult = JsonValue;

/** Input of `agents/providersActivateForAgent` (`providers.activateForAgent`). */
export type ProvidersActivateForAgentInput = JsonValue;

/** Answer of `agents/providersActivateForAgent` (`providers.activateForAgent`). */
export type ProvidersActivateForAgentResult = JsonValue;

/** One model of a provider preset. */
export interface ProviderCatalogModel {
  /** Model id the provider accepts. */
  id: string;
  /** Name to show. */
  label: string;
  /** Native model endpoint; some providers use different APIs per model. */
  baseUrl?: string;
  /** Whether the preset picks it first. */
  recommended?: boolean;
  /** Whether the provider marks it a preview. */
  preview?: boolean;
}

/** One provider preset: fixed address and protocol, the models to pick. */
export interface ProviderCatalogPreset {
  /** Preset id, stored on the provider as `预设服务商`. */
  id: string;
  /** Provider name, also the saved provider's title. */
  name: string;
  /** Call protocol. */
  protocol: string;
  /** Base address; absent when the provider's SDK fixes it. */
  baseUrl?: string;
  /** Page where the user applies for a key. */
  apiKeyUrl?: string;
  /** Page the models were checked against. */
  sourceUrl: string;
  /** Models to pick, in display order. */
  models: ProviderCatalogModel[];
}

/** Answer of `agents/providersCatalog`: Pi’s native provider catalog. */
export interface ProvidersCatalogResult {
  /** Release the catalog shipped with. */
  release: string;
  /** Day Pi generated its catalog. */
  updatedAt: string;
  /** Presets in display order. */
  providers: ProviderCatalogPreset[];
}

/** Input of `agents/providersCreate` (`providers.create`). */
export type ProvidersCreateInput = JsonValue;

/** Answer of `agents/providersCreate` (`providers.create`). */
export type ProvidersCreateResult = JsonValue;

/** Answer of `agents/providersGet` (`providers.get`). */
export type ProvidersGetResult = JsonValue;

/** Query of `agents/providersList` (`providers.list`). */
export type ProvidersListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `agents/providersList` (`providers.list`). */
export type ProvidersListResult = JsonValue;

/** Input of `agents/providersTestConnection` (`providers.testConnection`). */
export type ProvidersTestConnectionInput = JsonValue;

/** Answer of `agents/providersTestConnection` (`providers.testConnection`). */
export type ProvidersTestConnectionResult = JsonValue;

/** Input of `agents/providersUpdate` (`providers.update`). */
export type ProvidersUpdateInput = JsonValue;

/** Answer of `agents/providersUpdate` (`providers.update`). */
export type ProvidersUpdateResult = JsonValue;
