import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { BareButton } from "./primitives.tsx";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemeMode, "system">;

export const THEME_STORAGE_KEY = "dramaip-theme-v1";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    root.style.colorScheme = resolved;
  }
  return resolved;
}

export function initializeTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const mode = isThemeMode(stored) ? stored : "system";
  applyTheme(mode);
  return mode;
}

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode(mode: ThemeMode): void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultMode = "system",
  onResolvedThemeChange,
}: {
  children: ReactNode;
  defaultMode?: ThemeMode;
  onResolvedThemeChange?(theme: ResolvedTheme): void;
}) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return defaultMode;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : defaultMode;
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    applyTheme(mode),
  );
  const synchronize = useCallback(
    (nextMode: ThemeMode) => {
      const resolved = applyTheme(nextMode);
      setResolvedTheme(resolved);
      onResolvedThemeChange?.(resolved);
    },
    [onResolvedThemeChange],
  );
  useEffect(() => {
    synchronize(mode);
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => synchronize("system");
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [mode, synchronize]);
  const setMode = useCallback((nextMode: ThemeMode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    setModeState(nextMode);
  }, []);
  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme, setMode],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return value;
}

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

export function ThemeSettings() {
  const { mode, setMode } = useTheme();
  return (
    <div
      className="grid gap-3 sm:grid-cols-3"
      role="radiogroup"
      aria-label="外观主题"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <BareButton
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`flex min-h-20 items-center gap-3 rounded-lg border px-4 text-left ${
              active
                ? "border-brand bg-brand-soft text-brand-strong shadow-control"
                : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-raised"
            }`}
            onClick={() => setMode(option.value)}
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-md ${
                active ? "bg-surface/70" : "bg-surface-muted"
              }`}
            >
              <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <span>
              <span className="block text-sm font-semibold">
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {option.value === "system"
                  ? "随系统自动切换"
                  : option.value === "light"
                    ? "适合明亮环境"
                    : "适合低光环境"}
              </span>
            </span>
          </BareButton>
        );
      })}
    </div>
  );
}
