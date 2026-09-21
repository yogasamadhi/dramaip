import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const desktopRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const sourceRoot = join(desktopRoot, "vendor/deepseek-harness");
export const frameworkRoot = join(desktopRoot, "build/dsh-framework");
export const frameworkPackages = [
  "cosmokit",
  "cordis",
  "loader",
  "include",
  "group",
  "schemastery",
  "timer",
  "hmr",
  "logger-console",
];
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));

export async function sourceFiles(root, excluded = new Set(), relative = "") {
  const files = [];
  for (const entry of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.name === ".git" || excluded.has(entry.name) || excluded.has(path))
      continue;
    if (entry.isDirectory())
      files.push(...(await sourceFiles(root, excluded, path)));
    else if (
      entry.name !== ".DS_Store" &&
      !entry.name.endsWith(".tsbuildinfo")
    ) {
      const bytes = entry.isSymbolicLink()
        ? Buffer.from(`link:${await readlink(join(root, path))}`)
        : await readFile(join(root, path));
      files.push({ path, sha256: sha256(bytes) });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function verifyDshSource() {
  const lock = await readJson(
    join(desktopRoot, "vendor/deepseek-harness.lock.json"),
  );
  const manifest = await readJson(join(sourceRoot, "package.json"));
  if (
    manifest.version !== lock.version ||
    manifest.packageManager !== lock.packageManager ||
    manifest.license !== lock.license
  )
    throw new Error("DSH source manifest differs from the pinned snapshot");
  if (
    sha256(await readFile(join(sourceRoot, lock.lockfile))) !==
    lock.pnpmLockSha256
  )
    throw new Error("DSH source lockfile checksum mismatch");
  const files = await sourceFiles(
    sourceRoot,
    new Set(lock.excludedDirectories),
  );
  const digest = sha256(
    files.map((file) => `${file.path}\0${file.sha256}\n`).join(""),
  );
  if (
    files.length !== lock.sourceTreeFileCount ||
    digest !== lock.sourceTreeSha256
  )
    throw new Error(
      "DSH source tree checksum mismatch; do not modify the vendor snapshot",
    );
  return digest;
}

export async function frameworkManifest(name) {
  const original = await readJson(
    join(sourceRoot, "vendor", name, "package.json"),
  );
  const manifest = { ...original, private: true };
  delete manifest.scripts;
  delete manifest.devDependencies;
  delete manifest.bin;
  // The source packages keep DSH's publication exports. Runtime dependencies
  // among this closure must resolve to one generated local workspace instance.
  for (const section of ["dependencies", "peerDependencies"]) {
    if (!manifest[section]) continue;
    manifest[section] = { ...manifest[section] };
    for (const [id, range] of Object.entries(manifest[section])) {
      if (String(range).startsWith("workspace:"))
        manifest[section][id] = "workspace:*";
    }
  }
  return manifest;
}
