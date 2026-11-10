/**
 * The shared body of an engine bundle plugin: once startup is committed and
 * the web server listens (the sidecar needs the MCP URL), spawn the sidecar,
 * register its engine, and stop and unregister it when the plugin unloads.
 * Disabling an engine row therefore stops its sidecar and drains its work.
 */

import { dirname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { AgentEngineKind } from "@dramaip/contracts";
import type {} from "@dramaip/infra-cmdline";
import type {} from "@dramaip/infra-subprocess";
import type {} from "@dramaip/infra-webserver";
import { SidecarEngine } from "./engine.ts";
import type {} from "./index.ts";
import { EngineSidecar } from "./sidecar.ts";

/** What one engine bundle supplies. */
export interface SidecarEngineBundle {
  readonly kind: AgentEngineKind;
  /** Component name used in diagnostics, e.g. `pi-engine`. */
  readonly name: string;
  /** Name used in configuration messages. */
  readonly displayName: string;
  /** Absolute path of the sidecar module. */
  readonly entry: string;
  /** How long a stopping sidecar may take before it is killed. */
  readonly stopGraceMs: number;
  /** Whether the agent provider configures this engine. */
  readonly configurable: boolean;
  /** Whether an accepted provider is what signs this engine in. */
  readonly providerAuthenticates?: boolean;
  /**
   * The sidecar's start command fields.
   * @param mcp - the private MCP boundary and this engine's token.
   */
  start(mcp: { url: string; token: string }): Promise<Record<string, unknown>>;
}

/**
 * The interpreter a sidecar runs under: this process's own executable and
 * loader flags (Electron's Node with `ELECTRON_RUN_AS_NODE` in the Desktop
 * Host), without debugger flags.
 * @returns the argv prefix.
 */
export function hostNodeRuntime(): string[] {
  return [
    process.execPath,
    ...process.execArgv.filter((flag) => !flag.startsWith("--inspect")),
  ];
}

/**
 * Run one engine bundle in this plugin's context.
 * @param ctx - the engine plugin's context.
 * @param bundle - the engine.
 */
export function applySidecarEngine(
  ctx: Context,
  bundle: SidecarEngineBundle,
): void {
  ctx.inject(
    ["engines", "subprocess", "appReady", "webServer"],
    (engineCtx) => {
      let disposed = false;
      let unregister: (() => Promise<void>) | undefined;
      engineCtx.effect(() => {
        const cancel = engineCtx.appReady!.onReady(() => {
          void (async () => {
            const origin = `${engineCtx.webServer.protocol}//127.0.0.1:${String(engineCtx.webServer.port)}`;
            const start = await bundle.start({
              url: `${origin}/engine/v1/mcp`,
              token: engineCtx.engines.mcpToken(bundle.kind),
            });
            if (disposed) return;
            const sidecar = new EngineSidecar(engineCtx.subprocess, {
              kind: bundle.kind,
              name: bundle.name,
              runtime: hostNodeRuntime(),
              entry: bundle.entry,
              cwd: dirname(bundle.entry),
              start,
              stopGraceMs: bundle.stopGraceMs,
            });
            unregister = engineCtx.engines.register(
              new SidecarEngine(sidecar, {
                kind: bundle.kind,
                displayName: bundle.displayName,
                configurable: bundle.configurable,
                ...(bundle.providerAuthenticates
                  ? { providerAuthenticates: true }
                  : {}),
              }),
            );
            // An engine that fails to start stays registered and reports
            // itself unhealthy; no other engine stands in for it.
            await sidecar.start().catch((error: unknown) => {
              // Unloading stops a sidecar that was still starting.
              if (disposed) return;
              console.warn(
                `${bundle.name} did not start: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
          })().catch((error: unknown) => {
            console.warn(
              `${bundle.name} could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        });
        return async () => {
          disposed = true;
          cancel();
          await unregister?.();
        };
      }, `${bundle.name}: sidecar`);
    },
  );
}
