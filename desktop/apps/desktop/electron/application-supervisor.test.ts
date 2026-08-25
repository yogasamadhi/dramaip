import { describe, expect, it } from "vitest";
import { shutdownApplication } from "./application-supervisor";

describe("desktop application shutdown", () => {
  it("closes windows, engines, Runtime, and Host in order", async () => {
    const events: string[] = [];
    await shutdownApplication({
      closeWindows: () => events.push("windows"),
      disposeCredentialCapture: () => events.push("credential-capture"),
      engines: [
        { stop: async () => void events.push("engine-a") },
        { stop: async () => void events.push("engine-b") },
      ],
      runtime: { stop: async () => void events.push("runtime") },
      host: { close: () => events.push("host") },
      disposeSupervision: () => events.push("supervision"),
    });

    expect(events.slice(0, 2)).toEqual(["windows", "credential-capture"]);
    expect(new Set(events.slice(2, 4))).toEqual(
      new Set(["engine-a", "engine-b"]),
    );
    expect(events.slice(4)).toEqual(["runtime", "host", "supervision"]);
  });

  it("continues shutdown after a component hangs or throws", async () => {
    const events: string[] = [];
    const errors: string[] = [];
    await shutdownApplication({
      closeWindows: () => events.push("windows"),
      disposeCredentialCapture: () => {
        events.push("credential-capture");
        throw new Error("capture failed");
      },
      engines: [{ stop: () => new Promise<void>(() => undefined) }],
      runtime: { stop: async () => void events.push("runtime") },
      host: { close: () => events.push("host") },
      disposeSupervision: () => events.push("supervision"),
      engineTimeoutMs: 5,
      runtimeTimeoutMs: 5,
      onError: (phase) => errors.push(phase),
    });

    expect(events).toEqual([
      "windows",
      "credential-capture",
      "runtime",
      "host",
      "supervision",
    ]);
    expect(errors).toEqual(["credential-capture", "engine:0"]);
  });
});
