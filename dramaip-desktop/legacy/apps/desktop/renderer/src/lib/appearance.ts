export const APPEARANCE_STORAGE_KEYS = {
  theme: 'sdns-ui-theme-preference',
  legacyTheme: 'sdns-ui-theme',
  density: 'sdns-ui-density',
  editorFont: 'sdns-editor-font',
} as const

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>
export type UiDensity = 'comfortable' | 'compact'
export type EditorFont = 'sans' | 'serif' | 'mono'

export function parseThemePreference(value: string | null | undefined): ThemePreference | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

export function parseUiDensity(value: string | null | undefined): UiDensity | null {
  return value === 'comfortable' || value === 'compact' ? value : null
}

export function parseEditorFont(value: string | null | undefined): EditorFont | null {
  return value === 'sans' || value === 'serif' || value === 'mono' ? value : null
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference
}

export function nextExplicitTheme(theme: ResolvedTheme): ResolvedTheme {
  return theme === 'dark' ? 'light' : 'dark'
}
