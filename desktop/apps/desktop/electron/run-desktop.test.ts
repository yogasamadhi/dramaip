import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import {
  assertNodeVersion,
  assertPnpmVersion,
  REQUIRED_NODE_VERSION,
  REQUIRED_PNPM_VERSION,
  runtimeSpecs,
  vendorSubmoduleSpecs,
} from "../../../../run-desktop";

describe("desktop launcher toolchain", () => {
  test("requires Node 24.18.0 and pnpm 11.28.5 exactly for Desktop tooling", () => {
    expect(assertNodeVersion(REQUIRED_NODE_VERSION)).toBe("24.18.0");
    expect(() => assertNodeVersion("24.17.0")).toThrow(/恰好为 24\.18\.0/u);
    expect(() => assertNodeVersion("24.19.0")).toThrow(/恰好为 24\.18\.0/u);
    expect(() => assertNodeVersion(undefined)).toThrow(/非 Node 运行时/u);

    expect(assertPnpmVersion(REQUIRED_PNPM_VERSION)).toBe("11.28.5");
    expect(() => assertPnpmVersion("11.22.0")).toThrow(/恰好为 11\.28\.5/u);
    expect(() => assertPnpmVersion("11.28.6")).toThrow(/恰好为 11\.28\.5/u);
    expect(() => assertPnpmVersion(undefined)).toThrow(/未安装 pnpm/u);
  });
});

describe("desktop launcher engine runtimes", () => {
  test("only prepares active engines", () => {
    const runtimes = runtimeSpecs();
    const labels = runtimes.map((runtime) => runtime.label);
    const buildScripts = runtimes.map((runtime) => runtime.buildScript);

    expect(labels).toContain("Codex 0.164.0");
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

    expect(commonPaths).toContain("vendor/codex-rust");
    expect(commonPaths).toContain("vendor/pi");
    expect(commonPaths).toContain("vendor/deepseek-harness");
    expect(commonPaths).not.toContain("vendor/opencode");
    expect(commonPaths).not.toContain("vendor/grok-build");
  });

  test("keeps read-only reference sources outside the pnpm workspace", () => {
    const workspace = readFileSync(
      new URL("../../../pnpm-workspace.yaml", import.meta.url),
      "utf8",
    );
    const kernelManifest = JSON.parse(
      readFileSync(
        new URL("../../../packages/kernel/package.json", import.meta.url),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };

    expect(workspace).not.toContain("vendor/");
    expect(workspace).toContain("build/dsh-framework/*");
    expect(kernelManifest.dependencies["@deepseek-ai/cordis"]).toBe(
      "workspace:*",
    );
  });
});
