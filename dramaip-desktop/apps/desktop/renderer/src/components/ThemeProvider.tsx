import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  APPEARANCE_STORAGE_KEYS,
  nextExplicitTheme,
  parseEditorFont,
  parseThemePreference,
  parseUiDensity,
  resolveThemePreference,
  type EditorFont,
  type ResolvedTheme,
  type ThemePreference,
  type UiDensity,
} from '@/lib/appearance'

export type { EditorFont, ResolvedTheme, ThemePreference, UiDensity } from '@/lib/appearance'

type ThemeContextValue = {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  density: UiDensity
  editorFont: EditorFont
  setTheme: (theme: ThemePreference) => void
  setDensity: (density: UiDensity) => void
  setEditorFont: (font: EditorFont) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    return (
      parseThemePreference(window.localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme)) ??
      parseThemePreference(window.localStorage.getItem(APPEARANCE_STORAGE_KEYS.legacyTheme)) ??
      'system'
    )
  } catch {
    return 'system'
  }
}

function readStoredDensity(): UiDensity {
  if (typeof window === 'undefined') return 'comfortable'
  try {
    return parseUiDensity(window.localStorage.getItem(APPEARANCE_STORAGE_KEYS.density)) ?? 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function readStoredEditorFont(): EditorFont {
  if (typeof window === 'undefined') return 'sans'
  try {
    return parseEditorFont(window.localStorage.getItem(APPEARANCE_STORAGE_KEYS.editorFont)) ?? 'sans'
  } catch {
    return 'sans'
  }
}

function applyAppearance({
  resolvedTheme,
  theme,
  density,
  editorFont,
}: {
  resolvedTheme: ResolvedTheme
  theme: ThemePreference
  density: UiDensity
  editorFont: EditorFont
}): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = theme
  root.dataset.density = density
  root.dataset.editorFont = editorFont
  root.style.colorScheme = resolvedTheme
}

function persistPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme)
  const [density, setDensityState] = useState<UiDensity>(readStoredDensity)
  const [editorFont, setEditorFontState] = useState<EditorFont>(readStoredEditorFont)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)
  const resolvedTheme = resolveThemePreference(theme, systemTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handleSystemThemeChange)
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange)
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEYS.theme || event.key === APPEARANCE_STORAGE_KEYS.legacyTheme) {
        const nextTheme = parseThemePreference(event.newValue)
        if (nextTheme) setThemeState(nextTheme)
      }
      if (event.key === APPEARANCE_STORAGE_KEYS.density) {
        const nextDensity = parseUiDensity(event.newValue)
        if (nextDensity) setDensityState(nextDensity)
      }
      if (event.key === APPEARANCE_STORAGE_KEYS.editorFont) {
        const nextEditorFont = parseEditorFont(event.newValue)
        if (nextEditorFont) setEditorFontState(nextEditorFont)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    applyAppearance({ resolvedTheme, theme, density, editorFont })
    persistPreference(APPEARANCE_STORAGE_KEYS.theme, theme)
  }, [density, editorFont, resolvedTheme, theme])

  useEffect(() => {
    persistPreference(APPEARANCE_STORAGE_KEYS.density, density)
  }, [density])

  useEffect(() => {
    persistPreference(APPEARANCE_STORAGE_KEYS.editorFont, editorFont)
  }, [editorFont])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      density,
      editorFont,
      setTheme: setThemeState,
      setDensity: setDensityState,
      setEditorFont: setEditorFontState,
      toggleTheme: () => setThemeState(nextExplicitTheme(resolvedTheme)),
    }),
    [density, editorFont, resolvedTheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
