import type { RuntimeBootstrap } from "@dramaip/contracts";

/**
 * The existing app sends this where the Electron preload put the Runtime's
 * bearer token. Under the web Profile the signed browser cookie authenticates
 * every same-origin request and nothing reads the header, so the
 * value is a fixed marker, never a credential.
 */
export const COOKIE_CARRIED = "carried-by-the-signed-browser-cookie";

interface RuntimeIdentity {
  readonly runtimeId: string;
  readonly runtimeGeneration: number;
  readonly runtimeVersion: string;
  readonly apiVersion: RuntimeBootstrap["apiVersion"];
}

/** Read the bootstrap the existing app expects from the page's own origin. */
async function resolveBootstrap(): Promise<RuntimeBootstrap> {
  const response = await fetch("/api/v2/runtime", {
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error(`Runtime identity unavailable (${response.status})`);
  const runtime = (await response.json()) as RuntimeIdentity;
  return Object.freeze({
    baseUrl: location.origin,
    accessToken: COOKIE_CARRIED,
    appVersion: runtime.runtimeVersion,
    apiVersion: runtime.apiVersion,
    runtimeId: runtime.runtimeId,
    runtimeGeneration: runtime.runtimeGeneration,
  });
}

/**
 * Install `window.runtimeBootstrap`, which the Electron preload provides to
 * the existing Desktop renderer. Each resolve reads the current Runtime, so a
 * reconnect after a restart sees the new identity.
 * @returns disposer restoring the previous property.
 */
export function installRuntimeBootstrap(): () => void {
  const previous = Object.getOwnPropertyDescriptor(window, "runtimeBootstrap");
  Object.defineProperty(window, "runtimeBootstrap", {
    configurable: true,
    value: Object.freeze({ resolve: resolveBootstrap }),
  });
  return () => {
    if (previous) Object.defineProperty(window, "runtimeBootstrap", previous);
    else Reflect.deleteProperty(window, "runtimeBootstrap");
  };
}
