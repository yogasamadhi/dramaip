import type { JsonValue, RealtimeEvent } from "@dramaip/contracts";

/** Stable v1 surface. It intentionally contains no transport or database handle. */
export type Cleanup = () => void | Promise<void>;

export interface CapabilityUnavailable {
  readonly code: "CAPABILITY_UNAVAILABLE";
  readonly capability: string;
  readonly reason: string;
}

export interface PublicPluginContext {
  readonly pluginId: string;
  readonly profile: string;
  capability<T>(name: string): T | undefined;
  effect(cleanup: Cleanup, label?: string): void;
}

export interface PublicEventBus {
  publishLive(input: Omit<RealtimeEvent, "id" | "occurredAt">): void;
  subscribeLive(listener: (event: RealtimeEvent) => void): Cleanup;
}

export interface DeclarativeUiContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly kind:
    | "route"
    | "navigation"
    | "slot"
    | "command"
    | "panel"
    | "editor"
    | "inspector"
    | "settings"
    | "toolbar";
  readonly metadata: JsonValue;
}
