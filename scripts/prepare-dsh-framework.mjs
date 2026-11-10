import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  frameworkManifest,
  frameworkPackages,
  frameworkRoot,
  sourceRoot,
  verifyDshSource,
} from "./dsh-framework.mjs";

if (process.versions.node !== "24.18.0" || process.versions.bun)
  throw new Error("Framework preparation requires Node 24.18.0 exactly");
const digest = await verifyDshSource();
const check = process.argv.includes("--check");
for (const name of frameworkPackages) {
  const original = join(sourceRoot, "vendor", name);
  const target = join(frameworkRoot, name);
  const expected = `${JSON.stringify(await frameworkManifest(name), null, 2)}\n`;
  if (check) {
    if (
      (await readFile(join(target, "package.json"), "utf8").catch(() => "")) !==
      expected
    )
      throw new Error(
        `Framework workspace ${name} is missing or stale; run pnpm run prepare:framework`,
      );
  } else {
    await mkdir(target, { recursive: true });
    await rm(join(target, "src"), { recursive: true, force: true });
    await cp(join(original, "src"), join(target, "src"), { recursive: true });
    await cp(join(original, "LICENSE"), join(target, "LICENSE"));
    await writeFile(join(target, "package.json"), expected);
  }
}
if (!check)
  await writeFile(
    join(frameworkRoot, "source.json"),
    `${JSON.stringify({ dshSourceTreeSha256: digest, packages: frameworkPackages }, null, 2)}\n`,
  );
console.log(
  `DSH framework workspaces ${check ? "verified" : "prepared"} (${digest.slice(0, 12)})`,
);
