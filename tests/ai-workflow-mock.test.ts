import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatInput, ChatOutput, LLMProvider, NovelTaskType, Project, StoryArc } from '@sdns/core'
import { GenerateProjectResultSchema, GenerateStoryArcOutlineResultSchema } from '@sdns/core'
import { applyGeneratedArtifact } from '../packages/ai/src/persistence'
import { createSaveAiRunNode } from '../packages/ai/src/nodes/save-ai-run.node'
import { extractJson } from '../packages/ai/src/parsers/json'

type AiRunRow = {
  status: 'success' | 'failed'
  type: string
  provider: string
  model: string
  input: string
  output: string
  errorMessage?: string
}

class SequenceProvider implements LLMProvider {
  readonly name = 'mock'
  readonly model = 'mock-workflow'
  readonly calls: ChatInput[] = []
  private index = 0

  constructor(private readonly responses: Array<string | Error>) {}

  async chat(input: ChatInput): Promise<ChatOutput> {
    this.calls.push(input)
    const response = this.responses[Math.min(this.index, this.responses.length - 1)]
    this.index += 1
    if (response instanceof Error) throw response
    return { content: response, tokenUsage: 11 }
  }
}

function projectPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Reborn Producer',
    coreHook: 'A fallen producer returns to build a hit short drama studio.',
    emotionalCore: 'Trust has to be rebuilt after betrayal.',
    coreSellingPoint: 'Fast reversals and visible production stakes.',
    synopsis: 'The protagonist uses future knowledge to turn a failing team into a viral studio.',
    styleGuide: 'Sharp, contemporary, emotional.',
    visualStyleDirection: 'Clean studio lighting with high contrast city nights.',
    targetEpisodeCount: 24,
    ...overrides,
  }
}

function jsonOutput(value: unknown): string {
  return JSON.stringify(value)
}

function createHarness() {
  const aiRuns: AiRunRow[] = []
  const contentVersions: Array<Record<string, unknown>> = []
  const projectUpdates: Array<Record<string, unknown>> = []
  const storyArcs: StoryArc[] = []
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
  const project: Project = {
    id: 'p1',
    title: 'Original Project',
    shortDramaType: 'revenge',
    createdAt: now,
    updatedAt: now,
  }

  const repos = {
    db: {},
    project: {
      getProject: (_db: unknown, id: string) => (id === project.id ? project : undefined),
      updateProject: (_db: unknown, id: string, patch: Record<string, unknown>) => {
        projectUpdates.push({ id, ...patch })
        return { ...project, ...patch, id }
      },
    },
    character: { listCharacters: () => [] },
    outline: { listOutlines: () => [] },
    storyArc: {
      listStoryArcs: () => storyArcs,
      createStoryArc: (_db: unknown, row: Partial<StoryArc> & { projectId: string; kind: StoryArc['kind']; title: string }) => {
        const arc: StoryArc = {
          id: `arc-${storyArcs.length + 1}`,
          projectId: row.projectId,
          parentId: row.parentId,
          kind: row.kind,
          title: row.title,
          summary: row.summary,
          targetWordCount: row.targetWordCount,
          targetChapterCount: row.targetChapterCount,
          chapterStart: row.chapterStart,
          chapterEnd: row.chapterEnd,
          coreConflict: row.coreConflict,
          keyHighlights: row.keyHighlights ?? [],
          foreshadowingPayoffs: row.foreshadowingPayoffs ?? [],
          orderIndex: row.orderIndex ?? storyArcs.length,
          createdAt: now,
          updatedAt: now,
        }
        storyArcs.push(arc)
        return arc
      },
    },
    chapter: { listChapters: () => [], getChapter: () => undefined },
    chapterMemory: { listChapterMemories: () => [] },
    characterState: { listCharacterStates: () => [] },
    visualProfile: { listVisualProfiles: () => [] },
    visualSetting: { listVisualSettings: () => [] },
    storyEvent: { listStoryEvents: () => [] },
    foreshadowing: { listForeshadowings: () => [] },
    evaluation: { listEvaluations: () => [] },
    beat: { listBeats: () => [] },
    highlight: { listHighlights: () => [] },
    feasibility: { listFeasibilityReports: () => [] },
    dramaTrend: { getDramaTrend: () => undefined },
    adaptationProject: { getAdaptationProject: () => undefined },
    episode: { listEpisodes: () => [], getEpisode: () => undefined },
    script: { listScripts: () => [], getScriptByEpisode: () => undefined },
    scene: { listScenesByScript: () => [], getScene: () => undefined },
    shot: { listShotsByScene: () => [], getShot: () => undefined },
    creative: {
      listCaseStudies: () => [],
      listFreshnessReports: () => [],
      listQualityGateReports: () => [],
      listRevisionTasks: () => [],
      listAudienceSimulations: () => [],
      listNarrativeCurveReports: () => [],
      createContentVersion: (_db: unknown, row: Record<string, unknown>) => {
        const version = { id: `cv-${contentVersions.length + 1}`, ...row }
        contentVersions.push(version)
        return version
      },
    },
    aiRun: {
      createAiRun: (_db: unknown, row: AiRunRow) => {
        aiRuns.push(row)
        return { id: `run-${aiRuns.length}`, ...row }
      },
    },
  } as never

  return { aiRuns, contentVersions, projectUpdates, repos, storyArcs }
}

async function runMockProjectWorkflow(input: {
  repos: never
  provider: LLMProvider
  projectId?: string
  taskType: NovelTaskType
  prompt: string
  responseFormat: 'json' | 'text'
}) {
  let prompt = input.prompt
  let retryCount = 0
  let rawOutput = ''
  let parsedOutput: unknown
  let error = ''
  let tokenUsage: number | undefined
  let latencyMs: number | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const startedAt = Date.now()
      const output = await input.provider.chat({
        messages: [
          { role: 'system', content: 'mock workflow' },
          { role: 'user', content: prompt },
        ],
        responseFormat: input.responseFormat,
      })
      rawOutput = output.content
      tokenUsage = output.tokenUsage
      latencyMs = Date.now() - startedAt

      if (input.responseFormat === 'json') {
        const parsed = extractJson(rawOutput)
        const result = GenerateProjectResultSchema.safeParse(parsed)
        if (!result.success) throw new Error(result.error.message)
        parsedOutput = result.data
        error = ''
      } else {
        const content = rawOutput.trim()
        if (!content) throw new Error('模型输出为空')
        parsedOutput = content
        error = ''
      }
      break
    } catch (e) {
      error = input.responseFormat === 'json'
        ? `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`
        : e instanceof Error ? e.message : String(e)
      if (attempt === 1) break
      retryCount += 1
      prompt = `${prompt}\n\n---\n【修复要求】上一次输出无法解析：${error}\n请严格按输出格式重新生成。`
    }
  }

  const save = createSaveAiRunNode({ repos: input.repos, provider: input.provider } as never)
  const saved = await save({
    projectId: input.projectId,
    taskType: input.taskType,
    promptText: prompt,
    rawOutput,
    parsedOutput,
    error,
    providerName: input.provider.name,
    modelName: input.provider.model,
    tokenUsage,
    latencyMs,
  } as never)

  return {
    ok: !error,
    error: error || undefined,
    result: error ? undefined : { kind: input.taskType, data: parsedOutput },
    aiRunId: saved.aiRunId,
    state: { retryCount },
  }
}

test('runs a successful JSON workflow with a mock provider', async () => {
  const { aiRuns, repos } = createHarness()
  const provider = new SequenceProvider([jsonOutput(projectPayload())])

  const result = await runMockProjectWorkflow({
    repos,
    provider,
    projectId: 'p1',
    taskType: 'generate_project',
    prompt: 'Build a commercial premise.',
    responseFormat: 'json',
  })

  assert.equal(result.ok, true)
  assert.equal(result.result?.kind, 'generate_project')
  assert.equal(result.aiRunId, 'run-1')
  assert.equal(provider.calls.length, 1)
  assert.equal(provider.calls[0].responseFormat, 'json')
  assert.equal(aiRuns[0].status, 'success')
  assert.equal(aiRuns[0].provider, 'mock')
  assert.equal(aiRuns[0].model, 'mock-workflow')
})

test('repairs invalid JSON once before saving a successful run', async () => {
  const { aiRuns, repos } = createHarness()
  const provider = new SequenceProvider(['not json', jsonOutput(projectPayload({ title: 'Repaired Project' }))])

  const result = await runMockProjectWorkflow({
    repos,
    provider,
    projectId: 'p1',
    taskType: 'generate_project',
    prompt: 'Generate project JSON.',
    responseFormat: 'json',
  })

  assert.equal(result.ok, true)
  assert.equal(provider.calls.length, 2)
  assert.match(provider.calls[1].messages[1].content, /JSON/)
  assert.equal(result.state.retryCount, 1)
  assert.equal((result.result?.data as { title: string }).title, 'Repaired Project')
  assert.equal(aiRuns[0].status, 'success')
})

test('records model failures as failed ai runs', async () => {
  const { aiRuns, repos } = createHarness()
  const provider = new SequenceProvider([new Error('model unavailable')])

  const result = await runMockProjectWorkflow({
    repos,
    provider,
    projectId: 'p1',
    taskType: 'generate_project',
    prompt: 'Generate project JSON.',
    responseFormat: 'json',
  })

  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /model unavailable/)
  assert.equal(aiRuns[0].status, 'failed')
  assert.equal(aiRuns[0].output, '')
  assert.match(aiRuns[0].errorMessage ?? '', /model unavailable/)
})

test('retries empty text output once and records the failure', async () => {
  const { aiRuns, repos } = createHarness()
  const provider = new SequenceProvider(['   ', ''])

  const result = await runMockProjectWorkflow({
    repos,
    provider,
    projectId: 'p1',
    taskType: 'generate_book_outline',
    prompt: 'Generate outline.',
    responseFormat: 'text',
  })

  assert.equal(result.ok, false)
  assert.equal(provider.calls.length, 2)
  assert.match(result.error ?? '', /模型输出为空/)
  assert.equal(result.state.retryCount, 1)
  assert.equal(aiRuns[0].status, 'failed')
})

test('adopts generated project output with a content version snapshot', async () => {
  const { contentVersions, projectUpdates, repos } = createHarness()
  const payload = projectPayload({ title: 'Adopted Project' })

  const out = await applyGeneratedArtifact(
    { repos },
    { projectId: 'p1', taskType: 'generate_project', data: payload },
  )

  assert.equal(out.kind, 'generate_project')
  assert.equal(projectUpdates[0].title, 'Adopted Project')
  assert.equal(contentVersions.length, 1)
  assert.equal(contentVersions[0].targetKind, 'project')
  assert.equal(contentVersions[0].source, 'adopt_preview')
  assert.match(String(contentVersions[0].content), /Adopted Project/)
})

test('adopts generated story arc outlines with hierarchy and a content version snapshot', async () => {
  const { contentVersions, repos, storyArcs } = createHarness()
  const payload = GenerateStoryArcOutlineResultSchema.parse([
    {
      kind: 'volume',
      title: '第一卷 归来复仇',
      targetChapterCount: 40,
      targetWordCount: 120000,
      coreConflict: '女主回归后与旧豪门正面交锋',
      keyHighlights: ['身份揭露'],
      foreshadowingPayoffs: ['玉佩身世'],
    },
    {
      kind: 'unit',
      parentTitle: '第一卷 归来复仇',
      title: '宴会反击单元',
      targetChapterCount: 8,
      chapterStart: 1,
      chapterEnd: 8,
      coreConflict: '宴会羞辱与公开反制',
    },
    {
      kind: 'stage',
      parentTitle: '宴会反击单元',
      title: '当众反杀阶段',
      targetChapterCount: 3,
      chapterStart: 1,
      chapterEnd: 3,
      keyHighlights: ['当众打脸'],
    },
  ])

  const out = await applyGeneratedArtifact(
    { repos },
    { projectId: 'p1', taskType: 'generate_story_arc_outline', data: payload },
  )

  assert.equal(out.kind, 'generate_story_arc_outline')
  assert.equal(storyArcs.length, 3)
  assert.equal(storyArcs[1].parentId, storyArcs[0].id)
  assert.equal(storyArcs[2].parentId, storyArcs[1].id)
  assert.equal(storyArcs[0].targetWordCount, 120000)
  assert.deepEqual(storyArcs[2].keyHighlights, ['当众打脸'])
  assert.equal(contentVersions.length, 1)
  assert.equal(contentVersions[0].targetKind, 'project')
  assert.equal(contentVersions[0].source, 'adopt_preview')
  assert.match(String(contentVersions[0].content), /宴会反击单元/)
})
