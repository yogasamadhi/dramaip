import { defineConfig } from "vitest/config";

/**
 * The shared tsconfig keeps `jsx: "preserve"` because Next.js compiles the
 * renderer itself. The test runner transforms the same sources with Oxc, so
 * the automatic JSX runtime is selected here instead.
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
});
