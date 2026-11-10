/**
 * Tag's palette as CSS text. CSS Modules resolve to class-name maps in the
 * component suites, so a tone whose rule is missing renders on the inherited
 * color and `tag.client.spec.tsx` — which asserts the `data-tone` attribute —
 * still passes. Only the stylesheet can prove each tone paints something.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Tag.module.css', import.meta.url)), 'utf8')

const TONES = ['outline', 'solid', 'neutral', 'quiet', 'success', 'info', 'warning', 'danger'] as const

function declarations(tone: string): string {
  const rule = new RegExp(`\\.tag\\[data-tone='${tone}'\\]\\s*\\{([^}]*)\\}`).exec(css)
  if (rule === null) throw new Error(`Tag.module.css has no rule for the \`${tone}\` tone`)
  return rule[1] ?? ''
}

describe('Tag.module.css', () => {
  it.each(TONES)('gives the %s tone a rule that paints', (tone) => {
    expect(declarations(tone)).toMatch(/color:|background:|border:/)
  })

  it('uses the reference status surfaces in both appearances', () => {
    const surfaces = {
      success: '--dsw-alias-state-success-tertiary',
      info: '--dsw-alias-state-business-tertiary',
      warning: '--dsw-alias-state-warn-tertiary',
      danger: '--danger-soft',
    }
    for (const [tone, token] of Object.entries(surfaces)) {
      expect(declarations(tone)).toContain(`background: var(${token})`)
    }
  })

  it('keeps the reference badge geometry on the base rule, not per tone', () => {
    const base = /^\.tag \{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(base).toContain('border-radius: var(--dsw-radius-tag)')
    expect(base).toContain('padding: 1px 8px')
    for (const tone of TONES) expect(declarations(tone)).not.toContain('border-radius')
  })
})
