/**
 * The Desktop Host's native capabilities (D8) as one plugin: file grants,
 * the credential vault, the media library and renderer, web research and
 * provider HTTP. It provides `desktopHost`, the surface business plugins
 * call in-process; shell-only actions (dialogs and windows) cross the shell
 * bridge to Main. Credential encryption and its owner-only key stay in the
 * DramaIP home, without any OS secret-store calls.
 * @module @dramaip/host-capabilities
 */

import { join, resolve } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { DesktopHost } from "@dramaip/host-contracts";
import type {} from "@dramaip/host-shell-bridge";
import { dramaipHomePath } from "@dramaip/infra-home-paths";
import type { Engines } from "@dramaip/seams-engines";
import { CloudAi } from "./cloud-ai.ts";
import { HostCredentials } from "./credentials.ts";
import { HostFiles } from "./files.ts";
import { HostMedia } from "./media.ts";
import { DesktopHostService } from "./service.ts";

export { DesktopHostService, HostRequestError } from "./service.ts";

/** Cordis plugin name. */
export const name = "host-capabilities";

/** Native shell actions reach Main through the bridge. */
export const inject = ["shellBridge"];

/** Plugin configuration. */
export interface Config {
  /** Directory holding the vault, the media library and the copy journal. */
  dataDir: string;
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  dataDir: z.string().default(dramaipHomePath("desktop")),
});

declare module "@deepseek-ai/cordis" {
  interface Context {
    desktopHost: DesktopHost;
  }
}

/**
 * Verify the media sidecars, open the vault, and provide `desktopHost`.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const shell = ctx.shellBridge;
  const files = new HostFiles(shell);
  const credentials = new HostCredentials(
    join(config.dataDir, "credentials"),
    shell,
  );
  const cloudAi = new CloudAi(config.dataDir, credentials, async (url) => {
    await shell.request("shell.openExternal", { url });
  });
  const media = new HostMedia(
    {
      dataDir: config.dataDir,
      rendererManifestPublicKeyPem:
        process.env.DRAMAIP_RENDERER_MANIFEST_PUBLIC_KEY_PEM,
      rendererFontPublicKeyPem:
        process.env.DRAMAIP_RENDERER_FONT_PUBLIC_KEY_PEM,
    },
    shell,
    files,
    credentials,
  );
  const host = new DesktopHostService({
    shell,
    files,
    credentials,
    cloudAi,
    media,
    piAuthPath: resolve(config.dataDir, "pi", "auth.json"),
    engines: () => ctx.get("engines") as Engines | undefined,
  });
  ctx.effect(() => {
    const stopServing = credentials.serve();
    return async () => {
      stopServing();
      cloudAi.dispose();
      await host.closePiLogin();
      await credentials.dispose();
      await media.dispose();
    };
  }, "host-capabilities: vault and media");
  await media.start();
  ctx.provide("desktopHost", host);
}
