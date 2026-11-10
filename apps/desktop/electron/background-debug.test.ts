import { describe, expect, it, vi } from "vitest";
import {
  exitOnUncaughtError,
  installBackgroundNativeGuards,
  isBackgroundDebugMode,
} from "./background-debug";

describe("background debugging", () => {
  it("keeps isolated E2E and explicitly requested debugging in the background", () => {
    expect(isBackgroundDebugMode({ DRAMAIP_E2E_USER_DATA: "/test" })).toBe(
      true,
    );
    expect(isBackgroundDebugMode({ DRAMAIP_DEBUG_BACKGROUND: "1" })).toBe(true);
    expect(
      isBackgroundDebugMode({
        DRAMAIP_E2E_USER_DATA: "/test",
        DRAMAIP_DEBUG_BACKGROUND: "0",
      }),
    ).toBe(true);
  });

  it("does not change ordinary launches without an opt-in environment", () => {
    expect(isBackgroundDebugMode({})).toBe(false);
    expect(isBackgroundDebugMode({ DRAMAIP_DEBUG_BACKGROUND: "0" })).toBe(
      false,
    );
    expect(
      isBackgroundDebugMode({
        DRAMAIP_DEBUG_BACKGROUND: "true",
        DRAMAIP_E2E_USER_DATA: "",
      }),
    ).toBe(false);
  });

  it("does not exempt release builds from explicitly requested background debugging", () => {
    // Packaging is deliberately not an input: the same opt-in guards apply
    // during installed-app E2E, while ordinary release launches remain visible.
    expect(
      isBackgroundDebugMode({
        DRAMAIP_DEBUG_BACKGROUND: "1",
        DRAMAIP_E2E_USER_DATA: "/test",
      }),
    ).toBe(true);
  });

  it("blocks real native UI while allowing an explicit controlled file selector", async () => {
    const native = vi.fn();
    const dialogs = {
      showOpenDialog: async () => {
        native();
        return { canceled: true, filePaths: [] as string[] };
      },
      showSaveDialog: async () => {
        native();
        return { canceled: true, filePath: "" };
      },
      showErrorBox: native,
    };
    const external = {
      openExternal: async () => void native(),
      showItemInFolder: native,
    };
    installBackgroundNativeGuards(dialogs, external);
    await expect(dialogs.showOpenDialog()).rejects.toThrow("后台调试禁止");
    await expect(dialogs.showSaveDialog()).rejects.toThrow("后台调试禁止");
    await expect(external.openExternal()).rejects.toThrow("后台调试禁止");
    expect(() => external.showItemInFolder()).toThrow("后台调试禁止");
    expect(native).not.toHaveBeenCalled();
    dialogs.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ["/controlled/fixture.txt"],
    });
    expect(await dialogs.showOpenDialog()).toEqual({
      canceled: false,
      filePaths: ["/controlled/fixture.txt"],
    });
    expect(native).not.toHaveBeenCalled();
  });

  it("logs startup errors without a system alert", () => {
    const native = vi.fn();
    const logger = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const dialogs = {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: true, filePath: "" }),
        showErrorBox: native,
      };
      installBackgroundNativeGuards(dialogs, {
        openExternal: async () => undefined,
        showItemInFolder: native,
      });
      dialogs.showErrorBox("Startup", "Failed");
      expect(logger).toHaveBeenCalledWith("Startup", "Failed");
      expect(native).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });

  it("ends the run with a logged error instead of an uncaught-error alert", () => {
    const listeners = new Map<string, (error: never) => void>();
    const exit = vi.fn();
    const log = vi.fn();
    exitOnUncaughtError(
      {
        on: (event: string, listener: (error: never) => void) =>
          listeners.set(event, listener),
        exit,
      },
      log,
    );
    expect([...listeners.keys()]).toEqual([
      "uncaughtException",
      "unhandledRejection",
    ]);
    const raise = (event: string, error: unknown) =>
      (listeners.get(event) as ((error: unknown) => void) | undefined)?.(error);
    raise("uncaughtException", new ReferenceError("evaluation"));
    raise("unhandledRejection", "rejected");
    expect(exit.mock.calls).toEqual([[1], [1]]);
    expect(log.mock.calls[0]?.[0]).toContain("ReferenceError: evaluation");
    expect(log.mock.calls[1]?.[0]).toContain("rejected");
  });
});
