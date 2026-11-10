/**
 * Client face of the creative quality domain (P4-d): the creative analysis
 * page frame (`/create`), which lays out every registered `quality.section`
 * for the project the address names, else the app's active one. Until the
 * existing app retires (P6) the page renders inside its router as a
 * `studio.route` entry and reads the project choice through the route's
 * owner share; the sections are still the app's.
 * @module @dramaip/writing-quality-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import { CreativePage } from "./CreativePage.tsx";
import { en, zh } from "./locale.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The creative analysis page frame. */
    quality: keyof typeof zh;
  }
}

/** Required Client services: Slots and copy. */
export const inject = ["slots", "locale"];

/**
 * Register the copy and the creative analysis page.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("quality", { zh, en }),
    "quality-client: copy",
  );
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/create",
        locale: "quality",
        registrant: "quality-client",
        children: { "quality.section": { kind: "list", scope: "root" } },
      },
      CreativePage,
    ),
  );
}
