import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { app, utilityProcess } from "electron";

import type { EngineKind, EngineTokenMap } from "@dramaip/agents";

import { OpenCodeEngineAdapter } from "./opencode-engine-adapter.ts";
import { LegacyProcessEngineAdapter } from "./process-engine-adapter.ts";
import type { EngineSupervisor } from "./engine-supervisor.ts";
import { bootstrapCodexAuthentication } from "./codex-auth-bootstrap.ts";

const require = createRequire(import.meta.url);

function engineEntry(kind: EngineKind): string {
  return join(__dirname, `${kind}-engine.js`);
}

function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

function codexTriple(): string {
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
  if (process.env.DRAMAIP_NEXT_CODEX_BINARY)
    return process.env.DRAMAIP_NEXT_CODEX_BINARY;
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  if (app.isPackaged)
    return join(process.resourcesPath, "codex", codexTriple(), executable);
  const prepared = join(
    app.getAppPath(),
    "build",
    "codex",
    codexTriple(),
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
  const codexManifest = require.resolve("@openai/codex/package.json");
  const codexRequire = createRequire(codexManifest);
  const platformManifest = codexRequire.resolve(
    `${packageNames[codexTriple()]}/package.json`,
  );
  return join(
    resolve(platformManifest, ".."),
    "vendor",
    codexTriple(),
    "bin",
    executable,
  );
}

function opencodeServerModule(): string {
  if (process.env.DRAMAIP_NEXT_OPENCODE_SERVER_MODULE)
    return process.env.DRAMAIP_NEXT_OPENCODE_SERVER_MODULE;
  const entry = app.isPackaged
    ? join(process.resourcesPath, "opencode", "node.js")
    : existsSync(join(app.getAppPath(), "build", "opencode", "node.js"))
      ? join(app.getAppPath(), "build", "opencode", "node.js")
      : join(
          app.getAppPath(),
          "../../../desktop/vendor/opencode/packages/opencode/dist/node/node.js",
        );
  return pathToFileURL(entry).href;
}

function dshRuntimeEntry(): string {
  if (process.env.DRAMAIP_NEXT_DSH_RUNTIME_ENTRY)
    return process.env.DRAMAIP_NEXT_DSH_RUNTIME_ENTRY;
  const root = app.isPackaged
    ? join(process.resourcesPath, "dsh", "runtime")
    : join(app.getAppPath(), "build", "dsh");
  return join(
    root,
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

function piRuntimeModule(): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, "pi", "runtime")
    : join(app.getAppPath(), "build", "pi");
  return join(root, "runtime.mjs");
}

function spawn(kind: EngineKind) {
  return utilityProcess.fork(engineEntry(kind), [], {
    serviceName: `DramaIP ${kind} engine`,
    stdio: "pipe",
  });
}

export interface ProductionEngineOptions {
  supervisor: EngineSupervisor;
  userData: string;
  serverPort: number;
  resolveCredential(credentialRef: string): Promise<string | undefined>;
  removeCredential(credentialRef: string): Promise<void>;
  engineTokens: EngineTokenMap;
}

interface ProviderConfiguration {
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: "openai" | "openai-compatible" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  credentialRef: string;
  protocol?: "responses" | "chat_completions";
}

/** Starts five separately supervised, signed first-party engine processes. */
export async function startProductionEngines(
  options: ProductionEngineOptions,
): Promise<void> {
  const mcpUrl = `http://127.0.0.1:${options.serverPort}/api/v2/agents/mcp`;
  const tokens = options.engineTokens;
  const codexHome = join(options.userData, "codex-engine");
  await bootstrapCodexAuthentication({
    sourceHome: join(app.getPath("home"), ".codex"),
    destinationHome: codexHome,
  }).catch((error) => {
    console.warn(
      `Codex auth bootstrap skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const starts = [
    startOpenCode(options, mcpUrl, tokens.opencode),
    startLegacy(
      options,
      "codex",
      "0.147.0",
      {
        type: "start",
        binaryPath: codexBinaryPath(),
        codexHome,
        sessionRoot: join(options.userData, "codex-sessions"),
        mcp: { url: mcpUrl, token: tokens.codex },
      },
      true,
    ),
    startLegacy(options, "dsh", "0.1.0-rc.5", {
      type: "start",
      runtimeEntry: dshRuntimeEntry(),
      configDirectory: dshConfigDirectory(),
      sessionRoot: join(options.userData, "dsh-sessions"),
      mcp: { url: mcpUrl, token: tokens.dsh },
    }),
    startPi(options, mcpUrl, tokens.pi),
    startLegacy(options, "langgraph", "0.2.43", {
      type: "start",
      mcp: { url: mcpUrl, token: tokens.langgraph },
    }),
  ];
  const results = await Promise.allSettled(starts);
  results.forEach((result, index) => {
    if (result.status === "rejected")
      console.warn(`engine ${index} failed to initialize: ${result.reason}`);
  });
  options.supervisor.setConfigurator((kind, payload) =>
    configureEngine(options, kind, payload, mcpUrl, tokens),
  );
  options.supervisor.setCredentialRemover(options.removeCredential);
}

async function configureEngine(
  options: ProductionEngineOptions,
  kind: EngineKind,
  payload: unknown,
  mcpUrl: string,
  tokens: EngineTokenMap,
): Promise<{ available: true }> {
  const configuration = payload as ProviderConfiguration;
  const secret = await options.resolveCredential(configuration.credentialRef);
  if (!secret)
    throw new Error("engine credential reference cannot be resolved");
  const provider = {
    providerKind: configuration.providerKind,
    providerAdapter: configuration.providerAdapter,
    model: configuration.model,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    secret,
  };
  if (kind === "codex") {
    if (configuration.providerKind !== "openai")
      throw new Error("Codex only accepts an OpenAI credential");
    const customProvider = Boolean(configuration.baseUrl);
    await options.supervisor.adapter(kind).call("login", {
      mode: customProvider ? "custom_provider" : "api_key",
      apiKey: secret,
      ...(customProvider
        ? {
            providerId: "codex-configured-provider",
            providerName:
              configuration.providerAdapter === "openai-compatible"
                ? "OpenAI Compatible"
                : "OpenAI",
            baseUrl: configuration.baseUrl,
            model: configuration.model,
            protocol: configuration.protocol ?? "responses",
          }
        : {}),
    });
    return { available: true };
  }
  if (kind === "dsh" || kind === "pi") {
    await options.supervisor.adapter(kind).call("configure", provider);
    return { available: true };
  }
  if (kind === "langgraph") {
    await startLegacy(
      options,
      "langgraph",
      "0.2.43",
      {
        type: "start",
        provider,
        mcp: { url: mcpUrl, token: tokens.langgraph },
      },
      true,
    );
    return { available: true };
  }
  await startOpenCode(options, mcpUrl, tokens.opencode, {
    providerId: "dramaip-agent",
    runtimeProviderId: "dramaip-agent",
    ...provider,
    environmentName:
      configuration.providerKind === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : configuration.providerKind === "google"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : "OPENAI_API_KEY",
  });
  return { available: true };
}

async function startOpenCode(
  options: ProductionEngineOptions,
  mcpUrl: string,
  token: string,
  agentProvider?: Record<string, unknown>,
): Promise<void> {
  const child = spawn("opencode");
  const port = randomPort();
  const password = randomUUID();
  const adapter = new OpenCodeEngineAdapter({
    child,
    url: `http://127.0.0.1:${port}`,
    username: "opencode",
    password,
    workspaceRoot: join(options.userData, "opencode-sessions"),
    configured: Boolean(agentProvider),
  });
  child.postMessage({
    type: "start",
    hostname: "127.0.0.1",
    port,
    password,
    userDataPath: join(options.userData, "opencode"),
    workspacePath: join(options.userData, "opencode-sessions"),
    serverModule: opencodeServerModule(),
    mcp: { url: mcpUrl, token },
    ...(agentProvider ? { agentProvider } : {}),
  });
  await adapter.waitUntilStarted();
  options.supervisor.register("opencode", adapter);
}

async function startLegacy(
  options: ProductionEngineOptions,
  kind: Exclude<EngineKind, "opencode" | "pi">,
  version: string,
  startCommand: Record<string, unknown>,
  initiallyConfigured = false,
): Promise<void> {
  const adapter = new LegacyProcessEngineAdapter({
    kind,
    version,
    child: spawn(kind),
    startCommand,
    initiallyConfigured,
  });
  await adapter.waitUntilStarted();
  options.supervisor.register(kind, adapter);
}

async function startPi(
  options: ProductionEngineOptions,
  mcpUrl: string,
  token: string,
): Promise<void> {
  const adapter = new LegacyProcessEngineAdapter({
    kind: "pi",
    version: "0.84.2",
    child: spawn("pi"),
    startCommand: {
      type: "start",
      runtimeModule: piRuntimeModule(),
      sessionRoot: join(options.userData, "pi-sessions"),
      mcp: { url: mcpUrl, token },
    },
  });
  await adapter.waitUntilStarted();
  options.supervisor.register("pi", adapter);
}
