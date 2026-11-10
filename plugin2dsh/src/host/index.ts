import { ProjectSchema } from '../shared/contracts.ts'
import { DramaService, DramaError } from './domain.ts'
import { DramaRemote, remoteContribution } from './remote.ts'
import { installTools } from './tools.ts'
import type { HostContext } from './context.ts'

export const name = 'dramaip-dsh-plugin'
export const inject = ['tools', 'storageDomain', 'typert']

export async function apply(ctx: HostContext): Promise<void> {
  await ctx.effect(async () => {
    const storage = await ctx.storageDomain.open({
      name: 'dramaip',
      version: 1,
      layout: 'single',
      tables: { projects: { valueSchema: ProjectSchema } },
    })
    // Acquire this disposer first: the outer effect unwinds its later tools,
    // metadata and Service before draining and closing authoritative storage.
    ctx.effect(() => () => storage.close(), 'dramaip:storage-handle')
    for (const [key, project] of storage.table('projects').entries()) {
      if (key !== project.id)
        throw new DramaError('dramaip/invalid-record', '项目存储键与身份不一致，已拒绝加载')
    }
    const domain = new DramaService(storage.table('projects'))
    new DramaRemote(ctx, domain)
    ctx.effect(() => ctx.typert.register(remoteContribution()), 'dramaip:remote-schema')
    installTools(ctx, domain)
    return () => {}
  }, 'dramaip:storage')
}
