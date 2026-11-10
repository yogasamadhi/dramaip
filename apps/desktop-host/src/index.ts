/**
 * Desktop Host entry: run the `desktop` Profile through the shared Profile
 * runner, bound to an OS-assigned loopback port, and report its launch URL to
 * the Electron shell over Node IPC. The shell owns this process; nothing else
 * starts the `desktop` Profile.
 * @module @dramaip/desktop-host-process
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { runProfile } from "@dramaip/cli/profile-boot";
import {
  loadLayeredEnv,
  loadProfile,
  reportSkippedBundles,
} from "@dramaip/infra-app-boot";
import type {} from "@dramaip/infra-connection";
import type {} from "@dramaip/infra-webserver";
import type {
  HostMessage,
  ShellMessage,
} from "@dramaip/host-shell-bridge/protocol";
import { migrateLegacyUserData } from "@dramaip/host-migration";
import { dramaipHomePath } from "@dramaip/infra-home-paths";

const NAME = "dramaip";

/** This package resolves the bundles and plugins the `desktop` Profile composes. */
const INSTALL_ANCHOR = fileURLToPath(
  new URL("../package.json", import.meta.url),
);

/** Upper bound of the diagnostic carried over IPC; the head holds the message and stack. */
const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024;

function send(message: HostMessage): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!process.connected || process.send === undefined) {
      resolvePromise();
      return;
    }
    process.send(message, (error: Error | null) => {
      if (error === null) resolvePromise();
      else reject(error);
    });
  });
}

/**
 * Overlay patches the shell selected for this launch (the safe overlay after
 * a recovery choice), passed as `--patch <file>` pairs.
 */
function overlayArguments(argv: readonly string[]): string[] {
  const patches: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--patch" && argv[index + 1] !== undefined)
      patches.push(resolve(argv[++index]!));
  }
  return patches;
}

async function main(): Promise<void> {
  // D9: the pre-refactor userData the shell names is copied in once, before
  // the Loader opens the storage it lands in. A failure is fatal and visible.
  const legacy = process.env.DRAMAIP_LEGACY_USER_DATA;
  if (legacy) {
    const result = await migrateLegacyUserData({
      source: legacy,
      home: dramaipHomePath(),
    });
    if (result.status === "migrated")
      console.log(
        `dramaip desktop: user data migration ${result.marker.outcome}`,
      );
  }
  const profile = loadProfile(NAME, "desktop", INSTALL_ANCHOR);
  reportSkippedBundles(NAME, profile);
  const application = runProfile({
    environment: loadLayeredEnv(NAME),
    profile: "desktop",
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles: overlayArguments(process.argv.slice(2)),
    args: ["--no-open", "--host", "127.0.0.1", "--port", "0"],
  });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      // Startup failure is reported below; shutdown only owns a tree that booted.
      const running = await application.catch(() => undefined);
      await running?.shutdown.shutdown(0);
      await send({ type: "shutdown-complete" });
      if (process.connected) process.disconnect();
    })());
  process.on("message", (message: ShellMessage) => {
    if (message?.type === "shutdown") void stop();
  });
  // The shell is gone: nothing can reach this tree any more.
  process.once("disconnect", () => {
    void stop();
  });
  const { ctx } = await application;
  const origin = `${ctx.webServer.protocol}//127.0.0.1:${String(ctx.webServer.port)}`;
  await send({
    type: "ready",
    url: ctx.connection.authenticatedUrl(origin),
    injections: ctx.webServer.collectIndexInjections(),
  });
}

if (import.meta.main) {
  main().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // The shell receives the inspected error over IPC rather than stderr:
    // the two race, and the shell reports the first failure it sees.
    const diagnostic = inspect(error, {
      depth: 4,
      maxArrayLength: 50,
    }).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS);
    console.error(error);
    process.exitCode = 1;
    await send({ type: "fatal", message, diagnostic }).catch(() => undefined);
    if (process.connected) process.disconnect();
  });
}
