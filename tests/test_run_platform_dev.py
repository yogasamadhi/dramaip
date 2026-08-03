from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("run_platform_dev", ROOT / "run-platform-dev.py")
assert SPEC and SPEC.loader
dev = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = dev
SPEC.loader.exec_module(dev)


class LocalJavaEnvironmentTests(unittest.TestCase):
    def test_local_environment_enables_resumable_legacy_migrations(self) -> None:
        with mock.patch.dict(dev.os.environ, {}, clear=True):
            environment = dev.local_environment()

        self.assertEqual("true", environment["HISTORICAL_MIGRATIONS_APPLY_PENDING"])
        self.assertEqual("jdbc:postgresql://127.0.0.1:5432/dramaip", environment["POSTGRES_DSN"])

    def test_migration_disables_inherited_socks_proxy(self) -> None:
        migration_jar = Path("/tmp/migration-exec.jar")
        with (
            mock.patch.object(dev, "runnable_jar", return_value=migration_jar),
            mock.patch.object(dev, "run_checked") as run_checked,
        ):
            dev.run_migration(dev.local_environment())

        command, cwd, environment = run_checked.call_args.args
        self.assertEqual(
            ["java", "-DsocksProxyHost=", "-DsocksProxyPort=", "-jar", str(migration_jar)],
            command,
        )
        self.assertEqual(dev.SERVER_DIR, cwd)
        self.assertEqual("true", environment["HISTORICAL_MIGRATIONS_APPLY_PENDING"])

    def test_observability_environment_uses_host_otlp_and_disables_duplicate_metrics(self) -> None:
        with mock.patch.dict(dev.os.environ, {}, clear=True):
            environment = dev.local_environment(observability=True)

        self.assertEqual("http://127.0.0.1:4318", environment["OTEL_EXPORTER_OTLP_ENDPOINT"])
        self.assertEqual("none", environment["OTEL_METRICS_EXPORTER"])
        self.assertEqual("none", environment["OTEL_LOGS_EXPORTER"])
        self.assertEqual("tracecontext,baggage", environment["OTEL_PROPAGATORS"])

    def test_host_prometheus_targets_follow_selected_services(self) -> None:
        with mock.patch.object(dev, "HOST_PROMETHEUS_TARGETS", self._temporary_targets_dir()):
            dev.write_host_prometheus_targets({"identity", "quota"}, include_gateway=True)
            gateway = json.loads((dev.HOST_PROMETHEUS_TARGETS / "gateway.json").read_text(encoding="utf-8"))
            services = json.loads((dev.HOST_PROMETHEUS_TARGETS / "services.json").read_text(encoding="utf-8"))
            self.assertEqual(["host.docker.internal:8080"], gateway[0]["targets"])
            self.assertEqual({"host.docker.internal:8081", "host.docker.internal:8084"}, {item["targets"][0] for item in services})
            dev.write_host_prometheus_targets({"identity"}, include_gateway=False)
            self.assertEqual([], json.loads((dev.HOST_PROMETHEUS_TARGETS / "gateway.json").read_text(encoding="utf-8")))

    def test_observability_requires_packaged_agent(self) -> None:
        missing_agent = Path("/tmp/dramaip-observability-agent-does-not-exist.jar")
        with mock.patch.object(dev, "OTEL_JAVA_AGENT", missing_agent):
            with self.assertRaisesRegex(RuntimeError, "OpenTelemetry Java agent is missing"):
                dev.require_observability_agent()

    def test_start_observability_starts_only_observability_services(self) -> None:
        with (
            mock.patch.object(dev, "write_host_prometheus_targets"),
            mock.patch.object(dev, "run_checked") as run_checked,
            mock.patch.object(dev, "wait_for_http"),
            mock.patch.object(dev, "wait_for_tcp"),
        ):
            dev.start_observability({"identity"}, include_gateway=True)

        command = run_checked.call_args.args[0]
        self.assertIn("--profile", command)
        self.assertIn("observability", command)
        self.assertEqual("up", command[command.index("up")])
        self.assertTrue(set(dev.DOCKER_OBSERVABILITY_SERVICES).issubset(command))

    @staticmethod
    def _temporary_targets_dir() -> Path:
        import tempfile

        directory = Path(tempfile.mkdtemp())
        return directory


if __name__ == "__main__":
    unittest.main()
