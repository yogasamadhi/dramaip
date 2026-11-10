import { describe, expect, it } from "vitest";
import { migrationWorkerEnvironment } from "./migration-worker.js";

describe("migration worker protocol", () => {
  it("sets Electron Node mode only for desktop workers", () => {
    const source = { ELECTRON_RUN_AS_NODE: "stale", EXAMPLE: "kept" };
    expect(migrationWorkerEnvironment("node", source)).toEqual({
      EXAMPLE: "kept",
    });
    expect(migrationWorkerEnvironment("electron-node", source)).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      EXAMPLE: "kept",
    });
  });
});
