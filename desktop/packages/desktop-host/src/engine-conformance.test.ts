import { describe, expect, it } from "vitest";
import type { AgentEngineKind } from "@dramaip/contracts";
import { AgentRuntimeError } from "@dramaip/agent-runtime";
import {
  AGENT_RUNTIME_DESCRIPTORS,
  createHostAgentRuntime,
  type DesktopHostClient,
} from "./index.js";

function conformanceHost(
  options: {
    available?: boolean;
    crashStream?: boolean;
  } = {},
): DesktopHostClient {
  return {
    engineHealth: async () => ({
      available: options.available ?? true,
      healthy: options.available ?? true,
      configured: true,
      authenticated: true,
      generation: 7,
      pendingRequestCount: 0,
    }),
    engineOperation: async (_kind: AgentEngineKind, operation: string) => {
      if (operation === "create" || operation === "resume")
        return { id: "vendor-session" };
      if (operation === "fork") return { id: "vendor-fork" };
      if (operation === "recoverRun")
        return {
          disposition: "completed",
          result: { text: "从持久句柄恢复" },
          finalCursor: 9,
        };
      if (["steer", "destroy", "cancel"].includes(operation))
        return { ok: true };
      throw new Error(`unexpected operation ${operation}`);
    },
    async *engineStream() {
      yield { type: "content.delta" as const, delta: "片段" };
      if (options.crashStream) throw new Error("engine process exited");
      yield { type: "result" as const, result: { text: "完成" } };
    },
  } as unknown as DesktopHostClient;
}

describe.each(["pi", "codex", "langgraph"] as const)(
  "%s AgentRuntime conformance",
  (kind) => {
    it("conforms to health, lifecycle, cursor replay, abort, resume, fork, and dispose", async () => {
      const runtime = createHostAgentRuntime(conformanceHost(), kind);
      await expect(runtime.health()).resolves.toMatchObject({
        available: true,
        healthy: true,
        generation: 7,
      });
      await expect(runtime.availability()).resolves.toMatchObject({
        available: true,
        configured: true,
      });
      const session = await runtime.createSession({
        sessionId: `${kind}-session`,
        title: "一致性测试",
      });
      const run = await runtime.prompt(session, {
        runId: `${kind}-run`,
        prompt: "开始",
      });
      const events = [];
      for await (const event of runtime.subscribe(run)) events.push(event);
      expect(events.map((event) => event.cursor)).toEqual([1, 2]);
      const replay = [];
      for await (const event of runtime.subscribe(run, { cursor: 1 }))
        replay.push(event);
      expect(replay).toMatchObject([{ cursor: 2, type: "result" }]);
      await expect(runtime.abort(run)).resolves.toBeUndefined();
      await expect(runtime.resume(session)).resolves.toMatchObject({
        engineSessionId: "vendor-session",
      });
      await expect(
        runtime.fork(session, { sessionId: `${kind}-fork` }),
      ).resolves.toMatchObject({ engineSessionId: "vendor-fork" });
      await expect(runtime.dispose(session)).resolves.toBeUndefined();
      if (AGENT_RUNTIME_DESCRIPTORS[kind].capabilities.steer)
        await expect(runtime.steer(run, "继续")).resolves.toBeUndefined();
      else
        await expect(runtime.steer(run, "继续")).rejects.toEqual(
          expect.objectContaining({
            code: "UNSUPPORTED_OPERATION",
          } satisfies Partial<AgentRuntimeError>),
        );
    });

    it("ends a crashed stream with a replayable RUN_INTERRUPTED event", async () => {
      const runtime = createHostAgentRuntime(
        conformanceHost({ crashStream: true }),
        kind,
      );
      const session = await runtime.createSession({
        sessionId: `${kind}-crash-session`,
        title: "崩溃测试",
      });
      const run = await runtime.prompt(session, {
        runId: `${kind}-crash-run`,
        prompt: "开始",
      });
      const events = [];
      for await (const event of runtime.subscribe(run)) events.push(event);
      expect(events.at(-1)).toMatchObject({
        type: "error",
        code: "RUN_INTERRUPTED",
        retryable: true,
      });
      const replay = [];
      for await (const event of runtime.subscribe(run, { cursor: 1 }))
        replay.push(event);
      expect(replay).toMatchObject([
        { cursor: 2, type: "error", code: "RUN_INTERRUPTED" },
      ]);
    });

    it("recovers a completed run from the vendor-persisted handle", async () => {
      const runtime = createHostAgentRuntime(conformanceHost(), kind);
      await expect(
        runtime.recoverRun({
          session: {
            sessionId: `${kind}-session`,
            engineSessionId: "vendor-session",
          },
          run: { runId: `${kind}-run`, engineRunId: "vendor-run" },
          afterCursor: 4,
        }),
      ).resolves.toEqual({
        disposition: "completed",
        result: { text: "从持久句柄恢复" },
        finalCursor: 9,
      });
    });

    it("reports Host unavailability without substituting another engine", async () => {
      const runtime = createHostAgentRuntime(
        conformanceHost({ available: false }),
        kind,
      );
      await expect(runtime.availability()).resolves.toMatchObject({
        available: false,
      });
    });
  },
);
