import { readFile, realpath, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  desktopRoot,
  frameworkPackages,
  frameworkRoot,
  frameworkManifest,
  sourceFiles,
  sourceRoot,
  verifyDshSource,
} from "./dsh-framework.mjs";

await verifyDshSource();
const built = JSON.parse(
  await readFile(join(frameworkRoot, "build.json"), "utf8"),
);
if (
  JSON.stringify(built) !==
  JSON.stringify(
    await sourceFiles(
      frameworkRoot,
      new Set(["node_modules", ".types", "build.json"]),
    ),
  )
)
  throw new Error(
    "Framework build is stale or modified; run bun run build:framework",
  );
const owners = [
  "packages/kernel",
  "packages/runtime",
  "packages/plugin-api",
  ...frameworkPackages.map((id) => `build/dsh-framework/${id}`),
  ...(await readdir(join(desktopRoot, "plugins"))).map((id) => `plugins/${id}`),
];
const lock = await readFile(join(desktopRoot, "bun.lock"), "utf8");
for (const name of frameworkPackages) {
  const manifest = await frameworkManifest(name);
  const original = await sourceFiles(join(sourceRoot, "vendor", name, "src"));
  const staged = await sourceFiles(join(frameworkRoot, name, "src"));
  if (JSON.stringify(original) !== JSON.stringify(staged))
    throw new Error(`DSH ${name} staged source differs from vendor`);
  if (
    (await readFile(join(sourceRoot, "vendor", name, "LICENSE"), "utf8")) !==
    (await readFile(join(frameworkRoot, name, "LICENSE"), "utf8"))
  )
    throw new Error(`DSH ${name} license differs`);
  if (
    new RegExp(
      `"${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@(?!workspace:)[^"]+"`,
    ).test(lock)
  )
    throw new Error(`Registry copy of ${manifest.name} is forbidden`);
  for (const owner of owners.filter((owner) =>
    existsSync(join(desktopRoot, owner, "package.json")),
  )) {
    const require = createRequire(join(desktopRoot, owner, "package.json"));
    const ownerManifest = JSON.parse(
      await readFile(join(desktopRoot, owner, "package.json"), "utf8"),
    );
    if (
      !ownerManifest.dependencies?.[manifest.name] &&
      !ownerManifest.peerDependencies?.[manifest.name]
    )
      continue;
    const resolved = await realpath(
      require.resolve(`${manifest.name}/package.json`),
    );
    if (
      resolved !== (await realpath(join(frameworkRoot, name, "package.json")))
    )
      throw new Error(
        `${owner} resolves another ${manifest.name}: ${resolved}`,
      );
  }
}
console.log("DSH sources, licenses and local framework resolutions verified");
