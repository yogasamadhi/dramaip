import type { RuntimeBootstrap } from "@dramaip/contracts";

declare global {
  interface ImportMeta {
    /** Build mode values the client bundler defines. */
    readonly env: { readonly MODE: string; readonly DEV?: boolean };
  }
  interface Window {
    runtimeBootstrap: Readonly<{
      resolve(): Promise<Readonly<RuntimeBootstrap>>;
    }>;
  }
}
export {};
