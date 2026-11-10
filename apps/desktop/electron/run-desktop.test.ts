import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The desktop launcher is a pnpm script (`pnpm run dev`), so this Node
 * workspace drives its helpers as a black box through a short Node probe.
 */
const launcher = fileURLToPath(
  new URL("../../../scripts/prepare-dev-environment.mjs", import.meta.url),
);

function probe<T>(expression: string): T {
  const script = [
    `const launcher = await import(${JSON.stringify(launcher)});`,
    `console.log(JSON.stringify(${expression}));`,
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as T;
}

function rejects(call: string): string {
  const script = [
    `const launcher = await import(${JSON.stringify(launcher)});`,
    `${call};`,
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
  return `${result.stdout}${result.stderr}`;
}

describe("desktop launcher toolchain", () => {
  test("requires Node 24.18.0 and pnpm 11.28.5 exactly for Desktop tooling", () => {
    expect(
      probe<string[]>(
        "[launcher.assertNodeVersion(launcher.REQUIRED_NODE_VERSION), launcher.assertPnpmVersion(launcher.REQUIRED_PNPM_VERSION)]",
      ),
    ).toEqual(["24.18.0", "11.28.5"]);
    expect(rejects("launcher.assertNodeVersion('24.17.0')")).toMatch(
      /恰好为 24\.18\.0/u,
    );
    expect(rejects("launcher.assertNodeVersion(undefined)")).toMatch(
      /非 Node 运行时/u,
    );
    expect(rejects("launcher.assertPnpmVersion('11.28.6')")).toMatch(
      /恰好为 11\.28\.5/u,
    );
    expect(rejects("launcher.assertPnpmVersion(undefined)")).toMatch(
      /未安装 pnpm/u,
    );
  });
});

describe("desktop launcher engine runtimes", () => {
  test("only prepares active engines", () => {
    const labels = probe<string[]>(
      "launcher.runtimeSpecs().map((runtime) => runtime.label)",
    );
    expect(labels).toEqual(["Pi 1.5.0"]);
  });
});

describe("desktop launcher vendor sources", () => {
  test("initializes active engines and the pinned DSH framework source", () => {
    const paths = probe<string[]>(
      "launcher.vendorSubmoduleSpecs().map((submodule) => submodule.path)",
    );
    expect(paths).toEqual(["vendor/deepseek-harness", "vendor/pi"]);
  });

  test("keeps read-only reference sources outside the pnpm workspace", () => {
    const workspace = readFileSync(
      new URL("../../../pnpm-workspace.yaml", import.meta.url),
      "utf8",
    );
    expect(workspace).not.toContain("vendor/");
    expect(workspace).toContain("build/dsh-framework/*");
  });
});
