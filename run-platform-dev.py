#!/usr/bin/env python3
"""
Run DramaIP Java services on the host while keeping development
infrastructure in Docker.
"""

from __future__ import annotations

import json
import os
import platform
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

SCRIPT_DIRECTORY = Path(__file__).resolve().parent
PLATFORM_DIRECTORY = SCRIPT_DIRECTORY / "platform"
SERVER_DIRECTORY = PLATFORM_DIRECTORY / "server"
COMPOSE_FILE = PLATFORM_DIRECTORY / "deploy" / "docker-drama" / "docker-compose.yaml"
HISTORICAL_MIGRATIONS_DIRECTORY = (
    SERVER_DIRECTORY / "migration" / "historical-migrations"
)
LOCAL_LOG_DIRECTORY = SERVER_DIRECTORY / "target" / "local-dev"
OTEL_JAVA_AGENT = (
    SERVER_DIRECTORY / "target" / "observability" / "opentelemetry-javaagent.jar"
)
OBSERVABILITY_COMPOSE_DIRECTORY = PLATFORM_DIRECTORY / "deploy" / "docker-drama"
HOST_PROMETHEUS_CONFIG = (
    OBSERVABILITY_COMPOSE_DIRECTORY / "prometheus" / "prometheus-host.yml"
)
HOST_PROMETHEUS_TARGETS = LOCAL_LOG_DIRECTORY / "prometheus-targets"

CURRENT_PID = os.getpid()
REQUIRED_PNPM_VERSION = "11.28.5"
GATEWAY_PORT = 8080
DEFAULT_JAVA_OPTS = (
    "-Xmx512m -Xms256m -XX:MaxRAMPercentage=50 -XX:+UseG1GC"
)
LOCAL_DIRECT_SOCKET_JAVA_OPTS = [
    "-DsocksProxyHost=",
    "-DsocksProxyPort=",
]


@dataclass(frozen=True)
class LocalService:
    name: str
    module: str
    port: int
    database_user: str


LOCAL_SERVICES = [
    LocalService("identity", "services/identity", 8081, "dramaip_identity_svc"),
    LocalService(
        "notification", "services/notification", 8082, "dramaip_notification_svc"
    ),
    LocalService("reporting", "services/reporting", 8087, "dramaip_reporting_svc"),
    LocalService("creation", "services/creation", 8083, "dramaip_creation_svc"),
    LocalService("quota", "services/quota", 8084, "dramaip_quota_svc"),
    LocalService("ai", "services/ai", 8085, "dramaip_ai_svc"),
    LocalService("billing", "services/billing", 8086, "dramaip_billing_svc"),
]

DOCKER_INFRA_SERVICES = [
    "postgres",
    "redis",
    "rabbitmq",
    "minio",
    "minio-init",
    "nacos-mysql-schema",
    "nacos-mysql",
    "nacos",
    "seata",
]
DOCKER_JAVA_SERVICES = [
    "java-migration",
    "java-gateway",
    "identity",
    "java-notification",
    "java-reporting",
    "creation",
    "java-quota",
    "ai",
    "java-billing",
]
DOCKER_OBSERVABILITY_SERVICES = [
    "prometheus",
    "alloy",
    "loki",
    "tempo",
    "grafana",
]


@dataclass(frozen=True)
class Options:
    skip_package: bool = False
    no_infrastructure: bool = False
    observability: bool = False
    smoke: bool = False
    services: str | None = None
    no_gateway: bool = False


@dataclass
class ManagedJavaProcess:
    name: str
    process: subprocess.Popen[bytes] | None = None


@dataclass
class CapturedResult:
    status: int | None
    stdout: str
    stderr: str
    error: Exception | None = None


class ShutdownError(Exception):
    """收到关闭信号或等待被中断。"""


_shutdown_signal: str | None = None
_shutdown_event = threading.Event()


def info(message: str) -> None:
    sys.stdout.write(f"* {message}\n")
    sys.stdout.flush()


def ok(message: str) -> None:
    sys.stdout.write(f"OK {message}\n")
    sys.stdout.flush()


def warn(message: str) -> None:
    sys.stderr.write(f"! {message}\n")
    sys.stderr.flush()


def fail(message: str) -> "NoReturn":  # type: ignore[valid-type]
    raise RuntimeError(message)


def sleep(milliseconds: float) -> None:
    time.sleep(milliseconds / 1000)


def request_shutdown(name: str) -> None:
    global _shutdown_signal
    if _shutdown_signal:
        return
    _shutdown_signal = name
    _shutdown_event.set()


def install_shutdown_handlers() -> None:
    signal.signal(signal.SIGINT, lambda *_: request_shutdown("SIGINT"))
    signal.signal(signal.SIGTERM, lambda *_: request_shutdown("SIGTERM"))
    if platform.system() == "Windows":
        signal.signal(signal.SIGBREAK, lambda *_: request_shutdown("SIGBREAK"))


def shutdown_reason() -> str:
    return _shutdown_signal or "Ctrl+C"


def requires_command_shell(executable: str) -> bool:
    return platform.system() == "Windows" and bool(
        re.search(r"\.(?:bat|cmd)$", executable, re.IGNORECASE)
    )


def run_captured(command: list[str], cwd: Path = SCRIPT_DIRECTORY) -> CapturedResult:
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            shell=requires_command_shell(command[0]),
        )
    except OSError as error:
        return CapturedResult(status=None, stdout="", stderr="", error=error)
    return CapturedResult(
        status=result.returncode,
        stdout=result.stdout or "",
        stderr=result.stderr or "",
    )


def command_output(command: list[str], cwd: Path) -> str | None:
    result = run_captured(command, cwd)
    return result.stdout.strip() if result.status == 0 else None


def run_checked(
    command: list[str],
    cwd: Path,
    environment: dict[str, str] | None = None,
) -> None:
    result = subprocess.run(
        command,
        cwd=str(cwd),
        env=environment if environment is not None else dict(os.environ),
        shell=requires_command_shell(command[0]),
    )
    if _shutdown_signal:
        raise ShutdownError()
    if result.returncode != 0:
        fail(f"command failed (exit code {result.returncode}): {' '.join(command)}")


def resolve_executable(name: str) -> str | None:
    if os.path.isabs(name):
        candidates = [Path(name)]
    else:
        candidates = []
        for entry in os.environ.get("PATH", "").split(os.pathsep):
            if not entry:
                continue
            directory = entry.strip('"')
            if platform.system() == "Windows":
                extensions = [
                    extension.lower()
                    for extension in os.environ.get(
                        "PATHEXT", ".COM;.EXE;.BAT;.CMD"
                    ).split(";")
                ]
            else:
                extensions = [""]
            has_windows_extension = any(
                name.lower().endswith(extension) for extension in extensions
            )
            for extension in ([""] if has_windows_extension else extensions):
                candidates.append(Path(directory) / f"{name}{extension}")
    for candidate in candidates:
        try:
            if not candidate.is_file():
                continue
            if platform.system() != "Windows" and not os.access(candidate, os.X_OK):
                continue
        except OSError:
            continue
        return str(candidate)
    return None


def check_pnpm_runtime() -> None:
    pnpm = resolve_executable("pnpm")
    # 版本在 clients workspace 读取，让包管理器解析该 workspace 固定的
    # `packageManager` 字段。
    version = (
        command_output([pnpm, "--version"], PLATFORM_DIRECTORY / "clients")
        if pnpm
        else None
    )
    if not pnpm or version != REQUIRED_PNPM_VERSION:
        fail(
            f"pnpm version mismatch: found {version or 'unknown'}, "
            f"need {REQUIRED_PNPM_VERSION}."
        )
    ok(f"pnpm {version}")


def resolve_global_maven_command() -> list[str] | None:
    names = ["mvn.cmd", "mvn"] if platform.system() == "Windows" else ["mvn"]
    for name in names:
        executable = resolve_executable(name)
        if executable:
            return [executable]
    for variable in ("MAVEN_HOME", "M2_HOME"):
        home = os.environ.get(variable)
        if not home:
            continue
        executable = Path(home) / "bin" / (
            "mvn.cmd" if platform.system() == "Windows" else "mvn"
        )
        if executable.exists():
            return [str(executable)]
    return None


def help_text() -> None:
    sys.stdout.write(
        """
Run Java services locally and DramaIP infrastructure in Docker.

Usage:
  python3 run-platform-dev.py [options]

Options:
  --skip-package       Use existing executable JARs without Maven packaging
  --no-infra           Assume Docker infrastructure is already running
  --obs                Start observability services and attach the OTel Java agent
  --smoke              Health-check the stack, then stop local Java services and exit
  --services <names>   Comma-separated domain services; identity is always included
  --no-gateway         Do not start the Gateway
  -h, --help           Show this help
"""
    )
    sys.stdout.flush()


def parse_development_arguments(arguments: list[str]) -> Options | None:
    skip_package = False
    no_infrastructure = False
    observability = False
    smoke = False
    services: str | None = None
    no_gateway = False

    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument in ("-h", "--help"):
            help_text()
            return None
        if argument == "--skip-package":
            skip_package = True
        elif argument == "--no-infra":
            no_infrastructure = True
        elif argument == "--obs":
            observability = True
        elif argument == "--smoke":
            smoke = True
        elif argument == "--no-gateway":
            no_gateway = True
        elif argument == "--services":
            value = arguments[index + 1] if index + 1 < len(arguments) else None
            if value is None or value.startswith("--"):
                fail("--services requires a value")
            services = value
            index += 1
        elif argument.startswith("--services="):
            services = argument[len("--services=") :]
        else:
            fail(f"unknown argument: {argument}")
        index += 1

    return Options(
        skip_package=skip_package,
        no_infrastructure=no_infrastructure,
        observability=observability,
        smoke=smoke,
        services=services,
        no_gateway=no_gateway,
    )


def check_layout() -> None:
    missing = [
        path
        for path in (
            PLATFORM_DIRECTORY,
            SERVER_DIRECTORY,
            COMPOSE_FILE,
            HISTORICAL_MIGRATIONS_DIRECTORY,
        )
        if not path.exists()
    ]
    if missing:
        fail("missing required paths: " + ", ".join(str(path) for path in missing))
    ok("platform development layout found")


def check_java_and_maven() -> list[str]:
    java = resolve_executable("java")
    if not java:
        fail(
            "JDK 21 is required. Configure JAVA_HOME and add its bin directory to PATH."
        )
    java_version = command_output([java, "--version"], SERVER_DIRECTORY)
    if not java_version or not re.search(r"\b21(?:\.|\s)", java_version):
        fail(
            "JDK 21 is required. Configure JAVA_HOME and add its bin directory to PATH."
        )
    maven = resolve_global_maven_command()
    if not maven or not command_output([*maven, "--version"], SERVER_DIRECTORY):
        fail(
            "global Maven is required. Add Maven bin to PATH or set MAVEN_HOME/M2_HOME."
        )
    ok(java_version.splitlines()[0])
    ok(f"global Maven found: {maven[0]}")
    return maven


def check_docker() -> str:
    docker = resolve_executable("docker")
    if not docker or not command_output([docker, "--version"], SCRIPT_DIRECTORY):
        fail("Docker is required for local infrastructure.")
    if not command_output([docker, "compose", "version"], SCRIPT_DIRECTORY):
        fail("Docker Compose v2 is required.")
    info_result = run_captured([docker, "info"], SCRIPT_DIRECTORY)
    if info_result.status != 0:
        fail("Docker daemon is not reachable. Start Docker Desktop first.")
    ok("Docker and Docker Compose are available")
    return docker


def compose_command(docker: str, *arguments: str) -> list[str]:
    return [
        docker,
        "compose",
        "--profile",
        "java",
        "-f",
        str(COMPOSE_FILE),
        *arguments,
    ]


def observability_compose_command(docker: str, *arguments: str) -> list[str]:
    return [
        docker,
        "compose",
        "--profile",
        "java",
        "--profile",
        "observability",
        "-f",
        str(COMPOSE_FILE),
        *arguments,
    ]


def runnable_jar(module: str) -> Path | None:
    target = SERVER_DIRECTORY / module / "target"
    if not target.exists():
        return None
    jars = sorted(target.glob("*-exec.jar"))
    return jars[0] if len(jars) == 1 else None


def package_java_services(maven: list[str], skip_package: bool) -> None:
    if skip_package:
        warn("--skip-package: using existing local Java JARs")
    else:
        info("Packaging Java services with the global Maven and local JDK 21...")
        run_checked(
            [*maven, "-B", "-ntp", "-DskipTests", "package"], SERVER_DIRECTORY
        )
    modules = [
        "migration",
        "gateway",
        *[service.module for service in LOCAL_SERVICES],
    ]
    missing = [module for module in modules if not runnable_jar(module)]
    if missing:
        fail("runnable JAR missing for: " + ", ".join(missing))
    ok("local Java runtime JARs are ready")


def require_observability_agent(agent_path: Path = OTEL_JAVA_AGENT) -> Path:
    if not agent_path.exists() or agent_path.stat().st_size == 0:
        fail(
            "OpenTelemetry Java agent is missing. Run without --skip-package once "
            "so Maven downloads server/target/observability/opentelemetry-javaagent.jar."
        )
    return agent_path


def stop_docker_java_services(docker: str) -> None:
    info(
        "Stopping Compose Java application containers; Docker infrastructure remains running"
    )
    run_checked(
        compose_command(docker, "stop", *DOCKER_JAVA_SERVICES), SCRIPT_DIRECTORY
    )


def start_docker_infrastructure(docker: str) -> None:
    info(
        "Starting PostgreSQL, Redis, RabbitMQ, MinIO, Nacos MySQL, Nacos and Seata in Docker..."
    )
    run_checked(
        compose_command(docker, "up", "-d", *DOCKER_INFRA_SERVICES), SCRIPT_DIRECTORY
    )
    wait_for_tcp("PostgreSQL", 5432, 90_000)
    wait_for_tcp("Redis", 6379, 90_000)
    wait_for_tcp("RabbitMQ", 5672, 90_000)
    wait_for_tcp("MinIO", 9000, 90_000)
    wait_for_http(
        "Nacos", "http://127.0.0.1:8849/v3/console/health/readiness", 120_000
    )
    wait_for_tcp("Nacos gRPC", 9848, 120_000)
    wait_for_tcp("Seata", 8091, 90_000)
    ok("Docker development infrastructure is ready")


def write_host_prometheus_targets(
    service_names: set[str],
    include_gateway: bool,
    target_directory: Path = HOST_PROMETHEUS_TARGETS,
) -> None:
    target_directory.mkdir(parents=True, exist_ok=True)
    gateway_targets = (
        [{"targets": ["host.docker.internal:8080"], "labels": {"service": "gateway"}}]
        if include_gateway
        else []
    )
    service_ports = {service.name: service.port for service in LOCAL_SERVICES}
    service_targets = []
    for name in sorted(service_names):
        port = service_ports.get(name)
        if not port:
            fail(f"cannot write Prometheus target for unknown service: {name}")
        service_targets.append(
            {"targets": [f"host.docker.internal:{port}"], "labels": {"service": name}}
        )
    (target_directory / "gateway.json").write_text(
        json.dumps(gateway_targets), encoding="utf-8"
    )
    (target_directory / "services.json").write_text(
        json.dumps(service_targets), encoding="utf-8"
    )


def start_observability(
    docker: str, service_names: set[str], include_gateway: bool
) -> None:
    write_host_prometheus_targets(service_names, include_gateway)
    configured_data_root = os.environ.get("DRAMAIP_COMPOSE_DATA_ROOT")
    if configured_data_root:
        data_root = (
            Path(configured_data_root)
            if os.path.isabs(configured_data_root)
            else OBSERVABILITY_COMPOSE_DIRECTORY / configured_data_root
        )
    else:
        data_root = OBSERVABILITY_COMPOSE_DIRECTORY / "docker-data"
    for name in DOCKER_OBSERVABILITY_SERVICES:
        directory = data_root / name
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o777)
    environment = dict(os.environ)
    environment["DRAMAIP_PROMETHEUS_CONFIG"] = str(HOST_PROMETHEUS_CONFIG)
    environment["DRAMAIP_HOST_LOG_DIR"] = str(LOCAL_LOG_DIRECTORY)
    environment["DRAMAIP_PROMETHEUS_TARGETS_DIR"] = str(HOST_PROMETHEUS_TARGETS)
    info("Starting Prometheus, Alloy, Loki, Tempo and Grafana...")
    run_checked(
        observability_compose_command(
            docker, "up", "-d", "--remove-orphans", *DOCKER_OBSERVABILITY_SERVICES
        ),
        SCRIPT_DIRECTORY,
        environment,
    )
    wait_for_http("Prometheus", "http://127.0.0.1:9090/-/ready", 90_000)
    wait_for_http("Alloy", "http://127.0.0.1:12345/-/ready", 90_000)
    wait_for_tcp("Alloy OTLP HTTP", 4318, 90_000)
    wait_for_http("Loki", "http://127.0.0.1:3100/ready", 90_000)
    wait_for_http("Tempo", "http://127.0.0.1:3200/ready", 90_000)
    wait_for_http("Grafana", "http://127.0.0.1:3000/api/health", 120_000)
    ok("local observability stack is ready")


def can_connect(port: int) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(1.0)
    try:
        probe.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def wait_for_tcp(label: str, port: int, timeout: float) -> None:
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if _shutdown_signal:
            raise ShutdownError()
        if can_connect(port):
            return
        _shutdown_event.wait(1.0)
        _shutdown_event.clear()
    fail(
        f"{label} did not accept connections on 127.0.0.1:{port} "
        f"within {round(timeout / 1000)}s"
    )


def wait_for_http(
    label: str,
    url: str,
    timeout: float,
    child: subprocess.Popen[bytes] | None = None,
) -> None:
    deadline = time.monotonic() + timeout / 1000
    last_error = ""
    while time.monotonic() < deadline:
        if _shutdown_signal:
            raise ShutdownError()
        if child is not None:
            code = child_exit_code(child)
            if code is not None:
                fail(f"{label} exited during startup with code {code}")
        try:
            request = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(request, timeout=2) as response:
                if 200 <= response.status < 300:
                    return
                last_error = f"HTTP {response.status}"
        except urllib.error.HTTPError as error:
            last_error = f"HTTP {error.code}"
        except Exception as error:  # noqa: BLE001 - 记录最后一次失败原因
            last_error = str(error)
        _shutdown_event.wait(1.0)
        _shutdown_event.clear()
    fail(f"{label} was not healthy within {round(timeout / 1000)}s: {last_error}")


def local_environment(observability: bool = False) -> dict[str, str]:
    environment = dict(os.environ)
    database_password = (
        environment.get("DRAMAIP_MIGRATION_ROLE_PASSWORD")
        or environment.get("POSTGRES_PASSWORD")
        or "dramaip"
    )
    environment.update(
        {
            "POSTGRES_DSN": (
                "jdbc:postgresql://127.0.0.1:5432/"
                f"{environment.get('POSTGRES_DB', 'dramaip')}"
            ),
            "POSTGRES_PASSWORD": database_password,
            "HISTORICAL_MIGRATIONS_APPLY_PENDING": "true",
            "NACOS_SERVER_ADDR": "127.0.0.1:8848",
            "SPRING_CLOUD_NACOS_DISCOVERY_IP": "127.0.0.1",
            "SPRING_CLOUD_NACOS_DISCOVERY_GROUP": environment.get(
                "SPRING_CLOUD_NACOS_DISCOVERY_GROUP", "DRAMAIP_LOCAL_DEV"
            ),
            "SEATA_SERVER_ADDR": "127.0.0.1:8091",
            "REDIS_HOST": "127.0.0.1",
            "REDIS_PORT": "6379",
            "REDIS_PASSWORD": environment.get("REDIS_PASSWORD", "dramaip"),
            "SPRING_DATA_REDIS_HOST": "127.0.0.1",
            "SPRING_DATA_REDIS_PORT": "6379",
            "SPRING_DATA_REDIS_PASSWORD": environment.get(
                "REDIS_PASSWORD", "dramaip"
            ),
            "SPRING_RABBITMQ_HOST": "127.0.0.1",
            "SPRING_RABBITMQ_PORT": "5672",
            "SPRING_RABBITMQ_USERNAME": environment.get(
                "RABBITMQ_USER", "dramaip"
            ),
            "SPRING_RABBITMQ_PASSWORD": environment.get(
                "RABBITMQ_PASSWORD", "dramaip"
            ),
            "JWT_ENABLED": environment.get("JWT_ENABLED", "true"),
            "JWT_JWK_SET_URI": environment.get(
                "JWT_JWK_SET_URI", "http://127.0.0.1:8081/.well-known/jwks.json"
            ),
            "DRAMAIP_INTERNAL_TOKEN": environment.get(
                "DRAMAIP_INTERNAL_TOKEN", "change-me-internal"
            ),
            "IDENTITY_ALLOW_EPHEMERAL_JWT": environment.get(
                "IDENTITY_ALLOW_EPHEMERAL_JWT", "true"
            ),
            "REVIEW_S3_ENDPOINT": environment.get(
                "REVIEW_S3_ENDPOINT", "http://127.0.0.1:9000"
            ),
            "REVIEW_S3_REGION": environment.get("REVIEW_S3_REGION", "us-east-1"),
            "REVIEW_S3_BUCKET": environment.get(
                "REVIEW_S3_BUCKET", "dramaip-review"
            ),
            "REVIEW_S3_ACCESS_KEY": environment.get(
                "REVIEW_S3_ACCESS_KEY", "dramaip-review"
            ),
            "REVIEW_S3_SECRET_KEY": environment.get(
                "REVIEW_S3_SECRET_KEY", "dramaip-review-development-secret"
            ),
            "REVIEW_S3_ALLOW_INSECURE": environment.get(
                "REVIEW_S3_ALLOW_INSECURE", "true"
            ),
        }
    )
    if observability:
        environment.update(
            {
                "DRAMAIP_DEPLOYMENT_ENVIRONMENT": environment.get(
                    "DRAMAIP_DEPLOYMENT_ENVIRONMENT", "local"
                ),
                "DRAMAIP_SERVICE_VERSION": environment.get(
                    "DRAMAIP_SERVICE_VERSION", "development"
                ),
                "DRAMAIP_RELEASE_NAME": environment.get(
                    "DRAMAIP_RELEASE_NAME", "host-local"
                ),
                "OTEL_RESOURCE_ATTRIBUTES": environment.get(
                    "OTEL_RESOURCE_ATTRIBUTES",
                    "deployment.environment.name=local,service.version=development,"
                    "service.namespace=dramaip-platform,dramaip.release=host-local",
                ),
                "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
                "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
                "OTEL_TRACES_EXPORTER": "otlp",
                "OTEL_METRICS_EXPORTER": "none",
                "OTEL_LOGS_EXPORTER": "none",
                "OTEL_PROPAGATORS": "tracecontext,baggage",
                "OTEL_TRACES_SAMPLER": environment.get(
                    "OTEL_TRACES_SAMPLER", "always_on"
                ),
                "OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST": "",
                "OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_CLIENT_REQUEST": "",
                "OTEL_INSTRUMENTATION_COMMON_DB_QUERY_SANITIZATION_ENABLED": "true",
            }
        )
    return environment


def build_migration_command(
    java: str, migration_jar: str, agent: str | None = None
) -> list[str]:
    return [
        java,
        *LOCAL_DIRECT_SOCKET_JAVA_OPTS,
        *([f"-javaagent:{agent}"] if agent else []),
        "-jar",
        migration_jar,
    ]


def run_migration(environment: dict[str, str], agent: str | None = None) -> None:
    migration_jar = runnable_jar("migration")
    if not migration_jar:
        fail("migration executable JAR is missing")
    migration_environment = dict(environment)
    migration_environment["POSTGRES_USER"] = environment.get("POSTGRES_USER", "dramaip")
    migration_environment["DB_ROLE_BOOTSTRAP"] = environment.get(
        "DB_ROLE_BOOTSTRAP", "true"
    )
    migration_environment["DRAMAIP_MIGRATION_ROLE_PASSWORD"] = environment.get(
        "POSTGRES_PASSWORD", ""
    )
    migration_environment["HISTORICAL_MIGRATIONS_DIR"] = str(
        HISTORICAL_MIGRATIONS_DIRECTORY
    )
    info("Running the Java migration job locally...")
    command = build_migration_command(
        resolve_executable("java") or "java", str(migration_jar), agent
    )
    if agent:
        migration_environment["OTEL_SERVICE_NAME"] = "migration"
    run_checked(command, SERVER_DIRECTORY, migration_environment)
    ok("local Java migration job completed")


def listening_pids(port: int) -> list[int]:
    if platform.system() == "Windows":
        result = run_captured(["netstat", "-ano", "-p", "TCP"])
        if result.status != 0:
            return []
        pids: list[int] = []
        for line in result.stdout.splitlines():
            fields = line.strip().split()
            if (
                len(fields) < 5
                or fields[0].upper() != "TCP"
                or (fields[-2] or "").upper() != "LISTENING"
                or fields[1].split(":")[-1] != str(port)
            ):
                continue
            try:
                pid = int(fields[-1])
            except ValueError:
                continue
            if pid != CURRENT_PID and pid not in pids:
                pids.append(pid)
        return pids
    lsof = resolve_executable("lsof")
    if not lsof:
        fail("lsof is required to inspect local Java ports")
    result = run_captured(
        [lsof, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"]
    )
    if result.status not in (0, 1):
        return []
    found: list[int] = []
    for token in result.stdout.split():
        try:
            pid = int(token)
        except ValueError:
            continue
        if pid > 0 and pid != CURRENT_PID and pid not in found:
            found.append(pid)
    return found


def docker_containers_publishing(docker: str, port: int) -> list[str]:
    result = run_captured(
        [docker, "ps", "--filter", f"publish={port}", "--format", "{{.ID}}"],
        SCRIPT_DIRECTORY,
    )
    if result.status != 0:
        fail(f"could not inspect Docker containers publishing port {port}")
    return list(dict.fromkeys(token for token in result.stdout.split() if token))


def process_command(pid: int) -> str:
    if platform.system() == "Windows":
        command = ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"]
    else:
        command = ["ps", "-p", str(pid), "-o", "command="]
    result = run_captured(command)
    return result.stdout.strip() if result.status == 0 else ""


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def is_docker_process(pid: int) -> bool:
    command = process_command(pid).lower()
    return any(
        marker in command
        for marker in ("com.docker", "docker-proxy", "dockerd", "vpnkit")
    )


def kill_pids(pids: list[int], label: str) -> None:
    docker_pids = [pid for pid in pids if is_docker_process(pid)]
    targets = [pid for pid in pids if pid not in docker_pids]
    if docker_pids:
        warn(
            f"{label} is still held by Docker PID(s) "
            f"{', '.join(str(pid) for pid in docker_pids)}; "
            "Docker Desktop itself will not be killed."
        )
    if not targets:
        return
    warn(
        f"{label} is occupied by PID(s) {', '.join(str(pid) for pid in targets)}; "
        "force-stopping them."
    )

    for pid in targets:
        if platform.system() == "Windows":
            result = run_captured(["taskkill", "/PID", str(pid), "/T", "/F"])
            if result.status != 0:
                warn(
                    f"taskkill could not stop PID {pid}: "
                    f"{(result.stderr or result.stdout).strip()}"
                )
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except OSError:
                fail(f"no permission to stop PID {pid} for {label}")
    if platform.system() == "Windows":
        return

    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and any(process_exists(pid) for pid in targets):
        sleep(200)
    remaining = [pid for pid in targets if process_exists(pid)]
    if not remaining:
        return
    warn(
        f"{label} did not stop gracefully; force-killing PID(s) "
        f"{', '.join(str(pid) for pid in remaining)}."
    )
    for pid in remaining:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            fail(f"no permission to force stop PID {pid} for {label}")


def release_port(docker: str, label: str, port: int) -> None:
    containers = docker_containers_publishing(docker, port)
    if containers:
        warn(
            f"{label} port {port} is published by Docker container(s) "
            f"{', '.join(containers)}; stopping them."
        )
        result = run_captured(
            [docker, "stop", "--timeout", "3", *containers], SCRIPT_DIRECTORY
        )
        if result.status != 0:
            fail(
                f"could not stop Docker container(s) on {label} port {port}: "
                f"{(result.stderr or result.stdout).strip()}"
            )
    pids = listening_pids(port)
    if pids:
        kill_pids(pids, f"{label} port {port}")

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if not listening_pids(port):
            return
        sleep(200)
    fail(
        f"{label} port {port} is still occupied by PID(s) "
        f"{', '.join(str(pid) for pid in listening_pids(port))}"
    )


def release_required_ports(
    docker: str,
    service_names: set[str] | None = None,
    include_gateway: bool = True,
) -> None:
    info("Checking local Java application ports before startup...")
    ports: list[tuple[str, int]] = []
    if not service_names:
        ports.append(("Java Gateway", GATEWAY_PORT))
        ports.extend(
            (f"Java {service.name}", service.port) for service in LOCAL_SERVICES
        )
    else:
        wanted = set(service_names)
        wanted.add("identity")
        for service in LOCAL_SERVICES:
            if service.name in wanted:
                ports.append((f"Java {service.name}", service.port))
        if include_gateway:
            ports.append(("Java Gateway", GATEWAY_PORT))
    for label, port in ports:
        release_port(docker, label, port)
    ok("local Java application ports are available")


def split_shell_words(value: str) -> list[str]:
    """拆分带引号的 JVM 参数，不经过 shell。"""
    words: list[str] = []
    word = ""
    quote: str | None = None
    escaping = False
    started = False
    for character in value:
        if escaping:
            word += character
            escaping = False
            started = True
        elif character == "\\" and quote != "'":
            escaping = True
            started = True
        elif quote:
            if character == quote:
                quote = None
            else:
                word += character
            started = True
        elif character in ("'", '"'):
            quote = character
            started = True
        elif character.isspace():
            if started:
                words.append(word)
                word = ""
                started = False
        else:
            word += character
            started = True
    if escaping:
        word += "\\"
    if quote:
        fail("DRAMAIP_JAVA_OPTS contains an unterminated quote")
    if started:
        words.append(word)
    return words


def child_exit_code(child: subprocess.Popen[bytes]) -> int | None:
    code = child.poll()
    if code is None:
        return None
    return code if code >= 0 else 1


def wait_for_exit_with_timeout(child: subprocess.Popen[bytes], timeout: float) -> bool:
    try:
        child.wait(timeout=timeout)
        return True
    except subprocess.TimeoutExpired:
        return False


def start_java_process(
    name: str,
    jar: Path,
    environment: dict[str, str],
    port: int,
    database_user: str | None = None,
    agent: str | None = None,
) -> ManagedJavaProcess:
    service_environment = dict(environment)
    service_environment["SERVER_PORT"] = str(port)
    if database_user:
        service_environment["POSTGRES_USER"] = database_user
    if agent:
        service_environment["OTEL_SERVICE_NAME"] = name
    info(f"Starting local Java {name} on :{port}")
    LOCAL_LOG_DIRECTORY.mkdir(parents=True, exist_ok=True)
    log_path = LOCAL_LOG_DIRECTORY / f"{name}.log"
    java_options = service_environment.get("DRAMAIP_JAVA_OPTS") or DEFAULT_JAVA_OPTS
    info(f"{name} JVM: {java_options}")
    command = [
        resolve_executable("java") or "java",
        *split_shell_words(java_options),
        *LOCAL_DIRECT_SOCKET_JAVA_OPTS,
        *([f"-javaagent:{agent}"] if agent else []),
        "-jar",
        str(jar),
    ]
    with open(log_path, "a", encoding="utf-8") as log:
        child = subprocess.Popen(
            command,
            cwd=str(SERVER_DIRECTORY),
            env=service_environment,
            shell=requires_command_shell(command[0]),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    info(f"{name} log: {log_path}")
    return ManagedJavaProcess(name=name, process=child)


def stop_java_process(managed: ManagedJavaProcess) -> None:
    child = managed.process
    if child is None or child.poll() is not None:
        return
    warn(f"Stopping local Java {managed.name}...")
    if platform.system() != "Windows" and child.pid:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except (ProcessLookupError, OSError):
            child.terminate()
    else:
        child.terminate()
    if not wait_for_exit_with_timeout(child, 8.0):
        if platform.system() != "Windows" and child.pid:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except (ProcessLookupError, OSError):
                child.kill()
        else:
            child.kill()
        wait_for_exit_with_timeout(child, 2.0)


def stop_java_processes(processes: list[ManagedJavaProcess]) -> None:
    for managed in reversed(processes):
        stop_java_process(managed)


def parse_services(value: str | None) -> set[str] | None:
    if not value:
        return None
    return {part.strip() for part in value.split(",") if part.strip()}


def resolve_selected_services(selected: set[str] | None = None) -> set[str]:
    all_names = {service.name for service in LOCAL_SERVICES}
    if not selected:
        return all_names
    unknown = sorted(name for name in selected if name not in all_names)
    if unknown:
        fail(
            "unknown service(s) for --services: "
            f"{', '.join(unknown)} (available: {', '.join(sorted(all_names))})"
        )
    names = set(selected)
    names.add("identity")
    return names


def start_local_java_services(
    environment: dict[str, str],
    processes: list[ManagedJavaProcess],
    selected: set[str] | None,
    start_gateway: bool,
    agent: str | None = None,
) -> None:
    names = resolve_selected_services(selected)
    identity_service = LOCAL_SERVICES[0]
    identity_jar = runnable_jar(identity_service.module)
    if not identity_jar:
        fail("identity executable JAR is missing")
    identity = start_java_process(
        identity_service.name,
        identity_jar,
        environment,
        identity_service.port,
        identity_service.database_user,
        agent,
    )
    processes.append(identity)
    wait_for_http(
        "identity",
        "http://127.0.0.1:8081/actuator/health",
        90_000,
        identity.process,
    )

    for service in LOCAL_SERVICES[1:]:
        if service.name not in names:
            continue
        jar = runnable_jar(service.module)
        if not jar:
            fail(f"{service.name} executable JAR is missing")
        processes.append(
            start_java_process(
                service.name,
                jar,
                environment,
                service.port,
                service.database_user,
                agent,
            )
        )
    for service in LOCAL_SERVICES[1:]:
        managed = next(
            (item for item in processes if item.name == service.name), None
        )
        if managed:
            wait_for_http(
                service.name,
                f"http://127.0.0.1:{service.port}/actuator/health",
                90_000,
                managed.process,
            )

    if not start_gateway:
        warn(
            "--no-gateway: skipping gateway; selected services run without the public entrypoint"
        )
        return
    gateway_jar = runnable_jar("gateway")
    if not gateway_jar:
        fail("gateway executable JAR is missing")
    gateway = start_java_process(
        "gateway", gateway_jar, environment, GATEWAY_PORT, None, agent
    )
    processes.append(gateway)
    wait_for_http(
        "gateway",
        f"http://127.0.0.1:{GATEWAY_PORT}/actuator/health",
        90_000,
        gateway.process,
    )


def watch_java_processes(
    processes: list[ManagedJavaProcess], observability: bool
) -> int:
    ok("local Java development stack is ready")
    sys.stdout.write("\n")
    names = [managed.name for managed in processes]
    if "gateway" in names:
        sys.stdout.write("Gateway: http://127.0.0.1:8080\n")
        sys.stdout.write("Gateway health: http://127.0.0.1:8080/actuator/health\n")
    sys.stdout.write("Nacos console: http://127.0.0.1:8849\n")
    service_ports = {service.name: service.port for service in LOCAL_SERVICES}
    detail = ", ".join(
        f"{name} :{service_ports.get(name)}" for name in names if name != "gateway"
    )
    sys.stdout.write(f"Java services: {detail}\n")
    sys.stdout.write("Start clients separately: python3 run-platform-clients.py\n")
    if observability:
        sys.stdout.write(
            "Observability: Prometheus http://127.0.0.1:9090 · Alloy http://127.0.0.1:12345 · "
            "Loki http://127.0.0.1:3100 · Tempo http://127.0.0.1:3200 · Grafana http://127.0.0.1:3000\n"
        )
    sys.stdout.write(
        "Press Ctrl+C to stop local Java processes. Docker infrastructure remains running.\n"
    )
    sys.stdout.flush()

    while True:
        if _shutdown_signal:
            warn(f"Received {shutdown_reason()}.")
            return 0
        for managed in processes:
            if managed.process is None:
                continue
            code = child_exit_code(managed.process)
            if code is not None:
                warn(f"local Java {managed.name} exited with code {code}")
                return code or 1
        _shutdown_event.wait(0.5)
        _shutdown_event.clear()


def main(arguments: list[str] | None = None) -> int:
    options = parse_development_arguments(
        sys.argv[1:] if arguments is None else arguments
    )
    if options is None:
        return 0
    selected = parse_services(options.services)
    processes: list[ManagedJavaProcess] = []
    try:
        check_layout()
        install_shutdown_handlers()
        check_pnpm_runtime()
        maven = check_java_and_maven()
        docker = check_docker()
        stop_docker_java_services(docker)
        resolved_services = resolve_selected_services(selected)
        release_required_ports(docker, resolved_services, not options.no_gateway)
        package_java_services(maven, options.skip_package)
        agent = (
            str(require_observability_agent()) if options.observability else None
        )
        if options.no_infrastructure:
            warn("--no-infra: assuming Docker infrastructure is already running")
        else:
            start_docker_infrastructure(docker)
        if options.observability:
            start_observability(docker, resolved_services, not options.no_gateway)
        environment = local_environment(options.observability)
        run_migration(environment, agent)
        if not selected:
            info("Starting the full local Java stack")
        else:
            info(
                f"--services: starting {', '.join(sorted(resolved_services))}"
                + (
                    " (--no-gateway)"
                    if options.no_gateway
                    else " (plus gateway)"
                )
            )
        start_local_java_services(
            environment, processes, selected, not options.no_gateway, agent
        )
        if options.smoke:
            if options.observability and not options.no_gateway:
                node = resolve_executable("node")
                if not node:
                    fail("Node.js is required for the observability smoke check")
                run_checked(
                    [
                        node,
                        str(PLATFORM_DIRECTORY / "scripts" / "observability-smoke.mjs"),
                    ],
                    PLATFORM_DIRECTORY,
                    environment,
                )
            elif options.observability:
                warn(
                    "--obs --smoke without Gateway: Java health smoke passed; "
                    "observability request smoke was skipped"
                )
            ok("local Java development smoke check passed")
            return 0
        return watch_java_processes(processes, options.observability)
    except ShutdownError:
        warn(f"Received {shutdown_reason()}.")
        return 0
    except Exception as error:  # noqa: BLE001 - 统一转成退出码
        sys.stderr.write(f"ERR {error}\n")
        return 1
    finally:
        stop_java_processes(processes)


if __name__ == "__main__":
    sys.exit(main())
