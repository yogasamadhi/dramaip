import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InspirationSchemesResultSchema, type Chapter, type Project } from '../packages/core/src'
import {
  buildInspirationSchemeInstruction,
  buildSchemeRewriteInstruction,
  normalizeInspirationSchemeForm,
  schemeToProjectSeed,
} from '../apps/desktop/renderer/src/lib/inspirationSchemes'

const now = '2026-01-01T00:00:00.000Z'

const project: Project = {
  id: 'p1',
  title: '原项目',
  shortDramaType: '女频复仇',
  targetAudience: '18-35 岁女性短剧用户',
  coreSellingPoint: '公开反击、身份反转',
  createdAt: now,
  updatedAt: now,
}

const [scheme] = InspirationSchemesResultSchema.parse({
  schemes: [
    {
      title: '婚礼夺回人生',
      genre: '女频复仇',
      targetAudience: '18-35 岁女性短剧用户',
      shortDramaDirection: '强压迫后公开反击',
      differentiation: '把身份夺回放在第一集',
      coreHook: '她重回婚礼现场，当众夺回被偷走的人生。',
      premise: '女主被假千金夺走身份后重生回订婚宴。',
      emotionalCore: '从被替代到自我确认',
      protagonist: '冷静克制的真千金',
      relationship: '真假千金互为镜像',
      conflictMechanism: '公开证据和家族利益正面碰撞',
      openingHook: '婚礼大屏突然播放亲子鉴定。',
      keyReversal: '男主不是救赎者，而是当年证据保管人。',
      cliffhanger: '女主说出下一份证据时，父亲突然昏倒。',
      visualSellingPoint: '豪门宴会、证据投屏、近景反应切换。',
      chapterRewriteBrief: '把章节改成婚礼现场公开反击，结尾留父亲昏倒尾钩。',
      projectSeed: '真千金重生回婚礼，用证据夺回身份并反查旧案。',
      riskNotes: ['避免照搬真假千金套路'],
    },
    {
      title: '直播间审判',
      coreHook: '她把豪门审判搬进直播间。',
      premise: '女主被全网误解后设计一场公开自证。',
      conflictMechanism: '舆论压力与证据链递进',
      openingHook: '直播一开，黑粉先刷满弹幕。',
      keyReversal: '最大黑粉是女主安排的证人。',
      cliffhanger: '账号背后 IP 指向男主公司。',
      visualSellingPoint: '弹幕、手机屏、豪门客厅对切。',
      chapterRewriteBrief: '把章节改成直播自证结构。',
    },
    {
      title: '遗嘱反杀',
      coreHook: '她在葬礼上公布第二份遗嘱。',
      premise: '女主被赶出家门后带律师回到葬礼。',
      conflictMechanism: '继承权、亲情绑架和法律证据',
      openingHook: '葬礼上全家逼她签放弃书。',
      keyReversal: '遗嘱真正继承人不是女主，而是她的公司。',
      cliffhanger: '律师递出第三份密封文件。',
      visualSellingPoint: '黑白葬礼、文件特写、沉默对峙。',
      chapterRewriteBrief: '把章节改成葬礼遗嘱反杀。',
    },
  ],
}).schemes

test('builds generation instructions with project fallbacks', () => {
  const form = normalizeInspirationSchemeForm({ genre: '', targetAudience: '', shortDramaDirection: '' }, project)
  assert.equal(form.genre, '女频复仇')
  assert.equal(form.targetAudience, '18-35 岁女性短剧用户')

  const instruction = buildInspirationSchemeInstruction(form)
  assert.match(instruction, /女频复仇/)
  assert.match(instruction, /3-5/)
})

test('converts inspiration schemes to project seeds and rewrite instructions', () => {
  const seed = schemeToProjectSeed(scheme, {
    genre: project.shortDramaType,
    targetAudience: project.targetAudience ?? '',
    shortDramaDirection: project.coreSellingPoint ?? '',
  })
  assert.equal(seed.title, '婚礼夺回人生')
  assert.equal(seed.type, '女频复仇')
  assert.match(seed.idea, /证据投屏/)

  const chapter: Chapter = {
    id: 'c1',
    projectId: 'p1',
    title: '第一章',
    orderIndex: 0,
    content: '旧正文',
    createdAt: now,
    updatedAt: now,
  }
  const rewrite = buildSchemeRewriteInstruction(scheme, chapter)
  assert.match(rewrite, /第一章/)
  assert.match(rewrite, /婚礼现场公开反击/)
  assert.match(rewrite, /输出完整改写正文/)
})
