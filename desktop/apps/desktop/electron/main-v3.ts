import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  nativeTheme,
  protocol,
  shell,
  utilityProcess,
} from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenCodeProviderAdapter } from "@sdns/ai";
import { LocalCredentialVault } from "./local-credential-vault";

const require = createRequire(import.meta.url);
const developmentIconPath = join(__dirname, "../../build/icon.png");
const isolatedTestUserData = process.env.DRAMAIP_E2E_USER_DATA;
if (isolatedTestUserData) app.setPath("userData", isolatedTestUserData);

type Ready = {
  url: string;
  username: string;
  password: string;
  version: string;
};
type ChildMessage =
  | { type: "ready"; version?: string; configured?: boolean }
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
  | { type: "stopped" };
type OpenCodeProviderConfiguration = {
  providerId: string;
  runtimeProviderId: string;
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: OpenCodeProviderAdapter;
  model: string;
  baseUrl?: string;
  credentialRef: string;
  environmentName:
    "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
};
type OpenCodeRuntimeProvider = Omit<
  OpenCodeProviderConfiguration,
  "credentialRef"
> & { secret: string };
type ManagedProcess = {
  child: Electron.UtilityProcess;
  name: string;
  command: Record<string, unknown>;
  required: boolean;
  healthy: boolean;
  version?: string;
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
let dramaServer: ManagedProcess | undefined;
let opencodeEngine: ManagedProcess | undefined;
let codexEngine: ManagedProcess | undefined;
let dshEngine: ManagedProcess | undefined;
let langgraphEngine: ManagedProcess | undefined;
let initialization: Promise<Ready> | undefined;
const credentialVault = new LocalCredentialVault(
  join(app.getPath("userData"), "credentials"),
);
const fileCapabilities = new Map<string, FileCapability>();
const restartAttempts = new Map<string, number>();
const intentionallyStoppedSidecars = new WeakSet<Electron.UtilityProcess>();
const dshConfigurationRequests = new Map<
  string,
  {
    resolve(value: { available: boolean; message?: string }): void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
let shuttingDown = false;

function sidecarPath(name: string): string {
  return join(__dirname, `${name}.js`);
}
function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}
function opencodeServerModule(): string {
  const modulePath =
    process.env.DRAMAIP_OPENCODE_SERVER_MODULE ??
    (!app.isPackaged
      ? join(
          app.getAppPath(),
          "../../vendor/opencode/packages/opencode/dist/node/node.js",
        )
      : join(process.resourcesPath, "opencode/node.js"));
  return pathToFileURL(modulePath).href;
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
    app.getAppPath(),
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

function dshRuntimeEntry(): string {
  if (process.env.DRAMAIP_DSH_RUNTIME_ENTRY)
    return process.env.DRAMAIP_DSH_RUNTIME_ENTRY;
  const runtimeRoot = app.isPackaged
    ? join(process.resourcesPath, "dsh", "runtime")
    : join(app.getAppPath(), "build", "dsh");
  return join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh-sdk-jsonrpc-demo",
    "lib",
    "packaged-bin.js",
  );
}

function dshConfigDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "dsh", "config")
    : join(app.getAppPath(), "dsh-config");
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
      if (!settled) fail(new Error(`${name} exited before ready (${code})`));
    });
    child.on("message", (message: ChildMessage) => {
      if (
        name === "dramaip-server" &&
        (message as unknown as { type?: string }).type === "opencode:configure"
      ) {
        const request = message as unknown as {
          requestId: string;
          configuration: OpenCodeProviderConfiguration;
        };
        void configureOpenCodeEngine(request.configuration).then((result) => {
          child.postMessage({
            type: "opencode:configured",
            requestId: request.requestId,
            ...result,
          });
        });
        return;
      }
      if (
        name === "dramaip-server" &&
        (message as unknown as { type?: string }).type ===
          "agent-engine:request"
      ) {
        const request = message as unknown as {
          requestId: string;
          engineKind: "codex" | "dsh" | "langgraph";
          operation: string;
          payload: Record<string, unknown>;
        };
        const target = {
          codex: codexEngine,
          dsh: dshEngine,
          langgraph: langgraphEngine,
        }[request.engineKind];
        if (!target) {
          const engineName = {
            codex: "Codex",
            dsh: "DeepSeek Harness",
            langgraph: "LangGraph.js",
          }[request.engineKind];
          child.postMessage({
            type: "agent-engine:response",
            requestId: request.requestId,
            error: `${engineName} 引擎未启动`,
          });
          return;
        }
        void (async () => {
          const payload = { ...request.payload };
          if (
            request.engineKind === "codex" &&
            request.operation === "login" &&
            payload.mode === "api_key" &&
            typeof payload.credentialRef === "string"
          ) {
            const apiKey = await resolveCredential(payload.credentialRef);
            delete payload.credentialRef;
            if (apiKey) payload.apiKey = apiKey;
          }
          target.child.postMessage({
            type: "request",
            requestId: request.requestId,
            operation: request.operation,
            payload,
          });
        })();
        return;
      }
      if (
        name === "dramaip-server" &&
        (message as unknown as { type?: string }).type === "capability:resolve"
      ) {
        const request = message as unknown as {
          requestId: string;
          token: string;
        };
        const capability = fileCapabilities.get(request.token);
        const valid = capability && capability.expiresAt > Date.now();
        if (!valid && capability) fileCapabilities.delete(request.token);
        if (valid) fileCapabilities.delete(request.token);
        child.postMessage({
          type: "capability:resolved",
          requestId: request.requestId,
          capability: valid
            ? { path: capability!.path, permissions: capability!.permissions }
            : undefined,
        });
        return;
      }
      if (
        name === "dramaip-server" &&
        (message as unknown as { type?: string }).type === "credential:resolve"
      ) {
        const request = message as unknown as {
          requestId: string;
          credentialRef: string;
        };
        void (async () => {
          const secret = await resolveCredential(request.credentialRef);
          child.postMessage({
            type: "credential:resolved",
            requestId: request.requestId,
            ...(secret ? { secret } : {}),
          });
        })();
        return;
      }
      if (message.type === "ready") {
        const managed: ManagedProcess = {
          child,
          name,
          command,
          required,
          healthy: message.configured ?? true,
          ...(message.version ? { version: message.version } : {}),
          stop: () => stopChild(child, name === "dsh-engine" ? 15_000 : 6_000),
        };
        child.once("exit", () => {
          if (!shuttingDown && !intentionallyStoppedSidecars.delete(child))
            void restartSidecar(managed);
        });
        return finish(managed);
      }
      if (name === "dsh-engine" && message.type === "configured") {
        const pending = dshConfigurationRequests.get(message.requestId);
        if (!pending) return;
        dshConfigurationRequests.delete(message.requestId);
        clearTimeout(pending.timeout);
        pending.resolve({
          available: message.available,
          ...(message.error ? { message: message.error } : {}),
        });
        return;
      }
      if (
        (["codex-engine", "dsh-engine", "langgraph-engine"] as const).includes(
          name as "codex-engine" | "dsh-engine" | "langgraph-engine",
        ) &&
        message.type === "response"
      ) {
        dramaServer?.child.postMessage({
          type: "agent-engine:response",
          requestId: message.requestId,
          ...(message.result !== undefined ? { result: message.result } : {}),
          ...(message.error ? { error: message.error } : {}),
        });
        return;
      }
      if (
        (["codex-engine", "dsh-engine", "langgraph-engine"] as const).includes(
          name as "codex-engine" | "dsh-engine" | "langgraph-engine",
        ) &&
        message.type === "event"
      ) {
        dramaServer?.child.postMessage({
          type: "agent-engine:event",
          engineKind:
            name === "codex-engine"
              ? "codex"
              : name === "dsh-engine"
                ? "dsh"
                : "langgraph",
          runId: message.runId,
          event: message.event,
        });
        return;
      }
      if (message.type === "diagnostic") {
        console.warn(`${name}: ${message.message}`);
        return;
      }
      if (message.type === "unavailable") {
        console.warn(`${name} is unavailable: ${message.reason}`);
        return required ? fail(new Error(message.reason)) : finish(undefined);
      }
      if (message.type === "error")
        return fail(new Error(message.error.message));
    });
    child.postMessage(command);
  });
}

async function configureDshEngine(
  provider: Pick<
    OpenCodeRuntimeProvider,
    "providerKind" | "model" | "baseUrl" | "secret"
  >,
): Promise<{ available: boolean; message?: string }> {
  const engine = dshEngine;
  if (!engine)
    return { available: false, message: "DeepSeek Harness Runtime 未启动" };
  const requestId = randomUUID();
  const result = new Promise<{ available: boolean; message?: string }>(
    (resolvePromise) => {
      const timeout = setTimeout(() => {
        dshConfigurationRequests.delete(requestId);
        resolvePromise({
          available: false,
          message: "DeepSeek Harness 配置响应超时",
        });
      }, 20_000);
      dshConfigurationRequests.set(requestId, {
        resolve: resolvePromise,
        timeout,
      });
    },
  );
  engine.command.provider = provider;
  engine.child.postMessage({
    type: "configure",
    requestId,
    provider,
  });
  return result;
}

async function configureOpenCodeEngine(
  configuration: OpenCodeProviderConfiguration,
): Promise<{ available: boolean; message?: string }> {
  const secret = await resolveCredential(configuration.credentialRef);
  if (!secret)
    return { available: false, message: "智能助手模型的安全凭据不可用" };
  const current = opencodeEngine;
  const runtimeProvider: OpenCodeRuntimeProvider = {
    providerId: configuration.providerId,
    runtimeProviderId: configuration.runtimeProviderId,
    providerKind: configuration.providerKind,
    providerAdapter: configuration.providerAdapter,
    model: configuration.model,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    environmentName: configuration.environmentName,
    secret,
  };
  let next: ManagedProcess | undefined;
  if (current) {
    intentionallyStoppedSidecars.add(current.child);
    await current.stop();
    next = await spawnSidecar(
      "opencode-engine",
      { ...current.command, agentProvider: runtimeProvider },
      false,
    );
    if (next && !(await openCodeModelIsRegistered(next, runtimeProvider))) {
      intentionallyStoppedSidecars.add(next.child);
      await next.stop();
      next = undefined;
    }
    opencodeEngine = next;
  }
  dramaServer?.child.postMessage({
    type: "opencode:status",
    healthy: Boolean(next),
  });
  const currentLangGraph = langgraphEngine;
  let nextLangGraph: ManagedProcess | undefined;
  if (currentLangGraph) {
    intentionallyStoppedSidecars.add(currentLangGraph.child);
    await currentLangGraph.stop();
    nextLangGraph = await spawnSidecar(
      "langgraph-engine",
      {
        ...currentLangGraph.command,
        provider: {
          providerKind: configuration.providerKind,
          providerAdapter: configuration.providerAdapter,
          model: configuration.model,
          ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
          secret,
        },
      },
      false,
    );
    langgraphEngine = nextLangGraph;
  }
  dramaServer?.child.postMessage({
    type: "agent-engine:status",
    engineKind: "langgraph",
    healthy: Boolean(nextLangGraph),
    version: "0.2.43",
  });
  const dshConfiguration = await configureDshEngine({
    providerKind: configuration.providerKind,
    model: configuration.model,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    secret,
  });
  if (dshEngine) dshEngine.healthy = dshConfiguration.available;
  dramaServer?.child.postMessage({
    type: "agent-engine:status",
    engineKind: "dsh",
    healthy: dshConfiguration.available,
    version: "0.1.0-rc.5",
  });
  return next
    ? { available: true }
    : {
        available: false,
        message: "OpenCode 未能识别当前服务商或模型，请检查模型配置",
      };
}

async function openCodeModelIsRegistered(
  engine: ManagedProcess,
  provider: OpenCodeRuntimeProvider,
): Promise<boolean> {
  const hostname = String(engine.command.hostname ?? "127.0.0.1");
  const port = Number(engine.command.port);
  const password = String(engine.command.password ?? "");
  if (!Number.isInteger(port) || !password) return false;
  try {
    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const response = await fetch(`http://${hostname}:${port}/provider`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    const catalog = JSON.stringify(await response.json());
    return (
      catalog.includes(`"${provider.runtimeProviderId}"`) &&
      catalog.includes(`"${provider.model}"`)
    );
  } catch {
    return false;
  }
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
    if (previous.name === "dramaip-server") dramaServer = next;
    if (previous.name === "opencode-engine") {
      opencodeEngine = next;
      dramaServer?.child.postMessage({
        type: "opencode:status",
        healthy: Boolean(next),
      });
    }
    if (previous.name === "codex-engine") {
      codexEngine = next;
      dramaServer?.child.postMessage({
        type: "agent-engine:status",
        engineKind: "codex",
        healthy: true,
        version: next.version ?? "0.147.0",
      });
    }
    if (previous.name === "dsh-engine") {
      dshEngine = next;
      dramaServer?.child.postMessage({
        type: "agent-engine:status",
        engineKind: "dsh",
        healthy: next.healthy,
        version: next.version ?? "0.1.0-rc.5",
      });
    }
    if (previous.name === "langgraph-engine") {
      langgraphEngine = next;
      dramaServer?.child.postMessage({
        type: "agent-engine:status",
        engineKind: "langgraph",
        healthy: next.healthy,
        version: next.version ?? "0.2.43",
      });
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

async function initialize(): Promise<Ready> {
  const hostname = "127.0.0.1";
  const port = randomPort();
  const mcpTokens = {
    opencode: randomUUID(),
    codex: randomUUID(),
    dsh: randomUUID(),
    langgraph: randomUUID(),
  } as const;
  const enginePort = randomPort();
  const enginePassword = randomUUID();
  const engineModule = opencodeServerModule();
  const mcpUrl = `http://${hostname}:${port}/internal/mcp`;
  const opencodeMcp = {
    url: mcpUrl,
    token: mcpTokens.opencode,
  };
  opencodeEngine = await spawnSidecar(
    "opencode-engine",
    {
      type: "start",
      hostname,
      port: enginePort,
      password: enginePassword,
      userDataPath: join(app.getPath("userData"), "opencode"),
      workspacePath: join(app.getPath("userData"), "opencode-sessions"),
      mcp: opencodeMcp,
      serverModule: engineModule,
    },
    false,
  );
  codexEngine = await spawnSidecar(
    "codex-engine",
    {
      type: "start",
      binaryPath: codexBinaryPath(),
      codexHome: join(app.getPath("userData"), "codex-engine"),
      sessionRoot: join(app.getPath("userData"), "codex-sessions"),
      mcp: { url: mcpUrl, token: mcpTokens.codex },
    },
    false,
  );
  dshEngine = await spawnSidecar(
    "dsh-engine",
    {
      type: "start",
      runtimeEntry: dshRuntimeEntry(),
      configDirectory: dshConfigDirectory(),
      sessionRoot: join(app.getPath("userData"), "dsh-sessions"),
      mcp: { url: mcpUrl, token: mcpTokens.dsh },
    },
    false,
  );
  langgraphEngine = await spawnSidecar(
    "langgraph-engine",
    {
      type: "start",
      mcp: { url: mcpUrl, token: mcpTokens.langgraph },
    },
    false,
  );
  const password = randomUUID();
  dramaServer = (await spawnSidecar(
    "dramaip-server",
    {
      type: "start",
      hostname,
      port,
      password,
      databasePath: join(app.getPath("userData"), "dramaip.db"),
      backupDirectory: join(app.getPath("userData"), "backups"),
      assetDirectory: join(app.getPath("userData"), "assets"),
      allowedOrigins: [
        `${rendererProtocol}://${rendererHost}`,
        ...(process.env.ELECTRON_RENDERER_URL
          ? [process.env.ELECTRON_RENDERER_URL]
          : []),
      ],
      mcpTokens,
      opencode: {
        url: `http://${hostname}:${enginePort}`,
        username: "opencode",
        password: enginePassword,
        workspacePath: join(app.getPath("userData"), "opencode-sessions"),
        // A live sidecar without an activated model is not a usable agent.
        healthy: false,
      },
      codex: {
        healthy: Boolean(codexEngine),
        version: codexEngine?.version ?? "0.147.0",
      },
      dsh: {
        healthy: false,
        version: dshEngine?.version ?? "0.1.0-rc.5",
      },
      langgraph: {
        healthy: false,
        version: langgraphEngine?.version ?? "0.2.43",
      },
    },
    true,
  )) as ManagedProcess;
  const ready: Ready = {
    url: `http://${hostname}:${port}`,
    username: "dramaip",
    password,
    version: app.getVersion(),
  };
  await healthCheck(ready);
  return ready;
}

async function healthCheck(ready: Ready): Promise<void> {
  const authorization = `Basic ${Buffer.from(`${ready.username}:${ready.password}`).toString("base64")}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await fetch(`${ready.url}/api/v1/health`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(500),
      });
      if (result.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("DramaIP Server health check failed");
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

function createWindow(): BrowserWindow {
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

function registerNativeIpc(): void {
  ipcMain.handle("desktop:awaitInitialization", async (): Promise<Ready> => {
    if (!initialization) throw new Error("Desktop is not initialized");
    return initialization;
  });
  ipcMain.handle(
    "desktop:pickFiles",
    async (
      event,
      options: { multiple?: boolean; extensions?: string[] } = {},
    ) => {
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
                ? [{ name: "Files", extensions: options.extensions }]
                : undefined,
            });
      return result.canceled
        ? null
        : result.filePaths.map((path) => {
            const token = randomUUID();
            fileCapabilities.set(token, {
              path,
              webContentsId: event.sender.id,
              permissions: ["read"],
              expiresAt: Date.now() + 10 * 60_000,
            });
            return {
              token,
              name: path.split(/[\\/]/).pop() ?? path,
              expiresAt: Date.now() + 10 * 60_000,
            };
          });
    },
  );
  ipcMain.handle("desktop:openExternal", async (_event, value: string) =>
    shell.openExternal(value),
  );
  ipcMain.handle(
    "desktop:saveTextFile",
    async (
      _event,
      input: { suggestedName: string; content: string },
    ): Promise<{ saved: boolean }> => {
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
  );
  ipcMain.handle("desktop:revealPath", async (_event, value: string) =>
    shell.showItemInFolder(value),
  );
  ipcMain.handle("desktop:storeCredential", async (_event, secret: string) =>
    storeCredential(secret),
  );
  ipcMain.handle(
    "desktop:removeCredential",
    async (_event, credentialRef: string) => removeCredential(credentialRef),
  );
  ipcMain.handle("desktop:getCredentialStorageStatus", () =>
    credentialVault.status(),
  );
  ipcMain.handle(
    "desktop:setWindowTheme",
    (event, theme: "light" | "dark"): void => {
      if (theme !== "light" && theme !== "dark")
        throw new Error("Unsupported window theme");
      if (process.platform === "darwin") return;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) return;
      window.setTitleBarOverlay({
        color: theme === "dark" ? "#191a19" : "#f8f7f4",
        symbolColor: theme === "dark" ? "#f1eee9" : "#242320",
        height: 64,
      });
    },
  );
  ipcMain.handle("desktop:retryInitialization", async () => {
    initialization = initialize();
    return initialization;
  });
}

app
  .whenReady()
  .then(async () => {
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(developmentIconPath);
    }
    registerRendererProtocol();
    registerNativeIpc();
    initialization = initialize();
    try {
      await initialization;
      createWindow();
    } catch (error) {
      dialog.showErrorBox(
        "DramaIP Server 启动失败",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    }
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
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
  shutdownTask ??= Promise.allSettled([
    dramaServer?.stop(),
    opencodeEngine?.stop(),
    codexEngine?.stop(),
    dshEngine?.stop(),
    langgraphEngine?.stop(),
  ]).then(() => {
    shutdownComplete = true;
    app.quit();
  });
});
