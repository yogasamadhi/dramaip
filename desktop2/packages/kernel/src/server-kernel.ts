import { Context, type Fiber } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";

import type { DramaPluginExports, PluginProfile } from "@dramaip/plugin-api";

import { validatePluginGraph } from "./profile.ts";

export interface ServerKernelOptions {
  profile: PluginProfile;
  builtins: ReadonlyMap<string, DramaPluginExports<unknown>>;
  baseUrl?: string;
}

export interface RunningKernel {
  readonly context: Context;
  readonly profile: PluginProfile;
  readonly pluginOrder: readonly string[];
  dispose(): Promise<void>;
}

export async function bootServerKernel(
  options: ServerKernelOptions,
): Promise<RunningKernel> {
  const context = new Context();
  let loaderFiber: (Fiber & PromiseLike<Fiber>) | undefined;

  try {
    const requested = options.profile.plugins.map((entry) => entry.id);
    const pluginOrder = validatePluginGraph(options.builtins, requested);
    const entryById = new Map(
      options.profile.plugins.map((entry) => [entry.id, entry]),
    );

    loaderFiber = context.plugin(
      Loader,
      options.baseUrl ? { baseUrl: options.baseUrl } : {},
    );
    await loaderFiber;

    for (const [id, module] of options.builtins) {
      if (module.server) context.loader.builtins[id] = module.server;
    }

    await context.loader.root.update(
      pluginOrder.map((id) => {
        const module = options.builtins.get(id);
        const entry = entryById.get(id);
        if (!module?.server || !entry)
          throw new Error(`server builtin ${id} has no server export`);
        return { id, name: `cordis:${id}`, config: entry.config };
      }),
    );
    await context.loader.await();

    let disposed = false;
    return {
      context,
      profile: options.profile,
      pluginOrder,
      async dispose() {
        if (disposed) return;
        disposed = true;
        await context.loader.root.update([]);
        await loaderFiber?.dispose();
      },
    };
  } catch (error) {
    try {
      if (context.loader) await context.loader.root.update([]);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "server kernel boot and rollback failed",
      );
    } finally {
      await loaderFiber?.dispose();
    }
    throw error;
  }
}
