/**
 * Client face of the workspace domain (P4-c): the search page over the
 * `workspace` Remote namespace, and the project tools page frame, which
 * reads the project the address names, offers the tools of its mode and
 * lays out the chosen tool's `workspace.tool` entry or an overview with each
 * tool's state and the recommended next step. Until the existing app retires
 * (P6) both pages render inside its router as `studio.route` entries, read
 * the route and the project record through the route's owner share, and the
 * tool bodies are still the app's except the personal theater, creator
 * channel, series, pilot, import, import review, cockpit and author intent
 * tools, which render natively. It also registers the local backups as a
 * `settings.section`, and defines the project records workspace Factory
 * (`workspace.records`) that domain clients render over their own records
 * Remote calls.
 * @module @dramaip/workspace-workspace-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/infra-ui-settings/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import { BackupSection } from "./BackupSection.tsx";
import { CockpitTool } from "./cockpit/CockpitTool.tsx";
import { AuthorIntentEntry } from "./intent/AuthorIntentTool.tsx";
import { en, zh } from "./locale.ts";
import { ProjectToolsPage } from "./ProjectToolsPage.tsx";
import { RecordsWorkspace } from "./records/RecordsWorkspace.tsx";
import type {} from "./contract.ts";
import { SearchPage } from "./SearchPage.tsx";
import { CreatorChannelTool } from "./tools/CreatorChannelTool.tsx";
import { ImportReviewTool } from "./tools/ImportReviewTool.tsx";
import { ImportTool } from "./tools/ImportTool.tsx";
import { PersonalTheaterTool } from "./tools/PersonalTheaterTool.tsx";
import { PilotTool } from "./tools/PilotTool.tsx";
import { SeriesLibraryTool } from "./tools/SeriesLibraryTool.tsx";
import type { ToolRemotes } from "./tools/remote.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The search page, the project tools page frame and the backups. */
    workspace: keyof typeof zh;
  }
}

/**
 * Required Client services: Slots, copy, the `workspace` and `system` Remote
 * namespaces, and the `media`, `writing`, `knowledge`, `automation`,
 * `production` and `delivery` ones the native tool bodies call.
 */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.workspace",
  "remote.system",
  "remote.media",
  "remote.writing",
  "remote.knowledge",
  "remote.automation",
  "remote.production",
  "remote.delivery",
];

/** The route path the project tools page registers under. */
export const PROJECT_TOOLS_ROUTE = "/projects/:projectId/tools/:toolKey?";

/**
 * Register the copy, the search page, the project tools page and its native
 * tool bodies, the backup section and the records workspace Factory.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("workspace", { zh, en }),
    "workspace-client: copy",
  );
  ctx.slots.inject("studio.route", () => [
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/search",
        locale: "workspace",
        registrant: "workspace-client",
        inject: () => ({ workspace: ctx.remote.workspace }),
      },
      SearchPage,
    ),
    ctx.slots.register(
      {
        name: "studio.route",
        key: PROJECT_TOOLS_ROUTE,
        locale: "workspace",
        registrant: "workspace-client",
        children: { "workspace.tool": { kind: "keyed", scope: "root" } },
        inject: () => ({ workspace: ctx.remote.workspace }),
      },
      ProjectToolsPage,
    ),
  ]);
  const tools = (): ToolRemotes => ({
    workspace: ctx.remote.workspace,
    media: ctx.remote.media,
    writing: ctx.remote.writing,
    knowledge: ctx.remote.knowledge,
    system: ctx.remote.system,
    automation: ctx.remote.automation,
    production: ctx.remote.production,
    delivery: ctx.remote.delivery,
  });
  ctx.slots.inject("workspace.tool", () =>
    (
      [
        ["personal-theater", PersonalTheaterTool],
        ["creator-channel", CreatorChannelTool],
        ["series", SeriesLibraryTool],
        ["pilot", PilotTool],
        ["import", ImportTool],
        ["review", ImportReviewTool],
        ["cockpit", CockpitTool],
        ["author-intent", AuthorIntentEntry],
      ] as const
    ).map(([key, component]) =>
      ctx.slots.register(
        {
          name: "workspace.tool",
          key,
          locale: "workspace",
          registrant: "workspace-client",
          inject: tools,
        },
        component,
      ),
    ),
  );
  ctx.slots.registerFactory(
    {
      name: "workspace.records",
      scope: "root",
      inject: () => ({
        workspace: ctx.remote.workspace,
        system: ctx.remote.system,
      }),
      locale: "workspace",
    },
    RecordsWorkspace,
  );
  const t = ctx.locale.bind("workspace");
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "settings-data",
        order: 30,
        label: () => t("backup.nav"),
        locale: "workspace",
        registrant: "workspace-client",
        inject: () => ({
          workspace: ctx.remote.workspace,
          reload: () => window.location.reload(),
        }),
      },
      BackupSection,
    ),
  );
}
