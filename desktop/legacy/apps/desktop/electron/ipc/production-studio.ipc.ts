import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS,
  PRODUCTION_STUDIO_FEATURES,
  getImageProviderCapability,
  rankProviderRoutes,
  type FeatureFlagMap,
  type GenerationMode,
  type GenerationPolicyProfile,
  type ProductionNodeRef,
  type ProviderCapabilityReport,
  type ProviderDataPolicy,
} from '@sdns/core'
import { createRetakeTask, preflightRetake, type RetakeTaskInput } from '@sdns/ai'
import { getRepos } from '../db'
import { createImageAssetArchiver } from '../image-assets'
import { beginLongTaskRun, finishLongTaskRun } from '../task-runtime'
import { buildAssetCoverage, buildProductionGraph, previewProductionImpact } from '../production-graph'
import { flushProductAnalytics } from '../analytics-uploader'

export function registerProductionStudioIpc(): void {
  const repos = () => getRepos()
  const imageAssetArchiver = createImageAssetArchiver()

  ipcMain.handle('featureFlags:get', () => resolveFeatureFlags())
  ipcMain.handle('productionGraph:get', (_event, projectId: string) => buildProductionGraph(repos(), projectId))
  ipcMain.handle('productionGraph:coverage', (_event, projectId: string) => buildAssetCoverage(repos(), projectId))
  ipcMain.handle('productionGraph:previewImpact', (_event, projectId: string, source: ProductionNodeRef) =>
    previewProductionImpact(repos(), projectId, source))
  ipcMain.handle('productionGraph:resolveImpact', (_event, id: string, status: 'accepted' | 'resolved' | 'waived', note?: string) =>
    repos().productionStudio.resolveProductionImpact(repos().db, id, status, note))

  ipcMain.handle('retake:preflight', async (_event, input: RetakeTaskInput) =>
    preflightRetake({ repos: repos(), imageAssetArchiver }, input))
  ipcMain.handle('retake:create', async (_event, input: RetakeTaskInput) => {
    const r = repos()
    const longTaskId = randomUUID()
    const runtime = beginLongTaskRun('image', longTaskId)
    if (!runtime.ok) return { ok: false, error: runtime.error }
    r.productionStudio.recordProductAnalyticsEvent(r.db, {
      eventName: 'retake_started',
      appVersion: app.getVersion(),
      operatingSystem: process.platform,
    })
    try {
      const result = await createRetakeTask({ repos: r, imageAssetArchiver }, input, runtime.signal, { longTaskId })
      if (result.ok) {
        r.productionStudio.recordProductAnalyticsEvent(r.db, {
          eventName: 'retake_succeeded',
          appVersion: app.getVersion(),
          operatingSystem: process.platform,
        })
      }
      return result
    } finally {
      finishLongTaskRun(longTaskId)
    }
  })
  ipcMain.handle('retake:list', (_event, projectId: string, shotId?: string) =>
    repos().productionStudio.listRetakeRequests(repos().db, projectId, shotId))
  ipcMain.handle('retake:adopt', (_event, id: string) => adoptRetake(id))
  ipcMain.handle('retake:discard', (_event, id: string) => {
    const r = repos()
    const request = r.productionStudio.getRetakeRequest(r.db, id)
    if (!request) return undefined
    if (!['succeeded', 'failed', 'canceled'].includes(request.status)) throw new Error('当前 Retake 尚不能丢弃')
    return r.productionStudio.updateRetakeRequest(r.db, id, { status: 'discarded' })
  })

  ipcMain.handle('generationRouting:listPolicies', (_event, projectId?: string) =>
    repos().productionStudio.listGenerationPolicyProfiles(repos().db, projectId))
  ipcMain.handle('generationRouting:savePolicy', (_event, input: Omit<GenerationPolicyProfile, 'id' | 'createdAt' | 'updatedAt'>) =>
    repos().productionStudio.saveGenerationPolicyProfile(repos().db, input))
  ipcMain.handle('generationRouting:listDataPolicies', () =>
    repos().productionStudio.listProviderDataPolicies(repos().db))
  ipcMain.handle('generationRouting:saveDataPolicy', (_event, input: Omit<ProviderDataPolicy, 'id' | 'createdAt' | 'updatedAt'>) =>
    repos().productionStudio.saveProviderDataPolicy(repos().db, input))
  ipcMain.handle('generationRouting:decision', (_event, input: {
    projectId?: string
    mode: GenerationMode
    allowedProviderConfigIds?: string[]
    maximumProviders?: number
  }) => routeDecision(input))

  ipcMain.handle('analytics:getConsent', () => repos().productionStudio.getProductAnalyticsSettings(repos().db))
  ipcMain.handle('analytics:setConsent', (_event, consent: 'granted' | 'denied') => {
    const r = repos()
    const settings = r.productionStudio.setProductAnalyticsConsent(r.db, consent)
    if (consent === 'granted') void flushProductAnalytics(r).catch(() => undefined)
    return settings
  })
  ipcMain.handle('analytics:record', (_event, input: { eventName: string; durationBucket?: string; resultCode?: string }) =>
    repos().productionStudio.recordProductAnalyticsEvent(repos().db, {
      ...input,
      appVersion: app.getVersion(),
      operatingSystem: process.platform,
    }))
  ipcMain.handle('analytics:exportLocal', () => ({
    settings: repos().productionStudio.getProductAnalyticsSettings(repos().db),
    events: repos().productionStudio.listPendingProductAnalyticsEvents(repos().db),
  }))
  ipcMain.handle('analytics:clearPending', () => repos().productionStudio.clearPendingProductAnalyticsEvents(repos().db))
}

function adoptRetake(id: string) {
  const r = getRepos()
  const request = r.productionStudio.getRetakeRequest(r.db, id)
  if (!request) return undefined
  if (request.status !== 'succeeded' || !request.resultCandidateId) throw new Error('只有成功且有候选结果的 Retake 才能采用')
  const candidate = r.shotStill.getShotStillCandidate(r.db, request.resultCandidateId)
  const shot = candidate ? r.shot.getShot(r.db, candidate.shotId) : undefined
  if (!candidate || !shot || candidate.projectId !== request.projectId) throw new Error('Retake 候选已不可用')
  const hadCompletedShot = r.shotStill.listShotStillCandidatesByProject(r.db, request.projectId)
    .some((item) => item.status === 'adopted')
  const adopted = r.shotStill.adoptShotStillCandidate(r.db, candidate.id, shot.updatedAt)
  if (!adopted) throw new Error('采用 Retake 候选失败')
  if (!hadCompletedShot) {
    r.productionStudio.recordProductAnalyticsEvent(r.db, {
      eventName: 'first_shot_ready',
      appVersion: app.getVersion(),
      operatingSystem: process.platform,
    })
  }
  const updated = r.productionStudio.updateRetakeRequest(r.db, request.id, { status: 'adopted' }) ?? request
  if (request.lineageId) {
    r.generation.updateGenerationLineage(r.db, request.lineageId, {
      adoptedOutputKind: 'shot_still_candidate',
      adoptedOutputId: candidate.id,
      adoptedAt: new Date().toISOString(),
    })
  }
  for (const review of r.productionStudio.listReviewPackageRecords(r.db, request.projectId, shot.episodeId)) {
    if (['deleted', 'expired'].includes(review.status)) continue
    r.productionStudio.createProductionImpact(r.db, {
      projectId: request.projectId,
      source: { kind: 'still', id: candidate.id, version: candidate.updatedAt, label: candidate.label },
      target: { kind: 'review', id: review.id, version: review.updatedAt, label: review.title },
      reason: '采用了新的 Retake 静帧，现有审片包需要重新生成。',
      severity: 'warning',
    })
  }
  for (const delivery of r.platformDelivery.listPlatformDeliveryExports(r.db, request.projectId, shot.episodeId)) {
    r.productionStudio.createProductionImpact(r.db, {
      projectId: request.projectId,
      source: { kind: 'still', id: candidate.id, version: candidate.updatedAt, label: candidate.label },
      target: { kind: 'delivery', id: delivery.id, version: delivery.createdAt, label: `交付 v${delivery.deliveryVersion}` },
      reason: '采用了新的 Retake 静帧，已有最终交付不再代表当前生产状态。',
      severity: 'blocker',
    })
  }
  r.productionStudio.recordProductAnalyticsEvent(r.db, {
    eventName: 'retake_adopted',
    appVersion: app.getVersion(),
    operatingSystem: process.platform,
  })
  return { request: updated, candidate: adopted }
}

function routeDecision(input: {
  projectId?: string
  mode: GenerationMode
  allowedProviderConfigIds?: string[]
  maximumProviders?: number
}) {
  const r = getRepos()
  const policies = new Map(r.productionStudio.listProviderDataPolicies(r.db).map((policy) => [policy.providerKind, policy]))
  const reports: ProviderCapabilityReport[] = r.imageProviderConfig.listImageProviderConfigs(r.db).map((config) => {
    const observations = r.productionStudio.listProviderObservations(r.db, config.id, 'image_retake').slice(0, 100)
    const completed = observations.filter((item) => item.outcome !== 'canceled')
    const latency = observations.flatMap((item) => item.latencyMs ?? [])
    return {
      providerConfigId: config.id,
      providerKind: config.kind,
      canSubmit: getImageProviderCapability(config).canSubmit,
      capabilities: [
        ...(getImageProviderCapability(config).supportsTextToImage ? ['image_generation'] : []),
        ...(getImageProviderCapability(config).supportsImageEdit ? ['image_edit'] : []),
      ],
      successRate: completed.length
        ? completed.filter((item) => item.outcome === 'success').length / completed.length
        : undefined,
      medianLatencyMs: median(latency),
      policy: policies.get(config.kind),
      reasons: getImageProviderCapability(config).reason ? [getImageProviderCapability(config).reason!] : [],
    }
  })
  const stored = r.productionStudio.listGenerationPolicyProfiles(r.db, input.projectId)
    .find((profile) => profile.mode === input.mode)
  return rankProviderRoutes({
    mode: input.mode,
    reports,
    allowedProviderConfigIds: input.allowedProviderConfigIds ?? stored?.allowedProviderConfigIds,
    maximumProviders: input.maximumProviders ?? stored?.maximumProviders,
  })
}

function resolveFeatureFlags(): FeatureFlagMap {
  const flags = { ...DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS }
  for (const key of PRODUCTION_STUDIO_FEATURES) {
    const envKey = `DRAMAIP_FEATURE_${key.toUpperCase()}`
    if (process.env[envKey] === 'true') flags[key] = true
    if (process.env[envKey] === 'false') flags[key] = false
  }
  return flags
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}
