import { describe, expect, test } from "bun:test";
import { EngineEventChannel } from "../engines/engine-event-channel";
import { ManagedComponentState, RestartBudget } from "./managed-component";

describe("desktop component supervision", () => {
  test("tracks generation and lifecycle diagnostics", () => {
    const state = new ManagedComponentState("runtime");
    expect(state.beginStart()).toBe(1);
    state.attach(42);
    state.ready({ configured: true, authenticated: true });
    expect(state.snapshot(3)).toMatchObject({
      status: "ready",
      generation: 1,
      pid: 42,
      health: true,
      pendingRequestCount: 3,
    });
    state.exited(9);
    expect(state.beginStart(true)).toBe(2);
    expect(state.snapshot().restartCount).toBe(1);
  });

  test("enforces the five-crash restart window", () => {
    const budget = new RestartBudget();
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect(budget.nextDelay()).toBeNumber();
    expect(budget.nextDelay()).toBeUndefined();
    expect(budget.snapshot()).toEqual({
      attemptsInWindow: 5,
      remaining: 0,
      exhausted: true,
      windowMs: 300_000,
      maximumAttempts: 5,
    });
    budget.dispose();
  });

  test("bounds an engine stream and emits an interruption", async () => {
    const channel = new EngineEventChannel();
    for (let index = 0; index <= 1_000; index += 1)
      channel.push({ type: "content.delta", delta: String(index) });
    const events = [];
    for await (const event of channel) events.push(event);
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "智能引擎事件流超过背压限制，任务已中断。",
    });
  });
});
