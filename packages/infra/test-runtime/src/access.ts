/**
 * Allow-all access for client specs. Production pages receive the
 * `remoteAccess` Client service and the global-resource `useRemoteAccess` Hook
 * from the remote-access Client plugin. The test runtimes install an
 * allow-all service and `useRemoteAccess` Hook instead, and hand-built
 * component props spread {@link allowAllAccess}; a spec of a refused path
 * overrides the Hook.
 * @module @dramaip/infra-test-runtime/src/access
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemoteAccess } from '@dramaip/infra-remote-access/client'
import type { GlobalStandardProps, HostObservable } from '@dramaip/infra-ui-slots'
import type {} from '@dramaip/infra-ui-renderer/client'

/** The access Hooks every Slot component receives. */
export type AccessStandardProps = Pick<GlobalStandardProps, 'useRemoteAccess'>

/** Access Hooks that allow every action on every resource, for hand-built component props. */
export const allowAllAccess: AccessStandardProps = {
  useRemoteAccess: () => true,
}

const ALLOWED: HostObservable<boolean> = { getSnapshot: () => true, subscribe: () => () => {} }
const allowed = (): HostObservable<boolean> => ALLOWED

/** The `remoteAccess` Client service answering true for every resource. */
const allowAllRemoteAccess: ClientRemoteAccess = { source: allowed }

/**
 * Plugin standing in for the remote-access Client row: it provides an
 * allow-all `remoteAccess` service and the allow-all `useRemoteAccess` Hook on
 * the global resource.
 */
export const allowAllAccessPlugin = {
  name: 'client-test-runtime:allow-all-access',
  inject: ['slots'],
  /** @param ctx - plugin Context with the Slot registry injected. */
  apply(ctx: Context): void {
    ctx.provide('remoteAccess', allowAllRemoteAccess)
    ctx.slots.provideRoot({ keyedHooks: { remoteAccess: allowed } })
  },
}
