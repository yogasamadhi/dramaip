import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

import { startCodexChatBridge } from "./codex-chat-bridge.ts";

test("Codex Chat Completions bridge translates Responses requests and protects its loopback endpoint", async () => {
  let received: Record<string, unknown> | undefined;
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl_test",
        model: "test-model",
        choices: [
          {
            message: { role: "assistant", content: "已转换" },
            finish_reason: "stop",
          },
        ],
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert.notEqual(typeof address, "string");
  const bridge = await startCodexChatBridge({
    targetBaseUrl: `http://127.0.0.1:${(address as { port: number }).port}`,
    apiKey: "upstream-secret",
  });
  try {
    const denied = await fetch(`${bridge.baseUrl}/responses`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(denied.status, 401);
    const response = await fetch(`${bridge.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridge.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "test-model",
        instructions: "你是助手",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "你好" }],
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      output: Array<{ content?: Array<{ text?: string }> }>;
    };
    assert.equal(body.output[0]?.content?.[0]?.text, "已转换");
    assert.deepEqual(received?.messages, [
      { role: "system", content: "你是助手" },
      { role: "user", content: [{ type: "text", text: "你好" }] },
    ]);
  } finally {
    await bridge.close();
    upstream.close();
  }
});
