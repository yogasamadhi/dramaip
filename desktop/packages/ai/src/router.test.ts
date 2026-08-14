import { expect, test } from "bun:test";
import {
  AgentEngineRouter,
  EngineUnavailableError,
  type AgentEngine,
} from "./index";

function engine(kind: AgentEngine["kind"], available: boolean): AgentEngine {
  return {
    kind,
    health: async () => ({ available, version: "test" }),
    capabilities: async () => ({
      streaming: true,
      interrupt: true,
      resume: true,
      fork: true,
      readOnlyMcp: true,
      structuredOutput: true,
      chatGptLogin: false,
      apiKeyLogin: true,
    }),
    createSession: async () => {
      throw new Error("测试未调用");
    },
    run: async function* () {},
    interrupt: async () => {},
    resume: async function* () {},
    fork: async () => {
      throw new Error("测试未调用");
    },
    dispose: async () => {},
  };
}

test("路由器只解析显式选择的引擎且绝不自动回退", async () => {
  const router = new AgentEngineRouter();
  router.register(engine("opencode", true));
  router.register(engine("codex", false));
  await expect(router.resolve("opencode")).resolves.toMatchObject({
    kind: "opencode",
  });
  await expect(router.resolve("codex")).rejects.toBeInstanceOf(
    EngineUnavailableError,
  );
  await expect(router.resolve("langgraph")).rejects.toBeInstanceOf(
    EngineUnavailableError,
  );
});
