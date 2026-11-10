import { describe, expect, it } from "vitest";
import type { AgentEngineKind } from "@dramaip/contracts";
import { createHostAgentRuntime, type DesktopHost } from "./index.js";

function fakeHost(): DesktopHost {
  return {
    engineHealth: async () => ({
      available: true,
      healthy: true,
      configured: true,
      authenticated: true,
    }),
    engineOperation: async (
      _kind: AgentEngineKind,
      operation: string,
      payload: Record<string, unknown>,
    ) => {
      if (operation === "create") return { id: "vendor-session" };
      if (operation === "resume") return { id: "vendor-session" };
      if (operation === "fork") return { id: "vendor-fork" };
      if (operation === "destroy" || operation === "cancel")
        return { ok: true };
      throw new Error(
        `unexpected operation ${operation}: ${JSON.stringify(payload)}`,
      );
    },
    async *engineStream() {
      yield { type: "activity" as const, activity: "thinking" as const };
      yield { type: "content.delta" as const, delta: "你好" };
      yield { type: "result" as const, result: { text: "你好" } };
    },
  } as unknown as DesktopHost;
}

describe("Host AgentRuntime adapter", () => {
  it("refuses retired session engines before any Host dispatch", () => {
    expect(() =>
      createHostAgentRuntime(fakeHost(), "retired-engine" as never),
    ).toThrow("原会话的引擎已停用，请新建 Pi 会话。");
  });
  it("preserves usage scope and unknown fields across cursor replay without coercion or private payload", async () => {
    const host = fakeHost();
    host.engineStream = async function* () {
      yield {
        type: "usage",
        measurementScope: "session-total",
        inputTokens: 0,
        outputTokens: "secret",
        prompt: "private",
      } as never;
      yield { type: "result", result: { text: "done" } };
    };
    const runtime = createHostAgentRuntime(host, "pi");
    const session = await runtime.createSession({
      sessionId: "session-usage",
      title: "usage",
    });
    const run = await runtime.prompt(session, {
      runId: "run-usage",
      prompt: "not in usage",
    });
    const events = [];
    for await (const event of runtime.subscribe(run)) events.push(event);
    expect(events[0]).toEqual({
      cursor: 1,
      type: "usage",
      usage: {
        measurementScope: "session-total",
        inputTokens: 0,
        invalidFields: ["outputTokens"],
      },
    });
    const replay = [];
    for await (const event of runtime.subscribe(run)) replay.push(event);
    expect(replay).toEqual(events);
    expect(JSON.stringify(replay[0])).not.toContain("private");
    expect(JSON.stringify(replay[0])).not.toContain("secret");
  });
  it("maps a Pi run to cursor-addressable neutral events", async () => {
    const runtime = createHostAgentRuntime(fakeHost(), "pi");
    await expect(runtime.health()).resolves.toMatchObject({
      available: true,
      healthy: true,
      generation: 0,
      pendingRequestCount: 0,
    });
    const session = await runtime.createSession({
      sessionId: "session-1",
      title: "test",
    });
    const run = await runtime.prompt(session, {
      runId: "run-1",
      prompt: "hello",
    });
    const events = [];
    for await (const event of runtime.subscribe(run)) events.push(event);
    expect(events).toMatchObject([
      { cursor: 1, type: "activity", activity: "thinking" },
      { cursor: 2, type: "content.delta", delta: "你好" },
      { cursor: 3, type: "result" },
    ]);
    const replay = [];
    for await (const event of runtime.subscribe(run, { cursor: 2 }))
      replay.push(event);
    expect(replay).toMatchObject([{ cursor: 3, type: "result" }]);
  });
});
