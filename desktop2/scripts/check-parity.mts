import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ledger = JSON.parse(
  await readFile(resolve(root, "docs/parity/ledger.json"), "utf8"),
) as {
  purpose?: string;
  releaseBlocking?: boolean;
  contexts: Array<{ id: string; status: string }>;
};
const inventory = JSON.parse(
  await readFile(resolve(root, "docs/parity/baseline-inventory.json"), "utf8"),
) as {
  endpoints: Array<{
    status: string;
    disposition?: string;
    replacementEndpoints?: string[];
    acceptanceTests?: string[];
  }>;
  uiRoutes: Array<{
    sourcePath?: string;
    status: string;
    disposition?: string;
    replacementRoutes?: string[];
    acceptanceTests?: string[];
  }>;
  electronJourneys: Array<{
    status: string;
    disposition?: string;
    replacementTests?: string[];
  }>;
};
const allowedStatuses = new Set(["pending", "in-progress", "complete"]);
const statuses = [
  ...ledger.contexts.map((item) => item.status),
  ...inventory.endpoints.map((item) => item.status),
  ...inventory.uiRoutes.map((item) => item.status),
  ...inventory.electronJourneys.map((item) => item.status),
];
const invalidStatuses = [...new Set(statuses)].filter(
  (status) => !allowedStatuses.has(status),
);
if (invalidStatuses.length)
  throw new Error(`invalid parity statuses: ${invalidStatuses.join(", ")}`);
if (ledger.purpose !== "full-migration" || ledger.releaseBlocking !== true)
  throw new Error("full parity ledger must be release blocking");

const dispositions = new Set(["migrate", "local-policy", "exclude-dev-only"]);
for (const item of [
  ...inventory.endpoints,
  ...inventory.uiRoutes,
  ...inventory.electronJourneys,
])
  if (!item.disposition || !dispositions.has(item.disposition))
    throw new Error("parity inventory item has no valid disposition");
for (const route of inventory.uiRoutes)
  if (route.disposition === "exclude-dev-only" && route.sourcePath !== "/__ui")
    throw new Error("only /__ui may use exclude-dev-only");

const open = ledger.contexts.filter((context) => context.status !== "complete");
const inventoryOpen = [
  ...inventory.endpoints,
  ...inventory.uiRoutes,
  ...inventory.electronJourneys,
].filter(
  (item) =>
    item.disposition !== "exclude-dev-only" && item.status !== "complete",
);
const summary = `${open.length} open contexts and ${inventoryOpen.length} open comparison items`;
if (process.argv.includes("--strict") && (open.length || inventoryOpen.length))
  throw new Error(
    `strict parity gate has ${summary}: ${open.map((item) => item.id).join(", ")}`,
  );
process.stdout.write(
  open.length || inventoryOpen.length
    ? `Parallel parity report: ${summary} (non-blocking)\n`
    : "Parallel parity report: comparison scope is complete\n",
);
