import { Context } from "@deepseek-ai/cordis";
import { describe, expect, test, vi } from "vitest";
import { apply, Engines, type EngineProvider } from "./index";

function provider(kind: EngineProvider["kind"]): EngineProvider & {
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    kind,
    health: async () => ({ available: true, healthy: true }),
    operation: async (operation) => ({ ran: operation }),
    async *stream() {
      yield { type: "done" } as never;
    },
    dispose: vi.fn(async () => undefined),
  };
}

describe("engine registry", () => {
  test("an unregistered engine answers with a structured error, never a stand-in", async () => {
    const engines = new Engines();
    await expect(engines.health("pi")).resolves.toMatchObject({
      available: false,
      code: "ENGINE_NOT_REGISTERED",
      engine: "pi",
    });
    await expect(engines.operation("pi", "run", {})).resolves.toMatchObject({
      code: "ENGINE_NOT_REGISTERED",
      engine: "pi",
      operation: "run",
    });
    const events = [];
    for await (const event of engines.stream(
      "pi",
      {},
      new AbortController().signal,
    ))
      events.push(event);
    expect(events).toEqual([{ type: "error", message: "pi 引擎未注册" }]);
  });

  test("a registered engine runs; unregistering stops it and leaves the structured error", async () => {
    const engines = new Engines();
    const pi = provider("pi");
    const unregister = engines.register(pi);
    expect(() => engines.register(provider("pi"))).toThrow(
      /already registered/u,
    );
    await expect(engines.operation("pi", "run", {})).resolves.toEqual({
      ran: "run",
    });
    expect(engines.kinds()).toEqual(["pi"]);
    await unregister();
    expect(pi.dispose).toHaveBeenCalledOnce();
    expect(engines.kinds()).toEqual([]);
    await expect(engines.health("pi")).resolves.toMatchObject({
      code: "ENGINE_NOT_REGISTERED",
    });
  });

  test("disabling the registering plugin drains its engine", async () => {
    const root = new Context();
    root.plugin({ name: "seams-engines", apply });
    const pi = provider("pi");
    const fork = root.plugin({
      name: "engine-pi",
      inject: ["engines"],
      apply(ctx: Context) {
        ctx.effect(() => ctx.engines.register(pi));
      },
    });
    await fork;
    await vi.waitFor(() => expect(root.engines.kinds()).toEqual(["pi"]));
    fork.dispose();
    await vi.waitFor(() => expect(pi.dispose).toHaveBeenCalledOnce());
    expect(root.engines.kinds()).toEqual([]);
    await expect(root.engines.health("pi")).resolves.toMatchObject({
      code: "ENGINE_NOT_REGISTERED",
    });
  });

  test("each kind presents one fixed MCP token", () => {
    const engines = new Engines();
    expect(engines.mcpToken("pi")).toBe(engines.mcpToken("pi"));
    expect(new Set(engines.mcpTokens()).size).toBe(1);
  });
});
