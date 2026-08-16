import { Context, type Fiber, type Plugin } from "@deepseek-ai/cordis";

import type { DramaPluginExports, PluginProfile } from "@dramaip/plugin-api";

import { validatePluginGraph } from "./profile.ts";

export interface RendererModule {
  plugin: Plugin;
}

export interface RunningRendererKernel {
  context: Context;
  dispose(): Promise<void>;
}

export async function bootRendererKernel(
  profile: PluginProfile,
  descriptors: ReadonlyMap<string, DramaPluginExports<unknown>>,
  modules: ReadonlyMap<string, RendererModule>,
): Promise<RunningRendererKernel> {
  const context = new Context();
  const fibers: Fiber[] = [];
  try {
    const order = validatePluginGraph(
      descriptors,
      profile.plugins.map((entry) => entry.id),
    );
    for (const id of order) {
      const module = modules.get(id);
      if (!module) continue;
      const fiber = context.plugin(module.plugin);
      fibers.push(fiber);
      await fiber;
    }
    return {
      context,
      async dispose() {
        for (const fiber of fibers.reverse()) await fiber.dispose();
      },
    };
  } catch (error) {
    for (const fiber of fibers.reverse()) await fiber.dispose();
    throw error;
  }
}
