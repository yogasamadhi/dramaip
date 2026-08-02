#!/usr/bin/env python3
"""
Start the Java DramaIP platform in development mode.

The Compose configuration intentionally uses the Docker daemon's native
platform, so the same command works with Docker Desktop on Windows (amd64) and
macOS (Apple Silicon or Intel).

The Java migration job, Gateway, seven Java domain services, and their local
infrastructure run through Docker Compose.

Use ``run-platform-clients.py`` separately to start the Web client.

Usage:
  python3 run-platform.py
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR / "dramaip-platform"
SERVER_DIR = PLATFORM_DIR / "server"
CURRENT_PID = os.getpid()
_SHUTDOWN_SIGNAL: int | None = None
TEXT_CAPTURE_OPTIONS = {
    "capture_output": True,
    "text": True,
    "encoding": "mbcs" if os.name == "nt" else "utf-8",
    "errors": "replace",
}

# The single Compose file contains local infrastructure and the Java runtime.
COMPOSE_FILE = PLATFORM_DIR / "deploy" / "docker-drama" / "docker-compose.yaml"
GATEWAY_PORT = 8080
GATEWAY_HEALTH_TIMEOUT_S = 120.0
JAVA_APPLICATION_PORTS = (
    ("Java Gateway", GATEWAY_PORT),
)
JAVA_RUNTIME_MODULES = (
    "migration",
    "gateway",
    "services/identity",
    "services/notification",
    "services/reporting",
    "services/creation",
    "services/quota",
    "services/ai",
    "services/billing",
)

_COLOR = sys.stdout.isatty()


def _c(code: str, msg: str) -> str:
    return f"\033[{code}m{msg}\033[0m" if _COLOR else msg


def info(msg: str) -> None:
    print(_c("36", "* ") + msg)


def ok(msg: str) -> None:
    print(_c("32", "OK ") + msg)


def warn(msg: str) -> None:
    print(_c("33", "! ") + msg)


def err(msg: str) -> None:
    print(_c("31", "ERR ") + msg, file=sys.stderr)


def request_shutdown(signum: int, _frame: object) -> None:
    global _SHUTDOWN_SIGNAL
    if _SHUTDOWN_SIGNAL is not None:
        return
    _SHUTDOWN_SIGNAL = signum
    raise KeyboardInterrupt


def install_shutdown_handlers() -> None:
    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)


def shutdown_reason() -> str:
    if _SHUTDOWN_SIGNAL is None:
        return "Ctrl+C"
    try:
        return signal.Signals(_SHUTDOWN_SIGNAL).name
    except ValueError:
        return f"signal {_SHUTDOWN_SIGNAL}"


def command_output(cmd: list[str], cwd: Path) -> str | None:
    try:
        result = subprocess.run(cmd, cwd=str(cwd), **TEXT_CAPTURE_OPTIONS)
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return (result.stdout or "").strip()


def command_ok(cmd: list[str], cwd: Path) -> bool:
    try:
        result = subprocess.run(cmd, cwd=str(cwd), **TEXT_CAPTURE_OPTIONS)
    except FileNotFoundError:
        return False
    return result.returncode == 0


def run_foreground(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    try:
        subprocess.run(cmd, cwd=str(cwd), env=env, check=True)
    except FileNotFoundError:
        err(f"Command not found: {cmd[0]}")
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        err(f"Command failed with exit code {exc.returncode}: {' '.join(cmd)}")
        sys.exit(exc.returncode)


def compose_cmd(*args: str) -> list[str]:
    cmd = [
        "docker", "compose", "--profile", "java",
        "-f", str(COMPOSE_FILE),
        *args,
    ]
    return cmd


def docker_containers_publishing(port: int) -> list[str]:
    result = subprocess.run(
        ["docker", "ps", "--filter", f"publish={port}", "--format", "{{.ID}}"],
        cwd=str(SCRIPT_DIR),
        **TEXT_CAPTURE_OPTIONS,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Could not inspect Docker containers publishing port {port}.")
    return list(dict.fromkeys((result.stdout or "").split()))


def listening_pids(port: int) -> list[int]:
    if platform.system() == "Windows":
        result = subprocess.run(["netstat", "-ano", "-p", "TCP"], **TEXT_CAPTURE_OPTIONS)
        if result.returncode != 0:
            raise RuntimeError(f"netstat failed while checking port {port}.")
        pids: list[int] = []
        for line in (result.stdout or "").splitlines():
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

    if not shutil.which("lsof"):
        raise RuntimeError("lsof is required to inspect occupied ports on this platform.")
    result = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        **TEXT_CAPTURE_OPTIONS,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"lsof failed while checking port {port}.")
    return [
        int(pid) for pid in (result.stdout or "").split()
        if pid.isdigit() and int(pid) != CURRENT_PID
    ]


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
        except PermissionError as exc:
            raise RuntimeError(f"No permission to stop PID {pid} for {label}.") from exc

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
                except PermissionError as exc:
                    raise RuntimeError(f"No permission to force stop PID {pid} for {label}.") from exc


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
                f"Could not stop Docker container(s) on {label} port {port}: "
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
        f"{', '.join(str(pid) for pid in remaining)}."
    )


def release_required_ports() -> None:
    info("Checking Java application ports before startup...")
    for label, port in JAVA_APPLICATION_PORTS:
        release_port(label, port)
    ok("Java application ports are available")


def check_layout() -> None:
    missing = [path for path in (PLATFORM_DIR, SERVER_DIR, COMPOSE_FILE) if not path.exists()]
    if missing:
        err("Missing platform paths:")
        for path in missing:
            err(f"  {path}")
        sys.exit(1)
    ok("platform layout found")
    ok("Java Compose layout found")


def check_docker() -> None:
    docker_version = command_output(["docker", "--version"], SCRIPT_DIR)
    if not docker_version:
        err("Docker is required to run the platform stack. Pass --no-stack to bypass.")
        sys.exit(1)
    compose_version = command_output(["docker", "compose", "version"], SCRIPT_DIR)
    if not compose_version:
        err("Docker Compose v2 is required. Install Docker Desktop or the docker compose plugin.")
        sys.exit(1)
    if not command_ok(["docker", "info"], SCRIPT_DIR):
        err("Docker is installed but the daemon is not reachable. Start Docker Desktop first.")
        sys.exit(1)
    ok(docker_version)
    ok(compose_version)


def resolve_global_maven_command() -> list[str] | None:
    """Locate Maven installed for the current user or system, never a project wrapper."""
    command_names = ("mvn.cmd", "mvn") if os.name == "nt" else ("mvn",)
    for command_name in command_names:
        maven = shutil.which(command_name)
        if maven:
            return [maven]

    for variable in ("MAVEN_HOME", "M2_HOME"):
        maven_home = os.environ.get(variable)
        if not maven_home:
            continue
        executable = Path(maven_home) / "bin" / ("mvn.cmd" if os.name == "nt" else "mvn")
        if executable.is_file():
            return [str(executable)]
    return None


def package_java_server() -> None:
    """Build all Java runtime JARs with the local JDK 21 before Docker packaging."""
    maven_command = resolve_global_maven_command()
    if not maven_command:
        err("Global Maven is unavailable. Install Apache Maven, then add its bin directory to PATH (or set MAVEN_HOME/M2_HOME).")
        sys.exit(1)

    maven_version = command_output(maven_command + ["--version"], SERVER_DIR)
    if not maven_version:
        err("Global Maven could not start. Ensure it uses JDK 21, then retry.")
        sys.exit(1)

    info("Packaging Java services locally with Maven (JDK 21)...")
    run_foreground(maven_command + ["-B", "-ntp", "-DskipTests", "package"], SERVER_DIR)

    missing = [
        module for module in JAVA_RUNTIME_MODULES
        if not list((SERVER_DIR / module / "target").glob("*-exec.jar"))
    ]
    if missing:
        err("Local Maven package did not produce runnable JARs for: " + ", ".join(missing))
        sys.exit(1)
    ok("Java runtime JARs packaged locally")


def ensure_stack_running() -> None:
    """Bring up every service in the Java Compose profile and required local infrastructure."""
    info(f"Packaging runtime images and starting Java platform stack (Gateway :{GATEWAY_PORT})")
    up = subprocess.run(
        compose_cmd("up", "-d", "--build"),
    )
    if up.returncode != 0:
        err(
            "Java stack failed to start. Review the Docker Compose error above; common "
            "conflicts include ports 5432, 5672, 6379, 8080, 8848, 8091, 15672, and 16686."
        )
        sys.exit(1)
    # Rebuilt services may receive new container IPs. Restart Gateway after all
    # profile services are up so its initial discovery state is fresh.
    info("Restarting Java Gateway after service rebuild")
    refresh = subprocess.run(compose_cmd("restart", "java-gateway"))
    if refresh.returncode != 0:
        err("Java Gateway failed to restart after the service rebuild.")
        sys.exit(1)
    health_url = f"http://localhost:{GATEWAY_PORT}/actuator/health"
    info(f"Waiting for Java Gateway health: {health_url}")
    deadline = time.monotonic() + GATEWAY_HEALTH_TIMEOUT_S
    last_error = ""
    while time.monotonic() < deadline:
        healthy, detail = http_ok(health_url, timeout=3.0)
        if healthy:
            ok("Java Gateway health is ready")
            print_compose_status()
            return
        last_error = detail
        time.sleep(2)
    warn(f"Java Gateway health did not become ready within {GATEWAY_HEALTH_TIMEOUT_S:.0f}s: {last_error}")
    print_compose_status()
    warn(f"Continuing so you can inspect logs. Try `{' '.join(compose_cmd('logs', '-f', 'java-gateway', 'identity'))}`.")


def wait_for_shutdown() -> None:
    """Keep the launcher attached so Ctrl+C owns the Compose lifecycle."""
    ok("Java platform stack started")
    print(f"Gateway: http://localhost:{GATEWAY_PORT}")
    print("Start Web client separately: python run-platform-clients.py")
    print("Press Ctrl+C to stop the Java platform stack.")
    while True:
        time.sleep(0.5)


def stop_stack() -> None:
    """Stop every service enabled by the Java Compose profile."""
    warn("Stopping Java platform stack...")
    try:
        result = subprocess.run(compose_cmd("stop"), cwd=str(SCRIPT_DIR))
    except FileNotFoundError:
        warn("Docker command is unavailable; the Java platform stack may still be running.")
        return
    if result.returncode != 0:
        warn("Docker Compose could not stop every Java platform service.")
        return
    ok("Java platform stack stopped")


def http_ok(url: str, timeout: float) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read(512).decode("utf-8", errors="replace")
            if 200 <= response.status < 300:
                return True, body
            return False, f"HTTP {response.status}: {body}"
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(512).decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return False, f"HTTP {exc.code}: {body}"
    except Exception as exc:
        return False, str(exc)


def print_compose_status() -> None:
    result = subprocess.run(
        compose_cmd("ps"),
        **TEXT_CAPTURE_OPTIONS,
    )
    if result.returncode != 0:
        warn("Could not read docker compose service status.")
        return
    print("")
    output = result.stdout or ""
    if output:
        print(output.rstrip())
    else:
        warn("Docker Compose returned no service-status output.")
    print("")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the Java DramaIP Compose stack.")
    return parser.parse_args()


def main() -> int:
    parse_args()
    check_layout()
    install_shutdown_handlers()
    stack_start_attempted = False
    try:
        check_docker()
        release_required_ports()
        package_java_server()
        stack_start_attempted = True
        ensure_stack_running()
        wait_for_shutdown()
    except RuntimeError as exc:
        err(str(exc))
        return 1
    except KeyboardInterrupt:
        print("")
        warn(f"Received {shutdown_reason()}.")
        return 0
    finally:
        if stack_start_attempted:
            stop_stack()


if __name__ == "__main__":
    sys.exit(main())
