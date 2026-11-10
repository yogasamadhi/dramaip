/**
 * Client face of the system domain (P4-a): the settings page, which lays out
 * every registered `settings.section`, the appearance section, which stacks
 * the `settings.general.item` rows (theme, fonts, language), and the runtime
 * diagnostics section over the `system` Remote namespace. Until the existing app retires (P6) the
 * page renders inside its router as the `/settings` `studio.route` entry.
 * @module @dramaip/system-system-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/infra-ui-settings/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/system-system/remote";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { DiagnosticsSection } from "./DiagnosticsSection.tsx";
import { en, zh } from "./locale.ts";
import { sectionsHook } from "./sections.ts";
import { SettingsPage } from "./SettingsPage.tsx";

export type { SettingsSectionRow } from "./sections.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The settings page frame and the diagnostics section. */
    system: keyof typeof zh;
  }
}

/** Required Client services: Slots, copy and the `system` Remote namespace. */
export const inject = ["slots", "locale", "remote", "remote.system"];

/**
 * Register the copy, the settings page and its appearance and diagnostics
 * sections.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("system", { zh, en }),
    "system-client: copy",
  );
  const t = ctx.locale.bind("system");
  const useSections = sectionsHook(ctx);
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/settings",
        locale: "system",
        registrant: "system-client",
        children: { "settings.section": { kind: "list", scope: "root" } },
        inject: () => ({ useSections }),
      },
      SettingsPage,
    ),
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "settings-appearance",
        order: 20,
        label: () => t("appearance.nav"),
        locale: "system",
        registrant: "system-client",
        children: { "settings.general.item": { kind: "list", scope: "root" } },
      },
      AppearanceSection,
    ),
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "settings-advanced",
        order: 40,
        label: () => t("diagnostics.nav"),
        locale: "system",
        registrant: "system-client",
        inject: () => ({ system: ctx.remote.system }),
      },
      DiagnosticsSection,
    ),
  );
}
