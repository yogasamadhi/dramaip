import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ledger = JSON.parse(
  await readFile(join(root, "docs/parity/core-ledger.json"), "utf8"),
) as {
  scope: string;
  releaseBlocking: boolean;
  endpoints: string[];
  uiRoutes: string[];
  scenarios: Array<{ id: string; status: string; tests: string[] }>;
  acceptanceTests: string[];
};
const openapi = JSON.parse(
  await readFile(join(root, "generated/openapi.json"), "utf8"),
) as { paths: Record<string, unknown> };
const inventory = JSON.parse(
  await readFile(join(root, "docs/parity/baseline-inventory.json"), "utf8"),
) as {
  endpoints: Array<{ scope?: string }>;
  uiRoutes: Array<{ scope?: string }>;
  electronJourneys: Array<{ scope?: string; scenarioId?: string }>;
};

if (ledger.scope !== "core" || ledger.releaseBlocking !== true)
  throw new Error("core parity ledger must be a release-blocking core scope");
if (ledger.scenarios.length < 8)
  throw new Error(
    "core parity requires at least eight scenario-level journeys",
  );
const openScenarios = ledger.scenarios.filter(
  (scenario) => scenario.status !== "complete" || !scenario.tests.length,
);
if (openScenarios.length)
  throw new Error(
    `core parity has incomplete scenarios: ${openScenarios.map((item) => item.id).join(", ")}`,
  );
for (const endpoint of ledger.endpoints)
  if (!openapi.paths[endpoint])
    throw new Error(`core parity endpoint is absent from OpenAPI: ${endpoint}`);
for (const collection of [
  inventory.endpoints,
  inventory.uiRoutes,
  inventory.electronJourneys,
])
  if (collection.some((item) => !["core", "future"].includes(item.scope ?? "")))
    throw new Error("baseline inventory item is missing core/future scope");
if (
  inventory.electronJourneys.some(
    (item) => !item.scenarioId || item.scenarioId.length < 8,
  )
)
  throw new Error("baseline Electron journeys must be scenario-level entries");

const testFiles = new Set([
  ...ledger.acceptanceTests,
  ...ledger.scenarios.flatMap((scenario) => scenario.tests),
]);
for (const file of testFiles) await access(join(root, file));

const uiSources = await Promise.all(
  [
    "system",
    "workspace",
    "writing",
    "knowledge",
    "creative-quality",
    "agents",
  ].map((plugin) =>
    readFile(join(root, `plugins/${plugin}/src/ui.tsx`), "utf8").catch(
      () => "",
    ),
  ),
);
const rendererSource = [
  ...uiSources,
  await readFile(
    join(root, "apps/studio/src/renderer/src/studio-application.tsx"),
    "utf8",
  ),
].join("\n");
for (const route of ledger.uiRoutes)
  if (!rendererSource.includes(route))
    throw new Error(`core UI route is not contributed by a plugin: ${route}`);
if (/\bDomainResourcePage\b/u.test(rendererSource))
  throw new Error("core renderer still uses DomainResourcePage");

async function sourceTree(directory: string): Promise<string[]> {
  const sources: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...(await sourceTree(path)));
    else if (/\.(?:ts|tsx)$/u.test(entry.name))
      sources.push(await readFile(path, "utf8"));
  }
  return sources;
}

const coreSources = (
  await Promise.all(
    ["workspace", "writing", "knowledge", "automation", "agents"].map(
      (plugin) => sourceTree(join(root, `plugins/${plugin}/src`)),
    ),
  )
).flat();
if (coreSources.some((source) => /\b501\b|TODO\s*:/u.test(source)))
  throw new Error("core plugins contain placeholder endpoints or TODO markers");

process.stdout.write(
  `Core parity complete: ${ledger.endpoints.length} contracts, ${ledger.uiRoutes.length} UI routes and ${ledger.scenarios.length} scenarios\n`,
);
