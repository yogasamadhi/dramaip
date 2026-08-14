import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isProjectSetupComplete, type Project } from '@sdns/core'

const project = {
  id: 'project-1',
  title: '短剧小说',
  shortDramaType: '逆袭',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
} satisfies Project

test('project setup requires both a hook and a synopsis', () => {
  assert.equal(isProjectSetupComplete(project), false)
  assert.equal(isProjectSetupComplete({ ...project, coreHook: '主角在绝境中觉醒。' }), false)
  assert.equal(isProjectSetupComplete({ ...project, coreHook: '主角在绝境中觉醒。', synopsis: '一场持续反转的复仇故事。' }), true)
  assert.equal(isProjectSetupComplete({ ...project, coreHook: '  ', synopsis: '一场持续反转的复仇故事。' }), false)
})
