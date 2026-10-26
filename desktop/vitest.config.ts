import { defineConfig } from "vitest/config";

/**
 * Desktop workspace test configuration.
 *
 * The repository keeps archived snapshots under `desktop/legacy/` and
 * generated runtime artifacts under `desktop/build/`, `desktop/out/` and
 * `desktop/apps/desktop/dist/`. Those trees contain copies of the test
 * sources and must never be collected by the workspace test runner.
 */
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: [/build\/dsh-framework/],
      },
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/release/**",
      "**/coverage/**",
      "legacy/**",
      "apps/desktop/legacy/**",
    ],
  },
});
