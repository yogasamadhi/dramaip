import { defineConfig } from "@playwright/test";

/** Performance baseline runs (scripts/measure-performance.mjs). */
export default defineConfig({
  testDir: "./tests/perf",
  testMatch: /\.perf\.ts$/u,
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
