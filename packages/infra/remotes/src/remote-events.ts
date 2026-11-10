/**
 * The one home of this application's forwarded-Host-event allowlist. Both
 * compiler faces list this file, so the Host forwarding loop and the consumer
 * `ctx.remote.$on` key face read one declaration instead of two copies that
 * could drift; `./types.ts` derives the type projection from it and stays
 * type-only.
 */

import type {} from '@dramaip/infra-credentials/types'
import type {} from '@dramaip/infra-settings/types'
import type { TypertForwardableEventEntry } from '@dramaip/infra-typert-protocol'

/**
 * Host events this application forwards without renaming. Every entry is an
 * `emit` notification: the forwarding loop has no waterfall bridge, so the
 * `satisfies` clause admits no other mode. An entry declares readers of the
 * resources its payload carries, or none to touch the built-in `global`
 * resource; it reaches a non-owner Peer only when access control allows it.
 */
export const API_REMOTE_FORWARDED_EVENTS = [
  { event: 'credentials/record-updated', mode: 'emit' },
  { event: 'credentials/reference-updated', mode: 'emit' },
  { event: 'settings/document-updated', mode: 'emit' },
] as const satisfies readonly (TypertForwardableEventEntry & { readonly mode: 'emit' })[]
