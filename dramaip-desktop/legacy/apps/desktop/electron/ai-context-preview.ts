import type { AiContextPreview, AiContextPreviewSection, AiRun } from '@sdns/core'

const SAMPLE_DOCUMENT_PLACEHOLDER = '样本文档上传抽取'
const INPUT_MATERIAL_MARKER = '# 输入材料'
const INPUT_BOUNDARY = /\n# (本次指令|再次提醒)\n/
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***'],
  [/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***'],
  [/(api[-_]?key|authorization|token|secret|password)(\s*[=:：]\s*)\S+/gi, '$1$2***'],
]

export function createAiContextPreview(run: AiRun): AiContextPreview {
  const input = sanitizeModelText(run.input)
  const context = extractInputMaterial(input)
  const redacted = run.input.includes(SAMPLE_DOCUMENT_PLACEHOLDER)
  const source = context.trim() ? context : input
  const sections = splitSections(source).slice(0, 20)
  return {
    aiRunId: run.id,
    taskType: run.type,
    provider: run.provider,
    model: run.model,
    status: run.status,
    createdAt: run.createdAt,
    inputChars: input.length,
    estimatedInputTokens: estimateTokens(input),
    contextChars: context.length,
    estimatedContextTokens: estimateTokens(context),
    redacted,
    sections,
  }
}

export function createAiRunDebugPayload(run: AiRun): Record<string, unknown> {
  const preview = createAiContextPreview(run)
  return {
    exportedAt: new Date().toISOString(),
    aiRun: {
      id: run.id,
      projectId: run.projectId,
      chapterId: run.chapterId,
      graphName: run.graphName,
      type: run.type,
      provider: run.provider,
      model: run.model,
      status: run.status,
      errorMessage: run.errorMessage,
      tokenUsage: run.tokenUsage,
      latencyMs: run.latencyMs,
      createdAt: run.createdAt,
    },
    preview,
    modelInput: sanitizeModelText(run.input),
    modelOutput: sanitizeModelText(run.output),
  }
}

export function estimateTokens(text: string): number {
  if (!text.trim()) return 0
  return Math.ceil(text.replace(/\s+/g, ' ').length / 2)
}

function extractInputMaterial(input: string): string {
  const markerIndex = input.indexOf(INPUT_MATERIAL_MARKER)
  if (markerIndex < 0) return ''
  const afterMarker = input.slice(markerIndex + INPUT_MATERIAL_MARKER.length).trim()
  const boundary = afterMarker.search(INPUT_BOUNDARY)
  return (boundary >= 0 ? afterMarker.slice(0, boundary) : afterMarker).trim()
}

function splitSections(text: string): AiContextPreviewSection[] {
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)]
  if (!matches.length) return [section('模型输入', text)]

  const sections: AiContextPreviewSection[] = []
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const next = matches[i + 1]
    const start = (match.index ?? 0) + match[0].length
    const end = next?.index ?? text.length
    sections.push(section(match[1].trim(), text.slice(start, end)))
  }
  return sections.filter((item) => item.charCount > 0)
}

function section(title: string, body: string): AiContextPreviewSection {
  const normalized = body.trim()
  return {
    title,
    charCount: normalized.length,
    estimatedTokens: estimateTokens(normalized),
    excerpt: excerpt(normalized),
  }
}

function excerpt(value: string): string {
  const trimmed = value.replace(/\n{3,}/g, '\n\n').trim()
  return trimmed.length > 700 ? `${trimmed.slice(0, 700).trimEnd()}...` : trimmed
}

function sanitizeModelText(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}
