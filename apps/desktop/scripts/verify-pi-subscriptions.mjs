import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const codexPayload = Buffer.from(
  JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
  }),
).toString("base64url");
const codexToken = `e30.${codexPayload}.test`;
const anthropicToken = "sk-ant-oat-test";
const text = "Subscription fixture";

function sse(events) {
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

export async function verifyPiSubscriptions(runtime, runtimeEntry) {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-pi-auth-"));
  const path = join(directory, "auth.json");
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  let refreshes = 0;
  let rejectCodexExchange = false;
  let copilotModel = "";
  const requests = [];
  globalThis.WebSocket = undefined;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      [
        "/api/oauth/device_authorization",
        "/oauth2/device/code",
        "/oidc/device/authorization/",
        "/login/device/code",
      ].includes(url.pathname)
    ) {
      return Response.json({
        device_code: "fixture-device",
        user_code: "FIXTURE",
        verification_uri: new URL("/activate", url.origin).href,
        verification_uri_complete: new URL("/activate?code=FIXTURE", url.origin)
          .href,
        interval: 1,
        expires_in: 30,
      });
    }
    if (
      url.pathname === "/oidc/device/token/" ||
      url.pathname === "/login/oauth/access_token"
    )
      return Response.json({ access_token: "fixture-identity" });
    if (url.pathname === "/muse-code/key") {
      assert.equal(
        request.headers.get("authorization"),
        "Bearer fixture-identity",
      );
      return Response.json({ api_key: "fixture-meta-key" });
    }
    if (url.pathname === "/copilot_internal/v2/token")
      return Response.json({
        token: "fixture-copilot-access",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    if (
      url.pathname === "/models" &&
      url.hostname === "api.individual.githubcopilot.com"
    )
      return Response.json({
        data: [
          {
            id: copilotModel,
            model_picker_enabled: true,
            capabilities: { type: "chat" },
          },
        ],
      });
    if (
      url.pathname.endsWith("/oauth/token") ||
      url.pathname === "/oauth2/token"
    ) {
      const body = await request.text();
      const grant = request.headers.get("content-type")?.includes("json")
        ? JSON.parse(body).grant_type
        : new URLSearchParams(body).get("grant_type");
      if (
        rejectCodexExchange &&
        url.hostname === "auth.openai.com" &&
        url.pathname === "/oauth/token"
      )
        return Response.json(
          { detail: "fixture provider body must stay private" },
          { status: 403 },
        );
      if (grant === "refresh_token") refreshes++;
      else
        assert.ok(
          [
            "authorization_code",
            "urn:ietf:params:oauth:grant-type:device_code",
          ].includes(grant),
        );
      return Response.json({
        access_token:
          url.hostname === "auth.openai.com" ? codexToken : anthropicToken,
        refresh_token: "test-refresh",
        expires_in: 3600,
        scope: "chatgpt.tokens.use.direct",
        id_token: "fixture-id",
      });
    }
    requests.push({ url, authorization: request.headers.get("authorization") });
    if (url.hostname === "api.anthropic.com") {
      return sse([
        {
          type: "message_start",
          message: {
            type: "message",
            id: "msg_1",
            model: "mock",
            role: "assistant",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 3 },
        },
        { type: "message_stop" },
      ]);
    }
    assert.equal(url.href, "https://chatgpt.com/backend-api/codex/responses");
    assert.equal(request.headers.get("chatgpt-account-id"), "test-account");
    const item = { type: "message", id: "msg_1", role: "assistant" };
    return sse([
      { type: "response.output_item.added", item: { ...item, content: [] } },
      {
        type: "response.content_part.added",
        part: { type: "output_text", text: "" },
      },
      { type: "response.output_text.delta", delta: text },
      {
        type: "response.output_item.done",
        item: {
          ...item,
          status: "completed",
          content: [{ type: "output_text", text }],
        },
      },
      {
        type: "response.completed",
        response: {
          status: "completed",
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        },
      },
    ]);
  };
  const login = runtime.createPiSubscriptionLogin(path);
  const restoredRuntime = await import(
    pathToFileURL(runtimeEntry).href + "?subscription-restore"
  );
  const restored = restoredRuntime.createPiSubscriptionLogin(path);
  try {
    const catalog = runtime.getPiProviderCatalog();
    const subscriptionIds = catalog.providers
      .filter(({ subscriptionLabel }) => subscriptionLabel)
      .map(({ id }) => id);
    assert.deepEqual(subscriptionIds, [
      "anthropic",
      "github-copilot",
      "kimi-coding",
      "meta",
      "openai",
      "openai-codex",
      "xai",
    ]);
    for (const [provider, providerKind, origin, token] of [
      ["anthropic", "anthropic", "https://claude.ai", anthropicToken],
      ["openai-codex", "openai", "https://auth.openai.com", codexToken],
    ]) {
      const preset = catalog.providers.find(({ id }) => id === provider);
      assert.ok(preset?.subscriptionLabel);
      assert.equal(preset.subscriptionOnly, provider === "openai-codex");
      assert.equal((await login.act(provider, "status")).signedIn, false);
      const { redirect } = await startBrowserLogin(login, provider, origin);
      if (provider === "anthropic") {
        await finishBrowserCallback(redirect, oldFetch);
      } else {
        rejectCodexExchange = true;
        await finishBrowserCallback(redirect, oldFetch);
        const rejected = await poll(
          () => login.act(provider, "status"),
          (state) => !state.pending,
        );
        assert.equal(rejected.signedIn, false);
        assert.equal(rejected.failed, true);
        assert.equal(rejected.failureReason, "exchange");
        assert.equal(rejected.exchangeStatus, 403);
        assert.ok(!JSON.stringify(rejected).includes("fixture provider body"));
        rejectCodexExchange = false;
        const retry = await startBrowserLogin(login, provider, origin);
        await login.act(provider, "answer", {
          promptId: retry.pending.prompt.id,
          value: retry.redirect.href,
        });
      }
      const finished = await poll(
        () => login.act(provider, "status"),
        (state) => !state.pending,
      );
      assert.equal(finished.signedIn, true);
      assert.equal(finished.failed, false);
      assert.equal((await restored.act(provider, "status")).signedIn, true);

      const saved = JSON.parse(await readFile(path, "utf8"));
      assert.equal(saved[provider].type, "oauth");
      if (process.platform !== "win32")
        assert.equal((await stat(path)).mode & 0o777, 0o600);
      saved[provider].expires = 0;
      await writeFile(path, JSON.stringify(saved));
      const model = preset.models[0].id;
      const before = refreshes;
      assert.deepEqual(
        await Promise.all([
          login.ready(provider, model),
          login.ready(provider, model),
        ]),
        [true, true],
      );
      assert.equal(refreshes, before + 1);
      const reply = await restoredRuntime.streamPiText({
        provider: {
          piProviderId: provider,
          providerKind,
          piAuthPath: path,
          model,
          baseUrl: "https://custom.invalid",
        },
        system: "Return test text",
        prompt: "Hello",
      });
      assert.equal(reply.text, text);
      assert.equal(requests.at(-1).authorization, `Bearer ${token}`);
      assert.ok(requests.at(-1).url.href.startsWith(preset.baseUrl));
      assert.equal((await login.act(provider, "logout")).signedIn, false);
      assert.equal(await login.ready(provider, model), false);
    }

    // Pi's ChatGPT flow requires a stable device ID and an issued OAuth client ID.
    await login.act("openai", "start");
    const chatgpt = await poll(
      () => login.act("openai", "status"),
      (state) => state.prompt?.type === "manual_code",
    );
    const authorize = new URL(
      chatgpt.notices.find(({ type }) => type === "auth_url").url,
    );
    assert.match(
      authorize.searchParams.get("ext_agent_host_id"),
      /^urn:uuid:[0-9a-f-]{36}$/,
    );
    const redirect = new URL(authorize.searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", "test-auth-code");
    redirect.searchParams.set("state", authorize.searchParams.get("state"));
    redirect.searchParams.set("client_id", "issued-fixture");
    await login.act("openai", "answer", {
      promptId: chatgpt.prompt.id,
      value: redirect.href,
    });
    assert.equal(
      (
        await poll(
          () => login.act("openai", "status"),
          (state) => !state.pending,
        )
      ).signedIn,
      true,
    );
    const settings = JSON.parse(
      await readFile(join(directory, "settings.json"), "utf8"),
    );
    assert.equal(
      authorize.searchParams.get("ext_agent_host_id"),
      `urn:uuid:${settings.deviceId}`,
    );

    for (const provider of ["kimi-coding", "meta", "xai", "github-copilot"]) {
      const preset = catalog.providers.find(({ id }) => id === provider);
      if (provider === "github-copilot") copilotModel = preset.models.at(-1).id;
      await login.act(provider, "start");
      if (provider === "github-copilot") {
        const enterprise = await poll(
          () => login.act(provider, "status"),
          (state) => state.prompt?.type === "text",
        );
        assert.match(enterprise.prompt.message, /Enterprise/);
        await login.act(provider, "answer", {
          promptId: enterprise.prompt.id,
          value: "",
        });
      }
      const device = await poll(
        () => login.act(provider, "status"),
        (state) => state.notices.some(({ type }) => type === "device_code"),
      );
      assert.equal(
        device.notices.find(({ type }) => type === "device_code").userCode,
        "FIXTURE",
      );
      const signedIn = await poll(
        () => login.act(provider, "status"),
        (state) => !state.pending,
      );
      assert.equal(signedIn.signedIn, true);
      if (provider === "github-copilot") {
        assert.deepEqual(signedIn.modelIds, [copilotModel]);
        assert.equal(await login.ready(provider, preset.models[0].id), false);
      }
      assert.equal(await login.ready(provider, signedIn.modelIds[0]), true);
    }
  } finally {
    await Promise.all([login.close(), restored.close()]);
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
    await rm(directory, { recursive: true, force: true });
  }
}

async function startBrowserLogin(login, provider, origin) {
  await login.act(provider, "start");
  const method = await poll(
    () => login.act(provider, "status"),
    (state) => state.prompt?.type === "select",
  );
  assert.ok(method.prompt.options.some(({ id }) => id === "browser"));
  await login.act(provider, "answer", {
    promptId: method.prompt.id,
    value: "browser",
  });
  const pending = await poll(
    () => login.act(provider, "status"),
    (state) =>
      state.prompt?.type === "manual_code" &&
      state.notices.some(({ type }) => type === "auth_url"),
  );
  assert.equal(pending.pending, true);
  const url = new URL(
    pending.notices.find(({ type }) => type === "auth_url").url,
  );
  assert.equal(url.origin, origin);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const redirect = new URL(url.searchParams.get("redirect_uri"));
  redirect.searchParams.set("code", "test-auth-code");
  redirect.searchParams.set("state", url.searchParams.get("state"));
  return { pending, redirect };
}

async function finishBrowserCallback(redirect, fetchDirect) {
  redirect.hostname = "127.0.0.1";
  const response = await fetchDirect(redirect, {
    signal: AbortSignal.timeout(4_000),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Authentication successful/);
}

async function poll(read, accept) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = await read();
    if (accept(state)) return state;
    await delay(20);
  }
  throw new Error("Pi subscription fixture timed out");
}
