import { expect, test } from "bun:test";
import { createServer } from "node:http";
import {
  responsesInputToChatMessages,
  startCodexChatBridge,
} from "./codex-chat-bridge";

test("Codex Chat Bridge converts Responses input and tool output", () => {
  expect(
    responsesInputToChatMessages(
      [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "function_call_output", call_id: "call_1", output: "done" },
      ],
      "system",
    ),
  ).toEqual([
    { role: "system", content: "system" },
    { role: "user", content: [{ type: "text", text: "hello" }] },
    { role: "tool", tool_call_id: "call_1", content: "done" },
  ]);
});

test("Codex Chat Bridge translates streaming Chat Completions", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const target = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hel" } }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const address = target.address();
  if (!address || typeof address === "string")
    throw new Error("target did not start");
  const bridge = await startCodexChatBridge({
    targetBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "secret-key",
  });
  try {
    const response = await fetch(`${bridge.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridge.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        instructions: "system",
        input: "hello",
        stream: true,
      }),
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"type":"response.output_text.delta"');
    expect(body).toContain('"delta":"hel"');
    expect(body).toContain('"type":"response.completed"');
    expect(requestBody).toMatchObject({
      model: "deepseek-chat",
      stream: true,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "hello" },
      ],
    });
  } finally {
    await bridge.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});
