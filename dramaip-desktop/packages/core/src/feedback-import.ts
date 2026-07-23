import type { FeedbackCommentDraft, FeedbackImportKind, FeedbackImportPreview, FeedbackMetricDraft, FeedbackTarget } from './types'

const METRIC_FIELDS: Array<[key: string, label: string, definition: string, aliases: string[]]> = [
  ['plays', '播放量', '源文件中的累计播放次数；不同平台口径可能不同，不能自动换算。', ['plays', 'play_count', 'views', '播放', '播放量']],
  ['completion_rate', '完播率', '源文件中的完播比例；只与同口径、同时间窗的数据比较。', ['completion_rate', 'completion', '完播率']],
  ['average_watch_seconds', '平均观看时长', '源文件中的平均观看时长（秒）；不自动推断留存曲线。', ['average_watch_seconds', 'avg_watch_seconds', 'average_duration', '平均观看时长', '停留时长']],
  ['likes', '点赞', '源文件中的点赞计数；不作为内容因果结论。', ['likes', 'like_count', '点赞']],
  ['comments', '评论数', '源文件中的评论计数；原始评论需单独导入并按隐私策略保存。', ['comments', 'comment_count', '评论数']],
  ['shares', '分享', '源文件中的分享计数；不自动归因给标题、封面或剧情。', ['shares', 'share_count', '分享']],
]

const TARGET_KINDS = new Set(['project', 'chapter', 'episode', 'scene', 'shot'])

export function parseFeedbackImport(input: { kind: FeedbackImportKind; sourceName: string; content: string; platform?: string; sourceVersion?: string }): FeedbackImportPreview {
  const sourceName = input.sourceName.trim() || '未命名导入'
  const parsed = parseRows(input.content)
  const platform = input.platform?.trim() || stringAt(parsed.meta, ['platform', '平台']) || stringAt(parsed.rows[0], ['platform', '平台']) || '未标注平台'
  const sourceVersion = input.sourceVersion?.trim() || stringAt(parsed.meta, ['source_version', 'version', '版本'])
  const preview: FeedbackImportPreview = {
    kind: input.kind, sourceName, platform, sourceVersion,
    timeWindowStart: stringAt(parsed.meta, ['time_window_start', 'start_at', '开始时间']),
    timeWindowEnd: stringAt(parsed.meta, ['time_window_end', 'end_at', '结束时间']),
    metrics: [], comments: [], skippedRows: [], notices: [],
  }
  for (const [index, row] of parsed.rows.entries()) {
    if (input.kind === 'metrics') {
      const metrics = metricsFromRow(row, platform, sourceVersion)
      if (!metrics.length) preview.skippedRows.push({ row: index + 1, reason: '未识别到可解析的数值指标。' })
      preview.metrics.push(...metrics)
    } else {
      const comment = commentFromRow(row, platform, sourceVersion)
      if (!comment) preview.skippedRows.push({ row: index + 1, reason: '缺少评论文本。' })
      else preview.comments.push(comment)
    }
  }
  if (input.kind === 'metrics') preview.notices.push('指标保留各自平台、版本、时间窗和口径；界面不会把不同平台数据合成为单一热度。')
  else preview.notices.push('评论默认仅本地保存；任何聚类结果均为可删除派生记录，原文不会被自动发送给外部服务。')
  if (preview.skippedRows.length) preview.notices.push(`已跳过 ${preview.skippedRows.length} 行不可用数据。`)
  return dedupePreview(preview)
}

function parseRows(content: string): { rows: Array<Record<string, unknown>>; meta: Record<string, unknown> } {
  const trimmed = content.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { rows: [], meta: {} }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value = JSON.parse(trimmed) as unknown
      if (Array.isArray(value)) return { rows: value.filter(isRecord), meta: {} }
      if (isRecord(value)) {
        const records = Array.isArray(value.records) ? value.records : Array.isArray(value.metrics) ? value.metrics : Array.isArray(value.comments) ? value.comments : []
        return { rows: records.filter(isRecord), meta: value }
      }
    } catch { return { rows: [], meta: {} } }
    return { rows: [], meta: {} }
  }
  const cells = parseCsv(trimmed)
  const [headers = [], ...body] = cells
  return { rows: body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))), meta: {} }
}

function metricsFromRow(row: Record<string, unknown>, platform: string, sourceVersion?: string): FeedbackMetricDraft[] {
  const target = targetFromRow(row)
  const recordedAt = stringAt(row, ['recorded_at', 'date', '时间', '日期'])
  const variantKey = stringAt(row, ['variant_key', 'creative_variant', 'ab_variant', '投放版本', 'A/B版本'])
  const explicitKey = stringAt(row, ['metric_key', 'metric', '指标'])
  const explicitValue = numberAt(row, ['value', 'metric_value', '数值'])
  const denominator = numberAt(row, ['denominator', 'base', '分母'])
  if (explicitKey && explicitValue !== undefined) {
    const field = METRIC_FIELDS.find((item) => item[0] === normalize(explicitKey) || item[3].some((alias) => normalize(alias) === normalize(explicitKey)))
    return [{ ...target, platform: stringAt(row, ['platform', '平台']) || platform, sourceVersion, metricKey: field?.[0] ?? normalize(explicitKey), metricLabel: stringAt(row, ['metric_label', '指标名称']) || field?.[1] || explicitKey, definition: stringAt(row, ['definition', '口径']) || field?.[2] || '以源文件口径为准。', value: explicitValue, denominator, recordedAt, variantKey, rowFingerprint: fingerprint(row) }]
  }
  return METRIC_FIELDS.flatMap(([key, label, definition, aliases]) => {
    const value = numberAt(row, aliases)
    return value === undefined ? [] : [{ ...target, platform: stringAt(row, ['platform', '平台']) || platform, sourceVersion, metricKey: key, metricLabel: label, definition, value, denominator, recordedAt, variantKey, rowFingerprint: fingerprint({ ...row, metric: key }) }]
  })
}

function commentFromRow(row: Record<string, unknown>, platform: string, sourceVersion?: string): FeedbackCommentDraft | undefined {
  const text = stringAt(row, ['text', 'comment', 'content', '评论', '评论内容'])
  if (!text) return undefined
  const target = targetFromRow(row)
  return {
    ...target, platform: stringAt(row, ['platform', '平台']) || platform, sourceVersion,
    externalId: stringAt(row, ['external_id', 'comment_id', 'id', '评论ID']), authorAlias: stringAt(row, ['author', 'author_alias', '用户', '作者']),
    text: text.slice(0, 4_000), recordedAt: stringAt(row, ['recorded_at', 'created_at', 'date', '时间', '日期']), rowFingerprint: fingerprint(row),
  }
}

function targetFromRow(row: Record<string, unknown>): FeedbackTarget {
  const rawKind = normalize(stringAt(row, ['target_kind', 'target', '定位类型', '目标类型']) || 'project')
  const targetKind = TARGET_KINDS.has(rawKind) ? rawKind as FeedbackTarget['targetKind'] : 'project'
  const targetId = stringAt(row, ['target_id', 'chapter_id', 'episode_id', 'scene_id', 'shot_id', '定位ID', '目标ID'])
  return { targetKind, targetId: targetId || undefined }
}

function dedupePreview(preview: FeedbackImportPreview): FeedbackImportPreview {
  const seen = new Set<string>()
  const keep = <T extends { rowFingerprint: string }>(rows: T[]) => rows.filter((row) => {
    if (seen.has(row.rowFingerprint)) return false
    seen.add(row.rowFingerprint); return true
  })
  const metrics = keep(preview.metrics)
  const comments = keep(preview.comments)
  const duplicateCount = preview.metrics.length + preview.comments.length - metrics.length - comments.length
  return { ...preview, metrics, comments, notices: duplicateCount ? [...preview.notices, `文件内已去重 ${duplicateCount} 条重复记录。`] : preview.notices }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if (char === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(cell.trim()); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''
    } else cell += char
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row)
  return rows
}

function stringAt(row: Record<string, unknown> | undefined, aliases: string[]): string | undefined {
  if (!row) return undefined
  const entries = new Map(Object.entries(row).map(([key, value]) => [normalize(key), value]))
  for (const alias of aliases) {
    const value = entries.get(normalize(alias))
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

function numberAt(row: Record<string, unknown>, aliases: string[]): number | undefined {
  const value = stringAt(row, aliases)
  if (!value) return undefined
  const parsed = Number(value.replace(/[%％,，\s]/g, ''))
  if (!Number.isFinite(parsed)) return undefined
  return /[%％]/.test(value) ? parsed / 100 : parsed
}

function normalize(value: string): string { return value.trim().toLowerCase().replace(/[\s\-]/g, '_') }
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort())
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return `feedback-${(hash >>> 0).toString(16)}`
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
