import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatSource } from "prettier";
import { AGENT_RUNTIME_DESCRIPTORS } from "@dramaip/desktop-host";
import {
  bootRuntime,
  collectPluginMigrations,
  createFirstPartyPluginRegistry,
  loadProfile,
} from "@dramaip/runtime";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const architectureDirectory = join(root, "architecture");
const check = process.argv.includes("--check");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested.flat().filter((path) => /\.[cm]?[jt]sx?$/u.test(path));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function domainEventTemplatePattern(
  template: string,
): { owner: string; pattern: string } | undefined {
  if (!template.includes("${") || !/\.v\d+$/u.test(template)) return undefined;
  const owner = /^([a-z][a-z0-9-]*)\./u.exec(template)?.[1];
  if (!owner) return undefined;
  const parts = template.split(/\$\{[^}]+\}/gu);
  if (parts.length < 2) return undefined;
  return {
    owner,
    pattern: `^${parts.map(escapeRegularExpression).join("[a-z0-9-]+")}$`,
  };
}

async function writeCatalog(name: string, value: unknown): Promise<void> {
  const path = join(architectureDirectory, name);
  const next = stableJson(value);
  if (check) {
    const current = await readFile(path, "utf8").catch(() => "");
    if (current !== next)
      throw new Error(
        `Architecture catalog is stale: ${relative(root, path)} (run bun run architecture:generate)`,
      );
    return;
  }
  await writeFile(path, next);
}

async function writeGeneratedFile(path: string, next: string): Promise<void> {
  if (check) {
    const current = await readFile(path, "utf8").catch(() => "");
    if (current !== next)
      throw new Error(
        `Generated architecture file is stale: ${relative(root, path)} (run bun run architecture:generate)`,
      );
    return;
  }
  await writeFile(path, next);
}

async function typescriptSource(source: string): Promise<string> {
  return formatSource(source, { parser: "typescript" });
}

async function main(): Promise<void> {
  const profile = loadProfile(join(root, "profiles", "studio.json"));
  const registry = createFirstPartyPluginRegistry();
  const runtime = await bootRuntime({
    databasePath: ":memory:",
    profile,
    runtimeKind: "bun",
    mode: "headless",
  });

  try {
    const diagnostics = runtime.kernel.diagnostics();
    const routeByOperationId = new Map(
      (diagnostics.routeContributions ?? []).map((route) => {
        if (!route.operationId || !route.method || !route.path)
          throw new Error(`Route metadata is incomplete: ${route.id}`);
        if (route.pluginId.length === 0)
          throw new Error(`Route owner is missing: ${route.id}`);
        return [route.operationId, route] as const;
      }),
    );
    if (routeByOperationId.size !== diagnostics.routeContributions?.length)
      throw new Error("Duplicate route operationId in the effective graph");

    const openapi = JSON.parse(
      await readFile(
        join(root, "packages", "client", "src", "openapi.json"),
        "utf8",
      ),
    ) as {
      paths?: Record<
        string,
        Record<string, { operationId?: string; tags?: string[] }>
      >;
    };
    const routes: Array<{
      method: string;
      path: string;
      operationId: string;
      owner: string;
    }> = [];
    for (const [path, methods] of Object.entries(openapi.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!new Set(["delete", "get", "patch", "post", "put"]).has(method))
          continue;
        if (!operation.operationId)
          throw new Error(`OpenAPI operationId is missing: ${method} ${path}`);
        const contribution = routeByOperationId.get(operation.operationId);
        const owner =
          contribution?.pluginId ??
          (path.startsWith("/api/v2/") &&
          operation.operationId.startsWith("system.")
            ? "runtime"
            : operation.tags?.[0]);
        if (!owner)
          throw new Error(`Route owner is missing: ${operation.operationId}`);
        routes.push({
          method,
          path,
          operationId: operation.operationId,
          owner,
        });
      }
    }
    routes.sort((left, right) =>
      `${left.path}:${left.method}`.localeCompare(
        `${right.path}:${right.method}`,
      ),
    );

    const tableOwners = new Map<string, string>();
    for (const migration of collectPluginMigrations(registry, profile)) {
      for (const match of migration.sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/giu,
      )) {
        const table = match[1]!;
        const existing = tableOwners.get(table);
        if (existing && existing !== migration.pluginId)
          throw new Error(`Table has multiple owners: ${table}`);
        tableOwners.set(table, migration.pluginId);
      }
    }

    const domainEvents = new Map<string, string>();
    const domainEventPatterns = new Map<string, string>();
    const realtimeEvents = new Map<string, string>();
    for (const [pluginId] of registry) {
      const directory = join(root, "plugins", pluginId, "src");
      for (const path of await sourceFiles(directory).catch(() => [])) {
        const source = await readFile(path, "utf8");
        for (const match of source.matchAll(
          /type\s*:\s*["`]([a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v\d+)["`]/gu,
        )) {
          const type = match[1]!;
          const owner = type.split(".")[0]!;
          if (owner !== pluginId)
            throw new Error(
              `Domain event owner mismatch: ${type} in ${pluginId}`,
            );
          domainEvents.set(type, owner);
        }
        for (const match of source.matchAll(
          /type\s*:\s*`([^`]*\$\{[^`]+\}[^`]*)`/gu,
        )) {
          const declaration = domainEventTemplatePattern(match[1]!);
          if (!declaration) continue;
          if (declaration.owner !== pluginId)
            throw new Error(
              `Domain event pattern owner mismatch: ${declaration.pattern} in ${pluginId}`,
            );
          const existing = domainEventPatterns.get(declaration.pattern);
          if (existing && existing !== declaration.owner)
            throw new Error(
              `Domain event pattern has multiple owners: ${declaration.pattern}`,
            );
          domainEventPatterns.set(declaration.pattern, declaration.owner);
        }
        for (const match of source.matchAll(
          /publishLive\s*\(\s*\{[\s\S]{0,200}?type\s*:\s*["`]([^"`]+)["`]/gu,
        )) {
          const type = match[1]!;
          realtimeEvents.set(type, pluginId);
        }
      }
    }

    const ui = runtime.kernel.ui
      .contributions()
      .map((contribution) => ({
        id: contribution.id,
        owner: contribution.pluginId,
        kind: contribution.kind,
        metadata: contribution.metadata,
        metadataHash: contribution.metadataHash,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (ui.some((contribution) => !contribution.metadataHash))
      throw new Error("Kernel did not sign every built-in UI contribution");

    const services = [...diagnostics.services].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const engines = Object.values(AGENT_RUNTIME_DESCRIPTORS).sort(
      (left, right) => left.kind.localeCompare(right.kind),
    );

    await writeCatalog(
      "table-owners.json",
      [...tableOwners]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([table, owner]) => ({ table, owner })),
    );
    await writeCatalog("route-owners.json", routes);
    await writeCatalog("event-owners.json", {
      domain: [...domainEvents]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, owner]) => ({ type, owner })),
      domainPatterns: [...domainEventPatterns]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([pattern, owner]) => ({ pattern, owner })),
      realtime: [...realtimeEvents]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, owner]) => ({ type, owner })),
    });
    await writeGeneratedFile(
      join(root, "packages", "runtime", "src", "event-manifest.generated.ts"),
      await typescriptSource(
        `/* Generated by scripts/generate-architecture-catalogs.ts. Do not edit. */\nexport const DOMAIN_EVENT_MANIFEST = ${JSON.stringify(
          Object.fromEntries(
            [...domainEvents]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([type, owner]) => [type, { owner }]),
          ),
          null,
          2,
        )} as const;\nexport const DOMAIN_EVENT_PATTERNS = ${JSON.stringify(
          [...domainEventPatterns]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([pattern, owner]) => ({ pattern, owner })),
          null,
          2,
        )} as const;\n`,
      ),
    );
    await writeCatalog("ui-contributions.json", ui);
    const builtinManifest = Object.fromEntries(
      ui.map((contribution) => [
        contribution.id,
        {
          pluginId: contribution.owner,
          kind: contribution.kind,
          metadata: contribution.metadata,
          metadataHash: contribution.metadataHash,
        },
      ]),
    );
    await writeGeneratedFile(
      join(
        root,
        "packages",
        "app",
        "src",
        "contribution-registry",
        "builtin-manifest.generated.ts",
      ),
      await typescriptSource(
        `/* Generated by scripts/generate-architecture-catalogs.ts. Do not edit. */\nexport const BUILTIN_UI_MANIFEST = ${JSON.stringify(
          builtinManifest,
          null,
          2,
        )} as const;\n`,
      ),
    );
    await writeCatalog("engine-capabilities.json", engines);
    await writeCatalog("service-contracts.json", services);
  } finally {
    await runtime.stop();
  }

  process.stdout.write(
    check
      ? "Architecture catalogs are current\n"
      : "Architecture catalogs generated\n",
  );
}

void main();
