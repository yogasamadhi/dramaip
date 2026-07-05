#!/usr/bin/env python3
"""
一键启动 dramaip-desktop（Electron + Vite 开发模式）。

流程：
  1. 前置检查：Node >= 20、pnpm 可用
  2. 依赖：node_modules 缺失时自动 pnpm install
  3. electron 二进制：确保 electron/dist + path.txt 就位
     —— pnpm 有时只装了 electron 的 JS 壳、没下载二进制本体（postinstall 未完成），
        表现为 dev 报 "Error: Electron uninstall"。
        优先用已缓存的 zip 解压（秒级、可靠），无缓存再跑 install.js 下载。
  4. 原生模块：按需按 Electron ABI 重编 better-sqlite3
  5. 启动：pnpm dev，并剥离 ELECTRON_RUN_AS_NODE（否则 electron 以 node 模式启动，
     dev 报 "Cannot read properties of undefined (reading 'whenReady')" 崩溃）

用法：
  python3 run-desktop.py             # 默认：检查 + 修补 + 按需 rebuild + 启动 dev
  python3 run-desktop.py --rebuild   # 强制重编 better-sqlite3（Electron ABI）
  python3 run-desktop.py --no-rebuild
  python3 run-desktop.py --install   # 强制 pnpm install

注意：
  - 重编用 `pnpm run rebuild`（显式走根脚本 → electron-rebuild）。
    裸 `pnpm rebuild` 命中的是 pnpm 内建命令（Node ABI），不是 Electron 重编。
"""

from __future__ import annotations

import argparse
import json
import os
import platform as _platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

# --- 路径定位（基于脚本位置，不依赖 CWD）---
SCRIPT_DIR = Path(__file__).resolve().parent
DESKTOP_DIR = SCRIPT_DIR / "dramaip-desktop"
INSTALL_MARKER = DESKTOP_DIR / "node_modules" / ".modules.yaml"
REBUILD_MARKER = DESKTOP_DIR / "node_modules" / ".rebuild-electron-marker"
NODE_MIN_MAJOR = 20

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
        err("未检测到 node。请先安装 Node.js >= 20。")
        sys.exit(1)
    major = int(ver.lstrip("v").split(".")[0])
    if major < NODE_MIN_MAJOR:
        err(f"node 版本过低：{ver}，需要 >= v{NODE_MIN_MAJOR}。")
        sys.exit(1)
    ok(f"node {ver}")
    return ver


def resolve_pnpm() -> list[str]:
    """优先用 PATH 上的 pnpm；缺失则尝试 corepack；都没有则报错。"""
    if shutil.which("pnpm"):
        return ["pnpm"]
    if shutil.which("corepack"):
        warn("PATH 上无 pnpm，改用 corepack pnpm（按 packageManager 锁版本）。")
        return ["corepack", "pnpm"]
    err("未检测到 pnpm / corepack。安装：npm i -g pnpm，或 corepack enable。")
    sys.exit(1)


def ensure_deps(pnpm: list[str], force_install: bool) -> None:
    if force_install or not INSTALL_MARKER.exists():
        info("安装依赖（pnpm install）……首次可能较慢。")
        run(pnpm + ["install"])
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
    base = DESKTOP_DIR / "node_modules" / ".pnpm"
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
        warn("找不到 electron 包（node_modules/.pnpm/electron@*），跳过二进制检查")
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

    # 2) 退路：跑 electron 自带 install.js 下载（可能需 1~2 分钟）
    info("electron 二进制缺失，运行 install.js 下载（首次可能较慢）…")
    install_js = elex / "install.js"
    env = os.environ.copy()
    mirror = _read_electron_mirror()
    if mirror:
        env["ELECTRON_MIRROR"] = mirror
        env["npm_config_electron_mirror"] = mirror
    try:
        subprocess.run(["node", str(install_js)], cwd=str(elex), env=env, check=True)
    except subprocess.CalledProcessError as e:
        err(f"electron install.js 失败（退出码 {e.returncode}）")
        sys.exit(1)
    if _binary_ok(elex):
        ok(f"electron 二进制就绪（v{ver}）")
    else:
        err("electron 二进制仍未就绪。手动修复：到 electron 包目录跑 `node install.js`，"
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


def do_rebuild(pnpm: list[str], node_ver: str) -> None:
    info("按 Electron ABI 重编 better-sqlite3（pnpm run rebuild）……")
    run(pnpm + ["run", "rebuild"])  # 根脚本 -> electron-rebuild -f -w better-sqlite3
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


def main() -> None:
    ap = argparse.ArgumentParser(description="一键启动 dramaip-desktop 开发模式")
    ap.add_argument("--install", action="store_true", help="强制 pnpm install")
    ap.add_argument("--rebuild", action="store_true", help="强制重编 better-sqlite3（Electron ABI）")
    ap.add_argument("--no-rebuild", action="store_true", help="跳过原生模块重编检查")
    args = ap.parse_args()

    if not DESKTOP_DIR.is_dir():
        err(f"找不到桌面项目目录：{DESKTOP_DIR}")
        sys.exit(1)

    print(_c("1;36", "▶ dramaip-desktop 一键启动"))
    node_ver = check_node()
    pnpm = resolve_pnpm()
    pnpm_ver = sh(pnpm + ["--version"]) or "?"
    ok(f"pnpm {pnpm_ver}" + ("（corepack）" if pnpm[0] == "corepack" else ""))

    ensure_deps(pnpm, args.install)
    ensure_electron()

    if need_rebuild(args.rebuild, args.no_rebuild, node_ver):
        do_rebuild(pnpm, node_ver)
    else:
        ok("原生模块已是最新，跳过 rebuild")

    env = clean_env()
    if "ELECTRON_RUN_AS_NODE" in os.environ:
        warn(f"已剥离环境变量 ELECTRON_RUN_AS_NODE={os.environ['ELECTRON_RUN_AS_NODE']!r}（避免 dev 崩溃）")

    info("启动开发模式（pnpm dev）……Ctrl-C 退出。")
    try:
        run(pnpm + ["dev"], env=env)  # electron-vite dev
    except KeyboardInterrupt:
        print()
        ok("已退出 dev")


if __name__ == "__main__":
    main()
