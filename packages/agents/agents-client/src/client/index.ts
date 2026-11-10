/**
 * Client face of the agents domain: the inspiration space (`/inspiration`,
 * P6) over the `agents`, `knowledge`, `quality` and `system` Remote
 * namespaces, whose project conversion is the panel its
 * `agents.inspiration-conversion` slot holds; the AI connection settings
 * section (model providers, agent engines) over `agents`,
 * `system` and `workspace`; and the task center's new-task settings, the
 * `agents.task-config` Factory (P6), over `agents`, `writing` and
 * `production`. Until the existing app retires (P6) the page renders inside
 * its router as a `studio.route` entry, and the conversion is still the
 * app's.
 * @module @dramaip/agents-agents-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/infra-ui-settings/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/writing-knowledge/remote";
import type {} from "@dramaip/writing-quality/remote";
import type {} from "./contract.ts";
import { AiSection } from "./AiSection.tsx";
import { InspirationPage } from "./InspirationPage.tsx";
import { en, zh } from "./locale.ts";
import { TaskConfig } from "./task-config/TaskConfig.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /**
     * The inspiration space, the assistant timeline, the AI connection
     * settings and the new-task settings.
     */
    agents: keyof typeof zh;
  }
}

/** Required Client services: Slots, copy and the namespaces the views use. */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.agents",
  "remote.knowledge",
  "remote.quality",
  "remote.system",
  "remote.workspace",
  "remote.writing",
  "remote.production",
];

/**
 * Register the copy, the inspiration space page, the AI section and the
 * new-task settings.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("agents", { zh, en }),
    "agents-client: copy",
  );
  const t = ctx.locale.bind("agents");
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/inspiration",
        locale: "agents",
        registrant: "agents-client",
        children: {
          "agents.inspiration-conversion": { kind: "keyed", scope: "root" },
        },
        inject: () => ({
          agents: ctx.remote.agents,
          knowledge: ctx.remote.knowledge,
          quality: ctx.remote.quality,
          system: ctx.remote.system,
        }),
      },
      InspirationPage,
    ),
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "settings-ai",
        order: 10,
        label: () => t("ai.nav"),
        locale: "agents",
        registrant: "agents-client",
        inject: () => ({
          agents: ctx.remote.agents,
          system: ctx.remote.system,
          workspace: ctx.remote.workspace,
          announce: (providerId: string | undefined) =>
            ctx.emit("studio/provider-ready", providerId),
        }),
      },
      AiSection,
    ),
  );
  ctx.slots.registerFactory(
    {
      name: "agents.task-config",
      scope: "root",
      locale: "agents",
      inject: () => ({
        agents: ctx.remote.agents,
        writing: ctx.remote.writing,
        production: ctx.remote.production,
      }),
    },
    TaskConfig,
  );
}
