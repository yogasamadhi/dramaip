/**
 * Client face of the automation domain: the task center (`/tasks`) and the
 * pending confirmation center (`/pending`), native since P6-e, and the
 * creation workbench factories (P6-d) and the change preview card (P6-h) the
 * domain clients render. Until the
 * existing app retires the pages render inside its router as `studio.route`
 * entries; the task center opens the agents client's new-task settings
 * (`agents.task-config`).
 * @module @dramaip/automation-automation-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/production-delivery/remote";
import type {} from "@dramaip/production-media/remote";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/production-timeline/remote";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import type {} from "@dramaip/writing-knowledge/remote";
import type {} from "@dramaip/writing-quality/remote";
import { automationPage, type AutomationPageKey } from "./AutomationPage.tsx";
import type {} from "./contract.ts";
import { ChangePreviewFactory } from "./confirmations/PreviewCards.tsx";
import { NarrativeSourceCoverage } from "./creation/SourceCoverage.tsx";
import { creationEn, creationZh } from "./creation/creation-locale.ts";
import {
  CreationRecordWorkbench,
  CreationRunCard,
  CreationWorkbench,
} from "./creation/CreationWorkbench.tsx";
import { en, zh } from "./locale.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The task and pending confirmation centers. */
    automation: keyof typeof zh;
    /** The creation workbench: a run, its draft and its records. */
    creation: keyof typeof creationZh;
  }
}

/**
 * Required Client services: Slots, copy, the workbench's Remotes and every
 * domain that owns a record waiting for the author.
 */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.agents",
  "remote.automation",
  "remote.delivery",
  "remote.knowledge",
  "remote.media",
  "remote.production",
  "remote.quality",
  "remote.system",
  "remote.timeline",
  "remote.workspace",
  "remote.writing",
];

const PAGES: readonly AutomationPageKey[] = ["tasks", "pending"];

/**
 * Register the copy, the task and pending confirmation centers and the
 * creation workbench factories.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("automation", { zh, en }),
    "automation-client: copy",
  );
  ctx.effect(
    () => ctx.locale.register("creation", { zh: creationZh, en: creationEn }),
    "automation-client: creation copy",
  );
  ctx.slots.inject("studio.route", () =>
    PAGES.map((page) =>
      ctx.slots.register(
        {
          name: "studio.route",
          key: `/${page}`,
          locale: "automation",
          registrant: "automation-client",
          inject: () => ({
            automation: ctx.remote.automation,
            delivery: ctx.remote.delivery,
            knowledge: ctx.remote.knowledge,
            media: ctx.remote.media,
            production: ctx.remote.production,
            quality: ctx.remote.quality,
            system: ctx.remote.system,
            timeline: ctx.remote.timeline,
            workspace: ctx.remote.workspace,
            writing: ctx.remote.writing,
          }),
        },
        automationPage(page),
      ),
    ),
  );
  const remotes = () => ({
    automation: ctx.remote.automation,
    agents: ctx.remote.agents,
    writing: ctx.remote.writing,
    system: ctx.remote.system,
  });
  ctx.slots.registerFactory(
    {
      name: "automation.creation-workbench",
      scope: "root",
      inject: remotes,
      locale: "creation",
    },
    CreationWorkbench,
  );
  ctx.slots.registerFactory(
    {
      name: "automation.creation-record",
      scope: "root",
      inject: () => ({ ...remotes(), production: ctx.remote.production }),
      locale: "creation",
    },
    CreationRecordWorkbench,
  );
  ctx.slots.registerFactory(
    {
      name: "automation.creation-run",
      scope: "root",
      inject: remotes,
      locale: "creation",
    },
    CreationRunCard,
  );
  ctx.slots.registerFactory(
    { name: "automation.source-coverage", scope: "root", locale: "creation" },
    NarrativeSourceCoverage,
  );
  ctx.slots.registerFactory(
    {
      name: "automation.change-preview",
      scope: "root",
      inject: () => ({
        automation: ctx.remote.automation,
        workspace: ctx.remote.workspace,
        writing: ctx.remote.writing,
      }),
      locale: "automation",
    },
    ChangePreviewFactory,
  );
}
