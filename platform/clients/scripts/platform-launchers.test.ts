import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseClientArguments } from "../../../run-platform-clients.ts";
import {
  buildMigrationCommand,
  DOCKER_OBSERVABILITY_SERVICES,
  localEnvironment,
  observabilityComposeCommand,
  parseDevelopmentArguments,
  parseServices,
  requireObservabilityAgent,
  resolveSelectedServices,
  splitShellWords,
  writeHostPrometheusTargets,
} from "../../../run-platform-dev.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("platform client launcher", () => {
  test("preserves client option semantics", () => {
    expect(
      parseClientArguments([
        "--install",
        "--no-kill-ports",
        "--api-base-url=http://127.0.0.1:9000",
        "--mobile-target",
        "ios",
      ]),
    ).toEqual({
      installMode: "force",
      killPorts: false,
      apiBaseUrl: "http://127.0.0.1:9000",
      mobileTarget: "ios",
    });
    expect(() => parseClientArguments(["--install", "--no-install"])).toThrow(
      "cannot be used together",
    );
  });
});

describe("platform development launcher", () => {
  test("parses service selection and always includes identity", () => {
    expect(
      parseDevelopmentArguments([
        "--skip-package",
        "--services=creation,quota",
        "--no-gateway",
      ]),
    ).toEqual({
      skipPackage: true,
      noInfrastructure: false,
      observability: false,
      smoke: false,
      services: "creation,quota",
      noGateway: true,
    });
    expect(
      [...resolveSelectedServices(parseServices("creation, quota"))].sort(),
    ).toEqual(["creation", "identity", "quota"]);
    expect(() => resolveSelectedServices(new Set(["unknown"]))).toThrow(
      "unknown service",
    );
  });

  test("builds the same local and observability environment", () => {
    const previousDatabase = process.env.POSTGRES_DB;
    const previousPassword = process.env.POSTGRES_PASSWORD;
    const previousMigrationPassword =
      process.env.DRAMAIP_MIGRATION_ROLE_PASSWORD;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.DRAMAIP_MIGRATION_ROLE_PASSWORD;
    try {
      const environment = localEnvironment(true);
      expect(environment.POSTGRES_DSN).toBe(
        "jdbc:postgresql://127.0.0.1:5432/dramaip",
      );
      expect(environment.HISTORICAL_MIGRATIONS_APPLY_PENDING).toBe("true");
      expect(environment.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "http://127.0.0.1:4318",
      );
      expect(environment.OTEL_METRICS_EXPORTER).toBe("none");
      expect(environment.OTEL_LOGS_EXPORTER).toBe("none");
    } finally {
      restoreEnvironment("POSTGRES_DB", previousDatabase);
      restoreEnvironment("POSTGRES_PASSWORD", previousPassword);
      restoreEnvironment(
        "DRAMAIP_MIGRATION_ROLE_PASSWORD",
        previousMigrationPassword,
      );
    }
  });

  test("writes Prometheus targets for only selected host JVMs", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "dramaip-prometheus-targets-"),
    );
    temporaryDirectories.push(directory);
    writeHostPrometheusTargets(new Set(["identity", "quota"]), true, directory);

    const gateway = JSON.parse(
      readFileSync(join(directory, "gateway.json"), "utf8"),
    );
    const services = JSON.parse(
      readFileSync(join(directory, "services.json"), "utf8"),
    );
    expect(gateway[0].targets).toEqual(["host.docker.internal:8080"]);
    expect(
      services.map((item: { targets: string[] }) => item.targets[0]).sort(),
    ).toEqual(["host.docker.internal:8081", "host.docker.internal:8084"]);
  });

  test("parses quoted JVM options without invoking a shell", () => {
    expect(splitShellWords("-Xmx1g -Dname=\"Drama IP\" '-Dflag=a b'")).toEqual([
      "-Xmx1g",
      "-Dname=Drama IP",
      "-Dflag=a b",
    ]);
    expect(() => splitShellWords('-Dname="unterminated')).toThrow(
      "unterminated quote",
    );
  });

  test("keeps migration sockets direct and requires the packaged observability agent", () => {
    expect(buildMigrationCommand("java", "/tmp/migration-exec.jar")).toEqual([
      "java",
      "-DsocksProxyHost=",
      "-DsocksProxyPort=",
      "-jar",
      "/tmp/migration-exec.jar",
    ]);
    expect(() =>
      requireObservabilityAgent("/tmp/dramaip-missing-otel-agent.jar"),
    ).toThrow("OpenTelemetry Java agent is missing");
  });

  test("uses only the observability Compose profile and services", () => {
    const command = observabilityComposeCommand(
      "docker",
      "up",
      "-d",
      ...DOCKER_OBSERVABILITY_SERVICES,
    );
    expect(command).toContain("observability");
    expect(command).toContain("up");
    for (const service of DOCKER_OBSERVABILITY_SERVICES) {
      expect(command).toContain(service);
    }
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
