import { Context, type Plugin } from "@deepseek-ai/cordis";
import { OperationRegistry } from "@dramaip/infra-operations";
import type {
  FirstPartyPlugin,
  PluginContext,
  RouteContribution,
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

/**
 * Serve route contributions in process, the way the operation registry does
 * in the composition.
 * @param routes - the contributions a plugin registered.
 * @returns `request(path, init)` against them.
 */
export function serveRoutes(routes: readonly RouteContribution[]): {
  request(path: string, init?: RequestInit): Promise<Response>;
} {
  const registry = new OperationRegistry();
  for (const route of routes) registry.register(route);
  registry.publish();
  return {
    request: (path, init) =>
      registry.fetch(new Request(new URL(path, "http://runtime.test"), init)),
  };
}
