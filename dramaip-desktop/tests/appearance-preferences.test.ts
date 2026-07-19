import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  nextExplicitTheme,
  parseEditorFont,
  parseThemePreference,
  parseUiDensity,
  resolveThemePreference,
} from '../apps/desktop/renderer/src/lib/appearance'

test('appearance preferences accept only supported persisted values', () => {
  assert.equal(parseThemePreference('light'), 'light')
  assert.equal(parseThemePreference('dark'), 'dark')
  assert.equal(parseThemePreference('system'), 'system')
  assert.equal(parseThemePreference('sepia'), null)
  assert.equal(parseThemePreference(null), null)

  assert.equal(parseUiDensity('comfortable'), 'comfortable')
  assert.equal(parseUiDensity('compact'), 'compact')
  assert.equal(parseUiDensity('dense'), null)

  assert.equal(parseEditorFont('serif'), 'serif')
  assert.equal(parseEditorFont('sans'), 'sans')
  assert.equal(parseEditorFont('mono'), 'mono')
  assert.equal(parseEditorFont('comic'), null)
})

test('system preference resolves without mutating its persisted intent', () => {
  assert.equal(resolveThemePreference('system', 'light'), 'light')
  assert.equal(resolveThemePreference('system', 'dark'), 'dark')
  assert.equal(resolveThemePreference('light', 'dark'), 'light')
  assert.equal(resolveThemePreference('dark', 'light'), 'dark')
  assert.equal(nextExplicitTheme('light'), 'dark')
  assert.equal(nextExplicitTheme('dark'), 'light')
})
