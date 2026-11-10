import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyHandlerDirectory, legacyHandlers } from "./legacy-handlers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) =>
          !["build", "dist", "node_modules", "out", ".turbo"].includes(
            entry.name,
          ),
      )
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
  );
  return nested.flat();
}

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspace = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
if (manifest.engines?.node !== "24.18.0")
  throw new Error("Desktop workspace must pin Node 24.18.0 exactly");
if (manifest.engines?.pnpm !== "11.28.5")
  throw new Error("Desktop workspace must pin pnpm 11.28.5 exactly");
if (manifest.packageManager !== "pnpm@11.28.5")
  throw new Error("Desktop workspace must declare pnpm 11.28.5 exactly");
if (manifest.engines?.bun || manifest.dependencies?.bun)
  throw new Error("Desktop workspace must not depend on Bun");
if (!/^\s*-\s+build\/dsh-framework\/\*\s*$/mu.test(workspace))
  throw new Error("DSH framework source workspace is required");
const declaredWorkspaces = [...workspace.matchAll(/^\s*-\s+(\S+)\s*$/gmu)].map(
  (match) => match[1],
);
for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
  if (typeof script === "string" && /\bbunx?\b/u.test(script))
    throw new Error(`Desktop package script ${name} must not invoke Bun`);
}
const forbiddenWorkspaces = new Set([
  "packages/ai-legacy",
  "packages/compat/api-v2",
  "packages/db",
  "packages/engine-runtime",
  "packages/http",
  "packages/kernel",
  "packages/mcp",
  "packages/protocol",
  "packages/runtime",
  "packages/schema",
  "packages/server",
  "packages/tasks",
]);
for (const workspace of manifest.workspaces ?? []) {
  if (forbiddenWorkspaces.has(workspace))
    throw new Error(`Legacy workspace remains active: ${workspace}`);
}
for (const directory of forbiddenWorkspaces) {
  try {
    await access(join(root, directory, "package.json"));
    throw new Error(`Legacy source package remains present: ${directory}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      continue;
    throw error;
  }
}

const activeSourceRoots = [
  join(root, "apps", "desktop"),
  join(root, "packages", "agent-runtime"),
  join(root, "packages", "ai"),
  join(root, "packages", "bundles"),
  join(root, "packages", "contracts"),
  join(root, "packages", "database"),
  join(root, "packages", "host", "contracts"),
  join(root, "packages", "events"),
  join(root, "packages", "plugin-api"),
  join(root, "packages", "runtime-adapters"),
  join(root, "packages", "workspace", "studio-client"),
  ...legacyHandlers(root).map(({ directory }) => join(root, directory)),
  join(root, "profiles"),
];
for (const directory of activeSourceRoots) {
  for (const path of await files(directory)) {
    if (!/\.(?:[cm]?[jt]sx?|json|ya?ml)$/u.test(path)) continue;
    const source = await readFile(path, "utf8");
    if (path.endsWith("package.json")) {
      const packageManifest = JSON.parse(source);
      for (const [name, script] of Object.entries(
        packageManifest.scripts ?? {},
      )) {
        if (typeof script === "string" && /\bbunx?\b/u.test(script))
          throw new Error(
            `Package script ${name} must not invoke Bun: ${path.replace(root, "")}`,
          );
      }
    }
    await assertAbsent(
      path,
      /@sdns\//u,
      "Active source must not reference a legacy @sdns package",
    );
    await assertAbsent(
      path,
      /(?:^|[^A-Za-z0-9])\/api\/v1(?:\/|["'])/u,
      "Active source must not expose the legacy HTTP API",
    );
  }
}

async function assertAbsent(path, expression, message) {
  const source = await readFile(path, "utf8");
  if (expression.test(source))
    throw new Error(`${message}: ${path.replace(root, "")}`);
}

const studio = join(root, "packages", "workspace", "studio-client", "src");
const rendererFiles = (await files(join(studio, "app"))).filter((path) =>
  /\.[cm]?[jt]sx?$/u.test(path),
);
for (const path of rendererFiles) {
  await assertAbsent(
    path,
    /\bfetch\s*\(/u,
    "Renderer must use the request facade rather than fetch",
  );
  await assertAbsent(
    path,
    /\bipcRenderer\b|window\.desktop\b/u,
    "Renderer must not use Electron IPC",
  );
  await assertAbsent(
    path,
    /@sdns\/client/u,
    "Renderer must not import the legacy client",
  );
  await assertAbsent(
    path,
    /@dramaip\/(?:host-contracts|http|kernel|plugin-api|runtime)(?:[/'"]|$)/u,
    "Renderer must not import Host, Runtime, Kernel or Plugin implementations",
  );
  if (!path.includes(`${join("runtime-connection")}`))
    await assertAbsent(
      path,
      /["'](?:\.\.\/)+connection(?:\/index)?["']/u,
      "Only the Renderer runtime-connection boundary may import ServerConnectionManager",
    );
  await assertAbsent(
    path,
    /\bDomainWorkspace\b/u,
    "Generic DomainWorkspace cannot be used as migration evidence",
  );
}
// The shell preload carries the boot handshake and the recovery choice only.
const preloadPath = join(
  root,
  "apps",
  "desktop",
  "electron",
  "shell",
  "preload.ts",
);
const preloadSource = await readFile(preloadPath, "utf8");
const allowedPreloadCalls = new Set([
  "invoke:BOOT_CHANNEL",
  "send:BOOT_FATAL_CHANNEL",
  "invoke:RECOVERY_CHANNEL",
]);
const preloadCalls = [
  ...preloadSource.matchAll(/ipcRenderer\s*\.\s*(\w+)\(\s*(\w+)/gu),
].map(([, method, channel]) => `${method}:${channel}`);
if (
  preloadCalls.length !== allowedPreloadCalls.size ||
  preloadCalls.some((call) => !allowedPreloadCalls.has(call))
)
  throw new Error(
    "Preload may use only the boot handshake and the recovery choice channels",
  );

const pluginFiles = (
  await Promise.all(
    legacyHandlers(root).map(({ directory }) => files(join(root, directory))),
  )
)
  .flat()
  .filter((path) => /\.[cm]?[jt]sx?$/u.test(path));
// Table, SQL, import and event ownership live in check-ownership.mjs.
for (const path of pluginFiles) {
  await assertAbsent(
    path,
    /effect\/unstable\/httpapi/u,
    "Plugins must not use Effect HttpApi",
  );
  await assertAbsent(
    path,
    /\bBun\./u,
    "Plugins must not use Bun-specific runtime APIs",
  );
  await assertAbsent(
    path,
    /from\s+["']@dramaip\/plugin-api["']/u,
    "First-party implementations must import the explicit internal Plugin API",
  );
}
// Main is the shell only: it starts one Desktop Host and owns no business.
for (const path of await files(
  join(root, "apps", "desktop", "electron", "shell"),
)) {
  if (!/\.ts$/u.test(path)) continue;
  await assertAbsent(
    path,
    /\bbootRuntime\s*\(|@dramaip\/runtime\b/u,
    "Electron Main must start the Desktop Host rather than boot a Runtime",
  );
  await assertAbsent(
    path,
    /\/api\/v2\//u,
    "Electron Main must not call Host business APIs",
  );
}
for (const path of await files(join(root, "packages", "agent-runtime"))) {
  if (!/\.[cm]?[jt]sx?$|package\.json$/u.test(path)) continue;
  await assertAbsent(
    path,
    /(?:from\s+|require\s*\(\s*)["'](?:electron|better-sqlite3|node:sqlite|hono|@hono\/|@deepseek-ai\/cordis|@openai\/codex|@mariozechner\/pi-ai)/u,
    "@dramaip/agent-runtime must remain vendor and framework neutral",
  );
}
for (const path of await files(join(root, "packages", "contracts", "src"))) {
  if (!/\.[cm]?[jt]sx?$/u.test(path)) continue;
  await assertAbsent(
    path,
    /\b(?:secret|password|apiKey|absolutePath|filePath|directoryPath|revealPath)\??\s*:/u,
    "Public Runtime/Renderer contracts must not expose plaintext credentials or absolute paths",
  );
}
const activeAgentEngineFiles = [
  join(root, "apps", "desktop", "electron", "shell", "application.ts"),
  join(root, "apps", "desktop", "electron.vite.config.ts"),
  join(root, "apps", "desktop", "electron-builder.yml"),
  join(root, "packages", "contracts", "src", "index.ts"),
  join(legacyHandlerDirectory(root, "agents"), "index.ts"),
];

const electronEntry = await readFile(
  join(root, "apps", "desktop", "electron", "main.ts"),
  "utf8",
);
if (
  !/import\s+["']\.\/shell\/application\.js["']/u.test(electronEntry) ||
  /\b(?:BrowserWindow|utilityProcess|createDesktopHost|bootRuntime|fetch)\b/u.test(
    electronEntry,
  )
)
  throw new Error("Electron entrypoint must remain pure application assembly");
try {
  await access(join(root, "apps", "desktop", "electron", "main-v3.ts"));
  throw new Error("Legacy main-v3.ts must not be recreated");
} catch (error) {
  if (!(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ))
    throw error;
}
for (const name of ["index.ts", "plugin.ts"]) {
  const agentsEntry = await readFile(
    join(legacyHandlerDirectory(root, "agents"), name),
    "utf8",
  );
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/iu.test(agentsEntry))
    throw new Error(
      `Agents composition entrypoint must not contain SQL: ${name}`,
    );
  if (name === "plugin.ts" && agentsEntry.split("\n").length > 150)
    throw new Error(
      "Agents composition entrypoint must remain composition-only",
    );
}
for (const path of activeAgentEngineFiles) {
  await assertAbsent(
    path,
    /["'](?:codex|opencode|dsh|grok)["']/u,
    "Only Pi may be the active Agent Engine",
  );
}
await assertAbsent(
  join(root, "pnpm-workspace.yaml"),
  /packages\/(?:db|engine-runtime|mcp|protocol|schema|server|tasks)"/u,
  "Deleted Agent Runtime and legacy Server must not remain workspace packages",
);

const routes = JSON.parse(
  await readFile(join(root, "architecture", "route-owners.json"), "utf8"),
);
const operationIds = new Set();
const methodPaths = new Set();
for (const { method, path, operationId } of routes) {
  if (path.includes("{domain}") || path.includes(":domain"))
    throw new Error(`Generic central resource route remains: ${path}`);
  if (!operationId)
    throw new Error(
      `Route has no operationId: ${method.toUpperCase()} ${path}`,
    );
  if (operationIds.has(operationId))
    throw new Error(`Duplicate route operationId: ${operationId}`);
  operationIds.add(operationId);
  const key = `${method.toUpperCase()} ${path}`;
  if (methodPaths.has(key)) throw new Error(`Duplicate route: ${key}`);
  methodPaths.add(key);
}
for (const path of await files(join(root, "profiles"))) {
  if (!path.endsWith(".json")) continue;
  await assertAbsent(
    path,
    /"plugins"\s*:/u,
    "Profiles must compose Bundles rather than copying plugins",
  );
}
try {
  await access(join(root, "plugins", "legacy-bridge", "package.json"));
  throw new Error("legacy-bridge must be removed from alpha.3");
} catch (error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    // Expected: bridge is gone.
  } else if (
    error instanceof Error &&
    error.message.includes("legacy-bridge")
  ) {
    throw error;
  } else {
    throw error;
  }
}

process.stdout.write("Runtime architecture gates passed\n");
