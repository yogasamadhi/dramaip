import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ProjectTable } from './domain.ts'
import type { z } from 'zod'

/** Narrow facade of the rc.3 host peer APIs, tested against the installed DSH. */
export interface HostContext {
  tools: { register(definition: ToolDefinition): () => void }
  storageDomain: {
    open(spec: {
      name: string
      version: number
      layout: 'single'
      tables: { projects: { valueSchema: z.ZodType } }
    }): Promise<{ table(name: 'projects'): ProjectTable; close(): Promise<void> }>
  }
  typert: { register(contribution: unknown): () => Promise<void> }
  effect(
    acquire: () => void | (() => void | Promise<void>) | Promise<() => void | Promise<void>>,
    label: string,
  ): unknown
}
