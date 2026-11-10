/**
 * The Studio app's view of the ui-theme service. ui-theme owns the
 * preference and ui-layout applies it to the document and the native window;
 * the app's own theme menu only reads the published mode and hands choices
 * back to the service.
 */
import { useSyncExternalStore } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemeMode, "system">;

type ThemeView = { mode: ThemeMode; resolvedTheme: ResolvedTheme };

let view: ThemeView = { mode: "system", resolvedTheme: "light" };
let choose: ((mode: ThemeMode) => void) | undefined;
const listeners = new Set<() => void>();

/**
 * Publish the theme service's current state to the app.
 * @param snapshot - the service's preference and resolved color scheme.
 */
export function publishTheme(snapshot: {
  preference: ThemeMode;
  active: { colorScheme: ResolvedTheme };
}): void {
  view = {
    mode: snapshot.preference,
    resolvedTheme: snapshot.active.colorScheme,
  };
  for (const listener of listeners) listener();
}

/**
 * Route the app's theme choices to the theme service.
 * @returns a function that stops routing them.
 */
export function bindThemeChooser(
  chooser: (mode: ThemeMode) => void,
): () => void {
  choose = chooser;
  return () => {
    if (choose === chooser) choose = undefined;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the published theme mode and choose another one. */
export function useTheme(): ThemeView & { setMode(mode: ThemeMode): void } {
  const current = useSyncExternalStore(subscribe, () => view);
  return { ...current, setMode: (mode) => choose?.(mode) };
}
