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
  effect(
    label: string,
    acquire: () => Cleanup | Promise<Cleanup>,
  ): void | Promise<void>;
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
  /** Filled by the first-party Kernel before metadata crosses HTTP. */
  readonly metadataHash?: string;
}

export type ExtensionHandler = (
  payload: JsonValue,
) => JsonValue | Promise<JsonValue>;

export interface ExtensionContext {
  /** The identity is transport-bound by the Runtime and cannot be selected by extension code. */
  readonly pluginId: string;
  readonly revision: string;
  handle(id: string, handler: ExtensionHandler): Cleanup;
  /** Event types are declared and permission-reviewed in the signed manifest. */
  subscribe(id: string, handler: ExtensionHandler): Cleanup;
  capability<T extends JsonValue = JsonValue>(
    name: string,
    payload?: JsonValue,
  ): Promise<T>;
  effect(
    label: string,
    acquire: () => Cleanup | Promise<Cleanup>,
  ): Promise<void>;
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Cleanup | Promise<void | Cleanup>;
}

/** Stable Public Plugin API v1 entrypoint. Runtime internals are deliberately absent. */
export function defineExtension(extension: ExtensionModule): ExtensionModule {
  return Object.freeze(extension);
}
