import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
if (manifest.engines?.node)
  throw new Error("Desktop workspace must not declare a system Node engine");
if (manifest.engines?.bun !== "1.4.0")
  throw new Error("Desktop workspace must pin Bun 1.4.0 exactly");
const runtimeManifest = JSON.parse(
  await readFile(join(root, "packages/runtime/package.json"), "utf8"),
);
if (runtimeManifest.engines?.node !== "24.18.0")
  throw new Error("Standalone Core Runtime must pin Node 24.18.0");
if (!(manifest.workspaces ?? []).includes("build/dsh-framework/*"))
  throw new Error("DSH framework source workspace is required");
for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
  if (
    typeof script === "string" &&
    /(?:^|&&\s*|\|\|\s*|;\s*)node(?:\s|$)/u.test(script)
  )
    throw new Error(`Desktop package script ${name} invokes system Node`);
  if (typeof script === "string" && /\bbunx\b/u.test(script))
    throw new Error(
      `Desktop package script ${name} must use bun --bun run instead of bunx`,
    );
}
const forbiddenWorkspaces = new Set([
  "packages/ai-legacy",
  "packages/db",
  "packages/engine-runtime",
  "packages/mcp",
  "packages/protocol",
  "packages/schema",
  "packages/server",
  "packages/tasks",
]);
for (const workspace of manifest.workspaces ?? []) {
  if (forbiddenWorkspaces.has(workspace))
    throw new Error(`Legacy workspace remains active: ${workspace}`);
}
for (const directory of forbiddenWorkspaces) {
  if (directory === "packages/schema") continue;
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
  join(root, "packages", "app"),
  join(root, "packages", "bundles"),
  join(root, "packages", "client"),
  join(root, "packages", "contracts"),
  join(root, "packages", "database"),
  join(root, "packages", "desktop-host"),
  join(root, "packages", "events"),
  join(root, "packages", "http"),
  join(root, "packages", "kernel"),
  join(root, "packages", "plugin-api"),
  join(root, "packages", "runtime"),
  join(root, "packages", "runtime-adapters"),
  join(root, "packages", "server-connection"),
  join(root, "packages", "ui"),
  join(root, "packages", "ui-runtime"),
  join(root, "plugins"),
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
        if (
          typeof script === "string" &&
          /(?:^|&&\s*|\|\|\s*|;\s*)node(?:\s|$)/u.test(script)
        )
          throw new Error(
            `Package script ${name} invokes system Node: ${path.replace(root, "")}`,
          );
        if (typeof script === "string" && /\bbunx\b/u.test(script))
          throw new Error(
            `Package script ${name} must use bun --bun run instead of bunx: ${path.replace(root, "")}`,
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

const rendererFiles = (
  await files(join(root, "packages", "app", "src"))
).filter((path) => /\.[cm]?[jt]sx?$/u.test(path));
for (const path of rendererFiles) {
  await assertAbsent(
    path,
    /\bfetch\s*\(/u,
    "Renderer must use @dramaip/client rather than fetch",
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
    /@dramaip\/(?:desktop-host|http|kernel|plugin-api|runtime)(?:[/'"]|$)/u,
    "Renderer must not import Host, Runtime, Kernel or Plugin implementations",
  );
  if (!path.includes(`${join("runtime-connection")}`))
    await assertAbsent(
      path,
      /@dramaip\/server-connection/u,
      "Only the Renderer runtime-connection boundary may import ServerConnectionManager",
    );
  await assertAbsent(
    path,
    /\bDomainWorkspace\b/u,
    "Generic DomainWorkspace cannot be used as migration evidence",
  );
}
const preloadPath = join(root, "apps", "desktop", "electron", "preload-v3.ts");
const preloadSource = await readFile(preloadPath, "utf8");
if (
  !/ipcRenderer\s*\.\s*invoke\(RUNTIME_BOOTSTRAP_CHANNEL,\s*nonce\)/u.test(
    preloadSource,
  ) ||
  /ipcRenderer\s*\.\s*(?:send|sendSync|on|once|postMessage)\b/u.test(
    preloadSource,
  )
)
  throw new Error(
    "Preload may use only the one-shot Runtime bootstrap exchange channel",
  );

const pluginFiles = (await files(join(root, "plugins"))).filter((path) =>
  /\.[cm]?[jt]sx?$/u.test(path),
);
const tableOwners = new Map(
  JSON.parse(
    await readFile(join(root, "architecture", "table-owners.json"), "utf8"),
  ).map((entry) => [entry.table, entry.owner]),
);
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
  const source = await readFile(path, "utf8");
  const relativeParts = path.replace(root, "").split(/[\\/]/u).filter(Boolean);
  const owner = relativeParts[0] === "plugins" ? relativeParts[1] : undefined;
  for (const match of source.matchAll(/from\s+["']@dramaip\/([a-z-]+)["']/gu)) {
    const dependency = match[1];
    if (
      dependency &&
      dependency !== owner &&
      dependency !== "plugin-api" &&
      dependency !== "desktop-host" &&
      dependency !== "database" &&
      dependency !== "contracts" &&
      dependency !== "http" &&
      !(owner === "system" && dependency === "extension-host")
    )
      throw new Error(
        `Plugin implementation import crosses ownership boundary: ${owner} -> ${dependency}`,
      );
  }
  if (
    /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s*\$\{/iu.test(
      source,
    )
  )
    throw new Error(
      `Plugin uses dynamic SQL write target: ${path.replace(root, "")}`,
    );
  for (const match of source.matchAll(
    /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|FROM|JOIN)\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/giu,
  )) {
    const table = match[1];
    const tableOwner = tableOwners.get(table);
    if (tableOwner && tableOwner !== owner)
      throw new Error(
        `Plugin SQL crosses table ownership boundary: ${owner} -> ${table} (${tableOwner})`,
      );
  }
}

await assertAbsent(
  join(root, "apps", "desktop", "electron", "desktop-application.ts"),
  /\bbootRuntime\s*\(/u,
  "Electron Main must supervise rather than boot Core Runtime",
);
await assertAbsent(
  join(root, "apps", "desktop", "electron", "desktop-application.ts"),
  /\/api\/v2\//u,
  "Electron Main must not call Runtime business APIs",
);
await assertAbsent(
  join(root, "packages", "runtime", "src", "index.ts"),
  /\/api\/v1/u,
  "Core Runtime must not expose legacy API routes",
);
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
  join(root, "apps", "desktop", "electron", "desktop-application.ts"),
  join(root, "apps", "desktop", "electron.vite.config.ts"),
  join(root, "apps", "desktop", "electron-builder.yml"),
  join(root, "packages", "contracts", "src", "index.ts"),
  join(root, "packages", "client", "src", "openapi.json"),
  join(root, "plugins", "agents", "src", "index.ts"),
];

const electronEntry = await readFile(
  join(root, "apps", "desktop", "electron", "main.ts"),
  "utf8",
);
if (
  !/import\s+["']\.\/desktop-application\.js["']/u.test(electronEntry) ||
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
    join(root, "plugins", "agents", "src", name),
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
    /["'](?:opencode|dsh|grok)["']/u,
    "Only Pi, Codex and LangGraph.js may be active Agent Engines",
  );
}
await assertAbsent(
  join(root, "package.json"),
  /packages\/(?:db|engine-runtime|mcp|protocol|schema|server|tasks)"(?:\s*,|\s*\])/u,
  "Deleted Agent Runtime and legacy Server must not remain workspace packages",
);

const openapi = JSON.parse(
  await readFile(
    join(root, "packages", "client", "src", "openapi.json"),
    "utf8",
  ),
);
const operationIds = new Set();
const methodPaths = new Set();
for (const [path, methods] of Object.entries(openapi.paths ?? {})) {
  if (path.includes("{domain}") || path.includes(":domain"))
    throw new Error(
      `Generic central resource route remains in OpenAPI: ${path}`,
    );
  for (const [method, operation] of Object.entries(methods)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const operationId = operation?.operationId;
    if (!operationId)
      throw new Error(
        `OpenAPI operation has no operationId: ${method.toUpperCase()} ${path}`,
      );
    if (operationIds.has(operationId))
      throw new Error(`Duplicate OpenAPI operationId: ${operationId}`);
    operationIds.add(operationId);
    const key = `${method.toUpperCase()} ${path}`;
    if (methodPaths.has(key))
      throw new Error(`Duplicate OpenAPI route: ${key}`);
    methodPaths.add(key);
  }
}
const migrationMatrix = JSON.parse(
  await readFile(
    join(root, "docs", "engineering", "functional-migration-matrix.json"),
    "utf8",
  ),
);
if (migrationMatrix.summary?.not_migrated !== 0)
  throw new Error(
    `Functional migration matrix has ${migrationMatrix.summary?.not_migrated ?? "unknown"} incomplete operations`,
  );
if (migrationMatrix.actual?.effectiveOperations !== operationIds.size)
  throw new Error(
    `Migration/OpenAPI drift: matrix=${migrationMatrix.actual?.effectiveOperations}, OpenAPI=${operationIds.size}`,
  );
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
