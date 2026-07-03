import {
  parseSceneStructureSnapshot,
  parseShotStructureSnapshot,
  renderSceneStructureSnapshot,
  renderShotStructureSnapshot,
  snapshotScene,
  snapshotShot,
  type ContentVersion,
  type Scene,
  type Script,
  type ShotStructureSnapshot,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'

export type ContentVersionRestoreResult = { ok: boolean; error?: string; result?: ContentVersion }

export function isStructureSnapshot(version: ContentVersion, kind: 'script_scenes' | 'scene_shots'): boolean {
  return version.meta?.structureSnapshot === kind
}

export function restoreScriptScenesSnapshot(
  repos: Repositories,
  version: ContentVersion,
  script: Script,
): ContentVersionRestoreResult {
  const scenes = parseSceneStructureSnapshot(version.meta?.scenes)
  if (!scenes) return { ok: false, error: '场景结构快照已损坏，无法恢复' }

  const beforeScenes = snapshotScenesForScript(repos, script.id)
  const before = repos.creative.createContentVersion(repos.db, {
    projectId: version.projectId,
    targetKind: 'script',
    targetId: script.id,
    label: `恢复前场景结构：${script.title}`,
    source: 'manual_checkpoint',
    content: renderSceneStructureSnapshot(beforeScenes),
    meta: {
      phase: 'before_structure_restore',
      structureSnapshot: 'script_scenes',
      restoreFromVersionId: version.id,
      scenes: beforeScenes,
    },
  })

  repos.scene.deleteScenesByScript(repos.db, script.id)
  for (const [index, item] of scenes.entries()) {
    const scene = repos.scene.createScene(repos.db, {
      scriptId: script.id,
      episodeId: script.episodeId,
      sceneNumber: item.sceneNumber || index + 1,
      title: item.title,
      location: item.location,
      timeOfDay: item.timeOfDay,
      visualDescription: item.visualDescription,
      characters: item.characters,
      summary: item.summary,
      orderIndex: item.orderIndex ?? index,
    })
    restoreShotsForScene(repos, scene, item.shots)
  }

  const restoredScenes = snapshotScenesForScript(repos, script.id)
  const restored = repos.creative.createContentVersion(repos.db, {
    projectId: version.projectId,
    targetKind: 'script',
    targetId: script.id,
    label: `恢复：${version.label}`,
    source: 'restore',
    content: renderSceneStructureSnapshot(restoredScenes),
    meta: {
      phase: 'after_structure_restore',
      structureSnapshot: 'script_scenes',
      restoreFromVersionId: version.id,
      beforeVersionId: before.id,
      scenes: restoredScenes,
    },
  })
  return { ok: true, result: restored }
}

export function restoreSceneShotsSnapshot(
  repos: Repositories,
  version: ContentVersion,
  scene: Scene,
): ContentVersionRestoreResult {
  const shots = parseShotStructureSnapshot(version.meta?.shots)
  if (!shots) return { ok: false, error: '镜头结构快照已损坏，无法恢复' }

  const beforeShots = snapshotShotsForScene(repos, scene.id)
  const before = repos.creative.createContentVersion(repos.db, {
    projectId: version.projectId,
    targetKind: 'scene',
    targetId: scene.id,
    label: `恢复前镜头结构：${scene.title}`,
    source: 'manual_checkpoint',
    content: renderShotStructureSnapshot(beforeShots),
    meta: {
      phase: 'before_structure_restore',
      structureSnapshot: 'scene_shots',
      restoreFromVersionId: version.id,
      shots: beforeShots,
    },
  })

  repos.shot.deleteShotsByScene(repos.db, scene.id)
  restoreShotsForScene(repos, scene, shots)

  const restoredShots = snapshotShotsForScene(repos, scene.id)
  const restored = repos.creative.createContentVersion(repos.db, {
    projectId: version.projectId,
    targetKind: 'scene',
    targetId: scene.id,
    label: `恢复：${version.label}`,
    source: 'restore',
    content: renderShotStructureSnapshot(restoredShots),
    meta: {
      phase: 'after_structure_restore',
      structureSnapshot: 'scene_shots',
      restoreFromVersionId: version.id,
      beforeVersionId: before.id,
      shots: restoredShots,
    },
  })
  return { ok: true, result: restored }
}

function snapshotScenesForScript(repos: Repositories, scriptId: string) {
  return repos.scene.listScenesByScript(repos.db, scriptId).map((scene) =>
    snapshotScene(scene, repos.shot.listShotsByScene(repos.db, scene.id)),
  )
}

function snapshotShotsForScene(repos: Repositories, sceneId: string) {
  return repos.shot.listShotsByScene(repos.db, sceneId).map(snapshotShot)
}

function restoreShotsForScene(repos: Repositories, scene: Scene, shots: ShotStructureSnapshot[]): void {
  shots.forEach((shot, index) => {
    repos.shot.createShot(repos.db, {
      sceneId: scene.id,
      episodeId: scene.episodeId,
      shotNumber: shot.shotNumber || index + 1,
      durationSeconds: shot.durationSeconds,
      visualDescription: shot.visualDescription,
      characterIds: shot.characterIds,
      dialogue: shot.dialogue,
      narration: shot.narration,
      cameraAngle: shot.cameraAngle,
      cameraMovement: shot.cameraMovement,
      emotion: shot.emotion,
      action: shot.action,
      videoPrompt: shot.videoPrompt,
      negativePrompt: shot.negativePrompt,
      imagePrompt: shot.imagePrompt,
      consistencyNotes: shot.consistencyNotes,
      aiVideoDifficulty: shot.aiVideoDifficulty,
    })
  })
}
