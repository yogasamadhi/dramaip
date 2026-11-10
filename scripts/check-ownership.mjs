// Ownership gates that do not boot the Kernel (REFACTOR_PLAN_DSH_LEVEL2 P0).
//
// Everything here is read from source, so the gates keep working while the
// Kernel, its route registry and the generated catalogs are being replaced:
//
//   tables   every CREATE TABLE has exactly one owning plugin
//   sql      a plugin reads and writes only the tables it owns, never a dynamic target
//   imports  a plugin never imports a sibling plugin's implementation
//   events   a domain event type starts with its owning plugin id
//
// Route ownership is carried by the refactor ledger (check:refactor-ledger).
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyHandlers } from "./legacy-handlers.mjs";

const skipped = new Set(["node_modules", "dist", "out", "build", ".turbo"]);
const sourcePattern = /\.[cm]?[jt]sx?$/u;
const testPattern = /\.(?:test|spec|integration)\.[cm]?[jt]sx?$/u;

/** Shared modules every plugin may import (internal API, contracts, Host contract, storage). */
export const sharedPackages = new Set([
  "plugin-api",
  "contracts",
  "host-contracts",
  "database",
  "http",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const nested = await Promise.all(
    entries
      .filter((entry) => !skipped.has(entry.name))
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
  );
  return nested.flat();
}

/**
 * Reads the plugin sources into `{ owner, ownerRoot, path, source, test }`
 * records: `<pluginsRoot>/<id>/src/**` for a directory, or each
 * `{ id, directory }` handler's `<directory>/**` for a list.
 */
export async function readPluginSources(pluginsRoot) {
  const owners =
    typeof pluginsRoot === "string"
      ? (await readdir(pluginsRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({
            id: entry.name,
            ownerRoot: join(pluginsRoot, entry.name),
            sources: join(pluginsRoot, entry.name, "src"),
          }))
      : pluginsRoot.map(({ id, directory }) => ({
          id,
          ownerRoot: directory,
          sources: directory,
        }));
  const records = [];
  for (const { id: owner, ownerRoot, sources } of owners)
    for (const path of await walk(sources))
      if (sourcePattern.test(path))
        records.push({
          owner,
          ownerRoot,
          path,
          source: await readFile(path, "utf8"),
          test: testPattern.test(path),
        });
  return { plugins: owners.map(({ id }) => id), records };
}

export function collectTableOwners(records) {
  const owners = new Map();
  for (const record of records) {
    if (record.test) continue;
    for (const match of record.source.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)/giu,
    )) {
      const table = match[1];
      if (!owners.has(table)) owners.set(table, new Set());
      owners.get(table).add(record.owner);
    }
  }
  return owners;
}

export function findOwnershipViolations({ plugins, records }, base) {
  const violations = [];
  const name = (path) => relative(base, path).split(sep).join("/");
  const tableOwners = collectTableOwners(records);
  for (const [table, owners] of tableOwners)
    if (owners.size > 1)
      violations.push(
        `table ${table} has several owners: ${[...owners].sort().join(", ")}`,
      );
  const pluginIds = new Set(plugins);
  for (const record of records) {
    const { owner, ownerRoot, path, source } = record;
    for (const match of source.matchAll(
      /from\s+["']@dramaip\/([a-z-]+)(?:\/[^"']*)?["']/gu,
    )) {
      const dependency = match[1];
      if (dependency !== owner && !sharedPackages.has(dependency))
        violations.push(
          `${name(path)}: imports @dramaip/${dependency} across the ownership boundary`,
        );
    }
    for (const match of source.matchAll(
      /from\s+["']((?:\.\.\/)+)([a-z-]+)\//gu,
    )) {
      const sibling = match[2];
      const depth = match[1].length / 3;
      const pluginDepth = relative(ownerRoot, path).split(sep).length - 1;
      if (depth > pluginDepth && pluginIds.has(sibling) && sibling !== owner)
        violations.push(
          `${name(path)}: imports sibling plugin ${sibling} by relative path`,
        );
    }
    if (record.test) continue;
    if (
      /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s*\$\{/iu.test(
        source,
      )
    )
      violations.push(`${name(path)}: dynamic SQL write target`);
    for (const match of source.matchAll(
      /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|FROM|JOIN)\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/giu,
    )) {
      const owners = tableOwners.get(match[1]);
      if (owners && !owners.has(owner))
        violations.push(
          `${name(path)}: SQL touches ${match[1]} owned by ${[...owners].join(", ")}`,
        );
    }
    for (const match of source.matchAll(
      /type\s*:\s*["`]([a-z][a-z0-9-]*)\.[a-z][a-z0-9-]*\.v\d+["`]/gu,
    ))
      if (match[1] !== owner)
        violations.push(
          `${name(path)}: domain event ${match[0].split(/["`]/u)[1]} is not prefixed by ${owner}`,
        );
  }
  return [...new Set(violations)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const sources = await readPluginSources(
    legacyHandlers(base).map(({ id, directory }) => ({
      id,
      directory: join(base, directory),
    })),
  );
  const violations = findOwnershipViolations(sources, base);
  if (violations.length > 0) {
    process.stderr.write(
      `Ownership gates failed:\n${violations.map((v) => `  ${v}`).join("\n")}\n`,
    );
    process.exit(1);
  }
  const tables = collectTableOwners(sources.records).size;
  process.stdout.write(
    `Ownership gates passed for ${sources.plugins.length} plugins and ${tables} tables\n`,
  );
}
