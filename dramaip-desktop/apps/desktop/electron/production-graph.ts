import type {
  AssetCoverageItem,
  ProductionGraphEdge,
  ProductionGraphNode,
  ProductionGraphSnapshot,
  ProductionNodeKind,
  ProductionNodeRef,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'

const CHARACTER_SLOTS = ['face_anchor', 'turnaround', 'expression', 'pose', 'costume', 'voice_reference']
const SCENE_SLOTS = ['scene_layout', 'scene_variant', 'style_frame']

export function buildProductionGraph(repos: Repositories, projectId: string): ProductionGraphSnapshot {
  const project = repos.project.getProject(repos.db, projectId)
  if (!project) throw new Error('未找到要分析的项目')
  const nodes = new Map<string, ProductionGraphNode>()
  const edges: ProductionGraphEdge[] = []
  const addNode = (node: ProductionGraphNode) => nodes.set(nodeKey(node), node)
  const addEdge = (from: ProductionGraphNode, to: ProductionGraphNode, relation: string) => {
    addNode(from)
    addNode(to)
    edges.push({ from, to, relation })
  }
  const projectNode: ProductionGraphNode = { kind: 'project', id: project.id, version: project.updatedAt, label: project.title }
  addNode(projectNode)

  for (const chapter of repos.chapter.listChapters(repos.db, projectId)) {
    addEdge(projectNode, { kind: 'chapter', id: chapter.id, version: chapter.updatedAt, label: chapter.title }, 'contains')
  }

  const adaptations = repos.adaptationProject.listAdaptationsByProject(repos.db, projectId)
  for (const adaptation of adaptations) {
    const adaptationNode: ProductionGraphNode = { kind: 'adaptation', id: adaptation.id, version: adaptation.updatedAt, label: adaptation.title }
    addEdge(projectNode, adaptationNode, 'adapts')
    for (const episode of repos.episode.listEpisodes(repos.db, adaptation.id)) {
      const episodeNode: ProductionGraphNode = { kind: 'episode', id: episode.id, version: episode.updatedAt, label: episode.title }
      addEdge(adaptationNode, episodeNode, 'contains')
      const scripts = repos.script.listScripts(repos.db, adaptation.id).filter((script) => script.episodeId === episode.id)
      for (const script of scripts) {
        const scriptNode: ProductionGraphNode = { kind: 'script', id: script.id, version: script.updatedAt, label: script.title }
        addEdge(episodeNode, scriptNode, 'scripts')
        for (const scene of repos.scene.listScenesByScript(repos.db, script.id)) {
          const sceneNode: ProductionGraphNode = { kind: 'scene', id: scene.id, version: scene.updatedAt, label: scene.title }
          addEdge(scriptNode, sceneNode, 'contains')
          for (const shot of repos.shot.listShotsByScene(repos.db, scene.id)) {
            const shotNode: ProductionGraphNode = { kind: 'shot', id: shot.id, version: shot.updatedAt, label: `镜头 ${shot.shotNumber}` }
            addEdge(sceneNode, shotNode, 'contains')
            for (const lock of repos.visualAsset.listShotVisualAssetLocks(repos.db, shot.id)) {
              const lockNode: ProductionGraphNode = {
                kind: 'shot_lock',
                id: lock.id,
                version: lock.updatedAt,
                label: lock.role,
                stale: Boolean(lock.staleAt),
                status: lock.staleAt ? 'stale' : 'locked',
              }
              addEdge(shotNode, lockNode, 'uses')
              const version = repos.visualAsset.getVisualAssetVersion(repos.db, lock.visualAssetVersionId)
              if (version) {
                addEdge(
                  { kind: 'visual_asset', id: version.id, version: version.updatedAt, label: version.label, status: version.status },
                  lockNode,
                  'locked_by',
                )
              }
            }
            for (const still of repos.shotStill.listShotStillCandidates(repos.db, shot.id)) {
              addEdge(shotNode, {
                kind: 'still',
                id: still.id,
                version: still.updatedAt,
                label: still.label,
                stale: Boolean(still.staleAt),
                status: still.status,
              }, 'renders')
            }
            for (const task of repos.videoTask.listVideoTasksByShot(repos.db, shot.id)) {
              addEdge(shotNode, {
                kind: 'video',
                id: task.id,
                version: task.updatedAt,
                label: task.note || task.model,
                status: task.status,
              }, 'generates')
            }
          }
        }
      }
      for (const track of repos.audio.listAudioTracksByEpisode(repos.db, episode.id)) {
        addEdge(episodeNode, {
          kind: 'audio',
          id: track.id,
          version: track.updatedAt,
          label: track.label,
          stale: track.status === 'stale',
          status: track.status,
        }, 'mixes')
      }
      for (const localization of repos.localization.listLocalizationVariants(repos.db, episode.id)) {
        addEdge(episodeNode, {
          kind: 'localization',
          id: localization.id,
          version: localization.updatedAt,
          label: localization.label,
          stale: Boolean(localization.staleAt),
          status: localization.status,
        }, 'localizes')
      }
      for (const review of repos.productionStudio.listReviewPackageRecords(repos.db, projectId, episode.id)) {
        addEdge(episodeNode, {
          kind: 'review',
          id: review.id,
          version: review.updatedAt,
          label: review.title,
          stale: review.status === 'expired',
          status: review.status,
        }, 'reviews')
      }
      for (const delivery of repos.platformDelivery.listPlatformDeliveryExports(repos.db, projectId, episode.id)) {
        addEdge(episodeNode, {
          kind: 'delivery',
          id: delivery.id,
          version: delivery.createdAt,
          label: `交付 v${delivery.deliveryVersion}`,
        }, 'delivers')
      }
    }
  }

  for (const version of repos.visualAsset.listVisualAssetVersionsByProject(repos.db, projectId)) {
    const owner: ProductionGraphNode = {
      kind: version.ownerKind === 'visual_profile' ? 'story_bible' : 'scene',
      id: version.ownerId,
      label: version.ownerKind === 'visual_profile' ? '角色视觉档案' : '场景视觉设定',
    }
    addEdge(owner, {
      kind: 'visual_asset',
      id: version.id,
      version: version.updatedAt,
      label: version.label,
      status: version.status,
    }, 'versions')
  }

  const impacts = repos.productionStudio.listProductionImpacts(repos.db, projectId)
  return {
    projectId,
    nodes: [...nodes.values()],
    edges,
    impacts,
    openBlockerCount: impacts.filter((impact) => impact.severity === 'blocker' && ['open', 'accepted'].includes(impact.status)).length,
    generatedAt: new Date().toISOString(),
  }
}

export function previewProductionImpact(
  repos: Repositories,
  projectId: string,
  source: ProductionNodeRef,
): Array<{ target: ProductionNodeRef; relationPath: string[]; severity: 'info' | 'warning' | 'blocker' }> {
  const graph = buildProductionGraph(repos, projectId)
  const outbound = new Map<string, ProductionGraphEdge[]>()
  for (const edge of graph.edges) {
    const key = nodeKey(edge.from)
    outbound.set(key, [...(outbound.get(key) ?? []), edge])
  }
  const queue: Array<{ node: ProductionNodeRef; path: string[] }> = [{ node: source, path: [] }]
  const visited = new Set([nodeKey(source)])
  const result: Array<{ target: ProductionNodeRef; relationPath: string[]; severity: 'info' | 'warning' | 'blocker' }> = []
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of outbound.get(nodeKey(current.node)) ?? []) {
      const key = nodeKey(edge.to)
      if (visited.has(key)) continue
      visited.add(key)
      const path = [...current.path, edge.relation]
      queue.push({ node: edge.to, path })
      result.push({
        target: edge.to,
        relationPath: path,
        severity: deliverySeverity(edge.to.kind),
      })
    }
  }
  return result
}

export function buildAssetCoverage(repos: Repositories, projectId: string): AssetCoverageItem[] {
  const versions = repos.visualAsset.listVisualAssetVersionsByProject(repos.db, projectId)
  const locks = repos.visualAsset.listShotVisualAssetLocksByProject(repos.db, projectId)
  const result: AssetCoverageItem[] = []
  for (const character of repos.character.listCharacters(repos.db, projectId)) {
    const profile = repos.visualProfile.getVisualProfileByCharacter(repos.db, character.id)
    for (const slot of CHARACTER_SLOTS) {
      result.push(coverageItem('character', character.id, character.name, profile?.id, slot, versions, locks))
    }
  }
  for (const setting of repos.visualSetting.listVisualSettings(repos.db, projectId)) {
    for (const slot of SCENE_SLOTS) {
      result.push(coverageItem('scene', setting.id, setting.title || '场景设定', setting.id, slot, versions, locks))
    }
  }
  return result
}

function coverageItem(
  ownerKind: AssetCoverageItem['ownerKind'],
  ownerId: string,
  ownerLabel: string,
  versionOwnerId: string | undefined,
  slot: string,
  versions: ReturnType<Repositories['visualAsset']['listVisualAssetVersionsByProject']>,
  locks: ReturnType<Repositories['visualAsset']['listShotVisualAssetLocksByProject']>,
): AssetCoverageItem {
  const candidates = versionOwnerId ? versions.filter((version) => version.ownerId === versionOwnerId && version.slot === slot) : []
  const adopted = candidates.find((version) => version.status === 'adopted')
  const current = adopted ?? candidates[0]
  const relevantLocks = current ? locks.filter((lock) => lock.visualAssetVersionId === current.id) : []
  const stale = relevantLocks.some((lock) => Boolean(lock.staleAt))
  const status: AssetCoverageItem['status'] = !current
    ? 'missing'
    : stale
      ? 'stale'
      : relevantLocks.length
        ? 'locked'
        : current.status === 'adopted'
          ? 'adopted'
          : 'draft'
  return {
    ownerKind,
    ownerId,
    ownerLabel,
    slot,
    status,
    visualAssetVersionId: current?.id,
    assetId: current?.assetId,
    lockCount: relevantLocks.length,
  }
}

function deliverySeverity(kind: ProductionNodeKind): 'info' | 'warning' | 'blocker' {
  if (kind === 'delivery' || kind === 'editor_export') return 'blocker'
  if (['review', 'video', 'audio', 'localization', 'still', 'shot_lock'].includes(kind)) return 'warning'
  return 'info'
}

function nodeKey(node: Pick<ProductionNodeRef, 'kind' | 'id'>): string {
  return `${node.kind}:${node.id}`
}
