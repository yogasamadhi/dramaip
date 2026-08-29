export { AGENT_TASK_CATALOG } from "./task-catalog.js";
import {
  AGENT_TASK_RUNNER_SERVICE,
  CONFIGURED_PROVIDER_SERVICE,
  type ConfiguredProviderService,
} from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { defineFirstPartyPlugin } from "@dramaip/plugin-api/internal";
import { AGENTS_DESCRIPTOR, AGENTS_UI_CONTRIBUTIONS } from "./descriptor.js";
import { evaluationRoutes } from "./experiments/routes.js";
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
  return defineFirstPartyPlugin({
    descriptor: AGENTS_DESCRIPTOR,
    ui: AGENTS_UI_CONTRIBUTIONS,
    migrations: agentMigrations,
    activate: async (context) => {
      context.effect("worker:inspiration-memory", () =>
        startInspirationMemoryWorker(context, host),
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
      if (context.services)
        context.effect(`service:${CONFIGURED_PROVIDER_SERVICE}`, () =>
          context.services.provide(
            CONFIGURED_PROVIDER_SERVICE,
            providerService,
          ),
        );
      if (context.services)
        context.effect(`service:${AGENT_TASK_RUNNER_SERVICE}`, () =>
          context.services.provide(
            AGENT_TASK_RUNNER_SERVICE,
            createAgentTaskRunner(context, host),
          ),
        );
      const assistantRoutes = assistantConversationRoutes(context, host);
      const assistantHandler = (id: string): AgentRouteHandler => {
        const draft = assistantRoutes.find((route) => route.id === id);
        if (!draft) throw new Error(`Agent route is missing: ${id}`);
        return draft.bind(agentRouteBuilder).handler;
      };
      for (const route of [
        ...providerRoutes(context, host),
        ...assistantRoutes,
        ...typedAgentSessionRoutes(context, host, {
          create: assistantHandler("agents:assistant-conversations-create"),
          sendMessage: assistantHandler(
            "agents:assistant-conversations-send-message",
          ),
        }),
        ...inspirationRoutes(context),
        ...evaluationRoutes(context, host),
      ]) {
        const registered =
          "bind" in route ? materializeAgentRoute(route) : route;
        context.effect(`route:${registered.id}`, () =>
          context.http.register(registered),
        );
      }
      await restoreSavedAgentConfiguration(context, host, () =>
        recoverAvailableAgentRuns(context, host),
      );
    },
  });
}

export const agentsPlugin = createAgentsPlugin();
