import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectPackage } from '../packages/export/src/project-package'
import {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  parseProjectPackage,
  previewProjectPackage,
  serializeProjectPackage,
} from '../packages/export/src/project-package'

function minimalPackage(): ProjectPackage {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    meta: {
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      exportedAt: now,
      sourceTitle: 'Demo Project',
    },
    project: {
      id: 'p1',
      title: 'Demo Project',
      shortDramaType: 'revenge',
      createdAt: now,
      updatedAt: now,
    },
    characters: [{ id: 'char1', projectId: 'p1', name: 'Lead', role: 'protagonist' }],
    outlines: [],
    projectSkills: [
      {
        id: 'skill1',
        projectId: 'p1',
        name: '节奏规范',
        category: 'genre_pacing',
        taskTypes: ['generate_chapter'],
        content: '每章有压迫、反制和悬念。',
        priority: 10,
        enabled: true,
      },
    ],
    projectAgentSchemes: [
      {
        id: 'scheme1',
        projectId: 'p1',
        name: '短剧审稿方案',
        primaryAgentId: 'agent-chief',
        agentIds: ['agent-chief', 'agent-visual'],
        skillIds: ['skill1'],
        modelBindings: { writing_room: 'model-fast' },
        active: true,
      },
    ],
    inspirationFavorites: [
      {
        id: 'fav1',
        projectId: 'p1',
        cardKey: 'genre:preset:opening:1',
        sourceKind: 'genre_preset',
        sourceId: 'genre1',
        kind: 'opening',
        title: '强钩子开局',
        pattern: '女主第一幕就被迫公开反击。',
        applyTo: '第一章钩子',
      },
    ],
    chapters: [{ id: 'c1', projectId: 'p1', title: 'Chapter 1', orderIndex: 0, content: '', createdAt: now, updatedAt: now }],
    evaluations: [],
    chapterMemories: [],
    characterStates: [],
    visualProfiles: [],
    visualSettings: [],
    storyEvents: [],
    foreshadowings: [],
    beats: [],
    highlightAnalyses: [],
    feasibilityReports: [],
    caseStudies: [],
    freshnessReports: [],
    antiTropeVariants: [],
    revisionTasks: [],
    contentVersions: [{ id: 'cv1', projectId: 'p1', targetKind: 'project', targetId: 'p1', label: 'v1', source: 'manual_checkpoint', content: '{}' }],
    qualityGateReports: [],
    audienceSimulations: [],
    narrativeCurveReports: [],
    workflowRuns: [],
    assets: [],
    adaptations: [
      {
        adaptation: { id: 'a1', sourceProjectId: 'p1', title: 'Demo Adaptation' },
        episodes: [{ id: 'e1', adaptationProjectId: 'a1' }],
        scripts: [{ script: { id: 's1', adaptationProjectId: 'a1', episodeId: 'e1' }, scenes: [{ id: 'sc1', scriptId: 's1' }], shots: [] }],
      },
    ],
    aiRuns: [{ id: 'run1', graphName: 'novel_workflow', type: 'generate_project', provider: 'mock', model: 'mock', input: '', output: '', status: 'success' }],
  } as ProjectPackage
}

test('serializes and parses a project package roundtrip', () => {
  const pkg = minimalPackage()
  const parsed = parseProjectPackage(serializeProjectPackage(pkg))

  assert.equal(parsed.meta.format, PACKAGE_FORMAT)
  assert.equal(parsed.meta.version, PACKAGE_VERSION)
  assert.equal(parsed.project.title, 'Demo Project')
  assert.equal(parsed.characters.length, 1)
  assert.equal(parsed.projectSkills.length, 1)
  assert.equal(parsed.projectAgentSchemes.length, 1)
  assert.equal(parsed.inspirationFavorites.length, 1)
  assert.deepEqual(parsed.assets, [])
  assert.equal(parsed.adaptations[0].scripts[0].scenes.length, 1)
  assert.deepEqual(parsed.adaptations[0].scripts[0].shots, [])
})

test('serializes video preproduction asset manifests', () => {
  const pkg = minimalPackage()
  pkg.visualProfiles = [
    {
      id: 'vp1',
      projectId: 'p1',
      characterId: 'char1',
      appearancePrompt: '黑色风衣，冷白皮，雨夜反光。',
      castingPrompt: '25-30 岁，清冷克制，眼神有压迫感。',
      actorReferenceUrl: 'https://asset.example.test/cast.png',
      voiceTone: '低频、克制、尾音短。',
      voiceSampleUrl: 'https://asset.example.test/voice.mp3',
      createdAt: pkg.meta.exportedAt,
      updatedAt: pkg.meta.exportedAt,
    },
  ]
  pkg.assets = [
    {
      id: 'asset-cast',
      projectId: 'p1',
      kind: 'casting_reference',
      title: '女主选角参考',
      sourceEntityKind: 'visual_profile',
      sourceEntityId: 'vp1',
      remoteUrl: 'https://asset.example.test/cast.png',
      mimeType: 'image/png',
      tags: ['选角参考'],
      metadata: { characterId: 'char1' },
      status: 'remote_only',
      packagePolicy: 'reference_only',
      createdAt: pkg.meta.exportedAt,
      updatedAt: pkg.meta.exportedAt,
    },
    {
      id: 'asset-first-frame',
      projectId: 'p1',
      kind: 'first_frame_image',
      title: '镜头首帧',
      sourceEntityKind: 'shot',
      sourceEntityId: 'shot1',
      remoteUrl: 'https://asset.example.test/first-frame.png',
      mimeType: 'image/png',
      tags: ['首帧图'],
      metadata: { sceneId: 'sc1' },
      status: 'remote_only',
      packagePolicy: 'reference_only',
      createdAt: pkg.meta.exportedAt,
      updatedAt: pkg.meta.exportedAt,
    },
    {
      id: 'asset-subtitle',
      projectId: 'p1',
      kind: 'subtitle_file',
      title: '镜头字幕',
      sourceEntityKind: 'shot',
      sourceEntityId: 'shot1',
      remoteUrl: 'https://asset.example.test/subtitle.srt',
      mimeType: 'application/x-subrip',
      tags: ['字幕文件'],
      metadata: { sceneId: 'sc1' },
      status: 'remote_only',
      packagePolicy: 'reference_only',
      createdAt: pkg.meta.exportedAt,
      updatedAt: pkg.meta.exportedAt,
    },
  ]
  pkg.adaptations[0].scripts[0].shots = [
    {
      id: 'shot1',
      sceneId: 'sc1',
      episodeId: 'e1',
      shotNumber: 1,
      visualDescription: '雨夜门口，女主抬眼。',
      characterIds: ['char1'],
      videoPrompt: '',
      createdAt: pkg.meta.exportedAt,
      updatedAt: pkg.meta.exportedAt,
    },
  ]

  const serialized = serializeProjectPackage(pkg)
  const parsed = parseProjectPackage(serialized)
  const preview = previewProjectPackage(serialized)

  assert.equal(parsed.meta.version, PACKAGE_VERSION)
  assert.equal(parsed.visualProfiles[0].castingPrompt, '25-30 岁，清冷克制，眼神有压迫感。')
  assert.equal(parsed.visualProfiles[0].voiceTone, '低频、克制、尾音短。')
  assert.equal(parsed.adaptations[0].scripts[0].shots[0].id, 'shot1')
  assert.equal(parsed.assets.map((asset) => asset.kind).join(','), 'casting_reference,first_frame_image,subtitle_file')
  assert.equal(preview.counts.shots, 1)
  assert.equal(preview.counts.assets, 3)
})

test('previews project package version, title, and data scale', () => {
  const preview = previewProjectPackage(serializeProjectPackage(minimalPackage()))

  assert.equal(preview.version, PACKAGE_VERSION)
  assert.equal(preview.projectTitle, 'Demo Project')
  assert.equal(preview.counts.characters, 1)
  assert.equal(preview.counts.chapters, 1)
  assert.equal(preview.counts.projectSkills, 1)
  assert.equal(preview.counts.projectAgentSchemes, 1)
  assert.equal(preview.counts.inspirationFavorites, 1)
  assert.equal(preview.counts.adaptations, 1)
  assert.equal(preview.counts.episodes, 1)
  assert.equal(preview.counts.scripts, 1)
  assert.equal(preview.counts.scenes, 1)
  assert.equal(preview.counts.shots, 0)
  assert.equal(preview.counts.contentVersions, 1)
  assert.equal(preview.counts.assets, 0)
  assert.equal(preview.counts.aiRuns, 1)
  assert.equal(preview.counts.totalRecords, 12)
})

test('rejects malformed, invalid, and newer project packages clearly', () => {
  assert.throws(() => parseProjectPackage('{bad json'), /项目包 JSON 解析失败/)
  assert.throws(() => parseProjectPackage(JSON.stringify({ meta: { format: 'other' } })), /格式标识不匹配/)

  const missingTitle = minimalPackage()
  delete (missingTitle.project as { title?: string }).title
  assert.throws(() => parseProjectPackage(JSON.stringify(missingTitle)), /项目包结构校验失败：project.title/)

  const newer = minimalPackage()
  newer.meta.version = PACKAGE_VERSION + 1
  assert.throws(() => parseProjectPackage(JSON.stringify(newer)), /高于本程序支持版本/)
})
