import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const matrixPath = join(
  root,
  "docs/engineering/functional-migration-matrix.json",
);
const outputPath = join(
  root,
  "docs/engineering/legacy-functional-baseline.json",
);
const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
const baseline = {
  schemaVersion: 1,
  productBaseline: "desktop/legacy/desktop (read-only)",
  capturedVersion: "3.0.0-alpha.3-migration-start",
  operations: matrix.operations.map((operation) => ({
    operationId: operation.legacyBehavior,
    method: operation.method,
    path: operation.path,
    tag: operation.tag,
    owner: operation.owner,
  })),
};
await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
process.stdout.write(
  `Captured ${baseline.operations.length} legacy operations in ${outputPath}\n`,
);
