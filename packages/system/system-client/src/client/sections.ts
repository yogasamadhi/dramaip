import { useSyncExternalStore } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { resolveSlotLabel } from "@dramaip/infra-ui-slots";

/** One registered settings section, as the page lays it out. */
export interface SettingsSectionRow {
  /** Section key: the anchor id and the `only` filter. */
  readonly id: string;
  /** Navigation text; a section without one has no navigation stop. */
  readonly label: string | undefined;
}

/**
 * The hook the page reads its sections with: the `settings.section` entries
 * in display order, one row per id (the lowest priority wins a shadowed id).
 * Labels resolve at render time, so thunked labels follow the locale.
 * @param ctx - Client Context whose Slot registry holds the entries.
 * @returns hook over the current rows.
 */
export function sectionsHook(
  ctx: Context,
): () => readonly SettingsSectionRow[] {
  const subscribe = (listener: () => void) =>
    ctx.slots.subscribe("settings.section", listener);
  // The registry replaces its entry array on every change: a stable snapshot.
  const snapshot = () => ctx.slots.entries("settings.section");
  return () => {
    const entries = useSyncExternalStore(subscribe, snapshot);
    const rows = new Map<string, SettingsSectionRow & { order: number }>();
    for (const { options } of entries) {
      if (options.id === undefined || rows.has(options.id)) continue;
      rows.set(options.id, {
        id: options.id,
        label: resolveSlotLabel(options.label),
        order: options.order ?? 0,
      });
    }
    return [...rows.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ id, label }) => ({ id, label }));
  };
}
