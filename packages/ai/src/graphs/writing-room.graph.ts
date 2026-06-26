// writing-room.graph.ts —— 多 Agent 编剧室工作流（ROADMAP v0.8 §2）
//
// 流程：
//   load_target_context（加载审稿目标 + 项目设定）
//     → review_<agent>（每个启用的 Agent 并行/串行各跑一次，产出 AgentReviewResult）
//     → consolidate（主编 Agent 汇总各 Agent 意见，产出整合修改方案）
//     → END
//
// 与 novel-workflow 不同：这里是「多 Agent 各自出审稿 → 主编整合」，不复用单图工作流。
// 审稿目标可为章节(chapter) / 剧本(script) / 镜头(shot)。
import { END, START, StateGraph, Annotation } from '@langchain/langgraph'
import type {
  AgentReviewResult,
  AgentReviewOutput,
  Chapter,
  Character,
  ChapterMemory,
  CharacterState,
  CharacterVisualProfile,
  Foreshadowing,
  Project,
  Scene,
  Script,
  Shot,
  StoryEvent,
  VisualSetting,
  WritingRoomConsolidated,
  WritingRoomResult,
  WritingRoomTargetKind,
} from '@sdns/core'
import { AgentReviewOutputSchema, WritingRoomConsolidatedSchema } from '@sdns/core'
import type { Repositories } from '@sdns/db'
import type { ChatInput, ChatMessage, LLMProvider } from '@sdns/core'

import { extractJson } from '../parsers/json'
import agentReviewPrompt from '../prompts/zh-CN/agent/agent-review.md?raw'
import consolidatePrompt from '../prompts/zh-CN/agent/consolidate-review.md?raw'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** 编剧室节点 deps（与 NovelWorkflowDeps 对齐，便于复用 provider） */
export interface WritingRoomDeps {
  repos: Repositories
  provider?: LLMProvider
}

export interface WritingRoomInput {
  targetKind: WritingRoomTargetKind
  targetId: string
  /** 章节/剧本/镜头所属项目（剧本/镜头需同时提供 adaptationProjectId / sceneId 以定位） */
  projectId?: string
  chapterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  /** 参与审稿的 Agent id 列表（为空则取全部启用 Agent） */
  agentIds?: string[]
  userInstruction?: string
}

export interface WritingRoomResultPayload {
  ok: boolean
  error?: string
  result?: WritingRoomResult
  /** 每个 Agent 的 ai_run id（按 agentId 记账） */
  aiRunIds?: Record<string, string>
}

interface AgentReviewContext {
  id: string
  name: string
  role: string
  systemPrompt: string
}

export const WritingRoomState = Annotation.Root({
  // 输入
  targetKind: Annotation<WritingRoomTargetKind>(),
  targetId: Annotation<string>(),
  projectId: Annotation<string | undefined>(),
  chapterId: Annotation<string | undefined>(),
  adaptationProjectId: Annotation<string | undefined>(),
  episodeId: Annotation<string | undefined>(),
  sceneId: Annotation<string | undefined>(),
  shotId: Annotation<string | undefined>(),
  agentIds: Annotation<string[] | undefined>(),
  userInstruction: Annotation<string | undefined>(),

  // 上下文
  project: Annotation<Project | undefined>(),
  characters: Annotation<Character[] | undefined>(),
  chapterMemories: Annotation<ChapterMemory[] | undefined>(),
  characterStates: Annotation<CharacterState[] | undefined>(),
  visualProfiles: Annotation<CharacterVisualProfile[] | undefined>(),
  visualSettings: Annotation<VisualSetting[] | undefined>(),
  storyEvents: Annotation<StoryEvent[] | undefined>(),
  foreshadowings: Annotation<Foreshadowing[] | undefined>(),
  currentChapter: Annotation<Chapter | undefined>(),
  currentScript: Annotation<Script | undefined>(),
  scenes: Annotation<Scene[] | undefined>(),
  currentShot: Annotation<Shot | undefined>(),
  shots: Annotation<Shot[] | undefined>(),
  contextText: Annotation<string | undefined>(),

  // 处理中间态
  agents: Annotation<AgentReviewContext[] | undefined>(),
  reviews: Annotation<AgentReviewResult[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])] }),
  consolidated: Annotation<WritingRoomConsolidated | undefined>(),
  error: Annotation<string | undefined>(),
  aiRunIds: Annotation<Record<string, string> | undefined>({ reducer: (a, b) => ({ ...(a ?? {}), ...(b ?? {}) }) }),

  // 产物
  result: Annotation<WritingRoomResult | undefined>(),
})

export type WritingRoomStateType = typeof WritingRoomState.State

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function buildWritingRoomWorkflow(deps: WritingRoomDeps) {
  // 设计说明：agents 在运行期才确定（来自 DB），故无法在编译期动态生成拓扑。
  // 这里用一个固定节点 review_all 串行跑所有启用 Agent，再做主编整合：
  //   load_target_context → review_all → consolidate → END
  const graph = new StateGraph(WritingRoomState)
    .addNode('load_target_context', createLoadTargetContextNode(deps))
    .addNode('review_all', createReviewNodeFactory(deps))
    .addNode('consolidate', createConsolidateNode(deps))
    .addEdge(START, 'load_target_context')
    .addEdge('load_target_context', 'review_all')
    .addEdge('review_all', 'consolidate')
    .addEdge('consolidate', END)

  return graph.compile()
}

export async function runWritingRoomWorkflow(
  deps: WritingRoomDeps,
  input: WritingRoomInput,
): Promise<WritingRoomResultPayload> {
  const app = buildWritingRoomWorkflow(deps)
  const state = (await app.invoke(input, { recursionLimit: 25 })) as WritingRoomStateType
  return {
    ok: !state.error,
    error: state.error,
    result: state.result,
    aiRunIds: state.aiRunIds,
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function createLoadTargetContextNode(deps: WritingRoomDeps) {
  return async (state: WritingRoomStateType): Promise<Partial<WritingRoomStateType>> => {
    const { repos } = deps
    const db = repos.db
    try {
      // 解析参与 Agent（默认全部启用）
      const allAgents = repos.agentProfile.listAgentProfiles(db)
      const wanted = state.agentIds?.length ? state.agentIds : allAgents.filter((a) => a.enabled).map((a) => a.id)
      const agents: AgentReviewContext[] = allAgents
        .filter((a) => wanted.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name, role: a.role, systemPrompt: a.systemPrompt }))

      // 项目上下文（章节类必须有 projectId；剧本/镜头允许缺源项目）
      let project: Project | undefined
      let characters: Character[] = []
      let chapterMemories: ChapterMemory[] = []
      let characterStates: CharacterState[] = []
      let visualProfiles: CharacterVisualProfile[] = []
      let visualSettings: VisualSetting[] = []
      let storyEvents: StoryEvent[] = []
      let foreshadowings: Foreshadowing[] = []
      const pid = state.projectId
      if (pid) {
        project = repos.project.getProject(db, pid)
        if (!project) return { error: `未找到项目 ${pid}` }
        characters = repos.character.listCharacters(db, pid)
        chapterMemories = repos.chapterMemory.listChapterMemories(db, pid)
        characterStates = repos.characterState.listCharacterStates(db, pid)
        visualProfiles = repos.visualProfile.listVisualProfiles(db, pid)
        visualSettings = repos.visualSetting.listVisualSettings(db, pid)
        storyEvents = repos.storyEvent.listStoryEvents(db, pid)
        foreshadowings = repos.foreshadowing.listForeshadowings(db, pid)
      }

      // 目标内容（章节/剧本/镜头）
      let currentChapter: Chapter | undefined
      let currentScript: Script | undefined
      let scenes: Scene[] | undefined
      let currentShot: Shot | undefined
      let shots: Shot[] | undefined

      if (state.targetKind === 'chapter') {
        const cid = state.chapterId ?? state.targetId
        currentChapter = cid ? repos.chapter.getChapter(db, cid) ?? undefined : undefined
        if (!currentChapter) return { error: `未找到章节 ${cid ?? state.targetId}` }
      } else if (state.targetKind === 'script') {
        currentScript = repos.script.getScript(db, state.targetId)
        if (!currentScript) return { error: `未找到剧本 ${state.targetId}` }
        scenes = repos.scene.listScenesByScript(db, state.targetId)
        if (!pid && currentScript) {
          // 剧本无直接 projectId 字段，跳过项目级上下文
        }
      } else if (state.targetKind === 'shot') {
        currentShot = repos.shot.getShot(db, state.targetId)
        if (!currentShot) return { error: `未找到镜头 ${state.targetId}` }
        const scene = repos.scene.getScene(db, currentShot.sceneId)
        if (scene) {
          const script = repos.script.getScript(db, scene.scriptId)
          currentScript = script ?? undefined
          if (script) scenes = repos.scene.listScenesByScript(db, script.id)
          shots = repos.shot.listShotsByScene(db, scene.id)
        }
      }

      const contextText = buildReviewContext({
        project,
        characters,
        chapterMemories,
        characterStates,
        visualProfiles,
        visualSettings,
        storyEvents,
        foreshadowings,
        currentChapter,
        currentScript,
        scenes,
        currentShot,
        shots,
        targetKind: state.targetKind,
        userInstruction: state.userInstruction,
      })

      return {
        agents,
        project,
        characters,
        chapterMemories,
        characterStates,
        visualProfiles,
        visualSettings,
        storyEvents,
        foreshadowings,
        currentChapter,
        currentScript,
        scenes,
        currentShot,
        shots,
        contextText,
      }
    } catch (e) {
      return { error: `加载审稿上下文失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }
}

/** 串行跑所有 Agent 的审稿节点工厂 */
function createReviewNodeFactory(deps: WritingRoomDeps) {
  return async (state: WritingRoomStateType): Promise<Partial<WritingRoomStateType>> => {
    if (state.error) return {}
    const provider = deps.provider
    if (!provider) return { error: '未配置可用模型（请在设置中添加并设为默认）' }
    if (!state.agents?.length) return { error: '没有可用的审稿 Agent' }

    const reviews: AgentReviewResult[] = []
    const aiRunIds: Record<string, string> = {}
    for (const agent of state.agents) {
      const prompt = agentReviewPrompt.replace('{{AGENT_SYSTEM_PROMPT}}', agent.systemPrompt)
      const messages: ChatMessage[] = [
        { role: 'system', content: prompt },
        { role: 'user', content: state.contextText ?? '' },
      ]
      const input: ChatInput = { messages, temperature: 0.4, responseFormat: 'json' }
      const startedAt = Date.now()
      let raw = ''
      let tokenUsage: number | undefined
      try {
        const out = await provider.chat(input)
        raw = out.content
        tokenUsage = out.tokenUsage
      } catch (e) {
        // 单个 Agent 失败不阻断整体；记录空结果继续
        reviews.push({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          score: 0,
          issues: [],
          suggestions: [],
          summary: `审稿失败：${e instanceof Error ? e.message : String(e)}`,
        })
        continue
      }
      // 解析 + 校验
      let parsed: AgentReviewOutput
      try {
        const obj = extractJson(raw)
        parsed = AgentReviewOutputSchema.parse(obj)
      } catch (e) {
        reviews.push({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          score: 0,
          issues: [],
          suggestions: [],
          summary: `输出解析失败：${e instanceof Error ? e.message : String(e)}`,
        })
        continue
      }
      reviews.push({
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        score: parsed.score,
        issues: parsed.issues,
        suggestions: parsed.suggestions,
        summary: parsed.summary,
      })
      // 记账 ai_run
      const run = deps.repos.aiRun.createAiRun(deps.repos.db, {
        projectId: state.projectId,
        chapterId: state.targetKind === 'chapter' ? state.chapterId : undefined,
        graphName: 'writing-room',
        nodeName: `review_${agent.role}`,
        type: 'writing_room_review',
        provider: provider.name,
        model: provider.model,
        input: state.contextText ?? '',
        output: raw,
        status: 'success',
        tokenUsage,
        latencyMs: Date.now() - startedAt,
      })
      aiRunIds[agent.id] = run.id
    }
    return { reviews, aiRunIds }
  }
}

function createConsolidateNode(deps: WritingRoomDeps) {
  return async (state: WritingRoomStateType): Promise<Partial<WritingRoomStateType>> => {
    if (state.error) return {}
    const provider = deps.provider
    if (!provider) return { error: '未配置可用模型（请在设置中添加并设为默认）' }
    if (!state.reviews.length) return { error: '没有 Agent 审稿结果可整合' }

    const reviewsText = state.reviews
      .map(
        (r) =>
          `## ${r.agentName}（${r.role}）评分：${r.score}\n- 问题：${r.issues.join('；') || '（无）'}\n- 建议：${r.suggestions.join('；') || '（无）'}\n- 小结：${r.summary}`,
      )
      .join('\n\n')
    const messages: ChatMessage[] = [
      { role: 'system', content: consolidatePrompt },
      { role: 'user', content: `# 审稿目标类型：${state.targetKind}\n\n# 各 Agent 审稿意见\n\n${reviewsText}` },
    ]
    const startedAt = Date.now()
    let raw = ''
    let tokenUsage: number | undefined
    try {
      const out = await provider.chat({ messages, temperature: 0.3, responseFormat: 'json' })
      raw = out.content
      tokenUsage = out.tokenUsage
    } catch (e) {
      return { error: `整合失败：${e instanceof Error ? e.message : String(e)}` }
    }
    let consolidated: WritingRoomConsolidated
    try {
      const obj = extractJson(raw)
      consolidated = WritingRoomConsolidatedSchema.parse(obj)
    } catch (e) {
      return { error: `整合结果解析失败：${e instanceof Error ? e.message : String(e)}` }
    }
    // 记账
    deps.repos.aiRun.createAiRun(deps.repos.db, {
      projectId: state.projectId,
      graphName: 'writing-room',
      nodeName: 'consolidate',
      type: 'writing_room_consolidate',
      provider: provider.name,
      model: provider.model,
      input: reviewsText,
      output: raw,
      status: 'success',
      tokenUsage,
      latencyMs: Date.now() - startedAt,
    })

    const result: WritingRoomResult = {
      targetKind: state.targetKind,
      targetId: state.targetId,
      reviews: state.reviews,
      consolidated,
    }
    return { consolidated, result }
  }
}

// ---------------------------------------------------------------------------
// Context builder（精简版：审稿目标 + 关键设定）
// ---------------------------------------------------------------------------

interface ReviewContextInput {
  project?: Project
  characters?: Character[]
  chapterMemories?: ChapterMemory[]
  characterStates?: CharacterState[]
  visualProfiles?: CharacterVisualProfile[]
  visualSettings?: VisualSetting[]
  storyEvents?: StoryEvent[]
  foreshadowings?: Foreshadowing[]
  currentChapter?: Chapter
  currentScript?: Script
  scenes?: Scene[]
  currentShot?: Shot
  shots?: Shot[]
  targetKind: WritingRoomTargetKind
  userInstruction?: string
}

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return ''
  return `- ${label}：${value}`
}

function block(title: string, body: string): string {
  if (!body.trim()) return ''
  return `## ${title}\n${body.trim()}`
}

function buildReviewContext(input: ReviewContextInput): string {
  const sections: string[] = []
  const { project, characters, visualProfiles, currentChapter, currentScript, currentShot } = input

  if (project) {
    const fields = [
      line('作品名称', project.title),
      line('短剧类型', project.shortDramaType),
      line('核心卖点', project.coreSellingPoint),
      line('一句话钩子', project.coreHook),
      line('情绪主轴', project.emotionalCore),
      line('风格要求', project.styleGuide),
      line('视觉风格方向', project.visualStyleDirection),
    ].filter(Boolean)
    sections.push(block('项目设定', fields.join('\n')))
  }

  if (characters?.length) {
    const profileByChar = new Map((visualProfiles ?? []).map((p) => [p.characterId, p]))
    const body = characters
      .map((c) => {
        const vp = profileByChar.get(c.id)
        const visual = [c.visualDescription, c.appearancePrompt, vp?.appearancePrompt].filter(Boolean).join('；')
        return `- ${c.name}（${c.role}）：${[c.identity, c.personality, c.desire].filter(Boolean).join('；')}${visual ? `；视觉：${visual}` : ''}`
      })
      .join('\n')
    sections.push(block('人物设定', body))
  }

  // 审稿目标正文
  if (input.targetKind === 'chapter' && currentChapter?.content?.trim()) {
    sections.push(block('待审章节正文', currentChapter.content.trim()))
  } else if (input.targetKind === 'script' && currentScript?.content?.trim()) {
    sections.push(block('待审剧本正文', currentScript.content.trim()))
    if (input.scenes?.length) {
      const body = input.scenes.map((s, i) => `场景${i + 1}「${s.title}」（${s.location}）：${s.summary}`).join('\n')
      sections.push(block('剧本场景', body))
    }
  } else if (input.targetKind === 'shot' && currentShot) {
    const fields = [
      line('画面描述', currentShot.visualDescription),
      line('出场人物', currentShot.characterIds.join('、')),
      line('镜头角度', currentShot.cameraAngle),
      line('镜头运动', currentShot.cameraMovement),
      line('情绪', currentShot.emotion),
      line('动作', currentShot.action),
      line('对白', currentShot.dialogue),
      line('旁白', currentShot.narration),
      line('当前视频 Prompt', currentShot.videoPrompt),
      line('当前负面 Prompt', currentShot.negativePrompt),
    ].filter(Boolean)
    sections.push(block('待审镜头', fields.join('\n')))
    if (input.shots?.length) {
      const body = input.shots.map((s, i) => `镜头${i + 1}（${s.cameraAngle ?? ''}/${s.cameraMovement ?? ''}）：${s.visualDescription}`).join('\n')
      sections.push(block('同场景已有镜头', body))
    }
  }

  if (input.userInstruction?.trim()) {
    sections.push(block('本次额外要求', input.userInstruction.trim()))
  }

  return sections.filter(Boolean).join('\n\n')
}
