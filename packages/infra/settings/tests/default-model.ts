/**
 * A live-config consumer for the settings tests: one Service whose volatile
 * Config fields are read on every call, so a settings mutation is observed
 * without restarting its fiber. Adapted from DSH `agent-default-model`.
 */
import type { Volatile } from '@deepseek-ai/cordis'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '../src/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentDefaultModel: DefaultModel
  }
}

/** Selection supplied by plugin configuration. */
export interface Config {
  provider: Volatile<string>
  model: Volatile<string>
}

/** Owns one provider/model selection read from its Config references. */
export class DefaultModel extends Service {
  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
  })

  constructor(ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')
    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
  }

  /** @returns the current provider and model. */
  currentSelection(): { provider: string; model: string } {
    return { provider: this.config.provider.get(), model: this.config.model.get() }
  }
}

export default DefaultModel
