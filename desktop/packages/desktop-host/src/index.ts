import { randomUUID, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { AgentEngineKind } from "@dramaip/contracts";
import {
  AgentRuntimeError,
  type AgentRunRef,
  type AgentRuntime,
  type AgentRuntimeEvent,
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
}

export interface ProviderHttpResponse {
  status: number;
  contentType: string;
  json?: unknown;
  base64?: string;
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
    token: string,
    maximumBytes = 16 * 1024 * 1024,
  ): Promise<{ name: string; content: string; size: number }> {
    return this.request(
      `/host/v1/files/grants/${encodeURIComponent(token)}/text`,
      {
        method: "POST",
        body: JSON.stringify({ maximumBytes }),
      },
    );
  }

  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean }> {
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

  revealPath(path: string): Promise<void> {
    return this.request("/host/v1/shell/reveal", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  storeCredential(secret: string): Promise<{ credentialRef: string }> {
    return this.request("/host/v1/credentials", {
      method: "POST",
      body: JSON.stringify({ secret }),
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
    | "credentials"
    | "window"
    | "shell"
    | "engines"
    | "agent-provider"
    | "provider-http"
    | "codex-auth"
    | "notifications"
    | "updater";
  available: boolean;
}

export interface HostFileGrant {
  token: string;
  name: string;
  expiresAt: number;
}

export interface DesktopHostActions {
  pickFiles(options: {
    multiple?: boolean;
    extensions?: readonly string[];
  }): Promise<readonly HostFileGrant[] | null>;
  pickDirectory?(): Promise<HostFileGrant | null>;
  readGrantedText?(
    token: string,
    maximumBytes: number,
  ): Promise<{ name: string; content: string; size: number }>;
  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean }>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  storeCredential(secret: string): Promise<{ credentialRef: string }>;
  removeCredential(credentialRef: string): Promise<void>;
  credentialStorageStatus(): Promise<{
    available: boolean;
    storage: "local_encrypted_file";
    message?: string;
  }>;
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
}

export interface DesktopHostOptions {
  accessToken: string;
  actions: DesktopHostActions;
  capabilities: readonly HostCapabilityDescriptor[];
}

export interface DesktopHostServer {
  readonly accessToken: string;
  start(options: { hostname: string; port: number }): { close(): void };
}

function isAuthorised(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const token = Buffer.from(`Bearer ${expected}`);
  return actual.length === token.length && timingSafeEqual(actual, token);
}

function engineKind(value: string): AgentEngineKind | undefined {
  return ["pi", "codex", "grok"].includes(value)
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
  if (
    !Number.isInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 64 * 1024 * 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 180_000
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
        event.status === "failed")
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
  app.post("/host/v1/files/grants/:token/text", async (context) => {
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
        context.req.param("token"),
        maximumBytes,
      ),
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
  app.post("/host/v1/shell/reveal", async (context) => {
    const body = readObject(await context.req.json());
    if (typeof body.path !== "string" || !body.path)
      return context.json({ code: "INVALID_REVEAL_PATH" }, 400);
    await options.actions.revealPath(body.path);
    return context.body(null, 204);
  });
  app.get("/host/v1/credentials/status", async (context) =>
    context.json(await options.actions.credentialStorageStatus()),
  );
  app.post("/host/v1/credentials", async (context) => {
    const body = readObject(await context.req.json());
    if (typeof body.secret !== "string" || !body.secret)
      return context.json({ code: "INVALID_CREDENTIAL" }, 400);
    return context.json(await options.actions.storeCredential(body.secret));
  });
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
    start(serverOptions) {
      if (server) throw new Error("Desktop Host is already running");
      server = serve({
        fetch: app.fetch,
        hostname: serverOptions.hostname,
        port: serverOptions.port,
      });
      return server;
    },
  };
}

const AGENT_RUNTIME_DESCRIPTORS = {
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
} as const;

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
        ...(input.capabilityGrant
          ? { capabilityGrant: input.capabilityGrant }
          : {}),
      });
      return { runId: input.runId };
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
      record.complete = true;
    },
    async dispose(session) {
      await host.engineOperation(kind, "destroy", {
        engineSessionId: session.engineSessionId,
      });
    },
  };
}
