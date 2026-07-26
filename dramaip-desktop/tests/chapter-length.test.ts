import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHAPTER_WORD_GOAL_TOLERANCE,
  chapterLengthError,
  chapterLengthPlan,
  chapterLengthRange,
  chapterLengthRetryError,
  chapterOutputTokenLimit,
  chapterRewriteLengthGuidance,
  countChapterCharacters,
} from '../packages/ai/src/chapter-length'

test('enforces the generated chapter range as the selected goal plus or minus 300 characters', () => {
  assert.equal(CHAPTER_WORD_GOAL_TOLERANCE, 300)
  assert.deepEqual(chapterLengthRange(), { target: 2000, minimum: 1700, maximum: 2300 })
  assert.deepEqual(chapterLengthRange(2600), { target: 2600, minimum: 2300, maximum: 2900 })
  assert.equal(countChapterCharacters('甲 乙\n丙'), 3)
  assert.match(chapterLengthError('甲'.repeat(1699)) ?? '', /下限 1700 字/)
  assert.equal(chapterLengthError('甲'.repeat(1700)), undefined)
  assert.equal(chapterLengthError('甲'.repeat(2300)), undefined)
  assert.match(chapterLengthError('甲'.repeat(2301)) ?? '', /上限 2300 字/)
  assert.equal(chapterLengthError('甲'.repeat(2300), 2600), undefined)
  assert.equal(chapterLengthError('甲'.repeat(2900), 2600), undefined)
  assert.match(chapterLengthError('甲'.repeat(2901), 2600) ?? '', /上限 2900 字/)
})

test('biases the first draft below the target and derives a bounded token guard', () => {
  assert.deepEqual(chapterLengthPlan(2000), {
    target: 2000,
    minimum: 1700,
    maximum: 2300,
    preferredMinimum: 1750,
    preferredTarget: 1825,
    preferredMaximum: 1900,
  })
  assert.equal(chapterOutputTokenLimit(2000), 3732)
  assert.equal(chapterOutputTokenLimit(100_000), 8192)
})

test('builds measured net-change guidance for full-chapter editing tasks', () => {
  const plan = chapterLengthPlan(2000)
  const compress = chapterRewriteLengthGuidance(
    2600,
    plan.preferredMinimum,
    plan.preferredTarget,
    plan.preferredMaximum,
  )
  assert.match(compress, /当前待改正文实测 2600 字/)
  assert.match(compress, /至少删去 700 字/)
  assert.match(compress, /不能只加不减/)

  const stable = chapterRewriteLengthGuidance(
    1800,
    plan.preferredMinimum,
    plan.preferredTarget,
    plan.preferredMaximum,
  )
  assert.match(stable, /采用等量替换/)
})

test('retries only the first out-of-range chapter result so the UI keeps its fallback', () => {
  assert.match(
    chapterLengthRetryError('甲'.repeat(2400), 2000, 0) ?? '',
    /超过目标 2000 字允许的上限 2300 字/,
  )
  assert.equal(chapterLengthRetryError('乙'.repeat(2350), 2000, 1), undefined)
})
