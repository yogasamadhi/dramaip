// Refactor ledger (REFACTOR_PLAN_DSH_LEVEL2 §7.2).
//
// The ledger freezes, at P0, the three inventories the refactor is measured
// against: every OpenAPI operation, every Electron E2E spec and every
// first-party plugin. Entries are never hand-edited. Their state is derived
// from code facts on every run:
//
//   operation  legacy   → served only by the Core Runtime /api/v2 router
//              compat   → served by the compat /api/v2 router (P2–P5); the
//                         router was deleted in P6, so no operation is compat
//              migrated → a Remote method in packages/** carries `@replaces <operationId>`
//              retired  → listed in architecture/refactor-retired.json with a reason
//   spec       legacy   → runs against the existing Electron Main + Core Runtime
//              migrated → listed by the new shell's spec manifest
//   plugin     legacy   → still a plugins/<id> FirstPartyPlugin under the Kernel
//              migrated → a Cordis plugin package under packages/<group>/
//
// Usage:
//   node scripts/refactor-ledger.mjs --freeze          create the ledger (P0 only)
//   node scripts/refactor-ledger.mjs                   refresh derived states
//   node scripts/refactor-ledger.mjs --check           fail when the ledger is stale or drifted
//     [--require compat|migrated]                      every operation at least at that state
//     [--domain <domain>]                              that domain is fully migrated or retired
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ledgerStates = ["legacy", "compat", "migrated", "retired"];
const stateRank = new Map(ledgerStates.map((state, index) => [state, index]));

/** Target packages per current owner (plan §5). `runtime` routes join system. */
export const domainTargets = {
  foundation: { domain: "system", host: "@dramaip/system-system" },
  runtime: { domain: "system", host: "@dramaip/system-system" },
  system: { domain: "system", host: "@dramaip/system-system" },
  workspace: { domain: "workspace", host: "@dramaip/workspace-workspace" },
  writing: { domain: "writing", host: "@dramaip/writing-writing" },
  knowledge: { domain: "knowledge", host: "@dramaip/writing-knowledge" },
  "creative-quality": {
    domain: "creative-quality",
    host: "@dramaip/writing-quality",
  },
  agents: { domain: "agents", host: "@dramaip/agents-agents" },
  automation: { domain: "automation", host: "@dramaip/automation-automation" },
  production: { domain: "production", host: "@dramaip/production-production" },
  media: { domain: "media", host: "@dramaip/production-media" },
  timeline: { domain: "timeline", host: "@dramaip/production-timeline" },
  review: { domain: "review", host: "@dramaip/production-review" },
  delivery: { domain: "delivery", host: "@dramaip/production-delivery" },
  insights: { domain: "insights", host: "@dramaip/insights-insights" },
};

const skipped = new Set(["node_modules", "dist", "out", "build", ".turbo"]);

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

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

/** Code facts the states are derived from. */
export async function collectFacts(root) {
  const operations = (
    await readJson(join(root, "architecture/route-owners.json"), [])
  ).map(({ operationId, method, path }) => ({ operationId, method, path }));

  const routeOwners = new Map(
    (await readJson(join(root, "architecture/route-owners.json"), [])).map(
      (entry) => [entry.operationId, entry.owner],
    ),
  );

  const compat = new Set();

  const replaced = new Map();
  for (const path of await walk(join(root, "packages"))) {
    if (!/\.[cm]?tsx?$/u.test(path)) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/@replaces\s+([A-Za-z0-9_.-]+)/gu))
      replaced.set(match[1], relative(root, path));
  }

  const retired = new Map(
    (await readJson(join(root, "architecture/refactor-retired.json"), [])).map(
      (entry) => [entry.operationId ?? entry.id, entry],
    ),
  );

  const specs = (await readdir(join(root, "tests/electron")))
    .filter((name) => name.endsWith(".spec.ts"))
    .sort();
  const migratedSpecs = new Set(
    await readJson(join(root, "tests/desktop-shell/specs.generated.json"), []),
  );

  const plugins = (
    await readdir(join(root, "plugins"), { withFileTypes: true }).catch(
      () => [],
    )
  )
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(root, "plugins", entry.name, "package.json")),
    )
    .map((entry) => entry.name)
    .sort();

  return {
    operations,
    routeOwners,
    compat,
    replaced,
    retired,
    specs,
    migratedSpecs,
    plugins,
  };
}

function operationState(operationId, facts) {
  if (facts.retired.has(operationId)) return "retired";
  if (facts.replaced.has(operationId)) return "migrated";
  if (facts.compat.has(operationId)) return "compat";
  return "legacy";
}

/** Builds the ledger. `frozen` is the previous ledger; without it, freezes now. */
export function buildLedger(facts, frozen) {
  const frozenOperations = frozen
    ? frozen.operations.map(({ operationId, method, path, owner }) => ({
        operationId,
        method,
        path,
        owner,
      }))
    : facts.operations
        .map((operation) => ({
          ...operation,
          owner: facts.routeOwners.get(operation.operationId),
        }))
        .sort((a, b) => a.operationId.localeCompare(b.operationId));
  const operations = frozenOperations.map((operation) => {
    const target = domainTargets[operation.owner];
    const state = operationState(operation.operationId, facts);
    const entry = {
      ...operation,
      domain: target?.domain ?? null,
      hostPackage: target?.host ?? null,
      clientPackage: target ? `${target.host}-client` : null,
      state,
    };
    if (state === "migrated")
      entry.evidence = facts.replaced.get(operation.operationId);
    if (state === "retired")
      entry.reason = facts.retired.get(operation.operationId).reason ?? null;
    return entry;
  });
  const specs = (
    frozen ? frozen.specs.map((spec) => spec.spec) : facts.specs
  ).map((spec) => ({
    spec,
    state: facts.migratedSpecs.has(spec) ? "migrated" : "legacy",
  }));
  const plugins = (
    frozen ? frozen.plugins.map((plugin) => plugin.id) : facts.plugins
  ).map((id) => ({
    id,
    target: domainTargets[id]?.host ?? null,
    state: facts.plugins.includes(id) ? "legacy" : "migrated",
  }));
  const summary = Object.fromEntries(
    ledgerStates.map((state) => [
      state,
      operations.filter((operation) => operation.state === state).length,
    ]),
  );
  return {
    frozenAt: frozen?.frozenAt ?? null,
    inventory: {
      operations: operations.length,
      specs: specs.length,
      plugins: plugins.length,
    },
    summary,
    operations,
    specs,
    plugins,
  };
}

/** Returns the problems that make `--check` fail. */
export function verifyLedger(ledger, facts, options = {}) {
  const problems = [];
  const frozen = new Set(ledger.operations.map((entry) => entry.operationId));
  for (const operation of facts.operations)
    if (!frozen.has(operation.operationId))
      problems.push(
        `new operation outside the frozen ledger: ${operation.operationId} (feature freeze; compat accepts no new routes)`,
      );
  const live = new Set(
    facts.operations.map((operation) => operation.operationId),
  );
  for (const entry of ledger.operations) {
    if (!entry.owner || !entry.domain)
      problems.push(`operation has no owner domain: ${entry.operationId}`);
    if (
      (entry.state === "legacy" || entry.state === "compat") &&
      !live.has(entry.operationId)
    )
      problems.push(
        `operation removed without migration or retirement: ${entry.operationId}`,
      );
    if (entry.state === "retired" && !entry.reason)
      problems.push(`retired operation has no reason: ${entry.operationId}`);
  }
  if (options.require) {
    const minimum = stateRank.get(options.require);
    if (minimum === undefined)
      problems.push(`unknown --require state: ${options.require}`);
    else
      for (const entry of ledger.operations)
        if (stateRank.get(entry.state) < minimum)
          problems.push(
            `${entry.operationId} is ${entry.state}, required ${options.require}`,
          );
  }
  if (options.domain) {
    const entries = ledger.operations.filter(
      (entry) => entry.domain === options.domain,
    );
    if (entries.length === 0)
      problems.push(`unknown domain: ${options.domain}`);
    for (const entry of entries)
      if (entry.state !== "migrated" && entry.state !== "retired")
        problems.push(
          `${entry.operationId} is ${entry.state}; domain ${options.domain} is not done`,
        );
  }
  return problems;
}

export function serializeLedger(ledger) {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const target = join(root, "architecture/refactor-ledger.json");
  const facts = await collectFacts(root);
  const freeze = process.argv.includes("--freeze");
  const check = process.argv.includes("--check");
  const previous = await readJson(target, undefined);
  if (freeze && previous)
    throw new Error("The refactor ledger is already frozen");
  if (!freeze && !previous)
    throw new Error("No refactor ledger; P0 creates it with --freeze");
  const ledger = buildLedger(facts, previous);
  if (freeze) ledger.frozenAt = new Date().toISOString().slice(0, 10);
  const content = serializeLedger(ledger);
  if (check) {
    const problems = verifyLedger(ledger, facts, {
      require: argument("--require"),
      domain: argument("--domain"),
    });
    if ((await readFile(target, "utf8")) !== content)
      problems.unshift(
        "architecture/refactor-ledger.json is stale; run pnpm run refactor-ledger:generate",
      );
    if (problems.length > 0) {
      process.stderr.write(`${problems.map((p) => `  ${p}`).join("\n")}\n`);
      process.exit(1);
    }
  } else await writeFile(target, content);
  const { summary, inventory } = ledger;
  process.stdout.write(
    `Refactor ledger: ${inventory.operations} operations (${ledgerStates
      .map((state) => `${state} ${summary[state]}`)
      .join(", ")}), ${inventory.specs} specs, ${inventory.plugins} plugins\n`,
  );
}
