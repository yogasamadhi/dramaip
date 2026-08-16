import assert from "node:assert/strict";
import test from "node:test";

import { extractPublicText, sanitizePublicOutput } from "./server.ts";

test("public engine output removes internal reasoning, credentials and host paths", () => {
  const sanitized = sanitizePublicOutput({
    text: "完成 /Users/alice/private/story.md sk-abcdefghijklmnopqrstuvwxyz",
    reasoning: "private chain",
    nested: { stderr: "private log", content: "可公开结果" },
  }) as Record<string, unknown>;
  assert.equal(sanitized.reasoning, undefined);
  assert.match(String(sanitized.text), /\[本机路径\]/u);
  assert.match(String(sanitized.text), /\[已隐藏凭据\]/u);
  assert.equal((sanitized.nested as Record<string, unknown>).stderr, undefined);
  assert.match(extractPublicText(sanitized), /^完成/u);
});
