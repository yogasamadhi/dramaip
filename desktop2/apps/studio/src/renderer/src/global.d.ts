import type { StudioBridge } from "../../shared/bridge.ts";

declare global {
  interface Window {
    dramaip: StudioBridge;
  }
}

export {};
