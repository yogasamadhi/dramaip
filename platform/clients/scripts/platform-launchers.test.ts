import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The root launchers are Python entry points, so this Node workspace drives
 * them as black boxes. The in-process unit coverage of the launcher helpers
 * lives in the repository-level `tests/` Python suite; this suite keeps the
 * platform client CI parity gate green and verifies the observable contract
 * a caller depends on: option surface, exit codes and clean diagnostics.
 */
const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const python = process.env.DRAMAIP_PYTHON ?? "python3";

function runLauncher(
  script: string,
  arguments_: string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(python, [join(repositoryRoot, script), ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("root launcher entry points", () => {
  test("keeps the root directory free of TypeScript launchers", () => {
    const rootScripts = readdirSync(repositoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^run-.*\.ts$/.test(name));
    expect(rootScripts).toEqual([]);
  });

  test("compiles every root launcher as valid Python", () => {
    const launchers = ["run-desktop.py", "run-platform-clients.py", "run-platform-dev.py"];
    for (const launcher of launchers) {
      const result = spawnSync(
        python,
        ["-m", "py_compile", join(repositoryRoot, launcher)],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      expect(result.status, `${launcher}: ${result.stderr}`).toBe(0);
    }
  });

  test("documents the desktop launcher options", () => {
    const result = runLauncher("run-desktop.py", ["--help"]);
    expect(result.status).toBe(0);
    for (const option of ["--install", "--rebuild-engines", "--check"]) {
      expect(result.stdout).toContain(option);
    }
  });

  test("documents the platform client launcher options", () => {
    const result = runLauncher("run-platform-clients.py", ["--help"]);
    expect(result.status).toBe(0);
    for (const option of [
      "--install",
      "--no-install",
      "--no-kill-ports",
      "--api-base-url",
      "--mobile-target",
    ]) {
      expect(result.stdout).toContain(option);
    }
  });

  test("documents the platform development launcher options", () => {
    const result = runLauncher("run-platform-dev.py", ["--help"]);
    expect(result.status).toBe(0);
    for (const option of [
      "--skip-package",
      "--no-infra",
      "--obs",
      "--smoke",
      "--services",
      "--no-gateway",
    ]) {
      expect(result.stdout).toContain(option);
    }
  });
});

describe("platform client launcher diagnostics", () => {
  test("rejects mutually exclusive install modes with a clean error", () => {
    const result = runLauncher("run-platform-clients.py", [
      "--install",
      "--no-install",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot be used together");
    expect(result.stderr).not.toContain("Traceback");
  });

  test("rejects unknown arguments with a clean error", () => {
    const result = runLauncher("run-platform-dev.py", ["--definitely-unknown"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown argument");
    expect(result.stderr).not.toContain("Traceback");
  });
});

describe("platform development launcher observability contract", () => {
  const launcher = readFileSync(
    join(repositoryRoot, "run-platform-dev.py"),
    "utf8",
  );

  test("uses only the observability Compose profile and services", () => {
    const declaration = launcher.match(
      /DOCKER_OBSERVABILITY_SERVICES = \[([\s\S]*?)\]/,
    )?.[1];
    expect(declaration).toBeDefined();
    const services = [...(declaration ?? "").matchAll(/"([a-z-]+)"/g)].map(
      (match) => match[1],
    );
    expect(services).toEqual([
      "prometheus",
      "alloy",
      "loki",
      "tempo",
      "grafana",
    ]);
    for (const retired of [
      "otel-collector",
      "jaeger",
      "filebeat",
      "elasticsearch",
      "kibana",
    ]) {
      expect(launcher).not.toContain(retired);
    }
  });

  test("keeps the local Java service ports and the observability agent", () => {
    for (const port of [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087]) {
      expect(launcher).toContain(String(port));
    }
    expect(launcher).toContain("require_observability_agent");
    expect(launcher).toContain("write_host_prometheus_targets");
    expect(launcher).toContain("host.docker.internal:8080");
  });
});

describe("desktop launcher runtime contract", () => {
  const launcher = readFileSync(join(repositoryRoot, "run-desktop.py"), "utf8");

  test("pins the supported toolchain versions", () => {
    expect(launcher).toContain("24.18.0");
    expect(launcher).toContain("11.28.5");
  });

  test("does not depend on Bun", () => {
    expect(launcher).not.toMatch(/bun\s+(run|install|test)\b/);
    expect(launcher).not.toMatch(/bun:test/);
  });
});
