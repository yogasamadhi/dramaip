// Verify a Desktop Host runtime closure against its desktop-runtime.json.
//
//   node scripts/check-desktop-runtime.mjs [closure]
//
// The closure defaults to build/runtime; pass a packaged app's
// Contents/Resources/runtime to check what an installer ships.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDesktopRuntime } from "./desktop-runtime.mjs";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
// pnpm passes a literal `--` separator through to the script.
const [closure] = process.argv.slice(2).filter((arg) => arg !== "--");
const root = resolve(desktopRoot, closure ?? "build/runtime");
const { version } = JSON.parse(
  await readFile(resolve(desktopRoot, "apps/desktop/package.json"), "utf8"),
);
const { manifest, actual, problems } = await verifyDesktopRuntime(
  root,
  version,
);
if (problems.length) {
  console.error(`desktop-runtime.json check failed for ${root}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  if (manifest && actual)
    console.error(
      `  manifest ${manifest.files} files/${manifest.links} links ${manifest.sha256}; found ${actual.files}/${actual.links} ${actual.sha256}`,
    );
  process.exit(1);
}
console.log(
  `desktop-runtime.json verified: ${manifest.version}, ${manifest.files} files, ${manifest.links} links, entry ${manifest.entry}`,
);
