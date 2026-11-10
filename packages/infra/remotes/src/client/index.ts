/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@deepseek-ai/cordis'
import agentsRemote from '@dramaip/agents-agents/remote'
import automationRemote from '@dramaip/automation-automation/remote'
import settingsControllerRemote from '@dramaip/infra-settings-controller/remote'
import insightsRemote from '@dramaip/insights-insights/remote'
import deliveryRemote from '@dramaip/production-delivery/remote'
import mediaRemote from '@dramaip/production-media/remote'
import productionRemote from '@dramaip/production-production/remote'
import reviewRemote from '@dramaip/production-review/remote'
import timelineRemote from '@dramaip/production-timeline/remote'
import systemRemote from '@dramaip/system-system/remote'
import workspaceRemote from '@dramaip/workspace-workspace/remote'
import knowledgeRemote from '@dramaip/writing-knowledge/remote'
import qualityRemote from '@dramaip/writing-quality/remote'
import writingRemote from '@dramaip/writing-writing/remote'
import type { ClientRemote } from '@dramaip/infra-gateway/client'

export type { ClientRemote } from '@dramaip/infra-gateway/client'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@dramaip/infra-credentials/types'
export type {} from '@dramaip/infra-settings/types'
export type {} from '@dramaip/infra-settings-controller/remote'
export type {} from '@dramaip/system-system/remote'
export type {} from '@dramaip/insights-insights/remote'
export type {} from '@dramaip/production-review/remote'
export type {} from '@dramaip/production-delivery/remote'
export type {} from '@dramaip/workspace-workspace/remote'
export type {} from '@dramaip/writing-writing/remote'
export type {} from '@dramaip/writing-quality/remote'
export type {} from '@dramaip/writing-knowledge/remote'
export type {} from '@dramaip/agents-agents/remote'
export type {} from '@dramaip/automation-automation/remote'
export type {} from '@dramaip/production-timeline/remote'
export type {} from '@dramaip/production-media/remote'
export type {} from '@dramaip/production-production/remote'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ConnectionHandle, ConnectionSinks,
  RpcId, RpcRequest, RpcResponse, RpcResult,
} from '@dramaip/infra-connection/client'
export type {} from '@dramaip/infra-gateway/client'

// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@dramaip/infra-credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@dramaip/infra-settings/types'

// The Remote failure vocabulary, re-exported so business packages keep naming
// this assembly alone. Types only: a value export would make spec imports load
// this module's owner /remote artifacts.
export type {
  RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteResult,
} from '@dramaip/infra-typert-protocol'
export type { RemoteHostFacts } from '@dramaip/infra-gateway/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/**
 * Generated Remote contributions this application selects for every Client.
 * Domain controllers join this list as their routes leave the compat API.
 */
const SELECTED_REMOTES: readonly Parameters<ClientRemote['$mount']>[0][] = [
  settingsControllerRemote,
  // P4-a: runtime identity, diagnostics, events and the Desktop Host actions.
  systemRemote,
  // P4-b: audience feedback, the generation ledger and the outcome reports.
  insightsRemote,
  // P4-b: review packages, compliance and cloud review; delivery and its archives.
  reviewRemote,
  deliveryRemote,
  // P4-c: projects, series, imports, author intents, backups and search.
  workspaceRemote,
  // P4-d: the manuscript, its quality analyses and the story knowledge.
  writingRemote,
  qualityRemote,
  knowledgeRemote,
  // P5-a: agent sessions, engines, providers and the inspiration space;
  // workflows, templates, tasks and change previews.
  agentsRemote,
  automationRemote,
  // P5-b: timelines, renders and playback plans; the media assets, sources,
  // generation, verifications, rights and delivery evidence.
  timelineRemote,
  mediaRemote,
  // P5-c: adaptations, episodes, scripts, scenes and shots, seasons and their
  // plans, diagnoses, strategies, episode developments and screenplay imports.
  productionRemote,
]

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of SELECTED_REMOTES) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
