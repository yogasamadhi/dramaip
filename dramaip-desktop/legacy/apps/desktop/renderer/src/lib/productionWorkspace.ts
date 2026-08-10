export type ProductionStage = 'overview' | 'episodes' | 'scripts' | 'shots' | 'video'
export type ProductionStageState = 'complete' | 'in_progress' | 'blocked'

export interface ProductionWorkspaceCounts {
  targetEpisodes: number
  episodes: number
  scripts: number
  scenes?: number
  shots?: number
  videos?: number
}

export interface ProductionStageSummary {
  key: ProductionStage
  label: string
  state: ProductionStageState
  detail: string
}

const STAGE_LABELS: Record<ProductionStage, string> = {
  overview: '改编策略',
  episodes: '分集规划',
  scripts: '剧本',
  shots: '分镜',
  video: '视频交付',
}

function completed(current: number, required: number): boolean {
  return required > 0 && current >= required
}

function progressDetail(current: number, total: number, unit: string): string {
  if (total === 0) return `等待${unit}`
  return `${current}/${total} ${unit}`
}

/**
 * 只从本地 read model 计算生产壳提示，不写入改编、工作流或质量闸门真值。
 * 这样导航提示不会把“已打开页面”误记成“已完成生产阶段”。
 */
export function buildProductionStageSummaries(counts: ProductionWorkspaceCounts): ProductionStageSummary[] {
  const targetEpisodes = Math.max(0, counts.targetEpisodes)
  const episodeComplete = completed(counts.episodes, targetEpisodes)
  // 不能因为当前只生成了 3 集大纲和 3 集剧本，就把 20 集季目标标记为完成。
  const scriptComplete = episodeComplete && completed(counts.scripts, targetEpisodes)
  const sceneCount = counts.scenes ?? 0
  const shotCount = counts.shots ?? 0
  const videoCount = counts.videos ?? 0
  const sceneReady = scriptComplete && sceneCount > 0
  const storyboardComplete = scriptComplete && completed(sceneCount, targetEpisodes) && completed(shotCount, targetEpisodes)

  return [
    {
      key: 'overview',
      label: STAGE_LABELS.overview,
      state: counts.episodes > 0 ? 'complete' : 'in_progress',
      detail: counts.episodes > 0 ? '已建立生产上下文' : '先定义改编方向',
    },
    {
      key: 'episodes',
      label: STAGE_LABELS.episodes,
      state: episodeComplete ? 'complete' : 'in_progress',
      detail: progressDetail(counts.episodes, targetEpisodes, '集大纲'),
    },
    {
      key: 'scripts',
      label: STAGE_LABELS.scripts,
      state: counts.episodes === 0 ? 'blocked' : scriptComplete ? 'complete' : 'in_progress',
      detail: counts.episodes === 0 ? '先完成分集规划' : progressDetail(counts.scripts, targetEpisodes, '集剧本'),
    },
    {
      key: 'shots',
      label: STAGE_LABELS.shots,
      state: counts.scripts === 0 ? 'blocked' : storyboardComplete ? 'complete' : 'in_progress',
      detail: counts.scripts === 0 ? '先完成剧本' : `场景 ${sceneCount}/${targetEpisodes || '—'} 集 · 镜头 ${shotCount}/${targetEpisodes || '—'} 集（最低覆盖）`,
    },
    {
      key: 'video',
      label: STAGE_LABELS.video,
      state: !sceneReady || shotCount === 0 ? 'blocked' : 'in_progress',
      detail: !sceneReady || shotCount === 0 ? '先准备可生成镜头' : `${videoCount}/${targetEpisodes || '—'} 集视频候选；不代表最终交付`,
    },
  ]
}

export function productionStagePath(adaptationId: string, stage: ProductionStage, episodeId?: string | null): string {
  const episodeQuery = episodeId ? `?episode=${encodeURIComponent(episodeId)}` : ''
  switch (stage) {
    case 'overview': return `/adaptations/${adaptationId}`
    case 'episodes': return `/adaptations/${adaptationId}?section=episodes`
    case 'scripts': return `/adaptations/${adaptationId}/scripts${episodeQuery}`
    case 'shots': return `/adaptations/${adaptationId}/shots${episodeQuery}`
    case 'video': return `/adaptations/${adaptationId}/video${episodeQuery}`
  }
}

export function productionStageLabel(stage: ProductionStage): string {
  return STAGE_LABELS[stage]
}
