import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  Notification,
  shell,
  utilityProcess,
} from "electron";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { JsonValue } from "@dramaip/contracts";
import {
  createDesktopHost,
  type AgentProviderActivationInput,
  type CodexAuthenticationLoginInput,
  type CodexAuthenticationLoginResult,
  type CodexAuthenticationStatus,
  type HostEngineStreamEvent,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type PublicWebSearchRequest,
} from "@dramaip/desktop-host";
import { sha256, verifyExtensionRegistry } from "@dramaip/extension-host";
import { bootstrapCodexAuthentication } from "./codex-auth-bootstrap";
import {
  LocalCredentialVault,
  type CredentialUse,
} from "./local-credential-vault";
import { CredentialCaptureManager } from "./credential-capture";
import { safeHttpRequest } from "./host/safe-http-transport";
import { extractSafeWebPage } from "./host/web-page-content";
import { EngineEventChannel } from "./engines/engine-event-channel";
import {
  ManagedComponentState,
  RestartBudget,
} from "./supervision/managed-component";
import { registerRuntimeBootstrapExchange } from "./runtime-bootstrap-channel";
import {
  createMainWindow,
  destroyMainWindows,
  hasMainWindow,
  RENDERER_ORIGIN,
  registerRendererProtocol,
  registerRendererScheme,
} from "./windows/window-manager";
import { shutdownApplication } from "./application-supervisor";
import { ExtensionProcessSupervisor } from "./extensions/extension-process-supervisor";
import { extractGrantedDocument } from "./document-import";

const require = createRequire(import.meta.url);
const developmentIconPath = join(__dirname, "../../build/icon.png");
const isolatedTestUserData = process.env.DRAMAIP_E2E_USER_DATA;
if (isolatedTestUserData) app.setPath("userData", isolatedTestUserData);

type Ready = {
  baseUrl: string;
  accessToken: string;
  appVersion: string;
  apiVersion: "2";
  runtimeId: string;
  runtimeGeneration: number;
};
type ChildMessage =
  | {
      type: "ready";
      version?: string;
      configured?: boolean;
      authenticated?: boolean;
    }
  | { type: "error"; error: { message: string } }
  | { type: "unavailable"; reason: string }
  | {
      type: "configured";
      requestId: string;
      available: boolean;
      version?: string;
      error?: string;
    }
  | { type: "response"; requestId: string; result?: unknown; error?: string }
  | { type: "event"; runId: string; event: Record<string, unknown> }
  | { type: "diagnostic"; level: string; message: string }
  | {
      type: "runtime:ready";
      runtimeId: string;
      runtimeGeneration: number;
      graphRevision: string;
      port: number;
      runtimeVersion: string;
      apiVersion: "2";
      runtimeKind: "electron-node";
      electronVersion: string;
      nodeVersion: string;
    }
  | { type: "runtime:error"; error: { message: string } }
  | { type: "stopped" };
type ManagedProcess = {
  child: Electron.UtilityProcess;
  name: string;
  command: Record<string, unknown>;
  required: boolean;
  generation: number;
  /** The sidecar accepted its start command and is still alive. */
  healthy: boolean;
  /** The sidecar has accepted the currently selected model configuration. */
  configured: boolean;
  version?: string;
  authenticated?: boolean;
  runtimeReady?: {
    runtimeId: string;
    runtimeGeneration: number;
    graphRevision: string;
    port: number;
  };
  stop(): Promise<void>;
};
type FileCapability = {
  path: string;
  kind: "file" | "directory";
  webContentsId: number;
  permissions: readonly ["read"];
  expiresAt: number;
};

registerRendererScheme();
let coreRuntime: ManagedProcess | undefined;
let codexEngine: ManagedProcess | undefined;
let piEngine: ManagedProcess | undefined;
let grokEngine: ManagedProcess | undefined;
let langgraphEngine: ManagedProcess | undefined;
let initialization: Promise<Ready> | undefined;
let hostServer: { close(): void; port: number } | undefined;
let runtimeReady: Ready | undefined;
const credentialVault = new LocalCredentialVault(
  join(app.getPath("userData"), "credentials"),
);
let credentialCaptureManager: CredentialCaptureManager | undefined;
const fileCapabilities = new Map<string, FileCapability>();
const artifactCapabilities = new Map<string, string>();
const managedPortraitMedia = new Map<string, string>();
const hostGeneration = 1;
const componentStates = new Map(
  [
    "core-runtime",
    "codex-engine",
    "pi-engine",
    "grok-engine",
    "langgraph-engine",
  ].map((name) => [name, new ManagedComponentState(name)]),
);
const restartBudgets = new Map(
  [...componentStates].map(([name]) => [name, new RestartBudget()]),
);
const intentionallyStoppedSidecars = new WeakSet<Electron.UtilityProcess>();
const engineConfigurationRequests = new Map<
  string,
  {
    resolve(value: { available: boolean; message?: string }): void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
const engineHostRequests = new Map<
  string,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
const engineHostStreams = new Map<string, EngineEventChannel>();
let shuttingDown = false;

function sidecarPath(name: string): string {
  return join(__dirname, `${name}.js`);
}

const extensionSupervisor = new ExtensionProcessSupervisor(
  sidecarPath("extension-host-process"),
  join(app.getPath("userData"), "extensions", "packages"),
);

/**
 * Electron's app.getAppPath() is the workspace root when a built main entry is
 * launched directly (as happens in development and E2E), but it is the app
 * bundle in other launch modes.  Engine assets always belong to apps/desktop,
 * so resolve that root from the compiled main entry first.
 */
function desktopRuntimeRoot(): string {
  const candidates = [
    join(__dirname, "..", ".."),
    app.getAppPath(),
    join(app.getAppPath(), "apps", "desktop"),
  ];
  return (
    candidates.find((candidate) =>
      existsSync(join(candidate, "package.json")),
    ) ?? candidates[0]
  );
}

function codexTargetTriple(): string {
  if (process.platform === "darwin")
    return process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : "x86_64-apple-darwin";
  if (process.platform === "win32")
    return process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc";
  return process.arch === "arm64"
    ? "aarch64-unknown-linux-musl"
    : "x86_64-unknown-linux-musl";
}

function codexBinaryPath(): string {
  if (process.env.DRAMAIP_CODEX_BINARY) return process.env.DRAMAIP_CODEX_BINARY;
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      "codex",
      codexTargetTriple(),
      executable,
    );
  }
  const prepared = join(
    desktopRuntimeRoot(),
    "build",
    "codex",
    codexTargetTriple(),
    executable,
  );
  if (existsSync(prepared)) return prepared;
  const packageNames: Record<string, string> = {
    "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
    "x86_64-apple-darwin": "@openai/codex-darwin-x64",
    "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
    "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
    "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
    "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  };
  const packageName = packageNames[codexTargetTriple()];
  if (!packageName) throw new Error("当前平台没有固定的 Codex 运行时");
  const codexManifest = require.resolve("@openai/codex/package.json");
  const codexRequire = createRequire(codexManifest);
  const manifest = codexRequire.resolve(`${packageName}/package.json`);
  return join(
    resolve(manifest, ".."),
    "vendor",
    codexTargetTriple(),
    "bin",
    executable,
  );
}

function codexModelCatalogPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "codex", "models.json")]
    : [
        join(desktopRuntimeRoot(), "build", "codex", "models.json"),
        join(
          desktopRuntimeRoot(),
          "../../vendor/codex-rust/codex-rs/models-manager/models.json",
        ),
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

function dramaipCodexHome(): string {
  return join(app.getPath("userData"), "codex-engine");
}

function existingCodexHome(destinationHome: string): string {
  const inherited = process.env.CODEX_HOME?.trim();
  if (inherited && resolve(inherited) !== resolve(destinationHome))
    return inherited;
  return join(app.getPath("home"), ".codex");
}

async function bootstrapCodexAuth(): Promise<void> {
  const destinationHome = dramaipCodexHome();
  try {
    const result = await bootstrapCodexAuthentication({
      sourceHome: existingCodexHome(destinationHome),
      destinationHome,
    });
    if (result === "imported")
      console.info("Imported existing Codex authentication into DramaIP");
  } catch {
    console.warn("Could not import existing Codex authentication");
  }
}

function piRuntimeModule(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "pi", "runtime", "runtime.mjs")
    : join(desktopRuntimeRoot(), "build", "pi", "runtime.mjs");
}

function grokBinaryPath(): string {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Grok Build Runtime 当前仅支持 macOS arm64");
  const prepared = app.isPackaged
    ? join(process.resourcesPath, "grok", "aarch64-apple-darwin", "grok")
    : join(
        desktopRuntimeRoot(),
        "build",
        "grok",
        "aarch64-apple-darwin",
        "grok",
      );
  if (!existsSync(prepared)) throw new Error("Grok Build Runtime 未准备");
  return prepared;
}

async function removeCredential(credentialRef: string): Promise<void> {
  await credentialVault.remove(credentialRef);
}

async function resolveCredential(
  credentialRef: string,
  use?: CredentialUse,
): Promise<string | undefined> {
  return credentialVault.resolve(credentialRef, use);
}

function spawnSidecar(
  name: string,
  command: Record<string, unknown>,
  required: boolean,
): Promise<ManagedProcess | undefined> {
  return new Promise((resolvePromise, reject) => {
    const component = componentStates.get(name);
    if (!component) throw new Error(`Unknown supervised component: ${name}`);
    const restarting = component.snapshot().status === "degraded";
    const generation = component.beginStart(restarting);
    const child = utilityProcess.fork(sidecarPath(name), [], {
      serviceName: `DramaIP ${name}`,
      stdio: "pipe",
    });
    component.attach(child.pid);
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      // Preserve bounded startup diagnostics without ever forwarding Bearer
      // tokens or credential-like values into application logs/dialogs.
      stderr = `${stderr}${String(chunk)}`
        .slice(-8_192)
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [REDACTED]")
        .replace(
          /((?:accessToken|apiKey|credential))\s*[:=]\s*[^\s,}]+/giu,
          "$1=[REDACTED]",
        )
        .trim();
    });
    let settled = false;
    const finish = (value: ManagedProcess | undefined) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolvePromise(value);
      }
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (required) reject(error);
      else resolvePromise(undefined);
    };
    const timeout = setTimeout(
      () => fail(new Error(`${name} did not become ready within 20 seconds`)),
      20_000,
    );
    child.once("exit", (code) => {
      if (component.snapshot().generation === generation)
        component.exited(code ?? undefined);
      if (!settled)
        fail(
          new Error(
            `${name} exited before ready (${code})${stderr ? `: ${stderr}` : ""}`,
          ),
        );
    });
    child.on("message", (message: ChildMessage) => {
      if (component.snapshot().generation !== generation) return;
      if (message.type === "ready") {
        const managed: ManagedProcess = {
          child,
          name,
          command,
          required,
          generation,
          // `ready` proves that the process and its vendor transport are
          // healthy.  A missing model is configuration state, not a failed
          // process; keeping the two separate lets Runtime restore a saved
          // provider after a full Electron restart.
          healthy: true,
          configured: message.configured ?? true,
          ...(message.version ? { version: message.version } : {}),
          ...(message.authenticated !== undefined
            ? { authenticated: message.authenticated }
            : {}),
          stop: () =>
            stopManagedComponent(
              component,
              child,
              ["pi-engine", "grok-engine", "langgraph-engine"].includes(name)
                ? 15_000
                : 6_000,
            ),
        };
        component.ready({
          configured: managed.configured,
          authenticated: managed.authenticated,
        });
        restartBudgets.get(name)?.markStable();
        child.once("exit", () => {
          if (!shuttingDown && !intentionallyStoppedSidecars.delete(child)) {
            failPendingEngineWork(`${name} exited during an active request`);
            void restartSidecar(managed);
          }
        });
        return finish(managed);
      }
      if (name === "core-runtime" && message.type === "runtime:ready") {
        if (
          message.runtimeKind !== "electron-node" ||
          !message.electronVersion ||
          !message.nodeVersion
        )
          return fail(
            new Error("Core Runtime did not report Electron embedded Node"),
          );
        const managed: ManagedProcess = {
          child,
          name,
          command,
          required,
          generation,
          healthy: true,
          configured: true,
          version: message.runtimeVersion,
          runtimeReady: {
            runtimeId: message.runtimeId,
            runtimeGeneration: message.runtimeGeneration,
            graphRevision: message.graphRevision,
            port: message.port,
          },
          stop: () => stopManagedComponent(component, child, 6_000),
        };
        component.ready({ configured: true, authenticated: true });
        restartBudgets.get(name)?.markStable();
        child.once("exit", () => {
          if (!shuttingDown && !intentionallyStoppedSidecars.delete(child))
            void restartSidecar(managed);
        });
        return finish(managed);
      }
      if (name === "core-runtime" && message.type === "runtime:error")
        return fail(new Error(message.error.message));
      if (
        ["pi-engine", "grok-engine", "langgraph-engine"].includes(name) &&
        message.type === "configured"
      ) {
        const pending = engineConfigurationRequests.get(message.requestId);
        if (!pending) return;
        engineConfigurationRequests.delete(message.requestId);
        clearTimeout(pending.timeout);
        pending.resolve({
          available: message.available,
          ...(message.error ? { message: message.error } : {}),
        });
        return;
      }
      if (
        [
          "codex-engine",
          "pi-engine",
          "grok-engine",
          "langgraph-engine",
        ].includes(name) &&
        message.type === "response"
      ) {
        const pendingHostRequest = engineHostRequests.get(message.requestId);
        if (pendingHostRequest) {
          engineHostRequests.delete(message.requestId);
          clearTimeout(pendingHostRequest.timeout);
          if (message.error)
            pendingHostRequest.reject(new Error(message.error));
          else pendingHostRequest.resolve(message.result);
          return;
        }
        return;
      }
      if (
        [
          "codex-engine",
          "pi-engine",
          "grok-engine",
          "langgraph-engine",
        ].includes(name) &&
        message.type === "event"
      ) {
        const stream = engineHostStreams.get(message.runId);
        const event = hostEngineStreamEvent(message.event);
        if (stream && event) {
          stream.push(event);
          return;
        }
        return;
      }
      if (message.type === "diagnostic") {
        console.warn(`${name}: ${message.message}`);
        return;
      }
      if (message.type === "unavailable") {
        console.warn(`${name} is unavailable: ${message.reason}`);
        if (required) return fail(new Error(message.reason));
        child.kill();
        return finish(undefined);
      }
      if (message.type === "error")
        return fail(new Error(message.error.message));
    });
    child.postMessage({ ...command, generation });
  });
}

function failPendingEngineWork(message: string): void {
  for (const [requestId, pending] of engineHostRequests) {
    engineHostRequests.delete(requestId);
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
  for (const [requestId, pending] of engineConfigurationRequests) {
    engineConfigurationRequests.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve({ available: false, message });
  }
  for (const channel of engineHostStreams.values())
    channel.finish({ type: "error", message: "智能引擎进程异常退出。" });
  engineHostStreams.clear();
}

async function configureRuntimeEngine(
  engineKind: "pi" | "grok" | "langgraph",
  engine: ManagedProcess | undefined,
  displayName: string,
  provider: {
    providerKind: "openai" | "anthropic" | "google";
    providerAdapter: "openai" | "openai-compatible" | "anthropic" | "google";
    model: string;
    baseUrl?: string;
    secret: string;
  },
): Promise<{ available: boolean; message?: string }> {
  if (!engine)
    return { available: false, message: `${displayName} Runtime 未启动` };
  const requestId = randomUUID();
  const result = new Promise<{ available: boolean; message?: string }>(
    (resolvePromise) => {
      const timeout = setTimeout(() => {
        engineConfigurationRequests.delete(requestId);
        resolvePromise({
          available: false,
          message: `${displayName} 配置响应超时`,
        });
      }, 20_000);
      engineConfigurationRequests.set(requestId, {
        resolve: resolvePromise,
        timeout,
      });
    },
  );
  engine.command.provider = provider;
  engine.child.postMessage({
    type: "configure",
    requestId,
    engineKind,
    provider,
  });
  return result;
}

async function activateAgentProvider(
  configuration: AgentProviderActivationInput,
): Promise<{ available: boolean; message?: string }> {
  const defaultOrigins = {
    openai: "https://api.openai.com",
    anthropic: "https://api.anthropic.com",
    google: "https://generativelanguage.googleapis.com",
  } as const;
  const secret = await resolveCredential(configuration.credentialRef, {
    purpose: "provider-authentication",
    origin: configuration.baseUrl ?? defaultOrigins[configuration.providerKind],
  });
  if (!secret)
    return { available: false, message: "智能助手模型的安全凭据不可用" };
  const provider = {
    providerKind: configuration.providerKind,
    providerAdapter: configuration.providerAdapter,
    model: configuration.model,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    secret,
  };
  const [pi, grok, langgraph] = await Promise.all([
    configureRuntimeEngine("pi", piEngine, "Pi", provider),
    configureRuntimeEngine("grok", grokEngine, "Grok Build", provider),
    configureRuntimeEngine(
      "langgraph",
      langgraphEngine,
      "LangGraph.js",
      provider,
    ),
  ]);
  if (piEngine) piEngine.configured = pi.available;
  if (grokEngine) grokEngine.configured = grok.available;
  if (langgraphEngine) langgraphEngine.configured = langgraph.available;
  if (langgraphEngine) langgraphEngine.authenticated = langgraph.available;
  return pi.available
    ? { available: true }
    : { available: false, message: pi.message ?? grok.message };
}

async function executeProviderHttpRequest(
  input: ProviderHttpRequest,
): Promise<ProviderHttpResponse> {
  const secret = await resolveCredential(input.credentialRef, {
    purpose: "provider-authentication",
    origin: new URL(input.url).origin,
  });
  if (!secret) throw new Error("服务商安全凭据不可用");
  const body = input.body ? { ...input.body } : {};
  if (input.mediaRefs?.length) {
    const referenceImages = await Promise.all(
      input.mediaRefs.map(async (mediaRef) => {
        const path = managedPortraitMedia.get(mediaRef);
        if (!path) throw new Error("受控照片引用不可用或已被删除");
        const bytes = await readFile(path);
        return `data:image/png;base64,${bytes.toString("base64")}`;
      }),
    );
    // Only the Host materialises media bytes. The Runtime passes opaque refs;
    // the provider request gets no source path and the project DB gets no bytes.
    body.reference_images = referenceImages;
  }
  const response = await safeHttpRequest({
    url: input.url,
    method: input.method,
    ...(Object.keys(body).length ? { body } : {}),
    accept: input.accept ?? "json",
    maximumBytes: input.maximumBytes ?? 16 * 1024 * 1024,
    timeoutMs: input.timeoutMs ?? 90_000,
    authorization: `Bearer ${secret}`,
  });
  if (input.accept === "binary")
    return {
      status: response.status,
      contentType: response.contentType,
      base64: response.bytes.toString("base64"),
    };
  let json: unknown;
  try {
    json = JSON.parse(response.bytes.toString("utf8"));
  } catch {
    json = { message: response.bytes.toString("utf8").slice(0, 2_000) };
  }
  return { status: response.status, contentType: response.contentType, json };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;|&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function duckDuckGoResults(html: string) {
  const blocks =
    html.match(/<div[^>]+class="result[^>]*>[\s\S]*?<\/div>\s*<\/div>/gu) ?? [];
  return blocks.slice(0, 10).flatMap((block) => {
    const link =
      /class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/u.exec(block);
    if (!link) return [];
    try {
      const url = new URL(decodeHtml(link[1]!));
      if (!/^https?:$/u.test(url.protocol)) return [];
      const excerpt = /class="result__snippet"[^>]*>([\s\S]*?)<\/[^>]+>/u.exec(
        block,
      );
      return [
        {
          title: decodeHtml(link[2]!),
          url: url.toString(),
          ...(excerpt ? { excerpt: decodeHtml(excerpt[1]!) } : {}),
        },
      ];
    } catch {
      return [];
    }
  });
}

async function publicSearch(input: {
  source: "duckduckgo" | "gdelt" | "wikimedia";
  query: string;
}) {
  if (input.source === "duckduckgo") {
    const response = await safeHttpRequest({
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`,
      method: "GET",
      accept: "text",
      maximumBytes: 2 * 1024 * 1024,
      timeoutMs: 15_000,
      authorization: "",
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(`DuckDuckGo returned ${response.status}`);
    return {
      source: "duckduckgo" as const,
      results: duckDuckGoResults(response.bytes.toString("utf8")),
      coverage:
        "DuckDuckGo 公开非脚本网页结果；属于尽力而为的补充，不代表完整全网。",
    };
  }
  if (input.source === "gdelt") {
    const response = await safeHttpRequest({
      // Keep the external GDELT path distinct from DramaIP's internal API
      // namespace; Electron Main never calls a Runtime business route.
      url: `https://api.gdeltproject.org/api/${"v2"}/doc/doc?query=${encodeURIComponent(input.query)}&mode=artlist&format=json&maxrecords=10`,
      method: "GET",
      accept: "json",
      maximumBytes: 2 * 1024 * 1024,
      timeoutMs: 15_000,
      authorization: "",
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(`GDELT returned ${response.status}`);
    const data = JSON.parse(response.bytes.toString("utf8")) as {
      articles?: Array<Record<string, unknown>>;
    };
    return {
      source: "gdelt" as const,
      results: (data.articles ?? []).flatMap((article) =>
        typeof article.title === "string" && typeof article.url === "string"
          ? [
              {
                title: article.title,
                url: article.url,
                ...(typeof article.seendate === "string"
                  ? { publishedAt: article.seendate }
                  : {}),
              },
            ]
          : [],
      ),
      coverage: "GDELT 新闻索引结果；适合新闻覆盖，不代表一般网页搜索。",
    };
  }
  const response = await safeHttpRequest({
    url: `https://zh.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=10&srsearch=${encodeURIComponent(input.query)}`,
    method: "GET",
    accept: "json",
    maximumBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
    authorization: "",
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Wikimedia returned ${response.status}`);
  const data = JSON.parse(response.bytes.toString("utf8")) as {
    query?: { search?: Array<Record<string, unknown>> };
  };
  return {
    source: "wikimedia" as const,
    results: (data.query?.search ?? []).flatMap((entry) =>
      typeof entry.title === "string"
        ? [
            {
              title: entry.title,
              url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /gu, "_"))}`,
              ...(typeof entry.snippet === "string"
                ? { excerpt: decodeHtml(entry.snippet) }
                : {}),
            },
          ]
        : [],
    ),
    coverage: "Wikimedia 公开知识库结果；适合背景资料，不代表完整全网。",
  };
}

function mcpSearchText(body: string): string {
  const candidates = [
    body.trim(),
    ...body
      .replaceAll("\r\n", "\n")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim()),
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) continue;
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const result = isRecord(value.result) ? value.result : undefined;
      const content = Array.isArray(result?.content) ? result.content : [];
      const text = content
        .flatMap((item) =>
          isRecord(item) &&
          item.type === "text" &&
          typeof item.text === "string"
            ? [item.text]
            : [],
        )
        .join("\n\n")
        .trim();
      if (text) return text.slice(0, 200_000);
      const error = isRecord(value.error)
        ? (value.error as Record<string, unknown>)
        : undefined;
      if (typeof error?.message === "string") throw new Error(error.message);
    } catch (cause) {
      if (cause instanceof Error && !cause.message.includes("JSON"))
        throw cause;
    }
  }
  throw new Error("Web search provider returned no readable result");
}

async function webSearch(input: PublicWebSearchRequest) {
  let credential: string | undefined;
  if (input.credentialRef)
    credential = await resolveCredential(input.credentialRef, {
      purpose: "public-web-search",
      origin:
        input.provider === "exa"
          ? "https://mcp.exa.ai"
          : "https://search.parallel.ai",
    });
  const query = [
    input.query,
    ...(input.domains?.length
      ? [`(${input.domains.map((domain) => `site:${domain}`).join(" OR ")})`]
      : []),
    ...(input.recencyDays
      ? [
          `after:${new Date(Date.now() - input.recencyDays * 86_400_000)
            .toISOString()
            .slice(0, 10)}`,
        ]
      : []),
  ]
    .join(" ")
    .slice(0, 1_000);
  const endpoint =
    input.provider === "exa"
      ? "https://mcp.exa.ai/mcp"
      : "https://search.parallel.ai/mcp";
  const response = await safeHttpRequest({
    url: endpoint,
    method: "POST",
    accept: "mcp",
    maximumBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
    authorization:
      input.provider === "parallel" && credential ? `Bearer ${credential}` : "",
    ...(input.provider === "exa" && credential ? { apiKey: credential } : {}),
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: input.provider === "exa" ? "web_search_exa" : "web_search",
        arguments:
          input.provider === "exa"
            ? {
                query,
                numResults: input.limit,
              }
            : {
                objective: query,
                search_queries: [query],
                session_id: input.sessionId,
                model_name: "dramaip-agent",
              },
      },
    },
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `${input.provider === "exa" ? "Exa" : "Parallel"} returned ${response.status}`,
    );
  return {
    provider: input.provider,
    text: mcpSearchText(response.bytes.toString("utf8")),
    coverage:
      input.provider === "exa"
        ? "Exa 公开网页搜索结果；匿名服务可能受到速率和可用性限制。"
        : "Parallel 公开网页搜索结果；匿名服务可能受到速率和可用性限制。",
  };
}

async function readWebPage(input: { url: string; maxCharacters: number }) {
  const response = await safeHttpRequest({
    url: input.url,
    method: "GET",
    accept: "text",
    maximumBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
    authorization: "",
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Web page returned ${response.status}`);
  const source = new TextDecoder("utf-8", { fatal: false }).decode(
    response.bytes,
  );
  const mime = response.contentType.toLowerCase().split(";", 1)[0]!.trim();
  const isHtml = mime === "text/html" || mime === "application/xhtml+xml";
  const extracted = isHtml ? extractSafeWebPage(source) : undefined;
  const converted = extracted?.markdown ?? source.trim();
  if (!converted) throw new Error("Web page did not contain readable text");
  const finalUrl = new URL(response.finalUrl);
  const title = extracted?.title ?? finalUrl.hostname.replace(/^www\./u, "");
  return {
    title,
    url: finalUrl.toString(),
    content: converted.slice(0, input.maxCharacters),
    contentType: response.contentType.slice(0, 200),
    retrievedAt: new Date().toISOString(),
    truncated: converted.length > input.maxCharacters,
  };
}

async function restartSidecar(previous: ManagedProcess): Promise<void> {
  const budget = restartBudgets.get(previous.name);
  const delay = budget?.nextDelay();
  if (delay === undefined) {
    console.error(`${previous.name} exceeded restart limit`);
    return;
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
  try {
    if (previous.name === "core-runtime") {
      await restartRuntimeTree(previous);
      return;
    }
    const next = await spawnSidecar(
      previous.name,
      previous.command,
      previous.required,
    );
    if (!next) return;
    if (previous.name === "codex-engine") {
      codexEngine = next;
    }
    if (previous.name === "pi-engine") {
      piEngine = next;
    }
    if (previous.name === "grok-engine") {
      grokEngine = next;
    }
    if (previous.name === "langgraph-engine") {
      langgraphEngine = next;
    }
  } catch (error) {
    console.error(`Failed to restart ${previous.name}`, error);
    await restartSidecar(previous);
  }
}

async function restartRuntimeTree(previous: ManagedProcess): Promise<void> {
  const engines = [codexEngine, piEngine, grokEngine, langgraphEngine].filter(
    (engine): engine is ManagedProcess => Boolean(engine),
  );
  failPendingEngineWork("Core Runtime restarted");
  await extensionSupervisor.stopAll();
  await Promise.allSettled(
    engines.map(async (engine) => {
      intentionallyStoppedSidecars.add(engine.child);
      await engine.stop();
    }),
  );
  codexEngine = undefined;
  piEngine = undefined;
  grokEngine = undefined;
  langgraphEngine = undefined;

  const accessToken = randomBytes(32).toString("base64url");
  const mcpTokens = {
    "codex-engine": randomUUID(),
    "pi-engine": randomUUID(),
    "grok-engine": randomUUID(),
    "langgraph-engine": randomUUID(),
  } as const;
  previous.command.accessToken = accessToken;
  previous.command.engineMcpTokens = Object.values(mcpTokens);
  previous.command.runtimeGeneration =
    Number(previous.command.runtimeGeneration ?? previous.generation) + 1;
  const next = await spawnSidecar(
    previous.name,
    previous.command,
    previous.required,
  );
  if (!next?.runtimeReady)
    throw new Error("Core Runtime restart did not return ready metadata");
  coreRuntime = next;
  const baseUrl = `http://127.0.0.1:${next.runtimeReady.port}`;
  for (const engine of engines) {
    const mcp = engine.command.mcp as
      { url: string; token: string } | undefined;
    if (mcp) {
      mcp.url = `${baseUrl}/engine/v1/mcp`;
      mcp.token = mcpTokens[engine.name as keyof typeof mcpTokens];
    }
  }
  const restarted = await Promise.all(
    engines.map((engine) =>
      spawnSidecar(engine.name, engine.command, engine.required),
    ),
  );
  for (const engine of restarted) {
    if (engine?.name === "codex-engine") codexEngine = engine;
    if (engine?.name === "pi-engine") piEngine = engine;
    if (engine?.name === "grok-engine") grokEngine = engine;
    if (engine?.name === "langgraph-engine") langgraphEngine = engine;
  }
  runtimeReady = {
    baseUrl,
    accessToken,
    appVersion: app.getVersion(),
    apiVersion: "2",
    runtimeId: next.runtimeReady.runtimeId,
    runtimeGeneration: next.runtimeReady.runtimeGeneration,
  };
  destroyMainWindows();
  createWindow(runtimeReady);
}

function stopChild(
  child: Electron.UtilityProcess,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolvePromise) => {
    if (child.pid === undefined) return resolvePromise();
    const timeout = setTimeout(() => {
      child.kill();
      resolvePromise();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.postMessage({ type: "stop" });
  });
}

async function stopManagedComponent(
  component: ManagedComponentState,
  child: Electron.UtilityProcess,
  timeoutMs: number,
): Promise<void> {
  component.stopping();
  await stopChild(child, timeoutMs);
  component.stopped();
}

function managedEngine(engine: import("@dramaip/contracts").AgentEngineKind) {
  return {
    codex: codexEngine,
    pi: piEngine,
    grok: grokEngine,
    langgraph: langgraphEngine,
  }[engine];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredToolValue(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.structuredContent)) return value.structuredContent;
  const content = Array.isArray(value.content) ? value.content : [];
  for (const item of content) {
    if (!isRecord(item) || typeof item.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Non-JSON tool text is intentionally not projected into Runtime state.
    }
  }
  return value;
}

function webToolDetail(value: Record<string, unknown>): JsonValue | undefined {
  const tool = String(value.tool ?? "");
  if (tool !== "dramaip_web_search" && tool !== "dramaip_read_web_page")
    return undefined;
  if (value.status === "started") {
    const args = isRecord(value.arguments) ? value.arguments : {};
    return {
      arguments:
        tool === "dramaip_web_search"
          ? {
              ...(typeof args.query === "string"
                ? { query: args.query.slice(0, 500) }
                : {}),
              ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
            }
          : {
              ...(typeof args.url === "string"
                ? { url: args.url.slice(0, 4_000) }
                : {}),
              ...(typeof args.maxCharacters === "number"
                ? { maxCharacters: args.maxCharacters }
                : {}),
            },
    };
  }
  if (typeof value.error === "string")
    return { error: value.error.slice(0, 500) };
  const result = structuredToolValue(value.result);
  if (!result) return undefined;
  if (tool === "dramaip_read_web_page")
    return {
      result: {
        ...(typeof result.title === "string"
          ? { title: result.title.slice(0, 500) }
          : {}),
        ...(typeof result.url === "string"
          ? { url: result.url.slice(0, 4_000) }
          : {}),
        ...(typeof result.contentType === "string"
          ? { contentType: result.contentType.slice(0, 200) }
          : {}),
        ...(typeof result.retrievedAt === "string"
          ? { retrievedAt: result.retrievedAt }
          : {}),
        ...(typeof result.truncated === "boolean"
          ? { truncated: result.truncated }
          : {}),
      },
    };
  const sources = Array.isArray(result.results)
    ? result.results.slice(0, 10).flatMap((source) => {
        if (!isRecord(source) || typeof source.url !== "string") return [];
        return [
          {
            ...(typeof source.title === "string"
              ? { title: source.title.slice(0, 500) }
              : {}),
            url: source.url.slice(0, 4_000),
            ...(typeof source.excerpt === "string"
              ? { excerpt: source.excerpt.slice(0, 4_000) }
              : {}),
            ...(typeof source.publishedAt === "string"
              ? { publishedAt: source.publishedAt.slice(0, 80) }
              : {}),
            ...(typeof source.retrievedAt === "string"
              ? { retrievedAt: source.retrievedAt }
              : {}),
            ...(typeof source.provider === "string"
              ? { provider: source.provider.slice(0, 30) }
              : {}),
          },
        ];
      })
    : [];
  return {
    result: {
      ...(typeof result.query === "string"
        ? { query: result.query.slice(0, 500) }
        : {}),
      ...(Array.isArray(result.providers)
        ? { providers: result.providers.slice(0, 5).map(String) }
        : {}),
      ...(typeof result.fallbackUsed === "boolean"
        ? { fallbackUsed: result.fallbackUsed }
        : {}),
      results: sources,
    },
  };
}

function hostEngineStreamEvent(
  value: Record<string, unknown>,
): HostEngineStreamEvent | undefined {
  if (value.type === "content.delta" && typeof value.delta === "string")
    return { type: "content.delta", delta: value.delta };
  if (
    value.type === "tool" &&
    typeof value.tool === "string" &&
    (value.status === "started" ||
      value.status === "completed" ||
      value.status === "failed")
  ) {
    const detail = webToolDetail(value);
    const status = typeof value.error === "string" ? "failed" : value.status;
    return {
      type: "tool",
      status,
      tool: value.tool,
      ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
      ...(detail ? { detail } : {}),
    };
  }
  if (value.type === "usage")
    return {
      type: "usage",
      ...(typeof value.inputTokens === "number"
        ? { inputTokens: value.inputTokens }
        : {}),
      ...(typeof value.outputTokens === "number"
        ? { outputTokens: value.outputTokens }
        : {}),
      ...(typeof value.cachedTokens === "number"
        ? { cachedTokens: value.cachedTokens }
        : {}),
      ...(typeof value.estimatedCost === "number"
        ? { estimatedCost: value.estimatedCost }
        : {}),
      ...(typeof value.currency === "string"
        ? { currency: value.currency }
        : {}),
    };
  return undefined;
}

async function requestManagedEngine(
  engine: import("@dramaip/contracts").AgentEngineKind,
  managed: ManagedProcess,
  operation: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const requestId = randomUUID();
  return new Promise<unknown>((resolvePromise, reject) => {
    // Creating a session and reading health/auth are control-plane operations,
    // while a model turn can legitimately take longer to produce its first
    // token.  Do not turn a live Codex (or other vendor) run into a false
    // failure after the generic control-plane timeout.
    const timeoutMs = ["run", "stream"].includes(operation) ? 120_000 : 20_000;
    const timeout = setTimeout(() => {
      engineHostRequests.delete(requestId);
      reject(new Error(`${engine} ${operation} timed out`));
    }, timeoutMs);
    engineHostRequests.set(requestId, {
      resolve: resolvePromise,
      reject,
      timeout,
    });
    managed.child.postMessage({
      type: "request",
      requestId,
      operation,
      payload,
    });
  });
}

function codexAuthStatus(value: unknown): CodexAuthenticationStatus {
  if (!isRecord(value))
    return {
      available: false,
      authenticated: false,
      message: "Codex 认证服务返回了无效状态。",
    };
  const provider = isRecord(value.provider)
    ? {
        id: String(value.provider.id ?? ""),
        name: String(value.provider.name ?? ""),
        model: String(value.provider.model ?? ""),
        baseUrl: String(value.provider.baseUrl ?? ""),
        protocol:
          value.provider.protocol === "chat_completions"
            ? ("chat_completions" as const)
            : ("responses" as const),
      }
    : undefined;
  return {
    available: value.available === true,
    authenticated: value.authenticated === true,
    ...(value.mode === "api_key" ||
    value.mode === "chatgpt" ||
    value.mode === "custom_provider"
      ? { mode: value.mode }
      : {}),
    ...(typeof value.accountLabel === "string"
      ? { accountLabel: value.accountLabel }
      : {}),
    ...(provider &&
    provider.id &&
    provider.name &&
    provider.model &&
    provider.baseUrl
      ? { provider }
      : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

async function readCodexAuthenticationStatus(): Promise<CodexAuthenticationStatus> {
  const managed = codexEngine;
  if (!managed)
    return {
      available: false,
      authenticated: false,
      message: "Codex 引擎未启动。",
    };
  try {
    const status = codexAuthStatus(
      await requestManagedEngine("codex", managed, "authStatus", {}),
    );
    managed.authenticated = status.authenticated;
    return status;
  } catch {
    managed.authenticated = false;
    return {
      available: false,
      authenticated: false,
      message: "无法读取 Codex 认证状态，请重启应用后重试。",
    };
  }
}

async function loginCodex(
  input: CodexAuthenticationLoginInput,
): Promise<CodexAuthenticationLoginResult> {
  const managed = codexEngine;
  if (!managed?.healthy)
    return { status: "unavailable", message: "Codex 引擎未启动。" };
  const payload: Record<string, unknown> = { mode: input.mode };
  if (input.mode === "api_key" || input.mode === "custom_provider") {
    if (!input.credentialRef)
      return { status: "unavailable", message: "安全凭据不可用。" };
    const secret = await resolveCredential(input.credentialRef, {
      purpose:
        input.mode === "custom_provider"
          ? "provider-authentication"
          : "codex-authentication",
      origin:
        input.mode === "custom_provider" && input.provider
          ? input.provider.baseUrl
          : "https://api.openai.com",
    });
    if (!secret) return { status: "unavailable", message: "安全凭据不可用。" };
    payload.apiKey = secret;
  }
  if (input.mode === "custom_provider") {
    if (!input.provider)
      return { status: "unavailable", message: "Codex 服务商配置不完整。" };
    Object.assign(payload, {
      providerId: input.provider.id,
      providerName: input.provider.name,
      baseUrl: input.provider.baseUrl,
      model: input.provider.model,
      protocol: input.provider.protocol,
    });
  }
  try {
    const result = await requestManagedEngine(
      "codex",
      managed,
      "login",
      payload,
    );
    if (!isRecord(result))
      return {
        status: "unavailable",
        message: "Codex 登录服务返回了无效响应。",
      };
    const status =
      result.status === "authenticated" ||
      result.status === "pending" ||
      result.status === "unavailable"
        ? result.status
        : "unavailable";
    const authentication = await readCodexAuthenticationStatus();
    return {
      status,
      ...(typeof result.verificationUrl === "string"
        ? { verificationUrl: result.verificationUrl }
        : {}),
      ...(typeof result.userCode === "string"
        ? { userCode: result.userCode }
        : {}),
      ...(typeof result.message === "string"
        ? { message: result.message }
        : authentication.message
          ? { message: authentication.message }
          : {}),
    };
  } catch {
    return {
      status: "unavailable",
      message: "Codex 登录未完成，请检查认证后重试。",
    };
  }
}

async function logoutCodex(): Promise<CodexAuthenticationStatus> {
  const managed = codexEngine;
  if (!managed)
    return {
      available: false,
      authenticated: false,
      message: "Codex 引擎未启动。",
    };
  try {
    await requestManagedEngine("codex", managed, "logout", {});
  } catch {
    return {
      available: false,
      authenticated: false,
      message: "Codex 退出失败，请重启应用后重试。",
    };
  }
  return readCodexAuthenticationStatus();
}

async function runHostEngineOperation(
  engine: import("@dramaip/contracts").AgentEngineKind,
  operation: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const managed = managedEngine(engine);
  if (!managed)
    return {
      available: false,
      code: "ENGINE_UNAVAILABLE",
      engine,
      message: `${engine} engine is unavailable`,
    };
  if (operation === "availability" || operation === "health") {
    if (engine === "codex") {
      const authentication = await readCodexAuthenticationStatus();
      return {
        // Authentication controls whether a session can be created, not
        // whether the vendor process is alive.  Keeping these distinct makes
        // an unauthenticated Codex installation actionable in Settings
        // instead of misleadingly reporting a failed engine process.
        available: true,
        healthy: managed.healthy,
        configured: authentication.available,
        version: managed.version,
        authenticated: authentication.authenticated,
        generation: managed.generation,
        pendingRequestCount: engineHostRequests.size,
      };
    }
    return {
      available: true,
      healthy: managed.healthy,
      configured: managed.configured,
      version: managed.version,
      authenticated: managed.authenticated,
      generation: managed.generation,
      pendingRequestCount: engineHostRequests.size,
    };
  }
  if (!managed.healthy)
    return {
      available: false,
      code: "ENGINE_UNAVAILABLE",
      engine,
      operation,
      message: "引擎进程未启动或未通过健康检查",
    };
  if (engine === "codex") {
    const authentication = await readCodexAuthenticationStatus();
    if (!authentication.authenticated)
      return {
        available: false,
        code: "ENGINE_AUTH_REQUIRED",
        engine,
        operation,
        message: "请先在设置中心完成 Codex 认证。",
      };
  }
  const sidecarOperation =
    operation === "create"
      ? "createSession"
      : operation === "cancel"
        ? "interrupt"
        : operation === "destroy"
          ? "dispose"
          : operation;
  try {
    return await requestManagedEngine(
      engine,
      managed,
      sidecarOperation,
      payload,
    );
  } catch {
    return {
      available: false,
      code: "ENGINE_OPERATION_FAILED",
      engine,
      operation,
      message: "智能引擎拒绝了此操作，请检查认证、模型和引擎状态。",
    };
  }
}

async function* runHostEngineStream(
  engine: import("@dramaip/contracts").AgentEngineKind,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): AsyncIterable<HostEngineStreamEvent> {
  const managed = managedEngine(engine);
  if (!managed?.healthy) {
    yield {
      type: "error",
      message: "智能引擎未启动或未通过健康检查。",
    };
    return;
  }
  if (engine === "codex") {
    const authentication = await readCodexAuthenticationStatus();
    if (!authentication.authenticated) {
      yield { type: "error", message: "请先在设置中心完成 Codex 认证。" };
      return;
    }
  }
  const runId = hostText(payload.runId, "运行编号", 300);
  if (engineHostStreams.has(runId!)) {
    yield { type: "error", message: "该智能任务已在流式执行。" };
    return;
  }
  const channel = new EngineEventChannel();
  engineHostStreams.set(runId!, channel);
  const sidecarOperation = "run";
  const interrupt = () => {
    if (engineHostStreams.get(runId!) !== channel) return;
    void requestManagedEngine(engine, managed, "interrupt", payload).catch(
      () => undefined,
    );
    channel.finish({ type: "error", message: "流式连接已中断。" });
  };
  signal.addEventListener("abort", interrupt, { once: true });
  void requestManagedEngine(engine, managed, sidecarOperation, payload)
    .then((result) => channel.finish({ type: "result", result }))
    .catch(() =>
      channel.finish({
        type: "error",
        message: "智能引擎调用失败，请检查模型配置和引擎状态后重试。",
      }),
    );
  try {
    for await (const event of channel) yield event;
  } finally {
    signal.removeEventListener("abort", interrupt);
    if (engineHostStreams.get(runId!) === channel)
      engineHostStreams.delete(runId!);
  }
}

function hostText(
  value: unknown,
  field: string,
  maximumLength: number,
  required = true,
): string | undefined {
  if (typeof value !== "string") {
    if (required) throw new Error(`${field} 必须是字符串`);
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength)
    throw new Error(`${field} 长度无效`);
  return normalized;
}

function createHost(accessToken: string) {
  return createDesktopHost({
    accessToken,
    capabilities: [
      { id: "files", available: true },
      { id: "media-library", available: true },
      { id: "credentials", available: true },
      { id: "window", available: true },
      { id: "shell", available: true },
      { id: "engines", available: true },
      { id: "agent-provider", available: true },
      { id: "provider-http", available: true },
      { id: "public-search", available: true },
      { id: "web-research", available: true },
      { id: "codex-auth", available: true },
      { id: "notifications", available: true },
      { id: "extensions", available: true },
      { id: "updater", available: false },
    ],
    actions: {
      async pickFiles(options) {
        const e2eSourceImport =
          isolatedTestUserData && process.env.DRAMAIP_E2E_SOURCE_IMPORT_FILE;
        const result =
          e2eSourceImport && existsSync(e2eSourceImport)
            ? { canceled: false, filePaths: [e2eSourceImport] }
            : await dialog.showOpenDialog({
                properties: [
                  "openFile",
                  ...(options.multiple ? ["multiSelections" as const] : []),
                ],
                filters: options.extensions?.length
                  ? [{ name: "Files", extensions: [...options.extensions] }]
                  : undefined,
              });
        if (result.canceled) return null;
        return result.filePaths.map((path) => {
          const grantId = randomUUID();
          const expiresAt = Date.now() + 10 * 60_000;
          fileCapabilities.set(grantId, {
            path,
            kind: "file",
            webContentsId: 0,
            permissions: ["read"],
            expiresAt,
          });
          return {
            grantId,
            kind: "file" as const,
            displayName: path.split(/[\\/]/).pop() ?? "选中文件",
            expiresAt: new Date(expiresAt).toISOString(),
            generation: hostGeneration,
          };
        });
      },
      async pickDirectory() {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });
        const path = result.filePaths[0];
        if (result.canceled || !path) return null;
        const grantId = randomUUID();
        const expiresAt = Date.now() + 10 * 60_000;
        fileCapabilities.set(grantId, {
          path,
          kind: "directory",
          webContentsId: 0,
          permissions: ["read"],
          expiresAt,
        });
        return {
          grantId,
          kind: "directory" as const,
          displayName: path.split(/[\\/]/).pop() ?? "选中目录",
          expiresAt: new Date(expiresAt).toISOString(),
          generation: hostGeneration,
        };
      },
      async readGrantedText(grantId, maximumBytes) {
        const grant = fileCapabilities.get(grantId);
        if (
          !grant ||
          grant.expiresAt <= Date.now() ||
          !grant.permissions.includes("read")
        )
          throw new Error("文件授权无效或已过期");
        const content = await readFile(grant.path);
        if (content.byteLength > maximumBytes)
          throw new Error("文件超过允许的大小");
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        } catch {
          throw new Error("文件不是有效的 UTF-8 文本");
        }
        return {
          name: grant.path.split(/[\\/]/).pop() ?? "导入文件",
          content: text,
          size: content.byteLength,
        };
      },
      async readGrantedDocument(grantId, maximumBytes) {
        const grant = fileCapabilities.get(grantId);
        if (
          !grant ||
          grant.kind !== "file" ||
          grant.expiresAt <= Date.now() ||
          !grant.permissions.includes("read")
        )
          throw new Error("文件授权无效或已过期");
        const source = await readFile(grant.path);
        return extractGrantedDocument(
          grant.path.split(/[\\/]/).pop() ?? "导入文件",
          source,
          { maximumBytes },
        );
      },
      async importPortraitMedia(grantId) {
        const grant = fileCapabilities.get(grantId);
        if (
          !grant ||
          grant.kind !== "file" ||
          grant.expiresAt <= Date.now() ||
          !grant.permissions.includes("read")
        )
          throw new Error("照片文件授权无效或已过期");
        const source = await readFile(grant.path);
        if (source.byteLength > 20 * 1024 * 1024)
          throw new Error("照片超过 20MB 安全上限");
        const image = nativeImage.createFromBuffer(source);
        if (image.isEmpty()) throw new Error("照片格式无效或无法解码");
        const { width, height } = image.getSize();
        if (width < 16 || height < 16 || width > 8192 || height > 8192)
          throw new Error("照片尺寸不在允许范围内");
        // Re-encoding is intentional: EXIF and the original byte stream never
        // enter Runtime, Renderer, diagnostics or the project database.
        const cleaned = image.toPNG();
        const mediaRef = randomUUID();
        const root = join(app.getPath("userData"), "media-library");
        await mkdir(root, { recursive: true, mode: 0o700 });
        const target = join(root, `${mediaRef}.png`);
        await writeFile(target, cleaned, { mode: 0o600, flag: "wx" });
        managedPortraitMedia.set(mediaRef, target);
        return {
          mediaRef,
          sha256: createHash("sha256").update(cleaned).digest("hex"),
          mimeType: "image/png" as const,
          width,
          height,
          size: cleaned.byteLength,
        };
      },
      async removeManagedMedia(mediaRef) {
        const target = managedPortraitMedia.get(mediaRef);
        if (!target) return;
        managedPortraitMedia.delete(mediaRef);
        try {
          await unlink(target);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        }
      },
      async saveTextFile(input) {
        const suggestedName = input.suggestedName
          .replace(/[\\/]/g, "-")
          .slice(0, 180);
        const result = await dialog.showSaveDialog({
          title: "导出项目文件",
          defaultPath: suggestedName || "DramaIP导出文件.txt",
        });
        if (result.canceled || !result.filePath) return { saved: false };
        await writeFile(result.filePath, input.content, "utf8");
        const artifactRef = randomUUID();
        artifactCapabilities.set(artifactRef, result.filePath);
        return { saved: true, artifactRef };
      },
      openExternal: (url) => shell.openExternal(url),
      async revealGrant(grantId) {
        const grant = fileCapabilities.get(grantId);
        if (!grant || grant.expiresAt <= Date.now())
          throw new Error("文件授权无效或已过期");
        shell.showItemInFolder(grant.path);
      },
      async revealArtifact(artifactRef) {
        const path = artifactCapabilities.get(artifactRef);
        if (!path) throw new Error("导出产物引用无效");
        shell.showItemInFolder(path);
      },
      removeCredential,
      credentialStorageStatus: () => credentialVault.status(),
      createCredentialCaptureSession: (input) => {
        if (!credentialCaptureManager)
          throw new Error("Credential capture is unavailable");
        return credentialCaptureManager.create(
          input,
          BrowserWindow.getFocusedWindow() ?? undefined,
        );
      },
      credentialCaptureStatus: async (captureSessionId) =>
        credentialCaptureManager?.status(captureSessionId),
      activateAgentProvider,
      providerRequest: executeProviderHttpRequest,
      publicSearch,
      webSearch,
      readWebPage,
      codexAuthenticationStatus: readCodexAuthenticationStatus,
      loginCodex,
      logoutCodex,
      async setWindowTheme(theme) {
        if (process.platform === "darwin") return;
        const window = BrowserWindow.getFocusedWindow();
        if (!window || window.isDestroyed()) return;
        window.setTitleBarOverlay({
          color: theme === "dark" ? "#191a19" : "#f8f7f4",
          symbolColor: theme === "dark" ? "#f1eee9" : "#242320",
          height: 64,
        });
      },
      async focusWindow() {
        BrowserWindow.getFocusedWindow()?.focus();
      },
      async notify(input) {
        new Notification(input).show();
      },
      async fetchExtensionRegistry(input) {
        const response = await safeHttpRequest({
          url: input.url,
          method: "GET",
          accept: "json",
          maximumBytes: 10 * 1024 * 1024,
          timeoutMs: 30_000,
          authorization: "",
        });
        if (response.status < 200 || response.status >= 300)
          throw new Error(`Extension Registry returned ${response.status}`);
        return verifyExtensionRegistry(
          JSON.parse(response.bytes.toString("utf8")),
          { keyId: input.keyId, publicKeyPem: input.rootPublicKey },
        );
      },
      async stageExtensionPackage(input) {
        const response = await safeHttpRequest({
          url: input.packageUrl,
          method: "GET",
          accept: "binary",
          maximumBytes: 50 * 1024 * 1024,
          timeoutMs: 90_000,
          authorization: "",
        });
        if (response.status < 200 || response.status >= 300)
          throw new Error(`Extension package returned ${response.status}`);
        if (sha256(response.bytes) !== input.expectedSha256)
          throw new Error("Extension package download integrity mismatch");
        return extensionSupervisor.stage(
          response.bytes,
          input.publisherPublicKey,
        );
      },
      activateExtension: (input) => extensionSupervisor.activate(input),
      invokeExtension: (input) => extensionSupervisor.invoke(input),
      stopExtension: (pluginId) => extensionSupervisor.stop(pluginId),
      retryExtension: async (pluginId) =>
        extensionSupervisor.resetQuarantine(pluginId),
      extensionDiagnostics: async () => extensionSupervisor.diagnostics(),
      async extensionNetworkRequest(input) {
        const response = await safeHttpRequest({
          url: input.url,
          method: input.method,
          ...(input.body ? { body: input.body } : {}),
          accept: "json",
          maximumBytes: 1024 * 1024,
          timeoutMs: 30_000,
          authorization: "",
        });
        let json: unknown;
        try {
          json = JSON.parse(response.bytes.toString("utf8"));
        } catch {
          json = null;
        }
        return {
          status: response.status,
          contentType: response.contentType,
          json,
        };
      },
      async engineHealth(engine) {
        const managed = managedEngine(engine);
        const snapshot = componentStates
          .get(`${engine}-engine`)
          ?.snapshot(engineHostRequests.size + engineHostStreams.size);
        if (engine === "codex") {
          const authentication = await readCodexAuthenticationStatus();
          return {
            available: Boolean(managed),
            healthy: managed?.healthy ?? false,
            configured: authentication.available,
            version: managed?.version,
            authenticated: authentication.authenticated,
            generation: snapshot?.generation ?? 0,
            supervisor: snapshot,
            restartBudget: restartBudgets.get("codex-engine")?.snapshot(),
          };
        }
        return {
          available: Boolean(managed),
          healthy: managed?.healthy ?? false,
          configured: managed?.configured ?? false,
          version: managed?.version,
          authenticated: managed?.authenticated,
          generation: snapshot?.generation ?? 0,
          supervisor: snapshot,
          restartBudget: restartBudgets.get(`${engine}-engine`)?.snapshot(),
        };
      },
      engineOperation: runHostEngineOperation,
      engineStream: runHostEngineStream,
    },
  });
}

function runtimeProfilePath(
  name: "studio" | "server" | "safe" | "test" | "e2e",
): string {
  if (app.isPackaged)
    return join(process.resourcesPath, "profiles", `${name}.json`);
  const candidates = [
    join(__dirname, "..", "..", "..", "..", "profiles", `${name}.json`),
    join(__dirname, "..", "..", "..", "profiles", `${name}.json`),
    join(process.cwd(), "profiles", `${name}.json`),
  ];
  const profile = candidates.find((candidate) => existsSync(candidate));
  if (!profile) throw new Error(`Runtime profile is missing: ${name}`);
  return profile;
}

async function initialize(): Promise<Ready> {
  const hostname = "127.0.0.1";
  const runtimeGeneration = 1;
  const mcpTokens = {
    codex: randomUUID(),
    pi: randomUUID(),
    grok: randomUUID(),
    langgraph: randomUUID(),
  } as const;
  const hostToken = randomUUID();
  const host = createHost(hostToken);
  hostServer = await host.start({ hostname, port: 0 });
  const runtimeToken = randomBytes(32).toString("base64url");
  coreRuntime = (await spawnSidecar(
    "core-runtime",
    {
      type: "start",
      hostname,
      port: 0,
      runtimeGeneration,
      accessToken: runtimeToken,
      databasePath: join(app.getPath("userData"), "dramaip.db"),
      profilePath: runtimeProfilePath("studio"),
      migrationWorkerEntry: sidecarPath("migration-worker"),
      allowedOrigins: [
        RENDERER_ORIGIN,
        ...(process.env.ELECTRON_RENDERER_URL
          ? [process.env.ELECTRON_RENDERER_URL]
          : []),
      ],
      engineMcpTokens: Object.values(mcpTokens),
      host: {
        baseUrl: `http://${hostname}:${hostServer.port}`,
        accessToken: hostToken,
      },
      alpha3AgentCutover: {
        backupDirectory: join(app.getPath("userData"), "backups"),
        alpha2Version: "3.0.0-alpha.2",
      },
    },
    true,
  )) as ManagedProcess;
  if (!coreRuntime.runtimeReady)
    throw new Error("Core Runtime ready metadata is missing");
  const ready: Ready = {
    baseUrl: `http://${hostname}:${coreRuntime.runtimeReady.port}`,
    accessToken: runtimeToken,
    appVersion: app.getVersion(),
    apiVersion: "2",
    runtimeId: coreRuntime.runtimeReady.runtimeId,
    runtimeGeneration: coreRuntime.runtimeReady.runtimeGeneration,
  };
  await runtimeHealthCheck(ready);
  const mcpUrl = `${ready.baseUrl}/engine/v1/mcp`;
  await bootstrapCodexAuth();
  // Engine transports are independent supervisors. Starting them concurrently
  // avoids making every Desktop attach pay four sequential vendor handshakes.
  // Availability remains explicit per engine; no adapter is used as fallback.
  const [codex, pi, grok, langgraph] = await Promise.all([
    spawnSidecar(
      "codex-engine",
      {
        type: "start",
        binaryPath: codexBinaryPath(),
        modelCatalogPath: codexModelCatalogPath(),
        codexHome: dramaipCodexHome(),
        sessionRoot: join(app.getPath("userData"), "codex-sessions"),
        mcp: { url: mcpUrl, token: mcpTokens.codex },
      },
      false,
    ),
    spawnSidecar(
      "pi-engine",
      {
        type: "start",
        runtimeModule: piRuntimeModule(),
        sessionRoot: join(app.getPath("userData"), "agent-sessions", "pi"),
        mcp: { url: mcpUrl, token: mcpTokens.pi },
      },
      false,
    ),
    process.platform === "darwin" && process.arch === "arm64"
      ? spawnSidecar(
          "grok-engine",
          {
            type: "start",
            binaryPath: grokBinaryPath(),
            sessionRoot: join(
              app.getPath("userData"),
              "agent-sessions",
              "grok",
            ),
            mcp: { url: mcpUrl, token: mcpTokens.grok },
          },
          false,
        )
      : Promise.resolve(undefined),
    spawnSidecar(
      "langgraph-engine",
      {
        type: "start",
        sessionRoot: join(
          app.getPath("userData"),
          "agent-sessions",
          "langgraph",
        ),
        mcp: { url: mcpUrl, token: mcpTokens.langgraph },
      },
      false,
    ),
  ]);
  codexEngine = codex;
  piEngine = pi;
  grokEngine = grok;
  langgraphEngine = langgraph;
  return ready;
}

async function runtimeHealthCheck(ready: Ready): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await fetch(`${ready.baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (result.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("DramaIP Runtime health check failed");
}

function createWindow(ready: Ready): BrowserWindow {
  return createMainWindow({
    bootstrap: ready,
    preloadPath: join(__dirname, "../preload/index.js"),
    ...(!app.isPackaged ? { developmentIconPath } : {}),
    ...(process.env.ELECTRON_RENDERER_URL
      ? { developmentUrl: process.env.ELECTRON_RENDERER_URL }
      : {}),
  });
}

app
  .whenReady()
  .then(async () => {
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(developmentIconPath);
    }
    registerRendererProtocol(join(__dirname, "../renderer"));
    registerRuntimeBootstrapExchange();
    credentialCaptureManager = new CredentialCaptureManager(
      credentialVault,
      join(__dirname, "../preload/credential-capture.js"),
    );
    credentialCaptureManager.register();
    initialization = initialize();
    try {
      runtimeReady = await initialization;
      createWindow(runtimeReady);
    } catch (error) {
      console.error("DramaIP Runtime startup failed", error);
      dialog.showErrorBox(
        "DramaIP Server 启动失败",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    }
    app.on("activate", () => {
      if (!hasMainWindow() && runtimeReady) createWindow(runtimeReady);
    });
  })
  .catch((error) => {
    dialog.showErrorBox(
      "DramaIP 启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });

let shutdownComplete = false;
let shutdownTask: Promise<void> | undefined;

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  shuttingDown = true;
  shutdownTask ??= (async () => {
    await shutdownApplication({
      closeWindows: destroyMainWindows,
      disposeCredentialCapture: () => credentialCaptureManager?.dispose(),
      engines: [
        { stop: () => extensionSupervisor.stopAll() },
        codexEngine,
        piEngine,
        grokEngine,
        langgraphEngine,
      ],
      runtime: coreRuntime,
      host: hostServer,
      disposeSupervision: () => {
        for (const budget of restartBudgets.values()) budget.dispose();
      },
    });
    shutdownComplete = true;
    app.quit();
  })();
});
