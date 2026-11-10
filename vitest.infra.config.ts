import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { sourcePlanePlugin } from "./scripts/vitest/source-plane.ts";
import { standardDecoratorPlugin } from "./scripts/vitest/standard-decorators.ts";

/** Keep process-wide Web Storage from shadowing jsdom storage (Node lists the positive spelling of this negatable flag). */
const execArgv = process.allowedNodeEnvironmentFlags.has("--webstorage")
  ? ["--no-webstorage"]
  : [];

/**
 * Test configuration for the DSH-architecture packages: the app-owned
 * infrastructure copied from DeepSeek Harness, the boot bundles and the
 * `dramaip` CLI. Their suites follow the DSH `tests/*.spec.ts` convention and
 * use standard decorators, which the default workspace config does not
 * transform. Client component specs (`.spec.tsx`) run in jsdom through their
 * per-file `@vitest-environment` pragma.
 */
export default defineConfig({
  plugins: [
    sourcePlanePlugin(fileURLToPath(new URL(".", import.meta.url))),
    standardDecoratorPlugin(),
  ],
  // A two-faced package's tsconfig.json carries the Host face, which sets no
  // JSX mode; Client components and specs use the automatic runtime.
  esbuild: { jsx: "automatic" },
  test: {
    // Node 24 has aborted in its CJS lexer from worker threads; forks avoid it.
    pool: "forks",
    execArgv,
    setupFiles: [
      "./scripts/vitest/test-environment.ts",
      "./scripts/vitest/dom-environment.ts",
    ],
    include: [
      "packages/infra/*/tests/**/*.spec.{ts,tsx}",
      "packages/boot/*/tests/**/*.spec.{ts,tsx}",
      "packages/compat/*/tests/**/*.spec.{ts,tsx}",
      "packages/system/*/tests/**/*.spec.{ts,tsx}",
      "packages/insights/*/tests/**/*.spec.{ts,tsx}",
      "packages/production/*/tests/**/*.spec.{ts,tsx}",
      "packages/workspace/*/tests/**/*.spec.{ts,tsx}",
      "packages/writing/*/tests/**/*.spec.{ts,tsx}",
      "packages/agents/*/tests/**/*.spec.{ts,tsx}",
      "packages/automation/*/tests/**/*.spec.{ts,tsx}",
      "apps/cli/tests/**/*.spec.ts",
    ],
    server: {
      deps: {
        inline: [/build\/dsh-framework/],
      },
    },
  },
});
