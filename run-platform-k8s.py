#!/usr/bin/env python3
"""
One-click Kubernetes launcher for dramaip-platform.

Default flow:
  1. Check docker, kubectl, and helm.
  2. Optionally create/start a local kind/minikube cluster.
  3. Build the service images from dramaip-platform/services/Dockerfile.service.
  4. Load the image into kind/minikube when the current context suggests it.
  5. Install or upgrade Kong Ingress Controller.
  6. Install or upgrade the dramaip-platform Helm chart.
  7. Wait for the BFF Deployment rollout.
  8. Port-forward Kong locally and start the Next.js web app.

For local kind/minikube/docker-desktop development, the chart also starts
dev PostgreSQL, Redis, RabbitMQ, and OpenTelemetry Collector unless disabled.

Examples:
  python3 run-platform-k8s.py        # auto-creates a local kind cluster when no cluster is reachable
  python3 run-platform-k8s.py --install-kind --create-kind
  python3 run-platform-k8s.py --install-helm
  python3 run-platform-k8s.py --host api.localtest.me
  python3 run-platform-k8s.py --skip-kong --no-ingress
  python3 run-platform-k8s.py --dry-run
  python3 run-platform-k8s.py --no-web
  python3 run-platform-k8s.py --image-repo ghcr.io/dramaip/dramaip-web-bff --image-tag 0.1.0 --no-build
"""

from __future__ import annotations

import argparse
import os
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR / "dramaip-platform"
SERVICES_DIR = PLATFORM_DIR / "services"
CLIENTS_DIR = PLATFORM_DIR / "clients"
CHART_DIR = PLATFORM_DIR / "deploy" / "helm" / "dramaip-platform"
DEV_VALUES = CHART_DIR / "values-dev.yaml"
K8S_DATA_DIR = PLATFORM_DIR / "deploy" / "k8s" / ".data"
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

DEFAULT_NAMESPACE = "dramaip"
DEFAULT_RELEASE = "dramaip-platform"
DEFAULT_KONG_NAMESPACE = "kong"
DEFAULT_KONG_RELEASE = "kong"
DEFAULT_KONG_REPO_NAME = "kong"
DEFAULT_KONG_REPO_URL = "https://charts.konghq.com"
DEFAULT_KONG_CHART = "kong/ingress"
DEFAULT_KONG_GATEWAY_IMAGE = "kong:3.9-ubuntu"
DEFAULT_KONG_CONTROLLER_IMAGE = "kong/kubernetes-ingress-controller:3.5"
DEFAULT_TIMEOUT = "10m"

SERVICE_IMAGES = (
    ("webBff", "dramaip-web-bff", "./app/bff/web/interface/cmd/server"),
    ("auth", "dramaip-auth", "./app/auth/service/cmd/server"),
    ("user", "dramaip-user", "./app/user/service/cmd/server"),
    ("billing", "dramaip-billing", "./app/billing/service/cmd/server"),
    ("quota", "dramaip-quota", "./app/quota/service/cmd/server"),
    ("aiGateway", "dramaip-ai-gateway", "./app/ai_gateway/service/cmd/server"),
    ("billingJob", "dramaip-billing-job", "./app/billing/job/cmd/server"),
    ("quotaJob", "dramaip-quota-job", "./app/quota/job/cmd/server"),
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


def command_text(cmd: list[str], cwd: Path | None = None) -> str | None:
    try:
        result = subprocess.run(cmd, cwd=str(cwd or SCRIPT_DIR), capture_output=True, text=True)
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def run(cmd: list[str], cwd: Path | None = None, dry_run: bool = False) -> None:
    printable = " ".join(cmd)
    if dry_run:
        print(_c("90", f"$ {printable}"))
        return
    try:
        subprocess.run(cmd, cwd=str(cwd or SCRIPT_DIR), check=True)
    except FileNotFoundError:
        err(f"Command not found: {cmd[0]}")
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        err(f"Command failed with exit code {exc.returncode}: {printable}")
        sys.exit(exc.returncode)


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
    docker_markers = ("com.docker", "docker-proxy", "dockerd", "vpnkit")
    return any(marker in command for marker in docker_markers)


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
            f"{label} has Docker proxy PID(s) "
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


def release_port(port: int, label: str, kill_ports: bool) -> None:
    pids = listening_pids(port)
    if not pids:
        return
    if not kill_ports:
        raise RuntimeError(f"{label} port {port} is occupied by PID(s) {', '.join(str(pid) for pid in pids)}.")
    kill_pids(pids, f"{label} port {port}")


def is_port_free(port: int) -> bool:
    checks = (("127.0.0.1", port), ("::1", port))
    for address in checks:
        try:
            with socket.create_connection(address, timeout=0.15):
                return False
        except OSError:
            continue
    return True


def wait_for_tcp(port: int, name: str, timeout_s: float = 30.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not is_port_free(port):
            ok(f"{name} is listening on localhost:{port}")
            return
        time.sleep(0.3)
    raise RuntimeError(f"{name} did not start listening on localhost:{port} within {timeout_s:.0f}s.")


def start_process(name: str, cmd: list[str], cwd: Path, env: dict[str, str]) -> subprocess.Popen:
    info(f"Starting {name}: {' '.join(cmd)}")
    try:
        return subprocess.Popen(cmd, cwd=str(cwd), env=env, start_new_session=True)
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
    ok("platform K8s dev processes started")
    print("")
    for label, url in urls:
        print(f"{label}: {url}")
    print("")
    print("Press Ctrl+C to stop local port-forward and web processes.")

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


def require_tool(name: str, dry_run: bool = False) -> None:
    if not shutil.which(name):
        if dry_run:
            warn(f"Missing command during dry-run: {name}")
            return
        err(f"Missing required command: {name}")
        sys.exit(1)
    ok(f"{name} found")


def check_node(args: argparse.Namespace) -> None:
    if args.no_web:
        return
    version = command_text(["node", "--version"], CLIENTS_DIR)
    if not version:
        if args.dry_run:
            warn("Missing command during dry-run: node")
            return
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


def resolve_pnpm(args: argparse.Namespace) -> list[str]:
    if args.no_web:
        return []
    if shutil.which("pnpm"):
        return ["pnpm"]
    if shutil.which("corepack"):
        warn("pnpm was not found on PATH; using corepack pnpm.")
        return ["corepack", "pnpm"]
    if args.dry_run:
        warn("Missing command during dry-run: pnpm/corepack")
        return ["pnpm"]
    err("pnpm/corepack is not available. Install pnpm or enable corepack first.")
    sys.exit(1)


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


def ensure_client_deps(args: argparse.Namespace, pnpm: list[str]) -> None:
    if args.no_web:
        return
    if args.no_install:
        warn("Skipping clients dependency install.")
        return

    should_install = args.install or not CLIENT_INSTALL_MARKER.exists() or not client_modules_resolve()
    if not should_install:
        ok("clients dependencies already installed")
        return

    info("Installing clients dependencies with pnpm install")
    run(pnpm + ["install"], cwd=CLIENTS_DIR, dry_run=args.dry_run)
    if not args.dry_run and not client_modules_resolve():
        err("Clients dependencies are still incomplete after pnpm install.")
        sys.exit(1)
    ok("clients dependencies ready")


def ensure_helm(args: argparse.Namespace) -> None:
    if shutil.which("helm"):
        ok("helm found")
        return
    if args.dry_run:
        warn("Missing command during dry-run: helm")
        return
    if not args.install_helm:
        err("Missing required command: helm")
        print()
        print("Install Helm first, then rerun this script:")
        print("  brew install helm")
        print()
        print("Or let this launcher install it with Homebrew:")
        print("  python3 run-platform-k8s.py --install-helm")
        sys.exit(1)

    if not shutil.which("brew"):
        err("Helm is missing and Homebrew is not available.")
        print()
        print("Install Helm manually:")
        print("  https://helm.sh/docs/intro/install/")
        sys.exit(1)

    info("Installing Helm with Homebrew")
    run(["brew", "install", "helm"], dry_run=args.dry_run)
    if not shutil.which("helm"):
        err("Helm installation finished, but helm is still not on PATH.")
        sys.exit(1)
    ok("helm installed")


def ensure_kind(args: argparse.Namespace) -> None:
    if shutil.which("kind"):
        ok("kind found")
        return
    if args.dry_run:
        warn("Missing command during dry-run: kind")
        return
    if not args.install_kind:
        err("kind is missing.")
        print()
        print("Install kind first, then rerun:")
        print("  brew install kind")
        print()
        print("Or let this launcher install it with Homebrew:")
        print("  python3 run-platform-k8s.py --install-kind --create-kind")
        sys.exit(1)
    if not shutil.which("brew"):
        err("kind is missing and Homebrew is not available.")
        print()
        print("Install kind manually:")
        print("  https://kind.sigs.k8s.io/docs/user/quick-start/#installation")
        sys.exit(1)

    info("Installing kind with Homebrew")
    run(["brew", "install", "kind"], dry_run=args.dry_run)
    if not shutil.which("kind"):
        err("kind installation finished, but kind is still not on PATH.")
        sys.exit(1)
    ok("kind installed")


def ensure_minikube(args: argparse.Namespace) -> None:
    if shutil.which("minikube"):
        ok("minikube found")
        return
    if args.dry_run:
        warn("Missing command during dry-run: minikube")
        return
    if not args.install_minikube:
        err("minikube is missing.")
        print()
        print("Install minikube first, then rerun:")
        print("  brew install minikube")
        print()
        print("Or let this launcher install it with Homebrew:")
        print("  python3 run-platform-k8s.py --install-minikube --start-minikube")
        sys.exit(1)
    if not shutil.which("brew"):
        err("minikube is missing and Homebrew is not available.")
        print()
        print("Install minikube manually:")
        print("  https://minikube.sigs.k8s.io/docs/start/")
        sys.exit(1)

    info("Installing minikube with Homebrew")
    run(["brew", "install", "minikube"], dry_run=args.dry_run)
    if not shutil.which("minikube"):
        err("minikube installation finished, but minikube is still not on PATH.")
        sys.exit(1)
    ok("minikube installed")


def check_layout() -> None:
    missing = [path for path in (PLATFORM_DIR, SERVICES_DIR, CLIENTS_DIR, CHART_DIR, DEV_VALUES) if not path.exists()]
    if missing:
        err("Missing required paths:")
        for path in missing:
            err(f"  {path}")
        sys.exit(1)
    ok("platform Kubernetes layout found")


def ensure_k8s_data_dirs(args: argparse.Namespace) -> str:
    data_dir = Path(args.k8s_data_dir).expanduser()
    if not data_dir.is_absolute():
        data_dir = (SCRIPT_DIR / data_dir).resolve()
    else:
        data_dir = data_dir.resolve()

    if args.dry_run:
        print(_c("90", f"$ mkdir -p {data_dir}/postgres {data_dir}/redis {data_dir}/rabbitmq"))
        return str(data_dir)

    for child in ("postgres", "redis", "rabbitmq"):
        (data_dir / child).mkdir(parents=True, exist_ok=True)
    ok(f"K8s dev data directory ready: {data_dir}")
    return str(data_dir)


def yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_kind_config(args: argparse.Namespace, cluster_name: str) -> Path:
    data_dir = ensure_k8s_data_dirs(args)
    config = f"""kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraMounts:
      - hostPath: {yaml_quote(data_dir)}
        containerPath: {yaml_quote(data_dir)}
"""
    if args.dry_run:
        config_path = Path(tempfile.gettempdir()) / f"dramaip-kind-{cluster_name}.yaml"
        print(_c("90", f"$ cat > {config_path}  # kind hostPath config for {data_dir}"))
        return config_path

    with tempfile.NamedTemporaryFile("w", prefix=f"dramaip-kind-{cluster_name}-", suffix=".yaml", delete=False) as file:
        file.write(config)
        return Path(file.name)


def kubectl_base(args: argparse.Namespace) -> list[str]:
    cmd = ["kubectl"]
    if args.context:
        cmd.extend(["--context", args.context])
    return cmd


def helm_base(args: argparse.Namespace) -> list[str]:
    cmd = ["helm"]
    if args.context:
        cmd.extend(["--kube-context", args.context])
    return cmd


def current_context(args: argparse.Namespace) -> str:
    if args.context:
        return args.context
    out = command_text(["kubectl", "config", "current-context"])
    return out or ""


def local_cluster_mode(args: argparse.Namespace) -> str:
    context = current_context(args)
    if context.startswith("kind-"):
        return "kind"
    if context == "minikube" or context.startswith("minikube"):
        return "minikube"
    if context == "docker-desktop":
        return "docker-desktop"
    return ""


def is_local_dev_cluster(args: argparse.Namespace) -> bool:
    return local_cluster_mode(args) in {"kind", "minikube", "docker-desktop"}


def check_cluster(args: argparse.Namespace) -> None:
    if args.dry_run:
        run(kubectl_base(args) + ["cluster-info"], dry_run=True)
        ok("kubectl can reach the cluster")
        return

    result = subprocess.run(kubectl_base(args) + ["cluster-info"], capture_output=True, text=True)
    if result.returncode != 0:
        err("kubectl cannot reach a Kubernetes cluster.")
        context = current_context(args)
        if context:
            print(f"Current context: {context}")
        else:
            print("Current context: not set")
        print()
        print("Choose one of these paths:")
        print("  1. Create a local kind cluster:")
        print("     python3 run-platform-k8s.py --install-kind --create-kind")
        print("  2. Start minikube:")
        print("     python3 run-platform-k8s.py --install-minikube --start-minikube")
        print("  3. Use an existing cluster context:")
        print("     kubectl config get-contexts")
        print("     python3 run-platform-k8s.py --context <context-name>")
        print()
        print("kubectl said:")
        details = (result.stderr or result.stdout).strip()
        print(details if details else "cluster-info failed")
        sys.exit(result.returncode)
    ok("kubectl can reach the cluster")


def cluster_reachable(args: argparse.Namespace) -> bool:
    if args.dry_run:
        return True
    result = subprocess.run(kubectl_base(args) + ["cluster-info"], capture_output=True, text=True)
    return result.returncode == 0


def kind_clusters(dry_run: bool = False) -> set[str]:
    if dry_run:
        return set()
    out = command_text(["kind", "get", "clusters"])
    if not out:
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


def prepare_local_cluster(args: argparse.Namespace) -> None:
    if args.create_kind and args.start_minikube:
        err("--create-kind and --start-minikube cannot be used together.")
        sys.exit(1)

    if args.install_kind and not args.context and not args.create_kind and not args.start_minikube:
        args.create_kind = True

    if (
        not args.context
        and not args.create_kind
        and not args.start_minikube
        and current_context(args) == "docker-desktop"
        and not args.use_docker_desktop
    ):
        warn("docker-desktop Kubernetes has a separate containerd image store; using kind for reliable local image loading.")
        args.create_kind = True

    if not args.context and not args.create_kind and not args.start_minikube and not cluster_reachable(args):
        warn("No reachable Kubernetes context; creating a local kind cluster.")
        args.create_kind = True

    if args.create_kind:
        ensure_kind(args)
        cluster_name = args.kind_cluster or "dramaip"
        clusters = kind_clusters(args.dry_run)
        if cluster_name in clusters:
            ok(f"kind cluster already exists: {cluster_name}")
            if not args.no_dev_persistence:
                warn("Existing kind clusters keep their original mounts; recreate it if .data does not appear on the host.")
        else:
            info(f"Creating kind cluster: {cluster_name}")
            if args.no_dev_persistence:
                run(["kind", "create", "cluster", "--name", cluster_name], dry_run=args.dry_run)
            else:
                config_path = write_kind_config(args, cluster_name)
                run(["kind", "create", "cluster", "--name", cluster_name, "--config", str(config_path)], dry_run=args.dry_run)
            ok(f"kind cluster ready: {cluster_name}")
        if not args.context:
            args.context = f"kind-{cluster_name}"
        return

    if args.start_minikube:
        ensure_minikube(args)
        info("Starting minikube")
        run(["minikube", "start"], dry_run=args.dry_run)
        ok("minikube ready")
        if not args.context:
            args.context = "minikube"


def service_image_repo(args: argparse.Namespace, key: str, default_repo: str) -> str:
    if key == "webBff":
        return args.image_repo
    return f"{args.image_prefix}-{default_repo.removeprefix('dramaip-')}"


def service_images(args: argparse.Namespace) -> list[tuple[str, str, str, str]]:
    return [
        (key, service_image_repo(args, key, default_repo), f"{service_image_repo(args, key, default_repo)}:{args.image_tag}", target)
        for key, default_repo, target in SERVICE_IMAGES
    ]


def split_image_ref(image: str) -> tuple[str, str]:
    name_part = image.rsplit("/", 1)[-1]
    if ":" not in name_part:
        return image, "latest"
    repository, tag = image.rsplit(":", 1)
    return repository, tag


def docker_image_exists(image: str, dry_run: bool = False) -> bool:
    if dry_run:
        return True
    result = subprocess.run(["docker", "image", "inspect", image], capture_output=True, text=True)
    return result.returncode == 0


def kind_node_name(cluster_name: str) -> str:
    """Default kind control-plane node name for a cluster."""
    return f"{cluster_name}-control-plane"


def kind_load_docker_image(image: str, cluster_name: str, dry_run: bool = False) -> None:
    """Load a Docker image into a kind cluster, with a fallback for missing blobs.

    `kind load docker-image` imports with `--all-platforms`. When the local
    image is a multi-arch manifest list (typical for registry-pulled images
    such as kong:3.9-ubuntu) and Docker only holds the native-platform blobs,
    containerd reports `content digest ... not found` for the other platforms
    and the load fails. The fallback streams `docker save` into
    `ctr images import --digests` on the node, which imports only the platform
    that is actually present.
    """
    cmd = ["kind", "load", "docker-image", image]
    if cluster_name:
        cmd.extend(["--name", cluster_name])
    if dry_run:
        print(_c("90", f"$ {' '.join(cmd)}"))
        return

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        out = (result.stdout or result.stderr).strip()
        if out:
            print(out)
        return

    combined = (result.stderr + result.stdout).lower()
    if "content digest" not in combined or "not found" not in combined:
        err(f"Command failed with exit code {result.returncode}: {' '.join(cmd)}")
        details = (result.stderr or result.stdout).strip()
        if details:
            sys.stderr.write(details + "\n")
        sys.exit(result.returncode)

    warn(
        f"kind load hit a missing multi-arch content blob for {image}; "
        "falling back to single-platform ctr import on the node."
    )
    save_proc = subprocess.Popen(["docker", "save", image], stdout=subprocess.PIPE)
    try:
        import_result = subprocess.run(
            [
                "docker", "exec", "--privileged", "-i", kind_node_name(cluster_name),
                "ctr", "--namespace=k8s.io", "images", "import",
                "--digests", "--snapshotter=overlayfs", "-",
            ],
            stdin=save_proc.stdout,
        )
    finally:
        if save_proc.stdout:
            save_proc.stdout.close()
    save_rc = save_proc.wait()
    if import_result.returncode != 0:
        err(f"Fallback ctr import failed with exit code {import_result.returncode}.")
        sys.exit(import_result.returncode)
    if save_rc != 0:
        err(f"docker save failed with exit code {save_rc} during fallback load.")
        sys.exit(save_rc)


def build_image(args: argparse.Namespace) -> None:
    if args.no_build:
        warn("Skipping docker build.")
        return
    build_cache_bust = str(int(time.time())) if not args.dry_run else "dry-run"
    for _key, _repo, image, target in service_images(args):
        info(f"Building service image: {image}")
        run(
            [
                "docker",
                "build",
                "-f",
                str(SERVICES_DIR / "Dockerfile.service"),
                "--build-arg",
                f"TARGET={target}",
                "--build-arg",
                "OUTPUT=dramaip-service",
                "--build-arg",
                f"BUILD_CACHE_BUST={build_cache_bust}",
                "-t",
                image,
                ".",
            ],
            cwd=SERVICES_DIR,
            dry_run=args.dry_run,
        )
    ok("service images built")


def load_image(args: argparse.Namespace) -> None:
    mode = args.load_image
    context = current_context(args)
    if mode == "auto":
        if context.startswith("kind-"):
            mode = "kind"
        elif context == "minikube" or context.startswith("minikube"):
            mode = "minikube"
        else:
            warn(f"Skipping image load for context '{context or 'unknown'}'.")
            return

    if mode == "never":
        warn("Skipping image load.")
        return

    if mode == "kind":
        if not shutil.which("kind"):
            warn("kind is not installed; cannot load image into kind.")
            return
        cluster_name = args.kind_cluster
        if not cluster_name and context.startswith("kind-"):
            cluster_name = context.removeprefix("kind-")
        for _key, _repo, image, _target in service_images(args):
            info(f"Loading image into kind: {image}")
            kind_load_docker_image(image, cluster_name, dry_run=args.dry_run)
        ok("images loaded into kind")
        return

    if mode == "minikube":
        if not shutil.which("minikube"):
            warn("minikube is not installed; cannot load image into minikube.")
            return
        for _key, _repo, image, _target in service_images(args):
            info(f"Loading image into minikube: {image}")
            run(["minikube", "image", "load", image], dry_run=args.dry_run)
        ok("images loaded into minikube")
        return

    err(f"Unsupported --load-image mode: {mode}")
    sys.exit(1)


def load_optional_runtime_image(args: argparse.Namespace, image: str, label: str) -> None:
    mode = local_cluster_mode(args)
    if mode not in {"kind", "minikube"}:
        return
    if not docker_image_exists(image, args.dry_run):
        warn(f"{label} image is not present locally: {image}; Helm will try to pull it.")
        return

    if mode == "kind":
        cluster_name = args.kind_cluster
        context = current_context(args)
        if not cluster_name and context.startswith("kind-"):
            cluster_name = context.removeprefix("kind-")
        info(f"Loading {label} image into kind: {image}")
        kind_load_docker_image(image, cluster_name, dry_run=args.dry_run)
        return

    if mode == "minikube":
        info(f"Loading {label} image into minikube: {image}")
        run(["minikube", "image", "load", image], dry_run=args.dry_run)


def ensure_namespace(args: argparse.Namespace, namespace: str) -> None:
    run(kubectl_base(args) + ["create", "namespace", namespace, "--dry-run=client", "-o", "yaml"], dry_run=args.dry_run)
    if args.dry_run:
        print(_c("90", f"$ kubectl apply -f -  # namespace {namespace}"))
        return

    create = subprocess.run(
        kubectl_base(args) + ["create", "namespace", namespace, "--dry-run=client", "-o", "yaml"],
        capture_output=True,
        text=True,
        check=True,
    )
    apply = subprocess.run(
        kubectl_base(args) + ["apply", "-f", "-"],
        input=create.stdout,
        text=True,
    )
    if apply.returncode != 0:
        err(f"Failed to ensure namespace: {namespace}")
        sys.exit(apply.returncode)
    ok(f"namespace ready: {namespace}")


def helm_repo_has(repo_name: str, repo_url: str) -> bool:
    out = command_text(["helm", "repo", "list"])
    if not out:
        return False
    return repo_name in out and repo_url in out


def helm_release_deployed(args: argparse.Namespace, release: str, namespace: str) -> bool:
    if args.dry_run:
        return False
    result = subprocess.run(
        helm_base(args) + ["status", release, "--namespace", namespace],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and "STATUS: deployed" in result.stdout


def run_with_retries(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    dry_run: bool = False,
    attempts: int = 1,
    delay_s: float = 3.0,
) -> None:
    if dry_run or attempts <= 1:
        run(cmd, cwd=cwd, dry_run=dry_run)
        return

    printable = " ".join(cmd)
    for attempt in range(1, attempts + 1):
        try:
            subprocess.run(cmd, cwd=str(cwd or SCRIPT_DIR), check=True)
            return
        except FileNotFoundError:
            err(f"Command not found: {cmd[0]}")
            sys.exit(1)
        except subprocess.CalledProcessError as exc:
            if attempt >= attempts:
                err(f"Command failed with exit code {exc.returncode}: {printable}")
                sys.exit(exc.returncode)
            warn(f"Command failed with exit code {exc.returncode}; retrying {attempt}/{attempts}: {printable}")
            time.sleep(delay_s)


def install_kong(args: argparse.Namespace) -> None:
    if args.skip_kong:
        warn("Skipping Kong Ingress Controller install.")
        return

    load_optional_runtime_image(args, args.kong_gateway_image, "Kong Gateway")
    load_optional_runtime_image(args, args.kong_controller_image, "Kong Ingress Controller")
    ensure_namespace(args, args.kong_namespace)

    if not args.force_kong_upgrade and helm_release_deployed(args, args.kong_release, args.kong_namespace):
        ok(f"Kong Ingress Controller release already deployed: {args.kong_release}")
        return

    if not helm_repo_has(args.kong_repo_name, args.kong_repo_url):
        info(f"Adding Helm repo: {args.kong_repo_name} {args.kong_repo_url}")
        run_with_retries(
            helm_base(args) + ["repo", "add", args.kong_repo_name, args.kong_repo_url],
            dry_run=args.dry_run,
            attempts=args.helm_retries,
        )
    else:
        ok(f"Helm repo already present: {args.kong_repo_name}")

    info(f"Updating Helm repo: {args.kong_repo_name}")
    run_with_retries(
        helm_base(args) + ["repo", "update", args.kong_repo_name],
        dry_run=args.dry_run,
        attempts=args.helm_retries,
    )

    cmd = helm_base(args) + [
        "upgrade",
        "--install",
        args.kong_release,
        args.kong_chart,
        "--namespace",
        args.kong_namespace,
        "--create-namespace",
        "--wait",
        "--timeout",
        args.timeout,
    ]

    service_type = args.kong_service_type
    if service_type == "auto":
        service_type = "ClusterIP" if is_local_dev_cluster(args) else "LoadBalancer"
    cmd.extend(["--set", f"gateway.proxy.type={service_type}"])
    cmd.extend(["--set", f"gateway.service.type={service_type}"])
    gateway_repo, gateway_tag = split_image_ref(args.kong_gateway_image)
    controller_repo, controller_tag = split_image_ref(args.kong_controller_image)
    cmd.extend(["--set", f"gateway.image.repository={gateway_repo}"])
    cmd.extend(["--set", f"gateway.image.tag={gateway_tag}"])
    cmd.extend(["--set", "gateway.image.pullPolicy=IfNotPresent"])
    cmd.extend(["--set", f"controller.ingressController.image.repository={controller_repo}"])
    cmd.extend(["--set", f"controller.ingressController.image.tag={controller_tag}"])
    cmd.extend(["--set", "controller.image.pullPolicy=IfNotPresent"])

    for value in args.kong_set:
        cmd.extend(["--set", value])

    info(f"Installing or upgrading Kong Ingress Controller (proxy service: {service_type})")
    run_with_retries(cmd, dry_run=args.dry_run, attempts=args.helm_retries)
    ok("Kong Ingress Controller ready")


def helm_set_args(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        out.extend(["--set", value])
    return out


def effective_image_pull_policy(args: argparse.Namespace) -> str:
    if args.image_pull_policy != "auto":
        return args.image_pull_policy
    if is_local_dev_cluster(args):
        return "Never"
    return "IfNotPresent"


def install_platform(args: argparse.Namespace) -> None:
    ensure_namespace(args, args.namespace)

    local_mode = is_local_dev_cluster(args)
    migration_enabled = (not args.skip_migrations) and (args.use_migration_job or not local_mode)
    dev_infra_enabled = local_mode and not args.skip_dev_infra

    values_file = Path(args.values_file).resolve() if args.values_file else DEV_VALUES
    image_pull_policy = effective_image_pull_policy(args)
    rollout_token = str(int(time.time()))
    cmd = helm_base(args) + [
        "upgrade",
        "--install",
        args.release,
        str(CHART_DIR),
        "--namespace",
        args.namespace,
        "--create-namespace",
        "-f",
        str(values_file),
        "--wait",
        "--timeout",
        args.timeout,
        "--set",
        f"image.repository={args.image_repo}",
        "--set",
        f"image.tag={args.image_tag}",
        "--set",
        f"image.pullPolicy={image_pull_policy}",
        "--set-string",
        f"rolloutToken={rollout_token}",
        "--set",
        f"ingress.enabled={str(not args.no_ingress).lower()}",
        "--set",
        f"ingress.className={args.ingress_class}",
        "--set",
        f"ingress.hosts[0].host={args.host}",
        "--set",
        f"migrations.enabled={str(migration_enabled).lower()}",
        "--set",
        f"devInfra.enabled={str(dev_infra_enabled).lower()}",
    ]

    for key, repo, _image, _target in service_images(args):
        cmd.extend(["--set", f"images.{key}.repository={repo}"])
        cmd.extend(["--set", f"images.{key}.tag={args.image_tag}"])
    cmd.extend(["--set", f"config.downstream.authGrpcEndpoint={args.release}-auth:9101"])
    cmd.extend(["--set", f"config.downstream.userGrpcEndpoint={args.release}-user:9102"])
    cmd.extend(["--set", f"config.downstream.billingGrpcEndpoint={args.release}-billing:9103"])
    cmd.extend(["--set", f"config.downstream.quotaGrpcEndpoint={args.release}-quota:9104"])
    cmd.extend(["--set", f"config.downstream.aiGatewayGrpcEndpoint={args.release}-ai-gateway:9105"])

    if local_mode and not args.use_migration_job:
        cmd.extend(["--set", "config.autoMigrate=true"])

    if dev_infra_enabled and not args.no_dev_persistence:
        data_dir = ensure_k8s_data_dirs(args)
        cmd.extend(["--set", "devInfra.persistence.enabled=true"])
        cmd.extend(["--set-string", f"devInfra.persistence.hostPathBase={data_dir}"])
    elif dev_infra_enabled:
        cmd.extend(["--set", "devInfra.persistence.enabled=false"])

    optional_sets = {
        "config.postgres.host": args.postgres_host,
        "config.postgres.port": args.postgres_port,
        "config.postgres.database": args.postgres_database,
        "config.postgres.sslmode": args.postgres_sslmode,
        "config.redis.addr": args.redis_addr,
        "config.rabbitmq.managementUrl": args.rabbitmq_management_url,
        "config.otel.endpoint": args.otel_endpoint,
        "secret.existingSecret": args.existing_secret,
    }
    for key, value in optional_sets.items():
        if value:
            cmd.extend(["--set", f"{key}={value}"])

    if args.no_kong_plugins:
        cmd.extend(["--set", "kong.plugins.enabled=false"])
    if args.cors_origin:
        cmd.extend(["--set", f"kong.plugins.cors.origins[0]={args.cors_origin}"])
    if args.rate_limit_minute:
        cmd.extend(["--set", f"kong.plugins.rateLimiting.minute={args.rate_limit_minute}"])

    cmd.extend(helm_set_args(args.set))

    info("Installing or upgrading dramaip-platform")
    run(cmd, dry_run=args.dry_run)
    ok("dramaip-platform Helm release applied")


def wait_for_bff(args: argparse.Namespace) -> None:
    if args.dry_run or args.no_wait:
        return
    for component in ("auth", "user", "billing", "quota", "ai-gateway", "web-bff", "billing-job", "quota-job"):
        info(f"Waiting for {component} rollout")
        run(
            kubectl_base(args)
            + [
                "rollout",
                "status",
                "deployment",
                "-n",
                args.namespace,
                "-l",
                f"app.kubernetes.io/instance={args.release},app.kubernetes.io/component={component}",
                "--timeout",
                args.timeout,
            ],
        )
    ok("platform service rollouts complete")


def kong_port_forward_cmd(args: argparse.Namespace) -> list[str]:
    service_name = f"{args.kong_release}-gateway-proxy"
    return (
        kubectl_base(args)
        + [
            "-n",
            args.kong_namespace,
            "port-forward",
            f"service/{service_name}",
            f"{args.api_port}:80",
        ]
    )


def web_command(args: argparse.Namespace, pnpm: list[str]) -> list[str]:
    return pnpm + ["--filter", "@dramaip/web", "exec", "next", "dev", "-p", str(args.web_port)]


def effective_api_base_url(args: argparse.Namespace) -> str:
    if args.api_base_url:
        return args.api_base_url
    if not args.no_port_forward and not args.skip_kong:
        return f"http://localhost:{args.api_port}"
    return f"http://{args.host}"


def start_dev_runtime(args: argparse.Namespace, pnpm: list[str]) -> int:
    port_forward_enabled = not args.no_port_forward and not args.skip_kong
    if not port_forward_enabled and args.no_web:
        return 0

    api_base_url = effective_api_base_url(args)
    urls: list[tuple[str, str]] = []

    if args.dry_run:
        if port_forward_enabled:
            print(_c("90", f"$ {' '.join(kong_port_forward_cmd(args))}"))
            urls.append(("Services", api_base_url))
        if not args.no_web:
            print(
                _c(
                    "90",
                    f"$ NEXT_PUBLIC_API_BASE_URL={api_base_url} {' '.join(web_command(args, pnpm))}",
                )
            )
            urls.append(("Web", f"http://localhost:{args.web_port}"))
        print()
        for label, url in urls:
            print(f"{label}: {url}")
        return 0

    processes: list[tuple[str, subprocess.Popen]] = []
    env = os.environ.copy()
    kill_ports = not args.no_kill_ports

    try:
        if port_forward_enabled:
            release_port(args.api_port, "Kong port-forward", kill_ports)
            port_forward = start_process("k8s:kong-port-forward", kong_port_forward_cmd(args), SCRIPT_DIR, env)
            processes.append(("k8s:kong-port-forward", port_forward))
            ensure_process_started(port_forward, "k8s:kong-port-forward")
            wait_for_tcp(args.api_port, "Kong port-forward")
            urls.append(("Services", api_base_url))
        elif not args.no_web and not args.api_base_url:
            warn(f"Kong port-forward is disabled; web will use {api_base_url}.")

        if not args.no_web:
            release_port(args.web_port, "Web", kill_ports)
            web_env = env.copy()
            web_env["NEXT_PUBLIC_API_BASE_URL"] = api_base_url
            web_process = start_process("clients:web", web_command(args, pnpm), CLIENTS_DIR, web_env)
            processes.append(("clients:web", web_process))
            ensure_process_started(web_process, "clients:web", delay=1.5)
            urls.append(("Web", f"http://localhost:{args.web_port}"))
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

    if not processes:
        return 0
    return watch(processes, urls)


def print_summary(args: argparse.Namespace) -> None:
    print()
    ok("Kubernetes launch flow complete")
    print(f"Namespace: {args.namespace}")
    print(f"Release:   {args.release}")
    print(f"Images:    {args.image_prefix}-*: {args.image_tag}")
    if not args.no_ingress:
        print(f"Ingress:   {args.host} via class {args.ingress_class}")
    print()
    print("Useful checks:")
    print(f"  kubectl get pods -n {args.namespace}")
    print(f"  kubectl get ingress -n {args.namespace}")
    if not args.skip_kong:
        print(f"  kubectl get pods -n {args.kong_namespace}")
        print(f"  kubectl get svc -n {args.kong_namespace} {args.kong_release}-gateway-proxy")
    if not args.no_port_forward and not args.skip_kong:
        print(f"  kubectl -n {args.kong_namespace} port-forward service/{args.kong_release}-gateway-proxy {args.api_port}:80")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy DramaIP platform BFF to Kubernetes.")
    parser.add_argument("--context", help="Kubernetes context to use.")
    parser.add_argument("--namespace", default=DEFAULT_NAMESPACE)
    parser.add_argument("--release", default=DEFAULT_RELEASE)
    parser.add_argument("--timeout", default=DEFAULT_TIMEOUT)
    parser.add_argument("--dry-run", action="store_true", help="Print commands without running them.")
    parser.add_argument("--no-wait", action="store_true", help="Do not wait for rollout status.")
    parser.add_argument("--install-helm", action="store_true", help="Install Helm with Homebrew if helm is missing.")
    parser.add_argument("--create-kind", action="store_true", help="Create or reuse a local kind cluster before deploying.")
    parser.add_argument("--install-kind", action="store_true", help="Install kind with Homebrew when --create-kind is used.")
    parser.add_argument(
        "--use-docker-desktop",
        action="store_true",
        help="Use the docker-desktop Kubernetes context instead of preferring kind for local image loading.",
    )
    parser.add_argument("--start-minikube", action="store_true", help="Start minikube before deploying.")
    parser.add_argument(
        "--install-minikube",
        action="store_true",
        help="Install minikube with Homebrew when --start-minikube is used.",
    )

    parser.add_argument("--image-repo", default="dramaip-web-bff")
    parser.add_argument("--image-prefix", default="dramaip", help="Prefix for non-BFF service images, default: dramaip.")
    parser.add_argument("--image-tag", default="dev")
    parser.add_argument(
        "--image-pull-policy",
        choices=["auto", "Always", "IfNotPresent", "Never"],
        default="auto",
        help="Image pull policy. auto uses Never for local dev clusters and IfNotPresent otherwise.",
    )
    parser.add_argument("--no-build", action="store_true", help="Skip docker build.")
    parser.add_argument(
        "--load-image",
        choices=["auto", "kind", "minikube", "never"],
        default="auto",
        help="Load local image into the cluster runtime.",
    )
    parser.add_argument("--kind-cluster", help="kind cluster name; inferred from kind-* context when omitted.")

    parser.add_argument("--skip-kong", action="store_true", help="Do not install Kong Ingress Controller.")
    parser.add_argument("--kong-namespace", default=DEFAULT_KONG_NAMESPACE)
    parser.add_argument("--kong-release", default=DEFAULT_KONG_RELEASE)
    parser.add_argument("--kong-repo-name", default=DEFAULT_KONG_REPO_NAME)
    parser.add_argument("--kong-repo-url", default=DEFAULT_KONG_REPO_URL)
    parser.add_argument("--kong-chart", default=DEFAULT_KONG_CHART)
    parser.add_argument(
        "--kong-gateway-image",
        default=DEFAULT_KONG_GATEWAY_IMAGE,
        help=f"Kong Gateway image for local loading and Helm values, default: {DEFAULT_KONG_GATEWAY_IMAGE}.",
    )
    parser.add_argument(
        "--kong-controller-image",
        default=DEFAULT_KONG_CONTROLLER_IMAGE,
        help=f"Kong Ingress Controller image for local loading and Helm values, default: {DEFAULT_KONG_CONTROLLER_IMAGE}.",
    )
    parser.add_argument(
        "--force-kong-upgrade",
        action="store_true",
        help="Upgrade/reinstall Kong even when the Helm release is already deployed.",
    )
    parser.add_argument(
        "--helm-retries",
        type=int,
        default=3,
        help="Retry Helm network operations this many times, default: 3.",
    )
    parser.add_argument(
        "--kong-service-type",
        choices=["auto", "LoadBalancer", "NodePort", "ClusterIP"],
        default="auto",
        help="Kong proxy Service type. auto uses ClusterIP for local dev clusters and LoadBalancer otherwise.",
    )
    parser.add_argument(
        "--kong-set",
        action="append",
        default=[],
        help="Extra --set key=value passed to the Kong Helm release. Repeatable.",
    )

    parser.add_argument("--no-ingress", action="store_true", help="Disable app Ingress rendering.")
    parser.add_argument("--ingress-class", default="kong")
    parser.add_argument("--host", default="api.localtest.me")
    parser.add_argument("--no-kong-plugins", action="store_true", help="Disable chart-owned KongPlugin resources.")
    parser.add_argument("--cors-origin", help="Override the first CORS origin.")
    parser.add_argument("--rate-limit-minute", help="Override Kong rate-limiting minute value.")

    parser.add_argument("--values-file", help="Helm values file for the app chart.")
    parser.add_argument("--existing-secret", help="Use an existing Kubernetes Secret for app credentials.")
    parser.add_argument("--skip-migrations", action="store_true", help="Disable the migration Job.")
    parser.add_argument(
        "--use-migration-job",
        action="store_true",
        help="Use the migration Job even for local kind/minikube clusters.",
    )
    parser.add_argument("--skip-dev-infra", action="store_true", help="Do not deploy local dev Postgres/Redis/RabbitMQ/OTel.")
    parser.add_argument(
        "--k8s-data-dir",
        default=str(K8S_DATA_DIR),
        help="Local hostPath base directory for dev K8s data, default: dramaip-platform/deploy/k8s/.data.",
    )
    parser.add_argument(
        "--no-dev-persistence",
        action="store_true",
        help="Use temporary emptyDir volumes for local dev infra instead of hostPath data directories.",
    )
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        help="Extra --set key=value passed to the app Helm release. Repeatable.",
    )

    parser.add_argument("--postgres-host")
    parser.add_argument("--postgres-port")
    parser.add_argument("--postgres-database")
    parser.add_argument("--postgres-sslmode")
    parser.add_argument("--redis-addr")
    parser.add_argument("--rabbitmq-management-url")
    parser.add_argument("--otel-endpoint")

    parser.add_argument("--install", action="store_true", help="Force pnpm install before starting web.")
    parser.add_argument("--no-install", action="store_true", help="Skip pnpm install even if node_modules is missing.")
    parser.add_argument("--no-web", action="store_true", help="Deploy K8s resources but do not start the local web dev server.")
    parser.add_argument("--services-only", action="store_true", help="Alias for --no-web.")
    parser.add_argument("--api-port", type=int, default=8000, help="Local Kong port-forward port, default: 8000.")
    parser.add_argument("--web-port", type=int, default=3000, help="Local web dev port, default: 3000.")
    parser.add_argument("--api-base-url", help="NEXT_PUBLIC_API_BASE_URL for the web app.")
    parser.add_argument("--no-port-forward", action="store_true", help="Do not port-forward Kong locally.")
    parser.add_argument("--no-kill-ports", action="store_true", help="Do not stop processes occupying API/web ports.")

    args = parser.parse_args()
    if args.install and args.no_install:
        parser.error("--install and --no-install cannot be used together")
    if args.services_only:
        args.no_web = True
    if args.skip_kong and args.no_ingress and not args.no_web and not args.api_base_url:
        parser.error("--skip-kong --no-ingress needs --api-base-url when starting web")
    return args


def main() -> int:
    args = parse_args()
    install_shutdown_handlers()
    check_layout()
    for tool in ("docker", "kubectl"):
        require_tool(tool, args.dry_run)
    ensure_helm(args)
    check_node(args)
    pnpm = resolve_pnpm(args)
    ensure_client_deps(args, pnpm)

    prepare_local_cluster(args)
    check_cluster(args)
    build_image(args)
    load_image(args)
    install_kong(args)
    install_platform(args)
    wait_for_bff(args)
    print_summary(args)
    return start_dev_runtime(args, pnpm)


if __name__ == "__main__":
    raise SystemExit(main())
