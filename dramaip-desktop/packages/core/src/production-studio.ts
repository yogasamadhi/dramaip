/**
 * DramaIP v2 production-studio contracts.
 *
 * These values are intentionally renderer-safe. Secrets, raw media bytes and
 * public review tokens are never represented by the persisted desktop types.
 */

export const PRODUCTION_STUDIO_FEATURES = [
  'director_workspace_v2',
  'retake',
  'production_graph',
  'smart_routing',
  'cloud_review',
  'editor_export',
  'pricing_v2',
] as const

export type ProductionStudioFeature = (typeof PRODUCTION_STUDIO_FEATURES)[number]
export type FeatureFlagMap = Record<ProductionStudioFeature, boolean>

export const DEFAULT_PRODUCTION_STUDIO_FEATURE_FLAGS: FeatureFlagMap = {
  director_workspace_v2: true,
  retake: true,
  production_graph: true,
  smart_routing: true,
  cloud_review: false,
  editor_export: true,
  pricing_v2: true,
}

export type ProductionNodeKind =
  | 'project'
  | 'chapter'
  | 'story_bible'
  | 'adaptation'
  | 'episode'
  | 'script'
  | 'scene'
  | 'shot'
  | 'visual_asset'
  | 'shot_lock'
  | 'still'
  | 'video'
  | 'audio'
  | 'localization'
  | 'review'
  | 'delivery'
  | 'editor_export'

export interface ProductionNodeRef {
  kind: ProductionNodeKind
  id: string
  version?: string
  label?: string
}

export interface ProductionGraphNode extends ProductionNodeRef {
  stale?: boolean
  status?: string
}

export interface ProductionGraphEdge {
  from: ProductionNodeRef
  to: ProductionNodeRef
  relation: string
}

export interface ProductionGraphSnapshot {
  projectId: string
  nodes: ProductionGraphNode[]
  edges: ProductionGraphEdge[]
  impacts: ProductionImpact[]
  openBlockerCount: number
  generatedAt: string
}

export type AssetCoverageStatus = 'missing' | 'draft' | 'adopted' | 'stale' | 'locked'

export interface AssetCoverageItem {
  ownerKind: 'character' | 'scene'
  ownerId: string
  ownerLabel: string
  slot: string
  status: AssetCoverageStatus
  visualAssetVersionId?: string
  assetId?: string
  lockCount: number
}

export type ProductionImpactSeverity = 'info' | 'warning' | 'blocker'
export type ProductionImpactStatus = 'open' | 'accepted' | 'resolved' | 'waived'

export interface ProductionImpact {
  id: string
  projectId: string
  source: ProductionNodeRef
  target: ProductionNodeRef
  reason: string
  severity: ProductionImpactSeverity
  status: ProductionImpactStatus
  resolutionNote?: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

export type RetakeOperation =
  | 'composition'
  | 'expression'
  | 'action'
  | 'costume'
  | 'lighting'
  | 'background'
  | 'character'
  | 'camera'

export type RetakeStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'adopted'
  | 'discarded'
  | 'canceled'

export interface RetakeRequest {
  id: string
  projectId: string
  shotId: string
  sourceCandidateId: string
  operation: RetakeOperation
  instruction: string
  preserveFields: string[]
  referenceAssetIds: string[]
  maskAssetId?: string
  providerConfigId?: string
  status: RetakeStatus
  lineageId?: string
  resultCandidateId?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export type GenerationMode = 'draft' | 'lookdev' | 'final'

export interface GenerationPolicyProfile {
  id: string
  projectId?: string
  mode: GenerationMode
  label: string
  allowedProviderConfigIds: string[]
  maximumProviders: number
  automaticFallback: boolean
  requireCostConfirmation: boolean
  requireReferenceLocks: boolean
  createdAt: string
  updatedAt: string
}

export type ProviderTrainingPolicy = 'no' | 'yes' | 'unknown' | 'contract_only'

export interface ProviderDataPolicy {
  id: string
  providerKind: string
  regions: string[]
  retentionSummary?: string
  trainsOnInputs: ProviderTrainingPolicy
  sourceUrl?: string
  lastVerifiedAt?: string
  userAcknowledgedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ProviderCapabilityReport {
  providerConfigId: string
  providerKind: string
  canSubmit: boolean
  capabilities: string[]
  successRate?: number
  medianLatencyMs?: number
  estimatedCost?: number
  currency?: string
  policy?: ProviderDataPolicy
  reasons: string[]
}

export interface GenerationRouteCandidate {
  providerConfigId: string
  providerKind: string
  score: number
  reasons: string[]
}

export interface GenerationRouteDecision {
  mode: GenerationMode
  candidates: GenerationRouteCandidate[]
  requiresUserConfirmation: boolean
}

export type ReviewPackageKind = 'offline' | 'cloud'
export type ReviewPackageStatus = 'draft' | 'exported' | 'uploading' | 'published' | 'expired' | 'deleted' | 'failed'
export type ReviewDecisionKind = 'approve' | 'return' | 'request_changes' | 'note'

export interface ReviewMediaItem {
  id: string
  shotId: string
  orderIndex: number
  label: string
  relativePath: string
  mimeType: string
  durationSeconds?: number
  sha256?: string
  sizeBytes?: number
}

export interface ReviewPackageManifest {
  format: 'dramaip-review'
  version: 1
  packageId: string
  projectId: string
  adaptationProjectId: string
  episodeId: string
  title: string
  createdAt: string
  expiresAt?: string
  media: ReviewMediaItem[]
}

export interface ReviewComment {
  id: string
  packageId: string
  shotId?: string
  timecodeSeconds?: number
  authorAlias?: string
  body: string
  resolved: boolean
  createdAt: string
  updatedAt: string
}

export interface ReviewDecision {
  id: string
  packageId: string
  shotId?: string
  decision: ReviewDecisionKind
  authorAlias?: string
  note?: string
  createdAt: string
}

export interface ReviewPackageRecord {
  id: string
  projectId: string
  adaptationProjectId: string
  episodeId: string
  kind: ReviewPackageKind
  status: ReviewPackageStatus
  title: string
  manifest: ReviewPackageManifest
  outputPath?: string
  cloudPackageId?: string
  syncCursor?: string
  expiresAt?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export type ProviderObservationOutcome = 'success' | 'failed' | 'canceled'

export interface ProviderObservation {
  id: string
  projectId?: string
  providerConfigId: string
  providerKind: string
  mode: GenerationMode
  taskKind: string
  outcome: ProviderObservationOutcome
  latencyMs?: number
  estimatedCost?: number
  actualCost?: number
  currency?: string
  errorCode?: string
  createdAt: string
}

export interface EditorTimelineClip {
  id: string
  shotId: string
  name: string
  sourcePath?: string
  startSeconds: number
  durationSeconds: number
  sourceInSeconds: number
  sourceOutSeconds: number
  dialogue?: string
  narration?: string
  subtitle?: string
  transition?: 'cut' | 'dissolve' | 'fade'
  mediaKind: 'video' | 'still' | 'slate'
}

export interface EditorTimelineManifest {
  format: 'dramaip-editor-timeline'
  version: 1
  projectId: string
  adaptationProjectId: string
  episodeId: string
  title: string
  frameRate: 24 | 25 | 30
  width: number
  height: number
  clips: EditorTimelineClip[]
  createdAt: string
}

export interface PlanEntitlements {
  includedSeats: number
  byokEnabled: boolean
  offlineReviewEnabled: boolean
  advancedExportEnabled: boolean
  cloudReviewEnabled: boolean
  reviewStorageBytes: number
  reviewRetentionDays: number
  privateGatewayEnabled: boolean
}

export type WorkspaceMemberRole = 'owner' | 'admin' | 'member'

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  role: WorkspaceMemberRole
  status: 'active' | 'invited' | 'removed'
  createdAt: string
  updatedAt: string
}

export interface ProviderRouteInput {
  mode: GenerationMode
  reports: ProviderCapabilityReport[]
  allowedProviderConfigIds?: string[]
  maximumProviders?: number
}

/**
 * Deterministic, explainable routing. Cost is a small tie-breaker only; an
 * unavailable or policy-blocked provider can never win because it is filtered.
 */
export function rankProviderRoutes(input: ProviderRouteInput): GenerationRouteDecision {
  const allowed = input.allowedProviderConfigIds?.length ? new Set(input.allowedProviderConfigIds) : undefined
  const maximum = input.mode === 'lookdev' ? Math.min(2, Math.max(1, input.maximumProviders ?? 2)) : 1
  const candidates = input.reports
    .filter((report) => report.canSubmit && (!allowed || allowed.has(report.providerConfigId)))
    .map((report) => {
      const policyKnown = report.policy?.trainsOnInputs !== 'unknown'
      const reliability = Math.max(0, Math.min(1, report.successRate ?? 0.5))
      const latencyScore = report.medianLatencyMs ? Math.max(0, 1 - report.medianLatencyMs / 180_000) : 0.25
      const costScore = report.estimatedCost === undefined ? 0 : 1 / (1 + Math.max(0, report.estimatedCost))
      const score = Math.round((reliability * 55 + latencyScore * 20 + costScore * 10 + (policyKnown ? 15 : 0)) * 100) / 100
      return {
        providerConfigId: report.providerConfigId,
        providerKind: report.providerKind,
        score,
        reasons: [
          `成功率权重 ${Math.round(reliability * 100)}%`,
          report.medianLatencyMs ? `中位延迟 ${report.medianLatencyMs}ms` : '尚无延迟样本',
          policyKnown ? '数据政策已记录' : '数据政策未知',
        ],
      }
    })
    .sort((left, right) => right.score - left.score || left.providerConfigId.localeCompare(right.providerConfigId))
    .slice(0, maximum)
  return {
    mode: input.mode,
    candidates,
    requiresUserConfirmation: input.mode !== 'draft' || candidates.some((candidate) => {
      const policy = input.reports.find((report) => report.providerConfigId === candidate.providerConfigId)?.policy
      return !policy || policy.trainsOnInputs === 'unknown'
    }),
  }
}
