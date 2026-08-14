import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CreativeCaseStudy } from '@sdns/core'
import { CaseStructureResultSchema } from '../packages/core/src/schemas'
import { buildCreativeContext } from '../packages/ai/src/context/context-builder'

test('case structure schema accepts rhythm curves and reusable creative cards', () => {
  const parsed = CaseStructureResultSchema.parse({
    title: '重生复仇结构样本',
    relationshipPatterns: ['主角与旧盟友先误解后结盟'],
    openingHooks: ['开局用身份反差制造落差'],
    highlightBeats: ['弱势角色在公开场合反制'],
    reversalMechanisms: ['对手以为掌握证据，实际被反向取证'],
    cliffhangers: ['段尾抛出隐藏亲缘线索'],
    visualPatterns: ['高压谈判场景切近景'],
    rhythmCurve: [8, 6, 9, 5, 10],
    creativeCards: [
      {
        kind: 'hook',
        title: '身份落差开局',
        pattern: '先让主角处在被误判的位置，再用一个小动作暴露真实能力。',
        applyTo: '章节开头或第 1 集冷开场',
        risk: '不要复述样本具体桥段。',
      },
    ],
    riskTags: ['复仇动机需要新鲜化'],
  })

  assert.deepEqual(parsed.rhythmCurve, [8, 6, 9, 5, 10])
  assert.equal(parsed.creativeCards?.[0]?.title, '身份落差开局')
})

test('creative context includes sample cards and rhythm without source excerpts', () => {
  const context = buildCreativeContext({
    creativeCaseStudies: [
      {
        id: 'case-1',
        title: '样本 A',
        genre: '重生复仇',
        relationshipPatterns: [],
        openingHooks: ['身份误判'],
        highlightBeats: [],
        reversalMechanisms: [],
        cliffhangers: [],
        visualPatterns: [],
        rhythmCurve: [8, 4, 9],
        creativeCards: [
          {
            kind: 'hook',
            title: '身份落差开局',
            pattern: '抽象模式',
            applyTo: '章节开头',
          },
        ],
        riskTags: [],
        createdAt: '',
        updatedAt: '',
      } as CreativeCaseStudy,
    ],
  })

  assert.match(context, /节奏：8-4-9/)
  assert.match(context, /卡片：身份落差开局\/章节开头/)
  assert.doesNotMatch(context, /原文摘录/)
})
