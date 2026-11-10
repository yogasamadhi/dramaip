/**
 * The operation registry plugin: it provides the {@link OperationRegistry}
 * as `http`, which business plugins register their route contributions
 * with, and as `operations`, which domain controllers claim and invoke them
 * through (`@dramaip/infra-operations/operations`). It publishes the routes
 * once the launcher commits startup. Nothing is served over HTTP: the Remote
 * methods of the domain controllers are the API.
 * @module @dramaip/infra-operations
 */

import type { Context } from "@deepseek-ai/cordis";
import { OperationRegistry } from "./registry.ts";
import type {} from "@dramaip/infra-cmdline";

export {
  OperationRegistry,
  operationProblem,
  type OperationRegistryDiagnostics,
  type RouteDetail,
} from "./registry.ts";
export { serveNode } from "./node.ts";

/** Cordis plugin name. */
export const name = "operations";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The registry domain controllers claim and invoke operations through. */
    operations: OperationRegistry;
  }
}

/**
 * Provide the registry and publish it once startup commits.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const registry = new OperationRegistry();
  ctx.provide("http", registry);
  ctx.provide("operations", registry);
  // Routes register while the tree composes; publishing once afterwards
  // compiles them a single time instead of once per route.
  ctx.inject(["appReady"], (readyCtx) => {
    readyCtx.effect(
      () => readyCtx.appReady!.onReady(() => registry.publish()),
      "operations: publish routes",
    );
  });
}
