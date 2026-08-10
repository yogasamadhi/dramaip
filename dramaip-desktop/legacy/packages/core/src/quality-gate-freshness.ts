import type {
  AdaptationProject,
  Chapter,
  Character,
  Episode,
  Outline,
  Project,
  QualityGateStage,
  Scene,
  Script,
  Shot,
} from './types'

/**
 * 质量报告绑定的源内容快照。指纹不是安全散列，而是用于判断同一份可读业务内容
 * 是否已经发生变化；不得用于安全或签名用途。
 */
export interface QualityGateSourceSnapshot {
  stage: QualityGateStage
  project?: Project
  chapters?: Chapter[]
  characters?: Character[]
  outlines?: Outline[]
  adaptation?: AdaptationProject
  episodes?: Episode[]
  scripts?: Script[]
  scenes?: Scene[]
  shots?: Shot[]
}

export function buildQualityGateSourceFingerprint(snapshot: QualityGateSourceSnapshot): string {
  const value = snapshot.stage === 'novel_to_adaptation'
    ? {
        project: snapshot.project && pickProject(snapshot.project),
        chapters: (snapshot.chapters ?? []).map(pickChapter).sort(byId),
        characters: (snapshot.characters ?? []).map(pickCharacter).sort(byId),
        outlines: (snapshot.outlines ?? []).map(pickOutline).sort(byId),
      }
    : snapshot.stage === 'episodes_to_scripts'
      ? {
          adaptation: snapshot.adaptation && pickAdaptation(snapshot.adaptation),
          episodes: (snapshot.episodes ?? []).map(pickEpisode).sort(byId),
        }
      : snapshot.stage === 'scripts_to_shots'
        ? {
            scripts: (snapshot.scripts ?? []).map(pickScript).sort(byId),
            scenes: (snapshot.scenes ?? []).map(pickScene).sort(byId),
          }
        : {
            shots: (snapshot.shots ?? []).map(pickShot).sort(byId),
          }
  return `qg-v1:${snapshot.stage}:${fingerprint(JSON.stringify(value))}`
}

function pickProject(project: Project) {
  return {
    id: project.id,
    title: project.title,
    shortDramaType: project.shortDramaType,
    targetAudience: project.targetAudience,
    targetWordCount: project.targetWordCount,
    targetEpisodeCount: project.targetEpisodeCount,
    coreHook: project.coreHook,
    emotionalCore: project.emotionalCore,
    coreSellingPoint: project.coreSellingPoint,
    synopsis: project.synopsis,
    styleGuide: project.styleGuide,
    visualStyleDirection: project.visualStyleDirection,
  }
}

function pickChapter(chapter: Chapter) {
  return {
    id: chapter.id,
    orderIndex: chapter.orderIndex,
    title: chapter.title,
    summary: chapter.summary,
    outline: chapter.outline,
    content: chapter.content,
    mainConflict: chapter.mainConflict,
    hook: chapter.hook,
    highlight: chapter.highlight,
    reversal: chapter.reversal,
    cliffhanger: chapter.cliffhanger,
    shortDramaNote: chapter.shortDramaNote,
    aiVideoNote: chapter.aiVideoNote,
  }
}

function pickCharacter(character: Character) {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    identity: character.identity,
    personality: character.personality,
    desire: character.desire,
    secret: character.secret,
    weakness: character.weakness,
    arc: character.arc,
    relationshipToProtagonist: character.relationshipToProtagonist,
    conflictTarget: character.conflictTarget,
    emotionalFunction: character.emotionalFunction,
    shortDramaFunction: character.shortDramaFunction,
    visualDescription: character.visualDescription,
    appearancePrompt: character.appearancePrompt,
    negativePrompt: character.negativePrompt,
    notes: character.notes,
  }
}

function pickOutline(outline: Outline) {
  return {
    id: outline.id,
    type: outline.type,
    orderIndex: outline.orderIndex,
    title: outline.title,
    content: outline.content,
  }
}

function pickAdaptation(adaptation: AdaptationProject) {
  return {
    id: adaptation.id,
    title: adaptation.title,
    targetEpisodeCount: adaptation.targetEpisodeCount,
    episodeDuration: adaptation.episodeDuration,
    adaptationStyle: adaptation.adaptationStyle,
    visualStyleDirection: adaptation.visualStyleDirection,
    audience: adaptation.audience,
    seasonNumber: adaptation.seasonNumber,
    strategy: adaptation.strategy,
    sourceChapterRange: adaptation.sourceChapterRange,
  }
}

function pickEpisode(episode: Episode) {
  return {
    id: episode.id,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    summary: episode.summary,
    hook: episode.hook,
    mainConflict: episode.mainConflict,
    reversal: episode.reversal,
    emotionalBeat: episode.emotionalBeat,
    cliffhanger: episode.cliffhanger,
    aiVideoNote: episode.aiVideoNote,
    keyVisuals: episode.keyVisuals,
    relatedChapterIds: episode.relatedChapterIds,
    relatedBeatIds: episode.relatedBeatIds,
  }
}

function pickScript(script: Script) {
  return {
    id: script.id,
    episodeId: script.episodeId,
    episodeNumber: script.episodeNumber,
    title: script.title,
    content: script.content,
    hook: script.hook,
    mainConflict: script.mainConflict,
    emotionalBeat: script.emotionalBeat,
    reversal: script.reversal,
    cliffhanger: script.cliffhanger,
    estimatedDuration: script.estimatedDuration,
  }
}

function pickScene(scene: Scene) {
  return {
    id: scene.id,
    scriptId: scene.scriptId,
    episodeId: scene.episodeId,
    sceneNumber: scene.sceneNumber,
    orderIndex: scene.orderIndex,
    title: scene.title,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    visualDescription: scene.visualDescription,
    characters: scene.characters,
    summary: scene.summary,
  }
}

function pickShot(shot: Shot) {
  return {
    id: shot.id,
    sceneId: shot.sceneId,
    episodeId: shot.episodeId,
    shotNumber: shot.shotNumber,
    durationSeconds: shot.durationSeconds,
    visualDescription: shot.visualDescription,
    characterIds: shot.characterIds,
    dialogue: shot.dialogue,
    videoPrompt: shot.videoPrompt,
    negativePrompt: shot.negativePrompt,
    imagePrompt: shot.imagePrompt,
    coverPrompt: shot.coverPrompt,
    narration: shot.narration,
    subtitleDraft: shot.subtitleDraft,
    cameraAngle: shot.cameraAngle,
    cameraMovement: shot.cameraMovement,
    emotion: shot.emotion,
    action: shot.action,
    consistencyNotes: shot.consistencyNotes,
    aiVideoDifficulty: shot.aiVideoDifficulty,
  }
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
