import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { ShellBridge } from "@dramaip/host-shell-bridge";
import { CloudAi } from "./cloud-ai.ts";
import { HostCredentials } from "./credentials.ts";

test("hosted AI authorizes with PKCE, restores the vault session, and forwards only to DramaIP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-hosted-ai-"));
  const credentials = () =>
    new HostCredentials(join(directory, "vault"), {} as ShellBridge);
  const code = "a".repeat(43);
  const requests: Array<{ path: string; auth?: string; body?: unknown }> = [];
  let challenge: string | null = null;
  let device: string | null = null;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const path = request.url!;
    const auth = request.headers.authorization;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ path, ...(auth ? { auth } : {}), body });
    let data: unknown;
    switch (path) {
      case "/api/v1/auth/desktop/token":
        expect(body.authorizationCode).toBe(code);
        expect(
          createHash("sha256").update(body.codeVerifier).digest("base64url"),
        ).toBe(challenge);
        expect(body.deviceId).toBe(device);
        data = {
          accessToken: "fixture-access",
          refreshToken: "fixture-refresh",
          expiresIn: 1800,
          email: "writer@example.test",
        };
        break;
      case "/api/v1/models?view=catalogue":
        data = [{ id: "hosted-test", name: "Hosted Test" }];
        break;
      case "/api/v1/quota/balance":
        data = { remainingTokens: 12000 };
        break;
      case "/api/v1/chats/completions":
        expect(request.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
        expect(request.headers["x-ai-session-id"]).toBe("conversation-test");
        expect(request.headers["x-dramaip-contract-version"]).toBe("2");
        response
          .writeHead(200, { "Content-Type": "text/event-stream" })
          .end("data: [DONE]\n\n");
        return;
      case "/api/v1/auth/token/revoke":
        data = null;
        break;
      default:
        response.writeHead(404).end();
        return;
    }
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ code: "OK", data }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const open = vi.fn(async (address: string) => {
    const uri = new URL(address);
    expect(uri.pathname).toBe("/desktop/authorize");
    challenge = uri.searchParams.get("code_challenge");
    device = uri.searchParams.get("device_id");
    const callback = new URL(uri.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", "invalid");
    expect((await fetch(callback)).status).toBe(400);
    callback.searchParams.set("state", uri.searchParams.get("state")!);
    expect((await fetch(callback)).status).toBe(200);
  });
  const original = new CloudAi(directory, credentials(), open, api, api);
  let restored: CloudAi | undefined;
  try {
    expect((await original.summary()).signedIn).toBe(false);
    await original.signIn();
    await vi.waitFor(async () => {
      expect(await original.summary()).toMatchObject({
        signedIn: true,
        pending: false,
        models: ["hosted-test"],
        modelNames: { "hosted-test": "Hosted Test" },
        remainingTokens: 12000,
      });
    });
    expect(
      await readFile(join(directory, "cloud-ai-session.ref"), "utf8"),
    ).toMatch(/^[a-f0-9-]{36}$/);
    original.dispose();

    restored = new CloudAi(directory, credentials(), open, api, api);
    expect((await restored.summary()).signedIn).toBe(true);
    await expect(restored.connection("missing-model")).rejects.toThrow(
      "模型当前不可用",
    );
    const connection = await restored.connection("hosted-test");
    const url = connection.baseUrl + "/chat/completions";
    expect((await fetch(url, { method: "POST" })).status).toBe(403);
    expect(connection.secret).not.toBe("fixture-access");
    const body = {
      model: "hosted-test",
      messages: [{ role: "user", content: "test" }],
      stream: true,
    };
    const send = () =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + connection.secret,
          "X-AI-Session-Id": "conversation-test",
        },
        body: JSON.stringify(body),
      });
    expect(await (await send()).text()).toBe("data: [DONE]\n\n");
    expect(
      requests.find((request) => request.path === "/api/v1/chats/completions"),
    ).toMatchObject({
      auth: "Bearer fixture-access",
      body: { ...body, max_tokens: 4096 },
    });
    await restored.signOut();
    expect((await send()).status).toBe(401);
    expect(
      requests.filter(
        (request) => request.path === "/api/v1/chats/completions",
      ),
    ).toHaveLength(1);
    expect(requests.at(-1)).toMatchObject({
      path: "/api/v1/auth/token/revoke",
      body: { refreshToken: "fixture-refresh" },
    });
  } finally {
    original.dispose();
    restored?.dispose();
    server.close();
    server.closeAllConnections();
    await rm(directory, { recursive: true, force: true });
  }
});
