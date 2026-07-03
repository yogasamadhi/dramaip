import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatInput, ChatOutput, LLMProvider, NovelTaskType, Project, StoryArc } from '@sdns/core'
import { GenerateProjectResultSchema, GenerateStoryArcOutlineResultSchema, InspirationSchemesResultSchema, TextQualityReportResultSchema } from '@sdns/core'
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

function inspirationSchemesPayload(): unknown {
  return {
    schemes: [
      {
        title: '婚礼夺回人生',
        genre: '女频复仇',
        targetAudience: '18-35 岁女性短剧用户',
        shortDramaDirection: '强压迫后公开反击',
        differentiation: '第一章直接夺回身份',
        coreHook: '她重回婚礼现场，当众夺回被偷走的人生。',
        premise: '女主被假千金夺走身份后重生回订婚宴。',
        emotionalCore: '从被替代到自我确认',
        protagonist: '冷静克制的真千金',
        relationship: '真假千金互为镜像',
        conflictMechanism: '公开证据和家族利益正面碰撞',
        openingHook: '婚礼大屏突然播放亲子鉴定。',
        keyReversal: '男主不是救赎者，而是当年证据保管人。',
        cliffhanger: '女主说出下一份证据时，父亲突然昏倒。',
        visualSellingPoint: '豪门宴会、证据投屏、近景反应切换。',
        chapterRewriteBrief: '把章节改成婚礼现场公开反击，结尾留父亲昏倒尾钩。',
        projectSeed: '真千金重生回婚礼，用证据夺回身份并反查旧案。',
        riskNotes: ['避免照搬真假千金套路'],
      },
      {
        title: '直播间审判',
        coreHook: '她把豪门审判搬进直播间。',
        premise: '女主被全网误解后设计一场公开自证。',
        conflictMechanism: '舆论压力与证据链递进',
        openingHook: '直播一开，黑粉先刷满弹幕。',
        keyReversal: '最大黑粉是女主安排的证人。',
        cliffhanger: '账号背后 IP 指向男主公司。',
        visualSellingPoint: '弹幕、手机屏、豪门客厅对切。',
        chapterRewriteBrief: '把章节改成直播自证结构。',
      },
      {
        title: '遗嘱反杀',
        coreHook: '她在葬礼上公布第二份遗嘱。',
        premise: '女主被赶出家门后带律师回到葬礼。',
        conflictMechanism: '继承权、亲情绑架和法律证据',
        openingHook: '葬礼上全家逼她签放弃书。',
        keyReversal: '遗嘱真正继承人不是女主，而是她的公司。',
        cliffhanger: '律师递出第三份密封文件。',
        visualSellingPoint: '黑白葬礼、文件特写、沉默对峙。',
        chapterRewriteBrief: '把章节改成葬礼遗嘱反杀。',
      },
    ],
  }
}

function textQualityPayload(): unknown {
  return {
    styleStrengthScore: 76,
    authorVoiceScore: 72,
    sentenceVarietyScore: 68,
    dialogueEnergyScore: 81,
    webReadabilityScore: 84,
    originalityRiskScore: 42,
    overallScore: 78,
    styleAnchors: ['短句推进', '动作承接情绪'],
    repetitivePatterns: ['连续三段以“她抬头”开头'],
    originalityRiskSignals: ['通用复仇宣言偏多'],
    dialogueEnhancementSuggestions: ['让反派用利益威胁替代泛泛嘲讽'],
    polishSuggestions: ['把抽象愤怒改成具体动作'],
    safeRevisionPrinciples: ['用本项目角色秘密和场景道具替代通用套路表达'],
    issues: [
      {
        kind: 'repetitive_sentence',
        severity: 'medium',
        evidence: '连续段落使用相同动作开头。',
        suggestion: '改为不同感官、动作和对白切入。',
      },
    ],
    summary: '文本已有短剧节奏，但句式变化和角色专属表达仍可加强。',
  }
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
    projectSkill: { listEnabledProjectSkills: () => [] },
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

async function runMockInspirationSchemeWorkflow(input: {
  repos: never
  provider: LLMProvider
  projectId?: string
  prompt: string
}) {
  const output = await input.provider.chat({
    messages: [
      { role: 'system', content: 'mock workflow' },
      { role: 'user', content: input.prompt },
    ],
    responseFormat: 'json',
  })
  const parsed = extractJson(output.content)
  const result = InspirationSchemesResultSchema.safeParse(parsed)
  const error = result.success ? '' : result.error.message
  const save = createSaveAiRunNode({ repos: input.repos, provider: input.provider } as never)
  const saved = await save({
    projectId: input.projectId,
    taskType: 'generate_inspiration_schemes',
    promptText: input.prompt,
    rawOutput: output.content,
    parsedOutput: result.success ? result.data : undefined,
    error,
    providerName: input.provider.name,
    modelName: input.provider.model,
    tokenUsage: output.tokenUsage,
    latencyMs: 0,
  } as never)

  return {
    ok: result.success,
    error: error || undefined,
    result: result.success ? { kind: 'generate_inspiration_schemes', data: result.data } : undefined,
    aiRunId: saved.aiRunId,
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

test('runs inspiration scheme generation through the mock workflow', async () => {
  const { aiRuns, repos } = createHarness()
  const provider = new SequenceProvider([jsonOutput(inspirationSchemesPayload())])

  const result = await runMockInspirationSchemeWorkflow({
    repos,
    provider,
    projectId: 'p1',
    prompt: '请生成 3-5 组灵感方案。\n题材：女频复仇\n目标受众：18-35 岁女性短剧用户\n短剧方向：强压迫后公开反击',
  })

  assert.equal(result.ok, true)
  assert.equal(result.result?.kind, 'generate_inspiration_schemes')
  const parsed = InspirationSchemesResultSchema.parse(result.result?.data)
  assert.equal(parsed.schemes.length, 3)
  assert.match(parsed.schemes[0].chapterRewriteBrief, /婚礼现场公开反击/)
  assert.equal(provider.calls[0].responseFormat, 'json')
  assert.match(provider.calls[0].messages[1].content, /3-5/)
  assert.equal(aiRuns[0].status, 'success')
  assert.equal(aiRuns[0].type, 'generate_inspiration_schemes')
})

test('parses text quality reports with originality risk safeguards', () => {
  const parsed = TextQualityReportResultSchema.parse(textQualityPayload())

  assert.equal(parsed.overallScore, 78)
  assert.equal(parsed.originalityRiskScore, 42)
  assert.equal(parsed.issues[0].kind, 'repetitive_sentence')
  assert.match(parsed.safeRevisionPrinciples[0], /角色秘密/)
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
