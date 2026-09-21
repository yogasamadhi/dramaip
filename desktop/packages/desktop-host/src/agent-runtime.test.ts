import { describe, expect, it } from "vitest";
import type { AgentEngineKind } from "@dramaip/contracts";
import { AgentRuntimeError } from "@dramaip/agent-runtime";
import { createHostAgentRuntime, type DesktopHostClient } from "./index.js";

function fakeHost(): DesktopHostClient {
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
  } as unknown as DesktopHostClient;
}

describe("Host AgentRuntime adapter", () => {
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

  it("reports an unsupported external benchmark operation rather than falling back", async () => {
    const runtime = createHostAgentRuntime(fakeHost(), "codex");
    await expect(runtime.steer({ runId: "run-1" }, "continue")).rejects.toEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_OPERATION",
      } satisfies Partial<AgentRuntimeError>),
    );
  });
});
