import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampWorkspacePanelWidth,
  normalizeWorkspaceShellPreferences,
  workspaceShellLayout,
} from '../apps/desktop/renderer/src/lib/workspaceShell'

test('workspace shell clamps persisted panel widths and ignores unsupported values', () => {
  assert.equal(clampWorkspacePanelWidth('context', 10), 200)
  assert.equal(clampWorkspacePanelWidth('context', 999), 360)
  assert.equal(clampWorkspacePanelWidth('inspector', 100), 280)
  assert.equal(clampWorkspacePanelWidth('inspector', 999), 440)

  assert.deepEqual(normalizeWorkspaceShellPreferences({
    contextWidth: 240,
    inspectorWidth: 333,
    contextCollapsed: true,
    inspectorCollapsed: false,
    focusMode: true,
  }), {
    contextWidth: 240,
    inspectorWidth: 333,
    contextCollapsed: true,
    inspectorCollapsed: false,
    focusMode: true,
  })
})

test('workspace shell responds to focus mode and narrow desktop breakpoints', () => {
  const defaults = normalizeWorkspaceShellPreferences(null)
  assert.deepEqual(workspaceShellLayout(defaults, 1320), { contextMode: 'full', inspectorVisible: true })
  assert.deepEqual(workspaceShellLayout(defaults, 1179), { contextMode: 'full', inspectorVisible: false })
  assert.deepEqual(workspaceShellLayout(defaults, 1049), { contextMode: 'compact', inspectorVisible: false })
  assert.deepEqual(workspaceShellLayout({ ...defaults, focusMode: true }, 1440), { contextMode: 'hidden', inspectorVisible: false })
})
