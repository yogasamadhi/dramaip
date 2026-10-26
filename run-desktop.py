#!/usr/bin/env python3
"""DramaIP Studio（desktop）独立开发启动器。"""

from __future__ import annotations

import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_NODE_VERSION = "24.18.0"
REQUIRED_PNPM_VERSION = "11.28.5"

REPOSITORY_ROOT = Path(__file__).resolve().parent
DESKTOP_DIRECTORY = REPOSITORY_ROOT / "desktop"
STUDIO_DIRECTORY = DESKTOP_DIRECTORY / "apps" / "desktop"
INSTALL_MARKER = DESKTOP_DIRECTORY / "node_modules" / ".modules.yaml"


@dataclass(frozen=True)
class Options:
    check: bool = False
    force_install: bool = False
    rebuild_engines: bool = False
    dev_arguments: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RuntimeSpec:
    label: str
    entry: Path
    build_script: str
    verify_script: str | None = None


@dataclass(frozen=True)
class VendorSubmoduleSpec:
    label: str
    path: str
    marker: str


@dataclass(frozen=True)
class Toolchain:
    node: str
    pnpm: str


def resolve_executable(name: str) -> str | None:
    """在 PATH 中查找可执行文件，行为与桌面端其它启动器一致。"""
    path_entries = [entry for entry in os.environ.get("PATH", "").split(os.pathsep) if entry]
    if platform.system() == "Windows":
        extensions = [
            extension.lower()
            for extension in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";")
        ]
    else:
        extensions = [""]
    has_windows_extension = any(name.lower().endswith(extension) for extension in extensions)
    for entry in path_entries:
        directory = entry.strip('"')
        for extension in ([""] if has_windows_extension else extensions):
            candidate = Path(directory) / f"{name}{extension}"
            try:
                if os.name == "nt":
                    if not candidate.is_file():
                        continue
                else:
                    if not candidate.is_file() or not os.access(candidate, os.X_OK):
                        continue
            except OSError:
                continue
            return str(candidate)
    return None


def color(code: str, value: str) -> str:
    return f"\033[{code}m{value}\033[0m" if sys.stdout.isatty() else value


def info(message: str) -> None:
    sys.stdout.write(f"{color('36', '• ')}{message}\n")
    sys.stdout.flush()


def ok(message: str) -> None:
    sys.stdout.write(f"{color('32', '✓ ')}{message}\n")
    sys.stdout.flush()


def warn(message: str) -> None:
    sys.stderr.write(f"{color('33', '! ')}{message}\n")
    sys.stderr.flush()


def fail(message: str) -> "NoReturn":  # type: ignore[valid-type]
    raise RuntimeError(message)


def help_text() -> None:
    sys.stdout.write(
        """
DramaIP Studio 开发启动器

用法:
  python3 run-desktop.py [选项] [-- Electron/Vite 参数]

选项:
  --install           强制执行 pnpm install
  --rebuild-engines   强制重建所有当前平台支持的智能引擎 Runtime
  --check             只读检查启动环境，不修复、不构建、不启动
  -h, --help          显示帮助

示例:
  python3 run-desktop.py
  python3 run-desktop.py --rebuild-engines
  python3 run-desktop.py -- --host 127.0.0.1
"""
    )
    sys.stdout.flush()


def parse_options(arguments: list[str]) -> Options | None:
    check = False
    force_install = False
    rebuild_engines = False
    dev_arguments: list[str] = []
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if argument == "--":
            dev_arguments.extend(arguments[index + 1 :])
            break
        if argument == "--install":
            force_install = True
        elif argument == "--rebuild-engines":
            rebuild_engines = True
        elif argument == "--check":
            check = True
        elif argument in ("-h", "--help"):
            help_text()
            return None
        else:
            fail(f"未知参数：{argument}（Electron/Vite 参数请放在 -- 之后）")
        index += 1

    if check and (force_install or rebuild_engines or dev_arguments):
        fail("--check 是只读操作，不能与安装、重建、跳过检查或启动参数同时使用")

    return Options(
        check=check,
        force_install=force_install,
        rebuild_engines=rebuild_engines,
        dev_arguments=dev_arguments,
    )


def assert_node_version(version: str | None) -> str:
    if version != REQUIRED_NODE_VERSION:
        fail(
            f"Node 版本必须恰好为 {REQUIRED_NODE_VERSION}，"
            f"当前为 {version or '非 Node 运行时'}"
        )
    return version  # type: ignore[return-value]


def assert_pnpm_version(version: str | None) -> str:
    if version != REQUIRED_PNPM_VERSION:
        fail(
            f"pnpm 版本必须恰好为 {REQUIRED_PNPM_VERSION}，"
            f"当前为 {version or '未安装 pnpm'}"
        )
    return version  # type: ignore[return-value]


def clean_environment(overrides: dict[str, str] | None = None) -> dict[str, str]:
    environment = dict(os.environ)
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    if overrides:
        environment.update(overrides)
    return environment


def run_command(
    command: str,
    arguments: list[str],
    cwd: Path = DESKTOP_DIRECTORY,
    environment: dict[str, str] | None = None,
) -> int:
    """在前台运行子进程，继承标准输入输出；失败时抛出异常。"""
    result = subprocess.run(
        [command, *arguments],
        cwd=str(cwd),
        env=environment if environment is not None else clean_environment(),
    )
    if result.returncode != 0:
        reason = f"退出码 {result.returncode}"
        fail(f"命令执行失败（{reason}）：{command} {' '.join(arguments)}")
    return result.returncode


def check_toolchain() -> Toolchain:
    node = resolve_executable("node")
    if not node:
        fail("未找到 Node，请先安装 Node 24.18.0")
    node_probe = subprocess.run(
        [node, "--version"], capture_output=True, text=True
    )
    node_version = assert_node_version(node_probe.stdout.strip().lstrip("v") or None)
    ok(f"node {node_version}")
    pnpm = resolve_executable("pnpm")
    if not pnpm:
        fail(f"未找到 pnpm，请先安装 pnpm {REQUIRED_PNPM_VERSION}")
    # 版本在 workspace 目录读取，让包管理器解析该 workspace 固定的
    # `packageManager` 字段。
    probe = subprocess.run(
        [pnpm, "--version"],
        cwd=str(DESKTOP_DIRECTORY),
        capture_output=True,
        text=True,
    )
    pnpm_version = assert_pnpm_version(probe.stdout.strip() or None)
    ok(f"pnpm {pnpm_version}")
    return Toolchain(node=node, pnpm=pnpm)


def vendor_submodule_specs() -> list[VendorSubmoduleSpec]:
    return [
        VendorSubmoduleSpec(
            label="DSH Cordis",
            path="vendor/deepseek-harness",
            marker="vendor/cordis/src/index.ts",
        ),
        VendorSubmoduleSpec(
            label="Codex",
            path="vendor/codex-rust",
            marker="codex-rs/Cargo.toml",
        ),
        VendorSubmoduleSpec(
            label="Pi",
            path="vendor/pi",
            marker="package-lock.json",
        ),
    ]


def ensure_vendor_submodules(check: bool) -> None:
    specs = vendor_submodule_specs()
    missing = [
        submodule
        for submodule in specs
        if not (REPOSITORY_ROOT / submodule.path / submodule.marker).exists()
    ]
    if not missing:
        ok("必要的 vendor 子模块已就绪")
        return

    paths = [submodule.path for submodule in missing]
    if check:
        fail(
            f"vendor 子模块未初始化：{', '.join(paths)}；"
            "请运行 python3 run-desktop.py 完成初始化"
        )

    git = resolve_executable("git")
    if not git:
        fail(f"未找到 Git，无法初始化 vendor 子模块：{', '.join(paths)}")
    info(f"初始化 vendor 子模块：{'、'.join(s.label for s in missing)}……")
    run_command(
        git,
        ["submodule", "update", "--init", "--", *paths],
        cwd=REPOSITORY_ROOT,
    )

    incomplete = [
        submodule
        for submodule in missing
        if not (REPOSITORY_ROOT / submodule.path / submodule.marker).exists()
    ]
    if incomplete:
        fail(
            "vendor 子模块初始化完成，但必要文件仍缺失："
            + ", ".join(
                str(Path(submodule.path) / submodule.marker) for submodule in incomplete
            )
        )
    ok("必要的 vendor 子模块已就绪")


def ensure_dependencies(pnpm: str, options: Options) -> None:
    if options.check:
        if not INSTALL_MARKER.exists():
            fail("desktop 依赖未安装：请运行 python3 run-desktop.py --install")
        ok("desktop 依赖已安装")
        return
    info("安装 desktop 依赖（pnpm install）……首次可能较慢。")
    run_command(pnpm, ["install"])
    if not INSTALL_MARKER.exists():
        fail("pnpm install 完成后仍未找到 node_modules/.modules.yaml")
    ok("desktop 依赖就绪")


def target_triple() -> str:
    machine = platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    system = platform.system()
    if system == "Darwin":
        return "aarch64-apple-darwin" if arm else "x86_64-apple-darwin"
    if system == "Windows":
        return "aarch64-pc-windows-msvc" if arm else "x86_64-pc-windows-msvc"
    if system == "Linux":
        return "aarch64-unknown-linux-musl" if arm else "x86_64-unknown-linux-musl"
    fail(f"不支持的平台：{system}/{machine}")


def runtime_specs() -> list[RuntimeSpec]:
    executable = "codex.exe" if platform.system() == "Windows" else "codex"
    return [
        RuntimeSpec(
            label="Codex 0.164.0",
            entry=STUDIO_DIRECTORY / "build" / "codex" / target_triple() / executable,
            build_script="build:codex",
        ),
        RuntimeSpec(
            label="Pi 1.4.0",
            entry=STUDIO_DIRECTORY / "build" / "pi" / "runtime-manifest.json",
            build_script="build:pi",
            verify_script="verify:pi",
        ),
    ]


def ensure_agent_runtimes(pnpm: str, options: Options) -> None:
    for runtime in runtime_specs():
        if options.check:
            if not runtime.entry.exists():
                fail(f"{runtime.label} Runtime 未就绪：{runtime.entry}")
            ok(f"{runtime.label} Runtime 就绪")
            continue
        if runtime.entry.exists() and not options.rebuild_engines:
            ok(f"{runtime.label} Runtime 已就绪")
            continue
        info(f"准备 {runtime.label} Runtime……首次可能较慢。")
        run_command(
            pnpm,
            ["--filter", "@dramaip/desktop", "run", runtime.build_script],
        )
        if runtime.verify_script:
            run_command(
                pnpm,
                ["--filter", "@dramaip/desktop", "run", runtime.verify_script],
            )
        if not runtime.entry.exists():
            fail(f"{runtime.label} Runtime 构建完成，但入口不存在：{runtime.entry}")
        ok(f"{runtime.label} Runtime 就绪")


def read_package_version(package_file: Path) -> str | None:
    if not package_file.exists():
        return None
    try:
        value = json.loads(package_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    version = value.get("version")
    return version if isinstance(version, str) else None


def electron_package_directory() -> Path | None:
    for candidate in (
        STUDIO_DIRECTORY / "node_modules" / "electron",
        DESKTOP_DIRECTORY / "node_modules" / "electron",
    ):
        if candidate.exists():
            return candidate
    store = DESKTOP_DIRECTORY / "node_modules" / ".pnpm"
    if not store.exists():
        return None
    for entry in sorted(store.iterdir()):
        if not entry.name.startswith("electron@"):
            continue
        candidate = entry / "node_modules" / "electron"
        if candidate.exists():
            return candidate
    return None


def electron_platform() -> tuple[str, str]:
    system = platform.system()
    platform_name = "darwin" if system == "Darwin" else "win32" if system == "Windows" else "linux"
    machine = platform.machine().lower()
    arch = "x64" if machine in ("x86_64", "amd64") else machine
    return platform_name, arch


def electron_executable_path(platform_name: str) -> str:
    if platform_name in ("darwin", "mas"):
        return "Electron.app/Contents/MacOS/Electron"
    return "electron.exe" if platform_name == "win32" else "electron"


def electron_cache_directories() -> list[Path]:
    home = Path.home()
    system = platform.system()
    if system == "Darwin":
        return [home / "Library" / "Caches" / "electron"]
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        return [Path(local) / "electron" / "Cache"]
    cache = os.environ.get("XDG_CACHE_HOME") or str(home / ".cache")
    return [Path(cache) / "electron"]


def read_electron_mirror() -> str | None:
    npmrc = DESKTOP_DIRECTORY / ".npmrc"
    if not npmrc.exists():
        return None
    for raw_line in npmrc.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("electron_mirror="):
            return line[len("electron_mirror=") :].strip()
    return None


def electron_binary_ready(electron_directory: Path) -> bool:
    path_file = electron_directory / "path.txt"
    if not path_file.exists():
        return False
    relative_binary = path_file.read_text(encoding="utf-8").strip()
    return bool(relative_binary) and (
        electron_directory / "dist" / relative_binary
    ).exists()


def find_cached_electron_zip(version: str, platform_name: str, arch: str) -> Path | None:
    filename = f"electron-v{version}-{platform_name}-{arch}.zip"
    for cache_directory in electron_cache_directories():
        if not cache_directory.exists():
            continue
        flat = cache_directory / filename
        if flat.exists():
            return flat
        directories = [cache_directory]
        while directories:
            directory = directories.pop()
            try:
                entries = list(directory.iterdir())
            except OSError:
                continue
            for entry in entries:
                if entry.is_file() and entry.name == filename:
                    return entry
                if entry.is_dir():
                    directories.append(entry)
    return None


def extract_electron_zip(archive: Path, destination: Path) -> None:
    """用 Electron 自带的解压器展开缓存归档。"""
    helper = (
        "const { createRequire } = require('node:module');\n"
        "const require = createRequire(process.argv[2]);\n"
        "const loaded = require('@electron-internal/extract-zip');\n"
        "const extract = loaded.default ?? loaded.extract;\n"
        "if (typeof extract !== 'function') {"
        " console.error('Electron 内置的 ZIP 解压器不可用'); process.exit(1); }\n"
        "extract(process.argv[3], { dir: process.argv[4] }).then(\n"
        "  () => process.exit(0),\n"
        "  (error) => { console.error(error && error.message ? error.message : String(error)); process.exit(1); },\n"
        ");\n"
    )
    script = DESKTOP_DIRECTORY / "build" / "electron-extract.cjs"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(helper, encoding="utf-8")
    node = resolve_executable("node")
    if not node:
        fail("未找到 Node，无法解压 Electron 缓存")
    result = subprocess.run(
        [
            node,
            str(script),
            str((electron_package_directory() or DESKTOP_DIRECTORY) / "package.json"),
            str(archive),
            str(destination),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            (result.stderr or result.stdout or "Electron 缓存解压失败").strip()
        )


def ensure_electron(node: str, check: bool) -> Path:
    electron_directory = electron_package_directory()
    if electron_directory is None:
        fail("Electron 包未安装：请运行 python3 run-desktop.py --install")
    version = read_package_version(electron_directory / "package.json")
    if not version:
        fail("Electron 包版本无法识别")
    if electron_binary_ready(electron_directory):
        ok(f"electron 二进制就绪（v{version}）")
        return electron_directory
    if check:
        fail("Electron 二进制未就绪：请运行 python3 run-desktop.py")

    platform_name, arch = electron_platform()
    cached = find_cached_electron_zip(version, platform_name, arch)
    if cached:
        info(f"Electron 二进制缺失，从缓存解压 {cached}……")
        distribution = electron_directory / "dist"
        distribution.mkdir(parents=True, exist_ok=True)
        try:
            extract_electron_zip(cached, distribution)
            (electron_directory / "path.txt").write_text(
                electron_executable_path(platform_name), encoding="utf-8"
            )
        except Exception as error:  # noqa: BLE001 - 缓存损坏时回退到 install.js
            warn(f"Electron 缓存解压失败：{error}；改用 install.js")
        if electron_binary_ready(electron_directory):
            ok(f"electron 二进制就绪（v{version}，来自缓存）")
            return electron_directory
        warn("Electron 缓存解压后校验未通过，改用 install.js")

    install_script = electron_directory / "install.js"
    if not install_script.exists():
        fail(f"找不到 Electron 安装脚本：{install_script}")
    mirror = read_electron_mirror()
    environment = clean_environment(
        {
            "ELECTRON_MIRROR": mirror,
            "npm_config_electron_mirror": mirror,
        }
        if mirror
        else {}
    )
    info("Electron 二进制缺失，正在运行 install.js……")
    run_command(node, [str(install_script)], cwd=electron_directory, environment=environment)
    if not electron_binary_ready(electron_directory):
        fail("Electron install.js 执行完成，但二进制仍未就绪")
    ok(f"electron 二进制就绪（v{version}）")
    return electron_directory


def process_group_exists(process_id: int) -> bool:
    if platform.system() == "Windows":
        return False
    try:
        os.killpg(process_id, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def stop_development_process(child: subprocess.Popen[bytes]) -> None:
    if not child.pid:
        return
    warn("正在关闭 Electron 与开发服务器……")
    if platform.system() == "Windows":
        subprocess.run(
            ["taskkill", "/PID", str(child.pid), "/T"],
            capture_output=True,
            text=True,
        )
        if not wait_for_exit_with_timeout(child, 8.0):
            warn("开发进程未及时退出，正在强制关闭……")
            subprocess.run(
                ["taskkill", "/PID", str(child.pid), "/T", "/F"],
                capture_output=True,
                text=True,
            )
        return

    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except OSError:
        child.terminate()
    deadline = time.monotonic() + 8.0
    while process_group_exists(child.pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    if process_group_exists(child.pid):
        warn("开发进程未及时退出，正在强制关闭……")
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            child.kill()


def wait_for_exit_with_timeout(child: subprocess.Popen[bytes], timeout: float) -> bool:
    try:
        child.wait(timeout=timeout)
        return True
    except subprocess.TimeoutExpired:
        return False


def run_development_server(pnpm: str, dev_arguments: list[str]) -> int:
    if "ELECTRON_RUN_AS_NODE" in os.environ:
        warn("已从子进程环境中移除 ELECTRON_RUN_AS_NODE，避免 Electron 以 Node 模式启动")
    info("启动 desktop 开发模式（Ctrl-C 关闭）……")
    command = [pnpm, "--filter", "@dramaip/desktop", "run", "dev:raw"]
    if dev_arguments:
        command.extend(["--", *dev_arguments])
    child = subprocess.Popen(
        command,
        cwd=str(DESKTOP_DIRECTORY),
        env=clean_environment(),
        start_new_session=True,
    )

    stopping = False

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        stop_development_process(child)

    previous_int = signal.signal(signal.SIGINT, request_stop)
    previous_term = signal.signal(signal.SIGTERM, request_stop)
    try:
        code = child.wait()
    finally:
        signal.signal(signal.SIGINT, previous_int)
        signal.signal(signal.SIGTERM, previous_term)

    if stopping:
        ok("已关闭 desktop")
        return 0
    if code == 0:
        return 0
    stop_development_process(child)
    warn(f"desktop dev 异常退出（退出码 {code}）")
    return code


def main() -> int:
    options = parse_options(sys.argv[1:])
    if options is None:
        return 0
    if not STUDIO_DIRECTORY.exists():
        fail(f"找不到 desktop Studio 目录：{STUDIO_DIRECTORY}")

    sys.stdout.write(f"{color('1;36', '▶ desktop 一键启动')}\n")
    toolchain = check_toolchain()
    ensure_vendor_submodules(options.check)
    run_command(
        toolchain.node,
        ["scripts/prepare-dsh-framework.mjs", *(["--check"] if options.check else [])],
    )
    ensure_dependencies(toolchain.pnpm, options)
    if not options.check:
        run_command(toolchain.pnpm, ["run", "build:framework"])
    run_command(toolchain.node, ["scripts/check-dsh-framework.mjs"])
    ensure_agent_runtimes(toolchain.pnpm, options)
    ensure_electron(toolchain.node, options.check)
    if not options.check:
        run_command(toolchain.pnpm, ["run", "plugins:generate"])
        run_command(toolchain.pnpm, ["run", "build:runtime"])

    if options.check:
        ok("desktop 启动环境检查通过")
        return 0
    return run_development_server(toolchain.pnpm, options.dev_arguments)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        sys.stderr.write(f"{color('31', '✗ ')}{error}\n")
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
