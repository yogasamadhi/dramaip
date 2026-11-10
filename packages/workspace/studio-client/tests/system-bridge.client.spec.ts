// @vitest-environment jsdom
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgeSystemRequest,
  installSystemBridge,
} from "../src/client/system-bridge.ts";

const ORIGIN = "http://studio.test";

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (code: string, message = "failed") =>
  Promise.resolve({ ok: false as const, error: { code, message } });

/** A `system` namespace whose methods the test fills in. */
function remoteWith(system: Record<string, unknown>): Context["remote"] {
  return { system } as unknown as Context["remote"];
}

/** A stream handle over `frames`, recording its disposal. */
function handleOf(frames: unknown[]) {
  const handle = {
    disposed: false,
    dispose() {
      handle.disposed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const frame of frames) yield frame;
    },
  };
  return handle;
}

const call = (
  remote: Context["remote"],
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const response = bridgeSystemRequest(
    remote,
    `${ORIGIN}${path}`,
    init,
    ORIGIN,
  );
  if (response === undefined) throw new Error(`${path} was not bridged`);
  return response;
};

describe("the system bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers the runtime identity from the system namespace", async () => {
    const runtime = vi.fn(() => ok({ runtimeId: "runtime-1" }));
    const response = await call(remoteWith({ runtime }), "/api/v2/runtime");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runtimeId: "runtime-1" });
  });

  it("passes every other path, and other origins, to the page's fetch", () => {
    const remote = remoteWith({});
    for (const [input, init] of [
      [`${ORIGIN}/api/v2/projects`, undefined],
      ["http://elsewhere.test/api/v2/health", undefined],
      [`${ORIGIN}/api/v2/health`, { method: "POST" }],
    ] as const)
      expect(bridgeSystemRequest(remote, input, init, ORIGIN)).toBeUndefined();
  });

  it("reads JSON bodies, answers no-content actions and decodes path parameters", async () => {
    const openExternal = vi.fn(() => ok(undefined));
    const removeCredential = vi.fn(() => ok(undefined));
    const remote = remoteWith({ openExternal, removeCredential });
    const opened = await call(remote, "/api/v2/system/host/open-external", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(opened.status).toBe(204);
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    const removed = await call(
      remote,
      "/api/v2/system/host/credentials/credential%3Aopenai",
      { method: "DELETE" },
    );
    expect(removed.status).toBe(204);
    expect(removeCredential).toHaveBeenCalledWith("credential:openai");
  });

  it("refuses an unknown local runtime kind before calling the Host", async () => {
    const localModels = vi.fn();
    const response = await call(
      remoteWith({ localModels }),
      "/api/v2/local-model-runtimes/vllm/models",
    );
    expect(response.status).toBe(400);
    expect(localModels).not.toHaveBeenCalled();
  });

  it("maps failures to the answers the removed routes gave", async () => {
    const answers = await Promise.all(
      [
        "system/host-unavailable",
        "gateway/bad-request",
        "gateway/input-invalid",
        "system/internal",
      ].map(async (code) => {
        const response = await call(
          remoteWith({ credentialStatus: () => failed(code, "secret detail") }),
          "/api/v2/system/host/credentials/status",
        );
        return [response.status, await response.json()];
      }),
    );
    expect(answers).toEqual([
      [503, { code: "HOST_UNAVAILABLE", title: "Desktop Host is unavailable" }],
      [400, { code: "VALIDATION_FAILED", title: "secret detail" }],
      [400, { code: "VALIDATION_FAILED", title: "secret detail" }],
      [500, { code: "INTERNAL_ERROR", title: "Unexpected runtime error" }],
    ]);
  });

  it("streams events as server-sent frames from the reconnect cursor", async () => {
    const handle = handleOf([
      {
        kind: "domain",
        cursor: 8,
        event: { type: "workspace.project-created" },
      },
      { kind: "realtime", event: { type: "agent.progress" } },
    ]);
    const events = vi.fn(() => handle);
    const response = await call(
      remoteWith({ events }),
      "/api/v2/events?cursor=3",
      {
        headers: { "Last-Event-ID": "7" },
      },
    );
    expect(events).toHaveBeenCalledWith(7);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toBe(
      'event: workspace.project-created\nid: 8\ndata: {"kind":"domain","cursor":8,"event":{"type":"workspace.project-created"}}\n\n' +
        'event: agent.progress\ndata: {"kind":"realtime","event":{"type":"agent.progress"}}\n\n',
    );
  });

  it("disposes the event subscription when the reader cancels", async () => {
    const handle = handleOf([]);
    // A stream that stays open until disposed.
    handle[Symbol.asyncIterator] = async function* () {
      yield await new Promise<never>(() => {});
    };
    const response = await call(
      remoteWith({ events: () => handle }),
      "/api/v2/events",
    );
    await response.body?.cancel();
    expect(handle.disposed).toBe(true);
  });

  it("installs over the page's fetch and restores it", async () => {
    const pageFetch = vi.fn(() => Promise.resolve(new Response("page")));
    window.fetch = pageFetch as typeof fetch;
    const health = vi.fn(() => ok({ healthy: true }));
    const dispose = installSystemBridge({
      remote: remoteWith({ health }),
    } as unknown as Context);
    await expect(
      (await window.fetch("/api/v2/health")).json(),
    ).resolves.toEqual({ healthy: true });
    await expect((await window.fetch("/api/v2/projects")).text()).resolves.toBe(
      "page",
    );
    expect(pageFetch).toHaveBeenCalledTimes(1);
    dispose();
    expect(window.fetch).toBe(pageFetch);
  });
});
