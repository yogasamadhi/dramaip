from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
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
            [
                "python3",
                "-m",
                "unittest",
                "discover",
                "-s",
                str(ROOT / "tests"),
                "-p",
                "test_platform_launchers.py",
            ],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
