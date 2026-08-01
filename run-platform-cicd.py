#!/usr/bin/env python3
"""Safe local release entry point for DramaIP Staging GitOps delivery.

This program deliberately does not create infrastructure, store credentials,
or call ``kubectl apply``/``helm upgrade``.  GitLab validates source changes;
an operator on a clean ``main`` explicitly runs ``release`` to create one
immutable Harbor bundle and update the GitOps ``staging`` branch.  Argo CD is
the only component that reconciles Kubernetes.

Examples:
  python3 run-platform-cicd.py check --gitops-dir ../dramaip-gitops
  python3 run-platform-cicd.py verify --gitops-dir ../dramaip-gitops
  python3 run-platform-cicd.py update-trivy-db
  python3 run-platform-cicd.py bootstrap --gitops-dir ../dramaip-gitops --apply ...
  python3 run-platform-cicd.py release --gitops-dir ../dramaip-gitops
  python3 run-platform-cicd.py rollback --gitops-dir ../dramaip-gitops --commit <gitops-commit>
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR / "dramaip-platform"
RELEASE_DIR = PLATFORM_DIR / "deploy" / "release"
MANIFEST_PATH = RELEASE_DIR / "images.tsv"
SOURCE_CHART_DIR = PLATFORM_DIR / "deploy" / "helm" / "dramaip-platform"
DEFAULT_REGISTRY = os.environ.get("DRAMAIP_IMAGE_REGISTRY", "harbor.home.arpa/dramaip")
DEFAULT_GITOPS_SSH_URL = os.environ.get(
    "DRAMAIP_GITOPS_SSH_URL", "git@gitlab.home.arpa:platform/dramaip-gitops.git"
)
DEFAULT_GITOPS_REPO_URL = os.environ.get(
    "DRAMAIP_GITOPS_REPO_URL", "https://gitlab.home.arpa/platform/dramaip-gitops.git"
)
DEFAULT_TRIVY_IMAGE = os.environ.get("TRIVY_IMAGE", "harbor.home.arpa/ci-tools/trivy:0.72.0")
DEFAULT_GITOPS_DIR = os.environ.get("DRAMAIP_GITOPS_DIR", "")
DEFAULT_NAMESPACE = "dramaip-staging"
DEFAULT_APP = "dramaip-staging"
DEFAULT_ROOT_APP = "platform-bootstrap"
MAX_TRIVY_DB_AGE_SECONDS = 48 * 60 * 60
TAG_RE = re.compile(r"^sha-[0-9a-f]{40}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")
GITOPS_SEED_EXCLUDED_FILES = ("values-dev.yaml", "values-staging.yaml", "values-staging-temporary.yaml")
GITOPS_SEED_EXCLUDED_TEMPLATES = ("secret.yaml", "dev-infra.yaml")
SECRET_VALUE_KEYS = (
    "postgresPassword",
    "postgresAuthPassword",
    "postgresUserProfilePassword",
    "postgresBillingPassword",
    "postgresQuotaPassword",
    "postgresAIGatewayPassword",
    "postgresNotificationPassword",
    "postgresInspirationPassword",
    "postgresAdminPassword",
    "postgresReportingPassword",
    "postgresSnapshotPassword",
    "redisPassword",
    "rabbitmqPassword",
    "aiProviderApiKey",
    "authEmailDeliveryToken",
)


class CICDError(RuntimeError):
    """Expected operator-facing failure."""


@dataclass(frozen=True)
class ImageSpec:
    chart_key: str
    image_name: str
    kind: str
    build_target: str


def info(message: str) -> None:
    print(f"* {message}")


def ok(message: str) -> None:
    print(f"OK {message}")


def warn(message: str) -> None:
    print(f"! {message}", file=sys.stderr)


def fail(message: str) -> None:
    raise CICDError(message)


def run(
    command: Sequence[str],
    *,
    cwd: Path = SCRIPT_DIR,
    env: dict[str, str] | None = None,
    capture: bool = False,
    dry_run: bool = False,
) -> subprocess.CompletedProcess[str]:
    printable = " ".join(command)
    if dry_run:
        print(f"DRY-RUN $ {printable}")
        return subprocess.CompletedProcess(command, 0, "", "")
    try:
        return subprocess.run(
            list(command),
            cwd=str(cwd),
            env=env,
            check=True,
            capture_output=capture,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        fail(f"required command was not found: {command[0]}")
    except subprocess.CalledProcessError as exc:
        detail = ""
        if capture:
            detail = (exc.stderr or exc.stdout or "").strip()
        fail(f"command failed ({exc.returncode}): {printable}{': ' + detail if detail else ''}")
    raise AssertionError("unreachable")


def command_output(command: Sequence[str], *, cwd: Path = SCRIPT_DIR) -> str:
    return run(command, cwd=cwd, capture=True).stdout.strip()


def require_tools(names: Iterable[str]) -> None:
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        fail("missing required command(s): " + ", ".join(missing))
    for name in names:
        ok(f"{name} found")


def git_output(directory: Path, *args: str) -> str:
    return command_output(["git", "-C", str(directory), *args])


def git_clean(directory: Path, label: str) -> None:
    status = git_output(directory, "status", "--porcelain")
    if status:
        fail(f"{label} worktree must be clean before a release")
    ok(f"{label} worktree is clean")


def require_branch(directory: Path, branch: str, label: str) -> None:
    current = git_output(directory, "branch", "--show-current")
    if current != branch:
        fail(f"{label} must be on {branch}; current branch is {current or 'detached HEAD'}")
    ok(f"{label} branch is {branch}")


def source_revision() -> str:
    revision = git_output(SCRIPT_DIR, "rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        fail(f"cannot use non-SHA source revision: {revision}")
    return revision


def immutable_tag(revision: str) -> str:
    return f"sha-{revision}"


def parse_manifest(path: Path = MANIFEST_PATH) -> list[ImageSpec]:
    if not path.is_file():
        fail(f"image manifest is missing: {path}")
    specs: list[ImageSpec] = []
    seen_keys: set[str] = set()
    seen_names: set[str] = set()
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields = raw.split("|")
        if len(fields) != 4:
            fail(f"invalid manifest row {line_number}: expected four pipe-delimited fields")
        spec = ImageSpec(*(field.strip() for field in fields))
        if not spec.chart_key or not spec.image_name or spec.kind not in {"java", "web"}:
            fail(f"invalid manifest row {line_number}")
        if spec.chart_key in seen_keys or spec.image_name in seen_names:
            fail(f"duplicate manifest value on row {line_number}")
        if spec.kind == "java" and spec.build_target not in {
            "migration", "gateway", "services/identity", "services/support",
            "services/creation", "services/quota", "services/ai", "services/billing",
        }:
            fail(f"Java image {spec.image_name} has an invalid Maven module")
        if spec.kind == "web" and spec.build_target:
            fail("web image must not declare a build target")
        seen_keys.add(spec.chart_key)
        seen_names.add(spec.image_name)
        specs.append(spec)
    java_count = sum(spec.kind == "java" for spec in specs)
    web_count = sum(spec.kind == "web" for spec in specs)
    expected_java = {"migration", "gateway", "identity", "support", "creation", "quota", "ai", "billing"}
    if java_count != 8 or web_count != 1 or len(specs) != 9 or not expected_java.issubset(seen_keys) or "web" not in seen_keys:
        fail(f"manifest must contain the eight Java runtime images and one web image; found {java_count} Java and {web_count} web")
    return specs


def trivy_cache_dir() -> Path:
    cache_root = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    return cache_root / "dramaip" / "trivy"


def trivy_timestamp(cache_dir: Path) -> int:
    timestamp_file = cache_dir / "last-successful-update"
    try:
        value = timestamp_file.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        fail("Trivy DB timestamp is missing; run update-trivy-db")
    if not value.isdigit():
        fail("Trivy DB timestamp is invalid")
    return int(value)


def check_trivy_db(cache_dir: Path, max_age: int = MAX_TRIVY_DB_AGE_SECONDS) -> None:
    required = (cache_dir / "db" / "trivy.db", cache_dir / "db" / "metadata.json")
    if any(not path.is_file() or path.stat().st_size == 0 for path in required):
        fail("Trivy DB is missing; run update-trivy-db")
    age = int(time.time()) - trivy_timestamp(cache_dir)
    if age < 0 or age > max_age:
        fail(f"Trivy DB is {age}s old; maximum age is {max_age}s")
    ok(f"Trivy DB age is {age}s")


def resolve_gitops_dir(raw: str) -> Path:
    candidate = raw or DEFAULT_GITOPS_DIR
    if not candidate:
        fail("--gitops-dir or DRAMAIP_GITOPS_DIR is required")
    directory = Path(candidate).expanduser().resolve()
    if not (directory / ".git").exists():
        fail(f"GitOps directory is not a Git repository: {directory}")
    return directory


def gitops_chart(directory: Path) -> Path:
    chart = directory / "helm" / "dramaip-platform"
    if not (chart / "Chart.yaml").is_file():
        fail(f"GitOps chart is missing: {chart}")
    return chart


def staging_values(directory: Path) -> Path:
    values = gitops_chart(directory) / "values-staging.yaml"
    if not values.is_file():
        fail(f"GitOps staging Values are missing: {values}")
    return values


def assert_ssh_agent() -> None:
    run(["ssh-add", "-l"], capture=True)
    ok("SSH Agent has at least one identity")


def assert_gitops_remote(directory: Path, expected_url: str) -> None:
    actual = git_output(directory, "remote", "get-url", "origin")
    if actual != expected_url:
        fail(f"GitOps origin must be {expected_url}; found {actual}")
    ok("GitOps origin matches configured SSH URL")


def assert_gitops_branch_ready(directory: Path, branch: str, main_branch: str) -> None:
    git_clean(directory, "GitOps")
    run(["git", "-C", str(directory), "fetch", "origin", main_branch, branch])
    require_branch(directory, branch, "GitOps")
    upstream = git_output(directory, "rev-parse", "--abbrev-ref", "@{upstream}")
    if upstream != f"origin/{branch}":
        fail(f"GitOps {branch} must track origin/{branch}; found {upstream}")
    if git_output(directory, "rev-parse", "HEAD") != git_output(directory, "rev-parse", f"origin/{branch}"):
        fail(f"GitOps {branch} is not synchronized with origin/{branch}")
    ok(f"GitOps {branch} is synchronized")


def assert_source_ready() -> str:
    git_clean(SCRIPT_DIR, "source")
    require_branch(SCRIPT_DIR, "main", "source")
    revision = source_revision()
    ok(f"source revision is {revision}")
    return revision


def check_external_resources(args: argparse.Namespace) -> None:
    required_secrets = (
        "dramaip-staging-runtime",
        "dramaip-staging-auth-jwt",
        "dramaip-staging-admin-jwt",
        "dramaip-staging-internal-mtls",
        "dramaip-staging-registry",
        "dramaip-staging-ingress-tls",
    )
    for secret in required_secrets:
        run(["kubectl", "-n", args.namespace, "get", "secret", secret], capture=True)
    ok("all required operator-managed Staging Secrets exist")
    for app in (args.root_app, args.argocd_app):
        run(["argocd", "app", "get", app], capture=True)
    ok("Argo CD root and Staging applications are readable")


def check_command(args: argparse.Namespace) -> None:
    specs = parse_manifest()
    gitops_dir = resolve_gitops_dir(args.gitops_dir)
    require_tools(("git", "docker", "helm", "kubectl", "argocd", "ssh-add", "yq"))
    revision = assert_source_ready()
    assert_ssh_agent()
    assert_gitops_remote(gitops_dir, args.gitops_ssh_url)
    assert_gitops_branch_ready(gitops_dir, args.gitops_branch, args.gitops_main_branch)
    gitops_chart(gitops_dir)
    staging_values(gitops_dir)
    check_trivy_db(trivy_cache_dir())
    run(["docker", "info"], capture=True)
    run(["docker", "manifest", "inspect", args.trivy_image], capture=True)
    ok("Docker daemon and internal Trivy image are reachable")
    check_external_resources(args)
    ok(f"release preflight passed for {len(specs)} images and {immutable_tag(revision)}")


def ensure_pnpm(directory: Path, install_deps: bool) -> list[str]:
    pnpm = ["pnpm"] if shutil.which("pnpm") else ["corepack", "pnpm"] if shutil.which("corepack") else []
    if not pnpm:
        fail("pnpm or corepack is required")
    marker = directory / "node_modules" / ".modules.yaml"
    if not marker.exists():
        if not install_deps:
            fail(f"dependencies are missing in {directory}; rerun verify with --install-deps")
        run([*pnpm, "install", "--frozen-lockfile"], cwd=directory)
    return pnpm


def verify_command(args: argparse.Namespace) -> None:
    gitops_dir = resolve_gitops_dir(args.gitops_dir)
    require_tools(("git", "helm", "mvn", "node"))
    run(["mvn", "-B", "-ntp", "verify"], cwd=PLATFORM_DIR / "server")

    clients = PLATFORM_DIR / "clients"
    clients_pnpm = ensure_pnpm(clients, args.install_deps)
    for command in (("lint",), ("typecheck",), ("contracts:check",), ("build:web",), ("build:admin",)):
        run([*clients_pnpm, *command], cwd=clients)
    run(["make", "web-route-smoke"], cwd=PLATFORM_DIR)

    desktop = SCRIPT_DIR / "dramaip-desktop"
    desktop_pnpm = ensure_pnpm(desktop, args.install_deps)
    for command in (("lint",), ("test:unit",), ("test:db",), ("build",)):
        run([*desktop_pnpm, *command], cwd=desktop)

    chart = gitops_chart(gitops_dir)
    values = staging_values(gitops_dir)
    run(["helm", "lint", str(chart), "-f", str(values)])
    run(["helm", "template", "dramaip-staging", str(chart), "-f", str(values)], capture=True)
    ok("source validation and GitOps Helm validation passed")


def update_trivy_db_command(args: argparse.Namespace) -> None:
    require_tools(("docker",))
    cache_dir = trivy_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    run(
        [
            "docker", "run", "--rm", "--volume", f"{cache_dir}:/root/.cache/trivy", args.trivy_image,
            "image", "--cache-dir", "/root/.cache/trivy", "--download-db-only",
        ]
    )
    required = (cache_dir / "db" / "trivy.db", cache_dir / "db" / "metadata.json")
    if any(not path.is_file() or path.stat().st_size == 0 for path in required):
        fail("Trivy reported success but did not create a complete database")
    (cache_dir / "last-successful-update").write_text(f"{int(time.time())}\n", encoding="utf-8")
    ok(f"Trivy DB updated in {cache_dir}")


def require_bootstrap_value(args: argparse.Namespace, name: str) -> str:
    value = getattr(args, name)
    if not value:
        fail(f"bootstrap requires --{name.replace('_', '-')}")
    return value


def initial_staging_values(args: argparse.Namespace, specs: list[ImageSpec], tag: str) -> str:
    postgres_host = require_bootstrap_value(args, "postgres_host")
    redis_addr = require_bootstrap_value(args, "redis_addr")
    rabbitmq_host = require_bootstrap_value(args, "rabbitmq_host")
    otel_endpoint = require_bootstrap_value(args, "otel_endpoint")
    ingress_host = require_bootstrap_value(args, "ingress_host")
    web_origin = require_bootstrap_value(args, "web_origin")
    admin_origin = require_bootstrap_value(args, "admin_origin")
    lines = [
        "# Operator-managed Staging overlay. It contains names and public endpoints only.",
        "replicaCount: 1",
        "imagePullSecrets:",
        "  - name: dramaip-staging-registry",
        "legacy:",
        "  enabled: false",
        "java:",
        "  enabled: true",
        f"  postgresDsn: jdbc:postgresql://{postgres_host}:5432/dramaip?sslmode=require",
        "  images:",
    ]
    for spec in specs:
        if spec.kind == "web":
            continue
        lines.extend((f"    {spec.chart_key}:", f"      repository: {args.registry}/{spec.image_name}", f"      tag: {tag}"))
    lines.extend(
        (
            "web:",
            "  enabled: true",
            "  replicaCount: 1",
            "  image:",
            f"    repository: {args.registry}/web",
            f"    tag: {tag}",
            '  apiBaseURL: ""',
            "  paymentMode: simulated",
            "config:",
            "  env: staging",
            "  logLevel: info",
            "  postgres:",
            f"    host: {postgres_host}",
            "    sslmode: require",
            "  redis:",
            f"    addr: {redis_addr}",
            "  rabbitmq:",
            f"    host: {rabbitmq_host}",
            f'    port: "{args.rabbitmq_port}"',
            "    vhost: /dramaip",
            "  otel:",
            f"    endpoint: {otel_endpoint}",
            "secret:",
            "  existingSecret: dramaip-staging-runtime",
            "authJWT:",
            "  keysetSecret: dramaip-staging-auth-jwt",
            "adminJWT:",
            "  keysetSecret: dramaip-staging-admin-jwt",
            "internalMTLS:",
            "  enabled: true",
            "  existingSecret: dramaip-staging-internal-mtls",
            "ingress:",
            "  enabled: true",
            "  className: kong",
            "  hosts:",
            f"    - host: {ingress_host}",
            "      paths:",
            "        - path: /api/v1",
            "          pathType: Prefix",
            "  tls:",
            "    - secretName: dramaip-staging-ingress-tls",
            "      hosts:",
            f"        - {ingress_host}",
            "kong:",
            "  plugins:",
            "    cors:",
            "      origins:",
            f"        - {web_origin}",
            "adminIngress:",
            "  cors:",
            "    enabled: true",
            "    origins:",
            f"      - {admin_origin}",
            "autoscaling:",
            "  enabled: true",
            "  minReplicas: 1",
            "  maxReplicas: 3",
            "migrations:",
            "  enabled: true",
            "  useHelmHook: true",
            "  bootstrapRuntimeRoles: false",
            "release:",
            f"  sourceRevision: {tag[4:]}",
            f"  imageTag: {tag}",
            "",
        )
    )
    return "\n".join(lines)


def prepare_gitops_chart_seed(source: Path, destination: Path) -> None:
    """Copy a Staging-only Chart that cannot generate or store Secrets."""

    shutil.copytree(source, destination, ignore=shutil.ignore_patterns(*GITOPS_SEED_EXCLUDED_FILES))
    for name in GITOPS_SEED_EXCLUDED_TEMPLATES:
        template = destination / "templates" / name
        if template.exists():
            template.unlink()
    values_path = destination / "values.yaml"
    values = values_path.read_text(encoding="utf-8")
    for key in SECRET_VALUE_KEYS:
        values, substitutions = re.subn(
            rf"^(\s*{re.escape(key)}:)\s*.*$", rf'\1 ""', values, flags=re.MULTILINE
        )
        if substitutions != 1:
            fail(f"could not sanitize exactly one {key} value in GitOps Chart seed")
    values_path.write_text(values, encoding="utf-8")
    forbidden = ("change-me", "sk-replace-me", "registry.example.invalid")
    copied_text = "\n".join(path.read_text(encoding="utf-8") for path in destination.rglob("*") if path.is_file())
    if any(token in copied_text for token in forbidden):
        fail("GitOps Chart seed still contains a development placeholder or credential sample")
    if any((destination / name).exists() for name in GITOPS_SEED_EXCLUDED_FILES):
        fail("GitOps Chart seed contains an excluded development Values file")
    if any((destination / "templates" / name).exists() for name in GITOPS_SEED_EXCLUDED_TEMPLATES):
        fail("GitOps Chart seed still contains a development Secret or infrastructure template")


def gitops_ci_yaml() -> str:
    return """stages:
  - validate

default:
  tags:
    - docker
    - private

validate_staging:
  stage: validate
  image:
    name: harbor.home.arpa/ci-tools/helm:3.19.0
    entrypoint: [""]
  script:
    - test -f helm/dramaip-platform/values-staging.yaml
    - '! grep -RInE "registry\\.example\\.invalid|REPLACE_WITH_|change-me|sk-replace-me|<[A-Z0-9_]+>|\\.invalid" helm argocd'
    - '! grep -RInE "^[[:space:]]*kind:[[:space:]]*Secret[[:space:]]*$" helm/dramaip-platform/templates'
    - '! grep -RInE "^[[:space:]]*(postgresPassword|postgresAuthPassword|postgresUserProfilePassword|postgresBillingPassword|postgresQuotaPassword|postgresAIGatewayPassword|postgresNotificationPassword|postgresInspirationPassword|postgresAdminPassword|postgresReportingPassword|postgresSnapshotPassword|redisPassword|rabbitmqPassword|aiProviderApiKey|authEmailDeliveryToken):[[:space:]]*[^[:space:]#]" helm argocd'
    - helm lint helm/dramaip-platform -f helm/dramaip-platform/values-staging.yaml
    - helm template dramaip-staging helm/dramaip-platform -f helm/dramaip-platform/values-staging.yaml > /tmp/rendered.yaml
    - test -s /tmp/rendered.yaml
    - 'test "$(grep -Ec "^[[:space:]]+repository: .+/.+$" helm/dramaip-platform/values-staging.yaml)" = 9'
    - 'test "$(grep -Ec "^[[:space:]]+tag: sha-[0-9a-f]{40}$" helm/dramaip-platform/values-staging.yaml)" = 9'
    - 'test "$(grep -E "^[[:space:]]+tag: sha-[0-9a-f]{40}$" helm/dramaip-platform/values-staging.yaml | awk "{print \\$2}" | sort -u | wc -l | tr -d " ")" = 1'
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "staging"'
"""


def app_project_yaml(args: argparse.Namespace) -> str:
    secrets = "\n".join(
        f"      - kind: Secret\n        name: {name}"
        for name in (
            "dramaip-staging-runtime", "dramaip-staging-auth-jwt", "dramaip-staging-admin-jwt",
            "dramaip-staging-internal-mtls", "dramaip-staging-registry", "dramaip-staging-ingress-tls",
        )
    )
    return f"""apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: dramaip
  namespace: argocd
spec:
  description: DramaIP Staging applications
  sourceRepos:
    - {args.gitops_repo_url}
  destinations:
    - namespace: {args.namespace}
      server: https://kubernetes.default.svc
  namespaceResourceWhitelist:
    - group: \"*\"
      kind: \"*\"
  orphanedResources:
    warn: true
    ignore:
{secrets}
"""


def staging_application_yaml(args: argparse.Namespace) -> str:
    return f"""apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {args.argocd_app}
  namespace: argocd
spec:
  project: dramaip
  source:
    repoURL: {args.gitops_repo_url}
    targetRevision: {args.gitops_branch}
    path: helm/dramaip-platform
    helm:
      valueFiles:
        - values-staging.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: {args.namespace}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - PruneLast=true
"""


def root_application_yaml(args: argparse.Namespace) -> str:
    return f"""apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {args.root_app}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: {args.gitops_repo_url}
    targetRevision: {args.gitops_main_branch}
    path: argocd
    directory:
      recurse: true
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - PruneLast=true
"""


def bootstrap_command(args: argparse.Namespace) -> None:
    if not args.apply:
        fail("bootstrap writes and pushes GitOps commits; rerun with --apply after reviewing all arguments")
    require_tools(("git", "helm", "ssh-add"))
    specs = parse_manifest()
    if not SOURCE_CHART_DIR.is_dir():
        fail(f"source Chart seed is missing: {SOURCE_CHART_DIR}")
    gitops_dir = resolve_gitops_dir(args.gitops_dir)
    assert_ssh_agent()
    assert_gitops_remote(gitops_dir, args.gitops_ssh_url)
    git_clean(gitops_dir, "GitOps")
    if git_output(gitops_dir, "ls-files") or any(path.name != ".git" for path in gitops_dir.iterdir()):
        fail("bootstrap requires an empty GitOps clone; do not overwrite an existing GitOps repository")
    revision = assert_source_ready()
    tag = immutable_tag(revision)
    current_branch = git_output(gitops_dir, "branch", "--show-current")
    if current_branch != args.gitops_main_branch:
        run(["git", "-C", str(gitops_dir), "checkout", "--orphan", args.gitops_main_branch])
    target_chart = gitops_dir / "helm" / "dramaip-platform"
    target_chart.parent.mkdir(parents=True, exist_ok=True)
    prepare_gitops_chart_seed(SOURCE_CHART_DIR, target_chart)
    (target_chart / "values-staging.yaml").write_text(initial_staging_values(args, specs, tag), encoding="utf-8")
    argocd_dir = gitops_dir / "argocd"
    argocd_dir.mkdir(parents=True, exist_ok=True)
    (argocd_dir / "dramaip-project.yaml").write_text(app_project_yaml(args), encoding="utf-8")
    (argocd_dir / "dramaip-staging.yaml").write_text(staging_application_yaml(args), encoding="utf-8")
    (argocd_dir / "platform-bootstrap.yaml").write_text(root_application_yaml(args), encoding="utf-8")
    (gitops_dir / ".gitlab-ci.yml").write_text(gitops_ci_yaml(), encoding="utf-8")
    run(["helm", "lint", str(target_chart), "-f", str(target_chart / "values-staging.yaml")])
    run(["git", "-C", str(gitops_dir), "add", "helm", "argocd", ".gitlab-ci.yml"])
    run(["git", "-C", str(gitops_dir), "commit", "-m", "feat: initialize DramaIP Staging GitOps"])
    run(["git", "-C", str(gitops_dir), "push", "-u", "origin", args.gitops_main_branch])
    run(["git", "-C", str(gitops_dir), "checkout", "-b", args.gitops_branch])
    run(["git", "-C", str(gitops_dir), "push", "-u", "origin", args.gitops_branch])
    ok(
        "GitOps main and staging branches initialized; apply the root Application manually, then run release. "
        "After GitOps main is verified, remove the source Chart in a separate source MR."
    )


def release_env(args: argparse.Namespace, revision: str, report_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "IMAGE_REGISTRY": args.registry,
            "IMAGE_TAG": immutable_tag(revision),
            "IMAGE_REVISION": revision,
            "DRAMAIP_DOCKER_PLATFORM": args.platform,
            "TRIVY_IMAGE": args.trivy_image,
            "TRIVY_CACHE_DIR": str(trivy_cache_dir()),
            "TRIVY_REPORT_DIR": str(report_dir),
        }
    )
    return env


def staging_values_update_expression(specs: list[ImageSpec], registry: str, tag: str, revision: str) -> str:
    if not TAG_RE.fullmatch(tag):
        fail(f"refusing non-immutable image tag: {tag}")
    expressions: list[str] = []
    for spec in specs:
        if spec.kind == "web":
            expression = f'.web.image.repository = "{registry}/web" | .web.image.tag = "{tag}"'
        else:
            expression = (
                f'.java.images.{spec.chart_key}.repository = "{registry}/{spec.image_name}" | '
                f'.java.images.{spec.chart_key}.tag = "{tag}"'
            )
        expressions.append(expression)
    expressions.append(f'.release.sourceRevision = "{revision}" | .release.imageTag = "{tag}"')
    return " | ".join(expressions)


def update_staging_values(values: Path, specs: list[ImageSpec], registry: str, tag: str, revision: str) -> None:
    """Write the eight Java and one web image references in one yq transaction."""

    run(["yq", "-i", staging_values_update_expression(specs, registry, tag, revision), str(values)])


def commit_staged_release(gitops_dir: Path, values: Path, tag: str) -> None:
    run(["git", "-C", str(gitops_dir), "add", str(values.relative_to(gitops_dir))])
    run(["git", "-C", str(gitops_dir), "diff", "--cached", "--check"])
    diff = subprocess.run(["git", "-C", str(gitops_dir), "diff", "--cached", "--quiet"])
    if diff.returncode == 0:
        fail(f"GitOps Staging already references {tag}; refusing a duplicate release")
    if diff.returncode != 1:
        fail("could not inspect staged GitOps release update")
    run(["git", "-C", str(gitops_dir), "commit", "-m", f"chore(staging): deploy DramaIP {tag}"])


def create_rollback_branch(gitops_dir: Path, base_ref: str, commit: str, branch: str) -> None:
    run(["git", "-C", str(gitops_dir), "checkout", "-b", branch, base_ref])
    run(["git", "-C", str(gitops_dir), "revert", "--no-edit", commit])


def release_command(args: argparse.Namespace) -> None:
    gitops_dir = resolve_gitops_dir(args.gitops_dir)
    if args.dry_run:
        info("dry-run runs check and verify, then prints the mutating release sequence")
        check_command(args)
        verify_command(args)
        revision = source_revision()
        for command in (
            f"build-images.sh ({immutable_tag(revision)})", "scan-images.sh", "push-images.sh",
            f"fast-forward GitOps {args.gitops_branch}", "yq update all 9 Java/Web image references",
            f"argocd app wait {args.argocd_app}",
        ):
            print(f"DRY-RUN $ {command}")
        return
    check_command(args)
    verify_command(args)
    revision = source_revision()
    tag = immutable_tag(revision)
    specs = parse_manifest()
    report_dir = trivy_cache_dir().parent / "trivy-reports" / tag
    environment = release_env(args, revision, report_dir)
    run(["bash", str(RELEASE_DIR / "build-images.sh")], cwd=PLATFORM_DIR, env=environment)
    run(["bash", str(RELEASE_DIR / "scan-images.sh")], cwd=PLATFORM_DIR, env=environment)
    run(["bash", str(RELEASE_DIR / "push-images.sh")], cwd=PLATFORM_DIR, env=environment)

    git_clean(gitops_dir, "GitOps")
    run(["git", "-C", str(gitops_dir), "fetch", "origin", args.gitops_main_branch, args.gitops_branch])
    run(["git", "-C", str(gitops_dir), "checkout", args.gitops_branch])
    run(["git", "-C", str(gitops_dir), "merge", "--ff-only", f"origin/{args.gitops_main_branch}"])
    values = staging_values(gitops_dir)
    update_staging_values(values, specs, args.registry, tag, revision)
    run(["helm", "lint", str(gitops_chart(gitops_dir)), "-f", str(values)])
    run(["helm", "template", args.argocd_app, str(gitops_chart(gitops_dir)), "-f", str(values)], capture=True)
    commit_staged_release(gitops_dir, values, tag)
    run(["git", "-C", str(gitops_dir), "push", "origin", args.gitops_branch])
    run(["argocd", "app", "wait", args.argocd_app, "--sync", "--health", "--timeout", str(args.argocd_timeout)])
    ok(f"Staging release complete: {tag}")


def rollback_command(args: argparse.Namespace) -> None:
    gitops_dir = resolve_gitops_dir(args.gitops_dir)
    if not COMMIT_RE.fullmatch(args.commit):
        fail("--commit must be a 7 to 40 character Git commit SHA")
    require_tools(("git",))
    assert_ssh_agent()
    assert_gitops_remote(gitops_dir, args.gitops_ssh_url)
    git_clean(gitops_dir, "GitOps")
    run(["git", "-C", str(gitops_dir), "fetch", "origin", args.gitops_branch])
    run(["git", "-C", str(gitops_dir), "checkout", args.gitops_branch])
    run(["git", "-C", str(gitops_dir), "rev-parse", "--verify", f"{args.commit}^{{commit}}"])
    branch = f"rollback/staging-{args.commit[:12]}"
    create_rollback_branch(gitops_dir, f"origin/{args.gitops_branch}", args.commit, branch)
    run(["git", "-C", str(gitops_dir), "push", "-u", "origin", branch])
    ok(f"rollback branch pushed: {branch}; create a GitLab MR into {args.gitops_branch}")


def add_common_options(parser: argparse.ArgumentParser, *, gitops_required: bool = True) -> None:
    parser.add_argument("--gitops-dir", default=DEFAULT_GITOPS_DIR, required=False if not gitops_required else not bool(DEFAULT_GITOPS_DIR))
    parser.add_argument("--registry", default=DEFAULT_REGISTRY)
    parser.add_argument("--gitops-ssh-url", default=DEFAULT_GITOPS_SSH_URL)
    parser.add_argument("--gitops-repo-url", default=DEFAULT_GITOPS_REPO_URL)
    parser.add_argument("--gitops-main-branch", default="main")
    parser.add_argument("--gitops-branch", default="staging")
    parser.add_argument("--namespace", default=DEFAULT_NAMESPACE)
    parser.add_argument("--argocd-app", default=DEFAULT_APP)
    parser.add_argument("--root-app", default=DEFAULT_ROOT_APP)
    parser.add_argument("--trivy-image", default=DEFAULT_TRIVY_IMAGE)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DramaIP safe local Staging GitOps release entry point")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check", help="validate release prerequisites without writing state")
    add_common_options(check)
    check.set_defaults(handler=check_command)

    verify = subparsers.add_parser("verify", help="run source and GitOps validation")
    add_common_options(verify)
    verify.add_argument("--install-deps", action="store_true", help="allow frozen pnpm installs when dependencies are absent")
    verify.set_defaults(handler=verify_command)

    update_db = subparsers.add_parser("update-trivy-db", help="explicitly refresh the local Trivy database")
    update_db.add_argument("--trivy-image", default=DEFAULT_TRIVY_IMAGE)
    update_db.set_defaults(handler=update_trivy_db_command)

    bootstrap = subparsers.add_parser("bootstrap", help="initialize an empty manually-created GitOps repository")
    add_common_options(bootstrap)
    bootstrap.add_argument("--apply", action="store_true", help="acknowledge that bootstrap creates and pushes GitOps commits")
    bootstrap.add_argument("--postgres-host")
    bootstrap.add_argument("--redis-addr")
    bootstrap.add_argument("--rabbitmq-host")
    bootstrap.add_argument("--rabbitmq-port", default="5671")
    bootstrap.add_argument("--otel-endpoint")
    bootstrap.add_argument("--ingress-host")
    bootstrap.add_argument("--web-origin")
    bootstrap.add_argument("--admin-origin")
    bootstrap.set_defaults(handler=bootstrap_command)

    release = subparsers.add_parser("release", help="build, scan, push, update GitOps, and wait for Argo CD")
    add_common_options(release)
    release.add_argument("--platform", default="linux/amd64", choices=("linux/amd64", "linux/arm64"))
    release.add_argument("--argocd-timeout", type=int, default=600)
    release.add_argument("--install-deps", action="store_true", help="allow frozen pnpm installs when dependencies are absent")
    release.add_argument("--dry-run", action="store_true", help="print the release sequence without building, pushing, or changing GitOps")
    release.set_defaults(handler=release_command)

    rollback = subparsers.add_parser("rollback", help="create a GitOps rollback branch; it never changes a cluster directly")
    add_common_options(rollback)
    rollback.add_argument("--commit", required=True, help="GitOps staging deployment commit to revert")
    rollback.set_defaults(handler=rollback_command)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        args.handler(args)
    except CICDError as exc:
        print(f"ERR {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("ERR interrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
