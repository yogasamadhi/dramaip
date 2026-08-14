import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUILT_IN_COMPLIANCE_RULE_PROFILES, evaluateCompliancePreflight, type ComplianceRuleProfile } from '../packages/core/src'

function profile(overrides: Partial<ComplianceRuleProfile> = {}): ComplianceRuleProfile {
  return {
    ...BUILT_IN_COMPLIANCE_RULE_PROFILES[0],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function validInput() {
  return {
    profile: profile(),
    targetPlatform: '抖音',
    targetRegion: '中国大陆',
    deliveryDate: '2026-07-23',
    title: '重生之千金归来',
    subtitleLanguage: 'zh-CN',
    aigcDeclared: true,
    manualContentReviewConfirmed: true,
    rightsStatus: 'pass' as const,
    qualityReportCurrent: true,
    qualityBlockerCount: 0,
  }
}

test('official verified profile produces required visible and hidden AIGC markers', () => {
  const result = evaluateCompliancePreflight(validInput())
  assert.equal(result.ok, true)
  assert.equal(result.visibleLabel, 'AI Generated')
  assert.equal(result.metadata['sdns:aigc'], 'true')
  assert.equal(result.metadata['sdns:rule-profile'], 'cn-aigc-identification/2025-09-01')
  assert.equal(result.metadata['sdns:subtitle-language'], 'zh-CN')
})

test('consultation, missing declaration, stale QC, and missing rights cannot silently pass delivery', () => {
  const result = evaluateCompliancePreflight({
    ...validInput(),
    profile: profile({ ...BUILT_IN_COMPLIANCE_RULE_PROFILES[1], createdAt: '', updatedAt: '' }),
    aigcDeclared: false,
    manualContentReviewConfirmed: false,
    rightsStatus: 'blocked',
    qualityReportCurrent: false,
    qualityBlockerCount: 2,
  })
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((blocker) => blocker.includes('不是正式规则')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('明确声明')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('人工内容复核')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('版权与授权')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('媒体质检报告')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('2 个 blocker')))
})

test('unchecked rule pack fails closed even when the production inputs are otherwise ready', () => {
  const result = evaluateCompliancePreflight({ ...validInput(), profile: profile({ integrityStatus: 'unchecked' }) })
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((blocker) => blocker.includes('完整性校验')))
})
