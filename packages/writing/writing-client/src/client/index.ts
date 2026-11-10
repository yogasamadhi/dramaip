/**
 * Client face of the writing domain (P4-d): the novel library (`/write`), the
 * novel quick start (`/write/new`) and the novel workspace frame
 * (`/projects/:projectId`), which reads the project and chapter the address
 * names and lays out the chosen section's `writing.section` entry. Until the
 * existing app retires (P6) the pages render inside its router as
 * `studio.route` entries and read the workspace record and the quick start
 * draft through the route's owner share; the section bodies, the story
 * preset picker and the manuscript dialog are still the app's. It also
 * registers the `writing.context-picker` Factory, the narrative sources an
 * AI run is explicitly given.
 * @module @dramaip/writing-writing-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import { ContextPicker } from "./context/ContextPicker.tsx";
import * as narrative from "./context/locale.ts";
import type {} from "./contract.ts";
import { en, zh } from "./locale.ts";
import { NovelWorkspacePage } from "./NovelWorkspacePage.tsx";
import { QuickStartPage } from "./QuickStartPage.tsx";
import { WritingHomePage } from "./WritingHomePage.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The novel library, the quick start and the novel workspace. */
    writing: keyof typeof zh;
  }
}

/** Required Client services: Slots, copy and the Remote namespaces the pages read. */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.workspace",
  "remote.system",
  "remote.knowledge",
];

/** The route path the novel workspace registers under. */
export const NOVEL_WORKSPACE_ROUTE = "/projects/:projectId";

/**
 * Register the copy, the three pages and the context picker Factory.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("writing", { zh, en }),
    "writing-client: copy",
  );
  ctx.effect(
    () =>
      ctx.locale.register("narrative", { zh: narrative.zh, en: narrative.en }),
    "writing-client: context picker copy",
  );
  ctx.slots.registerFactory(
    {
      name: "writing.context-picker",
      scope: "root",
      inject: () => ({ knowledge: ctx.remote.knowledge }),
      locale: "narrative",
    },
    ContextPicker,
  );
  const base = {
    name: "studio.route",
    locale: "writing",
    registrant: "writing-client",
  } as const;
  ctx.slots.inject("studio.route", () => [
    ctx.slots.register(
      {
        ...base,
        key: "/write",
        inject: () => ({ workspace: ctx.remote.workspace }),
      },
      WritingHomePage,
    ),
    ctx.slots.register(
      {
        ...base,
        key: "/write/new",
        children: { "writing.preset": { kind: "keyed", scope: "root" } },
      },
      QuickStartPage,
    ),
    ctx.slots.register(
      {
        ...base,
        key: NOVEL_WORKSPACE_ROUTE,
        children: {
          "writing.section": { kind: "keyed", scope: "root" },
          "writing.banner": { kind: "list", scope: "root" },
          "writing.manuscript": { kind: "keyed", scope: "root" },
        },
        inject: () => ({
          workspace: ctx.remote.workspace,
          system: ctx.remote.system,
        }),
      },
      NovelWorkspacePage,
    ),
  ]);
}
