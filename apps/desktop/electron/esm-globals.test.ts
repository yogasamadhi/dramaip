import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The main bundle is ESM. electron-vite only defines `__dirname`,
 * `__filename` and `require` through a shim it inserts after the last text
 * that looks like a static import, and a bundled dependency's doc comment can
 * hold that text, which leaves the shim inside the comment. Main-process code
 * therefore uses `import.meta.dirname` / `import.meta.filename` directly.
 */
const electronRoot = import.meta.dirname;
const commonJsGlobal = /(?<![\w$.])(?:__dirname|__filename)(?![\w$])/u;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("main-process ESM globals", () => {
  test("no main-process source relies on the CommonJS shim", () => {
    const offenders = sources(electronRoot).filter((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .some((line) => commonJsGlobal.test(line)),
    );
    expect(offenders.map((path) => relative(electronRoot, path))).toEqual([]);
  });
});
