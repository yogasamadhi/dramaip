import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baseline = JSON.parse(
  await readFile(resolve(root, "docs/parity/baseline.json"), "utf8"),
);
const inventory = JSON.parse(
  await readFile(resolve(root, "docs/parity/baseline-inventory.json"), "utf8"),
) as {
  sourceHead: string;
  sourceOpenApiSha256: string;
  counts: {
    endpoints: number;
    uiRoutes: number;
    electronJourneys: number;
  };
  endpoints: Array<{ sourcePath: string; methods: string[] }>;
  uiRoutes: Array<{ sourcePath: string }>;
  electronJourneys: Array<{ sourceTest: string; sourceSha256: string }>;
};
if (
  inventory.sourceHead !== baseline.sourceHead ||
  inventory.sourceOpenApiSha256 !== baseline.openApiSha256
)
  throw new Error("baseline inventory source identity drifted");
if (
  inventory.counts.endpoints !== inventory.endpoints.length ||
  inventory.counts.uiRoutes !== inventory.uiRoutes.length ||
  inventory.counts.electronJourneys !== inventory.electronJourneys.length
)
  throw new Error("baseline inventory counts are invalid");
const sourceIdentity = {
  endpoints: inventory.endpoints.map((item) => ({
    sourcePath: item.sourcePath,
    methods: item.methods,
  })),
  uiRoutes: inventory.uiRoutes.map((item) => item.sourcePath),
  electronJourneys: inventory.electronJourneys.map((item) => ({
    sourceTest: item.sourceTest,
    sourceSha256: item.sourceSha256,
  })),
};
const sourceHash = createHash("sha256")
  .update(JSON.stringify(sourceIdentity))
  .digest("hex");
if (sourceHash !== baseline.inventorySourceSha256)
  throw new Error(`baseline inventory source hash drifted: ${sourceHash}`);
process.stdout.write(
  "Pinned comparison inventory identity verified without reading current desktop source\n",
);
