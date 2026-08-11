import { cp, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const vendor = join(desktop, "../../vendor/opencode");
const vendorModules = join(vendor, "node_modules/.bun/node_modules");
const output = join(vendor, "packages/opencode/dist/node/node_modules");

for (const packageName of ["jsonc-parser", "@lydell/node-pty"]) {
  const source = await realpath(join(vendorModules, packageName));
  const target = join(output, packageName);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, dereference: true });
}

const ptyPlatform = `@lydell/node-pty-${process.platform}-${process.arch}`;
// Bun hoists optional platform packages into its virtual node_modules directory.
// Resolving this explicit build-time location keeps the runtime bundle self-contained.
const platformSource = await realpath(join(vendorModules, ptyPlatform));
const platformTarget = join(output, ptyPlatform);
await mkdir(dirname(platformTarget), { recursive: true });
await cp(platformSource, platformTarget, {
  recursive: true,
  dereference: true,
});
