import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, Character, Project, ProjectSkill, StoryArc } from '@sdns/core'
import { selectProjectSkillsForTask } from '@sdns/core'
import { applyContextControls } from '../packages/ai/src/context/context-controls'
import { buildChapterContext } from '../packages/ai/src/context/context-builder'
import { buildAiPreflightContext } from '../apps/desktop/renderer/src/lib/aiPreflightContext'

test('applies context controls by excluding ids and moving pinned ids first', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const controlled = applyContextControls(items, 'chapters', {
    pinned: { chapters: ['c'] },
    excluded: { chapters: ['b'] },
  })

  assert.deepEqual(controlled.map((item) => item.id), ['c', 'a'])
})

test('preflight preview exposes pinned and excluded context choices', () => {
  const preview = buildAiPreflightContext('rewrite_chapter', {
    project: { id: 'p1', title: '短剧小说', shortDramaType: '复仇', createdAt: '', updatedAt: '' } as Project,
    chapters: [
      { id: 'c1', projectId: 'p1', title: '第一章', orderIndex: 0, content: '开局正文', createdAt: '', updatedAt: '' },
      { id: 'c2', projectId: 'p1', title: '第二章', orderIndex: 1, content: '后续正文', createdAt: '', updatedAt: '' },
    ] as Chapter[],
    characters: [
      { id: 'char1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' },
      { id: 'char2', projectId: 'p1', name: '反派', role: '反派', createdAt: '', updatedAt: '' },
    ] as Character[],
    storyArcs: [
      {
        id: 'arc1',
        projectId: 'p1',
        kind: 'unit',
        title: '宴会反击单元',
        targetChapterCount: 8,
        chapterStart: 1,
        chapterEnd: 8,
        coreConflict: '宴会羞辱与公开反制',
        keyHighlights: [],
        foreshadowingPayoffs: [],
        orderIndex: 0,
        createdAt: '',
        updatedAt: '',
      },
    ] as StoryArc[],
    projectSkills: [
      {
        id: 'skill1',
        projectId: 'p1',
        name: '复仇爽文节奏',
        category: 'genre_pacing',
        taskTypes: ['rewrite_chapter'],
        content: '每次改写都保留压迫、反制、追看钩子。',
        priority: 10,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'skill2',
        projectId: 'p1',
        name: '镜头 Prompt 规则',
        category: 'shot_prompt',
        taskTypes: ['generate_shot_prompt'],
        content: 'Prompt 必须包含主体、景别、动作和光线。',
        priority: 1,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      },
    ] as ProjectSkill[],
    caseStudies: [],
    visualProfiles: [],
  }, {
    pinned: { chapters: ['c2'], projectSkills: ['skill2'] },
    excluded: { characters: ['char2'] },
  })

  assert.match(preview.preview.sections[0]?.excerpt ?? '', /固定章节：1 项/)
  assert.match(preview.preview.sections[0]?.excerpt ?? '', /排除人物：1 项/)
  assert.match(preview.preview.sections.find((section) => section.title === '章节上下文')?.excerpt ?? '', /第二章/)
  assert.doesNotMatch(preview.preview.sections.find((section) => section.title === '人物上下文')?.excerpt ?? '', /反派/)
  assert.match(preview.preview.sections.find((section) => section.title === '长篇规划')?.excerpt ?? '', /宴会反击单元/)
  assert.match(preview.preview.sections.find((section) => section.title === '项目创作规范')?.excerpt ?? '', /复仇爽文节奏/)
  assert.match(preview.preview.sections.find((section) => section.title === '项目创作规范')?.excerpt ?? '', /镜头 Prompt 规则/)
  assert.equal(preview.groups.find((group) => group.key === 'chapters')?.items.find((item) => item.id === 'c2')?.mode, 'pinned')
  assert.equal(preview.groups.find((group) => group.key === 'projectSkills')?.items.find((item) => item.id === 'skill2')?.mode, 'pinned')
})

test('selects project skills by task and manual pins', () => {
  const skills = [
    {
      id: 'writing',
      projectId: 'p1',
      name: '写作规范',
      category: 'style',
      taskTypes: ['generate_chapter'],
      content: '短句、强冲突。',
      priority: 2,
      enabled: true,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '',
    },
    {
      id: 'shot',
      projectId: 'p1',
      name: '镜头规范',
      category: 'shot_prompt',
      taskTypes: ['generate_shot_prompt'],
      content: '镜头要可视化。',
      priority: 10,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '',
    },
    {
      id: 'disabled',
      projectId: 'p1',
      name: '停用规范',
      category: 'custom',
      taskTypes: [],
      content: '不应进入上下文。',
      priority: 99,
      enabled: false,
      createdAt: '',
      updatedAt: '',
    },
  ] as ProjectSkill[]

  const selected = selectProjectSkillsForTask(skills, 'generate_chapter', {
    pinned: { projectSkills: ['shot', 'disabled'] },
  })

  assert.deepEqual(selected.map((skill) => skill.id), ['shot', 'writing'])
})

test('chapter context renders selected project skills', () => {
  const context = buildChapterContext({
    project: { id: 'p1', title: '短剧小说', shortDramaType: '复仇', createdAt: '', updatedAt: '' } as Project,
    projectSkills: [
      {
        id: 'skill1',
        projectId: 'p1',
        name: '人物对白规范',
        category: 'dialogue',
        taskTypes: ['generate_chapter'],
        content: '对白短、狠、带潜台词。',
        priority: 5,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      },
    ] as ProjectSkill[],
  })

  assert.match(context, /项目创作规范/)
  assert.match(context, /人物对白规范/)
  assert.match(context, /对白短、狠、带潜台词/)
})
