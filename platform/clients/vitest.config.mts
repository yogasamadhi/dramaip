import { defineConfig } from "vitest/config";

/**
 * Platform client test configuration.
 *
 * The shared tsconfig keeps `jsx: "preserve"` because Next.js compiles the
 * renderer itself. The test runner transforms the same sources with Oxc, so
 * the automatic JSX runtime is selected here instead.
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/coverage/**",
    ],
  },
});
