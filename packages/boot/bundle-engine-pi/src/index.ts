/**
 * The Pi engine (D5): the Pi agent runtime behind its sidecar, started
 * through the Host's subprocess service and configured with the agent
 * provider the user activates.
 * @module @dramaip/boot-bundle-engine-pi
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { dramaipHomePath } from "@dramaip/infra-home-paths";
import { applySidecarEngine } from "@dramaip/seams-engines";

const require = createRequire(import.meta.url);

/** Cordis plugin name. */
export const name = "engine-pi";

/** Plugin configuration. */
export interface Config {
  /** Directory holding the Pi session journal. */
  dataDir: string;
  /** The prepared Pi runtime module; the shell provides it when absent. */
  runtimeModule?: string;
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  dataDir: z.string().default(dramaipHomePath("desktop")),
  runtimeModule: z.string(),
});

/**
 * Run the Pi engine.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  applySidecarEngine(ctx, {
    kind: "pi",
    name: "pi-engine",
    displayName: "Pi",
    entry: require.resolve("@dramaip/agent-host-adapters/pi-sidecar"),
    stopGraceMs: 15_000,
    configurable: true,
    async start(mcp) {
      return {
        runtimeModule:
          config.runtimeModule ?? process.env.DRAMAIP_PI_RUNTIME_MODULE ?? "",
        sessionRoot: join(config.dataDir, "agent-sessions", "pi"),
        mcp,
      };
    },
  });
}
