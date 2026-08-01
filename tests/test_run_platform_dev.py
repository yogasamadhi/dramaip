from __future__ import annotations

import importlib.util
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

        self.assertEqual("true", environment["LEGACY_MIGRATIONS_APPLY_PENDING"])
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
        self.assertEqual("true", environment["LEGACY_MIGRATIONS_APPLY_PENDING"])


if __name__ == "__main__":
    unittest.main()
