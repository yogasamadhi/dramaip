import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCaseStudyChapters } from '../apps/desktop/electron/case-study-import'

test('splits Chinese chapter headings into ordered sample chapters', () => {
  const parsed = parseCaseStudyChapters(
    [
      '第一章 重生归来',
      '女主醒来后发现自己回到了三年前。',
      '',
      '第二章 旧局重开',
      '她决定先保住母亲留下的公司。',
    ].join('\n'),
    '重生样本.txt',
  )

  assert.equal(parsed.chapters.length, 2)
  assert.equal(parsed.chapters[0].orderIndex, 0)
  assert.equal(parsed.chapters[0].title, '第一章 重生归来')
  assert.equal(parsed.chapters[1].title, '第二章 旧局重开')
  assert.equal(parsed.chapters[0].status, 'parsed')
})

test('supports markdown and English chapter headings', () => {
  const parsed = parseCaseStudyChapters(
    [
      '# Chapter 1: Cold Open',
      'The protagonist loses the deal before the title card.',
      '',
      '## 第2章 反击',
      '对手设局失败，主角拿回节奏。',
    ].join('\n'),
    'mixed.md',
  )

  assert.equal(parsed.chapters.length, 2)
  assert.equal(parsed.chapters[0].title, 'Chapter 1: Cold Open')
  assert.equal(parsed.chapters[1].title, '第2章 反击')
})

test('falls back to a reviewable single chapter when no heading is found', () => {
  const parsed = parseCaseStudyChapters('只有一段样本文本，没有任何章节标题。', '无章节.docx')

  assert.equal(parsed.chapters.length, 1)
  assert.equal(parsed.chapters[0].title, '无章节')
  assert.equal(parsed.chapters[0].status, 'needs_review')
  assert.match(parsed.warnings.join('\n'), /未识别到章节标题/)
})
