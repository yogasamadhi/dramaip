// The shipped Desktop Host runtime and its manifest, `desktop-runtime.json`.
//
// The runtime build writes the manifest at the root of the release closure: the
// Host entry the Electron shell starts, the safe overlay it offers after a
// crash, the version it belongs to, and a digest over every file and link in
// the closure. The release check verifies a packaged copy against it; the shell
// reads it to find the Host and refuses a runtime of another version.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export const DESKTOP_RUNTIME_MANIFEST = "desktop-runtime.json";

/** Paths in the closure that are local build state, not part of the release. */
const volatile = (name) =>
  name === DESKTOP_RUNTIME_MANIFEST ||
  name === ".watch-state.json" ||
  name.startsWith(".last-good.json");

/** Every file and link of a closure, in a stable order; links are not followed. */
async function entries(root, prefix = "") {
  const result = [];
  const items = await readdir(join(root, prefix), { withFileTypes: true });
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const item of items) {
    if (!prefix && volatile(item.name)) continue;
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink())
      result.push({ path, link: await readlink(absolute) });
    else if (stat.isDirectory()) result.push(...(await entries(root, path)));
    else if (stat.isFile()) result.push({ path, file: absolute });
    else throw new Error(`desktop runtime: ${path} is not a file or link`);
  }
  return result;
}

/** The digest and file count of a closure. */
export async function digestDesktopRuntime(root) {
  const hash = createHash("sha256");
  let files = 0;
  let links = 0;
  for (const entry of await entries(root)) {
    if (entry.link !== undefined) {
      links += 1;
      hash.update(`link\0${entry.path}\0${entry.link}\n`);
    } else {
      files += 1;
      const content = createHash("sha256")
        .update(await readFile(entry.file))
        .digest("hex");
      hash.update(`file\0${entry.path}\0${content}\n`);
    }
  }
  return { files, links, sha256: hash.digest("hex") };
}

/**
 * Write the manifest of a built closure.
 * @param root - the closure.
 * @param facts - version, Host entry and safe overlay, relative to the root.
 */
export async function writeDesktopRuntimeManifest(root, facts) {
  const manifest = {
    schemaVersion: 1,
    version: facts.version,
    entry: facts.entry,
    safeOverlay: facts.safeOverlay,
    ...(facts.release ? { release: true, target: facts.target } : {}),
    ...(await digestDesktopRuntime(root)),
  };
  await writeFile(
    join(root, DESKTOP_RUNTIME_MANIFEST),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

/**
 * Verify a closure against its manifest.
 * @param root - the closure, built or packaged.
 * @param version - the application version it must belong to.
 * @returns the manifest and every problem found; valid when there are none.
 */
export async function verifyDesktopRuntime(root, version) {
  const problems = [];
  const path = join(root, DESKTOP_RUNTIME_MANIFEST);
  if (!existsSync(path))
    return { manifest: undefined, problems: ["MANIFEST_MISSING"] };
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { manifest: undefined, problems: ["MANIFEST_UNREADABLE"] };
  }
  if (manifest.schemaVersion !== 1) problems.push("MANIFEST_SCHEMA");
  if (manifest.version !== version) problems.push("VERSION_MISMATCH");
  for (const key of ["entry", "safeOverlay"])
    if (
      typeof manifest[key] !== "string" ||
      !existsSync(join(root, manifest[key]))
    )
      problems.push(`${key.toUpperCase()}_MISSING`);
  const actual = await digestDesktopRuntime(root);
  if (
    actual.sha256 !== manifest.sha256 ||
    actual.files !== manifest.files ||
    actual.links !== manifest.links
  )
    problems.push("DIGEST_MISMATCH");
  return { manifest, actual, problems };
}
