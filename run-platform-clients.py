#!/usr/bin/env python3
"""Start the DramaIP Web, Admin and Mobile clients in development mode."""

from __future__ import annotations

import os
import platform
import re
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

SCRIPT_DIRECTORY = Path(__file__).resolve().parent
CLIENTS_DIRECTORY = SCRIPT_DIRECTORY / "platform" / "clients"
CLIENT_INSTALL_MARKER = CLIENTS_DIRECTORY / "node_modules" / ".bin"
WEB_APP_DIRECTORY = CLIENTS_DIRECTORY / "apps" / "web"
ADMIN_APP_DIRECTORY = CLIENTS_DIRECTORY / "apps" / "admin"
MOBILE_APP_DIRECTORY = CLIENTS_DIRECTORY / "apps" / "mobile"
SDK_DIRECTORY = CLIENTS_DIRECTORY / "packages" / "sdk"

NODE_MINIMUM_MAJOR = 20
REQUIRED_PNPM_VERSION = "11.28.5"
GATEWAY_PORT = 8080
WEB_PORT = 3009
ADMIN_PORT = 3010
# Expo defaults to 8081, which conflicts with the local Java identity service.
MOBILE_PORT = 3011
DEV_ACCOUNT_EMAIL = "creator@example.com"
DEV_ACCOUNT_PASSWORD = "password123"
CURRENT_PID = os.getpid()

CLIENT_MODULE_CHECKS = [
    ("@dramaip/web", WEB_APP_DIRECTORY, ["zod", "@dramaip/sdk"]),
    ("@dramaip/admin", ADMIN_APP_DIRECTORY, ["vite", "react", "@dramaip/sdk"]),
    ("@dramaip/mobile", MOBILE_APP_DIRECTORY, ["expo", "expo-router", "@dramaip/sdk"]),
    ("@dramaip/sdk", SDK_DIRECTORY, ["axios", "zod"]),
]

CLIENT_PORTS = [
    ("Web", WEB_PORT),
    ("Admin", ADMIN_PORT),
    ("Mobile Metro", MOBILE_PORT),
]

INSTALL_MODES = ("auto", "force", "skip")
MOBILE_TARGETS = ("ios", "android", "none")


@dataclass(frozen=True)
class Options:
    install_mode: str = "auto"
    kill_ports: bool = True
    api_base_url: str = f"http://localhost:{GATEWAY_PORT}"
    mobile_target: str = "none"


@dataclass
class ManagedClient:
    name: str
    label: str
    port: int
    process: subprocess.Popen[bytes] | None = None


@dataclass
class CapturedResult:
    status: int | None
    stdout: str
    stderr: str
    error: Exception | None = None


class ShutdownError(Exception):
    """启动期间收到关闭信号。"""


_shutdown_signal: str | None = None
_shutdown_event = __import__("threading").Event()


def color(code: str, message: str) -> str:
    return f"\033[{code}m{message}\033[0m" if sys.stdout.isatty() else message


def info(message: str) -> None:
    sys.stdout.write(f"{color('36', '* ')}{message}\n")
    sys.stdout.flush()


def ok(message: str) -> None:
    sys.stdout.write(f"{color('32', 'OK ')}{message}\n")
    sys.stdout.flush()


def warn(message: str) -> None:
    sys.stderr.write(f"{color('33', '! ')}{message}\n")
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


def run_captured(
    command: list[str], cwd: Path = CLIENTS_DIRECTORY
) -> CapturedResult:
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


def command_output(command: list[str], cwd: Path = CLIENTS_DIRECTORY) -> str | None:
    result = run_captured(command, cwd)
    return result.stdout.strip() if result.status == 0 else None


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


def run_foreground(command: list[str], cwd: Path = CLIENTS_DIRECTORY) -> None:
    result = subprocess.run(
        command,
        cwd=str(cwd),
        shell=requires_command_shell(command[0]),
    )
    if _shutdown_signal:
        raise ShutdownError()
    if result.returncode != 0:
        fail(f"Command failed with exit code {result.returncode}: {' '.join(command)}")


def help_text() -> None:
    sys.stdout.write(
        """
Start the DramaIP Web, Admin and Mobile development clients.

Usage:
  python3 run-platform-clients.py [options]

Options:
  --install                 Force pnpm install before startup
  --no-install              Never install dependencies automatically
  --no-kill-ports           Fail instead of stopping processes on client ports
  --api-base-url <url>      Java Gateway origin (default: http://localhost:8080)
  --mobile-target <target>  ios, android or none (default: none)
  -h, --help                Show this help
"""
    )
    sys.stdout.flush()


def parse_client_arguments(arguments: list[str]) -> Options | None:
    install = False
    no_install = False
    kill_ports = True
    api_base_url = f"http://localhost:{GATEWAY_PORT}"
    mobile_target = "none"

    def take_value(argument: str, index: int) -> tuple[str, int]:
        equals = argument.find("=")
        if equals >= 0:
            return argument[equals + 1 :], index
        value = arguments[index + 1] if index + 1 < len(arguments) else ""
        if not value or value.startswith("--"):
            fail(f"{argument} requires a value")
        return value, index + 1

    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument in ("-h", "--help"):
            help_text()
            return None
        if argument == "--install":
            install = True
        elif argument == "--no-install":
            no_install = True
        elif argument == "--no-kill-ports":
            kill_ports = False
        elif argument == "--api-base-url" or argument.startswith("--api-base-url="):
            api_base_url, index = take_value(argument, index)
        elif argument == "--mobile-target" or argument.startswith("--mobile-target="):
            mobile_target, index = take_value(argument, index)
            if mobile_target not in MOBILE_TARGETS:
                fail(
                    f"invalid --mobile-target: {mobile_target} "
                    "(expected ios, android or none)"
                )
        else:
            fail(f"unknown argument: {argument}")
        index += 1

    if install and no_install:
        fail("--install and --no-install cannot be used together")
    return Options(
        install_mode="force" if install else "skip" if no_install else "auto",
        kill_ports=kill_ports,
        api_base_url=api_base_url,
        mobile_target=mobile_target,
    )


def check_layout() -> None:
    missing = [
        path
        for path in (
            CLIENTS_DIRECTORY,
            WEB_APP_DIRECTORY,
            ADMIN_APP_DIRECTORY,
            MOBILE_APP_DIRECTORY,
            SDK_DIRECTORY,
        )
        if not path.exists()
    ]
    if missing:
        fail(
            "Missing client paths:\n"
            + "\n".join(f"  {path}" for path in missing)
        )
    ok("client layout found")


def check_node() -> str:
    node = resolve_executable("node")
    if not node:
        fail("Node.js is not available. Install Node.js >= 20 first.")
    version = command_output([node, "--version"])
    major_text = version.lstrip("v").split(".")[0] if version else ""
    try:
        major = int(major_text)
    except ValueError:
        major = -1
    if not version or major < 0:
        fail(f"Cannot parse Node.js version: {version or 'unknown'}")
    if major < NODE_MINIMUM_MAJOR:
        fail(
            f"Node.js version is too old: {version}. "
            f"Need >= v{NODE_MINIMUM_MAJOR}."
        )
    ok(f"node {version}")
    return node


def check_pnpm() -> str:
    pnpm = resolve_executable("pnpm")
    # 版本在 clients workspace 读取，让包管理器解析该 workspace 固定的
    # `packageManager` 字段。
    version = command_output([pnpm, "--version"], CLIENTS_DIRECTORY) if pnpm else None
    if not pnpm or version != REQUIRED_PNPM_VERSION:
        fail(
            f"pnpm version mismatch: found {version or 'unknown'}, "
            f"need {REQUIRED_PNPM_VERSION}."
        )
    ok(f"pnpm {version}")
    return pnpm


def client_modules_resolve(node: str) -> bool:
    if not CLIENT_INSTALL_MARKER.exists():
        return False
    for package_name, package_directory, modules in CLIENT_MODULE_CHECKS:
        for module_name in modules:
            result = run_captured(
                [
                    node,
                    "-e",
                    "require.resolve(process.argv[1], { paths: [process.argv[2]] })",
                    module_name,
                    str(package_directory),
                ],
                CLIENTS_DIRECTORY,
            )
            if result.status != 0:
                warn(
                    f"{package_name} cannot resolve {module_name}; "
                    "reinstalling clients dependencies."
                )
                return False
    return True


def ensure_client_dependencies(pnpm: str, node: str, mode: str) -> None:
    if mode == "skip":
        warn("Skipping clients dependency install.")
        return
    if mode != "force" and client_modules_resolve(node):
        ok("clients dependencies already installed")
        return
    info("Installing clients dependencies with pnpm install...")
    run_foreground([pnpm, "install"])
    if not client_modules_resolve(node):
        fail("Clients dependencies are still incomplete after pnpm install.")
    ok("clients dependencies ready")


def listening_pids(port: int) -> list[int]:
    if platform.system() == "Windows":
        result = run_captured(
            ["netstat", "-ano", "-p", "TCP"], SCRIPT_DIRECTORY
        )
        if result.status != 0:
            warn("netstat failed while checking port.")
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
        warn("lsof was not found; cannot detect processes by port.")
        return []
    result = run_captured(
        [lsof, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], SCRIPT_DIRECTORY
    )
    if result.status not in (0, 1):
        warn("lsof failed while checking port.")
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


def process_exists(pid: int) -> bool:
    if platform.system() == "Windows":
        result = run_captured(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            SCRIPT_DIRECTORY,
        )
        if result.status != 0:
            return False
        for line in result.stdout.splitlines():
            columns = re.findall(r'"([^"]*)"', line)
            if len(columns) > 1 and columns[1].strip() == str(pid):
                return True
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def process_command(pid: int) -> str:
    if platform.system() == "Windows":
        command = ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"]
    else:
        command = ["ps", "-p", str(pid), "-o", "command="]
    result = run_captured(command, SCRIPT_DIRECTORY)
    return result.stdout.strip() if result.status == 0 else ""


def is_docker_process(pid: int) -> bool:
    command = process_command(pid).lower()
    return any(
        marker in command
        for marker in ("com.docker", "docker-proxy", "dockerd", "vpnkit")
    )


def kill_pids(pids: list[int], label: str) -> None:
    targets = [pid for pid in pids if not is_docker_process(pid)]
    docker_pids = [pid for pid in pids if pid not in targets]
    if docker_pids:
        warn(
            f"{label} has Docker PID(s) {', '.join(str(pid) for pid in docker_pids)}; "
            "leaving them running."
        )
    if not targets:
        return

    warn(
        f"{label} is occupied by PID(s) {', '.join(str(pid) for pid in targets)}; "
        "stopping them."
    )
    for pid in targets:
        if platform.system() == "Windows":
            result = run_captured(
                ["taskkill", "/PID", str(pid), "/T", "/F"], SCRIPT_DIRECTORY
            )
            if result.status != 0 and process_exists(pid):
                fail(
                    f"No permission to force stop PID {pid} for {label}: "
                    f"{(result.stderr or result.stdout).strip()}"
                )
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except OSError:
                fail(f"No permission to stop PID {pid} for {label}.")

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and any(process_exists(pid) for pid in targets):
        sleep(200)
    remaining = [pid for pid in targets if process_exists(pid)]
    if remaining:
        warn(f"{label} did not stop after SIGTERM; forcing termination.")
        for pid in remaining:
            if platform.system() == "Windows":
                result = run_captured(
                    ["taskkill", "/PID", str(pid), "/T", "/F"], SCRIPT_DIRECTORY
                )
                if result.status != 0 and process_exists(pid):
                    fail(f"No permission to force stop PID {pid} for {label}.")
            else:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError:
                    fail(f"No permission to stop PID {pid} for {label}.")
    if any(process_exists(pid) for pid in targets):
        fail(f"PID(s) still occupy {label}.")
    ok(f"{label} is free")


def release_port(port: int, label: str, kill_ports: bool) -> None:
    pids = listening_pids(port)
    if not pids:
        return
    if not kill_ports:
        fail(
            f"{label} port {port} is occupied by PID(s) "
            f"{', '.join(str(pid) for pid in pids)}."
        )
    kill_pids(pids, f"{label} port {port}")
    remaining = listening_pids(port)
    if remaining:
        fail(
            f"{label} port {port} is still occupied by PID(s) "
            f"{', '.join(str(pid) for pid in remaining)}."
        )


def start_client(
    name: str, label: str, port: int, command: list[str], environment: dict[str, str]
) -> ManagedClient:
    info(f"Starting {name}: {' '.join(command)}")
    child = subprocess.Popen(
        command,
        cwd=str(CLIENTS_DIRECTORY),
        env=environment,
        shell=requires_command_shell(command[0]),
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    return ManagedClient(name=name, label=label, port=port, process=child)


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


def stop_client(client: ManagedClient) -> None:
    child = client.process
    if child is None or child.poll() is not None:
        return
    warn(f"Stopping {client.name}...")

    if platform.system() == "Windows":
        result = run_captured(
            ["taskkill", "/PID", str(child.pid), "/T", "/F"], SCRIPT_DIRECTORY
        )
        if result.status != 0 and child.pid and process_exists(child.pid):
            fail(
                f"Could not stop {client.name} process tree (PID {child.pid}): "
                f"{(result.stderr or result.stdout).strip()}"
            )
    elif child.pid:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError:
            child.terminate()

    if not wait_for_exit_with_timeout(child, 8.0):
        warn(f"Killing {client.name}...")
        if platform.system() != "Windows" and child.pid:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except (ProcessLookupError, OSError):
                child.kill()
        else:
            child.kill()
        wait_for_exit_with_timeout(child, 2.0)


def cleanup_clients(clients: list[ManagedClient]) -> None:
    errors: list[str] = []
    for client in reversed(clients):
        try:
            stop_client(client)
        except Exception as error:  # noqa: BLE001 - 汇总所有停止失败
            errors.append(str(error))
    for client in clients:
        try:
            release_port(client.port, client.label, True)
        except Exception as error:  # noqa: BLE001 - 汇总所有停止失败
            errors.append(str(error))
    if errors:
        fail("; ".join(errors))
    ok(
        "Client processes stopped; port(s) "
        f"{', '.join(str(client.port) for client in clients)} are free"
    )


def lan_ip() -> str | None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.settimeout(0.5)
        probe.connect(("8.8.8.8", 80))
        address = probe.getsockname()
        return str(address[0]) if address else None
    except OSError:
        return None
    finally:
        probe.close()


def qrcode_terminal_root() -> Path | None:
    hoisted = CLIENTS_DIRECTORY / "node_modules" / "qrcode-terminal"
    if hoisted.is_dir():
        return hoisted
    store = CLIENTS_DIRECTORY / "node_modules" / ".pnpm"
    if not store.exists():
        return None
    for entry in sorted(store.iterdir()):
        if not entry.name.startswith("qrcode-terminal@"):
            continue
        candidate = entry / "node_modules" / "qrcode-terminal"
        if candidate.exists():
            return candidate
    return None


def print_expo_go_qr(node: str) -> None:
    ip = lan_ip()
    if not ip:
        warn(
            "Could not detect a LAN IP; Expo Go on a physical device needs one "
            "on the same network."
        )
        return
    url = f"exp://{ip}:{MOBILE_PORT}"
    info(
        "Expo Go (physical device, same Wi-Fi): scan this QR in the Expo Go app, "
        "or enter the URL"
    )
    sys.stdout.write(f"  {url}\n")
    root = qrcode_terminal_root()
    if not root:
        warn(
            "qrcode-terminal not found under node_modules; run with --install to "
            "render the QR art."
        )
        return
    script = (
        "const qt=require(process.argv[1]);qt.generate(process.argv[2],"
        "{small:true},q=>process.stdout.write(q+'\\n'));"
    )
    result = run_captured([node, "-e", script, str(root), url])
    if result.status != 0 or not result.stdout:
        warn(
            "Failed to render the Expo Go QR; open the URL above in Expo Go instead."
        )
        return
    sys.stdout.write(f"\n{result.stdout}\n")


def watch_clients(
    clients: list[ManagedClient], api_base_url: str, mobile_target: str, node: str
) -> int:
    ok("Web, Admin, and Mobile clients started")
    sys.stdout.write(f"Web: http://localhost:{WEB_PORT}\n")
    sys.stdout.write(f"Admin: http://localhost:{ADMIN_PORT}\n")
    sys.stdout.write(f"Mobile Metro: http://localhost:{MOBILE_PORT}\n")
    if mobile_target == "ios":
        sys.stdout.write(
            "Expo Go: launching on iOS Simulator "
            "(use --mobile-target android|none to change)\n"
        )
    elif mobile_target == "android":
        sys.stdout.write(
            "Expo Go: launching on Android emulator "
            "(use --mobile-target ios|none to change)\n"
        )
    print_expo_go_qr(node)
    sys.stdout.write(f"Gateway: {api_base_url}\n")
    sys.stdout.write(
        f"Dev account: {DEV_ACCOUNT_EMAIL} / {DEV_ACCOUNT_PASSWORD}\n"
    )
    sys.stdout.write(
        "Press Ctrl+C to stop all clients. The Java platform stack stays running.\n"
    )
    sys.stdout.flush()

    alive = list(clients)
    exit_code = 0
    while alive:
        if _shutdown_signal:
            sys.stdout.write("\n")
            warn(f"Received {shutdown_reason()}.")
            return 0
        for client in list(alive):
            if client.process is None:
                continue
            code = child_exit_code(client.process)
            if code is None:
                continue
            warn(
                f"{client.name} exited with code {code}; remaining clients keep "
                "running."
            )
            exit_code = exit_code or code or 1
            alive.remove(client)
        _shutdown_event.wait(0.5)
        _shutdown_event.clear()
    warn("All clients have exited.")
    return exit_code


def main(arguments: list[str] | None = None) -> int:
    options = parse_client_arguments(
        sys.argv[1:] if arguments is None else arguments
    )
    if options is None:
        return 0

    clients: list[ManagedClient] = []
    exit_code = 0
    try:
        check_layout()
        install_shutdown_handlers()
        node = check_node()
        pnpm = check_pnpm()
        ensure_client_dependencies(pnpm, node, options.install_mode)

        for label, port in CLIENT_PORTS:
            release_port(port, label, options.kill_ports)

        web_environment = dict(os.environ)
        web_environment["NEXT_PUBLIC_API_BASE_URL"] = ""
        web_environment["DRAMAIP_WEB_API_PROXY_TARGET"] = options.api_base_url
        web_environment.setdefault("NEXT_PUBLIC_PAYMENT_MODE", "simulated")

        admin_environment = dict(os.environ)
        admin_environment["VITE_ADMIN_API_BASE_URL"] = options.api_base_url

        mobile_environment = dict(os.environ)
        mobile_environment["EXPO_PUBLIC_MOBILE_API_ORIGIN"] = options.api_base_url
        mobile_environment["EXPO_PUBLIC_API_BASE_URL"] = options.api_base_url

        mobile_command = [
            pnpm,
            "--filter",
            "@dramaip/mobile",
            "run",
            "start",
            "--",
            "--port",
            str(MOBILE_PORT),
        ]
        if options.mobile_target != "none":
            mobile_command.append(f"--{options.mobile_target}")

        commands = [
            (
                "clients:web",
                "Web",
                WEB_PORT,
                [pnpm, "--filter", "@dramaip/web", "run", "dev"],
                web_environment,
            ),
            (
                "clients:admin",
                "Admin",
                ADMIN_PORT,
                [pnpm, "--filter", "@dramaip/admin", "run", "dev"],
                admin_environment,
            ),
            (
                "clients:mobile",
                "Mobile Metro",
                MOBILE_PORT,
                mobile_command,
                mobile_environment,
            ),
        ]

        for name, label, port, command, environment in commands:
            client = start_client(name, label, port, command, environment)
            clients.append(client)
            _shutdown_event.wait(0.8)
            _shutdown_event.clear()
            if _shutdown_signal:
                raise ShutdownError()
            if client.process is not None:
                code = child_exit_code(client.process)
                if code is not None:
                    fail(f"{name} exited during startup with code {code}.")
        exit_code = watch_clients(
            clients, options.api_base_url, options.mobile_target, node
        )
    except ShutdownError:
        warn(f"Received {shutdown_reason()}; client startup cancelled.")
        exit_code = 0
    except Exception as error:  # noqa: BLE001 - 统一转成退出码
        sys.stderr.write(f"{color('31', 'ERR ')}{error}\n")
        exit_code = 1
    finally:
        if clients:
            try:
                cleanup_clients(clients)
            except Exception as error:  # noqa: BLE001 - 清理失败同样转成退出码
                sys.stderr.write(f"{color('31', 'ERR ')}{error}\n")
                exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
