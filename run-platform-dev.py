#!/usr/bin/env python3
"""Run the Java DramaIP services on the host and development infrastructure in Docker.

This launcher deliberately starts no Java application container. PostgreSQL,
Redis, RabbitMQ, MinIO, Nacos and Seata continue to use the single Compose
file, while migration, Gateway and all six domain services run with the local
JDK 21. It is intended for debugger and hot-code-package development. Start
the Web client separately with ``run-platform-clients.py``.

Usage:
  python run-platform-dev.py
  python run-platform-dev.py --skip-package
  python run-platform-dev.py --no-infra
  python run-platform-dev.py --skip-package --smoke
  python run-platform-dev.py --services creation,quota      # only identity + creation + quota + gateway
  python run-platform-dev.py --services creation --no-gateway

  # In another terminal, after the Gateway is ready:
  python run-platform-clients.py
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR / "dramaip-platform"
SERVER_DIR = PLATFORM_DIR / "server"
COMPOSE_FILE = PLATFORM_DIR / "deploy" / "docker-drama" / "docker-compose.yaml"
LEGACY_MIGRATIONS_DIR = PLATFORM_DIR / "legacy" / "go-services" / "migrations"
LOCAL_LOG_DIR = SERVER_DIR / "target" / "local-dev"

CURRENT_PID = os.getpid()
GATEWAY_PORT = 8080
# Local Java services run directly on the host, where a MaxRAMPercentage-based
# limit is computed against the whole machine (e.g. ~23GB on a 31GB host). That
# grants each of the seven services a licence far beyond physical RAM and causes
# heavy GC and paging. Use a fixed, conservative heap by default; override with
# the DRAMAIP_JAVA_OPTS environment variable when a service needs more.
DEFAULT_JAVA_OPTS = "-Xmx512m -Xms256m -XX:MaxRAMPercentage=50 -XX:+UseG1GC"
LOCAL_SERVICES = (
    ("identity", "services/identity", 8081, "dramaip_identity_svc"),
    ("support", "services/support", 8082, "dramaip_support_svc"),
    ("creation", "services/creation", 8083, "dramaip_creation_svc"),
    ("quota", "services/quota", 8084, "dramaip_quota_svc"),
    ("ai", "services/ai", 8085, "dramaip_ai_svc"),
    ("billing", "services/billing", 8086, "dramaip_billing_svc"),
)
DOCKER_INFRA_SERVICES = ("postgres", "redis", "rabbitmq", "minio", "minio-init", "nacos", "seata")
DOCKER_JAVA_SERVICES = ("java-migration", "java-gateway", "identity", "support", "creation", "java-quota", "ai", "java-billing")
LOCAL_JAVA_PORTS = (
    ("Java Gateway", GATEWAY_PORT),
    *((f"Java {name}", port) for name, _, port, _ in LOCAL_SERVICES),
)
TEXT_CAPTURE_OPTIONS = {
    "capture_output": True,
    "text": True,
    "encoding": "mbcs" if os.name == "nt" else "utf-8",
    "errors": "replace",
}
_SHUTDOWN_SIGNAL: int | None = None


def info(message: str) -> None:
    print(f"* {message}")


def ok(message: str) -> None:
    print(f"OK {message}")


def warn(message: str) -> None:
    print(f"! {message}")


def err(message: str) -> None:
    print(f"ERR {message}", file=sys.stderr)


def request_shutdown(signum: int, _frame: object) -> None:
    global _SHUTDOWN_SIGNAL
    if _SHUTDOWN_SIGNAL is not None:
        return
    _SHUTDOWN_SIGNAL = signum
    raise KeyboardInterrupt


def shutdown_reason() -> str:
    if _SHUTDOWN_SIGNAL is None:
        return "Ctrl+C"
    try:
        return signal.Signals(_SHUTDOWN_SIGNAL).name
    except ValueError:
        return f"signal {_SHUTDOWN_SIGNAL}"


def command_output(command: list[str], cwd: Path) -> str | None:
    try:
        result = subprocess.run(command, cwd=str(cwd), **TEXT_CAPTURE_OPTIONS)
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return (result.stdout or "").strip()


def resolve_global_maven_command() -> list[str] | None:
    command_names = ("mvn.cmd", "mvn") if os.name == "nt" else ("mvn",)
    for command_name in command_names:
        executable = shutil.which(command_name)
        if executable:
            return [executable]
    for variable in ("MAVEN_HOME", "M2_HOME"):
        maven_home = os.environ.get(variable)
        if not maven_home:
            continue
        executable = Path(maven_home) / "bin" / ("mvn.cmd" if os.name == "nt" else "mvn")
        if executable.is_file():
            return [str(executable)]
    return None


def check_layout() -> None:
    missing = [path for path in (PLATFORM_DIR, SERVER_DIR, COMPOSE_FILE, LEGACY_MIGRATIONS_DIR) if not path.exists()]
    if missing:
        raise RuntimeError("missing required paths: " + ", ".join(str(path) for path in missing))
    ok("platform development layout found")


def check_java_and_maven() -> list[str]:
    java_version = command_output(["java", "--version"], SERVER_DIR)
    if not java_version or " 21" not in f" {java_version}":
        raise RuntimeError("JDK 21 is required. Configure JAVA_HOME and add its bin directory to PATH.")
    maven_command = resolve_global_maven_command()
    if not maven_command or not command_output(maven_command + ["--version"], SERVER_DIR):
        raise RuntimeError("global Maven is required. Add Maven bin to PATH or set MAVEN_HOME/M2_HOME.")
    ok(java_version.splitlines()[0])
    ok("global Maven found: " + maven_command[0])
    return maven_command


def check_docker() -> None:
    if not command_output(["docker", "--version"], SCRIPT_DIR):
        raise RuntimeError("Docker is required for local infrastructure.")
    if not command_output(["docker", "compose", "version"], SCRIPT_DIR):
        raise RuntimeError("Docker Compose v2 is required.")
    if subprocess.run(["docker", "info"], cwd=str(SCRIPT_DIR)).returncode != 0:
        raise RuntimeError("Docker daemon is not reachable. Start Docker Desktop first.")
    ok("Docker and Docker Compose are available")


def compose_command(*args: str) -> list[str]:
    return ["docker", "compose", "--profile", "java", "-f", str(COMPOSE_FILE), *args]


def run_checked(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    try:
        subprocess.run(command, cwd=str(cwd), env=env, check=True)
    except FileNotFoundError as exception:
        raise RuntimeError(f"command not found: {command[0]}") from exception
    except subprocess.CalledProcessError as exception:
        raise RuntimeError(f"command failed ({exception.returncode}): {' '.join(command)}") from exception


def package_java_services(maven_command: list[str], skip_package: bool) -> None:
    if skip_package:
        warn("--skip-package: using existing local Java JARs")
    else:
        info("Packaging Java services with the global Maven and local JDK 21...")
        run_checked(maven_command + ["-B", "-ntp", "-DskipTests", "package"], SERVER_DIR)
    required_modules = ("migration", "gateway", *(module for _, module, _, _ in LOCAL_SERVICES))
    missing = [module for module in required_modules if not runnable_jar(module)]
    if missing:
        raise RuntimeError("runnable JAR missing for: " + ", ".join(missing))
    ok("local Java runtime JARs are ready")


def runnable_jar(module: str) -> Path | None:
    jars = sorted((SERVER_DIR / module / "target").glob("*-exec.jar"))
    return jars[0] if len(jars) == 1 else None


def stop_docker_java_services() -> None:
    """Ensure a previous Compose Java run cannot occupy Gateway port 8080."""
    info("Stopping Compose Java application containers; Docker infrastructure remains running")
    result = subprocess.run(compose_command("stop", *DOCKER_JAVA_SERVICES), cwd=str(SCRIPT_DIR))
    if result.returncode != 0:
        raise RuntimeError("could not stop Compose Java application containers")


def start_docker_infrastructure() -> None:
    info("Starting PostgreSQL, Redis, RabbitMQ, MinIO, Nacos and Seata in Docker...")
    run_checked(compose_command("up", "-d", *DOCKER_INFRA_SERVICES), SCRIPT_DIR)
    wait_for_tcp("PostgreSQL", 5432, 90.0)
    wait_for_tcp("Redis", 6379, 90.0)
    wait_for_tcp("RabbitMQ", 5672, 90.0)
    wait_for_tcp("MinIO", 9000, 90.0)
    wait_for_http("Nacos", "http://127.0.0.1:8849/v3/console/health/readiness", 120.0)
    wait_for_tcp("Nacos gRPC", 9848, 120.0)
    wait_for_tcp("Seata", 8091, 90.0)
    ok("Docker development infrastructure is ready")


def wait_for_tcp(label: str, port: int, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                return
        except OSError:
            time.sleep(1.0)
    raise RuntimeError(f"{label} did not accept connections on 127.0.0.1:{port} within {timeout:.0f}s")


def wait_for_http(label: str, url: str, timeout: float, process: subprocess.Popen[object] | None = None) -> None:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        if process and process.poll() is not None:
            raise RuntimeError(f"{label} exited during startup with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2.0) as response:
                if 200 <= response.status < 300:
                    return
                last_error = f"HTTP {response.status}"
        except (OSError, urllib.error.HTTPError) as exception:
            last_error = str(exception)
        time.sleep(1.0)
    raise RuntimeError(f"{label} was not healthy within {timeout:.0f}s: {last_error}")


def local_environment() -> dict[str, str]:
    environment = os.environ.copy()
    database_password = environment.get("DRAMAIP_MIGRATION_ROLE_PASSWORD", environment.get("POSTGRES_PASSWORD", "dramaip"))
    environment.update(
        {
            "POSTGRES_DSN": f"jdbc:postgresql://127.0.0.1:5432/{environment.get('POSTGRES_DB', 'dramaip')}",
            "POSTGRES_PASSWORD": database_password,
            "NACOS_SERVER_ADDR": "127.0.0.1:8848",
            "SPRING_CLOUD_NACOS_DISCOVERY_IP": "127.0.0.1",
            # Keep host-run services isolated from Docker services that use
            # DEFAULT_GROUP. Otherwise the local gateway can round-robin to a
            # container-only address when both stacks touch the same Nacos.
            "SPRING_CLOUD_NACOS_DISCOVERY_GROUP": environment.get(
                "SPRING_CLOUD_NACOS_DISCOVERY_GROUP", "DRAMAIP_LOCAL_DEV"
            ),
            "SEATA_SERVER_ADDR": "127.0.0.1:8091",
            "REDIS_HOST": "127.0.0.1",
            "REDIS_PORT": "6379",
            "REDIS_PASSWORD": environment.get("REDIS_PASSWORD", "dramaip"),
            # Gateway consumes REDIS_* directly. The business services rely on
            # Spring Boot's native binding, so provide those names as well.
            "SPRING_DATA_REDIS_HOST": "127.0.0.1",
            "SPRING_DATA_REDIS_PORT": "6379",
            "SPRING_DATA_REDIS_PASSWORD": environment.get("REDIS_PASSWORD", "dramaip"),
            "SPRING_RABBITMQ_HOST": "127.0.0.1",
            "SPRING_RABBITMQ_PORT": "5672",
            "SPRING_RABBITMQ_USERNAME": environment.get("RABBITMQ_USER", "dramaip"),
            "SPRING_RABBITMQ_PASSWORD": environment.get("RABBITMQ_PASSWORD", "dramaip"),
            "JWT_ENABLED": environment.get("JWT_ENABLED", "true"),
            "JWT_JWK_SET_URI": environment.get("JWT_JWK_SET_URI", "http://127.0.0.1:8081/.well-known/jwks.json"),
            "DRAMAIP_INTERNAL_TOKEN": environment.get("DRAMAIP_INTERNAL_TOKEN", "change-me-internal"),
            "IDENTITY_ALLOW_EPHEMERAL_JWT": environment.get("IDENTITY_ALLOW_EPHEMERAL_JWT", "true"),
            "REVIEW_S3_ENDPOINT": environment.get("REVIEW_S3_ENDPOINT", "http://127.0.0.1:9000"),
            "REVIEW_S3_REGION": environment.get("REVIEW_S3_REGION", "us-east-1"),
            "REVIEW_S3_BUCKET": environment.get("REVIEW_S3_BUCKET", "dramaip-review"),
            "REVIEW_S3_ACCESS_KEY": environment.get("REVIEW_S3_ACCESS_KEY", "dramaip-review"),
            "REVIEW_S3_SECRET_KEY": environment.get("REVIEW_S3_SECRET_KEY", "dramaip-review-development-secret"),
            "REVIEW_S3_ALLOW_INSECURE": environment.get("REVIEW_S3_ALLOW_INSECURE", "true"),
        }
    )
    return environment


def run_migration(environment: dict[str, str]) -> None:
    migration_jar = runnable_jar("migration")
    if not migration_jar:
        raise RuntimeError("migration executable JAR is missing")
    migration_environment = environment.copy()
    migration_environment.update(
        {
            "POSTGRES_USER": migration_environment.get("POSTGRES_USER", "dramaip"),
            "DB_ROLE_BOOTSTRAP": migration_environment.get("DB_ROLE_BOOTSTRAP", "true"),
            "DRAMAIP_MIGRATION_ROLE_PASSWORD": migration_environment["POSTGRES_PASSWORD"],
            "LEGACY_MIGRATIONS_DIR": str(LEGACY_MIGRATIONS_DIR),
        }
    )
    info("Running the Java migration job locally...")
    run_checked(["java", "-jar", str(migration_jar)], SERVER_DIR, migration_environment)
    ok("local Java migration job completed")


def listening_pids(port: int) -> list[int]:
    if platform.system() == "Windows":
        result = subprocess.run(["netstat", "-ano", "-p", "TCP"], **TEXT_CAPTURE_OPTIONS)
        lines = (result.stdout or "").splitlines() if result.returncode == 0 else ()
        pids: list[int] = []
        for line in lines:
            fields = line.split()
            if len(fields) < 5 or fields[0].upper() != "TCP" or fields[-2].upper() != "LISTENING":
                continue
            if fields[1].rsplit(":", 1)[-1] != str(port):
                continue
            try:
                pid = int(fields[-1])
            except ValueError:
                continue
            if pid != CURRENT_PID and pid not in pids:
                pids.append(pid)
        return pids
    result = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], **TEXT_CAPTURE_OPTIONS)
    if result.returncode not in (0, 1):
        return []
    return [int(pid) for pid in (result.stdout or "").split() if pid.isdigit() and int(pid) != CURRENT_PID]


def docker_containers_publishing(port: int) -> list[str]:
    result = subprocess.run(
        ["docker", "ps", "--filter", f"publish={port}", "--format", "{{.ID}}"],
        cwd=str(SCRIPT_DIR),
        **TEXT_CAPTURE_OPTIONS,
    )
    if result.returncode != 0:
        raise RuntimeError(f"could not inspect Docker containers publishing port {port}")
    return list(dict.fromkeys((result.stdout or "").split()))


def process_command(pid: int) -> str:
    command = (
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"]
        if platform.system() == "Windows"
        else ["ps", "-p", str(pid), "-o", "command="]
    )
    result = subprocess.run(command, **TEXT_CAPTURE_OPTIONS)
    return (result.stdout or "").strip() if result.returncode == 0 else ""


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def is_docker_process(pid: int) -> bool:
    command = process_command(pid).lower()
    docker_markers = ("com.docker", "docker-proxy", "dockerd", "vpnkit")
    return any(marker in command for marker in docker_markers)


def kill_pids(pids: list[int], label: str) -> None:
    docker_pids = [pid for pid in pids if is_docker_process(pid)]
    target_pids = [pid for pid in pids if pid not in docker_pids]
    if docker_pids:
        warn(
            f"{label} is still held by Docker PID(s) "
            f"{', '.join(str(pid) for pid in docker_pids)}; Docker Desktop itself will not be killed."
        )
    if not target_pids:
        return

    warn(f"{label} is occupied by PID(s) {', '.join(str(pid) for pid in target_pids)}; force-stopping them.")
    for pid in target_pids:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                **TEXT_CAPTURE_OPTIONS,
            )
            if result.returncode != 0:
                warn(f"taskkill could not stop PID {pid}: {(result.stderr or result.stdout).strip()}")
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        except PermissionError as exception:
            raise RuntimeError(f"no permission to stop PID {pid} for {label}") from exception

    if platform.system() != "Windows":
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline and any(process_exists(pid) for pid in target_pids):
            time.sleep(0.2)
        remaining = [pid for pid in target_pids if process_exists(pid)]
        if remaining:
            warn(f"{label} did not stop gracefully; force-killing PID(s) {', '.join(str(pid) for pid in remaining)}.")
            for pid in remaining:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    continue
                except PermissionError as exception:
                    raise RuntimeError(f"no permission to force stop PID {pid} for {label}") from exception


def release_port(label: str, port: int) -> None:
    containers = docker_containers_publishing(port)
    if containers:
        warn(
            f"{label} port {port} is published by Docker container(s) "
            f"{', '.join(containers)}; stopping them."
        )
        result = subprocess.run(
            ["docker", "stop", "--timeout", "3", *containers],
            cwd=str(SCRIPT_DIR),
            **TEXT_CAPTURE_OPTIONS,
        )
        if result.returncode != 0:
            raise RuntimeError(
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
        time.sleep(0.2)
    remaining = listening_pids(port)
    raise RuntimeError(
        f"{label} port {port} is still occupied by PID(s) "
        f"{', '.join(str(pid) for pid in remaining)}"
    )


def release_required_ports(service_names: set[str] | None = None, include_gateway: bool = True) -> None:
    info("Checking local Java application ports before startup...")
    java_ports: list[tuple[str, int]] = []
    if service_names is None:
        java_ports = list(LOCAL_JAVA_PORTS)
    else:
        # Always include identity (JWKS provider); add gateway unless opted out.
        wanted = set(service_names)
        wanted.add("identity")
        for name, _, port, _ in LOCAL_SERVICES:
            if name in wanted:
                java_ports.append((f"Java {name}", port))
        if include_gateway:
            java_ports.append(("Java Gateway", GATEWAY_PORT))
    for label, port in java_ports:
        release_port(label, port)
    ok("local Java application ports are available")


def start_process(name: str, jar: Path, environment: dict[str, str], port: int, database_user: str | None = None) -> subprocess.Popen[object]:
    service_environment = environment.copy()
    service_environment["SERVER_PORT"] = str(port)
    if database_user:
        service_environment["POSTGRES_USER"] = database_user
    info(f"Starting local Java {name} on :{port}")
    options: dict[str, object] = {"cwd": str(SERVER_DIR), "env": service_environment}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True
    LOCAL_LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOCAL_LOG_DIR / f"{name}.log"
    java_opts = service_environment.get("DRAMAIP_JAVA_OPTS") or DEFAULT_JAVA_OPTS
    info(f"{name} JVM: {java_opts}")
    with log_path.open("ab") as log_file:
        process = subprocess.Popen(
            ["java", *java_opts.split(), "-jar", str(jar)],
            stdout=log_file,
            stderr=subprocess.STDOUT,
            **options,
        )
    info(f"{name} log: {log_path}")
    return process


def stop_process(process: subprocess.Popen[object], name: str) -> None:
    if process.poll() is not None:
        return
    warn(f"Stopping local Java {name}...")
    if os.name == "nt":
        process.terminate()
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except OSError:
            process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def stop_processes(processes: list[tuple[str, subprocess.Popen[object]]]) -> None:
    for name, process in reversed(processes):
        stop_process(process, name)


def resolve_selected_services(selected: set[str] | None) -> tuple[set[str], bool]:
    """Resolve the set of Java services to start.

    ``identity`` is always included: it publishes the JWKS that the gateway and
    every other service consume at startup. ``gateway`` is included unless the
    caller explicitly opts out via ``--no-gateway``. When ``selected`` is None
    (no ``--services``), every domain service in ``LOCAL_SERVICES`` is started.
    """
    all_names = {name for name, *_ in LOCAL_SERVICES}
    if selected is None:
        names = set(all_names)
        start_gateway = True
    else:
        unknown = sorted(selected - all_names)
        if unknown:
            raise RuntimeError(f"unknown service(s) for --services: {', '.join(unknown)} (available: {', '.join(sorted(all_names))})")
        # identity is always required for JWKS; add it transparently.
        names = set(selected)
        names.add("identity")
        start_gateway = True
    return names, start_gateway


def start_local_java_services(
    environment: dict[str, str],
    processes: list[tuple[str, subprocess.Popen[object]]],
    selected: set[str] | None = None,
    start_gateway: bool = True,
) -> None:
    names, gateway_wanted = resolve_selected_services(selected)
    gateway_wanted = gateway_wanted and start_gateway

    # identity always starts first and is awaited: every other service and the
    # gateway fetch /{identity}/.well-known/jwks.json during bootstrap.
    identity_jar = runnable_jar("services/identity")
    if not identity_jar:
        raise RuntimeError("identity executable JAR is missing")
    identity = start_process("identity", identity_jar, environment, 8081, "dramaip_identity_svc")
    processes.append(("identity", identity))
    wait_for_http("identity", "http://127.0.0.1:8081/actuator/health", 90.0, identity)

    # Start the remaining selected domain services in declared order, then wait
    # for each to become healthy before launching the gateway.
    started_names = {"identity"}
    for name, module, port, database_user in LOCAL_SERVICES[1:]:
        if name not in names:
            continue
        jar = runnable_jar(module)
        if not jar:
            raise RuntimeError(f"{name} executable JAR is missing")
        processes.append((name, start_process(name, jar, environment, port, database_user)))
        started_names.add(name)
    for name, _, port, _ in LOCAL_SERVICES[1:]:
        if name not in started_names:
            continue
        process = next(process for process_name, process in processes if process_name == name)
        wait_for_http(name, f"http://127.0.0.1:{port}/actuator/health", 90.0, process)

    if not gateway_wanted:
        warn("--no-gateway: skipping gateway; selected services run without the public entrypoint")
        return

    gateway_jar = runnable_jar("gateway")
    if not gateway_jar:
        raise RuntimeError("gateway executable JAR is missing")
    gateway = start_process("gateway", gateway_jar, environment, GATEWAY_PORT)
    processes.append(("gateway", gateway))
    wait_for_http("gateway", f"http://127.0.0.1:{GATEWAY_PORT}/actuator/health", 90.0, gateway)


def watch(processes: list[tuple[str, subprocess.Popen[object]]]) -> int:
    ok("local Java development stack is ready")
    print("")
    running_names = [name for name, _ in processes]
    has_gateway = "gateway" in running_names
    service_ports = dict((name, port) for name, _, port, _ in LOCAL_SERVICES)
    if has_gateway:
        print("Gateway: http://127.0.0.1:8080")
        print("Gateway health: http://127.0.0.1:8080/actuator/health")
    print("Nacos console: http://127.0.0.1:8849")
    started = [name for name in running_names if name != "gateway"]
    detail = ", ".join(f"{name} :{service_ports[name]}" for name in started)
    print(f"Java services: {detail}")
    print("Start Web client separately: python run-platform-clients.py")
    print("Press Ctrl+C to stop local Java processes. Docker infrastructure remains running.")
    try:
        while True:
            for name, process in processes:
                if process.poll() is not None:
                    warn(f"local Java {name} exited with code {process.returncode}")
                    return process.returncode or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        warn(f"Received {shutdown_reason()}.")
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Java services locally and DramaIP infrastructure in Docker.")
    parser.add_argument("--skip-package", action="store_true", help="Use existing local executable JARs without Maven packaging.")
    parser.add_argument("--no-infra", action="store_true", help="Assume Docker infrastructure is already running.")
    parser.add_argument("--smoke", action="store_true", help="Start and health-check local Java services, then stop them and exit.")
    parser.add_argument(
        "--services",
        default=None,
        help=(
            "Comma-separated subset of domain services to start "
            f"(choices: {', '.join(name for name, *_ in LOCAL_SERVICES)}). "
            "identity is always included because it serves JWKS, and gateway is started by default. "
            "Omit to start the full stack."
        ),
    )
    parser.add_argument("--no-gateway", action="store_true", help="Do not start the gateway (use with --services to run only domain services).")
    return parser.parse_args()


def parse_services(value: str | None) -> set[str] | None:
    if not value:
        return None
    return {part.strip() for part in value.split(",") if part.strip()}


def main() -> int:
    args = parse_args()
    selected = parse_services(args.services)
    processes: list[tuple[str, subprocess.Popen[object]]] = []
    try:
        check_layout()
        signal.signal(signal.SIGINT, request_shutdown)
        signal.signal(signal.SIGTERM, request_shutdown)
        maven_command = check_java_and_maven()
        check_docker()
        stop_docker_java_services()
        # Validate service names before touching ports so a typo fails fast.
        resolved, _ = resolve_selected_services(selected)
        release_required_ports(
            service_names=resolved,
            include_gateway=not args.no_gateway,
        )
        package_java_services(maven_command, args.skip_package)
        if not args.no_infra:
            start_docker_infrastructure()
        else:
            warn("--no-infra: assuming Docker infrastructure is already running")
        environment = local_environment()
        run_migration(environment)
        if selected is None:
            info("Starting the full local Java stack")
        else:
            info(f"--services: starting {', '.join(sorted(resolved))}" + (" (plus gateway)" if not args.no_gateway else " (--no-gateway)"))
        start_local_java_services(environment, processes, selected=selected, start_gateway=not args.no_gateway)
        if args.smoke:
            ok("local Java development smoke check passed")
            return 0
        return watch(processes)
    except (KeyboardInterrupt, RuntimeError) as exception:
        if isinstance(exception, RuntimeError):
            err(str(exception))
        else:
            warn(f"Received {shutdown_reason()}.")
        return 1 if isinstance(exception, RuntimeError) else 0
    finally:
        stop_processes(processes)


if __name__ == "__main__":
    sys.exit(main())
