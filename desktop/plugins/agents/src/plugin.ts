import { WRITING_RESOURCE_SERVICE } from "@dramaip/contracts/writing";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import { CREATION_WORKFLOW_SERVICE } from "@dramaip/contracts/creation";
import { AUTOMATION_RESOURCE_SERVICE } from "@dramaip/contracts/automation";
import { AUTOMATION_PREVIEW_SERVICE } from "@dramaip/contracts/automation";
import { CREATIVE_KNOWLEDGE_SERVICE } from "@dramaip/contracts";
import { provideService } from "@dramaip/plugin-api/internal";
export { AGENT_TASK_CATALOG } from "./task-catalog.js";
import {
  AGENT_CONTEXT_SERVICE,
  AGENT_TASK_RUNNER_SERVICE,
  CONFIGURED_PROVIDER_SERVICE,
  type ConfiguredProviderService,
} from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { definePlugin } from "@dramaip/plugin-api/internal";
import { AGENTS_DESCRIPTOR, AGENTS_UI_CONTRIBUTIONS } from "./descriptor.js";
import { evaluationRoutes } from "./experiments/routes.js";
import { agentContextRoutes } from "./context/routes.js";
import { createAgentContextStore } from "./context/store.js";
import {
  AgentRouteHandler,
  agentRouteBuilder,
  materializeAgentRoute,
} from "./internal/shared.js";
import { agentMigrations } from "./migrations/index.js";
import {
  configuredProvider,
  findProvider,
  providerRoutes,
  restoreSavedAgentConfiguration,
} from "./providers/routes.js";
import {
  recoverAgentRuns,
  recoverAvailableAgentRuns,
} from "./runs/recovery.js";
import { createAgentTaskRunner } from "./runs/task-runner.js";
import {
  assistantConversationRoutes,
  typedAgentSessionRoutes,
} from "./sessions/routes.js";
import { inspirationRoutes } from "./inspiration/routes.js";
import { startInspirationMemoryWorker } from "./inspiration/worker.js";
export function createAgentsPlugin(host?: DesktopHostClient) {
  return definePlugin({
    inject: [
      AUTOMATION_PREVIEW_SERVICE.id,
      AUTOMATION_RESOURCE_SERVICE.id,
      CREATION_WORKFLOW_SERVICE.id,
      CREATIVE_KNOWLEDGE_SERVICE.id,
      WRITING_CHAPTER_SERVICE.id,
      WRITING_RESOURCE_SERVICE.id,
    ],
    descriptor: AGENTS_DESCRIPTOR,
    ui: AGENTS_UI_CONTRIBUTIONS,
    migrations: agentMigrations,
    apply: async (context) => {
      const agentContext = createAgentContextStore(context);
      context.effect(
        () => provideService(context, AGENT_CONTEXT_SERVICE, agentContext),
        `service:${AGENT_CONTEXT_SERVICE}`,
      );
      context.effect(
        () => startInspirationMemoryWorker(context, host, agentContext),
        "worker:inspiration-memory",
      );
      recoverAgentRuns(context, host);
      const providerService: ConfiguredProviderService = {
        get: (id) => {
          const provider = findProvider(context, id);
          if (!provider) return undefined;
          try {
            return configuredProvider(provider);
          } catch {
            return undefined;
          }
        },
      };
      context.effect(
        () =>
          provideService(context, CONFIGURED_PROVIDER_SERVICE, providerService),
        `service:${CONFIGURED_PROVIDER_SERVICE}`,
      );
      context.effect(
        () =>
          provideService(
            context,
            AGENT_TASK_RUNNER_SERVICE,
            createAgentTaskRunner(context, host, agentContext),
          ),
        `service:${AGENT_TASK_RUNNER_SERVICE}`,
      );
      const assistantRoutes = assistantConversationRoutes(
        context,
        host,
        agentContext,
      );
      const assistantHandler = (id: string): AgentRouteHandler => {
        const draft = assistantRoutes.find((route) => route.id === id);
        if (!draft) throw new Error(`Agent route is missing: ${id}`);
        return draft.bind(agentRouteBuilder).handler;
      };
      for (const route of [
        ...providerRoutes(context, host),
        ...agentContextRoutes(agentContext),
        ...assistantRoutes,
        ...typedAgentSessionRoutes(context, host, {
          create: assistantHandler("agents:assistant-conversations-create"),
          sendMessage: assistantHandler(
            "agents:assistant-conversations-send-message",
          ),
        }),
        ...inspirationRoutes(context),
        ...evaluationRoutes(context, host, agentContext),
      ]) {
        const registered =
          "bind" in route ? materializeAgentRoute(route) : route;
        context.effect(
          () => context.http.register(registered),
          `route:${registered.id}`,
        );
      }
      await restoreSavedAgentConfiguration(context, host, () =>
        recoverAvailableAgentRuns(context, host),
      );
    },
  });
}

export const agentsPlugin = createAgentsPlugin();
