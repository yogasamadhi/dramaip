from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]


def load_launcher(name: str) -> ModuleType:
    """按路径加载带连字符文件名的根启动器。"""
    path = ROOT / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


clients = load_launcher("run-platform-clients")
development = load_launcher("run-platform-dev")


class PlatformClientLauncherTests(unittest.TestCase):
    def test_preserves_client_option_semantics(self) -> None:
        options = clients.parse_client_arguments(
            [
                "--install",
                "--no-kill-ports",
                "--api-base-url=http://127.0.0.1:9000",
                "--mobile-target",
                "ios",
            ]
        )
        self.assertIsNotNone(options)
        assert options is not None
        self.assertEqual(options.install_mode, "force")
        self.assertFalse(options.kill_ports)
        self.assertEqual(options.api_base_url, "http://127.0.0.1:9000")
        self.assertEqual(options.mobile_target, "ios")
        with self.assertRaisesRegex(RuntimeError, "cannot be used together"):
            clients.parse_client_arguments(["--install", "--no-install"])


class PlatformDevelopmentLauncherTests(unittest.TestCase):
    def test_parses_service_selection_and_always_includes_identity(self) -> None:
        options = development.parse_development_arguments(
            [
                "--skip-package",
                "--services=creation,quota",
                "--no-gateway",
            ]
        )
        self.assertIsNotNone(options)
        assert options is not None
        self.assertTrue(options.skip_package)
        self.assertFalse(options.no_infrastructure)
        self.assertFalse(options.observability)
        self.assertFalse(options.smoke)
        self.assertEqual(options.services, "creation,quota")
        self.assertTrue(options.no_gateway)
        selected = development.resolve_selected_services(
            development.parse_services("creation, quota")
        )
        self.assertEqual(sorted(selected), ["creation", "identity", "quota"])
        with self.assertRaisesRegex(RuntimeError, "unknown service"):
            development.resolve_selected_services({"unknown"})

    def test_builds_the_same_local_and_observability_environment(self) -> None:
        telemetry_variables = [
            "DRAMAIP_DEPLOYMENT_ENVIRONMENT",
            "DRAMAIP_SERVICE_VERSION",
            "DRAMAIP_RELEASE_NAME",
            "OTEL_RESOURCE_ATTRIBUTES",
            "OTEL_TRACES_SAMPLER",
        ]
        previous = {name: os.environ.get(name) for name in telemetry_variables}
        for name in (
            "POSTGRES_DB",
            "POSTGRES_PASSWORD",
            "DRAMAIP_MIGRATION_ROLE_PASSWORD",
            *telemetry_variables,
        ):
            os.environ.pop(name, None)
        try:
            environment = development.local_environment(True)
            self.assertEqual(
                environment["POSTGRES_DSN"],
                "jdbc:postgresql://127.0.0.1:5432/dramaip",
            )
            self.assertEqual(
                environment["HISTORICAL_MIGRATIONS_APPLY_PENDING"], "true"
            )
            self.assertEqual(
                environment["OTEL_EXPORTER_OTLP_ENDPOINT"], "http://127.0.0.1:4318"
            )
            self.assertEqual(environment["OTEL_METRICS_EXPORTER"], "none")
            self.assertEqual(environment["OTEL_LOGS_EXPORTER"], "none")
            self.assertEqual(environment["OTEL_EXPORTER_OTLP_PROTOCOL"], "http/protobuf")
            self.assertEqual(
                environment["OTEL_PROPAGATORS"], "tracecontext,baggage"
            )
            self.assertEqual(environment["OTEL_TRACES_SAMPLER"], "always_on")
            self.assertEqual(environment["DRAMAIP_DEPLOYMENT_ENVIRONMENT"], "local")
            self.assertEqual(environment["DRAMAIP_SERVICE_VERSION"], "development")
            self.assertEqual(environment["DRAMAIP_RELEASE_NAME"], "host-local")
            self.assertEqual(
                environment["OTEL_RESOURCE_ATTRIBUTES"],
                "deployment.environment.name=local,service.version=development,"
                "service.namespace=dramaip-platform,dramaip.release=host-local",
            )
        finally:
            for name in (
                "POSTGRES_DB",
                "POSTGRES_PASSWORD",
                "DRAMAIP_MIGRATION_ROLE_PASSWORD",
                *telemetry_variables,
            ):
                os.environ.pop(name, None)
            for name, value in previous.items():
                if value is not None:
                    os.environ[name] = value

    def test_writes_prometheus_targets_for_only_selected_host_jvms(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target_directory = Path(directory)
            development.write_host_prometheus_targets(
                {"identity", "quota"}, True, target_directory
            )
            gateway = json.loads(
                (target_directory / "gateway.json").read_text(encoding="utf-8")
            )
            services = json.loads(
                (target_directory / "services.json").read_text(encoding="utf-8")
            )
            self.assertEqual(gateway[0]["targets"], ["host.docker.internal:8080"])
            self.assertEqual(
                sorted(item["targets"][0] for item in services),
                ["host.docker.internal:8081", "host.docker.internal:8084"],
            )

    def test_parses_quoted_jvm_options_without_invoking_a_shell(self) -> None:
        self.assertEqual(
            development.split_shell_words(
                "-Xmx1g -Dname=\"Drama IP\" '-Dflag=a b'"
            ),
            ["-Xmx1g", "-Dname=Drama IP", "-Dflag=a b"],
        )
        with self.assertRaisesRegex(RuntimeError, "unterminated quote"):
            development.split_shell_words('-Dname="unterminated')

    def test_keeps_migration_sockets_direct_and_requires_the_packaged_agent(self) -> None:
        self.assertEqual(
            development.build_migration_command("java", "/tmp/migration-exec.jar"),
            [
                "java",
                "-DsocksProxyHost=",
                "-DsocksProxyPort=",
                "-jar",
                "/tmp/migration-exec.jar",
            ],
        )
        with self.assertRaisesRegex(RuntimeError, "OpenTelemetry Java agent is missing"):
            development.require_observability_agent(
                Path("/tmp/dramaip-missing-otel-agent.jar")
            )

    def test_uses_only_the_observability_compose_profile_and_services(self) -> None:
        self.assertEqual(
            development.DOCKER_OBSERVABILITY_SERVICES,
            ["prometheus", "alloy", "loki", "tempo", "grafana"],
        )
        command = development.observability_compose_command(
            "docker", "up", "-d", *development.DOCKER_OBSERVABILITY_SERVICES
        )
        self.assertIn("observability", command)
        self.assertIn("up", command)
        for service in development.DOCKER_OBSERVABILITY_SERVICES:
            self.assertIn(service, command)
        for retired in (
            "otel-collector",
            "jaeger",
            "filebeat",
            "elasticsearch",
            "kibana",
        ):
            self.assertNotIn(retired, command)


if __name__ == "__main__":
    unittest.main()
