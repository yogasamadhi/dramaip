import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TASK_WRITE_POLICIES,
  parseSceneStructureSnapshot,
  renderSceneStructureSnapshot,
  type ContentVersion,
} from '@sdns/core'
import { createSaveResultNode } from '../packages/ai/src/nodes/save-result.node'
import { restoreSceneShotsSnapshot, restoreScriptScenesSnapshot } from '../apps/desktop/electron/structure-snapshot-restore'

function createStructureDeps() {
  const calls: string[] = []
  const versions: Array<Partial<ContentVersion> & { meta?: Record<string, unknown> }> = []
  const existingScene = {
    id: 'scene-old',
    scriptId: 'script-1',
    episodeId: 'episode-1',
    sceneNumber: 1,
    title: '旧场景',
    location: '客厅',
    characters: ['A'],
    summary: '旧摘要',
    orderIndex: 0,
    createdAt: '',
    updatedAt: '',
  }
  const existingShot = {
    id: 'shot-old',
    sceneId: 'scene-old',
    episodeId: 'episode-1',
    shotNumber: 1,
    visualDescription: '旧镜头',
    characterIds: ['A'],
    videoPrompt: '旧 prompt',
    createdAt: '',
    updatedAt: '',
  }

  return {
    calls,
    versions,
    deps: {
      repos: {
        db: {},
        scene: {
          listScenesByScript: () => [existingScene],
          deleteScenesByScript: (_db: unknown, scriptId: string) => calls.push(`delete-scenes:${scriptId}`),
          createScene: (_db: unknown, data: { title: string }) => {
            calls.push(`create-scene:${data.title}`)
            return { id: 'scene-new', ...data }
          },
        },
        shot: {
          listShotsByScene: () => [existingShot],
          deleteShotsByScene: (_db: unknown, sceneId: string) => calls.push(`delete-shots:${sceneId}`),
          createShot: (_db: unknown, data: { visualDescription: string }) => {
            calls.push(`create-shot:${data.visualDescription}`)
            return { id: 'shot-new', ...data }
          },
        },
        creative: {
          createContentVersion: (_db: unknown, data: Partial<ContentVersion> & { meta?: Record<string, unknown> }) => {
            versions.push(data)
            calls.push(`version:${data.targetKind}:${data.targetId}:${data.meta?.structureSnapshot}`)
            return { id: `cv-${versions.length}`, ...data }
          },
        },
      },
    } as never,
  }
}

test('marks structure replacement tasks as snapshot-before-write', () => {
  assert.equal(TASK_WRITE_POLICIES.split_script_to_scenes.policy, 'snapshot_then_auto_write')
  assert.equal(TASK_WRITE_POLICIES.split_scene_to_shots.policy, 'snapshot_then_auto_write')
})

test('parses and renders structure snapshots for reviewable checkpoints', () => {
  const scenes = parseSceneStructureSnapshot([
    {
      sceneNumber: 1,
      title: '雨夜对峙',
      location: '巷口',
      summary: '主角逼问真相',
      orderIndex: 0,
      shots: [{ shotNumber: 1, visualDescription: '近景逼视', characterIds: ['主角'] }],
    },
  ])

  assert.ok(scenes)
  assert.equal(scenes[0].shots[0].visualDescription, '近景逼视')
  assert.match(renderSceneStructureSnapshot(scenes), /雨夜对峙/)
  assert.match(renderSceneStructureSnapshot(scenes), /1 个镜头/)
})

test('creates a scene structure checkpoint before replacing script scenes', async () => {
  const { deps, calls, versions } = createStructureDeps()
  const save = createSaveResultNode(deps)

  await save({
    projectId: 'project-1',
    adaptationProjectId: 'adaptation-1',
    episodeId: 'episode-1',
    taskType: 'split_script_to_scenes',
    currentScript: { id: 'script-1', episodeId: 'episode-1', title: '第一集' },
    parsedOutput: [
      {
        title: '新场景',
        location: '公司',
        characters: ['B'],
        summary: '新摘要',
      },
    ],
  } as never)

  assert.deepEqual(calls.slice(0, 3), [
    'version:script:script-1:script_scenes',
    'delete-scenes:script-1',
    'create-scene:新场景',
  ])
  assert.equal(versions[0].source, 'manual_checkpoint')
  assert.equal(versions[0].meta?.sceneCount, 1)
  assert.equal((versions[0].meta?.scenes as Array<{ shots: Array<{ videoPrompt: string }> }>)[0].shots[0].videoPrompt, '旧 prompt')
})

test('creates a shot structure checkpoint before replacing scene shots', async () => {
  const { deps, calls, versions } = createStructureDeps()
  const save = createSaveResultNode(deps)

  await save({
    projectId: 'project-1',
    adaptationProjectId: 'adaptation-1',
    episodeId: 'episode-1',
    sceneId: 'scene-old',
    taskType: 'split_scene_to_shots',
    currentScene: { id: 'scene-old', episodeId: 'episode-1', title: '旧场景' },
    parsedOutput: [
      {
        visualDescription: '新镜头',
        characterIds: ['B'],
      },
    ],
  } as never)

  assert.deepEqual(calls.slice(0, 3), [
    'version:scene:scene-old:scene_shots',
    'delete-shots:scene-old',
    'create-shot:新镜头',
  ])
  assert.equal(versions[0].source, 'manual_checkpoint')
  assert.equal(versions[0].meta?.shotCount, 1)
  assert.equal((versions[0].meta?.shots as Array<{ videoPrompt: string }>)[0].videoPrompt, '旧 prompt')
})

test('restores script scene snapshots by rebuilding scenes and nested shots', () => {
  const calls: string[] = []
  const versions: Array<Partial<ContentVersion> & { meta?: Record<string, unknown> }> = []
  let scenes = [
    {
      id: 'scene-current',
      scriptId: 'script-1',
      episodeId: 'episode-1',
      sceneNumber: 1,
      title: '当前场景',
      location: '当前地点',
      characters: [],
      summary: '当前摘要',
      orderIndex: 0,
      createdAt: '',
      updatedAt: '',
    },
  ]
  let shots = [
    {
      id: 'shot-current',
      sceneId: 'scene-current',
      episodeId: 'episode-1',
      shotNumber: 1,
      visualDescription: '当前镜头',
      characterIds: [],
      videoPrompt: '',
      createdAt: '',
      updatedAt: '',
    },
  ]
  const repos = {
    db: {},
    scene: {
      listScenesByScript: () => scenes,
      deleteScenesByScript: () => {
        calls.push('delete-scenes')
        scenes = []
        shots = []
      },
      createScene: (_db: unknown, data: Record<string, unknown>) => {
        const scene = { id: `scene-${scenes.length + 1}`, createdAt: '', updatedAt: '', ...data } as never
        scenes.push(scene)
        calls.push(`create-scene:${data.title}`)
        return scene
      },
    },
    shot: {
      listShotsByScene: (_db: unknown, sceneId: string) => shots.filter((shot) => shot.sceneId === sceneId),
      createShot: (_db: unknown, data: Record<string, unknown>) => {
        const shot = { id: `shot-${shots.length + 1}`, createdAt: '', updatedAt: '', ...data } as never
        shots.push(shot)
        calls.push(`create-shot:${data.visualDescription}`)
        return shot
      },
    },
    creative: {
      createContentVersion: (_db: unknown, data: Partial<ContentVersion> & { meta?: Record<string, unknown> }) => {
        const version = { id: `cv-${versions.length + 1}`, ...data }
        versions.push(version)
        calls.push(`version:${data.source}:${data.meta?.phase}`)
        return version
      },
    },
  } as never

  const result = restoreScriptScenesSnapshot(repos, {
    id: 'cv-source',
    targetKind: 'script',
    targetId: 'script-1',
    label: '场景结构检查点',
    source: 'manual_checkpoint',
    content: '',
    createdAt: '',
    meta: {
      structureSnapshot: 'script_scenes',
      scenes: [
        {
          sceneNumber: 1,
          title: '恢复场景',
          location: '巷口',
          summary: '恢复摘要',
          orderIndex: 0,
          shots: [{ shotNumber: 1, visualDescription: '恢复镜头', characterIds: ['主角'], videoPrompt: '恢复 prompt' }],
        },
      ],
    },
  } as ContentVersion, {
    id: 'script-1',
    adaptationProjectId: 'adaptation-1',
    episodeId: 'episode-1',
    episodeNumber: 1,
    title: '第一集',
    content: '剧本',
    createdAt: '',
    updatedAt: '',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.slice(0, 4), [
    'version:manual_checkpoint:before_structure_restore',
    'delete-scenes',
    'create-scene:恢复场景',
    'create-shot:恢复镜头',
  ])
  assert.equal(versions.at(-1)?.source, 'restore')
  assert.equal(shots[0].videoPrompt, '恢复 prompt')
})

test('restores scene shot snapshots by rebuilding the shot list', () => {
  const calls: string[] = []
  const versions: Array<Partial<ContentVersion> & { meta?: Record<string, unknown> }> = []
  let shots = [
    {
      id: 'shot-current',
      sceneId: 'scene-1',
      episodeId: 'episode-1',
      shotNumber: 1,
      visualDescription: '当前镜头',
      characterIds: [],
      videoPrompt: '',
      createdAt: '',
      updatedAt: '',
    },
  ]
  const repos = {
    db: {},
    shot: {
      listShotsByScene: () => shots,
      deleteShotsByScene: () => {
        calls.push('delete-shots')
        shots = []
      },
      createShot: (_db: unknown, data: Record<string, unknown>) => {
        const shot = { id: `shot-${shots.length + 1}`, createdAt: '', updatedAt: '', ...data } as never
        shots.push(shot)
        calls.push(`create-shot:${data.visualDescription}`)
        return shot
      },
    },
    creative: {
      createContentVersion: (_db: unknown, data: Partial<ContentVersion> & { meta?: Record<string, unknown> }) => {
        const version = { id: `cv-${versions.length + 1}`, ...data }
        versions.push(version)
        calls.push(`version:${data.source}:${data.meta?.phase}`)
        return version
      },
    },
  } as never

  const result = restoreSceneShotsSnapshot(repos, {
    id: 'cv-source',
    targetKind: 'scene',
    targetId: 'scene-1',
    label: '镜头结构检查点',
    source: 'manual_checkpoint',
    content: '',
    createdAt: '',
    meta: {
      structureSnapshot: 'scene_shots',
      shots: [{ shotNumber: 1, visualDescription: '恢复镜头', characterIds: ['主角'], videoPrompt: '恢复 prompt' }],
    },
  } as ContentVersion, {
    id: 'scene-1',
    scriptId: 'script-1',
    episodeId: 'episode-1',
    sceneNumber: 1,
    title: '场景',
    location: '巷口',
    characters: [],
    summary: '',
    orderIndex: 0,
    createdAt: '',
    updatedAt: '',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.slice(0, 3), [
    'version:manual_checkpoint:before_structure_restore',
    'delete-shots',
    'create-shot:恢复镜头',
  ])
  assert.equal(versions.at(-1)?.source, 'restore')
  assert.equal(shots[0].videoPrompt, '恢复 prompt')
})
