import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import {
  desktopRoot,
  frameworkPackages,
  frameworkRoot,
  readJson,
  sourceFiles,
  sourceRoot,
} from "./dsh-framework.mjs";

const paths = {};
for (const name of frameworkPackages) {
  const manifest = await readJson(join(frameworkRoot, name, "package.json"));
  paths[manifest.name] = [`./${name}/src/index.ts`];
}
const tsconfig = join(frameworkRoot, "tsconfig.json");
const base = {
  target: "ES2024",
  module: "ESNext",
  moduleResolution: "Bundler",
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: true,
  declaration: true,
  declarationMap: true,
  composite: true,
  sourceMap: true,
  types: ["node"],
  paths,
};
await writeFile(
  join(frameworkRoot, "tsconfig.base.json"),
  JSON.stringify({ compilerOptions: base }, null, 2),
);
for (const name of frameworkPackages) {
  const config = await readJson(
    join(sourceRoot, "vendor", name, "tsconfig.json"),
  );
  config.extends = "../tsconfig.base.json";
  await writeFile(
    join(frameworkRoot, name, "tsconfig.json"),
    JSON.stringify(config, null, 2),
  );
}
await writeFile(
  tsconfig,
  JSON.stringify(
    {
      files: [],
      references: frameworkPackages.map((name) => ({ path: `./${name}` })),
    },
    null,
    2,
  ),
);
const tsc = spawnSync(
  process.execPath,
  [join(desktopRoot, "node_modules/typescript/bin/tsc"), "-b", tsconfig],
  { stdio: "inherit" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
for (const name of frameworkPackages) {
  const root = join(frameworkRoot, name);
  await mkdir(join(root, "lib/types"), { recursive: true });
  const entries = name === "logger-console" ? ["index", "browser"] : ["index"];
  for (const entry of entries) {
    const formats = name === "schemastery" ? ["esm", "cjs"] : ["esm"];
    for (const format of formats)
      await build({
        entryPoints: [join(root, "lib/types", `${entry}.js`)],
        bundle: true,
        packages: "external",
        platform:
          name === "logger-console" && entry === "browser" ? "browser" : "node",
        format,
        target: "node24",
        sourcemap: true,
        // Do not bundle a second Cordis/Cosmokit through tsconfig source aliases.
        tsconfigRaw: {},
        outfile: join(
          root,
          "lib",
          `${entry}.${name === "schemastery" ? (format === "esm" ? "mjs" : "cjs") : "js"}`,
        ),
      });
  }
}
await writeFile(
  join(frameworkRoot, "build.json"),
  JSON.stringify(
    await sourceFiles(
      frameworkRoot,
      new Set(["node_modules", ".types", "build.json"]),
    ),
    null,
    2,
  ),
);
console.log(
  "Built nine DSH framework packages from the pinned source snapshot",
);
