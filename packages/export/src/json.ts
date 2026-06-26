// JSON 导出（PROJECT_BRIEF.md §15）
import type { AdaptationProject, Episode, Evaluation, Scene, Script, Shot } from '@sdns/core'
import type { ProjectExportData } from './markdown'

export interface ProjectExportJson extends ProjectExportData {
  evaluations?: Evaluation[]
  exportedAt: string
}

export function exportProjectJson(data: ProjectExportData & { evaluations?: Evaluation[] }): string {
  const payload: ProjectExportJson = {
    project: data.project,
    characters: data.characters ?? [],
    outlines: data.outlines ?? [],
    chapters: data.chapters ?? [],
    evaluations: data.evaluations ?? [],
    exportedAt: new Date().toISOString(),
  }
  return JSON.stringify(payload, null, 2)
}

export function exportAdaptationJson(adaptation: AdaptationProject, episodes: Episode[]): string {
  return JSON.stringify(
    {
      adaptation,
      episodes,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

/** 导出单集剧本 JSON（剧本 + 场景清单） */
export function exportScriptJson(script: Script, scenes: Scene[]): string {
  return JSON.stringify(
    {
      script,
      scenes,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

/** 导出整本剧本 JSON */
export function exportScriptsJson(scripts: Script[]): string {
  return JSON.stringify(
    {
      scripts,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

/** v0.6：导出某场景下全部镜头 JSON */
export function exportShotsJson(sceneTitle: string, shots: Shot[]): string {
  return JSON.stringify(
    {
      sceneTitle,
      shots,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}
