import { randomUUID, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type {
  AgentEngineDescriptor,
  AgentEngineKind,
  JsonValue,
} from "@dramaip/contracts";
import {
  AgentRuntimeError,
  type AgentRunRef,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeHealth,
  type AgentSessionInput,
  type AgentSessionRef,
} from "@dramaip/agent-runtime";

export interface AgentProviderActivationInput {
  providerId: string;
  runtimeProviderId: string;
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: "openai" | "openai-compatible" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  credentialRef: string;
  environmentName:
    "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
}

export interface AgentProviderActivationResult {
  available: boolean;
  message?: string;
}

export interface ProviderHttpRequest {
  credentialRef: string;
  url: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  accept?: "json" | "binary";
  maximumBytes?: number;
  timeoutMs?: number;
  /** Opaque Host media references only; Runtime never receives source bytes. */
  mediaRefs?: readonly string[];
}

export interface ProviderHttpResponse {
  status: number;
  contentType: string;
  json?: unknown;
  base64?: string;
}

export interface HostGrantedDocument {
  name: string;
  format: "txt" | "markdown" | "docx" | "epub" | "script-json";
  content: string;
  size: number;
}

export interface PublicSearchResult {
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: string;
}

export interface PublicSearchResponse {
  source: "duckduckgo" | "gdelt" | "wikimedia";
  results: readonly PublicSearchResult[];
  coverage: string;
}

export type PublicWebSearchProvider = "exa" | "parallel";

export interface PublicWebSearchRequest {
  provider: PublicWebSearchProvider;
  query: string;
  limit: number;
  sessionId: string;
  recencyDays?: number;
  domains?: readonly string[];
  credentialRef?: string;
}

export interface PublicWebSearchResponse {
  provider: PublicWebSearchProvider;
  text: string;
  coverage: string;
}

export interface PublicWebPageResponse {
  title: string;
  url: string;
  content: string;
  contentType: string;
  retrievedAt: string;
  truncated: boolean;
}

export interface CodexAuthenticationProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: "responses" | "chat_completions";
}

export interface CodexAuthenticationStatus {
  available: boolean;
  authenticated: boolean;
  mode?: "api_key" | "chatgpt" | "custom_provider";
  accountLabel?: string;
  provider?: CodexAuthenticationProvider;
  message?: string;
}

export interface CodexAuthenticationLoginInput {
  mode:
    "api_key" | "chatgpt_browser" | "chatgpt_device_code" | "custom_provider";
  credentialRef?: string;
  provider?: CodexAuthenticationProvider;
}

export interface CodexAuthenticationLoginResult {
  status: "authenticated" | "pending" | "unavailable";
  verificationUrl?: string;
  userCode?: string;
  message?: string;
}

export interface CredentialCaptureRequest {
  purpose: string;
  label?: string;
  policyId?: string;
  allowedOrigin?: string;
}

export interface CredentialCaptureResult {
  captureSessionId: string;
  status: "pending" | "completed" | "canceled" | "expired";
  credentialRef?: string;
  expiresAt: string;
}

export interface HostExtensionRegistryRequest {
  url: string;
  keyId: string;
  rootPublicKey: string;
}

export interface HostExtensionPackageStageRequest {
  packageUrl: string;
  expectedSha256: string;
  publisherPublicKey: string;
}

export interface HostExtensionPackageDescriptor {
  packageRef: string;
  contentHash: string;
  manifest: Record<string, unknown>;
}

export interface HostExtensionActivationRequest {
  pluginId: string;
  packageRef: string;
  publisherPublicKey: string;
  capabilityEndpoint: string;
  capabilityToken: string;
  permissionRevision: number;
}

export interface HostExtensionInvocationRequest {
  pluginId: string;
  handlerId: string;
  payload: unknown;
}

export interface HostExtensionNetworkRequest {
  url: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
}

/**
 * A vendor-neutral, transient engine event.  The Desktop Host is the only
 * process that sees vendor transports; Core Runtime receives this narrow
 * serializable projection over its private Host HTTP connection.
 */
export type HostEngineStreamEvent =
  | { type: "content.delta"; delta: string }
  | {
      type: "tool";
      status: "started" | "completed" | "failed";
      tool: string;
      itemId?: string;
      detail?: JsonValue;
    }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      estimatedCost?: number;
      currency?: string;
    }
  | { type: "result"; result: unknown }
  | { type: "error"; message: string };

export interface HostClientOptions {
  baseUrl: string;
  accessToken: string;
}

export class DesktopHostClient {
  constructor(private readonly options: HostClientOptions) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, this.options.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok)
      throw new Error(`Desktop Host request failed: ${response.status}`);
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }

  health(): Promise<{ healthy: boolean }> {
    return this.request("/host/v1/health");
  }

  engineHealth(engine: AgentEngineKind): Promise<unknown> {
    return this.request(`/host/v1/agent-runtimes/${engine}/health`);
  }

  pickFiles(
    options: { multiple?: boolean; extensions?: readonly string[] } = {},
  ): Promise<readonly HostFileGrant[] | null> {
    return this.request("/host/v1/files/pick", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  pickDirectory(): Promise<HostFileGrant | null> {
    return this.request("/host/v1/files/directory", { method: "POST" });
  }

  readGrantedText(
    grantId: string,
    maximumBytes = 16 * 1024 * 1024,
  ): Promise<{ name: string; content: string; size: number }> {
    return this.request(
      `/host/v1/files/grants/${encodeURIComponent(grantId)}/text`,
      {
        method: "POST",
        body: JSON.stringify({ maximumBytes }),
      },
    );
  }

  readGrantedDocument(
    grantId: string,
    maximumBytes = 32 * 1024 * 1024,
  ): Promise<HostGrantedDocument> {
    return this.request(
      `/host/v1/files/grants/${encodeURIComponent(grantId)}/document`,
      {
        method: "POST",
        body: JSON.stringify({ maximumBytes }),
      },
    );
  }

  importPortraitMedia(grantId: string): Promise<HostManagedMedia> {
    return this.request("/host/v1/media-library/import", {
      method: "POST",
      body: JSON.stringify({ grantId }),
    });
  }

  removeManagedMedia(mediaRef: string): Promise<void> {
    return this.request(
      `/host/v1/media-library/${encodeURIComponent(mediaRef)}`,
      {
        method: "DELETE",
      },
    );
  }

  publicSearch(input: {
    source: "duckduckgo" | "gdelt" | "wikimedia";
    query: string;
  }): Promise<PublicSearchResponse> {
    return this.request("/host/v1/public-search", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  webSearch(input: PublicWebSearchRequest): Promise<PublicWebSearchResponse> {
    return this.request("/host/v1/web/search", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  readWebPage(input: {
    url: string;
    maxCharacters: number;
  }): Promise<PublicWebPageResponse> {
    return this.request("/host/v1/web/read", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean; artifactRef?: string }> {
    return this.request("/host/v1/files/save-text", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  openExternal(url: string): Promise<void> {
    return this.request("/host/v1/shell/open-external", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  revealGrant(grantId: string): Promise<void> {
    return this.request("/host/v1/shell/reveal-grant", {
      method: "POST",
      body: JSON.stringify({ grantId }),
    });
  }

  revealArtifact(artifactRef: string): Promise<void> {
    return this.request("/host/v1/shell/reveal-artifact", {
      method: "POST",
      body: JSON.stringify({ artifactRef }),
    });
  }

  removeCredential(credentialRef: string): Promise<void> {
    return this.request(
      `/host/v1/credentials/${encodeURIComponent(credentialRef)}`,
      { method: "DELETE" },
    );
  }

  credentialStorageStatus(): Promise<{
    available: boolean;
    storage: "local_encrypted_file";
    message?: string;
  }> {
    return this.request("/host/v1/credentials/status");
  }

  createCredentialCaptureSession(
    input: CredentialCaptureRequest,
  ): Promise<CredentialCaptureResult> {
    return this.request("/host/v1/credentials/capture-sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  credentialCaptureStatus(
    captureSessionId: string,
  ): Promise<CredentialCaptureResult> {
    return this.request(
      `/host/v1/credentials/capture-sessions/${encodeURIComponent(captureSessionId)}`,
    );
  }

  activateAgentProvider(
    input: AgentProviderActivationInput,
  ): Promise<AgentProviderActivationResult> {
    return this.request("/host/v1/agents/providers/activate", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  providerRequest(input: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    return this.request("/host/v1/providers/request", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  codexAuthenticationStatus(): Promise<CodexAuthenticationStatus> {
    return this.request("/host/v1/agents/codex/auth");
  }

  loginCodex(
    input: CodexAuthenticationLoginInput,
  ): Promise<CodexAuthenticationLoginResult> {
    return this.request("/host/v1/agents/codex/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  logoutCodex(): Promise<CodexAuthenticationStatus> {
    return this.request("/host/v1/agents/codex/logout", { method: "POST" });
  }

  setWindowTheme(theme: "light" | "dark"): Promise<void> {
    return this.request("/host/v1/window/theme", {
      method: "POST",
      body: JSON.stringify({ theme }),
    });
  }

  notify(input: { title: string; body?: string }): Promise<void> {
    return this.request("/host/v1/notifications", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  fetchExtensionRegistry(
    input: HostExtensionRegistryRequest,
  ): Promise<unknown> {
    return this.request("/host/v1/extensions/registry", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  stageExtensionPackage(
    input: HostExtensionPackageStageRequest,
  ): Promise<HostExtensionPackageDescriptor> {
    return this.request("/host/v1/extensions/packages", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  activateExtension(input: HostExtensionActivationRequest): Promise<void> {
    return this.request("/host/v1/extensions/activate", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  invokeExtension(input: HostExtensionInvocationRequest): Promise<unknown> {
    return this.request("/host/v1/extensions/invoke", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  stopExtension(pluginId: string): Promise<void> {
    return this.request(
      `/host/v1/extensions/${encodeURIComponent(pluginId)}/stop`,
      {
        method: "POST",
      },
    );
  }

  retryExtension(pluginId: string): Promise<void> {
    return this.request(
      `/host/v1/extensions/${encodeURIComponent(pluginId)}/retry`,
      { method: "POST" },
    );
  }

  extensionDiagnostics(): Promise<readonly Record<string, unknown>[]> {
    return this.request("/host/v1/extensions/diagnostics");
  }

  extensionNetworkRequest(
    input: HostExtensionNetworkRequest,
  ): Promise<ProviderHttpResponse> {
    return this.request("/host/v1/extensions/network", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  engineOperation(
    engine: AgentEngineKind,
    operation:
      | "availability"
      | "create"
      | "run"
      | "cancel"
      | "steer"
      | "resume"
      | "fork"
      | "recoverRun"
      | "destroy"
      | "health",
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.request(`/host/v1/agent-runtimes/${engine}/${operation}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async *engineStream(
    engine: AgentEngineKind,
    payload: Record<string, unknown> = {},
  ): AsyncIterable<HostEngineStreamEvent> {
    const response = await fetch(
      new URL(`/host/v1/agent-runtimes/${engine}/stream`, this.options.baseUrl),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok)
      throw new Error(`Desktop Host stream failed: ${response.status}`);
    if (!response.body) throw new Error("Desktop Host stream body is missing");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const readFrames = function* (): Generator<string> {
      const frames = buffered.replace(/\r\n/gu, "\n").split("\n\n");
      buffered = frames.pop() ?? "";
      yield* frames;
    };
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffered += decoder.decode(next.value, { stream: true });
        for (const frame of readFrames()) {
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            throw new Error("Desktop Host emitted an invalid stream event");
          }
          if (!isHostEngineStreamEvent(event))
            throw new Error("Desktop Host emitted an unsupported stream event");
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export interface HostCapabilityDescriptor {
  id:
    | "files"
    | "media-library"
    | "credentials"
    | "window"
    | "shell"
    | "engines"
    | "agent-provider"
    | "provider-http"
    | "public-search"
    | "web-research"
    | "codex-auth"
    | "notifications"
    | "extensions"
    | "updater";
  available: boolean;
}

export interface HostFileGrant {
  grantId: string;
  kind: "file" | "directory";
  displayName: string;
  expiresAt: string;
  generation: number;
}

/** Opaque reference to a Host-owned, EXIF-stripped portrait derivative. */
export interface HostManagedMedia {
  mediaRef: string;
  sha256: string;
  mimeType: "image/png";
  width: number;
  height: number;
  size: number;
}

export interface DesktopHostActions {
  pickFiles(options: {
    multiple?: boolean;
    extensions?: readonly string[];
  }): Promise<readonly HostFileGrant[] | null>;
  pickDirectory?(): Promise<HostFileGrant | null>;
  readGrantedText?(
    grantId: string,
    maximumBytes: number,
  ): Promise<{ name: string; content: string; size: number }>;
  readGrantedDocument?(
    grantId: string,
    maximumBytes: number,
  ): Promise<HostGrantedDocument>;
  importPortraitMedia?(grantId: string): Promise<HostManagedMedia>;
  removeManagedMedia?(mediaRef: string): Promise<void>;
  publicSearch?(input: {
    source: "duckduckgo" | "gdelt" | "wikimedia";
    query: string;
  }): Promise<PublicSearchResponse>;
  webSearch?(input: PublicWebSearchRequest): Promise<PublicWebSearchResponse>;
  readWebPage?(input: {
    url: string;
    maxCharacters: number;
  }): Promise<PublicWebPageResponse>;
  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean; artifactRef?: string }>;
  openExternal(url: string): Promise<void>;
  revealGrant(grantId: string): Promise<void>;
  revealArtifact(artifactRef: string): Promise<void>;
  removeCredential(credentialRef: string): Promise<void>;
  credentialStorageStatus(): Promise<{
    available: boolean;
    storage: "local_encrypted_file";
    message?: string;
  }>;
  createCredentialCaptureSession?(
    input: CredentialCaptureRequest,
  ): Promise<CredentialCaptureResult>;
  credentialCaptureStatus?(
    captureSessionId: string,
  ): Promise<CredentialCaptureResult | undefined>;
  activateAgentProvider?(
    input: AgentProviderActivationInput,
  ): Promise<AgentProviderActivationResult>;
  providerRequest?(input: ProviderHttpRequest): Promise<ProviderHttpResponse>;
  codexAuthenticationStatus?(): Promise<CodexAuthenticationStatus>;
  loginCodex?(
    input: CodexAuthenticationLoginInput,
  ): Promise<CodexAuthenticationLoginResult>;
  logoutCodex?(): Promise<CodexAuthenticationStatus>;
  setWindowTheme(theme: "light" | "dark"): Promise<void>;
  engineHealth(engine: AgentEngineKind): Promise<Record<string, unknown>>;
  engineOperation?(
    engine: AgentEngineKind,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  engineStream?(
    engine: AgentEngineKind,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncIterable<HostEngineStreamEvent>;
  notify?(input: { title: string; body?: string }): Promise<void>;
  focusWindow?(): Promise<void>;
  checkForUpdates?(): Promise<{ available: boolean }>;
  fetchExtensionRegistry?(
    input: HostExtensionRegistryRequest,
  ): Promise<unknown>;
  stageExtensionPackage?(
    input: HostExtensionPackageStageRequest,
  ): Promise<HostExtensionPackageDescriptor>;
  activateExtension?(input: HostExtensionActivationRequest): Promise<void>;
  invokeExtension?(input: HostExtensionInvocationRequest): Promise<unknown>;
  stopExtension?(pluginId: string): Promise<void>;
  retryExtension?(pluginId: string): Promise<void>;
  extensionDiagnostics?(): Promise<readonly Record<string, unknown>[]>;
  extensionNetworkRequest?(
    input: HostExtensionNetworkRequest,
  ): Promise<ProviderHttpResponse>;
}

export interface DesktopHostOptions {
  accessToken: string;
  actions: DesktopHostActions;
  capabilities: readonly HostCapabilityDescriptor[];
}

export interface DesktopHostServer {
  readonly accessToken: string;
  start(options: { hostname: string; port: number }): Promise<{
    readonly hostname: string;
    readonly port: number;
    close(): void;
  }>;
}

function isAuthorised(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const token = Buffer.from(`Bearer ${expected}`);
  return actual.length === token.length && timingSafeEqual(actual, token);
}

function engineKind(value: string): AgentEngineKind | undefined {
  return ["pi", "codex", "grok", "langgraph"].includes(value)
    ? (value as AgentEngineKind)
    : undefined;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("request body must be an object");
  return value as Record<string, unknown>;
}

function isAgentProviderActivationInput(
  value: Record<string, unknown>,
): value is Record<string, unknown> & AgentProviderActivationInput {
  if (
    typeof value.providerId !== "string" ||
    typeof value.runtimeProviderId !== "string" ||
    typeof value.model !== "string" ||
    typeof value.credentialRef !== "string" ||
    !["openai", "anthropic", "google"].includes(String(value.providerKind)) ||
    !["openai", "openai-compatible", "anthropic", "google"].includes(
      String(value.providerAdapter),
    ) ||
    ![
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
    ].includes(String(value.environmentName))
  )
    return false;
  if (typeof value.baseUrl !== "undefined") {
    if (typeof value.baseUrl !== "string") return false;
    try {
      const url = new URL(value.baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isCodexAuthenticationLoginInput(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CodexAuthenticationLoginInput {
  if (
    ![
      "api_key",
      "chatgpt_browser",
      "chatgpt_device_code",
      "custom_provider",
    ].includes(String(value.mode))
  )
    return false;
  if (
    typeof value.credentialRef !== "undefined" &&
    typeof value.credentialRef !== "string"
  )
    return false;
  if (typeof value.provider === "undefined") return true;
  const provider = value.provider;
  return (
    Boolean(provider) &&
    typeof provider === "object" &&
    !Array.isArray(provider) &&
    typeof (provider as Record<string, unknown>).id === "string" &&
    typeof (provider as Record<string, unknown>).name === "string" &&
    typeof (provider as Record<string, unknown>).baseUrl === "string" &&
    typeof (provider as Record<string, unknown>).model === "string" &&
    ["responses", "chat_completions"].includes(
      String((provider as Record<string, unknown>).protocol),
    )
  );
}

function providerHttpRequest(
  value: Record<string, unknown>,
): ProviderHttpRequest | undefined {
  if (
    typeof value.credentialRef !== "string" ||
    typeof value.url !== "string" ||
    !["GET", "POST"].includes(String(value.method))
  )
    return undefined;
  const url = new URL(value.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return undefined;
  if (
    typeof value.body !== "undefined" &&
    (!value.body || typeof value.body !== "object" || Array.isArray(value.body))
  )
    return undefined;
  const maximumBytes = Number(value.maximumBytes ?? 16 * 1024 * 1024);
  const timeoutMs = Number(value.timeoutMs ?? 90_000);
  const mediaRefs = Array.isArray(value.mediaRefs)
    ? value.mediaRefs
    : undefined;
  if (
    !Number.isInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 64 * 1024 * 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 180_000
  )
    return undefined;
  if (
    mediaRefs &&
    (mediaRefs.length > 12 ||
      mediaRefs.some(
        (reference) =>
          typeof reference !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
            reference,
          ),
      ))
  )
    return undefined;
  return {
    credentialRef: value.credentialRef,
    url: url.toString(),
    method: value.method as "GET" | "POST",
    ...(value.body ? { body: value.body as Record<string, unknown> } : {}),
    accept: value.accept === "binary" ? "binary" : "json",
    maximumBytes,
    timeoutMs,
    ...(mediaRefs ? { mediaRefs } : {}),
  };
}

function isHostEngineStreamEvent(
  value: unknown,
): value is HostEngineStreamEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === "content.delta") return typeof event.delta === "string";
  if (event.type === "result") return "result" in event;
  if (event.type === "error") return typeof event.message === "string";
  if (event.type === "tool")
    return (
      typeof event.tool === "string" &&
      (event.status === "started" ||
        event.status === "completed" ||
        event.status === "failed") &&
      (event.detail === undefined ||
        typeof event.detail === "string" ||
        typeof event.detail === "number" ||
        typeof event.detail === "boolean" ||
        event.detail === null ||
        Array.isArray(event.detail) ||
        typeof event.detail === "object")
    );
  if (event.type === "usage") return true;
  return false;
}

function sse(event: HostEngineStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function unavailable(
  context: { json(value: unknown, status: number): Response },
  capability: string,
): Response {
  return context.json(
    {
      type: "https://dramaip.local/problems/capability-unavailable",
      title: "Capability unavailable",
      status: 503,
      code: "CAPABILITY_UNAVAILABLE",
      capability,
    },
    503,
  );
}

/** A private loopback HTTP boundary. Electron APIs never escape this module. */
export function createDesktopHost(
  options: DesktopHostOptions,
): DesktopHostServer {
  const app = new Hono();
  app.use("/host/v1/*", async (context, next) => {
    if (!isAuthorised(context.req.header("Authorization"), options.accessToken))
      return context.json({ code: "HOST_UNAUTHORIZED" }, 401);
    await next();
  });
  app.onError((error, context) =>
    context.json(
      {
        code: "HOST_REQUEST_INVALID",
        message: error.message,
        traceId: randomUUID(),
      },
      400,
    ),
  );
  app.get("/host/v1/health", (context) =>
    context.json({ healthy: true, capabilities: options.capabilities }),
  );
  app.post("/host/v1/files/pick", async (context) => {
    const body = readObject(await context.req.json());
    const multiple = body.multiple === true;
    const extensions = Array.isArray(body.extensions)
      ? body.extensions
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 50)
      : [];
    return context.json(
      await options.actions.pickFiles({ multiple, extensions }),
    );
  });
  app.post("/host/v1/files/directory", async (context) => {
    if (!options.actions.pickDirectory)
      return unavailable(context, "files.directory");
    return context.json(await options.actions.pickDirectory());
  });
  app.post("/host/v1/files/grants/:grantId/text", async (context) => {
    if (!options.actions.readGrantedText)
      return unavailable(context, "files.read");
    const body = readObject(await context.req.json());
    const maximumBytes = Number(body.maximumBytes);
    if (
      !Number.isInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 32 * 1024 * 1024
    )
      return context.json({ code: "INVALID_FILE_LIMIT" }, 400);
    return context.json(
      await options.actions.readGrantedText(
        context.req.param("grantId"),
        maximumBytes,
      ),
    );
  });
  app.post("/host/v1/files/grants/:grantId/document", async (context) => {
    if (!options.actions.readGrantedDocument)
      return unavailable(context, "files.read-document");
    const body = readObject(await context.req.json());
    const maximumBytes = Number(body.maximumBytes);
    if (
      !Number.isInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 32 * 1024 * 1024
    )
      return context.json({ code: "INVALID_FILE_LIMIT" }, 400);
    return context.json(
      await options.actions.readGrantedDocument(
        context.req.param("grantId"),
        maximumBytes,
      ),
    );
  });
  app.post("/host/v1/media-library/import", async (context) => {
    if (!options.actions.importPortraitMedia)
      return unavailable(context, "media-library.import");
    const body = readObject(await context.req.json());
    if (typeof body.grantId !== "string" || !body.grantId)
      return context.json({ code: "INVALID_FILE_GRANT" }, 400);
    return context.json(
      await options.actions.importPortraitMedia(body.grantId),
    );
  });
  app.delete("/host/v1/media-library/:mediaRef", async (context) => {
    if (!options.actions.removeManagedMedia)
      return unavailable(context, "media-library.remove");
    const mediaRef = context.req.param("mediaRef");
    if (!mediaRef) return context.json({ code: "INVALID_MEDIA_REF" }, 400);
    await options.actions.removeManagedMedia(mediaRef);
    return context.body(null, 204);
  });
  app.post("/host/v1/public-search", async (context) => {
    if (!options.actions.publicSearch)
      return unavailable(context, "public-search");
    const body = readObject(await context.req.json());
    if (
      typeof body.query !== "string" ||
      !body.query.trim() ||
      body.query.length > 500 ||
      !["duckduckgo", "gdelt", "wikimedia"].includes(String(body.source))
    )
      return context.json({ code: "INVALID_PUBLIC_SEARCH" }, 400);
    return context.json(
      await options.actions.publicSearch({
        source: body.source as "duckduckgo" | "gdelt" | "wikimedia",
        query: body.query.trim(),
      }),
    );
  });
  app.post("/host/v1/web/search", async (context) => {
    if (!options.actions.webSearch) return unavailable(context, "web.search");
    const body = readObject(await context.req.json());
    const domains = Array.isArray(body.domains)
      ? body.domains.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (
      !["exa", "parallel"].includes(String(body.provider)) ||
      typeof body.query !== "string" ||
      !body.query.trim() ||
      body.query.length > 500 ||
      typeof body.sessionId !== "string" ||
      !body.sessionId ||
      body.sessionId.length > 200 ||
      !Number.isInteger(body.limit) ||
      Number(body.limit) < 1 ||
      Number(body.limit) > 10 ||
      domains.length > 10 ||
      domains.some((domain) => !/^[A-Za-z0-9.-]{1,253}$/u.test(domain)) ||
      (body.recencyDays !== undefined &&
        (!Number.isInteger(body.recencyDays) ||
          Number(body.recencyDays) < 1 ||
          Number(body.recencyDays) > 3_650)) ||
      (body.credentialRef !== undefined &&
        typeof body.credentialRef !== "string")
    )
      return context.json({ code: "INVALID_WEB_SEARCH" }, 400);
    return context.json(
      await options.actions.webSearch({
        provider: body.provider as PublicWebSearchProvider,
        query: body.query.trim(),
        limit: Number(body.limit),
        sessionId: body.sessionId,
        ...(body.recencyDays === undefined
          ? {}
          : { recencyDays: Number(body.recencyDays) }),
        ...(domains.length ? { domains } : {}),
        ...(typeof body.credentialRef === "string"
          ? { credentialRef: body.credentialRef }
          : {}),
      }),
    );
  });
  app.post("/host/v1/web/read", async (context) => {
    if (!options.actions.readWebPage) return unavailable(context, "web.read");
    const body = readObject(await context.req.json());
    if (
      typeof body.url !== "string" ||
      body.url.length > 4_000 ||
      !Number.isInteger(body.maxCharacters) ||
      Number(body.maxCharacters) < 1_000 ||
      Number(body.maxCharacters) > 50_000
    )
      return context.json({ code: "INVALID_WEB_READ" }, 400);
    try {
      const url = new URL(body.url);
      if (url.protocol !== "https:" || url.username || url.password)
        return context.json({ code: "INVALID_WEB_URL" }, 400);
    } catch {
      return context.json({ code: "INVALID_WEB_URL" }, 400);
    }
    return context.json(
      await options.actions.readWebPage({
        url: body.url,
        maxCharacters: Number(body.maxCharacters),
      }),
    );
  });
  app.post("/host/v1/files/save-text", async (context) => {
    const body = readObject(await context.req.json());
    if (
      typeof body.suggestedName !== "string" ||
      typeof body.content !== "string"
    )
      return context.json({ code: "INVALID_SAVE_INPUT" }, 400);
    return context.json(
      await options.actions.saveTextFile({
        suggestedName: body.suggestedName,
        content: body.content,
      }),
    );
  });
  app.post("/host/v1/shell/open-external", async (context) => {
    const body = readObject(await context.req.json());
    if (typeof body.url !== "string")
      return context.json({ code: "INVALID_EXTERNAL_URL" }, 400);
    const parsed = new URL(body.url);
    if (!["http:", "https:"].includes(parsed.protocol))
      return context.json({ code: "EXTERNAL_URL_NOT_ALLOWED" }, 400);
    await options.actions.openExternal(parsed.toString());
    return context.body(null, 204);
  });
  app.post("/host/v1/shell/reveal-grant", async (context) => {
    const body = readObject(await context.req.json());
    if (typeof body.grantId !== "string" || !body.grantId)
      return context.json({ code: "INVALID_FILE_GRANT" }, 400);
    await options.actions.revealGrant(body.grantId);
    return context.body(null, 204);
  });
  app.post("/host/v1/shell/reveal-artifact", async (context) => {
    const body = readObject(await context.req.json());
    if (typeof body.artifactRef !== "string" || !body.artifactRef)
      return context.json({ code: "INVALID_ARTIFACT_REF" }, 400);
    await options.actions.revealArtifact(body.artifactRef);
    return context.body(null, 204);
  });
  app.get("/host/v1/credentials/status", async (context) =>
    context.json(await options.actions.credentialStorageStatus()),
  );
  app.post("/host/v1/credentials/capture-sessions", async (context) => {
    if (!options.actions.createCredentialCaptureSession)
      return unavailable(context, "credentials.capture");
    const body = readObject(await context.req.json());
    if (
      typeof body.purpose !== "string" ||
      !body.purpose.trim() ||
      (typeof body.label !== "undefined" && typeof body.label !== "string") ||
      (typeof body.policyId !== "undefined" &&
        typeof body.policyId !== "string") ||
      (typeof body.allowedOrigin !== "undefined" &&
        typeof body.allowedOrigin !== "string")
    )
      return context.json({ code: "INVALID_CREDENTIAL_CAPTURE" }, 400);
    return context.json(
      await options.actions.createCredentialCaptureSession({
        purpose: body.purpose,
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(typeof body.policyId === "string"
          ? { policyId: body.policyId }
          : {}),
        ...(typeof body.allowedOrigin === "string"
          ? { allowedOrigin: body.allowedOrigin }
          : {}),
      }),
    );
  });
  app.get(
    "/host/v1/credentials/capture-sessions/:captureSessionId",
    async (context) => {
      if (!options.actions.credentialCaptureStatus)
        return unavailable(context, "credentials.capture");
      const result = await options.actions.credentialCaptureStatus(
        context.req.param("captureSessionId"),
      );
      return result
        ? context.json(result)
        : context.json({ code: "CREDENTIAL_CAPTURE_NOT_FOUND" }, 404);
    },
  );
  app.delete("/host/v1/credentials/:credentialRef", async (context) => {
    await options.actions.removeCredential(context.req.param("credentialRef"));
    return context.body(null, 204);
  });
  app.post("/host/v1/agents/providers/activate", async (context) => {
    if (!options.actions.activateAgentProvider)
      return unavailable(context, "agent-provider");
    const body = readObject(await context.req.json());
    if (!isAgentProviderActivationInput(body))
      return context.json({ code: "INVALID_AGENT_PROVIDER" }, 400);
    return context.json(await options.actions.activateAgentProvider(body));
  });
  app.post("/host/v1/providers/request", async (context) => {
    if (!options.actions.providerRequest)
      return unavailable(context, "provider-http");
    const input = providerHttpRequest(readObject(await context.req.json()));
    if (!input) return context.json({ code: "INVALID_PROVIDER_REQUEST" }, 400);
    return context.json(await options.actions.providerRequest(input));
  });
  app.get("/host/v1/agents/codex/auth", async (context) => {
    if (!options.actions.codexAuthenticationStatus)
      return unavailable(context, "codex-auth");
    return context.json(await options.actions.codexAuthenticationStatus());
  });
  app.post("/host/v1/agents/codex/login", async (context) => {
    if (!options.actions.loginCodex) return unavailable(context, "codex-auth");
    const body = readObject(await context.req.json());
    if (!isCodexAuthenticationLoginInput(body))
      return context.json({ code: "INVALID_CODEX_AUTH" }, 400);
    return context.json(await options.actions.loginCodex(body));
  });
  app.post("/host/v1/agents/codex/logout", async (context) => {
    if (!options.actions.logoutCodex) return unavailable(context, "codex-auth");
    return context.json(await options.actions.logoutCodex());
  });
  app.post("/host/v1/window/theme", async (context) => {
    const body = readObject(await context.req.json());
    if (body.theme !== "light" && body.theme !== "dark")
      return context.json({ code: "INVALID_THEME" }, 400);
    await options.actions.setWindowTheme(body.theme);
    return context.body(null, 204);
  });
  app.post("/host/v1/window/focus", async (context) => {
    if (!options.actions.focusWindow)
      return unavailable(context, "window.focus");
    await options.actions.focusWindow();
    return context.body(null, 204);
  });
  app.post("/host/v1/notifications", async (context) => {
    if (!options.actions.notify) return unavailable(context, "notifications");
    const body = readObject(await context.req.json());
    if (
      typeof body.title !== "string" ||
      (typeof body.body !== "undefined" && typeof body.body !== "string")
    )
      return context.json({ code: "INVALID_NOTIFICATION" }, 400);
    await options.actions.notify({
      title: body.title,
      ...(typeof body.body === "string" ? { body: body.body } : {}),
    });
    return context.body(null, 204);
  });
  app.post("/host/v1/extensions/registry", async (context) => {
    if (!options.actions.fetchExtensionRegistry)
      return unavailable(context, "extensions.registry");
    const input = readObject(await context.req.json().catch(() => ({})));
    if (
      typeof input.url !== "string" ||
      typeof input.keyId !== "string" ||
      typeof input.rootPublicKey !== "string"
    )
      return context.json({ code: "INVALID_EXTENSION_REGISTRY_REQUEST" }, 400);
    return context.json(
      await options.actions.fetchExtensionRegistry({
        url: input.url,
        keyId: input.keyId,
        rootPublicKey: input.rootPublicKey,
      }),
    );
  });
  app.post("/host/v1/extensions/packages", async (context) => {
    if (!options.actions.stageExtensionPackage)
      return unavailable(context, "extensions.packages");
    const input = readObject(await context.req.json().catch(() => ({})));
    if (
      typeof input.packageUrl !== "string" ||
      typeof input.expectedSha256 !== "string" ||
      typeof input.publisherPublicKey !== "string"
    )
      return context.json({ code: "INVALID_EXTENSION_PACKAGE_REQUEST" }, 400);
    return context.json(
      await options.actions.stageExtensionPackage({
        packageUrl: input.packageUrl,
        expectedSha256: input.expectedSha256,
        publisherPublicKey: input.publisherPublicKey,
      }),
    );
  });
  app.post("/host/v1/extensions/activate", async (context) => {
    if (!options.actions.activateExtension)
      return unavailable(context, "extensions.activate");
    const input = readObject(await context.req.json().catch(() => ({})));
    if (
      typeof input.pluginId !== "string" ||
      typeof input.packageRef !== "string" ||
      typeof input.publisherPublicKey !== "string" ||
      typeof input.capabilityEndpoint !== "string" ||
      typeof input.capabilityToken !== "string" ||
      typeof input.permissionRevision !== "number"
    )
      return context.json({ code: "INVALID_EXTENSION_ACTIVATION" }, 400);
    await options.actions.activateExtension(
      input as unknown as HostExtensionActivationRequest,
    );
    return context.body(null, 204);
  });
  app.post("/host/v1/extensions/invoke", async (context) => {
    if (!options.actions.invokeExtension)
      return unavailable(context, "extensions.invoke");
    const input = readObject(await context.req.json().catch(() => ({})));
    if (
      typeof input.pluginId !== "string" ||
      typeof input.handlerId !== "string"
    )
      return context.json({ code: "INVALID_EXTENSION_INVOCATION" }, 400);
    return context.json(
      await options.actions.invokeExtension({
        pluginId: input.pluginId,
        handlerId: input.handlerId,
        payload: input.payload,
      }),
    );
  });
  app.post("/host/v1/extensions/:pluginId/stop", async (context) => {
    if (!options.actions.stopExtension)
      return unavailable(context, "extensions.stop");
    await options.actions.stopExtension(context.req.param("pluginId"));
    return context.body(null, 204);
  });
  app.post("/host/v1/extensions/:pluginId/retry", async (context) => {
    if (!options.actions.retryExtension)
      return unavailable(context, "extensions.retry");
    await options.actions.retryExtension(context.req.param("pluginId"));
    return context.body(null, 204);
  });
  app.get("/host/v1/extensions/diagnostics", async (context) => {
    if (!options.actions.extensionDiagnostics)
      return unavailable(context, "extensions.diagnostics");
    return context.json(await options.actions.extensionDiagnostics());
  });
  app.post("/host/v1/extensions/network", async (context) => {
    if (!options.actions.extensionNetworkRequest)
      return unavailable(context, "extensions.network");
    const input = readObject(await context.req.json().catch(() => ({})));
    if (
      typeof input.url !== "string" ||
      (input.method !== "GET" && input.method !== "POST") ||
      (input.body !== undefined &&
        (!input.body ||
          typeof input.body !== "object" ||
          Array.isArray(input.body)))
    )
      return context.json({ code: "INVALID_EXTENSION_NETWORK_REQUEST" }, 400);
    return context.json(
      await options.actions.extensionNetworkRequest(
        input as unknown as HostExtensionNetworkRequest,
      ),
    );
  });
  app.post("/host/v1/updater/check", async (context) => {
    if (!options.actions.checkForUpdates)
      return unavailable(context, "updater");
    return context.json(await options.actions.checkForUpdates());
  });
  app.get("/host/v1/agent-runtimes/:engine/health", async (context) => {
    const kind = engineKind(context.req.param("engine"));
    if (!kind) return context.json({ code: "UNKNOWN_ENGINE" }, 404);
    return context.json(await options.actions.engineHealth(kind));
  });
  app.post("/host/v1/agent-runtimes/:engine/stream", async (context) => {
    const kind = engineKind(context.req.param("engine"));
    if (!kind) return context.json({ code: "UNKNOWN_ENGINE" }, 404);
    if (!options.actions.engineStream)
      return unavailable(context, `engines.${kind}.stream`);
    const payload = readObject(await context.req.json().catch(() => ({})));
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of options.actions.engineStream!(
            kind,
            payload,
            abort.signal,
          ))
            controller.enqueue(sse(event));
        } catch {
          controller.enqueue(
            sse({
              type: "error",
              message: "智能引擎流式连接中断，请重试。",
            }),
          );
        } finally {
          controller.close();
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(body, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  });
  app.post("/host/v1/agent-runtimes/:engine/:operation", async (context) => {
    const kind = engineKind(context.req.param("engine"));
    if (!kind) return context.json({ code: "UNKNOWN_ENGINE" }, 404);
    const operation = context.req.param("operation");
    if (
      ![
        "availability",
        "create",
        "run",
        "cancel",
        "steer",
        "resume",
        "fork",
        "recoverRun",
        "destroy",
        "health",
      ].includes(operation)
    )
      return context.json({ code: "UNKNOWN_ENGINE_OPERATION" }, 404);
    if (!options.actions.engineOperation)
      return unavailable(context, `engines.${kind}`);
    const payload = readObject(await context.req.json().catch(() => ({})));
    return context.json(
      await options.actions.engineOperation(kind, operation, payload),
    );
  });
  let server: { close(): void } | undefined;
  return {
    accessToken: options.accessToken,
    async start(serverOptions) {
      if (server) throw new Error("Desktop Host is already running");
      return new Promise((resolvePromise, reject) => {
        const nodeServer = serve(
          {
            fetch: app.fetch,
            hostname: serverOptions.hostname,
            port: serverOptions.port,
          },
          (address) => {
            nodeServer.off("error", onError);
            resolvePromise({
              hostname: serverOptions.hostname,
              port: address.port,
              close: () => nodeServer.close(),
            });
          },
        );
        const onError = (error: Error) => {
          nodeServer.close();
          server = undefined;
          reject(error);
        };
        nodeServer.once("error", onError);
        server = nodeServer;
      });
    },
  };
}

export const AGENT_RUNTIME_DESCRIPTORS = {
  pi: {
    kind: "pi",
    role: "embedded-default",
    name: "Pi",
    version: "0.84.2",
    capabilities: {
      prompt: true,
      streaming: true,
      steer: true,
      abort: true,
      resume: true,
      fork: true,
      compaction: true,
      readOnlyTools: true,
    },
  },
  codex: {
    kind: "codex",
    role: "external-benchmark",
    name: "Codex",
    version: "0.147.0",
    capabilities: {
      prompt: true,
      streaming: true,
      steer: false,
      abort: true,
      resume: true,
      fork: true,
      compaction: false,
      readOnlyTools: true,
    },
  },
  grok: {
    kind: "grok",
    role: "external-benchmark",
    name: "Grok Build",
    version: "1.0.5",
    capabilities: {
      prompt: true,
      streaming: true,
      steer: false,
      abort: true,
      resume: true,
      fork: true,
      compaction: false,
      readOnlyTools: true,
    },
  },
  langgraph: {
    kind: "langgraph",
    role: "external-benchmark",
    name: "LangGraph.js",
    version: "1.4.9",
    capabilities: {
      prompt: true,
      streaming: true,
      steer: false,
      abort: true,
      resume: true,
      fork: true,
      compaction: false,
      readOnlyTools: true,
    },
  },
} as const satisfies Readonly<Record<AgentEngineKind, AgentEngineDescriptor>>;

/**
 * Projects the private Host HTTP protocol onto the Core Runtime's stable
 * vendor-neutral contract.  It is intentionally not exported to Renderer.
 */
export function createHostAgentRuntime(
  host: DesktopHostClient,
  kind: AgentEngineKind,
): AgentRuntime {
  const pendingRuns = new Map<string, Record<string, unknown>>();
  const recordedRuns = new Map<
    string,
    { events: AgentRuntimeEvent[]; complete: boolean }
  >();
  const descriptor = AGENT_RUNTIME_DESCRIPTORS[kind];
  const mustSessionId = (result: unknown): string => {
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as Record<string, unknown>).id !== "string"
    )
      throw new AgentRuntimeError(
        "ENGINE_UNAVAILABLE",
        "Agent engine did not return a session identifier.",
      );
    return (result as Record<string, unknown>).id as string;
  };
  return {
    descriptor,
    runRecoveryMode: "snapshot",
    async health(): Promise<AgentRuntimeHealth> {
      const raw = await host.engineHealth(kind).catch(() => undefined);
      const value = raw as Record<string, unknown> | undefined;
      return {
        available: value?.available === true,
        healthy: value?.healthy === true,
        configured: value?.configured === true,
        authenticated: value?.authenticated === true || kind !== "codex",
        generation:
          typeof value?.generation === "number" &&
          Number.isSafeInteger(value.generation)
            ? value.generation
            : 0,
        pendingRequestCount:
          typeof value?.pendingRequestCount === "number" &&
          Number.isSafeInteger(value.pendingRequestCount)
            ? value.pendingRequestCount
            : 0,
        ...(typeof value?.message === "string"
          ? { detail: value.message }
          : {}),
      };
    },
    async availability() {
      const health = await host.engineHealth(kind).catch(() => undefined);
      const value = health as Record<string, unknown> | undefined;
      return {
        available: value?.available === true && value.healthy === true,
        authenticated: value?.authenticated === true || kind !== "codex",
        configured: value?.configured === true,
        ...(typeof value?.message === "string"
          ? { detail: value.message }
          : {}),
      };
    },
    async createSession(input: AgentSessionInput): Promise<AgentSessionRef> {
      const result = await host.engineOperation(kind, "create", {
        title: input.title,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.capabilityGrant
          ? { capabilityGrant: input.capabilityGrant }
          : {}),
      });
      return {
        sessionId: input.sessionId,
        engineSessionId: mustSessionId(result),
      };
    },
    async prompt(session, input): Promise<AgentRunRef> {
      pendingRuns.set(input.runId, {
        engineSessionId: session.engineSessionId,
        runId: input.runId,
        prompt: input.prompt,
        ...(input.responseMode ? { responseMode: input.responseMode } : {}),
        ...(input.capabilityGrant
          ? { capabilityGrant: input.capabilityGrant }
          : {}),
      });
      return { runId: input.runId, engineRunId: input.runId };
    },
    async steer(run, prompt) {
      if (!descriptor.capabilities.steer)
        throw new AgentRuntimeError(
          "UNSUPPORTED_OPERATION",
          `${descriptor.name} does not support steering.`,
        );
      await host.engineOperation(kind, "steer", { runId: run.runId, prompt });
    },
    async abort(run) {
      await host.engineOperation(kind, "cancel", { runId: run.runId });
    },
    async resume(session) {
      if (!descriptor.capabilities.resume)
        throw new AgentRuntimeError(
          "UNSUPPORTED_OPERATION",
          "Resume unsupported.",
        );
      const result = await host.engineOperation(kind, "resume", {
        engineSessionId: session.engineSessionId,
      });
      return {
        sessionId: session.sessionId,
        engineSessionId: mustSessionId(result),
      };
    },
    async fork(session, input) {
      if (!descriptor.capabilities.fork)
        throw new AgentRuntimeError(
          "UNSUPPORTED_OPERATION",
          "Fork unsupported.",
        );
      const result = await host.engineOperation(kind, "fork", {
        engineSessionId: session.engineSessionId,
      });
      return {
        sessionId: input.sessionId,
        engineSessionId: mustSessionId(result),
      };
    },
    async *subscribe(run, options): AsyncIterable<AgentRuntimeEvent> {
      const after = options?.cursor ?? 0;
      const prior = recordedRuns.get(run.runId);
      if (prior?.complete) {
        yield* prior.events.filter((event) => event.cursor > after);
        return;
      }
      const payload = pendingRuns.get(run.runId);
      if (!payload)
        throw new AgentRuntimeError("CONTEXT_INVALID", "Run was not prepared.");
      pendingRuns.delete(run.runId);
      const record = prior ?? { events: [], complete: false };
      recordedRuns.set(run.runId, record);
      try {
        for await (const event of host.engineStream(kind, payload)) {
          const cursor = record.events.length + 1;
          const mapped: AgentRuntimeEvent =
            event.type === "content.delta"
              ? { cursor, type: "content.delta", delta: event.delta }
              : event.type === "tool"
                ? {
                    cursor,
                    type: "tool",
                    status: event.status,
                    tool: event.tool,
                    ...(event.itemId ? { itemId: event.itemId } : {}),
                    ...(event.detail !== undefined
                      ? { detail: event.detail }
                      : {}),
                  }
                : event.type === "usage"
                  ? {
                      cursor,
                      type: "usage",
                      usage: {
                        inputTokens: event.inputTokens,
                        outputTokens: event.outputTokens,
                        cachedTokens: event.cachedTokens,
                        estimatedCost: event.estimatedCost,
                        currency: event.currency,
                      },
                    }
                  : event.type === "result"
                    ? { cursor, type: "result", result: event.result as never }
                    : {
                        cursor,
                        type: "error",
                        code: "PROVIDER_REJECTED",
                        message: event.message,
                        retryable: false,
                      };
          record.events.push(mapped);
          if (mapped.cursor > after) yield mapped;
        }
      } catch {
        const interrupted: AgentRuntimeEvent = {
          cursor: record.events.length + 1,
          type: "error",
          code: "RUN_INTERRUPTED",
          message: "Agent engine stream was interrupted.",
          retryable: true,
        };
        record.events.push(interrupted);
        if (interrupted.cursor > after) yield interrupted;
      }
      record.complete = true;
    },
    async recoverRun(input) {
      const result = await host.engineOperation(kind, "recoverRun", {
        engineSessionId: input.session.engineSessionId,
        runId: input.run.runId,
        ...(input.run.engineRunId
          ? { engineRunId: input.run.engineRunId }
          : {}),
        afterCursor: input.afterCursor,
      });
      if (!result || typeof result !== "object")
        return { disposition: "missing" };
      const value = result as Record<string, unknown>;
      if (value.disposition === "completed")
        return {
          disposition: "completed",
          result: value.result as never,
          finalCursor:
            typeof value.finalCursor === "number"
              ? value.finalCursor
              : input.afterCursor + 1,
        };
      if (value.disposition === "resumed")
        return {
          disposition: "resumed",
          session: input.session,
          run: input.run,
        };
      return { disposition: "missing" };
    },
    async dispose(session) {
      await host.engineOperation(kind, "destroy", {
        engineSessionId: session.engineSessionId,
      });
    },
  };
}
