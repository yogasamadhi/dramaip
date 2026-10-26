from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER_TEST = ROOT / "platform" / "clients" / "scripts" / "platform-launchers.test.ts"
REQUIRED_PNPM_VERSION = "11.28.5"


class PlatformLauncherTests(unittest.TestCase):
    def test_typescript_launchers(self) -> None:
        pnpm = shutil.which("pnpm")
        self.assertIsNotNone(pnpm, "pnpm 11.28.5 is required")
        version = subprocess.run(
            [pnpm, "--version"],
            cwd=ROOT / "platform" / "clients",
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(REQUIRED_PNPM_VERSION, version)
        subprocess.run(
            [pnpm, "exec", "vitest", "run", str(LAUNCHER_TEST)],
            cwd=ROOT / "platform" / "clients",
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
