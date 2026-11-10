// Release-only transformations of generated artifacts. Source packages and
// development/watch artifacts keep their original modules and diagnostics.
import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Generated output must not overlap sources that a full build clears/copies. */
export function assertRuntimeOutput(output, desktop, framework) {
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return (
      path === "" ||
      (path !== ".." &&
        !path.startsWith("../") &&
        !path.startsWith("..\\") &&
        !isAbsolute(path))
    );
  };
  const sources = [
    framework,
    ...[
      "apps",
      "packages",
      "scripts",
      "profiles",
      "bundles",
      "node_modules",
    ].map((name) => join(desktop, name)),
  ];
  if (
    contains(output, desktop) ||
    sources.some(
      (source) => contains(source, output) || contains(output, source),
    )
  )
    throw new Error(
      `Runtime output overlaps protected project sources: ${output}`,
    );
}

const testDirectories = new Set([
  "test",
  "tests",
  "__tests__",
  "__mocks__",
  "benchmark",
  "benchmarks",
  ".github",
  ".yarn",
  ".git",
  ".changeset",
  ".husky",
]);

/** Retain runtime data and license files; select native assets for this build. */
export function releaseFileAllowed(
  path,
  { name, platform = process.platform, arch = process.arch } = {},
) {
  const parts = path.split(/[\\/]/u);
  const file = parts.at(-1);
  if (
    file === ".DS_Store" ||
    file === ".watch-state.json" ||
    file.startsWith(".last-good.json")
  )
    return false;
  if (/\.(?:map|pdb|tsbuildinfo)$/u.test(file) || /\.d\.[cm]?ts$/u.test(file))
    return false;
  if (/\.(?:test|spec|integration)\.[cm]?[jt]sx?$/u.test(file)) return false;
  if (name && parts.some((part) => testDirectories.has(part))) return false;
  if (/\.test-d\.[cm]?ts$/u.test(file)) return false;
  // These packages publish their compiled implementations separately. Their
  // source/development conditions are not selected by the installed Host.
  if (name === "zod" && parts[0] === "src") return false;
  if (name === "ajv" && parts[0] === "lib") return false;
  if (name === "node-pty") {
    if (
      parts[0] === "prebuilds" &&
      parts.length > 1 &&
      parts[1] !== `${platform}-${arch}`
    )
      return false;
    if (parts[0] === "third_party") {
      if (platform !== "win32") return false;
      if (
        parts.some(
          (part) =>
            /^win\d+-(?:x64|arm64)$/u.test(part) && !part.endsWith(`-${arch}`),
        )
      )
        return false;
    }
  }
  return true;
}

/** Validate package-owned private bundle entries before editing its release manifest. */
export function privateRuntimeBundles(manifest) {
  const result = [];
  for (const [entry, dependencies] of Object.entries(
    manifest.dramaip?.release?.bundles ?? {},
  )) {
    if (
      !/^(?:src|handlers)\/.+\.ts$/u.test(entry) ||
      entry.split("/").includes("..") ||
      isAbsolute(entry)
    )
      throw new Error(
        `${manifest.name}: invalid private runtime bundle ${entry}`,
      );
    if (!Array.isArray(dependencies) || !dependencies.length)
      throw new Error(
        `${manifest.name}: ${entry} must name its bundled dependencies`,
      );
    for (const name of dependencies) {
      const version = manifest.dependencies?.[name];
      if (
        !version ||
        version.startsWith("workspace:") ||
        /^@(?:dramaip|deepseek-ai)\//u.test(name)
      )
        throw new Error(
          `${manifest.name}: ${entry} may only bundle declared third-party dependencies (${name})`,
        );
    }
    result.push({ entry, dependencies });
  }
  return result;
}

/** Compile a private Engine's implementation while keeping all Host plugin boundaries external. */
export async function bundlePrivateRuntime(source, target, root) {
  const result = await build({
    entryPoints: [source],
    outfile: target,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    minify: true,
    keepNames: true,
    sourcemap: false,
    legalComments: "eof",
    metafile: true,
    external: ["@dramaip/*", "@deepseek-ai/*"],
    banner: {
      js: 'import { createRequire as __privateRuntimeRequire } from "node:module"; const require = __privateRuntimeRequire(import.meta.url);',
    },
  });
  for (const output of Object.values(result.metafile.outputs))
    for (const imported of output.imports)
      if (
        imported.external &&
        !isBuiltin(imported.path) &&
        !/^@(?:dramaip|deepseek-ai)\//u.test(imported.path)
      )
        throw new Error(
          `Private runtime bundle left an unresolved dependency: ${imported.path}`,
        );

  // Keep the licenses of actual bundled inputs, even though their npm directories
  // no longer enter the release closure. This also records exact bundled versions.
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    let directory = dirname(resolve(input));
    let manifest;
    for (;;) {
      if (existsSync(join(directory, "package.json"))) {
        const candidate = JSON.parse(
          await readFile(join(directory, "package.json"), "utf8"),
        );
        // Packages such as Zod put type-only package.json files inside their
        // export directories. License ownership belongs to the named npm root.
        if (candidate.name && candidate.version) {
          manifest = candidate;
          break;
        }
      }
      const parent = dirname(directory);
      if (directory === parent)
        throw new Error(`No owning package for bundled input ${input}`);
      directory = parent;
    }
    if (manifest.name?.startsWith("@dramaip/")) continue;
    packages.set(`${manifest.name}@${manifest.version}`, {
      directory,
      manifest,
    });
  }
  const notices = join(root, "third-party-notices", "bundled");
  const inventory = [];
  for (const [id, { directory, manifest }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const destination = join(notices, id.replaceAll("/", "+"));
    const entries = await readdir(directory);
    let licenses = entries.filter((name) =>
      /^(?:licen[cs]es?|notice|copying)(?:\.|$)/iu.test(name),
    );
    // Some published SDK packages provide only SPDX metadata and a README.
    // Redistribute that original information instead of inventing a license file.
    if (!licenses.length)
      licenses = entries.filter((name) => /^readme(?:\.|$)/iu.test(name));
    await mkdir(destination, { recursive: true });
    for (const name of licenses)
      await cp(join(directory, name), join(destination, name), {
        recursive: true,
      });
    await writeFile(
      join(destination, "package.json"),
      JSON.stringify(
        {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license,
          author: manifest.author,
          repository: manifest.repository,
        },
        null,
        2,
      ) + "\n",
    );
    inventory.push({
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
      files: licenses,
    });
  }
  await mkdir(notices, { recursive: true });
  const label = createHash("sha256")
    .update(relative(root, target))
    .digest("hex")
    .slice(0, 12);
  await writeFile(
    join(notices, `${label}.json`),
    JSON.stringify(
      { entry: relative(root, target), dependencies: inventory },
      null,
      2,
    ) + "\n",
  );
  return inventory;
}

/** Minify first-party/framework JS without merging modules or changing export/property names. */
export async function optimizeRuntimeJavaScript(root) {
  const files = [];
  async function walk(directory) {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules")
        await walk(path);
      else if (entry.isFile() && /\.[cm]?js$/u.test(entry.name))
        files.push(path);
    }
  }
  for (const name of ["apps", "packages", "framework"])
    await walk(join(root, name));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const path = files[cursor++];
        if (!path) return;
        const { code } = await transform(await readFile(path, "utf8"), {
          loader: "js",
          target: /[\\/]lib[\\/]client\.js$/u.test(path) ? "es2022" : "node24",
          minify: true,
          // Typert files contain generated schema factories, not plugin/service
          // implementations. Their internal variable names carry no wire identity.
          keepNames:
            !/[\\/]lib[\\/]typert\.(?:host|remote-client)\.[cm]?js$/u.test(
              path,
            ),
          legalComments: "eof",
          sourcefile: relative(root, path),
        });
        await writeFile(path, code);
      }
    }),
  );
  return files.length;
}
