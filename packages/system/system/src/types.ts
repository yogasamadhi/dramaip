/**
 * Wire types of the `system` Remote namespace.
 * @module @dramaip/system-system/types
 */
import type { JsonValue } from "@dramaip/infra-values";

declare module "@dramaip/infra-typert-protocol" {
  interface RemoteErrorDetailsMap {
    /**
     * The call needs the Desktop Host (native dialogs, the credential vault,
     * local model runtimes, the window), and this Profile has none.
     */
    "system/host-unavailable": {};
  }
}

/** A JSON object, the shape of the reports and events the Host forwards as is. */
export type SystemJsonObject = { [key: string]: JsonValue };

/** Answer of `system/health`. */
export interface SystemHealth {
  /** Always true while the Host answers. */
  healthy: true;
  /** Host runtime version. */
  version: string;
  /** Protocol version the pre-refactor client checks. */
  apiVersion: string;
}

/** Answer of `system/version`. */
export interface SystemVersion {
  /** Host runtime version. */
  runtimeVersion: string;
  /** Protocol version the pre-refactor client checks. */
  apiVersion: string;
  /** Business plugin API version. */
  pluginApiVersion: string;
}

/**
 * The effective runtime: identity, versions, composed plugins, capabilities,
 * engine status and UI contributions, in the shape the pre-refactor client's
 * `RuntimeInfo` schema validates.
 */
export type SystemRuntimeInfo = SystemJsonObject;

/** Redacted runtime diagnostics: no paths, tokens, credentials or prompts. */
export type SystemDiagnostics = SystemJsonObject;

/** One frame of `system/events`: a durable domain event or a realtime one. */
export type SystemEventEnvelope =
  | {
      /** A persisted domain event. */
      kind: "domain";
      /** Its position in the domain event log. */
      cursor: number;
      /** The event as the domain published it. */
      event: SystemJsonObject;
    }
  | {
      /** A realtime event, not persisted and not replayed. */
      kind: "realtime";
      /** The event as its publisher sent it. */
      event: SystemJsonObject;
    };

/** Options of `system/pickFiles`. */
export interface SystemPickFilesOptions {
  /** Allow choosing more than one file. */
  multiple?: boolean;
  /** File extensions to offer, without dots. */
  extensions?: string[];
}

/** One file or directory the user granted through a native picker. */
export interface SystemFileGrant {
  /** Opaque grant the domain plugins read the file through. */
  grantId: string;
  /** What was picked. */
  kind: "file" | "directory";
  /** Name to show; never a path. */
  displayName: string;
  /** When the grant lapses. */
  expiresAt: string;
  /** Grant generation, for revocation. */
  generation: number;
}

/** Input of `system/saveTextFile`. */
export interface SystemSaveTextInput {
  /** File name the save dialog proposes. */
  suggestedName: string;
  /** Text to write. */
  content: string;
}

/** Answer of `system/saveTextFile`. */
export interface SystemSaveResult {
  /** False when the user cancelled the dialog. */
  saved: boolean;
  /** Opaque reference to the written file. */
  artifactRef?: string;
  /** SHA-256 of the written bytes. */
  sha256?: string;
  /** Size of the written file. */
  byteSize?: number;
  /** When the file was written. */
  savedAt?: string;
}

/** State of the local credential vault. */
export interface SystemCredentialStatus {
  /** Whether credentials can be stored and read. */
  available: boolean;
  /** How the vault key is protected. */
  storage: "local_file" | "os_safe_storage" | "master_password" | "unavailable";
  /** Vault backend name. */
  backend: string;
  /** Whether the vault needs unlocking first. */
  locked: boolean;
  /** State of the move from an earlier vault format. */
  migrationState: "none" | "migrating" | "complete" | "failed";
  /** Explanation when unavailable. */
  message?: string;
}

/** Input of `system/createCredentialCaptureSession`. */
export interface SystemCredentialCaptureInput {
  /** What the credential is for; shown in the capture window. */
  purpose: string;
  /** Label the credential is stored under. */
  label?: string;
  /** Credential policy the capture applies. */
  policyId?: string;
  /** Origin the credential may be sent to. */
  allowedOrigin?: string;
}

/**
 * A credential capture or vault unlock session. The secret itself never
 * crosses the wire: the shell's own window takes it, and the session reports
 * only the reference it was stored under.
 */
export interface SystemCredentialSession {
  /** Session to poll. */
  captureSessionId: string;
  /** Session state. */
  status: "pending" | "completed" | "canceled" | "expired";
  /** Reference of the stored credential once completed. */
  credentialRef?: string;
  /** When the session lapses. */
  expiresAt: string;
}

/** A local model runtime the Host can reach. */
export type SystemLocalModelRuntimeKind = "ollama" | "lm_studio";

/** One model a local runtime serves. */
export interface SystemLocalModel {
  /** Model id the runtime accepts. */
  id: string;
  /** Name to show. */
  displayName: string;
  /** Model size. */
  sizeBytes?: number | undefined;
  /** Content digest. */
  digest?: string | undefined;
}

/** State of one local model runtime. */
export interface SystemLocalModelRuntime {
  /** Which runtime. */
  kind: SystemLocalModelRuntimeKind;
  /** Reference of the endpoint the Host probes; never the address itself. */
  endpointRef: string;
  /** Whether the runtime is in use. */
  state: "inactive" | "active" | "unavailable";
  /** Runtime version, when it reports one. */
  version?: string | undefined;
  /** Models it serves. */
  models: SystemLocalModel[];
  /** When the Host last probed it. */
  lastHealthAt: string;
  /** Why it is unavailable or limited. */
  limitation?: string | undefined;
}
