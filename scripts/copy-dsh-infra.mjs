// Copies DSH component packages into app-owned infrastructure packages
// (REFACTOR_PLAN_DSH_LEVEL2 §2, baseline §1.3). DSH is MIT: every copy keeps
// DSH's copyright and license, and records its source path and version in
// the package manifest (`dramaip.copiedFrom`) and THIRD_PARTY_NOTICES.md.
//
// The copy is a one-shot starting point, not a sync: after copying, the
// package is adapted by hand (DSH product content replaced by DramaIP's) and
// owned by DramaIP. The tool refuses to overwrite an existing package.
//
//   node scripts/copy-dsh-infra.mjs <name>...     names from packages/infra/sources.json
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dsh = resolve(desktop, "vendor/deepseek-harness");
const infra = join(desktop, "packages/infra");
const sources = JSON.parse(await readFile(join(infra, "sources.json"), "utf8"));
const lock = JSON.parse(
  await readFile(resolve(desktop, "vendor/deepseek-harness.lock.json"), "utf8"),
);

// Copies version with the Desktop workspace, like every other package in it.
const desktopVersion = JSON.parse(
  await readFile(join(desktop, "package.json"), "utf8"),
).version;

/** `@deepseek-ai/dsh-<x>` → `@dramaip/infra-<name>` for every listed package. */
const renames = new Map(
  Object.entries(sources.packages).map(([name, entry]) => [
    entry.dsh,
    `@dramaip/infra-${name}`,
  ]),
);
const framework = new Set(sources.framework);

function renameSpecifiers(source) {
  return source.replace(
    /@deepseek-ai\/(dsh-[a-z0-9-]+)/gu,
    (specifier, name) => renames.get(`@deepseek-ai/${name}`) ?? specifier,
  );
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}

/**
 * Maps DSH package references onto the workspace. A dependency on a DSH
 * package that is not copied is dropped and reported when the copied sources
 * never import it (dev-only or stale manifest entries; tests are adapted by
 * hand); a source import of one is an error.
 */
function rewriteDependencies(
  dependencies = {},
  dropped,
  sourceText,
  adapt = [],
) {
  const result = {};
  for (const [name, range] of Object.entries(dependencies)) {
    if (renames.has(name)) result[renames.get(name)] = "workspace:*";
    else if (framework.has(name)) result[name] = "workspace:*";
    else if (name.startsWith("@deepseek-ai/")) {
      if (
        !adapt.includes(name) &&
        (sourceText.includes(`'${name}`) || sourceText.includes(`"${name}`))
      )
        throw new Error(
          `${name} is imported by the sources but is neither a framework package nor listed in sources.json`,
        );
      if (!dropped.includes(name)) dropped.push(name);
    } else result[name] = range;
  }
  return Object.keys(result).length ? result : undefined;
}

const sourceOf = (types) =>
  types.replace("./lib/types/", "./src/").replace(/\.d\.ts$/u, ".ts");

/**
 * DSH exports point at built `lib/`; the copies export their sources, except
 * for build outputs a source file cannot stand in for: the browser bundle
 * `./client` (served under /plugins; its types come from source) and the
 * generated Typert artifacts (`lib/typert.*`).
 */
function sourceExports(exports = {}, from) {
  const result = {};
  for (const [key, target] of Object.entries(exports)) {
    if (key === "./src/*" || key === "./package.json") result[key] = target;
    else if (typeof target === "string") {
      // Data files: locale dictionaries and stylesheets are copied, bundle
      // patches are not.
      if (target.startsWith("./locale/")) result[key] = target;
      else if (target.startsWith("./lib/") && target.endsWith(".css")) {
        const source = target.replace("./lib/", "./src/");
        if (!existsSync(join(from, source)))
          throw new Error(`export ${key} has no source at ${source}`);
        result[key] = source;
      }
    } else if (target.types?.startsWith("./lib/typert.")) result[key] = target;
    else {
      const types = target.types;
      if (!types?.startsWith("./lib/types/"))
        throw new Error(`export ${key} has no lib/types entry`);
      result[key] =
        key === "./client"
          ? { types: sourceOf(types), default: target.default }
          : sourceOf(types);
    }
  }
  return result;
}

const names = process.argv.slice(2);
if (names.length === 0) throw new Error("name at least one package");
const notices = [];
for (const name of names) {
  const entry = sources.packages[name];
  if (!entry) throw new Error(`${name} is not listed in sources.json`);
  const from = join(dsh, entry.from);
  const to = join(infra, name);
  if (existsSync(to))
    throw new Error(`${relative(desktop, to)} already exists`);
  await mkdir(to, { recursive: true });
  try {
    for (const part of ["src", "tests", "locale", "scripts"])
      if (existsSync(join(from, part)))
        await cp(join(from, part), join(to, part), { recursive: true });
    for (const path of await files(to))
      if (/\.(?:[cm]?[jt]sx?|json|ya?ml|css)$/u.test(path))
        await writeFile(path, renameSpecifiers(await readFile(path, "utf8")));

    const upstream = JSON.parse(
      await readFile(join(from, "package.json"), "utf8"),
    );
    const dropped = [];
    const sourceText = (
      await Promise.all(
        (existsSync(join(from, "src"))
          ? await files(join(from, "src"))
          : []
        ).map((path) => readFile(path, "utf8")),
      )
    ).join("\n");
    const manifest = {
      name: `@dramaip/infra-${name}`,
      description: upstream.description,
      version: desktopVersion,
      private: true,
      license: "MIT",
      type: "module",
      exports: sourceExports(upstream.exports, from),
      peerDependencies: rewriteDependencies(
        upstream.peerDependencies,
        dropped,
        sourceText,
        entry.adapt,
      ),
      dependencies: rewriteDependencies(
        upstream.dependencies,
        dropped,
        sourceText,
        entry.adapt,
      ),
      devDependencies: rewriteDependencies(
        upstream.devDependencies,
        dropped,
        sourceText,
        entry.adapt,
      ),
      dramaip: {
        copiedFrom: {
          repository: "vendor/deepseek-harness",
          path: entry.from,
          package: upstream.name,
          version: lock.version,
        },
      },
    };
    await writeFile(
      join(to, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await writeFile(
      join(to, "tsconfig.json"),
      `${JSON.stringify(
        {
          extends: "../tsconfig.base.json",
          include: ["src", "tests"],
        },
        null,
        2,
      )}\n`,
    );
    await cp(join(dsh, "LICENSE"), join(to, "LICENSE"));
    await writeFile(
      join(to, "NOTICE"),
      [
        `@dramaip/infra-${name}`,
        "",
        `Copied from ${upstream.name} ${lock.version} (${entry.from}) of`,
        "DeepSeek Harness, MIT License, Copyright (c) 2026 DeepSeek; see LICENSE.",
        "Adapted for DramaIP: package names, product content and integration.",
        "",
      ].join("\n"),
    );
    notices.push(
      `| \`@dramaip/infra-${name}\` | \`${upstream.name}\` | \`${entry.from}\` |`,
    );
    process.stdout.write(
      `copied ${upstream.name} → @dramaip/infra-${name}${
        dropped.length
          ? ` (DSH dependencies dropped: ${dropped.join(", ")})`
          : ""
      }\n`,
    );
  } catch (error) {
    await rm(to, { recursive: true, force: true });
    throw error;
  }
}
process.stdout.write(
  `\nTHIRD_PARTY_NOTICES.md rows (DSH ${lock.version}):\n${notices.join("\n")}\n`,
);
