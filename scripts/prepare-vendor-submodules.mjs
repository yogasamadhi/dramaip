// Initializes the vendor submodules the Desktop development environment needs.
// The pnpm script `prepare:submodules` runs this file directly.
import { ensureVendorSubmodules } from "./prepare-dev-environment.mjs";

try {
  ensureVendorSubmodules(false);
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
