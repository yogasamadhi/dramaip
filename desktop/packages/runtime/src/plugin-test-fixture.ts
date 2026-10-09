import { Context, type Plugin } from "@deepseek-ai/cordis";
import type {
  FirstPartyPlugin,
  PluginContext,
} from "@dramaip/plugin-api/internal";

/** Unit fixtures use the same native fiber/effect ownership as production. */
export async function mountTestPlugin(
  plugin: FirstPartyPlugin,
  services: Partial<Pick<PluginContext, "http" | "uow" | "domainEvents">>,
  dependencies: Record<string, unknown> = {},
  onMounted?: (fiber: ReturnType<Context["plugin"]>) => void,
): Promise<Context> {
  const ctx = new Context();
  const values = {
    http: { register: () => () => undefined, routeIds: [] },
    domainEvents: {
      publishLive: () => undefined,
      subscribeLive: () => () => undefined,
      subscribeDomain: () => () => undefined,
      replay: () => [],
      registerConsumer: () => () => undefined,
      diagnostics: () => [],
      retryConsumer: () => false,
      dispose: () => undefined,
    },
    ui: { register: () => () => undefined, contributions: () => [] },
    diagnostics: () => ({}),
    profile: "test",
    graphRevision: "test",
    capability: () => undefined,
    ...services,
    ...dependencies,
  };
  for (const [name, value] of Object.entries(values)) ctx.provide(name, value);
  for (const { id } of plugin.descriptor.requires)
    ctx.provide(`dramaip.plugin.${id}`, true);
  try {
    const fiber = ctx.plugin(plugin as Plugin);
    await fiber.await();
    if (fiber.state !== 2)
      throw new Error(
        `Test plugin ${plugin.descriptor.id} has missing injected services: ${Object.keys(
          fiber.inject,
        )
          .filter((id) => ctx.get(id) === undefined)
          .join(", ")}`,
      );
    onMounted?.(fiber);
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
  return ctx;
}
