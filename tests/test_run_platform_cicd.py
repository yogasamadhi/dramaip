from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("run_platform_cicd", ROOT / "run-platform-cicd.py")
assert SPEC and SPEC.loader
cicd = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cicd
SPEC.loader.exec_module(cicd)


class ManifestTests(unittest.TestCase):
    def test_release_manifest_has_complete_unique_bundle(self) -> None:
        specs = cicd.parse_manifest(ROOT / "dramaip-platform/deploy/release/images.tsv")
        self.assertEqual(10, len(specs))
        self.assertEqual(9, sum(spec.kind == "java" for spec in specs))
        self.assertEqual(1, sum(spec.kind == "web" for spec in specs))
        self.assertTrue({"gateway", "migration", "web"}.issubset({spec.chart_key for spec in specs}))

    def test_manifest_rejects_duplicate_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "images.tsv"
            manifest.write_text("one|same|go|./a\ntwo|same|go|./b\n", encoding="utf-8")
            with self.assertRaises(cicd.CICDError):
                cicd.parse_manifest(manifest)


class ValuesTests(unittest.TestCase):
    @staticmethod
    def bootstrap_args() -> argparse.Namespace:
        return argparse.Namespace(
            registry="harbor.home.arpa/dramaip",
            postgres_host="postgres.staging.internal",
            redis_addr="redis.staging.internal:6379",
            rabbitmq_host="rabbitmq.staging.internal",
            rabbitmq_port="5671",
            otel_endpoint="https://otel.staging.internal:4318",
            ingress_host="api.staging.example.com",
            web_origin="https://app.staging.example.com",
            admin_origin="https://admin.staging.example.com",
        )

    def test_staging_values_are_secret_free_and_complete(self) -> None:
        specs = cicd.parse_manifest(ROOT / "dramaip-platform/deploy/release/images.tsv")
        value = cicd.initial_staging_values(self.bootstrap_args(), specs, "sha-" + "a" * 40)
        self.assertEqual(len(specs), value.count("tag: sha-" + "a" * 40))
        self.assertNotIn("registry.example.invalid", value)
        self.assertNotIn("change-me", value)
        self.assertIn("existingSecret: dramaip-staging-runtime", value)

    def test_tag_requires_full_commit_sha(self) -> None:
        self.assertTrue(cicd.TAG_RE.fullmatch("sha-" + "a" * 40))
        self.assertFalse(cicd.TAG_RE.fullmatch("sha-short"))

    def test_single_yq_expression_updates_the_complete_bundle(self) -> None:
        specs = cicd.parse_manifest(ROOT / "dramaip-platform/deploy/release/images.tsv")
        expression = cicd.staging_values_update_expression(
            specs, "harbor.home.arpa/dramaip", "sha-" + "b" * 40, "b" * 40
        )
        self.assertEqual(len(specs), expression.count('tag = "sha-' + "b" * 40 + '"'))
        self.assertIn('.release.sourceRevision = "' + "b" * 40 + '"', expression)

    def test_gitops_chart_seed_excludes_development_secret_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "dramaip-platform"
            cicd.prepare_gitops_chart_seed(
                ROOT / "dramaip-platform/deploy/helm/dramaip-platform", destination
            )
            self.assertFalse((destination / "values-dev.yaml").exists())
            self.assertFalse((destination / "values-staging.yaml").exists())
            self.assertFalse((destination / "values-staging-temporary.yaml").exists())
            self.assertFalse((destination / "templates/secret.yaml").exists())
            self.assertFalse((destination / "templates/dev-infra.yaml").exists())
            values = (destination / "values.yaml").read_text(encoding="utf-8")
            self.assertNotIn("change-me", values)
            self.assertNotIn("sk-replace-me", values)

    @unittest.skipUnless(shutil.which("helm"), "Helm is not installed")
    def test_seeded_staging_chart_lints_and_never_renders_a_secret(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "dramaip-platform"
            specs = cicd.parse_manifest(ROOT / "dramaip-platform/deploy/release/images.tsv")
            cicd.prepare_gitops_chart_seed(
                ROOT / "dramaip-platform/deploy/helm/dramaip-platform", destination
            )
            values = destination / "values-staging.yaml"
            values.write_text(
                cicd.initial_staging_values(self.bootstrap_args(), specs, "sha-" + "d" * 40),
                encoding="utf-8",
            )
            subprocess.run(["helm", "lint", str(destination), "-f", str(values)], check=True)
            rendered = subprocess.run(
                ["helm", "template", "dramaip-staging", str(destination), "-f", str(values)],
                check=True,
                text=True,
                capture_output=True,
            ).stdout
            self.assertNotIn("\nkind: Secret\n", rendered)


class GitOpsCommitTests(unittest.TestCase):
    def git(self, directory: Path, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(directory), *args], check=True, text=True, capture_output=True
        ).stdout.strip()

    def test_release_commit_is_single_file_and_rollback_branch_reverts_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            self.git(repo, "init", "--initial-branch=staging")
            self.git(repo, "config", "user.name", "DramaIP test")
            self.git(repo, "config", "user.email", "test@example.invalid")
            values = repo / "helm" / "dramaip-platform" / "values-staging.yaml"
            values.parent.mkdir(parents=True)
            values.write_text("images:\n  webBff:\n    tag: sha-old\n", encoding="utf-8")
            self.git(repo, "add", ".")
            self.git(repo, "commit", "-m", "baseline")
            values.write_text("images:\n  webBff:\n    tag: sha-new\n", encoding="utf-8")
            cicd.commit_staged_release(repo, values, "sha-" + "c" * 40)
            release_commit = self.git(repo, "rev-parse", "HEAD")
            self.assertEqual(
                "helm/dramaip-platform/values-staging.yaml",
                self.git(repo, "show", "--format=", "--name-only", "HEAD"),
            )
            cicd.create_rollback_branch(repo, "staging", release_commit, "rollback/staging-test")
            self.assertIn("sha-old", values.read_text(encoding="utf-8"))
            self.assertEqual("rollback/staging-test", self.git(repo, "branch", "--show-current"))


class WorkspaceProtectionTests(unittest.TestCase):
    def git(self, directory: Path, *args: str) -> None:
        subprocess.run(["git", "-C", str(directory), *args], check=True, capture_output=True, text=True)

    def test_branch_and_dirty_workspace_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            self.git(repo, "init", "--initial-branch=main")
            self.git(repo, "config", "user.name", "DramaIP test")
            self.git(repo, "config", "user.email", "test@example.invalid")
            (repo / "README.md").write_text("baseline\n", encoding="utf-8")
            self.git(repo, "add", ".")
            self.git(repo, "commit", "-m", "baseline")
            with contextlib.redirect_stdout(io.StringIO()):
                cicd.require_branch(repo, "main", "test source")
            self.git(repo, "checkout", "-b", "feature")
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(cicd.CICDError):
                cicd.require_branch(repo, "main", "test source")
            self.git(repo, "checkout", "main")
            (repo / "README.md").write_text("dirty\n", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(cicd.CICDError):
                cicd.git_clean(repo, "test source")

    def test_release_arguments_require_a_gitops_directory(self) -> None:
        if cicd.DEFAULT_GITOPS_DIR:
            self.skipTest("DRAMAIP_GITOPS_DIR supplies the otherwise required argument")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cicd.parse_args(["release"])


if __name__ == "__main__":
    unittest.main()
