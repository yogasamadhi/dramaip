import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = join(
  root,
  "docs/engineering/legacy-functional-baseline.json",
);
const openapiPath = join(root, "packages/client/src/openapi.json");
const uiCatalogPath = join(root, "architecture/ui-contributions.json");
const outputPath = join(
  root,
  "docs/engineering/functional-migration-matrix.json",
);

const baselineText = await readFile(baselinePath, "utf8");
const openapiText = await readFile(openapiPath, "utf8");
const uiCatalog = JSON.parse(await readFile(uiCatalogPath, "utf8"));
const baseline = JSON.parse(baselineText);
const openapi = JSON.parse(openapiText);
const uiOwners = new Set(uiCatalog.map((contribution) => contribution.owner));

function normalizePath(path) {
  return path.replace(/\{[^}]+\}/gu, "{}").replace(/\/$/u, "");
}

async function sourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceTree(path);
        return /\.[cm]?[jt]sx?$/u.test(entry.name)
          ? readFile(path, "utf8")
          : "";
      }),
    )
  ).join("\n");
}

const actualOperations = [];
const actualById = new Map();
const actualByRoute = new Map();
for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!operation || typeof operation !== "object" || !operation.operationId)
      continue;
    const value = {
      operationId: operation.operationId,
      method: method.toUpperCase(),
      path,
      tags: operation.tags ?? [],
    };
    if (actualById.has(value.operationId))
      throw new Error(`Duplicate actual operationId: ${value.operationId}`);
    const routeKey = `${value.method} ${normalizePath(value.path)}`;
    if (actualByRoute.has(routeKey))
      throw new Error(`Duplicate actual route: ${routeKey}`);
    actualOperations.push(value);
    actualById.set(value.operationId, value);
    actualByRoute.set(routeKey, value);
  }
}

const ownerSources = new Map();
for (const owner of new Set(
  baseline.operations
    .map((operation) => operation.owner)
    .filter((owner) => owner !== "retired-generic-router"),
))
  ownerSources.set(owner, await sourceTree(join(root, `plugins/${owner}/src`)));

const operations = baseline.operations.map((legacy) => {
  const retired = legacy.owner === "retired-generic-router";
  const replacement =
    legacy.operationId === "desktop-support.diagnostics"
      ? actualById.get("system.diagnostics")
      : undefined;
  const actual = replacement ?? actualById.get(legacy.operationId);
  const routeMatches = Boolean(
    actual &&
    (replacement ||
      (actual.method === legacy.method &&
        normalizePath(actual.path) === normalizePath(legacy.path))),
  );
  const source = ownerSources.get(legacy.owner) ?? "";
  const hasUiContribution =
    retired || replacement ? true : uiOwners.has(legacy.owner);
  const hasMigration =
    retired || replacement || /\bmigrations\s*[:,]/u.test(source);
  const hasTransactionalEvent =
    retired || replacement || /transaction\.append\s*\(/u.test(source);
  const implemented =
    !retired &&
    routeMatches &&
    hasUiContribution &&
    hasMigration &&
    hasTransactionalEvent;
  return {
    legacyBehavior: legacy.operationId,
    legacy: {
      method: legacy.method,
      path: legacy.path,
      tag: legacy.tag,
    },
    owner: legacy.owner,
    contract: retired
      ? "replaced by bounded-context contracts"
      : `@dramaip/contracts/${legacy.owner}`,
    routeContribution: retired
      ? "removed"
      : actual
        ? {
            operationId: actual.operationId,
            method: actual.method,
            path: actual.path,
            profile: "studio/e2e",
          }
        : null,
    migration:
      retired || replacement
        ? "not-applicable"
        : hasMigration
          ? "owned-forward-only"
          : null,
    event:
      retired || replacement
        ? "not-applicable"
        : hasTransactionalEvent
          ? "same-transaction-domain-event"
          : null,
    client: actual ? `@dramaip/client#${actual.operationId}` : null,
    uiContribution:
      retired || replacement
        ? "not-applicable"
        : hasUiContribution
          ? legacy.owner
          : null,
    automatedEvidence: actual
      ? ["effective-runtime-openapi", "generated-client", "runtime-conformance"]
      : [],
    status: retired
      ? "retired"
      : replacement
        ? "replaced"
        : implemented
          ? "implemented"
          : "not_migrated",
  };
});

operations.sort((left, right) =>
  `${left.legacy.path}:${left.legacy.method}`.localeCompare(
    `${right.legacy.path}:${right.legacy.method}`,
  ),
);

const baselineIds = new Set(
  baseline.operations.map((operation) => operation.operationId),
);
const newV2Operations = actualOperations
  .filter(
    (operation) =>
      !baselineIds.has(operation.operationId) &&
      operation.operationId !== "system.diagnostics",
  )
  .sort((left, right) => left.operationId.localeCompare(right.operationId));

const summary = operations.reduce(
  (value, operation) => {
    value[operation.status] += 1;
    value.byOwner[operation.owner] = (value.byOwner[operation.owner] ?? 0) + 1;
    return value;
  },
  { implemented: 0, not_migrated: 0, replaced: 0, retired: 0, byOwner: {} },
);

const matrix = {
  schemaVersion: 2,
  productBaseline: baseline.productBaseline,
  sourceOfTruth: "studio/e2e Effective Runtime Graph OpenAPI",
  baselineSha256: createHash("sha256").update(baselineText).digest("hex"),
  effectiveOpenApiSha256: createHash("sha256")
    .update(openapiText)
    .digest("hex"),
  expected: {
    legacyOperations: baseline.operations.length,
    retiredGenericOperations: 5,
    electronE2eJourneys: 34,
    visualBaselines: 12,
  },
  actual: {
    effectiveOperations: actualOperations.length,
    uniqueOperationIds: actualById.size,
    uniqueMethodPaths: actualByRoute.size,
    newV2Operations: newV2Operations.length,
  },
  summary,
  operations,
  newV2Operations,
};
const generated = `${JSON.stringify(matrix, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== generated)
    throw new Error(
      "Functional migration matrix is stale; run bun run migration:generate",
    );
  if (process.argv.includes("--complete") && summary.not_migrated > 0)
    throw new Error(
      `Functional migration is incomplete: ${summary.not_migrated} operations remain`,
    );
  process.stdout.write(
    `Functional migration matrix is current (${summary.implemented} implemented, ${summary.not_migrated} remaining, ${summary.replaced} replaced, ${summary.retired} retired; ${actualOperations.length} effective operations)\n`,
  );
} else {
  await writeFile(outputPath, generated);
  process.stdout.write(`Generated ${outputPath}\n`);
}
