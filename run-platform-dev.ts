#!/usr/bin/env bun

/**
 * Run DramaIP Java services on the host while keeping development
 * infrastructure in Docker.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIRECTORY = join(SCRIPT_DIRECTORY, "platform");
const SERVER_DIRECTORY = join(PLATFORM_DIRECTORY, "server");
const COMPOSE_FILE = join(
  PLATFORM_DIRECTORY,
  "deploy",
  "docker-drama",
  "docker-compose.yaml",
);
const HISTORICAL_MIGRATIONS_DIRECTORY = join(
  SERVER_DIRECTORY,
  "migration",
  "historical-migrations",
);
const LOCAL_LOG_DIRECTORY = join(SERVER_DIRECTORY, "target", "local-dev");
const OTEL_JAVA_AGENT = join(
  SERVER_DIRECTORY,
  "target",
  "observability",
  "opentelemetry-javaagent.jar",
);
const OBSERVABILITY_COMPOSE_DIRECTORY = join(
  PLATFORM_DIRECTORY,
  "deploy",
  "docker-drama",
);
const HOST_PROMETHEUS_CONFIG = join(
  OBSERVABILITY_COMPOSE_DIRECTORY,
  "prometheus",
  "prometheus-host.yml",
);
export const HOST_PROMETHEUS_TARGETS = join(
  LOCAL_LOG_DIRECTORY,
  "prometheus-targets",
);

const CURRENT_PID = process.pid;
const REQUIRED_BUN_VERSION = "1.4.0";
const GATEWAY_PORT = 8080;
const DEFAULT_JAVA_OPTS =
  "-Xmx512m -Xms256m -XX:MaxRAMPercentage=50 -XX:+UseG1GC";
const LOCAL_DIRECT_SOCKET_JAVA_OPTS = [
  "-DsocksProxyHost=",
  "-DsocksProxyPort=",
] as const;

interface LocalService {
  readonly name: string;
  readonly module: string;
  readonly port: number;
  readonly databaseUser: string;
}

const LOCAL_SERVICES = [
  {
    name: "identity",
    module: "services/identity",
    port: 8081,
    databaseUser: "dramaip_identity_svc",
  },
  {
    name: "notification",
    module: "services/notification",
    port: 8082,
    databaseUser: "dramaip_notification_svc",
  },
  {
    name: "reporting",
    module: "services/reporting",
    port: 8087,
    databaseUser: "dramaip_reporting_svc",
  },
  {
    name: "creation",
    module: "services/creation",
    port: 8083,
    databaseUser: "dramaip_creation_svc",
  },
  {
    name: "quota",
    module: "services/quota",
    port: 8084,
    databaseUser: "dramaip_quota_svc",
  },
  {
    name: "ai",
    module: "services/ai",
    port: 8085,
    databaseUser: "dramaip_ai_svc",
  },
  {
    name: "billing",
    module: "services/billing",
    port: 8086,
    databaseUser: "dramaip_billing_svc",
  },
] as const satisfies readonly LocalService[];

const DOCKER_INFRA_SERVICES = [
  "postgres",
  "redis",
  "rabbitmq",
  "minio",
  "minio-init",
  "nacos-mysql-schema",
  "nacos-mysql",
  "nacos",
  "seata",
] as const;
const DOCKER_JAVA_SERVICES = [
  "java-migration",
  "java-gateway",
  "identity",
  "java-notification",
  "java-reporting",
  "creation",
  "java-quota",
  "ai",
  "java-billing",
] as const;
export const DOCKER_OBSERVABILITY_SERVICES = [
  "prometheus",
  "alloy",
  "loki",
  "tempo",
  "grafana",
] as const;

interface Options {
  readonly skipPackage: boolean;
  readonly noInfrastructure: boolean;
  readonly observability: boolean;
  readonly smoke: boolean;
  readonly services?: string;
  readonly noGateway: boolean;
}

interface ManagedJavaProcess {
  readonly name: string;
  readonly process: ChildProcess;
}

interface CapturedResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

let shutdownSignal: NodeJS.Signals | undefined;
let resolveShutdown: (() => void) | undefined;
const shutdownRequested = new Promise<void>((resolvePromise) => {
  resolveShutdown = resolvePromise;
});

function info(message: string): void {
  process.stdout.write(`* ${message}\n`);
}

function ok(message: string): void {
  process.stdout.write(`OK ${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`! ${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function requestShutdown(signal: NodeJS.Signals): void {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  resolveShutdown?.();
}

function installShutdownHandlers(): void {
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  if (process.platform === "win32") {
    process.once("SIGBREAK", () => requestShutdown("SIGBREAK"));
  }
}

function shutdownReason(): string {
  return shutdownSignal ?? "Ctrl+C";
}

function runCaptured(
  command: readonly string[],
  cwd = SCRIPT_DIRECTORY,
): CapturedResult {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    shell: requiresCommandShell(command[0]),
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function commandOutput(
  command: readonly string[],
  cwd: string,
): string | undefined {
  const result = runCaptured(command, cwd);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

async function runChecked(
  command: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: environment,
    shell: requiresCommandShell(command[0]),
    stdio: "inherit",
  });
  const result = await waitForExit(child);
  if (shutdownSignal) throw new ShutdownError();
  if (result.code !== 0) {
    const reason = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.code ?? 1}`;
    fail(`command failed (${reason}): ${command.join(" ")}`);
  }
}

function resolveExecutable(name: string): string | undefined {
  const pathEntries = isAbsolute(name)
    ? [""]
    : (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((extension) => extension.toLowerCase())
      : [""];
  const hasWindowsExtension = extensions.some((extension) =>
    name.toLowerCase().endsWith(extension),
  );
  for (const entry of pathEntries) {
    const directory = entry.replace(/^"|"$/gu, "");
    for (const extension of hasWindowsExtension ? [""] : extensions) {
      const candidate = isAbsolute(name)
        ? name
        : join(directory, `${name}${extension}`);
      try {
        accessSync(
          candidate,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return undefined;
}

function requiresCommandShell(executable: string): boolean {
  return process.platform === "win32" && /\.(?:bat|cmd)$/iu.test(executable);
}

function checkBunRuntime(): void {
  const version = (process.versions as Record<string, string | undefined>).bun;
  if (version !== REQUIRED_BUN_VERSION) {
    fail(
      `Bun version mismatch: found ${version ?? "unknown"}, need ${REQUIRED_BUN_VERSION}.`,
    );
  }
  ok(`bun ${version}`);
}

function resolveGlobalMavenCommand(): readonly string[] | undefined {
  const names = process.platform === "win32" ? ["mvn.cmd", "mvn"] : ["mvn"];
  for (const name of names) {
    const executable = resolveExecutable(name);
    if (executable) return [executable];
  }
  for (const variable of ["MAVEN_HOME", "M2_HOME"] as const) {
    const home = process.env[variable];
    if (!home) continue;
    const executable = join(
      home,
      "bin",
      process.platform === "win32" ? "mvn.cmd" : "mvn",
    );
    if (existsSync(executable)) return [executable];
  }
  return undefined;
}

function help(): void {
  process.stdout.write(`
Run Java services locally and DramaIP infrastructure in Docker.

Usage:
  bun run run-platform-dev.ts [options]

Options:
  --skip-package       Use existing executable JARs without Maven packaging
  --no-infra           Assume Docker infrastructure is already running
  --obs                Start observability services and attach the OTel Java agent
  --smoke              Health-check the stack, then stop local Java services and exit
  --services <names>   Comma-separated domain services; identity is always included
  --no-gateway         Do not start the Gateway
  -h, --help           Show this help
`);
}

export function parseDevelopmentArguments(
  arguments_: readonly string[],
): Options | undefined {
  let skipPackage = false;
  let noInfrastructure = false;
  let observability = false;
  let smoke = false;
  let services: string | undefined;
  let noGateway = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "-h" || argument === "--help") {
      help();
      return undefined;
    }
    if (argument === "--skip-package") skipPackage = true;
    else if (argument === "--no-infra") noInfrastructure = true;
    else if (argument === "--obs") observability = true;
    else if (argument === "--smoke") smoke = true;
    else if (argument === "--no-gateway") noGateway = true;
    else if (argument === "--services") {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--"))
        fail("--services requires a value");
      services = value;
      index += 1;
    } else if (argument.startsWith("--services="))
      services = argument.slice("--services=".length);
    else fail(`unknown argument: ${argument}`);
  }
  return {
    skipPackage,
    noInfrastructure,
    observability,
    smoke,
    services,
    noGateway,
  };
}

function checkLayout(): void {
  const missing = [
    PLATFORM_DIRECTORY,
    SERVER_DIRECTORY,
    COMPOSE_FILE,
    HISTORICAL_MIGRATIONS_DIRECTORY,
  ].filter((path) => !existsSync(path));
  if (missing.length > 0) fail(`missing required paths: ${missing.join(", ")}`);
  ok("platform development layout found");
}

function checkJavaAndMaven(): readonly string[] {
  const java = resolveExecutable("java");
  if (!java)
    fail(
      "JDK 21 is required. Configure JAVA_HOME and add its bin directory to PATH.",
    );
  const javaVersion = commandOutput([java, "--version"], SERVER_DIRECTORY);
  if (!javaVersion || !/\b21(?:\.|\s)/u.test(javaVersion)) {
    fail(
      "JDK 21 is required. Configure JAVA_HOME and add its bin directory to PATH.",
    );
  }
  const maven = resolveGlobalMavenCommand();
  if (!maven || !commandOutput([...maven, "--version"], SERVER_DIRECTORY)) {
    fail(
      "global Maven is required. Add Maven bin to PATH or set MAVEN_HOME/M2_HOME.",
    );
  }
  ok(javaVersion.split(/\r?\n/u)[0]);
  ok(`global Maven found: ${maven[0]}`);
  return maven;
}

function checkDocker(): string {
  const docker = resolveExecutable("docker");
  if (!docker || !commandOutput([docker, "--version"], SCRIPT_DIRECTORY)) {
    fail("Docker is required for local infrastructure.");
  }
  if (!commandOutput([docker, "compose", "version"], SCRIPT_DIRECTORY)) {
    fail("Docker Compose v2 is required.");
  }
  const infoResult = runCaptured([docker, "info"], SCRIPT_DIRECTORY);
  if (infoResult.status !== 0)
    fail("Docker daemon is not reachable. Start Docker Desktop first.");
  ok("Docker and Docker Compose are available");
  return docker;
}

function composeCommand(
  docker: string,
  ...arguments_: readonly string[]
): string[] {
  return [
    docker,
    "compose",
    "--profile",
    "java",
    "-f",
    COMPOSE_FILE,
    ...arguments_,
  ];
}

export function observabilityComposeCommand(
  docker: string,
  ...arguments_: readonly string[]
): string[] {
  return [
    docker,
    "compose",
    "--profile",
    "java",
    "--profile",
    "observability",
    "-f",
    COMPOSE_FILE,
    ...arguments_,
  ];
}

function runnableJar(module: string): string | undefined {
  const target = join(SERVER_DIRECTORY, module, "target");
  if (!existsSync(target)) return undefined;
  const jars = readdirSync(target)
    .filter((entry) => entry.endsWith("-exec.jar"))
    .map((entry) => join(target, entry))
    .sort();
  return jars.length === 1 ? jars[0] : undefined;
}

async function packageJavaServices(
  maven: readonly string[],
  skipPackage: boolean,
): Promise<void> {
  if (skipPackage) warn("--skip-package: using existing local Java JARs");
  else {
    info("Packaging Java services with the global Maven and local JDK 21...");
    await runChecked(
      [...maven, "-B", "-ntp", "-DskipTests", "package"],
      SERVER_DIRECTORY,
    );
  }
  const modules = [
    "migration",
    "gateway",
    ...LOCAL_SERVICES.map(({ module }) => module),
  ];
  const missing = modules.filter((module) => !runnableJar(module));
  if (missing.length > 0)
    fail(`runnable JAR missing for: ${missing.join(", ")}`);
  ok("local Java runtime JARs are ready");
}

export function requireObservabilityAgent(agentPath = OTEL_JAVA_AGENT): string {
  if (!existsSync(agentPath) || statSync(agentPath).size === 0) {
    fail(
      "OpenTelemetry Java agent is missing. Run without --skip-package once so Maven downloads " +
        "server/target/observability/opentelemetry-javaagent.jar.",
    );
  }
  return agentPath;
}

async function stopDockerJavaServices(docker: string): Promise<void> {
  info(
    "Stopping Compose Java application containers; Docker infrastructure remains running",
  );
  await runChecked(
    composeCommand(docker, "stop", ...DOCKER_JAVA_SERVICES),
    SCRIPT_DIRECTORY,
  );
}

async function startDockerInfrastructure(docker: string): Promise<void> {
  info(
    "Starting PostgreSQL, Redis, RabbitMQ, MinIO, Nacos MySQL, Nacos and Seata in Docker...",
  );
  await runChecked(
    composeCommand(docker, "up", "-d", ...DOCKER_INFRA_SERVICES),
    SCRIPT_DIRECTORY,
  );
  await waitForTcp("PostgreSQL", 5432, 90_000);
  await waitForTcp("Redis", 6379, 90_000);
  await waitForTcp("RabbitMQ", 5672, 90_000);
  await waitForTcp("MinIO", 9000, 90_000);
  await waitForHttp(
    "Nacos",
    "http://127.0.0.1:8849/v3/console/health/readiness",
    120_000,
  );
  await waitForTcp("Nacos gRPC", 9848, 120_000);
  await waitForTcp("Seata", 8091, 90_000);
  ok("Docker development infrastructure is ready");
}

interface PrometheusTarget {
  readonly targets: readonly string[];
  readonly labels: Readonly<{ service: string }>;
}

export function writeHostPrometheusTargets(
  serviceNames: ReadonlySet<string>,
  includeGateway: boolean,
  targetDirectory = HOST_PROMETHEUS_TARGETS,
): void {
  mkdirSync(targetDirectory, { recursive: true });
  const gatewayTargets: PrometheusTarget[] = includeGateway
    ? [
        {
          targets: ["host.docker.internal:8080"],
          labels: { service: "gateway" },
        },
      ]
    : [];
  const servicePorts = new Map<string, number>(
    LOCAL_SERVICES.map(({ name, port }) => [name, port]),
  );
  const serviceTargets: PrometheusTarget[] = [...serviceNames]
    .sort()
    .map((name) => {
      const port = servicePorts.get(name);
      if (!port)
        fail(`cannot write Prometheus target for unknown service: ${name}`);
      return {
        targets: [`host.docker.internal:${port}`],
        labels: { service: name },
      };
    });
  writeFileSync(
    join(targetDirectory, "gateway.json"),
    JSON.stringify(gatewayTargets),
    "utf8",
  );
  writeFileSync(
    join(targetDirectory, "services.json"),
    JSON.stringify(serviceTargets),
    "utf8",
  );
}

async function startObservability(
  docker: string,
  serviceNames: ReadonlySet<string>,
  includeGateway: boolean,
): Promise<void> {
  writeHostPrometheusTargets(serviceNames, includeGateway);
  const configuredDataRoot = process.env.DRAMAIP_COMPOSE_DATA_ROOT;
  const dataRoot = configuredDataRoot
    ? isAbsolute(configuredDataRoot)
      ? configuredDataRoot
      : resolve(OBSERVABILITY_COMPOSE_DIRECTORY, configuredDataRoot)
    : join(OBSERVABILITY_COMPOSE_DIRECTORY, "docker-data");
  for (const name of ["prometheus", "alloy", "loki", "tempo", "grafana"]) {
    const directory = join(dataRoot, name);
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o777);
  }
  const environment = {
    ...process.env,
    DRAMAIP_PROMETHEUS_CONFIG: HOST_PROMETHEUS_CONFIG,
    DRAMAIP_HOST_LOG_DIR: LOCAL_LOG_DIRECTORY,
    DRAMAIP_PROMETHEUS_TARGETS_DIR: HOST_PROMETHEUS_TARGETS,
  };
  info("Starting Prometheus, Alloy, Loki, Tempo and Grafana...");
  await runChecked(
    observabilityComposeCommand(
      docker,
      "up",
      "-d",
      "--remove-orphans",
      ...DOCKER_OBSERVABILITY_SERVICES,
    ),
    SCRIPT_DIRECTORY,
    environment,
  );
  await waitForHttp("Prometheus", "http://127.0.0.1:9090/-/ready", 90_000);
  await waitForHttp("Alloy", "http://127.0.0.1:12345/-/ready", 90_000);
  await waitForTcp("Alloy OTLP HTTP", 4318, 90_000);
  await waitForHttp("Loki", "http://127.0.0.1:3100/ready", 90_000);
  await waitForHttp("Tempo", "http://127.0.0.1:3200/ready", 90_000);
  await waitForHttp("Grafana", "http://127.0.0.1:3000/api/health", 120_000);
  ok("local observability stack is ready");
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (connected: boolean): void => {
      socket.destroy();
      resolvePromise(connected);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForTcp(
  label: string,
  port: number,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (shutdownSignal) throw new ShutdownError();
    if (await canConnect(port)) return;
    await Promise.race([sleep(1_000), shutdownRequested]);
  }
  fail(
    `${label} did not accept connections on 127.0.0.1:${port} within ${Math.round(timeout / 1_000)}s`,
  );
}

async function waitForHttp(
  label: string,
  url: string,
  timeout: number,
  child?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError = "";
  while (Date.now() < deadline) {
    if (shutdownSignal) throw new ShutdownError();
    const code = child ? childExitCode(child) : undefined;
    if (code !== undefined)
      fail(`${label} exited during startup with code ${code}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await Promise.race([sleep(1_000), shutdownRequested]);
  }
  fail(
    `${label} was not healthy within ${Math.round(timeout / 1_000)}s: ${lastError}`,
  );
}

export function localEnvironment(observability = false): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  const databasePassword =
    environment.DRAMAIP_MIGRATION_ROLE_PASSWORD ??
    environment.POSTGRES_PASSWORD ??
    "dramaip";
  Object.assign(environment, {
    POSTGRES_DSN: `jdbc:postgresql://127.0.0.1:5432/${environment.POSTGRES_DB ?? "dramaip"}`,
    POSTGRES_PASSWORD: databasePassword,
    HISTORICAL_MIGRATIONS_APPLY_PENDING: "true",
    NACOS_SERVER_ADDR: "127.0.0.1:8848",
    SPRING_CLOUD_NACOS_DISCOVERY_IP: "127.0.0.1",
    SPRING_CLOUD_NACOS_DISCOVERY_GROUP:
      environment.SPRING_CLOUD_NACOS_DISCOVERY_GROUP ?? "DRAMAIP_LOCAL_DEV",
    SEATA_SERVER_ADDR: "127.0.0.1:8091",
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: "6379",
    REDIS_PASSWORD: environment.REDIS_PASSWORD ?? "dramaip",
    SPRING_DATA_REDIS_HOST: "127.0.0.1",
    SPRING_DATA_REDIS_PORT: "6379",
    SPRING_DATA_REDIS_PASSWORD: environment.REDIS_PASSWORD ?? "dramaip",
    SPRING_RABBITMQ_HOST: "127.0.0.1",
    SPRING_RABBITMQ_PORT: "5672",
    SPRING_RABBITMQ_USERNAME: environment.RABBITMQ_USER ?? "dramaip",
    SPRING_RABBITMQ_PASSWORD: environment.RABBITMQ_PASSWORD ?? "dramaip",
    JWT_ENABLED: environment.JWT_ENABLED ?? "true",
    JWT_JWK_SET_URI:
      environment.JWT_JWK_SET_URI ??
      "http://127.0.0.1:8081/.well-known/jwks.json",
    DRAMAIP_INTERNAL_TOKEN:
      environment.DRAMAIP_INTERNAL_TOKEN ?? "change-me-internal",
    IDENTITY_ALLOW_EPHEMERAL_JWT:
      environment.IDENTITY_ALLOW_EPHEMERAL_JWT ?? "true",
    REVIEW_S3_ENDPOINT:
      environment.REVIEW_S3_ENDPOINT ?? "http://127.0.0.1:9000",
    REVIEW_S3_REGION: environment.REVIEW_S3_REGION ?? "us-east-1",
    REVIEW_S3_BUCKET: environment.REVIEW_S3_BUCKET ?? "dramaip-review",
    REVIEW_S3_ACCESS_KEY: environment.REVIEW_S3_ACCESS_KEY ?? "dramaip-review",
    REVIEW_S3_SECRET_KEY:
      environment.REVIEW_S3_SECRET_KEY ?? "dramaip-review-development-secret",
    REVIEW_S3_ALLOW_INSECURE: environment.REVIEW_S3_ALLOW_INSECURE ?? "true",
  });
  if (observability) {
    Object.assign(environment, {
      DRAMAIP_DEPLOYMENT_ENVIRONMENT:
        environment.DRAMAIP_DEPLOYMENT_ENVIRONMENT ?? "local",
      DRAMAIP_SERVICE_VERSION:
        environment.DRAMAIP_SERVICE_VERSION ?? "development",
      DRAMAIP_RELEASE_NAME: environment.DRAMAIP_RELEASE_NAME ?? "host-local",
      OTEL_RESOURCE_ATTRIBUTES:
        environment.OTEL_RESOURCE_ATTRIBUTES ??
        "deployment.environment.name=local,service.version=development,service.namespace=dramaip-platform,dramaip.release=host-local",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_METRICS_EXPORTER: "none",
      OTEL_LOGS_EXPORTER: "none",
      OTEL_PROPAGATORS: "tracecontext,baggage",
      OTEL_TRACES_SAMPLER:
        environment.OTEL_TRACES_SAMPLER ?? "always_on",
      OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST: "",
      OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_CLIENT_REQUEST: "",
      OTEL_INSTRUMENTATION_COMMON_DB_QUERY_SANITIZATION_ENABLED: "true",
    });
  }
  return environment;
}

async function runMigration(
  environment: NodeJS.ProcessEnv,
  agent?: string,
): Promise<void> {
  const migrationJar = runnableJar("migration");
  if (!migrationJar) fail("migration executable JAR is missing");
  const migrationEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    POSTGRES_USER: environment.POSTGRES_USER ?? "dramaip",
    DB_ROLE_BOOTSTRAP: environment.DB_ROLE_BOOTSTRAP ?? "true",
    DRAMAIP_MIGRATION_ROLE_PASSWORD: environment.POSTGRES_PASSWORD,
    HISTORICAL_MIGRATIONS_DIR: HISTORICAL_MIGRATIONS_DIRECTORY,
  };
  info("Running the Java migration job locally...");
  const command = buildMigrationCommand(
    resolveExecutable("java") ?? "java",
    migrationJar,
    agent,
  );
  if (agent) {
    migrationEnvironment.OTEL_SERVICE_NAME = "migration";
  }
  await runChecked(command, SERVER_DIRECTORY, migrationEnvironment);
  ok("local Java migration job completed");
}

export function buildMigrationCommand(
  java: string,
  migrationJar: string,
  agent?: string,
): string[] {
  return [
    java,
    ...LOCAL_DIRECT_SOCKET_JAVA_OPTS,
    ...(agent ? [`-javaagent:${agent}`] : []),
    "-jar",
    migrationJar,
  ];
}

function listeningPids(port: number): number[] {
  if (process.platform === "win32") {
    const result = runCaptured(["netstat", "-ano", "-p", "TCP"]);
    if (result.status !== 0) return [];
    const pids: number[] = [];
    for (const line of result.stdout.split(/\r?\n/u)) {
      const fields = line.trim().split(/\s+/u);
      if (
        fields.length < 5 ||
        fields[0].toUpperCase() !== "TCP" ||
        fields.at(-2)?.toUpperCase() !== "LISTENING" ||
        fields[1].split(":").at(-1) !== String(port)
      ) {
        continue;
      }
      const pid = Number.parseInt(fields.at(-1) ?? "", 10);
      if (Number.isFinite(pid) && pid !== CURRENT_PID && !pids.includes(pid))
        pids.push(pid);
    }
    return pids;
  }
  const lsof = resolveExecutable("lsof");
  if (!lsof) fail("lsof is required to inspect local Java ports");
  const result = runCaptured([
    lsof,
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);
  if (result.status !== 0 && result.status !== 1) return [];
  return [...new Set(result.stdout.split(/\s+/u).map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && pid !== CURRENT_PID,
  );
}

function dockerContainersPublishing(docker: string, port: number): string[] {
  const result = runCaptured(
    [docker, "ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"],
    SCRIPT_DIRECTORY,
  );
  if (result.status !== 0)
    fail(`could not inspect Docker containers publishing port ${port}`);
  return [...new Set(result.stdout.split(/\s+/u).filter(Boolean))];
}

function processCommand(pid: number): string {
  const command =
    process.platform === "win32"
      ? ["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]
      : ["ps", "-p", String(pid), "-o", "command="];
  const result = runCaptured(command);
  return result.status === 0 ? result.stdout.trim() : "";
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isDockerProcess(pid: number): boolean {
  const command = processCommand(pid).toLowerCase();
  return ["com.docker", "docker-proxy", "dockerd", "vpnkit"].some((marker) =>
    command.includes(marker),
  );
}

async function killPids(pids: readonly number[], label: string): Promise<void> {
  const dockerPids = pids.filter(isDockerProcess);
  const targets = pids.filter((pid) => !dockerPids.includes(pid));
  if (dockerPids.length > 0) {
    warn(
      `${label} is still held by Docker PID(s) ${dockerPids.join(", ")}; Docker Desktop itself will not be killed.`,
    );
  }
  if (targets.length === 0) return;
  warn(
    `${label} is occupied by PID(s) ${targets.join(", ")}; force-stopping them.`,
  );

  for (const pid of targets) {
    if (process.platform === "win32") {
      const result = runCaptured(["taskkill", "/PID", String(pid), "/T", "/F"]);
      if (result.status !== 0)
        warn(
          `taskkill could not stop PID ${pid}: ${(result.stderr || result.stdout).trim()}`,
        );
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          fail(`no permission to stop PID ${pid} for ${label}`);
        }
      }
    }
  }
  if (process.platform === "win32") return;

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && targets.some(processExists)) await sleep(200);
  const remaining = targets.filter(processExists);
  if (remaining.length === 0) return;
  warn(
    `${label} did not stop gracefully; force-killing PID(s) ${remaining.join(", ")}.`,
  );
  for (const pid of remaining) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        fail(`no permission to force stop PID ${pid} for ${label}`);
      }
    }
  }
}

async function releasePort(
  docker: string,
  label: string,
  port: number,
): Promise<void> {
  const containers = dockerContainersPublishing(docker, port);
  if (containers.length > 0) {
    warn(
      `${label} port ${port} is published by Docker container(s) ${containers.join(", ")}; stopping them.`,
    );
    const result = runCaptured(
      [docker, "stop", "--timeout", "3", ...containers],
      SCRIPT_DIRECTORY,
    );
    if (result.status !== 0) {
      fail(
        `could not stop Docker container(s) on ${label} port ${port}: ${(result.stderr || result.stdout).trim()}`,
      );
    }
  }
  const pids = listeningPids(port);
  if (pids.length > 0) await killPids(pids, `${label} port ${port}`);

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (listeningPids(port).length === 0) return;
    await sleep(200);
  }
  fail(
    `${label} port ${port} is still occupied by PID(s) ${listeningPids(port).join(", ")}`,
  );
}

async function releaseRequiredPorts(
  docker: string,
  serviceNames?: ReadonlySet<string>,
  includeGateway = true,
): Promise<void> {
  info("Checking local Java application ports before startup...");
  const ports: [string, number][] = [];
  if (!serviceNames) {
    ports.push(["Java Gateway", GATEWAY_PORT]);
    ports.push(
      ...LOCAL_SERVICES.map(
        ({ name, port }) => [`Java ${name}`, port] as [string, number],
      ),
    );
  } else {
    const wanted = new Set(serviceNames);
    wanted.add("identity");
    for (const service of LOCAL_SERVICES) {
      if (wanted.has(service.name))
        ports.push([`Java ${service.name}`, service.port]);
    }
    if (includeGateway) ports.push(["Java Gateway", GATEWAY_PORT]);
  }
  for (const [label, port] of ports) await releasePort(docker, label, port);
  ok("local Java application ports are available");
}

export function splitShellWords(value: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let started = false;
  for (const character of value) {
    if (escaping) {
      word += character;
      escaping = false;
      started = true;
    } else if (character === "\\" && quote !== "'") {
      escaping = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
    } else {
      word += character;
      started = true;
    }
  }
  if (escaping) word += "\\";
  if (quote) fail("DRAMAIP_JAVA_OPTS contains an unterminated quote");
  if (started) words.push(word);
  return words;
}

async function startJavaProcess(
  name: string,
  jar: string,
  environment: NodeJS.ProcessEnv,
  port: number,
  databaseUser?: string,
  agent?: string,
): Promise<ManagedJavaProcess> {
  const serviceEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    SERVER_PORT: String(port),
    ...(databaseUser ? { POSTGRES_USER: databaseUser } : {}),
    ...(agent ? { OTEL_SERVICE_NAME: name } : {}),
  };
  info(`Starting local Java ${name} on :${port}`);
  mkdirSync(LOCAL_LOG_DIRECTORY, { recursive: true });
  const logPath = join(LOCAL_LOG_DIRECTORY, `${name}.log`);
  const javaOptions = serviceEnvironment.DRAMAIP_JAVA_OPTS || DEFAULT_JAVA_OPTS;
  info(`${name} JVM: ${javaOptions}`);
  const command = [
    resolveExecutable("java") ?? "java",
    ...splitShellWords(javaOptions),
    ...LOCAL_DIRECT_SOCKET_JAVA_OPTS,
    ...(agent ? [`-javaagent:${agent}`] : []),
    "-jar",
    jar,
  ];
  const log = openSync(logPath, "a");
  let child: ChildProcess;
  try {
    child = spawn(command[0], command.slice(1), {
      cwd: SERVER_DIRECTORY,
      detached: true,
      env: serviceEnvironment,
      shell: requiresCommandShell(command[0]),
      stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolvePromise, reject) => {
      child.once("spawn", resolvePromise);
      child.once("error", reject);
    });
  } finally {
    closeSync(log);
  }
  info(`${name} log: ${logPath}`);
  return { name, process: child };
}

async function stopJavaProcess(managed: ManagedJavaProcess): Promise<void> {
  const child = managed.process;
  if (child.exitCode !== null || child.signalCode !== null) return;
  warn(`Stopping local Java ${managed.name}...`);
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else child.kill("SIGTERM");
  if (!(await waitForExitWithTimeout(child, 8_000))) {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    } else child.kill("SIGKILL");
    await waitForExitWithTimeout(child, 2_000);
  }
}

async function stopJavaProcesses(
  processes: readonly ManagedJavaProcess[],
): Promise<void> {
  for (const managed of [...processes].reverse())
    await stopJavaProcess(managed);
}

export function parseServices(value?: string): Set<string> | undefined {
  if (!value) return undefined;
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function resolveSelectedServices(
  selected?: ReadonlySet<string>,
): Set<string> {
  const allNames = new Set<string>(LOCAL_SERVICES.map(({ name }) => name));
  if (!selected) return allNames;
  const unknown = [...selected].filter((name) => !allNames.has(name)).sort();
  if (unknown.length > 0) {
    fail(
      `unknown service(s) for --services: ${unknown.join(", ")} (available: ${[...allNames].sort().join(", ")})`,
    );
  }
  const names = new Set(selected);
  names.add("identity");
  return names;
}

async function startLocalJavaServices(
  environment: NodeJS.ProcessEnv,
  processes: ManagedJavaProcess[],
  selected: ReadonlySet<string> | undefined,
  startGateway: boolean,
  agent?: string,
): Promise<void> {
  const names = resolveSelectedServices(selected);
  const identityService = LOCAL_SERVICES[0];
  const identityJar = runnableJar(identityService.module);
  if (!identityJar) fail("identity executable JAR is missing");
  const identity = await startJavaProcess(
    identityService.name,
    identityJar,
    environment,
    identityService.port,
    identityService.databaseUser,
    agent,
  );
  processes.push(identity);
  await waitForHttp(
    "identity",
    "http://127.0.0.1:8081/actuator/health",
    90_000,
    identity.process,
  );

  for (const service of LOCAL_SERVICES.slice(1)) {
    if (!names.has(service.name)) continue;
    const jar = runnableJar(service.module);
    if (!jar) fail(`${service.name} executable JAR is missing`);
    processes.push(
      await startJavaProcess(
        service.name,
        jar,
        environment,
        service.port,
        service.databaseUser,
        agent,
      ),
    );
  }
  for (const service of LOCAL_SERVICES.slice(1)) {
    const managed = processes.find(({ name }) => name === service.name);
    if (managed) {
      await waitForHttp(
        service.name,
        `http://127.0.0.1:${service.port}/actuator/health`,
        90_000,
        managed.process,
      );
    }
  }

  if (!startGateway) {
    warn(
      "--no-gateway: skipping gateway; selected services run without the public entrypoint",
    );
    return;
  }
  const gatewayJar = runnableJar("gateway");
  if (!gatewayJar) fail("gateway executable JAR is missing");
  const gateway = await startJavaProcess(
    "gateway",
    gatewayJar,
    environment,
    GATEWAY_PORT,
    undefined,
    agent,
  );
  processes.push(gateway);
  await waitForHttp(
    "gateway",
    `http://127.0.0.1:${GATEWAY_PORT}/actuator/health`,
    90_000,
    gateway.process,
  );
}

async function watchJavaProcesses(
  processes: readonly ManagedJavaProcess[],
  observability: boolean,
): Promise<number> {
  ok("local Java development stack is ready");
  process.stdout.write("\n");
  const names = processes.map(({ name }) => name);
  if (names.includes("gateway")) {
    process.stdout.write("Gateway: http://127.0.0.1:8080\n");
    process.stdout.write(
      "Gateway health: http://127.0.0.1:8080/actuator/health\n",
    );
  }
  process.stdout.write("Nacos console: http://127.0.0.1:8849\n");
  const servicePorts = new Map<string, number>(
    LOCAL_SERVICES.map(({ name, port }) => [name, port]),
  );
  const detail = names
    .filter((name) => name !== "gateway")
    .map((name) => `${name} :${servicePorts.get(name)}`)
    .join(", ");
  process.stdout.write(`Java services: ${detail}\n`);
  process.stdout.write(
    "Start clients separately: bun run run-platform-clients.ts\n",
  );
  if (observability) {
    process.stdout.write(
      "Observability: Prometheus http://127.0.0.1:9090 · Alloy http://127.0.0.1:12345 · Loki http://127.0.0.1:3100 · Tempo http://127.0.0.1:3200 · Grafana http://127.0.0.1:3000\n",
    );
  }
  process.stdout.write(
    "Press Ctrl+C to stop local Java processes. Docker infrastructure remains running.\n",
  );

  while (true) {
    if (shutdownSignal) {
      warn(`Received ${shutdownReason()}.`);
      return 0;
    }
    for (const managed of processes) {
      const code = childExitCode(managed.process);
      if (code !== undefined) {
        warn(`local Java ${managed.name} exited with code ${code}`);
        return code || 1;
      }
    }
    await Promise.race([sleep(500), shutdownRequested]);
  }
}

function childExitCode(child: ChildProcess): number | undefined {
  if (child.exitCode !== null) return child.exitCode;
  if (child.signalCode !== null) return 1;
  return undefined;
}

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

async function waitForExitWithTimeout(
  child: ChildProcess,
  timeout: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    waitForExit(child).then(() => true),
    sleep(timeout).then(() => false),
  ]);
}

class ShutdownError extends Error {}

export async function main(
  arguments_ = process.argv.slice(2),
): Promise<number> {
  const options = parseDevelopmentArguments(arguments_);
  if (!options) return 0;
  const selected = parseServices(options.services);
  const processes: ManagedJavaProcess[] = [];
  try {
    checkLayout();
    installShutdownHandlers();
    checkBunRuntime();
    const maven = checkJavaAndMaven();
    const docker = checkDocker();
    await stopDockerJavaServices(docker);
    const resolvedServices = resolveSelectedServices(selected);
    await releaseRequiredPorts(docker, resolvedServices, !options.noGateway);
    await packageJavaServices(maven, options.skipPackage);
    const agent = options.observability
      ? requireObservabilityAgent()
      : undefined;
    if (options.noInfrastructure)
      warn("--no-infra: assuming Docker infrastructure is already running");
    else await startDockerInfrastructure(docker);
    if (options.observability) {
      await startObservability(docker, resolvedServices, !options.noGateway);
    }
    const environment = localEnvironment(options.observability);
    await runMigration(environment, agent);
    if (!selected) info("Starting the full local Java stack");
    else {
      info(
        `--services: starting ${[...resolvedServices].sort().join(", ")}` +
          (options.noGateway ? " (--no-gateway)" : " (plus gateway)"),
      );
    }
    await startLocalJavaServices(
      environment,
      processes,
      selected,
      !options.noGateway,
      agent,
    );
    if (options.smoke) {
      if (options.observability && !options.noGateway) {
        const node = resolveExecutable("node");
        if (!node)
          fail("Node.js is required for the observability smoke check");
        await runChecked(
          [
            node,
            join(PLATFORM_DIRECTORY, "scripts", "observability-smoke.mjs"),
          ],
          PLATFORM_DIRECTORY,
          environment,
        );
      } else if (options.observability) {
        warn(
          "--obs --smoke without Gateway: Java health smoke passed; observability request smoke was skipped",
        );
      }
      ok("local Java development smoke check passed");
      return 0;
    }
    return await watchJavaProcesses(processes, options.observability);
  } catch (error) {
    if (error instanceof ShutdownError) {
      warn(`Received ${shutdownReason()}.`);
      return 0;
    }
    process.stderr.write(`ERR ${(error as Error).message}\n`);
    return 1;
  } finally {
    await stopJavaProcesses(processes);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exitCode = await main();
}
