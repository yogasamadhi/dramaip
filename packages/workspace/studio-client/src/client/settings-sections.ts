import { useSyncExternalStore } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-ui-settings/client";
import { SettingsAiPreparationSection } from "../app/settings-sections";
import type {} from "./contract.ts";

/**
 * Register the settings section the existing app still owns into the system
 * settings page, which declares `settings.section` when it mounts: the
 * creation checklist, which reads the app's creation session. It sits above
 * the agents client's AI section and follows its connection tests through
 * the `studio/provider-ready` event. Transitional until that session leaves
 * the app (P6); the ledger, backups, appearance and AI connections moved to
 * the insights, workspace, system and agents clients.
 * @param ctx - Client Context whose Slot registry the page declares into.
 */
export function registerLegacySettingsSections(ctx: Context): void {
  let ready: string | undefined;
  const listeners = new Set<() => void>();
  ctx.on("studio/provider-ready", (providerId) => {
    ready = providerId;
    for (const listener of listeners) listener();
  });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const useReadyProvider = () => useSyncExternalStore(subscribe, () => ready);
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "settings-ai-preparation",
        order: 5,
        registrant: "workspace-studio-client",
        inject: () => ({ useReadyProvider }),
      },
      SettingsAiPreparationSection,
    ),
  );
}
