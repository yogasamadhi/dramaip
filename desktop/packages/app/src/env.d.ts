/// <reference types="vite/client" />

import type { RuntimeBootstrap } from "@dramaip/contracts";

declare global {
  interface Window {
    runtimeBootstrap: Readonly<{
      resolve(): Promise<Readonly<RuntimeBootstrap>>;
    }>;
  }
}
export {};
