import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  assertBunVersion,
  REQUIRED_BUN_VERSION,
  runtimeSpecs,
  vendorSubmoduleSpecs,
} from "../../../../run-desktop";

describe("desktop launcher toolchain", () => {
  test("requires Bun 1.4.0 exactly for Desktop tooling", () => {
    expect(assertBunVersion(REQUIRED_BUN_VERSION)).toBe("1.4.0");
    expect(() => assertBunVersion("1.3.14")).toThrow(/恰好为 1\.4\.0/u);
    expect(() => assertBunVersion("1.4.1")).toThrow(/恰好为 1\.4\.0/u);
    expect(() => assertBunVersion(undefined)).toThrow(/非 Bun 运行时/u);
  });
});

describe("desktop launcher engine runtimes", () => {
  test("only prepares active engines", () => {
    const runtimes = runtimeSpecs();
    const labels = runtimes.map((runtime) => runtime.label);
    const buildScripts = runtimes.map((runtime) => runtime.buildScript);

    expect(labels).toContain("Codex 0.163.0");
    expect(labels).toContain("Pi 1.4.0");
    expect(labels.some((label) => label.includes("Grok Build"))).toBe(false);
    expect(labels.some((label) => label.includes("DeepSeek"))).toBe(false);
    expect(buildScripts).not.toContain("build:dsh");
  });
});

describe("desktop launcher vendor sources", () => {
  test("initializes active engines and the pinned DSH framework source", () => {
    const commonPaths = vendorSubmoduleSpecs().map(
      (submodule) => submodule.path,
    );

    expect(commonPaths).toContain("desktop/vendor/codex-rust");
    expect(commonPaths).toContain("desktop/vendor/pi");
    expect(commonPaths).toContain("desktop/vendor/deepseek-harness");
    expect(commonPaths).not.toContain("desktop/vendor/opencode");
    expect(commonPaths).not.toContain("desktop/vendor/grok-build");
  });

  test("keeps read-only reference sources outside the Bun workspace", () => {
    const desktopManifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { workspaces: string[] };
    const kernelManifest = JSON.parse(
      readFileSync(
        new URL("../../../packages/kernel/package.json", import.meta.url),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };

    expect(
      desktopManifest.workspaces.some((workspace) =>
        workspace.startsWith("vendor/"),
      ),
    ).toBe(false);
    expect(desktopManifest.workspaces).toContain("build/dsh-framework/*");
    expect(kernelManifest.dependencies["@deepseek-ai/cordis"]).toBe(
      "workspace:*",
    );
  });
});
