import type { Repositories } from '@sdns/db'
import { estimateContextTokens } from './context/context-builder'

export interface AiBudgetCheckResult {
  ok: boolean
  error?: string
  estimatedTokens: number
  estimatedCost: number
}

export function checkAiBudgetBeforeCall(repos: Repositories, promptText: string): AiBudgetCheckResult {
  const settings = repos.aiBudget.getAiBudgetSettings(repos.db)
  const estimatedTokens = estimateContextTokens(promptText)
  const estimatedCost = estimateCost(estimatedTokens, settings.costPer1kTokens)
  const todayUsage = repos.aiRun.summarizeAiRunUsage(repos.db, {
    since: startOfTodayIso(),
    costPer1kTokens: settings.costPer1kTokens,
  })
  const todayTokens = todayUsage.reduce((sum, row) => sum + row.totalTokens, 0)
  const todayCost = todayUsage.reduce((sum, row) => sum + row.estimatedCost, 0)

  if (settings.singleRunTokenLimit && estimatedTokens > settings.singleRunTokenLimit) {
    return blocked(`本次预计 ${estimatedTokens} tokens，超过单次上限 ${settings.singleRunTokenLimit} tokens`, estimatedTokens, estimatedCost)
  }
  if (settings.dailyTokenLimit && todayTokens + estimatedTokens > settings.dailyTokenLimit) {
    return blocked(`今日已用 ${todayTokens} tokens，本次预计 ${estimatedTokens} tokens，超过每日上限 ${settings.dailyTokenLimit} tokens`, estimatedTokens, estimatedCost)
  }
  if (settings.singleRunCostLimit && estimatedCost > settings.singleRunCostLimit) {
    return blocked(`本次预计费用 ${formatCost(estimatedCost, settings.currency)}，超过单次上限 ${formatCost(settings.singleRunCostLimit, settings.currency)}`, estimatedTokens, estimatedCost)
  }
  if (settings.dailyCostLimit && todayCost + estimatedCost > settings.dailyCostLimit) {
    return blocked(
      `今日费用已估算 ${formatCost(todayCost, settings.currency)}，本次预计费用 ${formatCost(estimatedCost, settings.currency)}，超过每日上限 ${formatCost(settings.dailyCostLimit, settings.currency)}`,
      estimatedTokens,
      estimatedCost,
    )
  }
  return { ok: true, estimatedTokens, estimatedCost }
}

function blocked(message: string, estimatedTokens: number, estimatedCost: number): AiBudgetCheckResult {
  return { ok: false, error: `预算提醒：${message}`, estimatedTokens, estimatedCost }
}

function estimateCost(tokens: number, costPer1kTokens: number): number {
  return (tokens / 1000) * Math.max(0, costPer1kTokens)
}

function formatCost(value: number, currency: string): string {
  return `${value.toFixed(4)} ${currency}`
}

function startOfTodayIso(): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}
