import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countChapterCharacters,
  getChapterLengthPlan,
  getChapterLengthStatus,
} from '../apps/desktop/renderer/src/lib/chapterLength'

test('renderer uses the same lower-biased first-draft window as the AI workflow', () => {
  assert.deepEqual(getChapterLengthPlan(2000), {
    target: 2000,
    minimum: 1700,
    maximum: 2300,
    preferredMinimum: 1750,
    preferredTarget: 1825,
    preferredMaximum: 1900,
  })
})

test('renderer reports only content outside the accepted goal range', () => {
  assert.equal(countChapterCharacters('甲 乙\n丙'), 3)
  assert.equal(getChapterLengthStatus('甲'.repeat(2300), 2000), undefined)
  assert.deepEqual(getChapterLengthStatus('甲'.repeat(2301), 2000), {
    count: 2301,
    target: 2000,
    minimum: 1700,
    maximum: 2300,
    direction: 'long',
  })
})
