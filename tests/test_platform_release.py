from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "platform/deploy/release"
MANIFEST = RELEASE / "images.tsv"
CHECKER = RELEASE / "check-manifest.sh"
TRIVY_UPDATER = RELEASE / "update-trivy-db.sh"


def run(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, env=env, check=False)


class ManifestTests(unittest.TestCase):
    def test_authoritative_manifest_is_valid(self) -> None:
        result = run(str(CHECKER), str(MANIFEST))
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("10 images (9 Java, 1 Web)", result.stdout)

    def test_duplicate_image_name_is_rejected(self) -> None:
        content = MANIFEST.read_text(encoding="utf-8").replace(
            "gateway|java-gateway|java|gateway",
            "gateway|java-migration|java|gateway",
        )
        with tempfile.TemporaryDirectory() as temporary:
            candidate = Path(temporary) / "images.tsv"
            candidate.write_text(content, encoding="utf-8")
            result = run(str(CHECKER), str(candidate))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("duplicate image name", result.stderr)

    def test_invalid_kind_target_and_count_are_rejected(self) -> None:
        mutations = (
            ("web|web|web|", "web|web|worker|"),
            ("migration|java-migration|java|migration", "migration|java-migration|java|services/missing"),
            ("web|web|web|", ""),
        )
        source = MANIFEST.read_text(encoding="utf-8")
        for old, new in mutations:
            with self.subTest(old=old, new=new), tempfile.TemporaryDirectory() as temporary:
                candidate = Path(temporary) / "images.tsv"
                candidate.write_text(source.replace(old, new), encoding="utf-8")
                self.assertNotEqual(0, run(str(CHECKER), str(candidate)).returncode)


class ReleaseScriptTests(unittest.TestCase):
    def test_release_scripts_have_valid_shell_syntax(self) -> None:
        scripts = sorted(str(path) for path in RELEASE.glob("*.sh"))
        result = run("bash", "-n", *scripts)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_trivy_timestamp_is_written_only_after_both_databases_succeed(self) -> None:
        fake_docker = """#!/usr/bin/env bash
set -eu
case " $* " in
  *" --download-java-db-only "*)
    [[ "${FAIL_JAVA_DB:-0}" != "1" ]] || exit 9
    mkdir -p "$FAKE_TRIVY_CACHE/java-db"
    printf db > "$FAKE_TRIVY_CACHE/java-db/trivy-java.db"
    printf metadata > "$FAKE_TRIVY_CACHE/java-db/metadata.json"
    ;;
  *" --download-db-only "*)
    mkdir -p "$FAKE_TRIVY_CACHE/db"
    printf db > "$FAKE_TRIVY_CACHE/db/trivy.db"
    printf metadata > "$FAKE_TRIVY_CACHE/db/metadata.json"
    ;;
  *) exit 8 ;;
esac
"""
        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            docker = temp / "docker"
            docker.write_text(fake_docker, encoding="utf-8")
            docker.chmod(0o755)
            cache = temp / "cache"
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{temp}:{environment['PATH']}",
                    "TRIVY_CACHE_DIR": str(cache),
                    "FAKE_TRIVY_CACHE": str(cache),
                }
            )
            success = run(str(TRIVY_UPDATER), env=environment)
            self.assertEqual(0, success.returncode, success.stderr)
            self.assertRegex((cache / "last-successful-update").read_text(), r"^\d+\n$")

            failed_cache = temp / "failed-cache"
            environment.update(
                {
                    "TRIVY_CACHE_DIR": str(failed_cache),
                    "FAKE_TRIVY_CACHE": str(failed_cache),
                    "FAIL_JAVA_DB": "1",
                }
            )
            failure = run(str(TRIVY_UPDATER), env=environment)
            self.assertNotEqual(0, failure.returncode)
            self.assertFalse((failed_cache / "last-successful-update").exists())

    def test_deleted_cicd_launcher_is_not_referenced_by_active_files(self) -> None:
        roots = [ROOT / ".gitlab-ci.yml", ROOT / "README.md", ROOT / "AGENTS.md", ROOT / "docs", RELEASE]
        references: list[str] = []
        for root in roots:
            paths = [root] if root.is_file() else root.rglob("*")
            for path in paths:
                if not path.is_file() or path == Path(__file__):
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                if "run-platform-cicd.py" in text:
                    references.append(str(path.relative_to(ROOT)))
        self.assertEqual([], references)


if __name__ == "__main__":
    unittest.main()
