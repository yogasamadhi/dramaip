import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAiBudgetBeforeCall } from '../packages/ai/src/budget'

function repos(settings: Record<string, unknown>, todayTokens = 0, todayCost = 0) {
  return {
    db: {},
    aiBudget: {
      getAiBudgetSettings: () => ({
        id: 'global',
        costPer1kTokens: 0,
        currency: 'USD',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...settings,
      }),
    },
    aiRun: {
      summarizeAiRunUsage: () => [
        {
          taskGroup: 'writing',
          taskGroupLabel: '小说写作',
          model: 'mock',
          provider: 'mock',
          successCount: 1,
          failedCount: 0,
          totalTokens: todayTokens,
          totalLatencyMs: 0,
          estimatedCost: todayCost,
        },
      ],
    },
  } as never
}

test('AI budget check blocks a single run before provider call', () => {
  const result = checkAiBudgetBeforeCall(repos({ singleRunTokenLimit: 10 }), 'x'.repeat(200))
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /单次上限/)
})

test('AI budget check includes daily token and cost limits', () => {
  const dailyToken = checkAiBudgetBeforeCall(repos({ dailyTokenLimit: 100 }, 90), 'x'.repeat(40))
  assert.equal(dailyToken.ok, false)
  assert.match(dailyToken.error ?? '', /每日上限/)

  const dailyCost = checkAiBudgetBeforeCall(repos({ dailyCostLimit: 0.01, costPer1kTokens: 0.5 }, 0, 0.009), 'x'.repeat(20))
  assert.equal(dailyCost.ok, false)
  assert.match(dailyCost.error ?? '', /费用/)
})
