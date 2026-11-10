/**
 * Client face of the production domain (P5-c): the adaptation page frame
 * (`/adapt`), which hands its heading copy to the workbench its
 * `production.adapt` slot holds, and the production project tools as
 * `workspace.tool` entries: the adaptation diagnosis, the independent
 * adaptation strategy and the season plan so far.
 * Until the existing app retires (P6) the page renders inside its router as
 * a `studio.route` entry; the workbench body is still the app's.
 * @module @dramaip/production-production-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import { AdaptPage } from "./AdaptPage.tsx";
import { en, zh } from "./locale.ts";
import { AdaptationDiagnosisEntry } from "./diagnosis/AdaptationDiagnosisTool.tsx";
import { SeasonPlanEntry } from "./season/SeasonPlanTool.tsx";
import { AdaptationStrategyEntry } from "./strategy/AdaptationStrategyTool.tsx";
import type { ToolRemotes } from "./tools/remote.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The adaptation page frame. */
    production: keyof typeof zh;
  }
}

/**
 * Required Client services: Slots, copy, and the `production`, `automation`,
 * `system` and `writing` Remote namespaces the tool bodies call.
 */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.production",
  "remote.automation",
  "remote.system",
  "remote.writing",
];

/**
 * Register the copy, the adaptation page and the production tools.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("production", { zh, en }),
    "production-client: copy",
  );
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/adapt",
        locale: "production",
        registrant: "production-client",
        children: {
          "production.adapt": { kind: "keyed", scope: "root" },
        },
      },
      AdaptPage,
    ),
  );
  const tools = (): ToolRemotes => ({
    production: ctx.remote.production,
    automation: ctx.remote.automation,
    system: ctx.remote.system,
    writing: ctx.remote.writing,
  });
  ctx.slots.inject("workspace.tool", () =>
    (
      [
        ["adaptation-diagnosis", AdaptationDiagnosisEntry],
        ["adaptation-strategy", AdaptationStrategyEntry],
        ["season-plan", SeasonPlanEntry],
      ] as const
    ).map(([key, component]) =>
      ctx.slots.register(
        {
          name: "workspace.tool",
          key,
          locale: "production",
          registrant: "production-client",
          inject: tools,
        },
        component,
      ),
    ),
  );
}
