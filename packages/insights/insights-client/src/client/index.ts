/**
 * Client face of the insights domain (P4-b): the feedback and outcomes page
 * over the `insights` Remote namespace, which lays out every registered
 * `insights.section` for the chosen project, among them the feedback
 * revision, drafted in the automation client's creation workbench, and the
 * outcome ledgers, whose run usage reports come from the `agents` namespace. Until the existing app retires
 * (P6) the page renders inside its router as the `/insights` `studio.route`
 * entry, and reads the app's project choice through the route's owner share.
 * It also registers the generation ledger as a `settings.section`.
 * @module @dramaip/insights-insights-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/agents-agents/remote";
import type {} from "@dramaip/automation-automation-client/client/contract";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/infra-ui-settings/client";
import type {} from "@dramaip/insights-insights/remote";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import type {} from "@dramaip/writing-writing/remote";
import { GenerationLedgerSection } from "./GenerationLedgerSection.tsx";
import { InsightsPage } from "./InsightsPage.tsx";
import { en, zh } from "./locale.ts";
import { OutcomesSection } from "./OutcomesSection.tsx";
import { RevisionSection } from "./RevisionSection.tsx";
import type {} from "./contract.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The insights page frame, its feedback section, the generation ledger and the outcome ledgers. */
    insights: keyof typeof zh;
  }
}

/**
 * Required Client services: Slots, copy, the `insights` Remote namespace,
 * the `agents` one, whose usage reports the outcome ledgers read, the
 * `system` one, whose native picker chooses the files to import, the
 * `workspace` one, whose project list the ledger chooses from, and the
 * `writing` and `production` ones, whose chapters and scripts a feedback
 * revision targets.
 */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.agents",
  "remote.insights",
  "remote.production",
  "remote.system",
  "remote.workspace",
  "remote.writing",
];

/**
 * Register the copy, the insights page, its outcome ledgers section and the
 * generation ledger section.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("insights", { zh, en }),
    "insights-client: copy",
  );
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/insights",
        locale: "insights",
        registrant: "insights-client",
        children: { "insights.section": { kind: "list", scope: "root" } },
        inject: () => ({
          insights: ctx.remote.insights,
          system: ctx.remote.system,
        }),
      },
      InsightsPage,
    ),
  );
  ctx.slots.inject("insights.section", () => [
    ctx.slots.register(
      {
        name: "insights.section",
        id: "insights-revision",
        order: 10,
        locale: "insights",
        registrant: "insights-client",
        inject: () => ({
          writing: ctx.remote.writing,
          production: ctx.remote.production,
        }),
      },
      RevisionSection,
    ),
    ctx.slots.register(
      {
        name: "insights.section",
        id: "insights-outcomes",
        order: 20,
        locale: "insights",
        registrant: "insights-client",
        inject: () => ({
          insights: ctx.remote.insights,
          agents: ctx.remote.agents,
        }),
      },
      OutcomesSection,
    ),
  ]);
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "settings-ledger",
        order: 39,
        locale: "insights",
        registrant: "insights-client",
        inject: () => ({
          insights: ctx.remote.insights,
          workspace: ctx.remote.workspace,
        }),
      },
      GenerationLedgerSection,
    ),
  );
}
