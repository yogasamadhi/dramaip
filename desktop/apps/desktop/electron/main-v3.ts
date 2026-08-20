import {
  app,
  BrowserWindow,
  dialog,
  net,
  nativeTheme,
  Notification,
  protocol,
  shell,
  utilityProcess,
} from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDesktopHost,
  type AgentProviderActivationInput,
  type CodexAuthenticationLoginInput,
  type CodexAuthenticationLoginResult,
  type CodexAuthenticationStatus,
  type HostEngineStreamEvent,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
} from "@dramaip/desktop-host";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { bootstrapCodexAuthentication } from "./codex-auth-bootstrap";
import { LocalCredentialVault } from "./local-credential-vault";

const require = createRequire(import.meta.url);
const developmentIconPath = join(__dirname, "../../build/icon.png");
const isolatedTestUserData = process.env.DRAMAIP_E2E_USER_DATA;
if (isolatedTestUserData) app.setPath("userData", isolatedTestUserData);

type Ready = {
  baseUrl: string;
  accessToken: string;
  appVersion: string;
  apiVersion: "2";
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
      runtimeVersion: string;
      apiVersion: "2";
    }
  | { type: "runtime:error"; error: { message: string } }
  | { type: "stopped" };
type ManagedProcess = {
  child: Electron.UtilityProcess;
  name: string;
  command: Record<string, unknown>;
  required: boolean;
  /** The sidecar accepted its start command and is still alive. */
  healthy: boolean;
  /** The sidecar has accepted the currently selected model configuration. */
  configured: boolean;
  version?: string;
  authenticated?: boolean;
  stop(): Promise<void>;
};
type FileCapability = {
  path: string;
  webContentsId: number;
  permissions: readonly ["read"];
  expiresAt: number;
};

const rendererProtocol = "dramaip";
const rendererHost = "renderer";
protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let coreRuntime: ManagedProcess | undefined;
let codexEngine: ManagedProcess | undefined;
let piEngine: ManagedProcess | undefined;
let grokEngine: ManagedProcess | undefined;
let initialization: Promise<Ready> | undefined;
let hostServer: { close(): void } | undefined;
let runtimeReady: Ready | undefined;
const credentialVault = new LocalCredentialVault(
  join(app.getPath("userData"), "credentials"),
);
const fileCapabilities = new Map<string, FileCapability>();
const restartAttempts = new Map<string, number>();
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

/**
 * Utility processes report vendor deltas over Electron IPC.  Keep their
 * lifetime in Main and project them onto the authenticated Host HTTP SSE
 * response; Core Runtime never observes Electron IPC or vendor objects.
 */
class EngineEventChannel implements AsyncIterable<HostEngineStreamEvent> {
  private readonly queued: HostEngineStreamEvent[] = [];
  private pending:
    ((value: HostEngineStreamEvent | undefined) => void) | undefined;
  private closed = false;

  push(event: HostEngineStreamEvent): void {
    if (this.closed) return;
    const pending = this.pending;
    if (pending) {
      this.pending = undefined;
      pending(event);
      return;
    }
    this.queued.push(event);
  }

  finish(finalEvent?: HostEngineStreamEvent): void {
    if (this.closed) return;
    if (finalEvent) this.push(finalEvent);
    this.closed = true;
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending(undefined);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<HostEngineStreamEvent> {
    while (true) {
      const event = await this.next();
      if (!event) return;
      yield event;
    }
  }

  private next(): Promise<HostEngineStreamEvent | undefined> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(undefined);
    return new Promise((resolvePromise) => {
      this.pending = resolvePromise;
    });
  }
}

function sidecarPath(name: string): string {
  return join(__dirname, `${name}.js`);
}
function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

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

async function storeCredential(
  secret: string,
): Promise<{ credentialRef: string }> {
  return credentialVault.store(secret);
}

async function removeCredential(credentialRef: string): Promise<void> {
  await credentialVault.remove(credentialRef);
}

async function resolveCredential(
  credentialRef: string,
): Promise<string | undefined> {
  return credentialVault.resolve(credentialRef);
}

function spawnSidecar(
  name: string,
  command: Record<string, unknown>,
  required: boolean,
): Promise<ManagedProcess | undefined> {
  return new Promise((resolvePromise, reject) => {
    const child = utilityProcess.fork(sidecarPath(name), [], {
      serviceName: `DramaIP ${name}`,
      stdio: "pipe",
    });
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
      if (!settled)
        fail(
          new Error(
            `${name} exited before ready (${code})${stderr ? `: ${stderr}` : ""}`,
          ),
        );
    });
    child.on("message", (message: ChildMessage) => {
      if (message.type === "ready") {
        const managed: ManagedProcess = {
          child,
          name,
          command,
          required,
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
            stopChild(
              child,
              ["pi-engine", "grok-engine"].includes(name) ? 15_000 : 6_000,
            ),
        };
        child.once("exit", () => {
          if (!shuttingDown && !intentionallyStoppedSidecars.delete(child))
            void restartSidecar(managed);
        });
        return finish(managed);
      }
      if (name === "core-runtime" && message.type === "runtime:ready") {
        const managed: ManagedProcess = {
          child,
          name,
          command,
          required,
          healthy: true,
          configured: true,
          version: message.runtimeVersion,
          stop: () => stopChild(child, 6_000),
        };
        child.once("exit", () => {
          if (!shuttingDown && !intentionallyStoppedSidecars.delete(child))
            void restartSidecar(managed);
        });
        return finish(managed);
      }
      if (name === "core-runtime" && message.type === "runtime:error")
        return fail(new Error(message.error.message));
      if (
        ["pi-engine", "grok-engine"].includes(name) &&
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
        ["codex-engine", "pi-engine", "grok-engine"].includes(name) &&
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
        ["codex-engine", "pi-engine", "grok-engine"].includes(name) &&
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
    child.postMessage(command);
  });
}

async function configureRuntimeEngine(
  engineKind: "pi" | "grok",
  engine: ManagedProcess | undefined,
  displayName: string,
  provider: {
    providerKind: "openai" | "anthropic" | "google";
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
  const secret = await resolveCredential(configuration.credentialRef);
  if (!secret)
    return { available: false, message: "智能助手模型的安全凭据不可用" };
  const provider = {
    providerKind: configuration.providerKind,
    model: configuration.model,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    secret,
  };
  const [pi, grok] = await Promise.all([
    configureRuntimeEngine("pi", piEngine, "Pi", provider),
    configureRuntimeEngine("grok", grokEngine, "Grok Build", provider),
  ]);
  if (piEngine) piEngine.configured = pi.available;
  if (grokEngine) grokEngine.configured = grok.available;
  return pi.available
    ? { available: true }
    : { available: false, message: pi.message ?? grok.message };
}

async function executeProviderHttpRequest(
  input: ProviderHttpRequest,
): Promise<ProviderHttpResponse> {
  const secret = await resolveCredential(input.credentialRef);
  if (!secret) throw new Error("服务商安全凭据不可用");
  const response = await fetch(input.url, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: input.accept === "binary" ? "*/*" : "application/json",
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      "User-Agent": "DramaIP-Desktop/3.0",
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    signal: AbortSignal.timeout(input.timeoutMs ?? 90_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const maximumBytes = input.maximumBytes ?? 16 * 1024 * 1024;
  if (bytes.byteLength > maximumBytes)
    throw new Error(`服务商响应超过 ${maximumBytes} 字节限制`);
  const contentType = response.headers.get("content-type") ?? "";
  if (input.accept === "binary")
    return {
      status: response.status,
      contentType,
      base64: bytes.toString("base64"),
    };
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    json = { message: bytes.toString("utf8").slice(0, 2_000) };
  }
  return { status: response.status, contentType, json };
}

async function restartSidecar(previous: ManagedProcess): Promise<void> {
  const attempt = restartAttempts.get(previous.name) ?? 0;
  if (attempt >= 3) {
    console.error(`${previous.name} exceeded restart limit`);
    return;
  }
  restartAttempts.set(previous.name, attempt + 1);
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 500 * 2 ** attempt),
  );
  try {
    const next = await spawnSidecar(
      previous.name,
      previous.command,
      previous.required,
    );
    if (!next) return;
    restartAttempts.set(previous.name, 0);
    if (previous.name === "core-runtime") coreRuntime = next;
    if (previous.name === "codex-engine") {
      codexEngine = next;
    }
    if (previous.name === "pi-engine") {
      piEngine = next;
    }
    if (previous.name === "grok-engine") {
      grokEngine = next;
    }
  } catch (error) {
    console.error(`Failed to restart ${previous.name}`, error);
    await restartSidecar(previous);
  }
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

function managedEngine(engine: import("@dramaip/contracts").AgentEngineKind) {
  return {
    codex: codexEngine,
    pi: piEngine,
    grok: grokEngine,
  }[engine];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  )
    return {
      type: "tool",
      status: value.status,
      tool: value.tool,
      ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
    };
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
    const secret = await resolveCredential(input.credentialRef);
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
      };
    }
    return {
      available: true,
      healthy: managed.healthy,
      configured: managed.configured,
      version: managed.version,
      authenticated: managed.authenticated,
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
      { id: "credentials", available: true },
      { id: "window", available: true },
      { id: "shell", available: true },
      { id: "engines", available: true },
      { id: "agent-provider", available: true },
      { id: "provider-http", available: true },
      { id: "codex-auth", available: true },
      { id: "notifications", available: true },
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
          const token = randomUUID();
          const expiresAt = Date.now() + 10 * 60_000;
          fileCapabilities.set(token, {
            path,
            webContentsId: 0,
            permissions: ["read"],
            expiresAt,
          });
          return { token, name: path.split(/[\\/]/).pop() ?? path, expiresAt };
        });
      },
      async pickDirectory() {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });
        const path = result.filePaths[0];
        if (result.canceled || !path) return null;
        const token = randomUUID();
        const expiresAt = Date.now() + 10 * 60_000;
        fileCapabilities.set(token, {
          path,
          webContentsId: 0,
          permissions: ["read"],
          expiresAt,
        });
        return { token, name: path.split(/[\\/]/).pop() ?? path, expiresAt };
      },
      async readGrantedText(token, maximumBytes) {
        const grant = fileCapabilities.get(token);
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
        return { saved: true };
      },
      openExternal: (url) => shell.openExternal(url),
      async revealPath(path) {
        shell.showItemInFolder(path);
      },
      storeCredential,
      removeCredential,
      credentialStorageStatus: () => credentialVault.status(),
      activateAgentProvider,
      providerRequest: executeProviderHttpRequest,
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
      async engineHealth(engine) {
        const managed = managedEngine(engine);
        if (engine === "codex") {
          const authentication = await readCodexAuthenticationStatus();
          return {
            available: Boolean(managed),
            healthy: managed?.healthy ?? false,
            configured: authentication.available,
            version: managed?.version,
            authenticated: authentication.authenticated,
          };
        }
        return {
          available: Boolean(managed),
          healthy: managed?.healthy ?? false,
          configured: managed?.configured ?? false,
          version: managed?.version,
          authenticated: managed?.authenticated,
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
  const hostPort = randomPort();
  const runtimePort = randomPort();
  const mcpTokens = {
    codex: randomUUID(),
    pi: randomUUID(),
    grok: randomUUID(),
  } as const;
  const hostToken = randomUUID();
  const host = createHost(hostToken);
  hostServer = host.start({ hostname, port: hostPort });
  const runtimeToken = randomBytes(32).toString("base64url");
  coreRuntime = (await spawnSidecar(
    "core-runtime",
    {
      type: "start",
      hostname,
      port: runtimePort,
      accessToken: runtimeToken,
      databasePath: join(app.getPath("userData"), "dramaip.db"),
      profilePath: runtimeProfilePath("studio"),
      allowedOrigins: [
        `${rendererProtocol}://${rendererHost}`,
        ...(process.env.ELECTRON_RENDERER_URL
          ? [process.env.ELECTRON_RENDERER_URL]
          : []),
      ],
      engineMcpTokens: Object.values(mcpTokens),
      host: {
        baseUrl: `http://${hostname}:${hostPort}`,
        accessToken: hostToken,
      },
      alpha3AgentCutover: {
        backupDirectory: join(app.getPath("userData"), "backups"),
        alpha2Version: "3.0.0-alpha.2",
      },
    },
    true,
  )) as ManagedProcess;
  const ready: Ready = {
    baseUrl: `http://${hostname}:${runtimePort}`,
    accessToken: runtimeToken,
    appVersion: app.getVersion(),
    apiVersion: "2",
  };
  await runtimeHealthCheck(ready);
  const mcpUrl = `${ready.baseUrl}/engine/v1/mcp`;
  await bootstrapCodexAuth();
  // Engine transports are independent supervisors. Starting them concurrently
  // avoids making every Desktop attach pay three sequential vendor handshakes.
  // Availability remains explicit per engine; no adapter is used as fallback.
  const [codex, pi, grok] = await Promise.all([
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
              app.getPath("temp"),
              `dramaip-grok-${randomUUID()}`,
            ),
            mcp: { url: mcpUrl, token: mcpTokens.grok },
          },
          false,
        )
      : Promise.resolve(undefined),
  ]);
  codexEngine = codex;
  piEngine = pi;
  grokEngine = grok;
  await restoreRuntimeAgentProvider(ready);
  await new ServerConnectionManager().attach({
    baseUrl: ready.baseUrl,
    accessToken: ready.accessToken,
    source: "spawned",
  });
  return ready;
}

async function restoreRuntimeAgentProvider(ready: Ready): Promise<void> {
  try {
    await fetch(`${ready.baseUrl}/api/v2/agent-engines/restore-configuration`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ready.accessToken}` },
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    // Engine availability remains explicit through the Runtime diagnostics; a
    // failed restore must not block the desktop window from opening.
  }
}

async function runtimeHealthCheck(ready: Ready): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await fetch(`${ready.baseUrl}/api/v2/health`, {
        headers: { Authorization: `Bearer ${ready.accessToken}` },
        signal: AbortSignal.timeout(500),
      });
      if (result.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("DramaIP Runtime health check failed");
}

function registerRendererProtocol(): void {
  if (protocol.isProtocolHandled(rendererProtocol)) return;
  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url);
    if (url.host !== rendererHost)
      return new Response("Not found", { status: 404 });
    const root = join(__dirname, "../renderer");
    const target = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (relative(root, target).startsWith("..") || !existsSync(target))
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow(ready: Ready): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: "DramaIP Studio",
    backgroundColor: dark ? "#191a19" : "#f8f7f4",
    ...(!app.isPackaged ? { icon: developmentIconPath } : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 25 },
        }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: dark ? "#191a19" : "#f8f7f4",
            symbolColor: dark ? "#f1eee9" : "#242320",
            height: 64,
          },
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      additionalArguments: [
        `--dramaip-runtime-bootstrap=${Buffer.from(JSON.stringify(ready)).toString("base64")}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (
      !url.startsWith(`${rendererProtocol}://`) &&
      !url.startsWith(
        process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5177",
      )
    ) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL(`${rendererProtocol}://${rendererHost}/index.html`);
  window.once("ready-to-show", () => window.show());
  return window;
}

app
  .whenReady()
  .then(async () => {
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(developmentIconPath);
    }
    registerRendererProtocol();
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
      if (!BrowserWindow.getAllWindows().length && runtimeReady)
        createWindow(runtimeReady);
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
  hostServer?.close();
  shutdownTask ??= Promise.allSettled([
    coreRuntime?.stop(),
    codexEngine?.stop(),
    piEngine?.stop(),
    grokEngine?.stop(),
  ]).then(() => {
    shutdownComplete = true;
    app.quit();
  });
});
