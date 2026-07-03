// saveResultNode —— 按 taskType 路由保存到对应表（§10.3）
import type {
  AiVideoFeasibilityResult,
  AntiTropeVariantsResult,
  AudienceSimulationResult,
  BeatsResult,
  CaseStructureResult,
  ChapterMemoryResult,
  CharacterStateResult,
  DramaTrendResult,
  EpisodeItem,
  EvaluationResult,
  First10AnalysisResult,
  ForeshadowingResult,
  FreshnessReportResult,
  HighlightAnalysisResult,
  NarrativeCurveResult,
  QualityGateResult,
  RevisionTasksResult,
  ScenesResult,
  ScriptResult,
  ScriptReviewResult,
  ShotPromptResult,
  ShotReviewResult,
  ShotsResult,
  StoryEventsResult,
  TextDiffPreviewPayload,
  VideoCostRiskResult,
} from '@sdns/core'
import { renderSceneStructureSnapshot, renderShotStructureSnapshot, snapshotScene, snapshotShot } from '@sdns/core'
import { effectiveTaskType, isTextChapterTask } from '../prompts/task-types'
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'

export function createSaveResultNode(deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    if (state.error) return {}

    const { repos } = deps
    const db = repos.db
    const taskType = state.taskType
    // v0.8：template_run 按 templateScope 落库/分支
    const effectiveType = effectiveTaskType(taskType, state.templateScope)

    if (isTextChapterTask(effectiveType) && state.chapterId) {
      const content = String(state.parsedOutput ?? '').trim()
      const currentContent = state.currentChapter?.content ?? ''
      let next = content
      if (taskType === 'continue_chapter' && currentContent.trim()) {
        next = `${currentContent.trimEnd()}\n\n${content}`
      }
      return textPreview({
        targetKind: 'chapter',
        targetId: state.chapterId,
        title: state.currentChapter?.title,
        taskType,
        currentContent,
        nextContent: next,
        projectId: state.projectId,
      })
    }

    if (taskType === 'evaluate_ai_drama_fit' && state.projectId) {
      const ev = state.parsedOutput as EvaluationResult
      const created = repos.evaluation.createEvaluation(db, {
        projectId: state.projectId,
        chapterId: state.chapterId,
        totalScore: ev.totalScore,
        hookScore: ev.hookScore,
        conflictScore: ev.conflictScore,
        reversalScore: ev.reversalScore,
        emotionScore: ev.emotionScore,
        visualizationScore: ev.visualizationScore,
        aiVideoFeasibilityScore: ev.aiVideoFeasibilityScore,
        characterConsistencyScore: ev.characterConsistencyScore,
        shotClarityScore: ev.shotClarityScore,
        cliffhangerScore: ev.cliffhangerScore,
        adaptationDifficultyScore: ev.adaptationDifficultyScore,
        issues: ev.issues,
        suggestions: ev.suggestions,
        rawResult: JSON.stringify(ev),
      })
      return { evaluation: created, result: { kind: 'evaluation', data: created } }
    }

    // v0.2：生成章节记忆（每章一份，存在则更新）
    if (taskType === 'summarize_chapter' && state.projectId && state.chapterId) {
      const m = state.parsedOutput as ChapterMemoryResult
      const existing = repos.chapterMemory.getChapterMemoryByChapter(db, state.projectId, state.chapterId)
      const payload = {
        summary: m.summary,
        importantEvents: m.importantEvents,
        characterChanges: m.characterChanges,
        revealedSecrets: m.revealedSecrets,
        newForeshadowing: m.newForeshadowing,
        resolvedForeshadowing: m.resolvedForeshadowing,
        keyVisualElements: m.keyVisualElements,
      }
      const created = existing
        ? repos.chapterMemory.updateChapterMemory(db, existing.id, payload)
        : repos.chapterMemory.createChapterMemory(db, { projectId: state.projectId, chapterId: state.chapterId, ...payload })
      return { result: { kind: 'chapter_memory', data: created } }
    }

    // v0.2：更新人物状态（按 characterId 追加一条快照）
    if (taskType === 'update_character_state' && state.projectId && state.characterId) {
      const s = state.parsedOutput as CharacterStateResult
      const created = repos.characterState.createCharacterState(db, {
        projectId: state.projectId,
        characterId: state.characterId,
        chapterId: state.chapterId,
        currentStatus: s.currentStatus,
        emotionalState: s.emotionalState,
        relationshipChanges: s.relationshipChanges,
        knownSecrets: s.knownSecrets,
        hiddenSecrets: s.hiddenSecrets,
        visualContinuityNotes: s.visualContinuityNotes,
      })
      return { result: { kind: 'character_state', data: created } }
    }

    // v0.2：提取故事事件（批量追加）
    if (taskType === 'extract_story_events' && state.projectId) {
      const projectId = state.projectId
      const items = state.parsedOutput as StoryEventsResult
      const baseIndex = repos.storyEvent.listStoryEvents(db, projectId).length
      const created = items.map((it, idx) =>
        repos.storyEvent.createStoryEvent(db, {
          projectId,
          chapterId: it.chapterId ?? state.chapterId,
          title: it.title,
          description: it.description,
          eventType: it.eventType,
          relatedCharacterIds: it.relatedCharacterIds,
          orderIndex: baseIndex + idx,
        }),
      )
      return { result: { kind: 'story_events', data: created } }
    }

    // v0.2：提取伏笔（批量追加）
    if (taskType === 'extract_foreshadowing' && state.projectId) {
      const projectId = state.projectId
      const items = state.parsedOutput as ForeshadowingResult
      const created = items.map((it) =>
        repos.foreshadowing.createForeshadowing(db, {
          projectId,
          title: it.title,
          description: it.description,
          status: it.status,
          payoffPlan: it.payoffPlan,
          setupChapterId: it.setupChapterId ?? state.chapterId,
          payoffChapterId: it.payoffChapterId,
          relatedCharacterIds: it.relatedCharacterIds,
        }),
      )
      return { result: { kind: 'foreshadowings', data: created } }
    }

    // v0.3：分析戏剧节拍（清空旧节拍后批量写入）
    if (taskType === 'analyze_beats' && state.projectId && state.chapterId) {
      const projectId = state.projectId
      const items = state.parsedOutput as BeatsResult
      repos.beat.deleteBeatsByChapter(db, state.chapterId)
      const baseIndex = repos.beat.listBeats(db, projectId).length
      const created = items.map((it, idx) =>
        repos.beat.createBeat(db, {
          projectId,
          chapterId: state.chapterId,
          type: it.type,
          title: it.title,
          description: it.description,
          dramaValue: it.dramaValue,
          visualValue: it.visualValue,
          relatedCharacterIds: it.relatedCharacterIds,
          orderIndex: baseIndex + idx,
        }),
      )
      return { result: { kind: 'beats', data: created } }
    }

    // v0.3：爽点分析（按章节 upsert）
    if (taskType === 'analyze_highlights' && state.projectId && state.chapterId) {
      const h = state.parsedOutput as HighlightAnalysisResult
      const created = repos.highlight.upsertHighlightByChapter(db, {
        projectId: state.projectId,
        chapterId: state.chapterId,
        faceSlap: h.faceSlap,
        revenge: h.revenge,
        identityReveal: h.identityReveal,
        misunderstandingCleared: h.misunderstandingCleared,
        pampering: h.pampering,
        counterKill: h.counterKill,
        counterattack: h.counterattack,
        angst: h.angst,
        highlightTypes: h.highlightTypes,
        summary: h.summary,
        suggestions: h.suggestions,
      })
      return { result: { kind: 'highlight', data: created } }
    }

    // v0.3：AI 视频可行性分析（按章节 upsert）
    if (taskType === 'analyze_ai_video_feasibility' && state.projectId && state.chapterId) {
      const f = state.parsedOutput as AiVideoFeasibilityResult
      const created = repos.feasibility.upsertFeasibilityByChapter(db, {
        projectId: state.projectId,
        chapterId: state.chapterId,
        characterCountScore: f.characterCountScore,
        actionComplexityScore: f.actionComplexityScore,
        interactionDensityScore: f.interactionDensityScore,
        sceneStabilityScore: f.sceneStabilityScore,
        visualClarityScore: f.visualClarityScore,
        characterConsistencyScore: f.characterConsistencyScore,
        generatableScore: f.generatableScore,
        verticalSuitabilityScore: f.verticalSuitabilityScore,
        promptControllabilityScore: f.promptControllabilityScore,
        overallScore: f.overallScore,
        risks: f.risks,
        suggestions: f.suggestions,
      })
      return { result: { kind: 'feasibility', data: created } }
    }

    // v0.3：全书 AI 短剧趋势分析（按项目 upsert）
    if (taskType === 'analyze_project_ai_drama_trend' && state.projectId) {
      const t = state.parsedOutput as DramaTrendResult
      const created = repos.dramaTrend.upsertDramaTrend(db, {
        projectId: state.projectId,
        hookTrend: t.hookTrend,
        conflictTrend: t.conflictTrend,
        reversalTrend: t.reversalTrend,
        emotionTrend: t.emotionTrend,
        cliffhangerTrend: t.cliffhangerTrend,
        visualizationTrend: t.visualizationTrend,
        aiVideoFeasibilityTrend: t.aiVideoFeasibilityTrend,
        characterConsistencyTrend: t.characterConsistencyTrend,
        shotClarityTrend: t.shotClarityTrend,
        overallTrend: t.overallTrend,
        summary: t.summary,
      })
      return { result: { kind: 'drama_trend', data: created } }
    }

    // v0.4：单集重写 / 增强钩子 / 增强画面（自动 upsert 单集，需 episodeId + adaptationProjectId）
    if (
      (taskType === 'rewrite_episode_outline' ||
        taskType === 'enhance_episode_hook' ||
        taskType === 'enhance_episode_visuals') &&
      state.episodeId &&
      state.adaptationProjectId
    ) {
      const it = state.parsedOutput as EpisodeItem
      const updated = repos.episode.updateEpisode(db, state.episodeId, {
        adaptationProjectId: state.adaptationProjectId,
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
      })
      return { result: { kind: 'episode', data: updated } }
    }

    // v0.4：前 10 集分析（按改编项目 upsert）
    if (taskType === 'analyze_first_10_episodes' && state.adaptationProjectId) {
      const a = state.parsedOutput as First10AnalysisResult
      const created = repos.episodeAnalysis.upsertEpisodeAnalysis(db, {
        adaptationProjectId: state.adaptationProjectId,
        hookStrengthTrend: a.hookStrengthTrend,
        retentionScoreTrend: a.retentionScoreTrend,
        paceScoreTrend: a.paceScoreTrend,
        reversalDensityTrend: a.reversalDensityTrend,
        visualAppealTrend: a.visualAppealTrend,
        summary: a.summary,
        suggestions: a.suggestions,
      })
      return { result: { kind: 'episode_analysis', data: created } }
    }

    // v0.5：剧本生成 / 重写 / 增强（按集 upsert，自动落库；需 episodeId + adaptationProjectId + 当前集）
    if (
      (taskType === 'generate_ai_drama_script' ||
        taskType === 'rewrite_ai_drama_script' ||
        taskType === 'enhance_dialogue_conflict' ||
        taskType === 'enhance_script_dialogue_voice' ||
        taskType === 'enhance_episode_cliffhanger' ||
        taskType === 'enhance_script_visuality') &&
      state.episodeId &&
      state.adaptationProjectId &&
      state.currentEpisode
    ) {
      const r = state.parsedOutput as ScriptResult
      const ep = state.currentEpisode
      if (taskType !== 'generate_ai_drama_script' || state.currentScript) {
        return textPreview({
          targetKind: 'script',
          targetId: state.currentScript?.id,
          title: `第 ${ep.episodeNumber} 集 · ${ep.title}`,
          taskType,
          currentContent: state.currentScript?.content ?? '',
          nextContent: r.content,
          projectId: state.projectId,
          adaptationProjectId: state.adaptationProjectId,
          episodeId: state.episodeId,
          script: {
            episodeNumber: ep.episodeNumber,
            title: ep.title,
            content: r.content,
            hook: r.hook,
            mainConflict: r.mainConflict,
            emotionalBeat: r.emotionalBeat,
            reversal: r.reversal,
            cliffhanger: r.cliffhanger,
            estimatedDuration: r.estimatedDuration,
          },
        })
      }
      const created = repos.script.upsertScriptByEpisode(db, {
        adaptationProjectId: state.adaptationProjectId,
        episodeId: state.episodeId,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        content: r.content,
        hook: r.hook,
        mainConflict: r.mainConflict,
        emotionalBeat: r.emotionalBeat,
        reversal: r.reversal,
        cliffhanger: r.cliffhanger,
        estimatedDuration: r.estimatedDuration,
      })
      repos.creative.createContentVersion(db, {
        projectId: state.projectId,
        targetKind: 'script',
        targetId: created.id,
        label: `AI 覆写：${taskType}`,
        source: 'ai_overwrite',
        content: created.content,
        meta: { taskType, episodeId: state.episodeId },
      })
      return { result: { kind: 'script', data: created } }
    }

    // v0.5：拆分剧本为场景（清空当前剧本旧场景后批量写入；需 currentScript）
    if (taskType === 'split_script_to_scenes' && state.currentScript) {
      const scriptId = state.currentScript.id
      const episodeId = state.currentScript.episodeId
      const items = state.parsedOutput as ScenesResult
      const previousScenes = repos.scene.listScenesByScript(db, scriptId).map((scene) =>
        snapshotScene(scene, repos.shot.listShotsByScene(db, scene.id)),
      )
      repos.creative.createContentVersion(db, {
        projectId: state.projectId,
        targetKind: 'script',
        targetId: scriptId,
        label: `场景结构检查点：${state.currentScript.title}`,
        source: 'manual_checkpoint',
        content: renderSceneStructureSnapshot(previousScenes),
        meta: {
          phase: 'before_structure_replace',
          structureSnapshot: 'script_scenes',
          taskType,
          episodeId,
          sceneCount: previousScenes.length,
          scenes: previousScenes,
        },
      })
      repos.scene.deleteScenesByScript(db, scriptId)
      const created = items.map((it, idx) =>
        repos.scene.createScene(db, {
          scriptId,
          episodeId,
          sceneNumber: idx + 1,
          title: it.title,
          location: it.location,
          timeOfDay: it.timeOfDay,
          visualDescription: it.visualDescription,
          characters: it.characters,
          summary: it.summary,
          orderIndex: idx,
        }),
      )
      return { result: { kind: 'scenes', data: created } }
    }

    // v0.5：剧本审稿（按剧本 upsert；需 currentScript）
    if (taskType === 'review_ai_drama_script' && state.currentScript) {
      const rv = state.parsedOutput as ScriptReviewResult
      const created = repos.scriptReview.upsertScriptReview(db, {
        scriptId: state.currentScript.id,
        hookStrengthScore: rv.hookStrengthScore,
        dialogueScore: rv.dialogueScore,
        conflictScore: rv.conflictScore,
        visualClarityScore: rv.visualClarityScore,
        sceneClarityScore: rv.sceneClarityScore,
        characterFitScore: rv.characterFitScore,
        shotReadinessScore: rv.shotReadinessScore,
        aiVideoFeasibilityScore: rv.aiVideoFeasibilityScore,
        cliffhangerScore: rv.cliffhangerScore,
        overallScore: rv.overallScore,
        issues: rv.issues,
        suggestions: rv.suggestions,
      })
      return { result: { kind: 'script_review', data: created } }
    }

    // v0.6：场景拆分镜头（清空当前场景旧镜头后批量写入；需 currentScene）
    if (taskType === 'split_scene_to_shots' && state.currentScene) {
      const scene = state.currentScene
      const items = state.parsedOutput as ShotsResult
      const previousShots = repos.shot.listShotsByScene(db, scene.id).map(snapshotShot)
      repos.creative.createContentVersion(db, {
        projectId: state.projectId,
        targetKind: 'scene',
        targetId: scene.id,
        label: `镜头结构检查点：${scene.title}`,
        source: 'manual_checkpoint',
        content: renderShotStructureSnapshot(previousShots),
        meta: {
          phase: 'before_structure_replace',
          structureSnapshot: 'scene_shots',
          taskType,
          episodeId: scene.episodeId,
          sceneId: scene.id,
          shotCount: previousShots.length,
          shots: previousShots,
        },
      })
      repos.shot.deleteShotsByScene(db, scene.id)
      const created = items.map((it, idx) =>
        repos.shot.createShot(db, {
          sceneId: scene.id,
          episodeId: scene.episodeId,
          shotNumber: idx + 1,
          durationSeconds: it.durationSeconds,
          visualDescription: it.visualDescription,
          characterIds: it.characterIds,
          dialogue: it.dialogue,
          narration: it.narration,
          cameraAngle: it.cameraAngle,
          cameraMovement: it.cameraMovement,
          emotion: it.emotion,
          action: it.action,
        }),
      )
      return { result: { kind: 'shots', data: created } }
    }

    // v0.6：镜头 Prompt 生成 / 负面 Prompt / 改写 / 平台优化（更新当前镜头字段 + 追加 Prompt 版本快照；需 currentShot）
    if (
      (taskType === 'generate_shot_prompt' ||
        taskType === 'generate_negative_prompt' ||
        taskType === 'rewrite_shot_prompt' ||
        taskType === 'optimize_prompt_for_video_platform') &&
      state.currentShot
    ) {
      const shot = state.currentShot
      const r = state.parsedOutput as ShotPromptResult
      const patch: TextDiffPreviewPayload['shotPatch'] = {}
      if (r.videoPrompt !== undefined) patch.videoPrompt = r.videoPrompt
      if (r.negativePrompt !== undefined) patch.negativePrompt = r.negativePrompt
      if (r.imagePrompt !== undefined) patch.imagePrompt = r.imagePrompt
      return textPreview({
        targetKind: 'shot',
        targetId: shot.id,
        title: `镜头 ${shot.shotNumber}`,
        taskType,
        currentContent: renderShotPromptText({
          videoPrompt: shot.videoPrompt,
          negativePrompt: shot.negativePrompt,
          imagePrompt: shot.imagePrompt,
        }),
        nextContent: renderShotPromptText({
          videoPrompt: patch.videoPrompt ?? shot.videoPrompt,
          negativePrompt: patch.negativePrompt ?? shot.negativePrompt,
          imagePrompt: patch.imagePrompt ?? shot.imagePrompt,
        }),
        projectId: state.projectId,
        adaptationProjectId: state.adaptationProjectId,
        episodeId: state.episodeId,
        sceneId: state.sceneId,
        shotId: shot.id,
        note: taskType === 'optimize_prompt_for_video_platform' ? state.userInstruction : undefined,
        shotPatch: patch,
      })
    }

    // v0.6：镜头审查（按镜头 upsert；需 currentShot）
    if (taskType === 'review_shot_prompt' && state.currentShot) {
      const rv = state.parsedOutput as ShotReviewResult
      const created = repos.shotReview.upsertShotReview(db, {
        shotId: state.currentShot.id,
        lengthScore: rv.lengthScore,
        characterCountScore: rv.characterCountScore,
        actionComplexityScore: rv.actionComplexityScore,
        visualClarityScore: rv.visualClarityScore,
        characterConsistencyScore: rv.characterConsistencyScore,
        sceneContinuityScore: rv.sceneContinuityScore,
        promptControllabilityScore: rv.promptControllabilityScore,
        verticalSuitabilityScore: rv.verticalSuitabilityScore,
        overallScore: rv.overallScore,
        aiVideoDifficulty: rv.aiVideoDifficulty,
        issues: rv.issues,
        suggestions: rv.suggestions,
      })
      // 同步把难度评级写回镜头本身，便于列表筛选
      repos.shot.updateShot(db, state.currentShot.id, { aiVideoDifficulty: rv.aiVideoDifficulty })
      return { result: { kind: 'shot_review', data: created } }
    }

    if (taskType === 'analyze_trope_freshness') {
      const r = state.parsedOutput as FreshnessReportResult
      const target = inferCreativeTarget(state)
      const created = repos.creative.createFreshnessReport(db, {
        projectId: state.projectId,
        targetKind: target.kind,
        targetId: target.id,
        targetTitle: target.title,
        originalityScore: r.originalityScore,
        predictabilityScore: r.predictabilityScore,
        tropeRiskScore: r.tropeRiskScore,
        characterFreshnessScore: r.characterFreshnessScore,
        conflictFreshnessScore: r.conflictFreshnessScore,
        reversalFreshnessScore: r.reversalFreshnessScore,
        emotionalFreshnessScore: r.emotionalFreshnessScore,
        overallScore: r.overallScore,
        clicheSignals: r.clicheSignals,
        audiencePredictionPoints: r.audiencePredictionPoints,
        suggestions: r.suggestions,
        rawResult: JSON.stringify(r),
      })
      return { result: { kind: 'freshness_report', data: created } }
    }

    if (taskType === 'generate_anti_trope_variants') {
      const items = state.parsedOutput as AntiTropeVariantsResult
      const target = inferCreativeTarget(state)
      const created = items.map((it) =>
        repos.creative.createAntiTropeVariant(db, {
          projectId: state.projectId,
          targetKind: target.kind,
          targetId: target.id,
          ...it,
        }),
      )
      return { result: { kind: 'anti_trope_variants', data: created } }
    }

    if (taskType === 'analyze_narrative_curve') {
      const r = state.parsedOutput as NarrativeCurveResult
      const target = inferCreativeTarget(state)
      const created = repos.creative.createNarrativeCurveReport(db, {
        projectId: state.projectId,
        adaptationProjectId: state.adaptationProjectId,
        targetKind: target.kind,
        targetId: target.id,
        hookCurve: r.hookCurve,
        conflictCurve: r.conflictCurve,
        reversalCurve: r.reversalCurve,
        emotionCurve: r.emotionCurve,
        cliffhangerCurve: r.cliffhangerCurve,
        freshnessCurve: r.freshnessCurve,
        summary: r.summary,
        weakSpots: r.weakSpots,
      })
      return { result: { kind: 'narrative_curve', data: created } }
    }

    if (taskType === 'generate_revision_tasks') {
      const items = state.parsedOutput as RevisionTasksResult
      const target = inferCreativeTarget(state)
      const created = items.map((it) =>
        repos.creative.createRevisionTask(db, {
          projectId: state.projectId,
          targetKind: target.kind,
          targetId: target.id,
          title: it.title,
          description: it.description,
          priority: it.priority,
          suggestedAction: it.suggestedAction,
          expectedBenefit: it.expectedBenefit,
        }),
      )
      return { result: { kind: 'revision_tasks', data: created } }
    }

    if (taskType === 'run_quality_gate') {
      const r = state.parsedOutput as QualityGateResult
      const target = inferCreativeTarget(state)
      const stage = r.stage ?? inferQualityGateStage(state)
      const verdict = r.blockingIssues.length > 0 ? 'block' : r.verdict
      const created = repos.creative.createQualityGateReport(db, {
        projectId: state.projectId,
        adaptationProjectId: state.adaptationProjectId,
        targetKind: target.kind,
        targetId: target.id,
        stage,
        score: r.score,
        verdict,
        blockingIssues: r.blockingIssues,
        warnings: r.warnings,
        suggestions: r.suggestions,
      })
      return { result: { kind: 'quality_gate', data: created } }
    }

    if (taskType === 'simulate_audience_reaction') {
      const r = state.parsedOutput as AudienceSimulationResult
      const target = inferCreativeTarget(state)
      const created = repos.creative.createAudienceSimulation(db, {
        projectId: state.projectId,
        targetKind: target.kind,
        targetId: target.id,
        audienceProfile: r.audienceProfile,
        retentionScore: r.retentionScore,
        emotionalEngagementScore: r.emotionalEngagementScore,
        noveltyScore: r.noveltyScore,
        likelyDropOffPoints: r.likelyDropOffPoints,
        mostMemorableMoments: r.mostMemorableMoments,
        complaints: r.complaints,
        shareableClips: r.shareableClips,
        summary: r.summary,
      })
      return { result: { kind: 'audience_simulation', data: created } }
    }

    if (taskType === 'analyze_video_cost_risk') {
      const r = state.parsedOutput as VideoCostRiskResult
      const target = inferCreativeTarget(state)
      const created = repos.creative.createQualityGateReport(db, {
        projectId: state.projectId,
        adaptationProjectId: state.adaptationProjectId,
        targetKind: target.kind,
        targetId: target.id,
        stage: 'shots_to_video',
        score: r.score,
        verdict: r.blockingIssues.length > 0 ? 'block' : r.verdict,
        blockingIssues: r.blockingIssues,
        warnings: [...r.risks, ...r.simplifications],
        suggestions: r.suggestions,
      })
      return { result: { kind: 'video_cost_risk', data: created } }
    }

    if (taskType === 'extract_case_structure') {
      const r = state.parsedOutput as CaseStructureResult
      const created = repos.creative.createCaseStudy(db, r)
      return { result: { kind: 'case_study', data: created } }
    }

    // 其余任务（项目/人物/大纲/视觉档案/视觉设定/一致性检查/长上下文/改编策略/分集生成）：最小闭环不落库，仅回传结果
    // —— generate_* 与 generate_visual_* 由 persistence.ts 在用户「采用」后落库
    // —— check_consistency / build_long_context 仅回传结果供 UI 展示
    return { result: { kind: taskType, data: state.parsedOutput } }
  }
}

function textPreview(data: TextDiffPreviewPayload): { result: { kind: 'text_preview'; data: TextDiffPreviewPayload } } {
  return { result: { kind: 'text_preview', data } }
}

function renderShotPromptText(input: {
  videoPrompt?: string
  negativePrompt?: string
  imagePrompt?: string
}): string {
  return [
    `视频 Prompt:\n${input.videoPrompt ?? ''}`,
    `负面 Prompt:\n${input.negativePrompt ?? ''}`,
    `图片 Prompt:\n${input.imagePrompt ?? ''}`,
  ].join('\n\n')
}

function inferCreativeTarget(state: NovelGraphStateType): { kind: 'project' | 'chapter' | 'adaptation' | 'episode' | 'script' | 'scene' | 'shot'; id?: string; title?: string } {
  if (state.currentShot) return { kind: 'shot', id: state.currentShot.id, title: `镜头 ${state.currentShot.shotNumber}` }
  if (state.currentScene) return { kind: 'scene', id: state.currentScene.id, title: state.currentScene.title }
  if (state.currentScript) return { kind: 'script', id: state.currentScript.id, title: state.currentScript.title }
  if (state.currentEpisode) return { kind: 'episode', id: state.currentEpisode.id, title: state.currentEpisode.title }
  if (state.adaptationProject) return { kind: 'adaptation', id: state.adaptationProject.id, title: state.adaptationProject.title }
  if (state.currentChapter) return { kind: 'chapter', id: state.currentChapter.id, title: state.currentChapter.title }
  if (state.project) return { kind: 'project', id: state.project.id, title: state.project.title }
  return { kind: 'project', id: state.projectId }
}

function inferQualityGateStage(state: NovelGraphStateType): 'novel_to_adaptation' | 'episodes_to_scripts' | 'scripts_to_shots' | 'shots_to_video' {
  if (state.currentShot || state.currentScene) return 'shots_to_video'
  if (state.currentScript) return 'scripts_to_shots'
  if (state.currentEpisode || state.adaptationProject) return 'episodes_to_scripts'
  return 'novel_to_adaptation'
}
