import { describe, expect, test } from "vitest";
import { recommendedCodexConnectionProtocol } from "./codex-connection-protocol";

describe("recommendedCodexConnectionProtocol", () => {
  test("uses local conversion as the initial choice for compatible presets", () => {
    expect(recommendedCodexConnectionProtocol("deepseek")).toBe(
      "chat_completions",
    );
    expect(recommendedCodexConnectionProtocol("gemini")).toBe(
      "chat_completions",
    );
  });

  test("uses direct Responses for OpenAI and custom providers", () => {
    expect(recommendedCodexConnectionProtocol("openai")).toBe("responses");
    expect(recommendedCodexConnectionProtocol("other")).toBe("responses");
    expect(recommendedCodexConnectionProtocol(undefined)).toBe("responses");
  });
});
