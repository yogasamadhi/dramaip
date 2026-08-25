import { describe, expect, test } from "bun:test";

import {
  assertBunVersion,
  REQUIRED_BUN_VERSION,
  runtimeSpecs,
} from "../../../../run-desktop";

describe("desktop launcher toolchain", () => {
  test("requires Bun 1.4.0 exactly and has no system Node fallback", () => {
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

    expect(labels).toContain("Codex 0.147.0");
    expect(labels).toContain("Pi 0.84.2");
    expect(labels.some((label) => label.includes("DeepSeek"))).toBe(false);
    expect(buildScripts).not.toContain("build:dsh");
  });
});
