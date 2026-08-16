from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER_TEST = ROOT / "platform" / "clients" / "scripts" / "platform-launchers.test.ts"


class PlatformLauncherTests(unittest.TestCase):
    def test_typescript_launchers(self) -> None:
        bun = shutil.which("bun")
        self.assertIsNotNone(bun, "Bun 1.3.14 is required")
        version = subprocess.run(
            [bun, "--version"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual("1.3.14", version)
        subprocess.run(
            [bun, "test", str(LAUNCHER_TEST)],
            cwd=ROOT / "platform" / "clients",
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
