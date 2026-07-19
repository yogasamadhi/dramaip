export const WORKSPACE_SHELL_STORAGE_KEY = 'sdns-workspace-shell-v1'

export type WorkspacePanel = 'context' | 'inspector'
export type ContextPanelMode = 'full' | 'compact' | 'hidden'

export interface WorkspaceShellPreferences {
  contextWidth: number
  inspectorWidth: number
  contextCollapsed: boolean
  inspectorCollapsed: boolean
  focusMode: boolean
}

export interface WorkspaceShellLayout {
  contextMode: ContextPanelMode
  inspectorVisible: boolean
}

export const DEFAULT_WORKSPACE_SHELL_PREFERENCES: WorkspaceShellPreferences = {
  contextWidth: 232,
  inspectorWidth: 320,
  contextCollapsed: false,
  inspectorCollapsed: false,
  focusMode: false,
}

const MIN_CONTEXT_WIDTH = 200
const MAX_CONTEXT_WIDTH = 360
const MIN_INSPECTOR_WIDTH = 280
const MAX_INSPECTOR_WIDTH = 440

export function clampWorkspacePanelWidth(panel: WorkspacePanel, width: number): number {
  const [min, max] = panel === 'context'
    ? [MIN_CONTEXT_WIDTH, MAX_CONTEXT_WIDTH]
    : [MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH]
  return Math.min(max, Math.max(min, Math.round(width)))
}

export function normalizeWorkspaceShellPreferences(value: unknown): WorkspaceShellPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_WORKSPACE_SHELL_PREFERENCES
  const candidate = value as Partial<WorkspaceShellPreferences>
  return {
    contextWidth: clampWorkspacePanelWidth('context', Number(candidate.contextWidth) || DEFAULT_WORKSPACE_SHELL_PREFERENCES.contextWidth),
    inspectorWidth: clampWorkspacePanelWidth('inspector', Number(candidate.inspectorWidth) || DEFAULT_WORKSPACE_SHELL_PREFERENCES.inspectorWidth),
    contextCollapsed: candidate.contextCollapsed === true,
    inspectorCollapsed: candidate.inspectorCollapsed === true,
    focusMode: candidate.focusMode === true,
  }
}

export function workspaceShellLayout(
  preferences: WorkspaceShellPreferences,
  viewportWidth: number,
): WorkspaceShellLayout {
  if (preferences.focusMode) return { contextMode: 'hidden', inspectorVisible: false }
  return {
    contextMode: preferences.contextCollapsed
      ? 'hidden'
      : viewportWidth < 1050
        ? 'compact'
        : 'full',
    inspectorVisible: !preferences.inspectorCollapsed && viewportWidth >= 1180,
  }
}
