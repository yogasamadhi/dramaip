// persistence.ts —— generate 类 AI 产物的「确认后落库」service（§10.3 / §11.1-11.4）
//
// 预览模式下：graph 跑完仅把 parsedOutput 回传给前端（见 save-result.node.ts 兜底分支），
// 用户在预览弹窗点「采用」后，经 IPC `ai:applyResult` 调用本函数把产物写入对应表。
// chapter 类与 evaluate_ai_drama_fit 不走这里（已在 save-result 自动落库）。
import type {
  EpisodesResult,
  GenerateChapterOutlinesResult,
  GenerateCharactersResult,
  GenerateProjectResult,
  GenerateStoryArcOutlineResult,
  NovelTaskType,
  StoryArc,
  TextDiffPreviewPayload,
  VisualProfileResult,
  VisualSettingResult,
} from '@sdns/core'
import type { NodeDeps } from './nodes/deps'

export type GenerateTaskType =
  | 'generate_project'
  | 'generate_characters'
  | 'generate_book_outline'
  | 'generate_chapter_outline'
  | 'generate_story_arc_outline'
  | 'generate_character_visual_profile'
  | 'generate_visual_setting'
  | 'convert_novel_to_episodes'

export interface ApplyArtifactInput {
  projectId?: string
  taskType: NovelTaskType
  /** v0.2：generate_character_visual_profile 需要指定人物 */
  characterId?: string
  /** v0.4：convert_novel_to_episodes 需要指定改编项目 */
  adaptationProjectId?: string
  /** 已被 graph 的 Zod 校验过的产物（book_outline 为 Markdown 文本，其余为 JSON） */
  data: unknown
}

export interface ApplyArtifactOutput {
  kind: NovelTaskType
  /** 落库后的实体：project / Character[] / Outline / Outline[] */
  created: unknown
}

/**
 * 按 taskType 把 AI 生成产物写入 SQLite。
 * - generate_project：更新现有 Project 的 6 个设定字段（保留类型/受众/字数）
 * - generate_characters：追加人物（不清空已有）
 * - generate_book_outline：已有全书大纲则更新内容，否则新建
 * - generate_chapter_outline：追加章节大纲（orderIndex 接在现有之后）
 * - generate_story_arc_outline：追加卷/单元/剧情阶段规划（按 parentTitle 或最近父级建立层级）
 */
export async function applyGeneratedArtifact(
  deps: NodeDeps,
  input: ApplyArtifactInput,
): Promise<ApplyArtifactOutput> {
  const { repos } = deps
  const db = repos.db
  const { taskType, data } = input

  if (isTextDiffPreviewTask(taskType)) {
    return applyTextDiffPreview(deps, input)
  }

  switch (taskType) {
    case 'generate_project': {
      const projectId = requireProjectId(input.projectId, taskType)
      const r = data as GenerateProjectResult
      const updated = repos.project.updateProject(db, projectId, {
        title: r.title,
        coreHook: r.coreHook,
        emotionalCore: r.emotionalCore,
        coreSellingPoint: r.coreSellingPoint,
        synopsis: r.synopsis,
        styleGuide: r.styleGuide,
        visualStyleDirection: r.visualStyleDirection,
        targetEpisodeCount: r.targetEpisodeCount,
      })
      repos.creative.createContentVersion(db, {
        projectId,
        targetKind: 'project',
        targetId: projectId,
        label: '采纳预览：项目设定',
        source: 'adopt_preview',
        content: JSON.stringify(r, null, 2),
        meta: { taskType },
      })
      return { kind: taskType, created: updated }
    }

    case 'generate_characters': {
      const projectId = requireProjectId(input.projectId, taskType)
      const items = data as GenerateCharactersResult
      const created = items.map((it) =>
        repos.character.createCharacter(db, {
          projectId,
          name: it.name,
          role: it.role,
          identity: it.identity,
          personality: it.personality,
          desire: it.desire,
          secret: it.secret,
          weakness: it.weakness,
          arc: it.arc,
          relationshipToProtagonist: it.relationshipToProtagonist,
          conflictTarget: it.conflictTarget,
          emotionalFunction: it.emotionalFunction,
          shortDramaFunction: it.shortDramaFunction,
          visualDescription: it.visualDescription,
          appearancePrompt: it.appearancePrompt,
          negativePrompt: it.negativePrompt,
        }),
      )
      return { kind: taskType, created }
    }

    case 'generate_book_outline': {
      const projectId = requireProjectId(input.projectId, taskType)
      const content = String(data ?? '').trim()
      const existing = repos.outline.listOutlines(db, projectId, 'book')
      const created =
        existing.length > 0
          ? repos.outline.updateOutline(db, existing[0].id, { content })
          : repos.outline.createOutline(db, {
              projectId,
              type: 'book',
              title: '全书大纲',
              content,
              orderIndex: 0,
            })
      if (created) {
        repos.creative.createContentVersion(db, {
          projectId,
          targetKind: 'project',
          targetId: projectId,
          label: '采纳预览：全书大纲',
          source: 'adopt_preview',
          content,
          meta: { taskType, outlineId: created.id },
        })
      }
      return { kind: taskType, created }
    }

    case 'generate_chapter_outline': {
      const projectId = requireProjectId(input.projectId, taskType)
      const items = data as GenerateChapterOutlinesResult
      const baseIndex = repos.outline.listOutlines(db, projectId, 'chapter').length
      const created = items.map((it, idx) =>
        repos.outline.createOutline(db, {
          projectId,
          type: 'chapter',
          title: it.title,
          content: joinChapterOutlineContent(it),
          orderIndex: baseIndex + idx,
        }),
      )
      return { kind: taskType, created }
    }

    case 'generate_story_arc_outline': {
      const projectId = requireProjectId(input.projectId, taskType)
      const items = data as GenerateStoryArcOutlineResult
      const existing = repos.storyArc.listStoryArcs(db, projectId)
      const titleToId = new Map(existing.map((arc) => [arc.title, arc.id]))
      let lastVolumeId = lastStoryArcId(existing, 'volume')
      let lastUnitId = lastStoryArcId(existing, 'unit')
      const baseIndex = existing.length
      const created = items.map((it, idx) => {
        const parentId = resolveStoryArcParentId(it, titleToId, lastVolumeId, lastUnitId)
        const arc = repos.storyArc.createStoryArc(db, {
          projectId,
          parentId,
          kind: it.kind,
          title: it.title,
          summary: it.summary,
          targetWordCount: it.targetWordCount,
          targetChapterCount: it.targetChapterCount,
          chapterStart: it.chapterStart,
          chapterEnd: it.chapterEnd,
          coreConflict: it.coreConflict,
          keyHighlights: it.keyHighlights ?? [],
          foreshadowingPayoffs: it.foreshadowingPayoffs ?? [],
          orderIndex: baseIndex + idx,
        })
        titleToId.set(arc.title, arc.id)
        if (arc.kind === 'volume') lastVolumeId = arc.id
        if (arc.kind === 'unit') lastUnitId = arc.id
        return arc
      })
      repos.creative.createContentVersion(db, {
        projectId,
        targetKind: 'project',
        targetId: projectId,
        label: '采纳预览：长篇规划',
        source: 'adopt_preview',
        content: JSON.stringify(items, null, 2),
        meta: { taskType, storyArcIds: created.map((arc) => arc.id) },
      })
      return { kind: taskType, created }
    }

    // v0.2：人物视觉档案（每人一份，存在则更新）
    case 'generate_character_visual_profile': {
      const projectId = requireProjectId(input.projectId, taskType)
      if (!input.characterId) throw new Error('生成人物视觉档案需要 characterId')
      const r = data as VisualProfileResult
      const created = repos.visualProfile.upsertVisualProfileByCharacter(db, {
        projectId,
        characterId: input.characterId,
        appearancePrompt: r.appearancePrompt,
        faceDescription: r.faceDescription,
        hairstyle: r.hairstyle,
        clothingStyle: r.clothingStyle,
        bodyType: r.bodyType,
        ageLook: r.ageLook,
        temperament: r.temperament,
        colorPalette: r.colorPalette,
        negativePrompt: r.negativePrompt,
      })
      return { kind: taskType, created }
    }

    // v0.2：视觉设定（追加一条）
    case 'generate_visual_setting': {
      const projectId = requireProjectId(input.projectId, taskType)
      const r = data as VisualSettingResult
      const created = repos.visualSetting.createVisualSetting(db, {
        projectId,
        title: r.title,
        type: r.type,
        visualPrompt: r.visualPrompt,
        negativePrompt: r.negativePrompt,
        notes: r.notes,
      })
      return { kind: taskType, created }
    }

    // v0.4：分集大纲生成（清空旧分集后批量写入）
    case 'convert_novel_to_episodes': {
      const projectId = requireProjectId(input.projectId, taskType)
      if (!input.adaptationProjectId) throw new Error('生成分集大纲需要 adaptationProjectId')
      const items = data as EpisodesResult
      // 清空该改编项目下已有分集（重新生成分集）
      const existing = repos.episode.listEpisodes(db, input.adaptationProjectId)
      for (const e of existing) repos.episode.deleteEpisode(db, e.id)
      const created = items.map((it) =>
        repos.episode.createEpisode(db, {
          adaptationProjectId: input.adaptationProjectId!,
          episodeNumber: it.episodeNumber,
          title: it.title,
          summary: it.summary,
          hook: it.hook,
          mainConflict: it.mainConflict,
          reversal: it.reversal,
          emotionalBeat: it.emotionalBeat,
          cliffhanger: it.cliffhanger,
          aiVideoNote: it.aiVideoNote,
          keyVisuals: it.keyVisuals,
          relatedChapterIds: it.relatedChapterIds,
          relatedBeatIds: it.relatedBeatIds,
        }),
      )
      repos.creative.createContentVersion(db, {
        projectId,
        targetKind: 'adaptation',
        targetId: input.adaptationProjectId,
        label: '采纳预览：分集大纲',
        source: 'adopt_preview',
        content: JSON.stringify(items, null, 2),
        meta: { taskType },
      })
      return { kind: taskType, created }
    }

    default:
      throw new Error(`不支持的生成任务类型：${taskType}`)
  }
}

function applyTextDiffPreview(deps: NodeDeps, input: ApplyArtifactInput): ApplyArtifactOutput {
  const { repos } = deps
  const db = repos.db
  const preview = asTextDiffPreviewPayload(input.data)
  if (preview.taskType !== input.taskType) {
    throw new Error('预览任务类型与采用任务类型不一致')
  }
  const projectId = input.projectId ?? preview.projectId

  if (preview.targetKind === 'chapter') {
    if (!preview.targetId) throw new Error('章节预览缺少 targetId')
    const updated = repos.chapter.updateChapterContent(db, preview.targetId, preview.nextContent)
    if (!updated) throw new Error('未找到要更新的章节')
    repos.creative.createContentVersion(db, {
      projectId,
      targetKind: 'chapter',
      targetId: preview.targetId,
      label: `采纳预览：${preview.taskType}`,
      source: 'adopt_preview',
      content: preview.nextContent,
      meta: { taskType: preview.taskType },
    })
    return { kind: preview.taskType, created: updated }
  }

  if (preview.targetKind === 'script') {
    if (!preview.adaptationProjectId) throw new Error('剧本预览缺少 adaptationProjectId')
    if (!preview.episodeId) throw new Error('剧本预览缺少 episodeId')
    if (!preview.script) throw new Error('剧本预览缺少 script 数据')
    const script = repos.script.upsertScriptByEpisode(db, {
      adaptationProjectId: preview.adaptationProjectId,
      episodeId: preview.episodeId,
      episodeNumber: preview.script.episodeNumber,
      title: preview.script.title,
      content: preview.script.content,
      hook: preview.script.hook,
      mainConflict: preview.script.mainConflict,
      emotionalBeat: preview.script.emotionalBeat,
      reversal: preview.script.reversal,
      cliffhanger: preview.script.cliffhanger,
      estimatedDuration: preview.script.estimatedDuration,
    })
    repos.creative.createContentVersion(db, {
      projectId,
      targetKind: 'script',
      targetId: script.id,
      label: `采纳预览：${preview.taskType}`,
      source: 'adopt_preview',
      content: script.content,
      meta: { taskType: preview.taskType, episodeId: preview.episodeId },
    })
    return { kind: preview.taskType, created: script }
  }

  if (preview.targetKind === 'shot') {
    const shotId = preview.shotId ?? preview.targetId
    if (!shotId) throw new Error('镜头预览缺少 shotId')
    const patch = preview.shotPatch ?? {}
    const updated = repos.shot.updateShot(db, shotId, patch)
    if (!updated) throw new Error('未找到要更新的镜头')
    repos.creative.createContentVersion(db, {
      projectId,
      targetKind: 'shot',
      targetId: shotId,
      label: `采纳预览：${preview.taskType}`,
      source: 'adopt_preview',
      content: updated?.videoPrompt ?? patch.videoPrompt ?? '',
      meta: {
        taskType: preview.taskType,
        negativePrompt: updated?.negativePrompt ?? patch.negativePrompt,
        imagePrompt: updated?.imagePrompt ?? patch.imagePrompt,
      },
    })
    repos.shot.appendPromptVersion(db, {
      shotId,
      taskType: preview.taskType,
      videoPrompt: updated?.videoPrompt ?? patch.videoPrompt,
      negativePrompt: updated?.negativePrompt ?? patch.negativePrompt,
      imagePrompt: updated?.imagePrompt ?? patch.imagePrompt,
      note: preview.note,
    })
    return { kind: preview.taskType, created: updated }
  }

  throw new Error(`不支持的文本预览目标：${preview.targetKind}`)
}

function requireProjectId(projectId: string | undefined, taskType: NovelTaskType): string {
  if (!projectId) throw new Error(`${taskType} 需要 projectId`)
  return projectId
}

function lastStoryArcId(arcs: StoryArc[], kind: StoryArc['kind']): string | undefined {
  for (let index = arcs.length - 1; index >= 0; index -= 1) {
    if (arcs[index].kind === kind) return arcs[index].id
  }
  return undefined
}

function resolveStoryArcParentId(
  item: GenerateStoryArcOutlineResult[number],
  titleToId: Map<string, string>,
  lastVolumeId: string | undefined,
  lastUnitId: string | undefined,
): string | undefined {
  if (item.kind === 'volume') return undefined
  if (item.parentTitle && titleToId.has(item.parentTitle)) return titleToId.get(item.parentTitle)
  return item.kind === 'unit' ? lastVolumeId : lastUnitId
}

const TEXT_DIFF_PREVIEW_TASKS = new Set<NovelTaskType>([
  'generate_chapter',
  'continue_chapter',
  'rewrite_chapter',
  'polish_chapter',
  'expand_chapter',
  'enhance_conflict',
  'enhance_highlight',
  'enhance_ai_drama_feel',
  'enhance_author_style',
  'enhance_hook',
  'enhance_reversal',
  'enhance_cliffhanger',
  'rewrite_as_ai_drama_novel',
  'generate_ai_drama_script',
  'rewrite_ai_drama_script',
  'enhance_dialogue_conflict',
  'enhance_script_dialogue_voice',
  'enhance_episode_cliffhanger',
  'enhance_script_visuality',
  'generate_shot_prompt',
  'generate_negative_prompt',
  'rewrite_shot_prompt',
  'optimize_prompt_for_video_platform',
])

function isTextDiffPreviewTask(taskType: NovelTaskType): boolean {
  return TEXT_DIFF_PREVIEW_TASKS.has(taskType)
}

function asTextDiffPreviewPayload(data: unknown): TextDiffPreviewPayload {
  if (!data || typeof data !== 'object') throw new Error('文本预览数据无效')
  const preview = data as Partial<TextDiffPreviewPayload>
  if (
    (preview.targetKind !== 'chapter' && preview.targetKind !== 'script' && preview.targetKind !== 'shot') ||
    typeof preview.taskType !== 'string' ||
    typeof preview.currentContent !== 'string' ||
    typeof preview.nextContent !== 'string'
  ) {
    throw new Error('文本预览数据缺少必要字段')
  }
  return preview as TextDiffPreviewPayload
}

function joinChapterOutlineContent(it: {
  objective?: string
  mainConflict?: string
  sellingPoint?: string
  reversal?: string
  cliffhanger?: string
  shortDramaNote?: string
  keyVisuals?: string
  summary?: string
  hook?: string
}): string {
  return [
    it.objective ? `本章目标：${it.objective}` : '',
    it.mainConflict ? `核心冲突：${it.mainConflict}` : '',
    it.sellingPoint ? `爽点：${it.sellingPoint}` : '',
    it.reversal ? `反转：${it.reversal}` : '',
    it.cliffhanger ? `结尾钩子：${it.cliffhanger}` : '',
    it.shortDramaNote ? `AI短剧改编备注：${it.shortDramaNote}` : '',
    it.keyVisuals ? `关键画面：${it.keyVisuals}` : '',
    it.summary ? `摘要：${it.summary}` : '',
    it.hook ? `钩子：${it.hook}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
