import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHAPTER_WORD_GOAL_TOLERANCE, chapterLengthError, chapterLengthRange, countChapterCharacters } from '../packages/ai/src/chapter-length'

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
