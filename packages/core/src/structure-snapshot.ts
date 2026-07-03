import type { Scene, Shot } from './types'

export type StructureSnapshotKind = 'script_scenes' | 'scene_shots'

export interface ShotStructureSnapshot {
  shotNumber: number
  durationSeconds?: number
  visualDescription: string
  characterIds: string[]
  dialogue?: string
  narration?: string
  cameraAngle?: string
  cameraMovement?: string
  emotion?: string
  action?: string
  videoPrompt?: string
  negativePrompt?: string
  imagePrompt?: string
  consistencyNotes?: string
  aiVideoDifficulty?: Shot['aiVideoDifficulty']
}

export interface SceneStructureSnapshot {
  sceneNumber: number
  title: string
  location: string
  timeOfDay?: string
  visualDescription?: string
  characters: string[]
  summary: string
  orderIndex: number
  shots: ShotStructureSnapshot[]
}

export function snapshotShot(shot: Shot): ShotStructureSnapshot {
  return {
    shotNumber: shot.shotNumber,
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
  }
}

export function snapshotScene(scene: Scene, shots: Shot[] = []): SceneStructureSnapshot {
  return {
    sceneNumber: scene.sceneNumber,
    title: scene.title,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    visualDescription: scene.visualDescription,
    characters: scene.characters,
    summary: scene.summary,
    orderIndex: scene.orderIndex,
    shots: shots.map(snapshotShot),
  }
}

export function parseSceneStructureSnapshot(value: unknown): SceneStructureSnapshot[] | null {
  if (!Array.isArray(value)) return null
  return value.map((item, index) => {
    const record = asRecord(item)
    const shots = parseShotStructureSnapshot(record.shots) ?? []
    return {
      sceneNumber: asNumber(record.sceneNumber, index + 1),
      title: asString(record.title, `场景 ${index + 1}`),
      location: asString(record.location, ''),
      timeOfDay: optionalString(record.timeOfDay),
      visualDescription: optionalString(record.visualDescription),
      characters: asStringArray(record.characters),
      summary: asString(record.summary, ''),
      orderIndex: asNumber(record.orderIndex, index),
      shots,
    }
  })
}

export function parseShotStructureSnapshot(value: unknown): ShotStructureSnapshot[] | null {
  if (!Array.isArray(value)) return null
  return value.map((item, index) => {
    const record = asRecord(item)
    return {
      shotNumber: asNumber(record.shotNumber, index + 1),
      durationSeconds: optionalNumber(record.durationSeconds),
      visualDescription: asString(record.visualDescription, ''),
      characterIds: asStringArray(record.characterIds),
      dialogue: optionalString(record.dialogue),
      narration: optionalString(record.narration),
      cameraAngle: optionalString(record.cameraAngle),
      cameraMovement: optionalString(record.cameraMovement),
      emotion: optionalString(record.emotion),
      action: optionalString(record.action),
      videoPrompt: optionalString(record.videoPrompt),
      negativePrompt: optionalString(record.negativePrompt),
      imagePrompt: optionalString(record.imagePrompt),
      consistencyNotes: optionalString(record.consistencyNotes),
      aiVideoDifficulty: optionalDifficulty(record.aiVideoDifficulty),
    }
  })
}

export function renderSceneStructureSnapshot(scenes: readonly SceneStructureSnapshot[]): string {
  if (scenes.length === 0) return '（空场景列表）'
  return scenes
    .map((scene, index) => {
      const parts = [
        `场景 ${scene.sceneNumber || index + 1}｜${scene.title}`,
        scene.location,
        scene.timeOfDay,
        `${scene.shots.length} 个镜头`,
      ].filter(Boolean)
      const summary = scene.summary ? `\n${scene.summary}` : ''
      return `${parts.join(' · ')}${summary}`
    })
    .join('\n\n')
}

export function renderShotStructureSnapshot(shots: readonly ShotStructureSnapshot[]): string {
  if (shots.length === 0) return '（空镜头列表）'
  return shots
    .map((shot, index) => {
      const parts = [
        `镜头 ${shot.shotNumber || index + 1}`,
        shot.cameraAngle,
        shot.cameraMovement,
        shot.durationSeconds ? `${shot.durationSeconds}s` : undefined,
      ].filter(Boolean)
      const prompt = shot.videoPrompt ? `\nPrompt：${shot.videoPrompt}` : ''
      return `${parts.join(' · ')}\n${shot.visualDescription}${prompt}`
    })
    .join('\n\n')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function optionalDifficulty(value: unknown): Shot['aiVideoDifficulty'] | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}
