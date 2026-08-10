// CSV 导出（PROJECT_BRIEF.md §15）—— 镜头 Prompt 表格化导出，便于导入视频平台批量生成
import type { Shot } from '@sdns/core'

/** RFC4180 风格字段转义：含逗号/引号/换行的字段用双引号包裹，内部双引号转义为两个双引号 */
function csvField(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

const COLUMNS = [
  'shotNumber',
  'durationSeconds',
  'visualDescription',
  'characterIds',
  'cameraAngle',
  'cameraMovement',
  'emotion',
  'action',
  'dialogue',
  'narration',
  'videoPrompt',
  'negativePrompt',
  'imagePrompt',
  'consistencyNotes',
  'aiVideoDifficulty',
] as const

/** 导出某场景下全部镜头为 CSV（含表头） */
export function exportShotsCsv(shots: Shot[]): string {
  const header = COLUMNS.join(',')
  const rows = shots.map((s) =>
    [
      s.shotNumber,
      s.durationSeconds ?? '',
      s.visualDescription,
      s.characterIds.join(' / '),
      s.cameraAngle ?? '',
      s.cameraMovement ?? '',
      s.emotion ?? '',
      s.action ?? '',
      s.dialogue ?? '',
      s.narration ?? '',
      s.videoPrompt,
      s.negativePrompt ?? '',
      s.imagePrompt ?? '',
      s.consistencyNotes ?? '',
      s.aiVideoDifficulty ?? '',
    ]
      .map(csvField)
      .join(','),
  )
  return [header, ...rows].join('\n') + '\n'
}
