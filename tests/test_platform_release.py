from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "platform/deploy/release"
MANIFEST = RELEASE / "images.tsv"
CHECKER = RELEASE / "check-manifest.sh"
TRIVY_UPDATER = RELEASE / "update-trivy-db.sh"
STAGING_SMOKE = RELEASE / "staging-smoke.sh"
HELM_RELEASE = RELEASE / "helm-release.sh"
HELM_CHART = ROOT / "platform/deploy/helm/dramaip-platform"
ALERTMANAGER_ROUTE_CHECK = RELEASE / "alertmanager-route-check"

EXPECTED_ALERTS = (
    "DramaipTargetDown",
    "DramaipHighRequestErrorRate",
    "DramaipPaymentConfirmationFailed",
    "DramaipQuotaRejectionsHigh",
    "DramaipOutboxBacklog",
    "DramaipRabbitMQQueueBacklog",
    "DramaipDatabasePoolSaturated",
    "DramaipProviderFailureRate",
    "DramaipProviderLatencyHigh",
    "DramaipProviderCostAlert",
    "DramaipErrorAggregationHigh",
    "DramaipAlloyTraceExportFailures",
    "DramaipAlloyTraceQueueSaturated",
    "DramaipAlloyLogWriteDrops",
    "DramaipAlloyLogWriteRetriesHigh",
    "DramaipSensitiveLogRejected",
    "DramaipLokiDiscardingLogs",
    "DramaipLokiWalCorruption",
    "DramaipLokiWalDiskPressure",
    "DramaipLokiWalWriteFailures",
    "DramaipTempoDiscardingSpans",
)


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

    def test_java_images_receive_release_tag_as_service_version(self) -> None:
        build_script = (RELEASE / "build-images.sh").read_text(encoding="utf-8")
        self.assertIn('--build-arg "SERVICE_VERSION=$tag"', build_script)

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

    def test_release_rejects_unsafe_otel_endpoints_without_echoing_them(self) -> None:
        invalid_endpoints = (
            "ftp://alloy.example.internal:4318",
            "alloy.example.internal:4318",
            "https://",
            "https:///v1/traces",
            "https://:4318/v1/traces",
            "https://",
            "https://./v1/traces",
            "https://alloy..example.internal:4318",
            "https://-alloy.example.internal:4318",
            "https://alloy.example.internal:0",
            "https://alloy.example.internal:65536",
            "https://operator:otel-secret@alloy.example.internal:4318",
            "https://alloy.example.internal:4318/has whitespace",
        )
        for endpoint in invalid_endpoints:
            with self.subTest(endpoint=endpoint), tempfile.TemporaryDirectory() as temporary_name:
                temporary = Path(temporary_name)
                helm_log = temporary / "helm.log"
                fake_helm = temporary / "helm"
                fake_helm.write_text(
                    "#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' \"$*\" >> \"$FAKE_HELM_LOG\"\n",
                    encoding="utf-8",
                )
                fake_helm.chmod(0o755)
                fake_kubectl = temporary / "kubectl"
                fake_kubectl.write_text(
                    "#!/usr/bin/env bash\nset -eu\nprintf reached > \"$FAKE_KUBECTL_MARKER\"\nexit 88\n",
                    encoding="utf-8",
                )
                fake_kubectl.chmod(0o755)
                environment = os.environ.copy()
                for key in (
                    "DRAMAIP_GITOPS_DIR",
                    "DRAMAIP_KUBE_CONTEXT",
                    "DRAMAIP_TEMPORARY_STAGING_INFRA",
                    "DRAMAIP_TEMPORARY_STAGING_DIAGNOSTIC_RETAIN",
                    "DRAMAIP_OTEL_HEADERS_SECRET_NAME",
                    "DRAMAIP_OTEL_HEADERS_SECRET_KEY",
                ):
                    environment.pop(key, None)
                environment.update(
                    {
                        "PATH": f"{temporary}:{environment['PATH']}",
                        "DRAMAIP_HELM_BIN": str(fake_helm),
                        "DRAMAIP_RELEASE_AUTHORIZED": "1",
                        "IMAGE_REGISTRY": "registry.example/dramaip",
                        "IMAGE_TAG": "release-1",
                        "DRAMAIP_POSTGRES_HOST": "postgres.example.internal",
                        "DRAMAIP_PUBLIC_INGRESS_HOST": "api.staging.example",
                        "DRAMAIP_WEB_ORIGIN": "https://app.staging.example",
                        "DRAMAIP_ALERT_NOTIFICATION_ROUTE": "platform-primary",
                        "DRAMAIP_OTEL_ENDPOINT": endpoint,
                        "FAKE_HELM_LOG": str(helm_log),
                        "FAKE_KUBECTL_MARKER": str(temporary / "kubectl.reached"),
                    }
                )

                result = run("bash", str(HELM_RELEASE), "staging", "apply", env=environment)
                output = result.stdout + result.stderr

                self.assertEqual(2, result.returncode, output)
                self.assertIn(
                    "DRAMAIP_OTEL_ENDPOINT must be an absolute HTTP(S) URL with a valid host and optional port, without whitespace or credentials",
                    result.stderr,
                )
                self.assertNotIn(endpoint, output)
                self.assertNotIn("otel-secret", output)
                self.assertEqual("lint", helm_log.read_text(encoding="utf-8").split()[0])
                self.assertFalse((temporary / "kubectl.reached").exists())

    def test_helm_values_schema_rejects_malformed_otel_authorities(self) -> None:
        helm = shutil.which("helm")
        self.assertIsNotNone(helm, "helm is required for the release contract tests")
        for endpoint in (
            "https://:4318/v1/traces",
            "https://./v1/traces",
            "https://operator:secret@alloy.example.internal:4318",
            "https://alloy..example.internal:4318",
            "https://alloy.example.internal:0",
            "https://alloy.example.internal:65536",
        ):
            with self.subTest(endpoint=endpoint):
                result = run(
                    str(helm),
                    "lint",
                    str(HELM_CHART),
                    "--set-string",
                    f"observability.otlp.endpoint={endpoint}",
                )
                self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)

    def test_alertmanager_route_check_requires_matcher_and_receiver_on_same_route_path(self) -> None:
        helm = shutil.which("helm")
        self.assertIsNotNone(helm, "helm is required for the release contract tests")
        valid = """route:
  receiver: fallback
  routes:
    - matchers:
        - notification_route="platform-primary"
      receiver: platform-pager
receivers:
  - name: fallback
  - name: platform-pager
"""
        false_positive_for_contains = """route:
  receiver: fallback
  routes:
    - matchers:
        - notification_route="another-route"
      receiver: platform-primary
receivers:
  - name: fallback
  - name: platform-primary
"""
        missing_receiver = """route:
  receiver: fallback
  routes:
    - matchers:
        - notification_route="platform-primary"
      receiver: not-defined
receivers:
  - name: fallback
"""
        with tempfile.TemporaryDirectory() as temporary_name:
            temporary = Path(temporary_name)
            valid_file = temporary / "valid.yaml"
            invalid_file = temporary / "invalid.yaml"
            missing_receiver_file = temporary / "missing-receiver.yaml"
            valid_file.write_text(valid, encoding="utf-8")
            invalid_file.write_text(false_positive_for_contains, encoding="utf-8")
            missing_receiver_file.write_text(missing_receiver, encoding="utf-8")
            common = (
                str(helm),
                "template",
                "dramaip-alertmanager-route-check",
                str(ALERTMANAGER_ROUTE_CHECK),
                "--set-string",
                "notificationRoute=platform-primary",
                "--set-file",
            )
            valid_result = run(*common, f"alertmanagerConfig={valid_file}")
            invalid_result = run(*common, f"alertmanagerConfig={invalid_file}")
            missing_receiver_result = run(*common, f"alertmanagerConfig={missing_receiver_file}")

        self.assertEqual(0, valid_result.returncode, valid_result.stderr)
        self.assertNotEqual(0, invalid_result.returncode)
        self.assertIn("no matching notification route with a receiver", invalid_result.stderr)
        self.assertNotEqual(0, missing_receiver_result.returncode)
        self.assertIn("no matching notification route with a receiver", missing_receiver_result.stderr)

    def _write_smoke_fakes(self, temporary: Path) -> dict[str, str]:
        fake_helm = """#!/usr/bin/env bash
set -eu
case " $* " in
  *" status "*) : ;;
  *" template "*) exec "$REAL_HELM" "$@" ;;
  *) exit 8 ;;
esac
"""
        fake_kubectl = """#!/usr/bin/env bash
set -eu
case " $* " in
  *" get prometheusrules.monitoring.coreos.com "*)
    command cat "$FAKE_PROMETHEUS_RULE_JSON"
    ;;
  *" get deployment "*) printf 'deployment.apps/fake 1/1 1 1 1m\\n' ;;
  *" rollout status deployment "*) : ;;
  *) exit 8 ;;
esac
"""
        fake_curl = """#!/usr/bin/env bash
set -eu
url=''
for argument in "$@"; do url="$argument"; done
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
case "$url" in
  https://prometheus.example/api/v1/rules?type=alert)
    [[ " $* " == *" @$SMOKE_PROMETHEUS_AUTH_HEADER_FILE "* ]] || exit 7
    command cat "$FAKE_PROMETHEUS_RULES_JSON"
    ;;
  https://prometheus.example/api/v1/alertmanagers)
    [[ " $* " == *" @$SMOKE_PROMETHEUS_AUTH_HEADER_FILE "* ]] || exit 7
    command cat "$FAKE_PROMETHEUS_ALERTMANAGERS_JSON"
    ;;
  https://alertmanager.example/-/ready)
    [[ " $* " == *" @$SMOKE_ALERTMANAGER_AUTH_HEADER_FILE "* ]] || exit 7
    ;;
  https://alertmanager.example/api/v2/status)
    [[ " $* " == *" @$SMOKE_ALERTMANAGER_AUTH_HEADER_FILE "* ]] || exit 7
    command cat "$FAKE_ALERTMANAGER_STATUS_JSON"
    ;;
  https://api.staging.example/api/v1/plans)
    count=0
    if [[ -f "$FAKE_CURL_COUNT" ]]; then count="$(<"$FAKE_CURL_COUNT")"; fi
    count=$((count + 1))
    printf '%s\\n' "$count" > "$FAKE_CURL_COUNT"
    if [[ "$count" == "1" ]]; then printf 401; else printf 429; fi
    ;;
  *) exit 9 ;;
esac
"""
        for name, content in (("helm", fake_helm), ("kubectl", fake_kubectl), ("curl", fake_curl)):
            executable = temporary / name
            executable.write_text(content, encoding="utf-8")
            executable.chmod(0o755)

        prometheus_header = temporary / "prometheus.header"
        alertmanager_header = temporary / "alertmanager.header"
        prometheus_header.write_text("Authorization: Bearer prometheus-sentinel\n", encoding="utf-8")
        alertmanager_header.write_text("Authorization: Bearer alertmanager-sentinel\n", encoding="utf-8")
        labels = {
            "team": "dramaip-platform",
            "notification_route": "platform-primary",
            "dramaip_release": "dramaip-platform",
        }
        reliability_alerts = EXPECTED_ALERTS[:11]
        pipeline_alerts = EXPECTED_ALERTS[11:]
        prometheus_rule = {
            "items": [
                {
                    "spec": {
                        "groups": [
                            {
                                "name": "dramaip-platform-reliability",
                                "rules": [
                                    {"alert": name, "labels": labels.copy()} for name in reliability_alerts
                                ],
                            },
                            {
                                "name": "dramaip-observability-pipeline",
                                "rules": [
                                    {"alert": name, "labels": labels.copy()} for name in pipeline_alerts
                                ],
                            },
                        ]
                    }
                }
            ]
        }
        prometheus_rules = {
            "status": "success",
            "data": {
                "groups": [
                    {
                        "name": "dramaip-platform-reliability",
                        "rules": [
                            {
                                "name": name,
                                "type": "alerting",
                                "health": "ok",
                                "lastError": "",
                                "labels": labels.copy(),
                            }
                            for name in reliability_alerts
                        ],
                    },
                    {
                        "name": "dramaip-observability-pipeline",
                        "rules": [
                            {
                                "name": name,
                                "type": "alerting",
                                "health": "ok",
                                "lastError": "",
                                "labels": labels.copy(),
                            }
                            for name in pipeline_alerts
                        ],
                    },
                ]
            },
        }
        fixtures = {
            "prometheus-rule.json": prometheus_rule,
            "prometheus-rules.json": prometheus_rules,
            "prometheus-alertmanagers.json": {
                "status": "success",
                "data": {
                    "activeAlertmanagers": [{"url": "http://alertmanager.monitoring.svc:9093/api/v2/alerts"}],
                    "droppedAlertmanagers": [],
                },
            },
            "alertmanager-status.json": {
                "config": {
                    "original": 'route:\n  receiver: fallback\n  routes:\n    - matchers:\n        - notification_route="platform-primary"\n      receiver: platform-pager\nreceivers:\n  - name: fallback\n  - name: platform-pager\n'
                }
            },
        }
        fixture_paths: dict[str, Path] = {}
        for name, value in fixtures.items():
            fixture_path = temporary / name
            fixture_path.write_text(json.dumps(value), encoding="utf-8")
            fixture_paths[name] = fixture_path
        real_helm = shutil.which("helm")
        self.assertIsNotNone(real_helm, "helm is required for the release contract tests")
        environment = os.environ.copy()
        for key in (
            "DRAMAIP_KUBE_CONTEXT",
            "DRAMAIP_TEMPORARY_STAGING_INFRA",
            "SMOKE_CA_FILE",
            "SMOKE_CURL_RESOLVE",
            "SMOKE_RATE_LIMIT_URL",
        ):
            environment.pop(key, None)
        environment.update(
            {
                "PATH": f"{temporary}:{environment['PATH']}",
                "DRAMAIP_HELM_BIN": str(temporary / "helm"),
                "REAL_HELM": str(real_helm),
                "DRAMAIP_SMOKE_AUTHORIZED": "1",
                "DRAMAIP_ALERT_NOTIFICATION_ROUTE": "platform-primary",
                "SMOKE_BASE_URL": "https://api.staging.example",
                "SMOKE_PROMETHEUS_URL": "https://prometheus.example",
                "SMOKE_ALERTMANAGER_URL": "https://alertmanager.example",
                "SMOKE_PROMETHEUS_AUTH_HEADER_FILE": str(prometheus_header),
                "SMOKE_ALERTMANAGER_AUTH_HEADER_FILE": str(alertmanager_header),
                "SMOKE_RATE_LIMIT_TEST": "1",
                "SMOKE_RATE_LIMIT_ATTEMPTS": "2",
                "FAKE_CURL_COUNT": str(temporary / "curl.count"),
                "FAKE_CURL_LOG": str(temporary / "curl.log"),
                "FAKE_PROMETHEUS_RULE_JSON": str(fixture_paths["prometheus-rule.json"]),
                "FAKE_PROMETHEUS_RULES_JSON": str(fixture_paths["prometheus-rules.json"]),
                "FAKE_PROMETHEUS_ALERTMANAGERS_JSON": str(fixture_paths["prometheus-alertmanagers.json"]),
                "FAKE_ALERTMANAGER_STATUS_JSON": str(fixture_paths["alertmanager-status.json"]),
            }
        )
        return environment

    def test_staging_smoke_validates_external_alerting_without_exposing_auth_headers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_name:
            temporary = Path(temporary_name)
            environment = self._write_smoke_fakes(temporary)
            result = run("bash", str(STAGING_SMOKE), "staging", env=environment)
            curl_log = (temporary / "curl.log").read_text(encoding="utf-8")

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("Prometheus rules, and Alertmanager routing", result.stdout)
        self.assertIn(f"@{environment['SMOKE_PROMETHEUS_AUTH_HEADER_FILE']}", curl_log)
        self.assertIn(f"@{environment['SMOKE_ALERTMANAGER_AUTH_HEADER_FILE']}", curl_log)
        self.assertNotIn("prometheus-sentinel", result.stdout + result.stderr + curl_log)
        self.assertNotIn("alertmanager-sentinel", result.stdout + result.stderr + curl_log)

    def test_staging_smoke_rejects_prometheus_without_active_alertmanager(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_name:
            temporary = Path(temporary_name)
            environment = self._write_smoke_fakes(temporary)
            fixture = Path(environment["FAKE_PROMETHEUS_ALERTMANAGERS_JSON"])
            data = json.loads(fixture.read_text(encoding="utf-8"))
            data["data"]["activeAlertmanagers"] = []
            fixture.write_text(json.dumps(data), encoding="utf-8")
            result = run("bash", str(STAGING_SMOKE), "staging", env=environment)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("external Prometheus has no active Alertmanager", result.stderr)

    def test_staging_smoke_rejects_incomplete_prometheus_rule_resource(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_name:
            temporary = Path(temporary_name)
            environment = self._write_smoke_fakes(temporary)
            fixture = Path(environment["FAKE_PROMETHEUS_RULE_JSON"])
            data = json.loads(fixture.read_text(encoding="utf-8"))
            data["items"][0]["spec"]["groups"][0]["rules"].pop()
            fixture.write_text(json.dumps(data), encoding="utf-8")
            result = run("bash", str(STAGING_SMOKE), "staging", env=environment)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("PrometheusRule is missing, incomplete", result.stderr)

    def test_staging_smoke_rejects_incomplete_or_unhealthy_prometheus_rules(self) -> None:
        mutations = (
            ("missing", lambda rules: rules.pop()),
            ("wrong-type", lambda rules: rules[0].update(type="recording")),
            ("unhealthy", lambda rules: rules[0].update(health="err")),
            ("last-error", lambda rules: rules[0].update(lastError="parse failed")),
            (
                "wrong-label",
                lambda rules: rules[0]["labels"].update(notification_route="another-route"),
            ),
        )
        for name, mutate in mutations:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary_name:
                temporary = Path(temporary_name)
                environment = self._write_smoke_fakes(temporary)
                fixture = Path(environment["FAKE_PROMETHEUS_RULES_JSON"])
                data = json.loads(fixture.read_text(encoding="utf-8"))
                rules = data["data"]["groups"][0]["rules"]
                mutate(rules)
                fixture.write_text(json.dumps(data), encoding="utf-8")
                result = run("bash", str(STAGING_SMOKE), "staging", env=environment)

            self.assertNotEqual(0, result.returncode)
            self.assertIn("all healthy DramaIP alert rules", result.stderr)

    def test_staging_smoke_rejects_alertmanager_contains_false_positive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_name:
            temporary = Path(temporary_name)
            environment = self._write_smoke_fakes(temporary)
            fixture = Path(environment["FAKE_ALERTMANAGER_STATUS_JSON"])
            fixture.write_text(
                json.dumps(
                    {
                        "config": {
                            "original": 'route:\n  receiver: fallback\n  routes:\n    - matchers:\n        - notification_route="another-route"\n      receiver: platform-primary\nreceivers:\n  - name: fallback\n  - name: platform-primary\n'
                        }
                    }
                ),
                encoding="utf-8",
            )
            result = run("bash", str(STAGING_SMOKE), "staging", env=environment)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("no route node binding", result.stderr)

    def test_temporary_staging_smoke_skips_external_notification_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_name:
            temporary = Path(temporary_name)
            environment = self._write_smoke_fakes(temporary)
            environment["DRAMAIP_TEMPORARY_STAGING_INFRA"] = "1"
            for key in (
                "DRAMAIP_ALERT_NOTIFICATION_ROUTE",
                "SMOKE_PROMETHEUS_URL",
                "SMOKE_ALERTMANAGER_URL",
                "SMOKE_PROMETHEUS_AUTH_HEADER_FILE",
                "SMOKE_ALERTMANAGER_AUTH_HEADER_FILE",
            ):
                environment.pop(key, None)
            result = run("bash", str(STAGING_SMOKE), "staging", env=environment)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("skipping external Prometheus and Alertmanager notification checks", result.stdout)
        self.assertIn("embedded alerting exception", result.stdout)


if __name__ == "__main__":
    unittest.main()
