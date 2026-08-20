import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) =>
          !["dist", "node_modules", "out", ".turbo"].includes(entry.name),
      )
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
  );
  return nested.flat();
}

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
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
    await assertAbsent(
      path,
      /@sdns\//u,
      "Active source must not reference a legacy @sdns package",
    );
    await assertAbsent(
      path,
      /\/api\/v1(?:\/|["'])/u,
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
}
await assertAbsent(
  join(root, "packages", "app", "src", "studio-app.tsx"),
  /\bDomainWorkspace\b/u,
  "Generic DomainWorkspace cannot be used as migration evidence",
);
await assertAbsent(
  join(root, "apps", "desktop", "electron", "preload-v3.ts"),
  /\bipcRenderer\b|\.invoke\(/u,
  "Preload must expose only RuntimeBootstrap",
);

const pluginFiles = (await files(join(root, "plugins"))).filter((path) =>
  /\.[cm]?[jt]sx?$/u.test(path),
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
  await assertAbsent(
    path,
    /@deepseek-ai\/cordis/u,
    "Cordis must not escape the Kernel boundary",
  );
  const source = await readFile(path, "utf8");
  const owner = path.split("/plugins/")[1]?.split("/")[0];
  for (const match of source.matchAll(/from\s+["']@dramaip\/([a-z-]+)["']/gu)) {
    const dependency = match[1];
    if (
      dependency &&
      dependency !== owner &&
      dependency !== "plugin-api" &&
      dependency !== "desktop-host" &&
      dependency !== "database" &&
      dependency !== "contracts" &&
      dependency !== "http"
    )
      throw new Error(
        `Plugin implementation import crosses ownership boundary: ${owner} -> ${dependency}`,
      );
  }
}

await assertAbsent(
  join(root, "apps", "desktop", "electron", "main-v3.ts"),
  /\bbootRuntime\s*\(/u,
  "Electron Main must supervise rather than boot Core Runtime",
);
await assertAbsent(
  join(root, "packages", "runtime", "src", "index.ts"),
  /\/api\/v1/u,
  "Core Runtime must not expose legacy API routes",
);
const activeAgentEngineFiles = [
  join(root, "apps", "desktop", "electron", "main-v3.ts"),
  join(root, "apps", "desktop", "electron.vite.config.ts"),
  join(root, "apps", "desktop", "electron-builder.yml"),
  join(root, "packages", "contracts", "src", "index.ts"),
  join(root, "packages", "client", "src", "openapi.json"),
  join(root, "plugins", "agents", "src", "index.ts"),
];
for (const path of activeAgentEngineFiles) {
  await assertAbsent(
    path,
    /["'](?:opencode|dsh|langgraph)["']/u,
    "Only Pi, Codex and Grok Build may be active Agent Engines",
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
