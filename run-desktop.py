#!/usr/bin/env python3
"""
一键启动 desktop（Electron + Vite 开发模式）。

流程：
  1. 前置检查：Bun 1.3.14、Node >= 22.12.0 可用
  2. 依赖：node_modules 缺失时自动 bun install
  3. electron 二进制：确保 electron/dist + path.txt 就位
     —— 安装脚本未完成时，可能只装了 electron 的 JS 壳、没下载二进制本体，
        表现为 dev 报 "Error: Electron uninstall"。
        优先用已缓存的 zip 解压（秒级、可靠），无缓存再跑 install.js 下载。
  4. 原生模块：按需按 Electron ABI 重编 better-sqlite3
  5. 启动：bun run dev，并剥离 ELECTRON_RUN_AS_NODE（否则 electron 以 node 模式启动，
     dev 报 "Cannot read properties of undefined (reading 'whenReady')" 崩溃）

用法：
  python3 run-desktop.py             # 默认：检查 + 修补 + 按需 rebuild + 启动 dev
  python3 run-desktop.py --rebuild   # 强制重编 better-sqlite3（Electron ABI）
  python3 run-desktop.py --no-rebuild
  python3 run-desktop.py --install   # 强制 bun install

注意：
  - 重编用 `bun run rebuild`（显式走根脚本 → electron-rebuild）。
    不要使用裸 `bun rebuild`；它不会执行项目的 Electron ABI 重编脚本。
"""

from __future__ import annotations

import argparse
import json
import os
import platform as _platform
import signal
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

# --- 路径定位（基于脚本位置，不依赖 CWD）---
SCRIPT_DIR = Path(__file__).resolve().parent
DESKTOP_DIR = SCRIPT_DIR / "desktop"
INSTALL_MARKER = DESKTOP_DIR / "node_modules" / ".bun"
REBUILD_MARKER = DESKTOP_DIR / "node_modules" / ".rebuild-electron-marker"
NODE_MIN_VERSION = (22, 12, 0)
BUN_VERSION = "1.3.14"

# --- 输出（非 TTY 自动去色）---
_COLOR = sys.stdout.isatty()


def _c(code: str, msg: str) -> str:
    return f"\033[{code}m{msg}\033[0m" if _COLOR else msg


def info(msg: str) -> None:
    print(_c("36", "• ") + msg)


def ok(msg: str) -> None:
    print(_c("32", "✓ ") + msg)


def warn(msg: str) -> None:
    print(_c("33", "! ") + msg)


def err(msg: str) -> None:
    print(_c("31", "✗ ") + msg, file=sys.stderr)


# ---------------------------------------------------------------------------
# 基础执行工具
# ---------------------------------------------------------------------------

def run(cmd: list[str], env: dict | None = None) -> None:
    """前台执行命令，实时透传输出；失败则干净退出。"""
    try:
        subprocess.run(cmd, cwd=str(DESKTOP_DIR), env=env, check=True)
    except subprocess.CalledProcessError as e:
        err(f"命令失败（退出码 {e.returncode}）：{' '.join(cmd)}")
        sys.exit(1)


def sh(cmd: list[str], env: dict | None = None) -> str | None:
    """执行命令并返回 stdout（去空白）；失败返回 None。"""
    try:
        r = subprocess.run(cmd, cwd=str(DESKTOP_DIR), env=env,
                           capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
    except FileNotFoundError:
        pass
    return None


def check_node() -> str:
    ver = sh(["node", "--version"])
    if not ver:
        err("未检测到 node。请先安装 Node.js >= 22.12.0（Electron 运行时/ABI 边界）。")
        sys.exit(1)
    try:
        version = tuple(int(part) for part in ver.lstrip("v").split(".")[:3])
    except ValueError:
        err(f"无法解析 node 版本：{ver}")
        sys.exit(1)
    if version < NODE_MIN_VERSION:
        err(f"node 版本过低：{ver}，需要 >= v{'.'.join(map(str, NODE_MIN_VERSION))}。")
        sys.exit(1)
    ok(f"node {ver}")
    return ver


def resolve_bun() -> list[str]:
    """要求 PATH 上存在项目固定版本的 Bun。"""
    if shutil.which("bun"):
        return ["bun"]
    err("未检测到 Bun。请安装 Bun 1.3.14 后重试：https://bun.sh/docs/installation")
    sys.exit(1)


def check_bun(bun: list[str]) -> str:
    ver = sh(bun + ["--version"])
    if ver != BUN_VERSION:
        err(f"Bun 版本不匹配：检测到 {ver or '未知'}，需要 {BUN_VERSION}。")
        sys.exit(1)
    ok(f"bun {ver}")
    return ver


def ensure_deps(bun: list[str], force_install: bool) -> None:
    if force_install or not INSTALL_MARKER.exists():
        info("安装依赖（bun install）……首次可能较慢。")
        run(bun + ["install"])
        ok("依赖就绪")
    else:
        ok("依赖已安装，跳过 install")


# ---------------------------------------------------------------------------
# electron 二进制本体
# ---------------------------------------------------------------------------

def _pkg_ver(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text()).get("version")
    except Exception:
        return None


def _electron_pkg_dir() -> Path | None:
    workspace_package = DESKTOP_DIR / "apps" / "desktop" / "node_modules" / "electron"
    if workspace_package.exists():
        return workspace_package
    base = DESKTOP_DIR / "node_modules" / ".bun"
    hits = sorted(base.glob("electron@*/node_modules/electron"))
    return hits[0] if hits else None


def _electron_platform_arch() -> tuple[str, str]:
    sysname = _platform.system()
    plat = {"Darwin": "darwin", "Windows": "win32"}.get(sysname, "linux")
    mach = _platform.machine().lower()
    arch = {"x86_64": "x64", "amd64": "x64",
            "arm64": "arm64", "aarch64": "arm64"}.get(mach, mach)
    return plat, arch


def _platform_path(plat: str) -> str:
    return {"darwin": "Electron.app/Contents/MacOS/Electron",
            "mas": "Electron.app/Contents/MacOS/Electron",
            "linux": "electron",
            "win32": "electron.exe"}.get(plat, "electron")


def _electron_cache_dirs() -> list[Path]:
    home = Path.home()
    sysname = _platform.system()
    if sysname == "Darwin":
        return [home / "Library" / "Caches" / "electron"]
    if sysname == "Windows":
        local = os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local"))
        return [Path(local) / "electron" / "Cache"]
    xdg = os.environ.get("XDG_CACHE_HOME", str(home / ".cache"))
    return [Path(xdg) / "electron"]


def _read_electron_mirror() -> str | None:
    npmrc = DESKTOP_DIR / ".npmrc"
    if not npmrc.exists():
        return None
    for line in npmrc.read_text().splitlines():
        line = line.strip()
        if line.startswith("electron_mirror="):
            return line.split("=", 1)[1].strip()
    return None


def _binary_ok(elex: Path) -> bool:
    pt = elex / "path.txt"
    if not pt.exists():
        return False
    rel = pt.read_text().strip()
    return (elex / "dist" / rel).exists()


def _find_cached_zip(ver: str, plat: str, arch: str) -> Path | None:
    name = f"electron-v{ver}-{plat}-{arch}.zip"
    for d in _electron_cache_dirs():
        if not d.exists():
            continue
        flat = d / name
        if flat.exists():
            return flat
        for hit in d.rglob(name):  # @electron/get 的哈希子目录
            return hit
    return None


def _extract_zip(zip_path: Path, dest: Path) -> None:
    """解压并保留 unix 可执行位（Python zipfile 默认会丢权限，需手动恢复）。"""
    with zipfile.ZipFile(zip_path) as z:
        for member in z.infolist():
            z.extract(member, dest)
            mode = (member.external_attr >> 16) & 0o777
            if mode:
                try:
                    os.chmod(os.path.join(dest, member.filename), mode)
                except OSError:
                    pass


def ensure_electron() -> None:
    elex = _electron_pkg_dir()
    if not elex:
        warn("找不到 electron 包（apps/desktop/node_modules/electron），跳过二进制检查")
        return
    ver = _pkg_ver(elex / "package.json") or "?"
    plat, _arch = _electron_platform_arch()

    if _binary_ok(elex):
        ok(f"electron 二进制就绪（v{ver}）")
        return

    # 1) 优先用已缓存的 zip 解压（快、可靠，绕开镜像下载卡顿）
    cached = _find_cached_zip(ver, plat, _arch)
    if cached:
        info(f"electron 二进制缺失，从缓存解压 {cached.name} …")
        dist = elex / "dist"
        dist.mkdir(exist_ok=True)
        try:
            _extract_zip(cached, dist)
            (elex / "path.txt").write_text(_platform_path(plat))
        except Exception as e:
            warn(f"缓存解压出错：{e}；改用 install.js")
        else:
            if _binary_ok(elex):
                ok(f"electron 二进制就绪（v{ver}，来自缓存）")
                return
            warn("缓存解压后校验仍失败，改用 install.js 下载")

    # 2) 退路：用 Bun 运行 electron 自带 install.js 下载（可能需 1~2 分钟）
    info("electron 二进制缺失，用 Bun 运行 install.js 下载（首次可能较慢）…")
    install_js = elex / "install.js"
    env = os.environ.copy()
    mirror = _read_electron_mirror()
    if mirror:
        env["ELECTRON_MIRROR"] = mirror
        env["npm_config_electron_mirror"] = mirror
    try:
        subprocess.run(["bun", "run", str(install_js)], cwd=str(elex), env=env, check=True)
    except subprocess.CalledProcessError as e:
        err(f"electron install.js 失败（退出码 {e.returncode}）")
        sys.exit(1)
    if _binary_ok(elex):
        ok(f"electron 二进制就绪（v{ver}）")
    else:
        err("electron 二进制仍未就绪。手动修复：到 electron 包目录跑 `bun run install.js`，"
            "或检查 npmmirror 网络后重试。")
        sys.exit(1)


# ---------------------------------------------------------------------------
# 原生模块重编（better-sqlite3 → Electron ABI）
# ---------------------------------------------------------------------------

def need_rebuild(force: bool, skip: bool, node_ver: str) -> bool:
    if skip:
        return False
    if force:
        return True
    electron = _pkg_ver(DESKTOP_DIR / "apps/desktop/node_modules/electron/package.json")
    bsqlite = _pkg_ver(DESKTOP_DIR / "apps/desktop/node_modules/better-sqlite3/package.json")
    if not (electron and bsqlite):
        return True  # 信息不全（多半没装好），保守重编
    expected = f"electron={electron}\nbsqlite={bsqlite}\nnode={node_ver}\n"
    if REBUILD_MARKER.exists() and REBUILD_MARKER.read_text() == expected:
        return False
    return True


def do_rebuild(bun: list[str], node_ver: str) -> None:
    info("按 Electron ABI 重编 better-sqlite3（bun run rebuild）……")
    run(bun + ["run", "rebuild"])  # 根脚本 -> electron-rebuild -f -w better-sqlite3
    electron = _pkg_ver(DESKTOP_DIR / "apps/desktop/node_modules/electron/package.json")
    bsqlite = _pkg_ver(DESKTOP_DIR / "apps/desktop/node_modules/better-sqlite3/package.json")
    if electron and bsqlite:
        REBUILD_MARKER.write_text(
            f"electron={electron}\nbsqlite={bsqlite}\nnode={node_ver}\n"
        )
    ok("原生模块就绪（Electron ABI）")


# ---------------------------------------------------------------------------
# dev 启动
# ---------------------------------------------------------------------------

def clean_env() -> dict:
    """剥离会破坏 electron 启动的环境变量。"""
    env = os.environ.copy()
    # ELECTRON_RUN_AS_NODE：让 electron 以纯 node 启动，dev 必崩。
    env.pop("ELECTRON_RUN_AS_NODE", None)
    return env


def stop_dev_process(process: subprocess.Popen) -> None:
    """终止 bun run dev 及其派生的 Electron / Vite 进程。"""
    warn("正在关闭 Electron 与开发服务器……")
    if os.name == "nt":
        if process.poll() is not None:
            return
        try:
            process.send_signal(signal.CTRL_BREAK_EVENT)
            process.wait(timeout=8)
            return
        except ProcessLookupError:
            return
        except subprocess.TimeoutExpired:
            warn("开发进程未及时退出，正在强制关闭……")
            process.kill()
            process.wait()
            return
        except OSError:
            process.terminate()
            return

    # 即使 Bun 已先退出，Electron 仍可能由 init 接管，但会留在原进程组。
    # 因此不能根据 process.poll() 提前返回，必须始终清理 process.pid 对应的组。
    process_group = process.pid
    try:
        os.killpg(process_group, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        try:
            process.kill()
        except ProcessLookupError:
            return
        return

    deadline = time.monotonic() + 8
    while _process_group_exists(process_group) and time.monotonic() < deadline:
        time.sleep(0.1)
    if _process_group_exists(process_group):
        warn("开发进程未及时退出，正在强制关闭……")
        try:
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            return


def _process_group_exists(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # 当前用户无权探测时，保守地视为仍在运行，交由超时后的强制终止处理。
        return True
    return True


def run_dev(cmd: list[str], env: dict) -> None:
    """启动独立进程组，保证 Ctrl-C 能同时关闭 Electron 窗口。"""
    popen_kwargs: dict = {"cwd": str(DESKTOP_DIR), "env": env}
    if os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kwargs["start_new_session"] = True

    try:
        process = subprocess.Popen(cmd, **popen_kwargs)
    except FileNotFoundError:
        err(f"命令未找到：{cmd[0]}")
        sys.exit(1)

    try:
        code = process.wait()
    except KeyboardInterrupt:
        print()
        stop_dev_process(process)
        ok("已关闭 Electron 并退出 dev")
        return

    if code != 0:
        stop_dev_process(process)
        err(f"dev 异常退出（退出码 {code}）：{' '.join(cmd)}")
        sys.exit(code)


def main() -> None:
    ap = argparse.ArgumentParser(description="一键启动 desktop 开发模式")
    ap.add_argument("--install", action="store_true", help="强制 bun install")
    ap.add_argument("--rebuild", action="store_true", help="强制重编 better-sqlite3（Electron ABI）")
    ap.add_argument("--no-rebuild", action="store_true", help="跳过原生模块重编检查")
    args = ap.parse_args()

    if not DESKTOP_DIR.is_dir():
        err(f"找不到桌面项目目录：{DESKTOP_DIR}")
        sys.exit(1)

    print(_c("1;36", "▶ desktop 一键启动"))
    node_ver = check_node()
    bun = resolve_bun()
    check_bun(bun)

    ensure_deps(bun, args.install)
    ensure_electron()

    if need_rebuild(args.rebuild, args.no_rebuild, node_ver):
        do_rebuild(bun, node_ver)
    else:
        ok("原生模块已是最新，跳过 rebuild")

    env = clean_env()
    if "ELECTRON_RUN_AS_NODE" in os.environ:
        warn(f"已剥离环境变量 ELECTRON_RUN_AS_NODE={os.environ['ELECTRON_RUN_AS_NODE']!r}（避免 dev 崩溃）")

    info("启动开发模式（bun run dev）……Ctrl-C 退出。")
    run_dev(bun + ["run", "dev"], env=env)  # electron-vite dev


if __name__ == "__main__":
    main()
