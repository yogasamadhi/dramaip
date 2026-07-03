import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMobileInspirationImport } from '../packages/core/src/mobile-inspiration'

test('parses mobile inspiration JSON into favorite inputs', () => {
  const content = JSON.stringify({
    items: [
      {
        title: '婚礼现场反杀',
        kind: 'opening',
        pattern: '女主在被退婚时公开关键证据，第一屏先给全场静默。',
        applyTo: '第一章钩子 / 第一集开场',
        risk: '证据链不要堆太满',
      },
    ],
  })

  const result = parseMobileInspirationImport({
    projectId: 'project-1',
    fileName: 'phone-ideas.json',
    content,
  })
  const again = parseMobileInspirationImport({
    projectId: 'project-1',
    fileName: 'phone-ideas.json',
    content,
  })

  assert.equal(result.items.length, 1)
  assert.equal(result.skipped, 0)
  assert.equal(result.items[0].sourceKind, 'mobile_import')
  assert.equal(result.items[0].sourceId, 'mobile:phone-ideas.json')
  assert.equal(result.items[0].kind, 'opening')
  assert.match(result.items[0].cardKey, /^mobile_import:/)
  assert.equal(result.items[0].cardKey, again.items[0].cardKey)
})

test('parses mobile inspiration Markdown headings and dividers', () => {
  const result = parseMobileInspirationImport({
    projectId: 'project-1',
    fileName: '随手记.md',
    content: `
## 雨夜车窗倒影
类型：视频画面卖点
模式：男主只在车窗倒影中露出半张脸，观众先看到戒指再看到人。
可用于：封面首帧 / 分镜 Prompt

---

## 门外人听到秘密
类型：集尾悬念
模式：女主刚说出亲子鉴定结果，门外出现另一个鞋尖。
风险提示：避免靠误会拖延太久
`,
  })

  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].kind, 'visual')
  assert.equal(result.items[0].applyTo, '封面首帧 / 分镜 Prompt')
  assert.equal(result.items[1].kind, 'cliffhanger')
  assert.equal(result.items[1].risk, '避免靠误会拖延太久')
})

test('deduplicates identical mobile inspiration records in one import', () => {
  const result = parseMobileInspirationImport({
    projectId: 'project-1',
    content: JSON.stringify({
      items: [
        { title: '公开反击', kind: 'conflict', pattern: '证据投屏后立刻反杀。' },
        { title: '公开反击', kind: 'conflict', pattern: '证据投屏后立刻反杀。' },
      ],
    }),
  })

  assert.equal(result.items.length, 1)
  assert.equal(result.skipped, 1)
})
