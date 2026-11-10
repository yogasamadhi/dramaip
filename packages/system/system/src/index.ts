/**
 * Host face of the system domain. It owns the `system` Remote namespace: the
 * runtime's identity, versions, capabilities and redacted diagnostics, the
 * domain event stream, and the Desktop Host actions the Client asks for
 * (native file dialogs, external links, reveal, the credential vault, the
 * window theme, local model runtimes). It replaces the `/api/v2` system and
 * runtime routes, each method naming the operation it replaces.
 * @module @dramaip/system-system
 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import {
  DRAMAIP_HTTP_API_VERSION,
  DRAMAIP_PLUGIN_API_VERSION,
  DRAMAIP_RUNTIME_VERSION,
} from "@dramaip/contracts";
import type { DesktopHost } from "@dramaip/host-contracts";
import {
  Remote,
  RemoteError,
  TypertRemoteService,
} from "@dramaip/infra-typert-protocol";
import type { Engines } from "@dramaip/seams-engines";
import { ENGINE_KINDS } from "@dramaip/seams-engines";
import type {} from "@dramaip/compat-runtime";
import type {} from "@dramaip/infra-storage-relational";
import type {} from "@dramaip/plugin-api/internal";
import { runtimeCapabilityDescriptors } from "./capabilities.ts";
import { redactDiagnostics } from "./diagnostics.ts";
import type {
  SystemCredentialCaptureInput,
  SystemCredentialSession,
  SystemCredentialStatus,
  SystemDiagnostics,
  SystemEventEnvelope,
  SystemFileGrant,
  SystemHealth,
  SystemJsonObject,
  SystemLocalModel,
  SystemLocalModelRuntime,
  SystemLocalModelRuntimeKind,
  SystemPickFilesOptions,
  SystemRuntimeInfo,
  SystemSaveResult,
  SystemSaveTextInput,
  SystemVersion,
} from "./types.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `system` Remote namespace. */
    systemController: SystemController;
  }
}

/**
 * View a runtime record as the JSON object it is on the wire. Runtime facts,
 * reports and events are plain data; the wire codec drops undefined fields.
 */
const asJson = (value: object): SystemJsonObject => value as SystemJsonObject;

/** Domain events read from the log per replay page. */
const EVENT_REPLAY_PAGE = 500;

/** Most frames one event subscriber may fall behind before it must reconnect. */
const EVENT_QUEUE_LIMIT = 1_000;

/** Most bytes one event subscriber may fall behind before it must reconnect. */
const EVENT_QUEUE_BYTES = 4 * 1024 * 1024;

/** Host service backing the generated `ctx.remote.system` namespace. */
export class SystemController extends TypertRemoteService {
  /** Kernel-era services the runtime facts and the event log come from. */
  static inject = [
    "compatRuntime",
    "domainEvents",
    "diagnostics",
    "relationalStorage",
  ];

  /**
   * Register the `system` namespace.
   * @param ctx - Host context the service mounts on.
   */
  constructor(ctx: Context) {
    super(ctx, "systemController", { namespace: "system" });
  }

  /**
   * Report that the Host answers, with its versions.
   * @replaces system.health
   * @returns health and protocol versions.
   */
  @Remote
  health(): SystemHealth {
    return {
      healthy: true,
      version: DRAMAIP_RUNTIME_VERSION,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
    };
  }

  /**
   * Report the runtime and protocol versions.
   * @replaces system.version
   * @returns the versions the Client checks compatibility against.
   */
  @Remote
  version(): SystemVersion {
    return {
      runtimeVersion: DRAMAIP_RUNTIME_VERSION,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
      pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
    };
  }

  /**
   * Report which runtime capabilities this Profile offers.
   * @replaces system.capabilities
   * @returns capability flags by name.
   */
  @Remote
  capabilities(): Record<string, boolean> {
    return this.capabilityFlags();
  }

  /**
   * Report the effective runtime: identity, composed plugins, capabilities,
   * engine status and UI contributions.
   * @replaces system.runtime
   * @returns the runtime graph.
   */
  @Remote
  async runtime(): Promise<SystemRuntimeInfo> {
    const runtime = this.ctx.compatRuntime;
    const host = this.ctx.get("desktopHost");
    return asJson({
      runtimeId: runtime.runtimeId,
      runtimeGeneration: 1,
      graphRevision: runtime.graphRevision,
      startedAt: runtime.startedAt,
      runtimeVersion: DRAMAIP_RUNTIME_VERSION,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
      pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
      runtimeKind: process.versions.electron ? "electron-node" : "node",
      mode: host ? "desktop" : "server",
      profile: runtime.profile,
      bundles: [],
      plugins: runtime.plugins().map(({ id, status, version, kind }) => ({
        id,
        status,
        version,
        kind,
      })),
      capabilities: this.capabilityFlags(),
      capabilityDescriptors: runtimeCapabilityDescriptors(Boolean(host)),
      engineStatus: host ? await this.engineStatus() : {},
      uiContributions: [...runtime.ui.contributions()],
    });
  }

  /**
   * Collect a diagnostics report: plugin states, migrations, event consumers,
   * services, Host and engine health. Paths, tokens, credentials and prompts
   * are redacted before the report leaves the Host.
   * @replaces system.diagnostics
   * @returns the redacted report.
   */
  @Remote
  async diagnostics(): Promise<SystemDiagnostics> {
    const runtime = this.ctx.compatRuntime;
    const relational = this.ctx.relationalStorage;
    const host = this.ctx.get("desktopHost");
    const report = {
      healthy: true,
      runtimeId: runtime.runtimeId,
      runtimeGeneration: 1,
      graphRevision: runtime.graphRevision,
      // Profile configuration HMR (`infra-hmr`) runs whenever the Profile has one.
      hmr: {
        enabled:
          (this.ctx.get as (name: string) => unknown)("hmr") !== undefined,
      },
      startedAt: runtime.startedAt,
      profile: runtime.profile,
      plugins: runtime.plugins().map(({ id, status }) => ({ id, status })),
      migrations: relational.applied(),
      migrationRuns: relational.declarations(),
      eventConsumers: this.ctx.domainEvents.diagnostics(),
      services: this.ctx.diagnostics().services,
      host: host
        ? await host.health().catch(() => ({ healthy: false }))
        : { healthy: false, unavailable: "server" },
      ...(host ? { engines: await this.engineStatus() } : {}),
    };
    return {
      traceId: randomUUID(),
      ...asJson(redactDiagnostics(report) as object),
    };
  }

  /**
   * Stream the domain event log from `cursor`, then every domain and realtime
   * event as it is published. A subscriber that falls too far behind gets one
   * `system.stream-overflow` event and the stream ends; it reconnects from
   * the last cursor it saw.
   * @replaces system.events.subscribe
   * @param cursor - last domain cursor the caller has seen; 0 for the whole log.
   * @param signal - stream cancellation.
   * @returns replayed, then live, event envelopes.
   * @throws RemoteError when `cursor` is not a non-negative integer.
   */
  @Remote({ mode: "stream" })
  async *events(
    cursor: number,
    signal: AbortSignal,
  ): AsyncIterable<SystemEventEnvelope> {
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new RemoteError(
        "gateway/bad-request",
        "system/events: cursor must be a non-negative integer",
        {},
      );
    const events = this.ctx.domainEvents;
    const queued: { envelope: SystemEventEnvelope; bytes: number }[] = [];
    let queuedBytes = 0;
    let overflowed = false;
    let wake: (() => void) | undefined;
    const enqueue = (envelope: SystemEventEnvelope): void => {
      if (signal.aborted || overflowed) return;
      const bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
      if (
        queued.length >= EVENT_QUEUE_LIMIT ||
        queuedBytes + bytes > EVENT_QUEUE_BYTES
      )
        overflowed = true;
      else {
        queued.push({ envelope, bytes });
        queuedBytes += bytes;
      }
      wake?.();
    };
    const onAbort = (): void => wake?.();
    signal.addEventListener("abort", onAbort);
    // Subscribe before replaying so nothing published in between is lost;
    // the cursor check below drops what the replay already delivered.
    const stopDomain = events.subscribeDomain((event) =>
      enqueue({
        kind: "domain",
        cursor: event.cursor,
        event: asJson(event),
      }),
    );
    const stopRealtime = events.subscribeLive((event) =>
      enqueue({
        kind: "realtime",
        event: asJson(event),
      }),
    );
    let lastDomainCursor = cursor;
    try {
      // The log replays in pages; read until a page comes back empty.
      for (;;) {
        const page = events.replay(lastDomainCursor, EVENT_REPLAY_PAGE);
        if (page.length === 0) break;
        for (const event of page) {
          if (signal.aborted) return;
          lastDomainCursor = Math.max(lastDomainCursor, event.cursor);
          yield {
            kind: "domain",
            cursor: event.cursor,
            event: asJson(event),
          };
        }
      }
      while (!signal.aborted && !overflowed) {
        const next = queued.shift();
        if (next === undefined) {
          await new Promise<void>((resolve) => {
            wake = () => {
              wake = undefined;
              resolve();
            };
          });
          continue;
        }
        queuedBytes -= next.bytes;
        const { envelope } = next;
        if (envelope.kind === "domain") {
          if (envelope.cursor <= lastDomainCursor) continue;
          lastDomainCursor = envelope.cursor;
        }
        yield envelope;
      }
      if (overflowed && !signal.aborted)
        yield {
          kind: "realtime",
          event: {
            id: randomUUID(),
            type: "system.stream-overflow",
            payload: { reconnect: true },
            occurredAt: new Date().toISOString(),
          },
        };
    } finally {
      signal.removeEventListener("abort", onAbort);
      stopRealtime();
      stopDomain();
    }
  }

  /**
   * Let the user pick files through the native dialog.
   * @replaces system.hostFiles.pick
   * @param options - multiple selection and the extensions to offer.
   * @returns the granted files, or null when the user cancelled.
   */
  @Remote
  async pickFiles(
    options: SystemPickFilesOptions,
  ): Promise<SystemFileGrant[] | null> {
    const grants = await this.host().pickFiles(options);
    return grants === null ? null : [...grants];
  }

  /**
   * Let the user save text through the native save dialog.
   * @replaces system.hostFiles.saveText
   * @param input - proposed file name and the text.
   * @returns whether it was saved, and the reference of the written file.
   */
  @Remote
  async saveTextFile(input: SystemSaveTextInput): Promise<SystemSaveResult> {
    return this.host().saveTextFile(input);
  }

  /**
   * Open a link in the user's browser. The Host accepts only links its
   * external-link policy allows.
   * @replaces system.host.openExternal
   * @param url - link to open.
   */
  @Remote
  async openExternal(url: string): Promise<void> {
    await this.host().openExternal(url);
  }

  /**
   * Show a granted file in the system file manager.
   * @replaces system.host.revealGrant
   * @param grantId - grant of the file to show.
   */
  @Remote
  async revealGrant(grantId: string): Promise<void> {
    await this.host().revealGrant(grantId);
  }

  /**
   * Show a file the Host wrote in the system file manager.
   * @replaces system.host.revealArtifact
   * @param artifactRef - reference of the written file.
   */
  @Remote
  async revealArtifact(artifactRef: string): Promise<void> {
    await this.host().revealArtifact(artifactRef);
  }

  /**
   * Report the local credential vault's state.
   * @replaces system.credentials.status
   * @returns availability, backend and lock state.
   */
  @Remote
  async credentialStatus(): Promise<SystemCredentialStatus> {
    return this.host().credentialStorageStatus();
  }

  /**
   * Open the shell's own unlock window for the credential vault.
   * @replaces system.credentials.createUnlockSession
   * @returns the session to poll with `credentialSession`.
   */
  @Remote
  async createCredentialUnlockSession(): Promise<SystemCredentialSession> {
    return this.host().createCredentialVaultUnlockSession();
  }

  /**
   * Open the shell's own capture window for one credential. The secret goes
   * from that window straight into the vault and never crosses this API.
   * @replaces system.credentials.createCaptureSession
   * @param input - purpose, label, policy and allowed origin of the credential.
   * @returns the session to poll with `credentialSession`.
   */
  @Remote
  async createCredentialCaptureSession(
    input: SystemCredentialCaptureInput,
  ): Promise<SystemCredentialSession> {
    return this.host().createCredentialCaptureSession(input);
  }

  /**
   * Read a capture or unlock session's state.
   * @replaces system.credentials.getCaptureSession
   * @param captureSessionId - session to read.
   * @returns its state, and the credential reference once completed.
   */
  @Remote
  async credentialSession(
    captureSessionId: string,
  ): Promise<SystemCredentialSession> {
    return this.host().credentialCaptureStatus(captureSessionId);
  }

  /**
   * Remove one credential from the vault.
   * @replaces system.credentials.remove
   * @param credentialRef - reference of the credential.
   */
  @Remote
  async removeCredential(credentialRef: string): Promise<void> {
    await this.host().removeCredential(credentialRef);
  }

  /**
   * Match the native window chrome to the Client's theme.
   * @replaces system.window.setTheme
   * @param theme - resolved Client theme.
   */
  @Remote
  async setWindowTheme(theme: "light" | "dark"): Promise<void> {
    await this.host().setWindowTheme(theme);
  }

  /**
   * List the local model runtimes the Host can reach.
   * @replaces localModelRuntimes.list
   * @returns each runtime's state and models.
   */
  @Remote
  async localModelRuntimes(): Promise<SystemLocalModelRuntime[]> {
    return [...(await this.host().localModelRuntimes())];
  }

  /**
   * Use one local model runtime.
   * @replaces localModelRuntimes.activate
   * @param kind - runtime to activate.
   * @returns its state afterwards.
   */
  @Remote
  async activateLocalModelRuntime(
    kind: SystemLocalModelRuntimeKind,
  ): Promise<SystemLocalModelRuntime> {
    return this.host().activateLocalModelRuntime(kind);
  }

  /**
   * Stop using one local model runtime.
   * @replaces localModelRuntimes.deactivate
   * @param kind - runtime to deactivate.
   * @returns its state afterwards.
   */
  @Remote
  async deactivateLocalModelRuntime(
    kind: SystemLocalModelRuntimeKind,
  ): Promise<SystemLocalModelRuntime> {
    return this.host().deactivateLocalModelRuntime(kind);
  }

  /**
   * List the models one local runtime serves.
   * @replaces localModelRuntimes.models
   * @param kind - runtime to read.
   * @returns its models.
   */
  @Remote
  async localModels(
    kind: SystemLocalModelRuntimeKind,
  ): Promise<SystemLocalModel[]> {
    return (await this.host().localModelRuntime(kind)).models;
  }

  /**
   * Probe one local runtime now.
   * @replaces localModelRuntimes.healthCheck
   * @param kind - runtime to probe.
   * @returns its state after the probe.
   */
  @Remote
  async checkLocalModelRuntime(
    kind: SystemLocalModelRuntimeKind,
  ): Promise<SystemLocalModelRuntime> {
    return this.host().localModelRuntime(kind);
  }

  /** The Desktop Host, or the structured refusal of a Profile without one. */
  private host(): DesktopHost {
    const host = this.ctx.get("desktopHost");
    if (host === undefined)
      throw new RemoteError(
        "system/host-unavailable",
        "Desktop Host is unavailable",
        {},
      );
    return host;
  }

  /** Capability flags by Desktop Host availability. */
  private capabilityFlags(): Record<string, boolean> {
    const host = this.ctx.get("desktopHost") !== undefined;
    return {
      desktopHost: host,
      fileGrant: host,
      credentials: host,
      localEngines: host,
    };
  }

  /** Health of every agent engine kind; unavailable when not registered. */
  private async engineStatus(): Promise<SystemJsonObject> {
    const engines = this.ctx.get("engines") as Engines | undefined;
    return asJson(
      Object.fromEntries(
        await Promise.all(
          ENGINE_KINDS.map(async (kind) => [
            kind,
            engines
              ? await engines.health(kind).catch(() => ({
                  available: false,
                  healthy: false,
                }))
              : { available: false, healthy: false },
          ]),
        ),
      ),
    );
  }
}

export default SystemController;
