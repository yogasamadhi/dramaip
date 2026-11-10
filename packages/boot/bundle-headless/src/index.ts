/**
 * One-shot headless runner: once the launcher commits startup, report the
 * composed tree and open listeners on stdout as one JSON line and request
 * exit 0. Startup
 * failures never reach it; the launcher reports them and exits 1.
 * @module @dramaip/boot-bundle-headless
 */
import type { Context, FiberState } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/cordis-plugin-loader";
import type {} from "@dramaip/infra-app-boot";
import type {} from "@dramaip/infra-cmdline";

/** Value mirror: Cordis's const enum has no runtime object to import from its built package. */
const FIBER_ACTIVE = 2 as FiberState.ACTIVE;

/** Server handles Node reports for a listening TCP socket or pipe. */
const LISTENER_RESOURCES: ReadonlySet<string> = new Set([
  "TCPServerWrap",
  "PipeServerWrap",
]);

/** Cordis plugin name. */
export const name = "headless-runner";

/** Launcher services this runner reports through. */
export const inject = ["appExit", "appReady"];

/** One composed entry as reported by the run. */
export interface HeadlessEntry {
  id: string;
  name: string;
  /** Whether the entry's plugin mounted; false for disabled or unresolved rows. */
  active: boolean;
}

/** The single JSON line a headless run prints before it exits. */
export interface HeadlessReport {
  profile: string | null;
  entries: HeadlessEntry[];
  /** Listening sockets and pipes open in this process; a headless run binds none. */
  listeners: number;
}

/**
 * Report the composition and exit after startup is committed.
 * @param ctx - plugin context with the launcher services.
 */
export function apply(ctx: Context): void {
  const exit = ctx.get("appExit");
  const ready = ctx.get("appReady");
  if (exit === undefined || ready === undefined) {
    throw new Error(
      "headless-runner: the launcher must provide ctx.appExit and ctx.appReady before the tree mounts",
    );
  }
  ctx.effect(
    () =>
      ready.onReady(() => {
        const entries: HeadlessEntry[] = [
          ...(ctx.get("loader")?.entries() ?? []),
        ].map((entry) => ({
          id: entry.options.id,
          name: entry.options.name,
          active: entry.fiber?.state === FIBER_ACTIVE,
        }));
        const report: HeadlessReport = {
          profile: ctx.get("profileContext")?.name ?? null,
          entries,
          listeners: process
            .getActiveResourcesInfo()
            .filter((resource) => LISTENER_RESOURCES.has(resource)).length,
        };
        process.stdout.write(`${JSON.stringify(report)}\n`);
        exit(0);
      }),
    "headless-runner: report and exit",
  );
}
