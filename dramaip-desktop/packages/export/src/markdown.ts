// Markdown 导出（PROJECT_BRIEF.md §15）
import type {
  AdaptationProject,
  Chapter,
  Character,
  Episode,
  Outline,
  Project,
  Scene,
  Script,
  Shot,
} from '@sdns/core'

export interface ProjectExportData {
  project: Project
  characters?: Character[]
  outlines?: Outline[]
  chapters?: Chapter[]
}

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return ''
  return `- **${label}**：${value}`
}

export function exportChapterMarkdown(chapter: Chapter): string {
  const header = [`# ${chapter.title}`]
  if (chapter.summary) header.push(`> ${chapter.summary}`)
  return `${header.join('\n\n')}\n\n${chapter.content ?? ''}\n`
}

export function exportProjectMarkdown(data: ProjectExportData): string {
  const { project, characters, outlines, chapters } = data
  const parts: string[] = []

  const meta = [
    line('短剧类型', project.shortDramaType),
    line('目标受众', project.targetAudience),
    line('目标字数', project.targetWordCount),
    line('目标集数', project.targetEpisodeCount),
    line('一句话卖点', project.coreHook),
    line('情绪主轴', project.emotionalCore),
    line('核心卖点', project.coreSellingPoint),
    line('视觉风格方向', project.visualStyleDirection),
  ].filter(Boolean)
  parts.push(`# ${project.title}\n\n${meta.join('\n')}`)
  if (project.synopsis) parts.push(`## 故事简介\n\n${project.synopsis}`)

  const bookOutlines = (outlines ?? []).filter((o) => o.type === 'book')
  if (bookOutlines.length) {
    parts.push('## 全书大纲\n\n' + bookOutlines.map((o) => o.content).join('\n\n'))
  }

  if (characters?.length) {
    parts.push(
      '## 人物\n\n' +
        characters
          .map((c) => `### ${c.name}（${c.role}）\n${[c.identity, c.personality, c.desire].filter(Boolean).join('；')}`)
          .join('\n\n'),
    )
  }

  if (chapters?.length) {
    parts.push('## 正文\n\n' + chapters.map((c) => exportChapterMarkdown(c).trim()).join('\n\n---\n\n'))
  }

  return parts.join('\n\n') + '\n'
}

export function exportEpisodeMarkdown(episode: Episode): string {
  const parts: string[] = [`## 第 ${episode.episodeNumber} 集：${episode.title}`]
  parts.push(`> ${episode.summary}`)
  const meta = [
    `**开场钩子**：${episode.hook}`,
    `**核心冲突**：${episode.mainConflict}`,
    episode.reversal ? `**关键反转**：${episode.reversal}` : '',
    episode.emotionalBeat ? `**情绪爆点**：${episode.emotionalBeat}` : '',
    `**结尾悬念**：${episode.cliffhanger}`,
    episode.aiVideoNote ? `**AI视频备注**：${episode.aiVideoNote}` : '',
    episode.keyVisuals.length ? `**关键画面**：${episode.keyVisuals.join('；')}` : '',
  ].filter(Boolean)
  parts.push(meta.join('\n'))
  return parts.join('\n\n') + '\n'
}

export function exportAdaptationMarkdown(
  adaptation: AdaptationProject,
  episodes: Episode[],
): string {
  const parts: string[] = []
  const meta = [
    line('目标集数', adaptation.targetEpisodeCount),
    line('每集时长', adaptation.episodeDuration),
    line('改编风格', adaptation.adaptationStyle),
    line('视觉风格方向', adaptation.visualStyleDirection),
    line('目标受众', adaptation.audience),
  ].filter(Boolean)
  parts.push(`# ${adaptation.title}\n\n${meta.join('\n')}`)

  if (adaptation.strategy) {
    parts.push('## 改编策略\n\n' + adaptation.strategy)
  }

  if (episodes.length) {
    parts.push('## 分集大纲\n\n' + episodes.map((e) => exportEpisodeMarkdown(e).trim()).join('\n\n---\n\n'))
  }

  return parts.join('\n\n') + '\n'
}

/** 导出单集剧本（含剧本正文 Markdown + 拆出的场景清单） */
export function exportScriptMarkdown(script: Script, scenes: Scene[]): string {
  const parts: string[] = [`# 第 ${script.episodeNumber} 集：${script.title}`]
  const meta = [
    line('开场钩子', script.hook),
    line('核心冲突', script.mainConflict),
    line('情绪爆点', script.emotionalBeat),
    line('关键反转', script.reversal),
    line('结尾悬念', script.cliffhanger),
    line('预计时长', script.estimatedDuration),
  ].filter(Boolean)
  if (meta.length) parts.push(meta.join('\n'))

  parts.push('## 剧本正文\n\n' + (script.content?.trim() || '（暂无正文）'))

  if (scenes.length) {
    const body = scenes
      .map(
        (s, i) =>
          `### 场景${i + 1}：${s.title}（${[s.location, s.timeOfDay].filter(Boolean).join(' / ')}）\n${s.summary}\n\n**画面**：${s.visualDescription}\n\n**人物**：${s.characters.join('、') || '—'}`,
      )
      .join('\n\n')
    parts.push('## 场景清单\n\n' + body)
  }

  return parts.join('\n\n') + '\n'
}

/** 导出整本剧本（按集数拼接） */
export function exportScriptsMarkdown(title: string, scripts: Script[]): string {
  const parts: string[] = [`# ${title} · AI 短剧剧本`]
  if (scripts.length) {
    parts.push(
      '## 全部剧本\n\n' +
        scripts.map((s) => exportScriptMarkdown(s, []).trim()).join('\n\n---\n\n'),
    )
  }
  return parts.join('\n\n') + '\n'
}

// v0.6 镜头导出（ROADMAP v0.6）

/** 导出单镜头 Markdown */
export function exportShotMarkdown(shot: Shot): string {
  const parts: string[] = [`## 镜头 ${shot.shotNumber}`]
  const meta = [
    shot.durationSeconds ? `**时长**：${shot.durationSeconds}s` : '',
    shot.cameraAngle ? `**景别/机位**：${shot.cameraAngle}` : '',
    shot.cameraMovement ? `**镜头运动**：${shot.cameraMovement}` : '',
    shot.emotion ? `**情绪**：${shot.emotion}` : '',
    shot.action ? `**动作**：${shot.action}` : '',
    shot.characterIds.length ? `**人物**：${shot.characterIds.join('、')}` : '',
    shot.aiVideoDifficulty ? `**生成难度**：${shot.aiVideoDifficulty}` : '',
  ].filter(Boolean)
  if (meta.length) parts.push(meta.join('\n'))
  parts.push(`**画面**：${shot.visualDescription}`)
  if (shot.dialogue) parts.push(`**对白**：${shot.dialogue}`)
  if (shot.narration) parts.push(`**旁白**：${shot.narration}`)
  parts.push(`**视频 Prompt**：${shot.videoPrompt || '（未生成）'}`)
  if (shot.negativePrompt) parts.push(`**负面 Prompt**：${shot.negativePrompt}`)
  if (shot.imagePrompt) parts.push(`**图片 Prompt**：${shot.imagePrompt}`)
  if (shot.consistencyNotes) parts.push(`**一致性提示**：${shot.consistencyNotes}`)
  return parts.join('\n\n') + '\n'
}

/** 导出某场景下全部镜头 Markdown（含场景标题） */
export function exportShotsMarkdown(sceneTitle: string, shots: Shot[]): string {
  const parts: string[] = [`# 分镜：${sceneTitle}`]
  if (shots.length) {
    parts.push(shots.map((s) => exportShotMarkdown(s).trim()).join('\n\n---\n\n'))
  } else {
    parts.push('（暂无镜头）')
  }
  return parts.join('\n\n') + '\n'
}
