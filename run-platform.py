#!/usr/bin/env python3
"""
Start dramaip-platform services and web app in development mode.

All 9 Go microservices (web-bff/auth/user/billing/quota/ai-gateway/notification/
billing-job/quota-job) plus Kong and the dev infra (postgres/redis/rabbitmq/otel/...) run
as containers via docker compose; this launcher only brings the stack up and
optionally starts the local Next.js web dev server.

Usage:
  python3 run-platform.py
  python3 run-platform.py --install
  python3 run-platform.py --no-install
  python3 run-platform.py --web-only        # assume the stack is already up
  python3 run-platform.py --no-stack        # do not manage the compose stack
  python3 run-platform.py --no-kill-ports
"""

from __future__ import annotations

import argparse
import os
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
SERVICES_DIR = PLATFORM_DIR / "services"
SERVICES_ENV_FILE = SERVICES_DIR / ".env"
CLIENTS_DIR = PLATFORM_DIR / "clients"
CLIENT_INSTALL_MARKER = CLIENTS_DIR / "node_modules" / ".modules.yaml"
NODE_MIN_MAJOR = 20
WEB_APP_DIR = CLIENTS_DIR / "apps" / "web"
SDK_DIR = CLIENTS_DIR / "packages" / "sdk"
CLIENT_MODULE_CHECKS = (
    ("@dramaip/web", WEB_APP_DIR, ("zod", "@dramaip/sdk")),
    ("@dramaip/sdk", SDK_DIR, ("axios", "zod")),
)
CURRENT_PID = os.getpid()
_SHUTDOWN_SIGNAL: int | None = None

# All 9 Go services + Kong + dev infra live in docker-compose.yaml. This launcher
# brings the stack up (Kong is the sole external entry, proxy port 8000 → web-bff:8100)
# and optionally starts the local Next.js web dev server.
COMPOSE_FILE = PLATFORM_DIR / "deploy" / "docker-drama" / "docker-compose.yaml"
KONG_PROXY_PORT = 8000
KONG_HEALTH_TIMEOUT_S = 90.0   # full stack (build + 9 services + infra) takes longer than Kong alone
WEB_PORT = 3009  # 与 clients/apps/web/package.json 的 `next dev -p 3009` 对齐
DEV_ACCOUNT_EMAIL = "creator@example.com"
DEV_ACCOUNT_PASSWORD = "password123"

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
        result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def command_ok(cmd: list[str], cwd: Path) -> bool:
    try:
        result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
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
    cmd = ["docker", "compose"]
    if SERVICES_ENV_FILE.exists():
        cmd.extend(["--env-file", str(SERVICES_ENV_FILE)])
    cmd.extend(["-f", str(COMPOSE_FILE), *args])
    return cmd


def check_layout() -> None:
    missing = [path for path in (PLATFORM_DIR, SERVICES_DIR, CLIENTS_DIR) if not path.exists()]
    if missing:
        err("Missing platform paths:")
        for path in missing:
            err(f"  {path}")
        sys.exit(1)
    ok("platform layout found")
    if SERVICES_ENV_FILE.exists():
        ok(f"services env loaded by compose: {SERVICES_ENV_FILE}")
    else:
        warn(f"services env file not found: {SERVICES_ENV_FILE}; compose will use defaults and shell environment")


def check_node() -> None:
    version = command_output(["node", "--version"], CLIENTS_DIR)
    if not version:
        err("Node.js is not available. Install Node.js >= 20 first.")
        sys.exit(1)

    try:
        major = int(version.lstrip("v").split(".", 1)[0])
    except ValueError:
        err(f"Cannot parse Node.js version: {version}")
        sys.exit(1)

    if major < NODE_MIN_MAJOR:
        err(f"Node.js version is too old: {version}. Need >= v{NODE_MIN_MAJOR}.")
        sys.exit(1)
    ok(f"node {version}")


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


def resolve_pnpm() -> list[str]:
    if shutil.which("pnpm"):
        return ["pnpm"]
    if shutil.which("corepack"):
        warn("pnpm was not found on PATH; using corepack pnpm.")
        return ["corepack", "pnpm"]
    err("pnpm/corepack is not available. Install pnpm or enable corepack first.")
    sys.exit(1)


def ensure_client_deps(pnpm: list[str], install_mode: str) -> None:
    if install_mode == "skip":
        warn("Skipping clients dependency install.")
        return

    should_install = install_mode == "force" or not CLIENT_INSTALL_MARKER.exists() or not client_modules_resolve()
    if not should_install:
        ok("clients dependencies already installed")
        return

    info("Installing clients dependencies with pnpm install...")
    run_foreground(pnpm + ["install"], CLIENTS_DIR)
    if not client_modules_resolve():
        err("Clients dependencies are still incomplete after pnpm install.")
        sys.exit(1)
    ok("clients dependencies ready")


def client_modules_resolve() -> bool:
    if not CLIENT_INSTALL_MARKER.exists():
        return False

    for package_name, package_dir, modules in CLIENT_MODULE_CHECKS:
        for module in modules:
            result = subprocess.run(
                [
                    "node",
                    "-e",
                    "require.resolve(process.argv[1], { paths: [process.argv[2]] })",
                    module,
                    str(package_dir),
                ],
                cwd=str(CLIENTS_DIR),
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                warn(f"{package_name} cannot resolve {module}; reinstalling clients dependencies.")
                return False
    return True


def ensure_stack_running() -> None:
    """Bring up the full docker compose stack (9 Go services + Kong + dev infra).

    Kong depends on `web-bff`, which (transitively) depends on postgres/redis/etc.,
    so `up kong` pulls the whole stack. We `--build` so Go code changes are
    picked up on each launch.
    """
    check_docker()
    info(f"Starting platform stack: docker compose up -d --build kong (proxy :{KONG_PROXY_PORT})")
    up = subprocess.run(
        compose_cmd("up", "-d", "--build", "kong")
    )
    if up.returncode != 0:
        err("Stack failed to start. Free ports 8000/8001 or pass --no-stack to bypass.")
        sys.exit(1)
    health_url = f"http://localhost:{KONG_PROXY_PORT}/v1/healthz"
    info(f"Waiting for Kong/BFF health: {health_url}")
    deadline = time.monotonic() + KONG_HEALTH_TIMEOUT_S
    last_error = ""
    while time.monotonic() < deadline:
        healthy, detail = http_ok(health_url, timeout=3.0)
        if healthy:
            ok("Kong -> BFF health is ready")
            print_compose_status()
            return
        last_error = detail
        time.sleep(2)
    warn(f"Kong/BFF health did not become ready within {KONG_HEALTH_TIMEOUT_S:.0f}s: {last_error}")
    print_compose_status()
    warn(f"Continuing so you can inspect logs. Try `{' '.join(compose_cmd('logs', '-f', 'web-bff', 'kong'))}`.")


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
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        warn("Could not read docker compose service status.")
        return
    print("")
    print(result.stdout.rstrip())
    print("")


def listening_pids(port: int) -> list[int]:
    if not shutil.which("lsof"):
        warn("lsof was not found; cannot detect processes by port.")
        return []

    result = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        warn(f"lsof failed while checking port {port}.")
        return []

    pids: list[int] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            pid = int(line)
        except ValueError:
            continue
        if pid != CURRENT_PID and pid not in pids:
            pids.append(pid)
    return pids


def kill_pids(pids: list[int], label: str) -> None:
    if not pids:
        return

    docker_pids = [pid for pid in pids if is_docker_process(pid)]
    target_pids = [pid for pid in pids if pid not in docker_pids]

    if docker_pids:
        warn(
            f"{label} still has Docker container PID(s) "
            f"{', '.join(str(pid) for pid in docker_pids)} bound; leaving them running."
        )

    if not target_pids:
        return

    warn(f"{label} is occupied by PID(s) {', '.join(str(pid) for pid in target_pids)}; stopping them.")
    for pid in target_pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        except PermissionError:
            raise RuntimeError(f"No permission to stop PID {pid} for {label}.")

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if all(not process_exists(pid) for pid in target_pids):
            ok(f"{label} is free")
            return
        time.sleep(0.2)

    warn(f"{label} did not stop after SIGTERM; forcing SIGKILL.")
    for pid in target_pids:
        if not process_exists(pid):
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            continue
        except PermissionError:
            raise RuntimeError(f"No permission to force stop PID {pid} for {label}.")

    time.sleep(0.3)
    alive = [pid for pid in target_pids if process_exists(pid)]
    if alive:
        raise RuntimeError(f"PID(s) {', '.join(str(pid) for pid in alive)} still occupy {label}.")
    ok(f"{label} is free")


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def process_command(pid: int) -> str:
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def is_docker_process(pid: int) -> bool:
    command = process_command(pid).lower()
    if not command:
        return False
    # Docker Desktop (macOS) fronts published ports with com.docker.* / vpnkit
    # proxies; on Linux it is docker-proxy / dockerd. Killing these tears down
    # the user's containers, so they must be left alone when freeing a port.
    docker_markers = ("com.docker", "docker-proxy", "dockerd", "vpnkit")
    return any(marker in command for marker in docker_markers)


def release_port(port: int, label: str, kill_ports: bool) -> None:
    pids = listening_pids(port)
    if not pids:
        return
    if not kill_ports:
        raise RuntimeError(f"{label} port {port} is occupied by PID(s) {', '.join(str(pid) for pid in pids)}.")
    kill_pids(pids, f"{label} port {port}")


def start_process(name: str, cmd: list[str], cwd: Path, env: dict[str, str]) -> subprocess.Popen:
    info(f"Starting {name}: {' '.join(cmd)}")
    try:
        return subprocess.Popen(
            cmd,
            cwd=str(cwd),
            env=env,
            start_new_session=True,
        )
    except FileNotFoundError:
        err(f"Command not found for {name}: {cmd[0]}")
        sys.exit(1)


def ensure_process_started(process: subprocess.Popen, name: str, delay: float = 0.8) -> None:
    time.sleep(delay)
    code = process.poll()
    if code is not None:
        raise RuntimeError(f"{name} exited during startup with code {code}.")


def stop_process(process: subprocess.Popen, name: str) -> None:
    if process.poll() is not None:
        return

    warn(f"Stopping {name}...")
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        process.terminate()

    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        warn(f"Killing {name}...")
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            process.kill()
        process.wait()


def watch(processes: list[tuple[str, subprocess.Popen]], urls: list[tuple[str, str]]) -> int:
    ok("platform dev processes started")
    print("")
    for label, url in urls:
        print(f"{label}: {url}")
    print("")
    print(f"Dev account: {DEV_ACCOUNT_EMAIL} / {DEV_ACCOUNT_PASSWORD}")
    print("API entry: Kong :8000 -> BFF; clients should not call internal services directly.")
    print("AI provider: test works in dev; real OpenAI-compatible keys are injected via AI_PROVIDER_API_KEY / AI_PROVIDER_BASE_URL.")
    print("End-to-end check: cd dramaip-platform && make platform-e2e")
    print("Stop stack: cd dramaip-platform && make platform-down")
    print("")
    print("Press Ctrl+C to stop all processes.")

    try:
        while True:
            for name, process in processes:
                code = process.poll()
                if code is not None:
                    warn(f"{name} exited with code {code}")
                    return code
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("")
        warn(f"Received {shutdown_reason()}.")
        return 0
    finally:
        for name, process in reversed(processes):
            stop_process(process, name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start dramaip-platform compose stack and web dev server.")
    parser.add_argument("--install", action="store_true", help="Force pnpm install before starting web.")
    parser.add_argument("--no-install", action="store_true", help="Skip pnpm install even if node_modules is missing.")
    parser.add_argument("--web-only", action="store_true", help="Only start the web app (assume the compose stack is already up).")
    parser.add_argument("--no-stack", action="store_true", help="Do not bring up the docker compose stack.")
    parser.add_argument("--no-kill-ports", action="store_true", help="Do not stop processes occupying the web port.")
    parser.add_argument(
        "--api-base-url",
        default=None,
        help="NEXT_PUBLIC_API_BASE_URL for the web app. Defaults to the Kong proxy at http://localhost:8000.",
    )
    args = parser.parse_args()

    if args.install and args.no_install:
        parser.error("--install and --no-install cannot be used together")

    return args


def main() -> int:
    args = parse_args()
    check_layout()
    install_shutdown_handlers()

    processes: list[tuple[str, subprocess.Popen]] = []
    urls: list[tuple[str, str]] = []
    env = os.environ.copy()
    kill_ports = not args.no_kill_ports
    stack_enabled = not args.no_stack

    api_base_url = args.api_base_url or f"http://localhost:{KONG_PROXY_PORT}"

    try:
        if not args.web_only and stack_enabled:
            ensure_stack_running()
            urls.append(("Services", api_base_url))
        elif args.web_only:
            warn("--web-only: assuming the compose stack is already up.")
            urls.append(("Services", api_base_url))
        elif not stack_enabled:
            warn("--no-stack: not bringing up docker compose; web will use the existing backend at " + api_base_url)
            urls.append(("Services", api_base_url))

        check_node()
        pnpm = resolve_pnpm()
        install_mode = "force" if args.install else "skip" if args.no_install else "auto"
        ensure_client_deps(pnpm, install_mode)

        release_port(WEB_PORT, "Web", kill_ports)
        web_env = env.copy()
        web_env["NEXT_PUBLIC_API_BASE_URL"] = api_base_url
        web_env.setdefault("NEXT_PUBLIC_PAYMENT_MODE", "simulated")
        # web dev 端口固定在 package.json 的 `next dev -p 3009`；不要再设 PORT
        # 环境变量，否则会与 -p 冲突。
        web_cmd = pnpm + ["--filter", "@dramaip/web", "dev"]
        web_process = start_process("clients:web", web_cmd, CLIENTS_DIR, web_env)
        processes.append(("clients:web", web_process))
        ensure_process_started(web_process, "clients:web")
        urls.append(("Web", f"http://localhost:{WEB_PORT}"))
    except RuntimeError as exc:
        err(str(exc))
        for name, process in reversed(processes):
            stop_process(process, name)
        return 1
    except KeyboardInterrupt:
        print("")
        warn(f"Received {shutdown_reason()}.")
        for name, process in reversed(processes):
            stop_process(process, name)
        return 0

    return watch(processes, urls)


if __name__ == "__main__":
    sys.exit(main())
