import { build, context as esbuildContext } from "esbuild";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { watch as watchFiles } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  desktopRoot,
  frameworkRoot,
  frameworkPackages,
  readJson,
} from "./dsh-framework.mjs";

// Real workspace paths stay outside node_modules so DSH can track plugin ESM jobs.
// Dependency links in this artifact are all relative and contained in the artifact.
const output = resolve(
  desktopRoot,
  process.env.DRAMAIP_RUNTIME_BUILD ?? "build/runtime",
);
const watch = process.argv.includes("--watch");
const destinations = new Map();
const packagesByName = new Map();
const dependencyEdges = [];
const jobs = [];
const workspaceSources = [];
const sourceEntries = [];
const exportsToJs = (value) =>
  typeof value === "string"
    ? value.replace(/\.tsx?$/, ".js")
    : Array.isArray(value)
      ? value.map(exportsToJs)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, exportsToJs(v)]),
          )
        : value;
async function files(root) {
  const result = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name.startsWith(".")) continue;
    const path = join(root, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else if (item.isFile()) result.push(path);
  }
  return result;
}
async function copyChanged(source, target) {
  if (
    (await readFile(target).catch(() => undefined))?.equals(
      await readFile(source),
    )
  )
    return;
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}
async function copyConfig() {
  for (const name of ["profiles", "bundles"]) {
    for (const path of await files(join(desktopRoot, name)))
      await copyChanged(path, join(output, relative(desktopRoot, path)));
  }
  await copyChanged(
    join(desktopRoot, "cordis.yml"),
    join(output, "cordis.yml"),
  );
}
async function dependency(name, from) {
  for (let base = from; ; base = dirname(base)) {
    const path = join(base, "node_modules", name);
    if (existsSync(join(path, "package.json"))) return realpath(path);
    if (dirname(base) === base)
      throw new Error(
        `Missing Runtime dependency ${name} from ${from}; run the Desktop installer`,
      );
  }
}
async function install(source) {
  source = await realpath(source);
  if (destinations.has(source)) return destinations.get(source);
  const manifest = await readJson(join(source, "package.json"));
  const inside = (root) => {
    const path = relative(root, source);
    return (
      path !== "" &&
      !path.startsWith("..") &&
      !isAbsolute(path) &&
      !path.split(/[\\/]/).includes("node_modules")
    );
  };
  const workspace =
    inside(join(desktopRoot, "packages")) ||
    inside(join(desktopRoot, "plugins"));
  const framework = inside(frameworkRoot);
  const target = workspace
    ? join(output, relative(desktopRoot, source))
    : framework
      ? join(output, "framework", manifest.name.split("/").at(-1))
      : join(
          output,
          "node_modules/.store",
          `${manifest.name.replace("/", "+")}@${manifest.version}`,
        );
  destinations.set(source, target);
  if (!packagesByName.has(manifest.name))
    packagesByName.set(manifest.name, target);
  await mkdir(target, { recursive: true });
  if (workspace) {
    workspaceSources.push(source);
    for (const path of await files(join(source, "src"))) {
      if (
        /\.(test|spec|integration)\.[cm]?[jt]sx?$/.test(path) ||
        path.endsWith(".d.ts") ||
        path.endsWith("-test-fixture.ts")
      )
        continue;
      const out = join(target, relative(source, path));
      if (/\.tsx?$/.test(path))
        sourceEntries.push({
          in: path,
          out: relative(output, out).replace(/\.tsx?$/, ""),
        });
      else {
        await mkdir(dirname(out), { recursive: true });
        await cp(path, out);
      }
    }
    manifest.exports = exportsToJs(manifest.exports);
    delete manifest.scripts;
    delete manifest.devDependencies;
    delete manifest.bin;
    await writeFile(
      join(target, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  } else if (framework) {
    await cp(join(source, "src"), join(target, "src"), { recursive: true });
    await cp(join(source, "lib"), join(target, "lib"), { recursive: true });
    await cp(join(source, "LICENSE"), join(target, "LICENSE"));
    await cp(join(source, "package.json"), join(target, "package.json"));
  } else {
    await cp(source, target, {
      recursive: true,
      dereference: true,
      filter: (path) =>
        path === source ||
        !relative(source, path).split(/[\\/]/).includes("node_modules"),
    });
  }
  // Queue traversal to break cycles without exposing unfinished copies to callers.
  jobs.push(async () => {
    const required = { ...manifest.peerDependencies, ...manifest.dependencies };
    for (const [name] of Object.entries({
      ...required,
      ...manifest.optionalDependencies,
    })) {
      let actual;
      try {
        actual = await dependency(name, source);
      } catch (error) {
        if (
          manifest.optionalDependencies?.[name] ||
          manifest.peerDependenciesMeta?.[name]?.optional
        )
          continue;
        throw error;
      }
      const dest = await install(actual);
      dependencyEdges.push({ owner: target, name, target: dest });
    }
  });
  return target;
}
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "package.json"),
  JSON.stringify(
    {
      name: "@dramaip/runtime-distribution",
      version: (await readJson(join(desktopRoot, "package.json"))).version,
      private: true,
      type: "module",
      engines: { node: "24.18.0" },
    },
    null,
    2,
  ) + "\n",
);
await import("./check-dsh-framework.mjs");
const metadataBuild = spawnSync(
  process.execPath,
  [join(desktopRoot, "scripts/generate-plugin-manifests.ts")],
  { cwd: desktopRoot, stdio: "inherit" },
);
if (metadataBuild.status !== 0) process.exit(metadataBuild.status ?? 1);
// This is a generated artifact. Remove obsolete modules and links before a full
// build; incremental watches below preserve unchanged files and their mtimes.
for (const directory of [
  "packages",
  "plugins",
  "framework",
  "node_modules",
  "profiles",
  "bundles",
]) {
  await rm(join(output, directory), { recursive: true, force: true });
}
await install(join(desktopRoot, "packages/runtime"));
let cursor = 0;
for (; cursor < jobs.length; cursor++) await jobs[cursor]();
for (const name of frameworkPackages) {
  const source = join(frameworkRoot, name);
  if (!destinations.has(await realpath(source))) await install(source);
}
for (; cursor < jobs.length; cursor++) await jobs[cursor]();
async function linkDependency(owner, name, target) {
  const link = join(owner, "node_modules", name);
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { recursive: true, force: true });
  await symlink(relative(dirname(link), target), link, "dir");
}
// Hoist the release closure, independently of Bun's isolated development linker.
// Only version conflicts need local links. This preserves singleton modules and
// avoids directory cycles through Cordis's optional Loader/Include peer metadata.
for (const [name, target] of packagesByName)
  await linkDependency(output, name, target);
for (const edge of dependencyEdges) {
  if (packagesByName.get(edge.name) !== edge.target)
    await linkDependency(edge.owner, edge.name, edge.target);
}
const appEntry = join(desktopRoot, "apps/desktop/electron/core-runtime.ts");
sourceEntries.push({ in: appEntry, out: "core-runtime" });
await cp(join(desktopRoot, "profiles"), join(output, "profiles"), {
  recursive: true,
});
await cp(join(desktopRoot, "bundles"), join(output, "bundles"), {
  recursive: true,
});
await cp(join(desktopRoot, "cordis.yml"), join(output, "cordis.yml"));
const config = {
  entryPoints: sourceEntries,
  outdir: output,
  format: "esm",
  platform: "node",
  target: "node24",
  bundle: false,
  sourcemap: true,
  tsconfigRaw: {},
  logLevel: "warning",
};
if (watch) {
  const createBuilder = () =>
    esbuildContext({
      ...config,
      write: false,
      plugins: [
        {
          name: "runtime-metadata",
          setup(builder) {
            builder.onStart(() => {
              const generated = spawnSync(
                process.execPath,
                [join(desktopRoot, "scripts/generate-plugin-manifests.ts")],
                { cwd: desktopRoot, encoding: "utf8" },
              );
              if (generated.status !== 0)
                return {
                  errors: [
                    {
                      text:
                        generated.stderr || "Plugin metadata generation failed",
                    },
                  ],
                };
            });
            builder.onEnd(async (result) => {
              if (result.errors.length) return;
              for (const file of result.outputFiles ?? []) {
                const data = Buffer.from(file.contents);
                if (
                  (await readFile(file.path).catch(() => undefined))?.equals(
                    data,
                  )
                )
                  continue;
                await mkdir(dirname(file.path), { recursive: true });
                await writeFile(file.path, data);
              }
              await copyChanged(
                join(
                  desktopRoot,
                  "packages/runtime/src/plugin-manifests.generated.json",
                ),
                join(
                  output,
                  "packages/runtime/src/plugin-manifests.generated.json",
                ),
              );
              await copyConfig();
            });
          },
        },
      ],
    });
  let builder = await createBuilder();
  let timer;
  let entryQueue = Promise.resolve();
  const watchers = ["profiles", "bundles", "cordis.yml"].map((name) =>
    watchFiles(join(desktopRoot, name), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void copyConfig().catch(console.error), 100);
    }),
  );
  // esbuild watches existing entry points. Add/remove events rebuild that list
  // so newly imported plugin modules are also emitted with their own ESM boundary.
  for (const source of workspaceSources)
    watchers.push(
      watchFiles(join(source, "src"), { recursive: true }, (event) => {
        if (event !== "rename") return;
        entryQueue = entryQueue
          .then(async () => {
            const next = [{ in: appEntry, out: "core-runtime" }];
            for (const workspace of workspaceSources)
              for (const path of await files(join(workspace, "src"))) {
                if (
                  !/\.tsx?$/.test(path) ||
                  /\.(test|spec|integration)\.[cm]?[jt]sx?$/.test(path) ||
                  path.endsWith(".d.ts") ||
                  path.endsWith("-test-fixture.ts")
                )
                  continue;
                next.push({
                  in: path,
                  out: relative(desktopRoot, path).replace(/\.tsx?$/, ""),
                });
              }
            const keys = (entries) =>
              entries
                .map((entry) => entry.in)
                .sort()
                .join("\n");
            if (keys(next) === keys(config.entryPoints)) return;
            await builder.dispose();
            for (const previous of config.entryPoints)
              if (!next.some((entry) => entry.in === previous.in)) {
                await rm(join(output, previous.out + ".js"), { force: true });
                await rm(join(output, previous.out + ".js.map"), {
                  force: true,
                });
              }
            config.entryPoints = next;
            builder = await createBuilder();
            await builder.rebuild();
            await builder.watch();
          })
          .catch(console.error);
      }),
    );
  await builder.rebuild();
  await builder.watch();
  console.log(`Watching ${sourceEntries.length} Runtime modules in ${output}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      void builder.dispose().then(() => process.exit(0));
    });
} else {
  await build(config);
  console.log(
    `Built ${sourceEntries.length} ESM modules and ${destinations.size} local dependency packages in ${output}`,
  );
}
