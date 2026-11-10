/**
 * Client face of the Studio client: the Studio app occupies the renderer's
 * root Slot, so the renderer still mounts the only React root, and its entry
 * shadows ui-layout's frame. The pages read their copy from the `studio`
 * locale namespace and call the domain Remote namespaces through the
 * request facade's bridge.
 * @module @dramaip/workspace-studio-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-theme/client";
import { bindStudioCopy } from "../app/copy";
import { en, zh } from "../app/locale";
import appStyles from "../app/styles.css?inline";
import { bindThemeChooser, publishTheme } from "../app/theme-mode";
import cornerShape from "./corner-shape.css?inline";
import { installRuntimeBootstrap } from "./bootstrap.ts";
import { LegacyStudio } from "./LegacyStudio.tsx";
import { registerLegacyAgentsPages } from "./agents-sections.tsx";
import { registerLegacyMediaPages } from "./media-sections.tsx";
import { registerLegacyProductionPages } from "./production-sections.tsx";
import { registerLegacyProjectTools } from "./project-tool-sections.tsx";
import { installRemoteBridge, LEGACY_TABLES } from "./remote-bridge.ts";
import { registerLegacySettingsSections } from "./settings-sections.ts";
import { registerLegacyWritingSections } from "./writing-sections.tsx";
import { installSystemBridge } from "./system-bridge.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The Studio pages. */
    studio: keyof typeof zh;
  }
}

/**
 * Required Client services: the Slot registry, the copy, the theme service the app's
 * theme follows, the `system` Remote namespace
 * that answers the runtime and Host paths the app still calls, and the
 * namespace of every domain table the Remote bridge answers from (a Client
 * Context only reads a declared namespace).
 */
export const inject = [
  "slots",
  "locale",
  "theme",
  "remote",
  "remote.system",
  ...LEGACY_TABLES.map(({ namespace }) => `remote.${namespace}`),
];

/**
 * Bridge the system paths, install the Runtime bootstrap, apply the theme and
 * take the root Slot.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("studio", { zh, en }),
    "workspace-studio-client: copy",
  );
  ctx.effect(
    () => bindStudioCopy(ctx.locale.bind("studio")),
    "workspace-studio-client: copy binding",
  );
  for (const [name, css] of [
    ["styles.css", appStyles],
    ["corner-shape.css", cornerShape],
  ] as const)
    ctx.effect(() => {
      if (typeof document === "undefined") return () => {};
      const tag = document.createElement("style");
      tag.dataset.pluginCss = `@dramaip/workspace-studio-client/${name}`;
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => tag.remove();
    }, `workspace-studio-client: ${name} stylesheet`);
  // Before the bootstrap: it reads `/api/v2/runtime` through the bridge.
  ctx.effect(
    () => installSystemBridge(ctx),
    "workspace-studio-client: system bridge",
  );
  // The domain operations the controllers took over (P4-b onward).
  ctx.effect(
    () => installRemoteBridge(ctx),
    "workspace-studio-client: domain Remote bridge",
  );
  ctx.effect(
    installRuntimeBootstrap,
    "workspace-studio-client: runtime bootstrap",
  );
  // One theme truth: the app reads ui-theme's mode and hands its own
  // controls' choices back to it.
  ctx.effect(() => {
    publishTheme(ctx.theme.getTheme());
    const unbind = bindThemeChooser((mode) => ctx.theme.setTheme(mode));
    const unlisten = ctx.on("theme/change", publishTheme);
    return () => {
      unbind();
      unlisten();
    };
  }, "workspace-studio-client: theme follows ui-theme");
  // Below ui-layout's default priority 0: the lowest priority renders.
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: "root",
          registrant: "workspace-studio-client",
          priority: -1,
          children: { "studio.route": { kind: "keyed", scope: "root" } },
        },
        LegacyStudio,
      ),
    "workspace-studio-client: root Slot",
  );
  registerLegacySettingsSections(ctx);
  registerLegacyProjectTools(ctx);
  registerLegacyWritingSections(ctx);
  registerLegacyAgentsPages(ctx);
  registerLegacyMediaPages(ctx);
  registerLegacyProductionPages(ctx);
}
