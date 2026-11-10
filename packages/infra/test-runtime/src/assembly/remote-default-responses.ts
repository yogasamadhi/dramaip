/**
 * Default responses for every Remote endpoint the web assembly calls while
 * booting and rendering with default settings. The comment above each row
 * names the plugin that calls it; endpoints boot never touches stay absent so
 * a new call fails loud. `$events` is built into `RemoteMock`.
 * @module @dramaip/infra-test-runtime/src/assembly/remote-default-responses
 */
import { ok, openStream, type RemoteTable } from '@dramaip/infra-remote-mock'

/** Default responses of the boot-time Remote endpoints; a spec loads it first and layers its own table on top. */
export const remoteDefaultResponses: RemoteTable = {
  unary: {
    // ui-settings `mirror.ensure()` at apply and again on `connection/reset`.
    'settings/describe': ok({ writable: true, hasDocument: false, namespaces: [] }),
    // workspace-studio-client: the existing app probes `/health`, then reads
    // `/api/v2/runtime`, through its system bridge; protocol 2 and plugin API
    // 1, an empty graph.
    'system/health': ok({ healthy: true, version: 'test', apiVersion: '2' }),
    'system/runtime': ok({
      apiVersion: '2',
      pluginApiVersion: '1',
      runtimeId: 'test-runtime',
      runtimeGeneration: 1,
      graphRevision: 'test',
      profile: 'web',
      mode: 'server',
      bundles: [],
      plugins: [],
      capabilities: {},
      capabilityDescriptors: [],
      engineStatus: {},
      uiContributions: [],
    }),
  },
  stream: {
    // remote-access client `mountAccess`: the owner's access snapshot, then open.
    'remoteAccess/follow': openStream([{ type: 'baseline', owner: true }]),
  },
}
