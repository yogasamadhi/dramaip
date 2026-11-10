import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";

/** Keep existing UI preferences when Electron moves into the config home.
 * OS-encrypted cookies/Local State and disposable caches are not imported.
 * Each entry is staged before publication; existing new preferences win. */
export function copyElectronPreferences(
  previous: string,
  directory: string,
): void {
  if (resolve(previous) === resolve(directory)) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of [
    "Local Storage",
    "Session Storage",
    "IndexedDB",
    "Preferences",
  ]) {
    const source = join(previous, name);
    const target = join(directory, name);
    if (!existsSync(source) || existsSync(target)) continue;
    const temporary = join(directory, `.preferences-${randomUUID()}`);
    try {
      cpSync(source, temporary, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: (path) => basename(path) !== "LOCK",
      });
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
