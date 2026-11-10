/**
 * Test-only `session` slot scope. No DramaIP plugin owns the scope yet, so the
 * renderer specs supply the scope's merge themselves (a branded id, the
 * reference a scope target carries, and the session pair the standard kit
 * synthesizes) and install its adapter through the real registry.
 */
import { Fragment, createElement } from 'react'
import { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@dramaip/infra-ui-renderer/client'
import type { HostObservable, SlotScopeAdapter, StandardSourceBinding } from '@dramaip/infra-ui-slots'

/** Branded Session identity used by the renderer specs. */
export type TestSessionId = string & { readonly __testSession: unique symbol }

/** Selector hook over one Session's snapshot. */
export type TestSessionSelector = <S>(selector: (snapshot: unknown) => S, equal?: (a: S, b: S) => boolean) => S

/** Scope target the renderer specs select. */
export interface TestSessionReference {
  readonly sessionId: TestSessionId
}

/** Brand one Session id for a spec. */
export const sid = (value: string): TestSessionId => value as TestSessionId

declare module '@dramaip/infra-ui-slots' {
  interface SlotScopeTargetMap {
    session: TestSessionReference
  }

  interface SessionStandardProps {
    useSession: TestSessionSelector
    sessionId: TestSessionId
    useProjection: (key: string) => unknown
  }

  interface SessionMaybeStandardProps {
    useSession: TestSessionSelector
    sessionId: TestSessionId | undefined
    useProjection: (key: string) => unknown
  }
}

/** A settable observable value. */
interface Cell<T> extends HostObservable<T> {
  set(next: T): void
}

function cell<T>(initial: T): Cell<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const ABSENT: StandardSourceBinding = Object.freeze({
  key: undefined,
  hooks: Object.freeze({ session: undefined }),
  keyedHooks: Object.freeze({}),
  props: Object.freeze({ sessionId: undefined }),
})

/**
 * The `session` scope owner the renderer specs install: each added Session is
 * one identity-stable binding over its own snapshot source and Context, and a
 * reference selects it as a scope target. No Session is current.
 */
export class TestSessions {
  private readonly references = new Map<string, TestSessionReference>()
  private readonly bindings = new Map<string, HostObservable<StandardSourceBinding>>()
  private readonly absent = cell(ABSENT)

  /**
   * Install the adapter into a runtime's registry for the registry's lifetime.
   * @param slots - the runtime SlotRegistry.
   */
  constructor(slots: SlotRegistry) {
    const adapter: SlotScopeAdapter = {
      current: this.absent,
      bindingSource: (target) => {
        if (target === undefined) return this.absent
        const source = this.bindings.get(target.sessionId)
        if (source === undefined) throw new Error(`unknown test session: ${target.sessionId}`)
        return source
      },
      renderArea: (binding, { empty, children }) => binding.key === undefined
        ? createElement(Fragment, null, empty?.() ?? null)
        : createElement(Fragment, null, children),
    }
    slots.installScope('session', adapter)
  }

  /**
   * Add one Session with its initial snapshot.
   * @param options - the Session id and optional snapshot.
   * @param options.id - Session id.
   * @param options.snapshot - initial `useSession` snapshot; default `{ sid: id }`.
   */
  add({ id, snapshot = { sid: id } }: { id: string, snapshot?: unknown }): void {
    if (this.bindings.has(id)) throw new Error(`test session ${id} already exists`)
    this.bindings.set(id, cell<StandardSourceBinding>({
      key: id,
      ctx: new Context(),
      hooks: { session: cell(snapshot) },
      keyedHooks: {},
      props: { sessionId: id },
    } as StandardSourceBinding))
    this.references.set(id, { sessionId: sid(id) })
  }

  /**
   * The identity-stable scope target of one added Session.
   * @param id - Session id.
   * @returns its reference.
   */
  reference(id: TestSessionId): TestSessionReference {
    const reference = this.references.get(id)
    if (reference === undefined) throw new Error(`unknown test session: ${id}`)
    return reference
  }
}
