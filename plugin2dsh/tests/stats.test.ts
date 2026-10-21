import assert from 'node:assert/strict'
import { test } from 'node:test'
import { textStats } from '../src/shared/stats.ts'

test('counts CJK text, dialogue and paragraphs', () => {
  const text = '林夏推开门。\n“你来晚了。”他说。\n\n「对不起。」\n'
  assert.deepEqual(textStats(text), {
    characters: 22,
    cjkCharacters: 14,
    latinWords: 0,
    paragraphs: 2,
    dialogueLines: 2,
    readingMinutes: 1,
  })
})

test('counts Latin words and estimates reading time', () => {
  const words = Array.from({ length: 450 }, (_, index) => `word${index}`).join(' ')
  const stats = textStats(`INT. KITCHEN - NIGHT\n\n"It's late," she said.\n\n${words}`)
  assert.equal(stats.latinWords, 3 + 4 + 450)
  assert.equal(stats.dialogueLines, 1)
  assert.equal(stats.paragraphs, 3)
  assert.equal(stats.readingMinutes, 3)
})

test('empty and whitespace-only text measure zero', () => {
  for (const text of ['', ' \n\r\n\t']) {
    assert.deepEqual(textStats(text), {
      characters: 0, cjkCharacters: 0, latinWords: 0, paragraphs: 0, dialogueLines: 0, readingMinutes: 0,
    })
  }
})
