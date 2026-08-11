#!/usr/bin/env python3
"""Start the DramaIP Web, Admin, and Mobile clients in development mode.

The Java Compose stack is managed independently by ``run-platform.py``. This
launcher prepares and starts all three clients against the configured Java
Gateway.

Usage:
  python3 run-platform-clients.py
  python3 run-platform-clients.py --install
  python3 run-platform-clients.py --no-install
  python3 run-platform-clients.py --no-kill-ports
  python3 run-platform-clients.py --api-base-url http://localhost:8080
  python3 run-platform-clients.py --mobile-target ios|android|none
"""

from __future__ import annotations

import argparse
import csv
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
CLIENTS_DIR = SCRIPT_DIR / "dramaip-platform" / "clients"
# node_modules/.bin is produced by Bun under BOTH the "isolated" and "hoisted"
# install linkers (unlike node_modules/.bun, which only exists under "isolated").
# Metro/Babel require the "hoisted" linker, so this marker must be layout-agnostic
# or the dep-completeness gate fails after switching off the isolated layout.
CLIENT_INSTALL_MARKER = CLIENTS_DIR / "node_modules" / ".bin"
WEB_APP_DIR = CLIENTS_DIR / "apps" / "web"
ADMIN_APP_DIR = CLIENTS_DIR / "apps" / "admin"
MOBILE_APP_DIR = CLIENTS_DIR / "apps" / "mobile"
SDK_DIR = CLIENTS_DIR / "packages" / "sdk"
CLIENT_MODULE_CHECKS = (
    ("@dramaip/web", WEB_APP_DIR, ("zod", "@dramaip/sdk")),
    ("@dramaip/admin", ADMIN_APP_DIR, ("vite", "react", "@dramaip/sdk")),
    ("@dramaip/mobile", MOBILE_APP_DIR, ("expo", "expo-router", "@dramaip/sdk")),
    ("@dramaip/sdk", SDK_DIR, ("axios", "zod")),
)
NODE_MIN_MAJOR = 20
BUN_VERSION = "1.3.14"
GATEWAY_PORT = 8080
WEB_PORT = 3009  # 与 clients/apps/web/package.json 的 `next dev -p 3009` 对齐
ADMIN_PORT = 3010  # 与 clients/apps/admin/package.json 的 Vite 端口对齐
# Expo 默认使用 8081，会与本地 Java identity 冲突，因此启动器固定使用 3011。
MOBILE_PORT = 3011
CLIENT_PORTS = (
    ("Web", WEB_PORT),
    ("Admin", ADMIN_PORT),
    ("Mobile Metro", MOBILE_PORT),
)
DEV_ACCOUNT_EMAIL = "creator@example.com"
DEV_ACCOUNT_PASSWORD = "password123"
CURRENT_PID = os.getpid()
_SHUTDOWN_SIGNAL: int | None = None
TEXT_CAPTURE_OPTIONS = {
    "capture_output": True,
    "text": True,
    "encoding": "mbcs" if os.name == "nt" else "utf-8",
    "errors": "replace",
}
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
    if platform.system() == "Windows" and hasattr(signal, "SIGBREAK"):
        # Some Windows terminals deliver Ctrl+Break-style console events for
        # an interrupt. Handle it exactly like Ctrl+C.
        signal.signal(signal.SIGBREAK, request_shutdown)


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


def run_foreground(cmd: list[str], cwd: Path) -> None:
    command: list[str] | str = cmd
    options: dict[str, object] = {"cwd": str(cwd), "check": True}
    if os.name == "nt":
        # Windows' CreateProcess does not resolve batch files by command name.
        # Let cmd.exe resolve Bun and Node through PATHEXT without changing
        # the command itself to a platform-specific executable filename.
        command = subprocess.list2cmdline(cmd)
        options["shell"] = True
    try:
        subprocess.run(command, **options)
    except FileNotFoundError:
        err(f"Command not found: {cmd[0]}")
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        err(f"Command failed with exit code {exc.returncode}: {' '.join(cmd)}")
        sys.exit(exc.returncode)


def check_layout() -> None:
    missing = [
        path for path in (CLIENTS_DIR, WEB_APP_DIR, ADMIN_APP_DIR, MOBILE_APP_DIR, SDK_DIR)
        if not path.exists()
    ]
    if missing:
        err("Missing client paths:")
        for path in missing:
            err(f"  {path}")
        sys.exit(1)
    ok("client layout found")


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


def resolve_bun() -> list[str]:
    if shutil.which("bun"):
        return ["bun"]
    err("Bun is not available. Install Bun 1.3.14 first: https://bun.sh/docs/installation")
    sys.exit(1)


def check_bun(bun: list[str]) -> None:
    version = command_output(bun + ["--version"], CLIENTS_DIR)
    if version != BUN_VERSION:
        err(f"Bun version mismatch: found {version or 'unknown'}, need {BUN_VERSION}.")
        sys.exit(1)
    ok(f"bun {version}")


def ensure_client_deps(bun: list[str], install_mode: str) -> None:
    if install_mode == "skip":
        warn("Skipping clients dependency install.")
        return

    should_install = install_mode == "force" or not CLIENT_INSTALL_MARKER.exists() or not client_modules_resolve()
    if not should_install:
        ok("clients dependencies already installed")
        return

    info("Installing clients dependencies with bun install...")
    run_foreground(bun + ["install"], CLIENTS_DIR)
    if not client_modules_resolve():
        err("Clients dependencies are still incomplete after bun install.")
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
                **TEXT_CAPTURE_OPTIONS,
            )
            if result.returncode != 0:
                warn(f"{package_name} cannot resolve {module}; reinstalling clients dependencies.")
                return False
    return True


def listening_pids(port: int) -> list[int]:
    if platform.system() == "Windows":
        result = subprocess.run(["netstat", "-ano", "-p", "TCP"], **TEXT_CAPTURE_OPTIONS)
        if result.returncode != 0:
            warn(f"netstat failed while checking port {port}.")
            return []
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
        warn("lsof was not found; cannot detect processes by port.")
        return []
    result = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], **TEXT_CAPTURE_OPTIONS)
    if result.returncode not in (0, 1):
        warn(f"lsof failed while checking port {port}.")
        return []
    pids: list[int] = []
    for line in (result.stdout or "").splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid != CURRENT_PID and pid not in pids:
            pids.append(pid)
    return pids


def process_exists(pid: int) -> bool:
    if platform.system() == "Windows":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            **TEXT_CAPTURE_OPTIONS,
        )
        if result.returncode != 0:
            return False
        for row in csv.reader((result.stdout or "").splitlines()):
            if len(row) > 1 and row[1].strip() == str(pid):
                return True
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def process_command(pid: int) -> str:
    if platform.system() == "Windows":
        result = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], **TEXT_CAPTURE_OPTIONS)
        return (result.stdout or "").strip() if result.returncode == 0 else ""
    try:
        result = subprocess.run(["ps", "-p", str(pid), "-o", "command="], **TEXT_CAPTURE_OPTIONS)
    except FileNotFoundError:
        return ""
    return (result.stdout or "").strip() if result.returncode == 0 else ""


def is_docker_process(pid: int) -> bool:
    command = process_command(pid).lower()
    docker_markers = ("com.docker", "docker-proxy", "dockerd", "vpnkit")
    return any(marker in command for marker in docker_markers)


def kill_pids(pids: list[int], label: str) -> None:
    target_pids = [pid for pid in pids if not is_docker_process(pid)]
    docker_pids = [pid for pid in pids if pid not in target_pids]
    if docker_pids:
        warn(f"{label} has Docker PID(s) {', '.join(str(pid) for pid in docker_pids)}; leaving them running.")
    if not target_pids:
        return

    warn(f"{label} is occupied by PID(s) {', '.join(str(pid) for pid in target_pids)}; stopping them.")
    for pid in target_pids:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                **TEXT_CAPTURE_OPTIONS,
            )
            if result.returncode != 0 and process_exists(pid):
                details = (result.stderr or result.stdout or "").strip()
                raise RuntimeError(f"No permission to force stop PID {pid} for {label}: {details}")
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
            except PermissionError as exc:
                raise RuntimeError(f"No permission to stop PID {pid} for {label}.") from exc

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if all(not process_exists(pid) for pid in target_pids):
            ok(f"{label} is free")
            return
        time.sleep(0.2)

    warn(f"{label} did not stop after SIGTERM; forcing termination.")
    for pid in target_pids:
        if not process_exists(pid):
            continue
        if platform.system() == "Windows":
            result = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], **TEXT_CAPTURE_OPTIONS)
            if result.returncode != 0 and process_exists(pid):
                raise RuntimeError(f"No permission to force stop PID {pid} for {label}: {result.stderr.strip()}")
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                continue
            except PermissionError as exc:
                raise RuntimeError(f"No permission to force stop PID {pid} for {label}.") from exc

    if any(process_exists(pid) for pid in target_pids):
        raise RuntimeError(f"PID(s) still occupy {label}.")
    ok(f"{label} is free")


def release_port(port: int, label: str, kill_ports: bool) -> None:
    pids = listening_pids(port)
    if not pids:
        return
    if not kill_ports:
        raise RuntimeError(f"{label} port {port} is occupied by PID(s) {', '.join(str(pid) for pid in pids)}.")
    kill_pids(pids, f"{label} port {port}")
    remaining = listening_pids(port)
    if remaining:
        raise RuntimeError(
            f"{label} port {port} is still occupied by PID(s) "
            f"{', '.join(str(pid) for pid in remaining)}."
        )


def start_process(name: str, cmd: list[str], env: dict[str, str]) -> subprocess.Popen:
    info(f"Starting {name}: {' '.join(cmd)}")
    options: dict[str, object] = {
        "cwd": str(CLIENTS_DIR),
        "env": env,
        # Expo and other Node CLIs enable interactive/raw console input when
        # they inherit the terminal. That can turn Ctrl+C into an input byte
        # consumed by a child instead of a signal received by this launcher.
        # Keep stdout/stderr visible, but reserve terminal input for Python.
        "stdin": subprocess.DEVNULL,
    }
    command: list[str] | str = cmd
    if platform.system() == "Windows":
        # Isolate each client from console control events. Combined with the
        # DEVNULL stdin above, Ctrl+C remains owned by the Python launcher,
        # which can then terminate every client tree in its finally block.
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        options["shell"] = True
        command = subprocess.list2cmdline(cmd)
    else:
        options["start_new_session"] = True
    try:
        return subprocess.Popen(command, **options)
    except FileNotFoundError:
        err(f"Command not found for {name}: {cmd[0]}")
        sys.exit(1)


def stop_process(process: subprocess.Popen, name: str) -> None:
    if process.poll() is not None:
        return
    warn(f"Stopping {name}...")
    if platform.system() == "Windows":
        result = subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            **TEXT_CAPTURE_OPTIONS,
        )
        if result.returncode != 0 and process_exists(process.pid):
            details = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(f"Could not stop {name} process tree (PID {process.pid}): {details}")
    else:
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
        if platform.system() == "Windows":
            process.kill()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                process.kill()
        process.wait()


def cleanup_client_processes(
    processes: list[tuple[str, str, int, subprocess.Popen]],
) -> None:
    errors: list[str] = []
    for process_name, _, _, process in reversed(processes):
        try:
            stop_process(process, process_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    # Bun commands run through cmd.exe on Windows. If a shell already exited, locate
    # and remove any surviving Next.js, Vite, or Expo listener by port.
    for _, label, port, _ in processes:
        try:
            release_port(port, label, True)
        except RuntimeError as exc:
            errors.append(str(exc))

    if errors:
        raise RuntimeError("; ".join(errors))
    ports = ", ".join(str(port) for _, _, port, _ in processes)
    ok(f"Client processes stopped; port(s) {ports} are free")


def lan_ip() -> str | None:
    """Best-effort primary LAN IPv4 address (UDP connect trick; sends no packets)."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        return None


def qrcode_terminal_root() -> Path | None:
    """Resolve the qrcode-terminal package bun vendors as a transitive Expo dep."""
    # Hoisted linker (see bunfig.toml): transitive deps like qrcode-terminal are
    # linked at the workspace root, with no node_modules/.bun store on disk.
    hoisted = CLIENTS_DIR / "node_modules" / "qrcode-terminal"
    if hoisted.is_dir():
        return hoisted
    # Isolated linker: transitive deps live under the .bun store.
    store = CLIENTS_DIR / "node_modules" / ".bun"
    matches = sorted(store.glob("qrcode-terminal@*/node_modules/qrcode-terminal"))
    return matches[0] if matches else None


def print_expo_go_qr() -> None:
    """Print a scannable Expo Go QR (exp://<lan-ip>:<port>) for physical devices."""
    ip = lan_ip()
    if not ip:
        warn("Could not detect a LAN IP; Expo Go on a physical device needs one on the same network.")
        return
    url = f"exp://{ip}:{MOBILE_PORT}"
    info("Expo Go (physical device, same Wi-Fi): scan this QR in the Expo Go app, or enter the URL")
    print(f"  {url}")
    root = qrcode_terminal_root()
    if not root:
        warn("qrcode-terminal not found under node_modules; run with --install to render the QR art.")
        return
    # qrcode-terminal is a transitive Expo dependency already on disk; reuse it
    # so the launcher needs no extra Python/Node packages.
    script = (
        "const qt=require(process.argv[1]);"
        "qt.generate(process.argv[2],{small:true},function(q){process.stdout.write(q+'\\n')});"
    )
    result = subprocess.run(
        ["node", "-e", script, str(root), url],
        cwd=str(CLIENTS_DIR),
        **TEXT_CAPTURE_OPTIONS,
    )
    if result.returncode != 0 or not result.stdout:
        warn("Failed to render the Expo Go QR; open the URL above in Expo Go instead.")
        return
    # qrcode-terminal's small mode renders the last module row in the lower half
    # of the final line and omits the bottom quiet zone. Pad above and below so
    # the QR is not flush against the surrounding text and stays scannable.
    print()
    print(result.stdout, end="")
    print()


def watch(
    processes: list[tuple[str, str, int, subprocess.Popen]],
    api_base_url: str,
    mobile_target: str,
) -> int:
    ok("Web, Admin, and Mobile clients started")
    print(f"Web: http://localhost:{WEB_PORT}")
    print(f"Admin: http://localhost:{ADMIN_PORT}")
    print(f"Mobile Metro: http://localhost:{MOBILE_PORT}")
    if mobile_target == "ios":
        print("Expo Go: launching on iOS Simulator (use --mobile-target android|none to change)")
    elif mobile_target == "android":
        print("Expo Go: launching on Android emulator (use --mobile-target ios|none to change)")
    print_expo_go_qr()
    print(f"Gateway: {api_base_url}")
    print(f"Dev account: {DEV_ACCOUNT_EMAIL} / {DEV_ACCOUNT_PASSWORD}")
    print("Press Ctrl+C to stop all clients. The Java platform stack stays running.")
    # Keep the remaining clients alive when one dies: a flaky mobile process
    # should not tear down web and admin. Ctrl+C still stops everything.
    alive = list(processes)
    exit_code = 0
    try:
        while alive:
            for entry in list(alive):
                process_name, _, _, process = entry
                if process.poll() is not None:
                    warn(
                        f"{process_name} exited with code {process.returncode}; "
                        "remaining clients keep running."
                    )
                    exit_code = exit_code or (process.returncode or 1)
                    alive.remove(entry)
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("")
        warn(f"Received {shutdown_reason()}.")
        return 0
    warn("All clients have exited.")
    return exit_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the DramaIP Web, Admin, and Mobile development clients.")
    parser.add_argument("--install", action="store_true", help="Force bun install before starting clients.")
    parser.add_argument("--no-install", action="store_true", help="Skip bun install even if node_modules is missing.")
    parser.add_argument("--no-kill-ports", action="store_true", help="Do not stop processes occupying client ports.")
    parser.add_argument("--api-base-url", default=None, help="Java Gateway API origin. Defaults to http://localhost:8080.")
    parser.add_argument(
        "--mobile-target",
        choices=("ios", "android", "none"),
        default="none",
        help=(
            "Launch Expo Go in a simulator/emulator after starting Metro: ios (iOS Simulator), "
            "android (Android emulator), or none (Metro + scannable QR only). Defaults to none. "
            "ios/android download Expo Go from Expo's CDN and require network access."
        ),
    )
    args = parser.parse_args()
    if args.install and args.no_install:
        parser.error("--install and --no-install cannot be used together")
    return args


def main() -> int:
    args = parse_args()
    check_layout()
    install_shutdown_handlers()
    check_node()
    bun = resolve_bun()
    check_bun(bun)
    install_mode = "force" if args.install else "skip" if args.no_install else "auto"
    ensure_client_deps(bun, install_mode)

    api_base_url = args.api_base_url or f"http://localhost:{GATEWAY_PORT}"
    processes: list[tuple[str, str, int, subprocess.Popen]] = []
    exit_code = 0
    try:
        for label, port in CLIENT_PORTS:
            release_port(port, label, not args.no_kill_ports)

        web_env = os.environ.copy()
        web_env["NEXT_PUBLIC_API_BASE_URL"] = ""
        web_env["DRAMAIP_WEB_API_PROXY_TARGET"] = api_base_url
        web_env.setdefault("NEXT_PUBLIC_PAYMENT_MODE", "simulated")

        admin_env = os.environ.copy()
        admin_env["VITE_ADMIN_API_BASE_URL"] = api_base_url

        mobile_env = os.environ.copy()
        mobile_env["EXPO_PUBLIC_MOBILE_API_ORIGIN"] = api_base_url
        mobile_env["EXPO_PUBLIC_API_BASE_URL"] = api_base_url

        mobile_cmd = bun + ["run", "--filter", "@dramaip/mobile", "start", "--", "--port", str(MOBILE_PORT)]
        if args.mobile_target != "none":
            # `expo start --ios`/`--android` boots the simulator/emulator and
            # opens the app in Expo Go in addition to running Metro on MOBILE_PORT.
            mobile_cmd.append(f"--{args.mobile_target}")

        client_commands = (
            ("clients:web", "Web", WEB_PORT, bun + ["run", "--filter", "@dramaip/web", "dev"], web_env),
            ("clients:admin", "Admin", ADMIN_PORT, bun + ["run", "--filter", "@dramaip/admin", "dev"], admin_env),
            ("clients:mobile", "Mobile Metro", MOBILE_PORT, mobile_cmd, mobile_env),
        )
        for process_name, label, port, command, environment in client_commands:
            process = start_process(process_name, command, environment)
            processes.append((process_name, label, port, process))
            time.sleep(0.8)
            if process.poll() is not None:
                raise RuntimeError(f"{process_name} exited during startup with code {process.returncode}.")

        exit_code = watch(processes, api_base_url, args.mobile_target)
    except RuntimeError as exc:
        err(str(exc))
        exit_code = 1
    except KeyboardInterrupt:
        print("")
        warn(f"Received {shutdown_reason()}; client startup cancelled.")
        exit_code = 0
    finally:
        if processes:
            try:
                cleanup_client_processes(processes)
            except RuntimeError as exc:
                err(str(exc))
                exit_code = 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
