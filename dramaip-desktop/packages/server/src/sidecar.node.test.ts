import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type HostMessage = { type?: string; error?: string };

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to reserve port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function waitFor(child: ChildProcess, expected: string): Promise<HostMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for sidecar ${expected}`));
    }, 10_000);
    const onMessage = (message: HostMessage) => {
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.error ?? "Sidecar failed to start"));
      } else if (message.type === expected) {
        cleanup();
        resolve(message);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(`Sidecar exited before ${expected} (${code ?? "unknown"})`),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

test("production-structure HTTP contract persists active adaptation and atomically reorders episodes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-server-"));
  let agentProviderActionId = "";
  let agentProviderActionShotId = "";
  let opencodeSessionSequence = 0;
  let bridgedEngineSessionSequence = 0;
  let videoProviderCalls = 0;
  let codexShouldFailForNoFallbackTest = true;
  let lastSidecarDiagnostic = "";
  let port: number;
  const fileCapabilities = new Map<string, string>();
  try {
    port = await availablePort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("当前受限环境不允许绑定本机随机端口");
      rmSync(directory, { recursive: true, force: true });
      return;
    }
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const imageProvider = createServer((request, response) => {
    if (request.url === "/global/event" && request.method === "GET") {
      const sessionId = `opencode-contract-session-${opencodeSessionSequence}`;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({
          payload: {
            type: "message.part.updated",
            properties: {
              delta: "正在生成正式结果…",
              part: {
                id: `part-${opencodeSessionSequence}`,
                sessionID: sessionId,
                type: "text",
              },
            },
          },
        })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: `usage-${opencodeSessionSequence}`,
                sessionID: sessionId,
                type: "step-finish",
                tokens: { input: 128, output: 64, cache: { read: 16 } },
                cost: 0.0025,
              },
            },
          },
        })}\n\n`,
      );
      response.end();
      return;
    }
    if (request.url === "/session" && request.method === "POST") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: `opencode-contract-session-${++opencodeSessionSequence}`,
        }),
      );
      return;
    }
    if (
      /^\/session\/opencode-contract-session-\d+\/message$/.test(
        request.url ?? "",
      ) &&
      request.method === "POST"
    ) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const source = Buffer.concat(chunks).toString("utf8");
        const prompt = (() => {
          try {
            const payload = JSON.parse(source) as {
              parts?: Array<{ text?: unknown }>;
            };
            return typeof payload.parts?.[0]?.text === "string"
              ? payload.parts[0].text
              : source;
          } catch {
            return source;
          }
        })();
        const text = prompt.includes("节奏修订预览测试")
          ? (() => {
              const scriptId = /目标剧本 ID：([^；\n]+)/.exec(prompt)?.[1];
              const baseVersion = Number(
                /基础版本：(\d+)/.exec(prompt)?.[1] ?? 0,
              );
              const contextMatch = /上下文：(\{.*\})$/.exec(prompt);
              const originalPayload = contextMatch
                ? ((
                    JSON.parse(contextMatch[1]) as {
                      target?: { scriptPayload?: Record<string, unknown> };
                    }
                  ).target?.scriptPayload ?? {})
                : {};
              const proposedContent =
                "雨夜，主角没有立刻打开秘密来信，而是听见门外有人叫出他的名字。";
              return JSON.stringify({
                summary: "已生成节奏修订预览",
                content: proposedContent,
                data: {
                  targets: [
                    {
                      kind: "script",
                      id: scriptId,
                      baseVersion,
                      patch: {
                        payload: {
                          ...originalPayload,
                          剧本内容: proposedContent,
                        },
                      },
                      displayDiff: {
                        proposedContent,
                        pacingSourceId: "pacing-shot",
                        pacingSourceVersion: 1,
                      },
                    },
                  ],
                },
              });
            })()
          : prompt.includes("通用变更预览测试")
            ? JSON.stringify({
                summary: "已生成受控章节润色预览",
                content:
                  "雨夜更深，主角握紧秘密来信，决定先查清姐姐失联的真相。",
                data: {},
              })
            : prompt.includes("厂商预览测试")
              ? JSON.stringify({
                  summary: "已生成远程视频厂商调用预览",
                  content: "等待用户确认费用后发起远程视频任务。",
                  data: {
                    providerAction: {
                      kind: "video",
                      providerId: agentProviderActionId,
                      parameters: {
                        shotId: agentProviderActionShotId,
                        prompt: "雨夜信封缓慢推进，竖屏电影光影",
                        seconds: 5,
                      },
                      estimatedCost: 0.12,
                      currency: "USD",
                    },
                  },
                })
              : "已核对人物动机与结尾钩子。\n<dramaip-revision>雨夜，主角在门口发现秘密来信。他没有立刻拆开，而是先拨通了失联姐姐的电话。电话接通的瞬间，信封背面浮现出姐姐的笔迹：不要相信来电的人。</dramaip-revision>\n<dramaip-rationale>保留来信悬念，并把主角的主动选择提前，强化结尾反转。</dramaip-rationale>";
        const send = () => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ parts: [{ type: "text", text }] }));
        };
        if (prompt.includes("工具权限测试")) setTimeout(send, 300);
        else send();
      });
      return;
    }
    if (
      /^\/session\/opencode-contract-session-\d+\/abort$/.test(
        request.url ?? "",
      ) &&
      request.method === "POST"
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (
      request.url?.endsWith("/v1/models") &&
      request.headers["x-api-key"] === "test-image-provider-secret"
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "claude-contract-model" }] }));
      return;
    }
    if (
      request.url?.endsWith("/v1beta/models") &&
      request.headers["x-goog-api-key"] === "test-image-provider-secret"
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ models: [{ name: "models/gemini-contract-model" }] }),
      );
      return;
    }
    if (request.url?.includes("/audio/speech")) {
      response.writeHead(200, { "Content-Type": "audio/mpeg" });
      response.end(Buffer.from("ID3test-audio"));
      return;
    }
    if (request.url?.endsWith("/videos") && request.method === "POST") {
      videoProviderCalls += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ id: "video-test-job", status: "processing" }),
      );
      return;
    }
    if (request.url?.endsWith("/videos/video-test-job/content")) {
      response.writeHead(200, { "Content-Type": "video/mp4" });
      response.end(Buffer.from("test-video"));
      return;
    }
    if (request.url?.endsWith("/videos/video-test-job")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ id: "video-test-job", status: "completed" }),
      );
      return;
    }
    if (request.url?.endsWith("/sdapi/v1/txt2img")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ images: ["iVBORw0KGgo="] }));
      return;
    }
    if (request.url?.endsWith("/sdapi/v1/options")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ sd_model_checkpoint: "sdxl-test" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }));
  });
  await new Promise<void>((resolve) =>
    imageProvider.listen(0, "127.0.0.1", resolve),
  );
  const imageAddress = imageProvider.address();
  if (!imageAddress || typeof imageAddress === "string")
    throw new Error("Unable to start image provider mock");
  const child = fork(new URL("./sidecar-test-host.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child.on(
    "message",
    (message: {
      type?: string;
      requestId?: string;
      engineKind?: "codex" | "langgraph";
      operation?: string;
      payload?: Record<string, unknown>;
      message?: string;
      token?: string;
    }) => {
      if (message.type === "diagnostic" && message.message)
        lastSidecarDiagnostic = message.message;
      if (message.type === "credential:resolve" && message.requestId)
        child.send({
          type: "credential:resolved",
          requestId: message.requestId,
          secret: "test-image-provider-secret",
        });
      if (message.type === "capability:resolve" && message.requestId)
        child.send({
          type: "capability:resolved",
          requestId: message.requestId,
          ...(message.token && fileCapabilities.has(message.token)
            ? {
                capability: {
                  path: fileCapabilities.get(message.token)!,
                  permissions: ["read"],
                },
              }
            : {}),
        });
      if (message.type === "opencode:configure" && message.requestId)
        child.send({
          type: "opencode:configured",
          requestId: message.requestId,
          available: true,
        });
      if (
        message.type === "agent-engine:request" &&
        message.requestId &&
        message.engineKind &&
        message.operation
      ) {
        if (
          message.engineKind === "codex" &&
          message.operation === "createSession" &&
          codexShouldFailForNoFallbackTest
        ) {
          child.send({
            type: "agent-engine:response",
            requestId: message.requestId,
            error: "Codex 测试性故障",
          });
          return;
        }
        if (message.operation === "createSession") {
          child.send({
            type: "agent-engine:response",
            requestId: message.requestId,
            result: {
              id: `${message.engineKind}-contract-session-${++bridgedEngineSessionSequence}`,
            },
          });
          return;
        }
        if (message.operation === "run") {
          const runId = String(message.payload?.runId ?? "");
          child.send({
            type: "agent-engine:event",
            engineKind: message.engineKind,
            runId,
            event: {
              type: "usage",
              inputTokens: 96,
              outputTokens: 48,
              cachedTokens: 0,
              estimatedCost: 0.0015,
            },
          });
          child.send({
            type: "agent-engine:response",
            requestId: message.requestId,
            result: {
              summary: `${message.engineKind === "codex" ? "Codex" : "LangGraph.js"} 已完成盲测候选`,
              content:
                "已完成章节诊断，并给出人物动机、连续性和结尾钩子的中文建议。",
              data: {},
            },
          });
          return;
        }
        child.send({
          type: "agent-engine:response",
          requestId: message.requestId,
          result: { ok: true },
        });
      }
    },
  );
  const password = "contract-test-password";
  const url = `http://127.0.0.1:${port}`;
  const request = async <T>(
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`dramaip:${password}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    return {
      status: response.status,
      body:
        response.status === 204
          ? (undefined as T)
          : ((await response.json()) as T),
    };
  };
  const readSseEvent = async (cursor: number) => {
    const controller = new AbortController();
    try {
      const response = await fetch(`${url}/api/v1/events?cursor=${cursor}`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`dramaip:${password}`).toString("base64")}`,
        },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("\n\n")) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
      }
      const frame = buffer.split("\n\n")[0] ?? "";
      const id = Number(/^id: (\d+)$/m.exec(frame)?.[1]);
      return { id, frame };
    } finally {
      controller.abort();
    }
  };
  try {
    const ready = waitFor(child, "ready");
    child.send({
      type: "start",
      hostname: "127.0.0.1",
      port,
      password,
      databasePath: join(directory, "dramaip.db"),
      backupDirectory: join(directory, "backups"),
      assetDirectory: join(directory, "assets"),
      allowedOrigins: ["dramaip://renderer"],
      mcpToken: "test-mcp-token",
      opencode: {
        url: `http://127.0.0.1:${imageAddress.port}`,
        username: "opencode",
        password: "opencode-contract-password",
        healthy: true,
      },
      codex: { healthy: true, version: "0.147.0" },
      langgraph: { healthy: true, version: "0.2.43" },
    });
    await ready;
    const corsPreflight = await fetch(`${url}/api/v1/agent-settings`, {
      method: "OPTIONS",
      headers: {
        Origin: "dramaip://renderer",
        "Access-Control-Request-Method": "PUT",
      },
    });
    assert.equal(corsPreflight.status, 204);
    assert.match(
      corsPreflight.headers.get("access-control-allow-methods") ?? "",
      /\bPUT\b/,
    );
    const project = await request<{
      id: string;
      targetAudience?: string;
      targetEpisodeCount?: number;
      visualStyleDirection?: string;
      productionBrief?: string;
    }>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        title: "排序契约项目",
        shortDramaType: "悬疑",
        synopsis: "",
        targetAudience: "18—35 岁短剧观众",
        targetEpisodeCount: 12,
        visualStyleDirection: "雨夜霓虹与人物近景",
        productionBrief:
          "DramaIP 生产简报 v1\n创建路径：从灵感开始\n画幅：9:16 竖屏",
      }),
    });
    assert.equal(project.status, 201);
    assert.equal(project.body.targetAudience, "18—35 岁短剧观众");
    assert.equal(project.body.targetEpisodeCount, 12);
    assert.equal(project.body.visualStyleDirection, "雨夜霓虹与人物近景");
    assert.match(project.body.productionBrief ?? "", /创建路径：从灵感开始/);
    const storyBibleProject = await request<{ id: string }>(
      "/api/v1/projects",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Story Bible 选择性采用项目",
          shortDramaType: "悬疑",
          synopsis: "",
        }),
      },
    );
    assert.equal(storyBibleProject.status, 201);
    const storyBibleChapter = await request<{
      id: string;
      version: number;
    }>("/api/v1/chapters", {
      method: "POST",
      body: JSON.stringify({
        projectId: storyBibleProject.body.id,
        title: "Story Bible 选择性采用",
        summary: "林晚发现旧照片。",
        content: "雨夜里，林晚发现旧照片背面藏有另一个日期。",
        mainConflict: "照片日期与死亡记录冲突",
      }),
    });
    assert.equal(storyBibleChapter.status, 201);
    const storyBibleDraft = await request<{
      id: string;
      status: string;
      preview: { fields: Array<{ key: string; value: string }> };
    }>("/api/v1/story-bible/change-sets", {
      method: "POST",
      body: JSON.stringify({
        projectId: storyBibleProject.body.id,
        chapterId: storyBibleChapter.body.id,
      }),
    });
    assert.equal(storyBibleDraft.status, 201);
    assert.equal(storyBibleDraft.body.status, "draft");
    assert.ok(
      storyBibleDraft.body.preview.fields.some(
        (field) => field.key === "重要事件",
      ),
      "变更草案必须暴露可审查字段预览",
    );
    const invalidStoryBibleSelection = await request(
      `/api/v1/story-bible/change-sets/${storyBibleDraft.body.id}/apply`,
      {
        method: "POST",
        body: JSON.stringify({ fields: ["不存在的字段"] }),
      },
    );
    assert.equal(invalidStoryBibleSelection.status, 400);
    const appliedStoryBibleSelection = await request<{
      status: string;
    }>(`/api/v1/story-bible/change-sets/${storyBibleDraft.body.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ fields: ["重要事件"] }),
    });
    assert.equal(appliedStoryBibleSelection.status, 200);
    const selectedMemories = await request<
      Array<{ payload: Record<string, unknown> }>
    >(`/api/v1/chapter-memories?projectId=${storyBibleProject.body.id}`);
    assert.equal(selectedMemories.status, 200);
    assert.deepEqual(
      Object.keys(selectedMemories.body[0]?.payload ?? {}).sort(),
      ["关联章节", "来源变更集", "来源章节版本", "重要事件"].sort(),
      "选择性采用不能写入未勾选的 Story Bible 字段",
    );
    const firstEvent = await readSseEvent(0);
    assert.ok(Number.isInteger(firstEvent.id));
    assert.match(firstEvent.frame, /event: project\.created/);
    const replayedEvent = await readSseEvent(firstEvent.id - 1);
    assert.equal(replayedEvent.id, firstEvent.id);
    assert.equal(replayedEvent.frame, firstEvent.frame);
    const sourceImportPath = fileURLToPath(
      new URL(
        "../../../tests/fixtures/lm6/lm6-00/source-import.md",
        import.meta.url,
      ),
    );
    fileCapabilities.set("lm6-source-import", sourceImportPath);
    const sourcePreview = await request<{
      importId: string;
      preview: {
        sourceType: string;
        contentKind: string;
        chapters: Array<{ title: string; content: string }>;
      };
    }>("/api/v1/source-imports/preview", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        capabilityToken: "lm6-source-import",
      }),
    });
    assert.equal(
      sourcePreview.status,
      201,
      `${JSON.stringify(sourcePreview.body)}\n${lastSidecarDiagnostic}`,
    );
    assert.equal(sourcePreview.body.preview.sourceType, "markdown");
    assert.equal(sourcePreview.body.preview.contentKind, "novel");
    assert.deepEqual(
      sourcePreview.body.preview.chapters.map((chapter) => chapter.title),
      ["前言", "第一章 雨夜来信", "第二章 失联电话"],
    );
    const sourceCommit = await request<{
      createdChapters: number;
      checkpointCount: number;
      extractionChangeSet?: {
        id: string;
        status: string;
        candidates: Array<{
          id: string;
          type: string;
          title: string;
          status: string;
          sourceRefs: Array<{ chapterTitle: string; excerpt: string }>;
        }>;
      };
    }>(`/api/v1/source-imports/${sourcePreview.body.importId}/commit`, {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        strategy: "append",
        rightsConfirmed: true,
        destructiveConfirmed: false,
        preview: sourcePreview.body.preview,
      }),
    });
    assert.equal(sourceCommit.status, 201);
    assert.equal(sourceCommit.body.createdChapters, 3);
    assert.equal(sourceCommit.body.checkpointCount, 0);
    const pilotProject = await request<{ id: string }>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        title: "试制状态机项目",
        shortDramaType: "悬疑",
        synopsis: "用于隔离验证 1–3 集试制。",
      }),
    });
    assert.equal(pilotProject.status, 201);
    const pilotChapters = await Promise.all(
      ["试制来源一", "试制来源二", "试制来源三"].map((title, index) =>
        request<{
          id: string;
          title: string;
          content: string;
          summary: string;
          version: number;
        }>("/api/v1/chapters", {
          method: "POST",
          body: JSON.stringify({
            projectId: pilotProject.body.id,
            title,
            content: `第 ${index + 1} 段试制来源正文。`,
            summary: `试制摘要 ${index + 1}`,
          }),
        }),
      ),
    );
    pilotChapters.forEach((chapter) => assert.equal(chapter.status, 201));
    const invalidPilot = await request("/api/v1/pilot-plans", {
      method: "POST",
      body: JSON.stringify({
        projectId: pilotProject.body.id,
        chapterIds: pilotChapters.map((chapter) => chapter.body.id),
        episodeCount: 4,
      }),
    });
    assert.equal(invalidPilot.status, 400);
    const pilot = await request<{
      id: string;
      status: string;
      stage: string;
      episodeCount: number;
      episodeIds: string[];
    }>("/api/v1/pilot-plans", {
      method: "POST",
      body: JSON.stringify({
        projectId: pilotProject.body.id,
        chapterIds: pilotChapters.map((chapter) => chapter.body.id),
        episodeCount: 3,
      }),
    });
    assert.equal(pilot.status, 201);
    assert.equal(pilot.body.stage, "confirm-source");
    const confirmedPilot = await request<{
      status: string;
      stage: string;
      episodeIds: string[];
      coverage: { episodes: number; scripts: number };
    }>(`/api/v1/pilot-plans/${pilot.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "confirm-source" }),
    });
    assert.equal(confirmedPilot.status, 200);
    assert.equal(confirmedPilot.body.status, "active");
    assert.equal(confirmedPilot.body.stage, "script");
    assert.equal(confirmedPilot.body.coverage.episodes, 3);
    const duplicatePilotConfirmation = await request<{
      episodeIds: string[];
    }>(`/api/v1/pilot-plans/${pilot.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "confirm-source" }),
    });
    assert.equal(duplicatePilotConfirmation.status, 200);
    assert.deepEqual(
      duplicatePilotConfirmation.body.episodeIds,
      confirmedPilot.body.episodeIds,
      "重复确认不得新增试制分集",
    );
    const changedPilotSource = pilotChapters[0].body;
    const pilotSourceUpdate = await request(
      `/api/v1/chapters/${changedPilotSource.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: changedPilotSource.title,
          summary: changedPilotSource.summary,
          content: `${changedPilotSource.content}\n试制来源人工修订。`,
          version: changedPilotSource.version,
        }),
      },
    );
    assert.equal(pilotSourceUpdate.status, 200);
    const stalePilots = await request<Array<{ id: string; status: string }>>(
      `/api/v1/projects/${pilotProject.body.id}/pilot-plans`,
    );
    assert.equal(
      stalePilots.body.find((item) => item.id === pilot.body.id)?.status,
      "stale",
    );
    const resumedPilot = await request<{ status: string; stage: string }>(
      `/api/v1/pilot-plans/${pilot.body.id}/action`,
      { method: "POST", body: JSON.stringify({ action: "resume" }) },
    );
    assert.equal(resumedPilot.status, 200);
    assert.equal(resumedPilot.body.status, "draft");
    assert.equal(resumedPilot.body.stage, "confirm-source");
    const extraction = sourceCommit.body.extractionChangeSet;
    assert.ok(extraction, "导入完成后必须创建可审查候选变更集");
    assert.equal(extraction.status, "draft");
    assert.deepEqual(
      new Set(extraction.candidates.map((candidate) => candidate.type)),
      new Set(["character", "scene", "prop", "chapter-summary", "adaptation"]),
    );
    assert.ok(
      extraction.candidates.every(
        (candidate) =>
          candidate.sourceRefs.length > 0 &&
          candidate.sourceRefs[0].chapterTitle &&
          candidate.sourceRefs[0].excerpt,
      ),
      "每条候选都必须能够回溯到原稿章节和文本范围",
    );
    const listedExtractions = await request<
      {
        id: string;
        candidates: typeof extraction.candidates;
        status: string;
      }[]
    >(`/api/v1/projects/${project.body.id}/import-extractions/change-sets`);
    assert.equal(listedExtractions.status, 200);
    assert.equal(listedExtractions.body[0]?.id, extraction.id);
    const exportedPackage = await request<{ content: string }>(
      `/api/v1/exports/projects/${project.body.id}/json`,
    );
    assert.equal(exportedPackage.status, 200);
    assert.equal(
      JSON.parse(exportedPackage.body.content).importExtractions[0]?.id,
      extraction.id,
      "项目包必须携带导入候选变更集",
    );
    const roundTripPath = join(directory, "lm6-04-roundtrip.json");
    writeFileSync(roundTripPath, exportedPackage.body.content, "utf8");
    fileCapabilities.set("lm6-extraction-roundtrip", roundTripPath);
    const extractionPackagePreview = await request<{ id: string }>(
      "/api/v1/project-packages/preview",
      {
        method: "POST",
        body: JSON.stringify({ capabilityToken: "lm6-extraction-roundtrip" }),
      },
    );
    assert.equal(extractionPackagePreview.status, 201);
    const roundTrip = await request<{ project: { id: string } }>(
      `/api/v1/project-packages/${extractionPackagePreview.body.id}/commit`,
      { method: "POST", body: JSON.stringify({ title: "候选变更集回环项目" }) },
    );
    assert.equal(roundTrip.status, 201);
    const roundTripExtractions = await request<
      Array<{ status: string; candidates: Array<{ type: string }> }>
    >(
      `/api/v1/projects/${roundTrip.body.project.id}/import-extractions/change-sets`,
    );
    assert.equal(roundTripExtractions.status, 200);
    assert.equal(roundTripExtractions.body[0]?.status, "draft");
    assert.deepEqual(
      new Set(
        roundTripExtractions.body[0]?.candidates.map((item) => item.type),
      ),
      new Set(["character", "scene", "prop", "chapter-summary", "adaptation"]),
    );
    const characterCandidate = extraction.candidates.find(
      (candidate) => candidate.type === "character",
    );
    const propCandidate = extraction.candidates.find(
      (candidate) => candidate.type === "prop",
    );
    const summaryCandidate = extraction.candidates.find(
      (candidate) => candidate.type === "chapter-summary",
    );
    assert.ok(characterCandidate);
    assert.ok(propCandidate);
    assert.ok(summaryCandidate);
    const manualSameName = await request<{ id: string }>("/api/v1/assets", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: propCandidate.title,
        payload: { 来源: "人工创建，必须被保护" },
      }),
    });
    assert.equal(manualSameName.status, 201);
    const conflictingAdopt = await request(
      `/api/v1/import-extractions/change-sets/${extraction.id}/adopt`,
      {
        method: "POST",
        body: JSON.stringify({ candidateIds: [propCandidate.id] }),
      },
    );
    assert.equal(conflictingAdopt.status, 409);
    const conflictList = await request<
      {
        candidates: Array<{
          id: string;
          status: string;
          conflictNote?: string;
        }>;
      }[]
    >(`/api/v1/projects/${project.body.id}/import-extractions/change-sets`);
    const conflictedProp = conflictList.body[0]?.candidates.find(
      (candidate) => candidate.id === propCandidate.id,
    );
    assert.equal(conflictedProp?.status, "conflict");
    assert.match(conflictedProp?.conflictNote ?? "", /不会覆盖/);
    const adoptedCharacter = await request<{
      status: string;
      candidates: Array<{ id: string; status: string }>;
    }>(`/api/v1/import-extractions/change-sets/${extraction.id}/adopt`, {
      method: "POST",
      body: JSON.stringify({ candidateIds: [characterCandidate.id] }),
    });
    assert.equal(adoptedCharacter.status, 200);
    assert.equal(
      adoptedCharacter.body.candidates.find(
        (candidate) => candidate.id === characterCandidate.id,
      )?.status,
      "adopted",
    );
    const extractedCharacters = await request<
      Array<{
        id: string;
        title: string;
        version: number;
        payload: Record<string, unknown>;
      }>
    >(`/api/v1/characters?projectId=${project.body.id}`);
    const extractedCharacter = extractedCharacters.body.find(
      (item) => item.title === characterCandidate.title,
    );
    assert.ok(extractedCharacter);
    assert.equal(extractedCharacter.payload["来源变更集"], extraction.id);
    const duplicateAdopt = await request(
      `/api/v1/import-extractions/change-sets/${extraction.id}/adopt`,
      {
        method: "POST",
        body: JSON.stringify({ candidateIds: [characterCandidate.id] }),
      },
    );
    assert.equal(duplicateAdopt.status, 400);
    const charactersAfterDuplicate = await request<Array<{ title: string }>>(
      `/api/v1/characters?projectId=${project.body.id}`,
    );
    assert.equal(
      charactersAfterDuplicate.body.filter(
        (item) => item.title === characterCandidate.title,
      ).length,
      1,
      "重复回调不得创建重复实体",
    );
    const importedChapters = await request<
      Array<{ id: string; title: string; content: string; version: number }>
    >(`/api/v1/projects/${project.body.id}/chapters`);
    const sourceChapter = importedChapters.body.find(
      (chapter) =>
        chapter.title === summaryCandidate.sourceRefs[0]?.chapterTitle,
    );
    assert.ok(sourceChapter);
    const updatedSource = await request(
      `/api/v1/chapters/${sourceChapter.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: sourceChapter.title,
          content: `${sourceChapter.content}\n人工补充：来源版本已变化。`,
          summary: "人工摘要",
          version: sourceChapter.version,
        }),
      },
    );
    assert.equal(updatedSource.status, 200);
    const staleAdopt = await request(
      `/api/v1/import-extractions/change-sets/${extraction.id}/adopt`,
      {
        method: "POST",
        body: JSON.stringify({ candidateIds: [summaryCandidate.id] }),
      },
    );
    assert.equal(staleAdopt.status, 409);
    const manuallyChangedCharacter = await request<{
      id: string;
      version: number;
      title: string;
      payload: Record<string, unknown>;
    }>(`/api/v1/characters/${extractedCharacter.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: extractedCharacter.title,
        payload: {
          ...extractedCharacter.payload,
          备注: "人工补充，撤销时必须保留",
        },
        version: extractedCharacter.version,
      }),
    });
    assert.equal(manuallyChangedCharacter.status, 200);
    const protectedUndo = await request<{
      status: string;
      errorMessage?: string;
    }>(`/api/v1/import-extractions/change-sets/${extraction.id}/undo`, {
      method: "POST",
    });
    assert.equal(protectedUndo.status, 200);
    assert.equal(protectedUndo.body.status, "stale");
    assert.match(protectedUndo.body.errorMessage ?? "", /人工修改/);
    const charactersAfterUndo = await request<Array<{ id: string }>>(
      `/api/v1/characters?projectId=${project.body.id}`,
    );
    assert.ok(
      charactersAfterUndo.body.some(
        (item) => item.id === extractedCharacter.id,
      ),
      "撤销必须保护采用后的人工作品",
    );
    const visualAsset = await request<{
      id: string;
      payload: Record<string, unknown>;
    }>("/api/v1/visual-assets", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "林晚·雨夜服装设定",
        payload: {
          资产类型: "角色",
          关联对象: "林晚",
          权利状态: "已授权",
          费用状态: "已核对",
          锁定状态: "未锁定",
        },
      }),
    });
    assert.equal(visualAsset.status, 201);
    assert.equal(visualAsset.body.payload["锁定状态"], "未锁定");
    const adoptedVisualAsset = await request<{
      payload: Record<string, unknown>;
    }>(`/api/v1/visual-assets/${visualAsset.body.id}/adopt`, {
      method: "POST",
    });
    assert.equal(adoptedVisualAsset.status, 200);
    assert.equal(adoptedVisualAsset.body.payload["采用状态"], "已采用");
    const lockedVisualAsset = await request<{
      id: string;
      version: number;
      payload: Record<string, unknown>;
    }>(`/api/v1/visual-assets/${visualAsset.body.id}/lock`, {
      method: "POST",
    });
    assert.equal(lockedVisualAsset.status, 200);
    assert.equal(lockedVisualAsset.body.payload["锁定状态"], "已锁定");
    assert.equal(typeof lockedVisualAsset.body.payload["锁定时间"], "string");
    const exportedProjectPackage = await request<{
      fileName: string;
      content: string;
    }>(`/api/v1/exports/projects/${project.body.id}/json`);
    assert.equal(exportedProjectPackage.status, 200);
    assert.match(exportedProjectPackage.body.fileName, /\.json$/);
    const projectPackagePath = join(directory, "lm6-00-round-trip.json");
    writeFileSync(projectPackagePath, exportedProjectPackage.body.content);
    fileCapabilities.set("lm6-project-package", projectPackagePath);
    const packagePreview = await request<{
      id: string;
      projectTitle: string;
      chapterCount: number;
      resourceCount: number;
    }>("/api/v1/project-packages/preview", {
      method: "POST",
      body: JSON.stringify({ capabilityToken: "lm6-project-package" }),
    });
    assert.equal(packagePreview.status, 201);
    assert.equal(packagePreview.body.projectTitle, "排序契约项目");
    assert.equal(packagePreview.body.chapterCount, 3);
    const packageCommit = await request<{
      project: { id: string; title: string; productionBrief?: string };
      chaptersCreated: number;
      resourcesCreated: number;
    }>(`/api/v1/project-packages/${packagePreview.body.id}/commit`, {
      method: "POST",
      body: JSON.stringify({ title: "排序契约项目（项目包往返）" }),
    });
    assert.equal(packageCommit.status, 201);
    assert.equal(
      packageCommit.body.project.title,
      "排序契约项目（项目包往返）",
    );
    assert.match(
      packageCommit.body.project.productionBrief ?? "",
      /创建路径：从灵感开始/,
    );
    assert.equal(packageCommit.body.chaptersCreated, 3);
    assert.equal(
      packageCommit.body.resourcesCreated,
      packagePreview.body.resourceCount,
    );
    const engines = await request<
      Array<{ kind: string; status: string; isBeta: boolean }>
    >("/api/v1/agent-engines");
    assert.equal(engines.status, 200);
    assert.deepEqual(
      engines.body.map((engine) => engine.kind),
      ["opencode", "codex", "langgraph"],
    );
    assert.equal(
      engines.body.find((engine) => engine.kind === "codex")?.isBeta,
      true,
    );
    const initialGlobalAgentSettings = await request<{
      defaultEngineKind: string;
      defaultModel?: { modelId?: string };
    }>("/api/v1/agent-settings");
    assert.equal(initialGlobalAgentSettings.status, 200);
    assert.equal(initialGlobalAgentSettings.body.defaultEngineKind, "opencode");
    const changedGlobalAgentSettings = await request<{
      defaultEngineKind: string;
      defaultModel?: { modelId?: string };
    }>("/api/v1/agent-settings", {
      method: "PUT",
      body: JSON.stringify({
        defaultEngineKind: "langgraph",
        defaultModel: { modelId: "全局测试模型" },
      }),
    });
    assert.equal(changedGlobalAgentSettings.status, 200);
    assert.equal(
      changedGlobalAgentSettings.body.defaultEngineKind,
      "langgraph",
    );
    assert.equal(
      changedGlobalAgentSettings.body.defaultModel?.modelId,
      "全局测试模型",
    );
    const enginesAfterGlobalChange = await request<
      Array<{ kind: string; isDefault: boolean }>
    >("/api/v1/agent-engines");
    assert.equal(
      enginesAfterGlobalChange.body.find(
        (engine) => engine.kind === "langgraph",
      )?.isDefault,
      true,
    );
    const resetGlobalAgentSettings = await request<{
      defaultEngineKind: string;
    }>("/api/v1/agent-settings", {
      method: "PUT",
      body: JSON.stringify({ defaultEngineKind: "opencode" }),
    });
    assert.equal(resetGlobalAgentSettings.body.defaultEngineKind, "opencode");
    const agentTasks = await request<Array<{ id: string; label: string }>>(
      "/api/v1/agent-tasks",
    );
    assert.equal(agentTasks.status, 200);
    assert.ok(agentTasks.body.length >= 69);
    assert.equal(
      agentTasks.body.find((item) => item.id === "chapter_revision")?.label,
      "章节修订预览",
    );
    assert.equal(
      agentTasks.body.find((item) => item.id === "plan_remote_render")?.label,
      "规划远程成片渲染",
    );
    const initialAgentSettings = await request<{
      defaultEngineKind: string;
      assistantMode: string;
    }>(`/api/v1/projects/${project.body.id}/agent-settings`);
    assert.equal(initialAgentSettings.status, 200);
    assert.equal(initialAgentSettings.body.defaultEngineKind, "opencode");
    assert.equal(initialAgentSettings.body.assistantMode, "simple");
    const codexSettings = await request<{
      defaultEngineKind: string;
      assistantMode: string;
    }>(`/api/v1/projects/${project.body.id}/agent-settings`, {
      method: "PUT",
      body: JSON.stringify({
        defaultEngineKind: "codex",
        assistantMode: "advanced",
      }),
    });
    assert.equal(codexSettings.status, 200);
    assert.equal(codexSettings.body.assistantMode, "advanced");
    const noFallbackSession = await request<{ code: string; message: string }>(
      "/api/v1/agent-sessions",
      {
        method: "POST",
        body: JSON.stringify({ projectId: project.body.id }),
      },
    );
    assert.equal(noFallbackSession.status, 503);
    assert.equal(noFallbackSession.body.code, "ENGINE_UNAVAILABLE");
    assert.match(noFallbackSession.body.message, /Codex/);
    codexShouldFailForNoFallbackTest = false;
    const restoredAgentSettings = await request<{
      defaultEngineKind: string;
      assistantMode: string;
    }>(`/api/v1/projects/${project.body.id}/agent-settings`, {
      method: "PUT",
      body: JSON.stringify({ defaultEngineKind: "opencode" }),
    });
    assert.equal(restoredAgentSettings.body.defaultEngineKind, "opencode");
    assert.equal(restoredAgentSettings.body.assistantMode, "advanced");
    const agentChapter = await request<{
      id: string;
      version: number;
      content: string;
    }>("/api/v1/chapters", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "智能修订测试章节",
        summary: "主角收到一封秘密来信。",
        content: "雨夜，主角在门口发现秘密来信。",
      }),
    });
    assert.equal(agentChapter.status, 201);
    const rejectedTask = await request<{ code: string }>("/api/v1/tasks", {
      method: "POST",
      headers: { "Idempotency-Key": "unsupported-task-contract" },
      body: JSON.stringify({
        kind: "未支持任务",
        title: "不应永远排队",
        projectId: project.body.id,
      }),
    });
    assert.equal(rejectedTask.status, 409);
    assert.equal(rejectedTask.body.code, "TASK_REJECTED");
    const adaptation = await request<{ id: string }>("/api/v1/adaptations", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "第一版改编",
        payload: {},
      }),
    });
    assert.equal(adaptation.status, 201);
    const selected = await request<{ currentAdaptationId?: string }>(
      `/api/v1/projects/${project.body.id}/current-adaptation`,
      {
        method: "POST",
        body: JSON.stringify({ adaptationId: adaptation.body.id }),
      },
    );
    assert.equal(selected.status, 200);
    assert.equal(selected.body.currentAdaptationId, adaptation.body.id);
    const createEpisode = (title: string) =>
      request<{ id: string; version: number }>("/api/v1/episodes", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          parentId: adaptation.body.id,
          title,
          payload: {},
        }),
      });
    const first = await createEpisode("第 1 集");
    const second = await createEpisode("第 2 集");
    const reordered = await request<{
      records: Array<{
        id: string;
        version: number;
        payload: Record<string, unknown>;
      }>;
    }>(`/api/v1/adaptations/${adaptation.body.id}/episodes/reorder`, {
      method: "POST",
      body: JSON.stringify({
        items: [
          { id: second.body.id, version: second.body.version },
          { id: first.body.id, version: first.body.version },
        ],
      }),
    });
    assert.equal(reordered.status, 200);
    assert.deepEqual(
      reordered.body.records.map((item) => item.id),
      [second.body.id, first.body.id],
    );
    assert.equal(reordered.body.records[0]?.payload["排序"], 1);
    const episodeAnalysis = await request<{
      episodeCount: number;
      overallScore: number;
    }>(`/api/v1/adaptations/${adaptation.body.id}/episode-analysis`, {
      method: "POST",
    });
    assert.equal(episodeAnalysis.status, 200);
    assert.equal(episodeAnalysis.body.episodeCount, 2);
    assert.equal(episodeAnalysis.body.overallScore, 0);
    const stale = await request<{ code: string }>(
      `/api/v1/adaptations/${adaptation.body.id}/episodes/reorder`,
      {
        method: "POST",
        body: JSON.stringify({
          items: [
            { id: first.body.id, version: first.body.version },
            { id: second.body.id, version: second.body.version },
          ],
        }),
      },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "CONFLICT");
    const script = await request<{ id: string }>("/api/v1/scripts", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        parentId: first.body.id,
        title: "第 1 集剧本",
        payload: {
          剧本内容:
            "雨夜，主角在门口发现秘密来信。主角：这封信不能让任何人看见。结尾留下新的危机。",
        },
      }),
    });
    const scene = await request<{ id: string }>("/api/v1/scenes", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        parentId: script.body.id,
        title: "雨夜门口",
        payload: { 场景动作: "主角在雨中拆开信件。" },
      }),
    });
    const shot = await request<{ id: string }>("/api/v1/shots", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        parentId: scene.body.id,
        title: "信件特写",
        payload: {
          镜头描述: "竖屏特写，雨滴落在信封上。",
          生成提示: "雨夜信封特写，竖屏构图，冷色光线",
        },
      }),
    });
    const secondVisualAsset = await request<{
      id: string;
      version: number;
    }>("/api/v1/visual-assets", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "林晚·雨夜服装设定 v2",
        payload: {
          资产类型: "角色",
          关联对象: "林晚",
          资产版本: "v2",
          权利状态: "已授权",
          费用状态: "未知",
          服务状态: "不可用",
          锁定状态: "未锁定",
        },
      }),
    });
    assert.equal(secondVisualAsset.status, 201);
    const previewFilePath = fileURLToPath(
      new URL(
        "../../../tests/fixtures/lm6/lm6-10/asset-preview.svg",
        import.meta.url,
      ),
    );
    fileCapabilities.set("lm6-10-preview", previewFilePath);
    const previewVisualAsset = await request<{ id: string }>(
      "/api/v1/visual-assets",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          title: "旧相机道具参考",
          capabilityToken: "lm6-10-preview",
          payload: { 资产类型: "道具", 关联对象: "旧相机" },
        }),
      },
    );
    assert.equal(previewVisualAsset.status, 201);
    const previewMedia = await request<{ kind: string; dataUrl: string }>(
      `/api/v1/asset-center/${previewVisualAsset.body.id}/preview`,
    );
    assert.equal(previewMedia.status, 200);
    assert.equal(previewMedia.body.kind, "image");
    assert.match(previewMedia.body.dataUrl, /^data:image\/svg\+xml;base64,/);
    const assetCenterBeforeMigration = await request<{
      assets: Array<{
        id: string;
        category: string;
        rightsStatus: string;
        costStatus: string;
        providerStatus: string;
        lockStatus: string;
        version: number;
        usages: Array<{ shotId: string }>;
      }>;
    }>(`/api/v1/projects/${project.body.id}/asset-center`);
    assert.equal(assetCenterBeforeMigration.status, 200);
    const lockedVersion = assetCenterBeforeMigration.body.assets.find(
      (asset) => asset.id === lockedVisualAsset.body.id,
    );
    const v2 = assetCenterBeforeMigration.body.assets.find(
      (asset) => asset.id === secondVisualAsset.body.id,
    );
    assert.equal(lockedVersion?.category, "character");
    assert.equal(v2?.rightsStatus, "verified");
    assert.equal(v2?.costStatus, "unknown");
    assert.equal(v2?.providerStatus, "unavailable");
    const blockedAdoption = await request<{ code: string }>(
      `/api/v1/asset-center/${secondVisualAsset.body.id}/action`,
      {
        method: "POST",
        body: JSON.stringify({ action: "adopt", version: v2?.version }),
      },
    );
    assert.equal(blockedAdoption.status, 409);
    const assignedLockedVersion = await request<{
      assets: Array<{
        id: string;
        usages: Array<{ shotId: string }>;
        version: number;
      }>;
    }>(`/api/v1/asset-center/${lockedVisualAsset.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: "assign-shot",
        version: lockedVersion?.version,
        shotId: shot.body.id,
      }),
    });
    assert.equal(assignedLockedVersion.status, 200);
    assert.ok(
      assignedLockedVersion.body.assets
        .find((asset) => asset.id === lockedVisualAsset.body.id)
        ?.usages.some((usage) => usage.shotId === shot.body.id),
    );
    const protectedDelete = await request<never>(
      `/api/v1/visual-assets/${lockedVisualAsset.body.id}`,
      { method: "DELETE" },
    );
    assert.equal(protectedDelete.status, 409);
    const currentLocked = assignedLockedVersion.body.assets.find(
      (asset) => asset.id === lockedVisualAsset.body.id,
    );
    const unlocked = await request<{
      assets: Array<{ id: string; version: number }>;
    }>(`/api/v1/asset-center/${lockedVisualAsset.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: "unlock",
        version: currentLocked?.version,
      }),
    });
    assert.equal(unlocked.status, 200);
    const currentV2 = unlocked.body.assets.find(
      (asset) => asset.id === secondVisualAsset.body.id,
    );
    const adoptedV2 = await request<{
      assets: Array<{
        id: string;
        version: number;
        adopted: boolean;
        lockStatus: string;
      }>;
    }>(`/api/v1/asset-center/${secondVisualAsset.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "adopt", version: currentV2?.version }),
    });
    assert.equal(adoptedV2.status, 200);
    const adoptedV2Entry = adoptedV2.body.assets.find(
      (asset) => asset.id === secondVisualAsset.body.id,
    );
    assert.equal(adoptedV2Entry?.adopted, true);
    const lockedV2 = await request<{
      assets: Array<{ id: string; version: number; lockStatus: string }>;
    }>(`/api/v1/asset-center/${secondVisualAsset.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: "lock",
        version: adoptedV2Entry?.version,
      }),
    });
    assert.equal(lockedV2.status, 200);
    const lockedV2Entry = lockedV2.body.assets.find(
      (asset) => asset.id === secondVisualAsset.body.id,
    );
    assert.equal(lockedV2Entry?.lockStatus, "locked");
    const oldVersion = lockedV2.body.assets.find(
      (asset) => asset.id === lockedVisualAsset.body.id,
    );
    const removedUsage = await request<{
      assets: Array<{ id: string; version: number }>;
    }>(`/api/v1/asset-center/${lockedVisualAsset.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: "remove-shot",
        version: oldVersion?.version,
        shotId: shot.body.id,
      }),
    });
    assert.equal(removedUsage.status, 200);
    const removableOldVersion = await request<never>(
      `/api/v1/visual-assets/${lockedVisualAsset.body.id}`,
      { method: "DELETE" },
    );
    assert.equal(removableOldVersion.status, 204);
    const caseStudy = await request<{ id: string; version: number }>(
      "/api/v1/creative/case-studies",
      {
        method: "POST",
        body: JSON.stringify({
          title: "悬疑开场案例",
          genre: "都市悬疑",
          openingHooks: ["开场出现无法解释的物证"],
          reversalMechanisms: ["主角先知道部分真相"],
        }),
      },
    );
    assert.equal(caseStudy.status, 201);
    const updatedCaseStudy = await request<{ id: string; version: number }>(
      `/api/v1/creative/case-studies/${caseStudy.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: "悬疑开场案例（已核对）",
          version: caseStudy.body.version,
        }),
      },
    );
    assert.equal(updatedCaseStudy.status, 200);
    assert.equal(updatedCaseStudy.body.version, caseStudy.body.version + 1);
    const staleCaseStudy = await request<{ code: string }>(
      `/api/v1/creative/case-studies/${caseStudy.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: "不应保存的旧修改",
          version: caseStudy.body.version,
        }),
      },
    );
    assert.equal(staleCaseStudy.status, 409);
    assert.equal(staleCaseStudy.body.code, "CONFLICT");
    const creativeRun = await request<{
      task: { status: string };
      diagnostics: Array<{ id: string; kind: string; findings: string[] }>;
    }>("/api/v1/creative/diagnostics", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        targetKind: "script",
        targetId: script.body.id,
        kinds: [
          "freshness",
          "anti_trope",
          "quality_gate",
          "audience",
          "narrative_curve",
        ],
        caseStudyIds: [caseStudy.body.id],
      }),
    });
    assert.equal(creativeRun.status, 201);
    assert.equal(creativeRun.body.task.status, "succeeded");
    assert.equal(creativeRun.body.diagnostics.length, 5);
    const qualityDiagnostic = creativeRun.body.diagnostics.find(
      (item) => item.kind === "quality_gate",
    );
    const qualityIssue = qualityDiagnostic?.findings[0];
    assert.ok(qualityIssue);
    const acknowledged = await request<{ disposition: string }>(
      "/api/v1/creative/issue-acknowledgements",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          diagnosticId: qualityDiagnostic!.id,
          issueKey: qualityIssue,
          disposition: "accepted",
          actorLabel: "测试用户",
        }),
      },
    );
    assert.equal(acknowledged.status, 201);
    assert.equal(acknowledged.body.disposition, "accepted");
    const creativeDiagnostics = await request<Array<{ id: string }>>(
      `/api/v1/projects/${project.body.id}/creative-diagnostics`,
    );
    assert.equal(creativeDiagnostics.status, 200);
    assert.equal(creativeDiagnostics.body.length, 5);
    const scriptReview = await request<{ overallScore: number }>(
      `/api/v1/scripts/${script.body.id}/review`,
      { method: "POST" },
    );
    assert.equal(scriptReview.status, 200);
    assert.ok(scriptReview.body.overallScore > 0);
    const shotReview = await request<{ aiVideoDifficulty: string }>(
      `/api/v1/shots/${shot.body.id}/review`,
      { method: "POST" },
    );
    assert.equal(shotReview.status, 200);
    assert.equal(shotReview.body.aiVideoDifficulty, "medium");
    const version = await request<{ version: number; videoPrompt: string }>(
      `/api/v1/shots/${shot.body.id}/prompt-versions`,
      {
        method: "POST",
        body: JSON.stringify({ taskType: "人工快照" }),
      },
    );
    assert.equal(version.status, 201);
    assert.equal(version.body.version, 1);
    assert.match(version.body.videoPrompt, /雨夜信封/);
    const imageProviderConfig = await request<{ id: string }>(
      "/api/v1/providers",
      {
        method: "POST",
        body: JSON.stringify({
          title: "图片服务商测试桩",
          payload: {
            服务类型: "图片",
            服务地址: `http://127.0.0.1:${imageAddress.port}/v1`,
            模型名称: "test-image-model",
            凭据引用: "test-image-credential",
            并发上限: 1,
          },
        }),
      },
    );
    assert.equal(imageProviderConfig.status, 201);
    agentProviderActionId = imageProviderConfig.body.id;
    agentProviderActionShotId = shot.body.id;
    const imageRun = await request<{
      task: { status: string };
      assets: Array<{ id: string }>;
      candidates: Array<{ id: string; parentId?: string }>;
    }>("/api/v1/image-generation/runs", {
      method: "POST",
      headers: { "Idempotency-Key": "image-generation-contract" },
      body: JSON.stringify({
        providerId: imageProviderConfig.body.id,
        projectId: project.body.id,
        shotId: shot.body.id,
        kind: "still",
        prompt: "雨夜信封特写，竖屏构图",
      }),
    });
    assert.equal(imageRun.status, 201);
    assert.equal(imageRun.body.task.status, "succeeded");
    assert.equal(imageRun.body.assets.length, 1);
    assert.equal(imageRun.body.candidates[0]?.parentId, shot.body.id);
    const stableDiffusionProvider = await request<{ id: string }>(
      "/api/v1/providers",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Stable Diffusion 测试桩",
          payload: {
            服务类型: "图片",
            服务地址: `http://127.0.0.1:${imageAddress.port}`,
            调用协议: "Stable Diffusion WebUI",
          },
        }),
      },
    );
    assert.equal(stableDiffusionProvider.status, 201);
    const stableDiffusionConnection = await request<{
      ok: boolean;
      models: string[];
    }>(`/api/v1/providers/${stableDiffusionProvider.body.id}/test-connection`, {
      method: "POST",
    });
    assert.equal(stableDiffusionConnection.status, 200);
    assert.equal(stableDiffusionConnection.body.ok, true);
    assert.deepEqual(stableDiffusionConnection.body.models, ["sdxl-test"]);
    const anthropicProvider = await request<{ id: string }>(
      "/api/v1/providers",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Anthropic 模型测试桩",
          payload: {
            服务类型: "智能模型",
            服务地址: `http://127.0.0.1:${imageAddress.port}/anthropic`,
            调用协议: "Anthropic",
            凭据引用: "test-image-credential",
          },
        }),
      },
    );
    assert.equal(anthropicProvider.status, 201);
    const anthropicConnection = await request<{ models: string[] }>(
      `/api/v1/providers/${anthropicProvider.body.id}/test-connection`,
      { method: "POST" },
    );
    assert.equal(anthropicConnection.status, 200);
    assert.deepEqual(anthropicConnection.body.models, [
      "claude-contract-model",
    ]);
    const googleProvider = await request<{ id: string }>("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify({
        title: "Google 模型测试桩",
        payload: {
          服务类型: "智能模型",
          服务地址: `http://127.0.0.1:${imageAddress.port}/google`,
          调用协议: "Google",
          凭据引用: "test-image-credential",
        },
      }),
    });
    assert.equal(googleProvider.status, 201);
    const googleConnection = await request<{ models: string[] }>(
      `/api/v1/providers/${googleProvider.body.id}/test-connection`,
      { method: "POST" },
    );
    assert.equal(googleConnection.status, 200);
    assert.deepEqual(googleConnection.body.models, ["gemini-contract-model"]);
    const stableDiffusionRun = await request<{
      task: { status: string };
      candidates: Array<{ id: string }>;
    }>("/api/v1/image-generation/runs", {
      method: "POST",
      headers: { "Idempotency-Key": "stable-diffusion-contract" },
      body: JSON.stringify({
        providerId: stableDiffusionProvider.body.id,
        projectId: project.body.id,
        shotId: shot.body.id,
        kind: "still",
        prompt: "雨夜信封特写，竖屏构图",
        negativePrompt: "低清晰度，文字水印",
        size: "1024x1536",
      }),
    });
    assert.equal(stableDiffusionRun.status, 201);
    assert.equal(stableDiffusionRun.body.task.status, "succeeded");
    assert.equal(stableDiffusionRun.body.candidates.length, 1);
    const agentProvider = await request<{ id: string }>("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify({
        title: "智能助手模型测试桩",
        payload: {
          服务类型: "智能模型",
          服务地址: `http://127.0.0.1:${imageAddress.port}/v1`,
          调用协议: "OpenAI 兼容文本",
          模型名称: "test-agent-model",
          凭据引用: "test-image-credential",
        },
      }),
    });
    assert.equal(agentProvider.status, 201);
    const agentActivation = await request<{
      engineAvailable: boolean;
      providerKind: string;
      model: string;
    }>(`/api/v1/providers/${agentProvider.body.id}/activate-for-agent`, {
      method: "POST",
    });
    assert.equal(agentActivation.status, 200);
    assert.equal(agentActivation.body.engineAvailable, true);
    assert.equal(agentActivation.body.providerKind, "openai");
    assert.equal(agentActivation.body.model, "test-agent-model");
    const invalidSameModelExperiment = await request<{ code: string }>(
      "/api/v1/agent-experiments",
      {
        method: "POST",
        headers: { "Idempotency-Key": "same-model-missing-model-contract" },
        body: JSON.stringify({
          projectId: project.body.id,
          chapterId: agentChapter.body.id,
          taskType: "chapter_diagnostic",
          comparisonMode: "same_model",
          confirmedEstimatedCost: true,
        }),
      },
    );
    assert.equal(invalidSameModelExperiment.status, 400);
    const experiment = await request<{
      id: string;
      revealed: boolean;
      comparisonMode: string;
    }>("/api/v1/agent-experiments", {
      method: "POST",
      headers: { "Idempotency-Key": "three-engine-experiment-contract" },
      body: JSON.stringify({
        projectId: project.body.id,
        chapterId: agentChapter.body.id,
        taskType: "chapter_diagnostic",
        prompt: "使用相同快照完成章节诊断",
        comparisonMode: "recommended",
        confirmedEstimatedCost: true,
      }),
    });
    assert.equal(experiment.status, 202);
    assert.equal(experiment.body.revealed, false);
    assert.equal(experiment.body.comparisonMode, "recommended");
    let readyExperiment:
      | {
          status: string;
          error?: string;
          revealed: boolean;
          candidates?: Array<{
            candidate: string;
            engineKind?: string;
            metrics?: {
              completed: boolean;
              inputTokens: number;
              outputTokens: number;
            };
          }>;
        }
      | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await request<typeof readyExperiment>(
        `/api/v1/agent-experiments/${experiment.body.id}`,
      );
      readyExperiment = current.body;
      if (!["queued", "running"].includes(readyExperiment?.status ?? "")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      readyExperiment?.status,
      "ready_for_review",
      `${JSON.stringify(readyExperiment)}\n${lastSidecarDiagnostic}`,
    );
    assert.equal(readyExperiment?.revealed, false);
    assert.equal(readyExperiment?.candidates?.length, 3);
    assert.ok(
      readyExperiment?.candidates?.every(
        (candidate) =>
          candidate.engineKind === undefined && candidate.metrics?.completed,
      ),
    );
    const reviewedExperiment = await request<{
      status: string;
      revealed: boolean;
      candidates: Array<{ engineKind?: string }>;
    }>(`/api/v1/agent-experiments/${experiment.body.id}/review`, {
      method: "POST",
      body: JSON.stringify({ preferredCandidate: "one" }),
    });
    assert.equal(reviewedExperiment.status, 200);
    assert.equal(reviewedExperiment.body.status, "completed");
    assert.equal(reviewedExperiment.body.revealed, true);
    assert.deepEqual(
      new Set(
        reviewedExperiment.body.candidates.map(
          (candidate) => candidate.engineKind,
        ),
      ),
      new Set(["opencode", "codex", "langgraph"]),
    );
    const sameModelExperiment = await request<{
      id: string;
      comparisonMode: string;
      model?: { modelId?: string };
    }>("/api/v1/agent-experiments", {
      method: "POST",
      headers: { "Idempotency-Key": "same-model-experiment-contract" },
      body: JSON.stringify({
        projectId: project.body.id,
        chapterId: agentChapter.body.id,
        taskType: "chapter_diagnostic",
        comparisonMode: "same_model",
        model: { modelId: "test-agent-model" },
        confirmedEstimatedCost: true,
      }),
    });
    assert.equal(sameModelExperiment.status, 202);
    assert.equal(sameModelExperiment.body.comparisonMode, "same_model");
    assert.equal(sameModelExperiment.body.model?.modelId, "test-agent-model");
    let sameModelStatus = "queued";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await request<{ status: string }>(
        `/api/v1/agent-experiments/${sameModelExperiment.body.id}`,
      );
      sameModelStatus = current.body.status;
      if (!["queued", "running"].includes(sameModelStatus)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(sameModelStatus, "ready_for_review");
    const agentSession = await request<{ id: string }>(
      "/api/v1/agent-sessions",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          chapterId: agentChapter.body.id,
        }),
      },
    );
    assert.equal(agentSession.status, 201);
    const agentRun = await request<{ taskId: string; runId: string }>(
      `/api/v1/agent-sessions/${agentSession.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "agent-revision-contract" },
        body: JSON.stringify({ operation: "revision" }),
      },
    );
    assert.equal(agentRun.status, 202);
    let completedAgentTask:
      | {
          status: string;
          result?: {
            revisionPreview?: {
              id: string;
              baseVersion: number;
              proposedContent: string;
              status: string;
            };
          };
        }
      | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tasks = await request<
        Array<{
          id: string;
          status: string;
          result?: {
            revisionPreview?: {
              id: string;
              baseVersion: number;
              proposedContent: string;
              status: string;
            };
          };
        }>
      >("/api/v1/tasks");
      completedAgentTask = tasks.body.find(
        (item) => item.id === agentRun.body.taskId,
      );
      if (completedAgentTask?.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(completedAgentTask?.status, "succeeded");
    const persistedAgentRun = await request<{
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      estimatedCost?: number;
    }>(`/api/v1/agent-runs/${agentRun.body.runId}`);
    assert.equal(persistedAgentRun.status, 200);
    assert.equal(persistedAgentRun.body.inputTokens, 128);
    assert.equal(persistedAgentRun.body.outputTokens, 64);
    assert.equal(persistedAgentRun.body.cachedTokens, 16);
    assert.equal(persistedAgentRun.body.estimatedCost, 0.0025);
    const streamedItems = await request<
      Array<{ type: string; content?: string }>
    >(`/api/v1/agent-runs/${agentRun.body.runId}/items`);
    assert.equal(streamedItems.status, 200);
    assert.ok(
      streamedItems.body.some(
        (item) => item.type === "message" && item.content?.includes("正在生成"),
      ),
    );
    const agentPreview = completedAgentTask?.result?.revisionPreview;
    assert.ok(agentPreview);
    assert.equal(agentPreview.status, "pending");
    assert.match(agentPreview.proposedContent, /不要相信来电的人/);
    const committedAgentPreview = await request<{ ok: boolean }>(
      `/api/v1/revisions/${agentPreview.id}/commit`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "agent-preview-commit-contract" },
        body: JSON.stringify({ version: agentPreview.baseVersion }),
      },
    );
    assert.equal(committedAgentPreview.status, 200);
    assert.equal(committedAgentPreview.body.ok, true);
    const revisedChapter = await request<{ content: string; version: number }>(
      `/api/v1/chapters/${agentChapter.body.id}`,
    );
    assert.equal(revisedChapter.status, 200);
    assert.match(revisedChapter.body.content, /不要相信来电的人/);
    const mcpSession = await request<{ id: string }>("/api/v1/agent-sessions", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        chapterId: agentChapter.body.id,
        engineKind: "opencode",
        taskType: "chapter_diagnostic",
      }),
    });
    const mcpRun = await request<{ taskId: string }>(
      `/api/v1/agent-sessions/${mcpSession.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "mcp-security-run-contract" },
        body: JSON.stringify({
          taskType: "chapter_diagnostic",
          prompt: "工具权限测试",
        }),
      },
    );
    assert.equal(mcpRun.status, 202);
    const callMcp = async (method: string, params?: unknown) => {
      const response = await fetch(`${url}/internal/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-mcp-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomMcpId++,
          method,
          ...(params === undefined ? {} : { params }),
        }),
      });
      return (await response.json()) as Record<string, any>;
    };
    let randomMcpId = 1;
    const mcpTools = await callMcp("tools/list");
    assert.ok(Array.isArray(mcpTools.result?.tools));
    assert.ok(
      mcpTools.result.tools.every((tool: { name: string }) =>
        tool.name.startsWith("dramaip_"),
      ),
    );
    const allowedChapter = await callMcp("tools/call", {
      name: "dramaip_get_chapter",
      arguments: { chapterId: agentChapter.body.id },
    });
    assert.equal(
      allowedChapter.result?.structuredContent.id,
      agentChapter.body.id,
    );
    const crossProject = await callMcp("tools/call", {
      name: "dramaip_get_project",
      arguments: { projectId: "another-project" },
    });
    assert.match(String(crossProject.error?.message), /无权读取其他项目/);
    const forbiddenWrite = await callMcp("tools/call", {
      name: "dramaip_commit_change",
      arguments: { projectId: project.body.id },
    });
    assert.ok(forbiddenWrite.error);
    const changeSession = await request<{ id: string }>(
      "/api/v1/agent-sessions",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          chapterId: agentChapter.body.id,
          engineKind: "opencode",
          taskType: "polish_chapter",
        }),
      },
    );
    assert.equal(changeSession.status, 201);
    const changeRun = await request<{ taskId: string }>(
      `/api/v1/agent-sessions/${changeSession.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "generic-change-preview-contract" },
        body: JSON.stringify({
          taskType: "polish_chapter",
          prompt: "通用变更预览测试",
        }),
      },
    );
    assert.equal(changeRun.status, 202);
    const queuedTasks =
      await request<Array<{ id: string; status: string }>>("/api/v1/tasks");
    assert.equal(
      queuedTasks.body.find((task) => task.id === changeRun.body.taskId)
        ?.status,
      "queued",
    );
    let genericChangePreview:
      { id: string; status: string; targets: unknown[] } | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tasks = await request<
        Array<{
          id: string;
          status: string;
          result?: {
            changePreview?: {
              id: string;
              status: string;
              targets: unknown[];
            };
          };
        }>
      >("/api/v1/tasks");
      const item = tasks.body.find((task) => task.id === changeRun.body.taskId);
      genericChangePreview = item?.result?.changePreview;
      if (!item || !["queued", "running"].includes(item.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(genericChangePreview);
    assert.equal(genericChangePreview.status, "pending");
    assert.equal(genericChangePreview.targets.length, 1);
    const concurrentChapterChange = await request<{ version: number }>(
      `/api/v1/chapters/${agentChapter.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: revisedChapter.body.version,
          summary: "并发修改，用于验证通用预览的乐观锁。",
        }),
      },
    );
    assert.equal(concurrentChapterChange.status, 200);
    const conflictedChange = await request<{ code: string }>(
      `/api/v1/change-previews/${genericChangePreview.id}/commit`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "generic-change-conflict-contract" },
      },
    );
    assert.equal(conflictedChange.status, 409);
    assert.equal(conflictedChange.body.code, "CONFLICT");

    const pacingScript = await request<{
      id: string;
      title: string;
      version: number;
      payload: Record<string, unknown>;
    }>(`/api/v1/scripts/${script.body.id}`);
    assert.equal(pacingScript.status, 200);
    const pacingSession = await request<{ id: string }>(
      "/api/v1/agent-sessions",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          engineKind: "opencode",
          taskType: "rewrite_ai_drama_script",
        }),
      },
    );
    assert.equal(pacingSession.status, 201);
    const pacingRun = await request<{ taskId: string }>(
      `/api/v1/agent-sessions/${pacingSession.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "pacing-change-preview-contract" },
        body: JSON.stringify({
          taskType: "rewrite_ai_drama_script",
          prompt: [
            "节奏修订预览测试",
            `目标剧本 ID：${pacingScript.body.id}；基础版本：${pacingScript.body.version}；来源 ID：pacing-shot；来源版本：1。`,
            "完整原 payload 已作为 target.scriptPayload 附在上下文中；必须保留未修改字段。",
          ].join("\n"),
          target: {
            scriptPayload: pacingScript.body.payload,
          },
        }),
      },
    );
    assert.equal(pacingRun.status, 202);
    let pacingPreview:
      { id: string; status: string; targets: unknown[] } | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tasks = await request<
        Array<{
          id: string;
          status: string;
          result?: {
            changePreview?: {
              id: string;
              status: string;
              targets: unknown[];
            };
          };
        }>
      >("/api/v1/tasks");
      const item = tasks.body.find((task) => task.id === pacingRun.body.taskId);
      pacingPreview = item?.result?.changePreview;
      if (!item || !["queued", "running"].includes(item.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(pacingPreview);
    assert.equal(pacingPreview.status, "pending");
    const adoptedPacingPreview = await request<{ status: string }>(
      `/api/v1/change-previews/${pacingPreview.id}/commit`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "pacing-change-preview-adopt" },
      },
    );
    assert.equal(adoptedPacingPreview.status, 200);
    assert.equal(adoptedPacingPreview.body.status, "committed");
    const pacingCheckpoints = await request<
      Array<{ id: string; parentId?: string; payload: Record<string, unknown> }>
    >(`/api/v1/projects/${project.body.id}/content-versions`);
    const pacingCheckpoint = pacingCheckpoints.body.find(
      (item) =>
        item.parentId === script.body.id &&
        item.payload["来源"] === "节奏修订预览采用前检查点",
    );
    assert.ok(pacingCheckpoint);
    const restoredPacingScript = await request<{
      payload: Record<string, unknown>;
    }>(`/api/v1/scripts/${script.body.id}`);
    assert.match(
      String(restoredPacingScript.body.payload["剧本内容"]),
      /没有立刻打开/,
    );
    const restoredPacingCheckpoint = await request<{ targetId: string }>(
      `/api/v1/content-versions/${pacingCheckpoint.id}/restore`,
      { method: "POST" },
    );
    assert.equal(restoredPacingCheckpoint.status, 200);
    assert.equal(restoredPacingCheckpoint.body.targetId, script.body.id);
    const revertedPacingScript = await request<{
      payload: Record<string, unknown>;
    }>(`/api/v1/scripts/${script.body.id}`);
    assert.equal(
      revertedPacingScript.body.payload["剧本内容"],
      pacingScript.body.payload["剧本内容"],
    );

    const providerPreviewSession = await request<{ id: string }>(
      "/api/v1/agent-sessions",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          chapterId: agentChapter.body.id,
          engineKind: "opencode",
          taskType: "generate_video_asset_drafts",
        }),
      },
    );
    assert.equal(providerPreviewSession.status, 201);
    const providerPreviewRun = await request<{ taskId: string }>(
      `/api/v1/agent-sessions/${providerPreviewSession.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "provider-preview-agent-contract" },
        body: JSON.stringify({
          taskType: "generate_video_asset_drafts",
          prompt: "厂商预览测试",
        }),
      },
    );
    assert.equal(providerPreviewRun.status, 202);
    let providerActionPreview:
      { id: string; status: string; estimatedCost?: number } | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tasks = await request<
        Array<{
          id: string;
          status: string;
          result?: {
            providerActionPreview?: {
              id: string;
              status: string;
              estimatedCost?: number;
            };
          };
        }>
      >("/api/v1/tasks");
      const item = tasks.body.find(
        (task) => task.id === providerPreviewRun.body.taskId,
      );
      providerActionPreview = item?.result?.providerActionPreview;
      if (!item || !["queued", "running"].includes(item.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(providerActionPreview);
    assert.equal(providerActionPreview.status, "pending");
    assert.equal(providerActionPreview.estimatedCost, 0.12);
    const executedProviderTask = await request<{
      id: string;
      status: string;
    }>(`/api/v1/provider-action-previews/${providerActionPreview.id}/execute`, {
      method: "POST",
      headers: { "Idempotency-Key": "provider-preview-execute-contract" },
    });
    assert.equal(executedProviderTask.status, 202);
    assert.equal(executedProviderTask.body.status, "queued");
    let providerTaskStatus = "queued";
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tasks =
        await request<Array<{ id: string; status: string }>>("/api/v1/tasks");
      providerTaskStatus =
        tasks.body.find((task) => task.id === executedProviderTask.body.id)
          ?.status ?? "missing";
      if (providerTaskStatus !== "queued") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      providerTaskStatus,
      "failed",
      "未携带静帧预检快照的厂商预览不得绕过视频门禁",
    );
    assert.equal(videoProviderCalls, 0, "门禁失败前不得调用视频服务商");
    const replayedProviderTask = await request<{ id: string }>(
      `/api/v1/provider-action-previews/${providerActionPreview.id}/execute`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "provider-preview-execute-contract" },
      },
    );
    assert.equal(replayedProviderTask.status, 202);
    assert.equal(replayedProviderTask.body.id, executedProviderTask.body.id);
    const discardProviderRun = await request<{ taskId: string }>(
      `/api/v1/agent-sessions/${providerPreviewSession.body.id}/runs`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "provider-preview-discard-run-contract" },
        body: JSON.stringify({
          taskType: "plan_video_generation",
          prompt: "厂商预览测试（放弃）",
        }),
      },
    );
    assert.equal(discardProviderRun.status, 202);
    let providerActionToDiscard: { id: string; status: string } | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tasks = await request<
        Array<{
          id: string;
          status: string;
          result?: {
            providerActionPreview?: { id: string; status: string };
          };
        }>
      >("/api/v1/tasks");
      const item = tasks.body.find(
        (task) => task.id === discardProviderRun.body.taskId,
      );
      providerActionToDiscard = item?.result?.providerActionPreview;
      if (!item || !["queued", "running"].includes(item.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(providerActionToDiscard);
    const discardedProviderAction = await request<{ status: string }>(
      `/api/v1/provider-action-previews/${providerActionToDiscard.id}/discard`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "provider-preview-discard-contract" },
      },
    );
    assert.equal(discardedProviderAction.status, 200);
    assert.equal(discardedProviderAction.body.status, "discarded");
    const disposablePreview = await request<{ id: string }>(
      "/api/v1/revisions",
      {
        method: "POST",
        headers: { "Idempotency-Key": "discard-preview-create-contract" },
        body: JSON.stringify({
          chapterId: agentChapter.body.id,
          proposedContent: "不应提交的候选正文。",
          rationale: "用于验证放弃预览。",
        }),
      },
    );
    assert.equal(disposablePreview.status, 201);
    const discardedPreview = await request<{ status: string }>(
      `/api/v1/revisions/${disposablePreview.body.id}/discard`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "discard-preview-contract" },
      },
    );
    assert.equal(discardedPreview.status, 200);
    assert.equal(discardedPreview.body.status, "discarded");
    const blockedVideo = await request<{ code: string }>(
      "/api/v1/video-generation/runs",
      {
        method: "POST",
        headers: { "Idempotency-Key": "video-generation-blocked-contract" },
        body: JSON.stringify({
          providerId: imageProviderConfig.body.id,
          projectId: project.body.id,
          episodeId: first.body.id,
          shotId: shot.body.id,
          prompt: "雨夜信封特写，竖屏构图，冷色光线",
          seconds: 5,
        }),
      },
    );
    assert.equal(blockedVideo.status, 409);
    assert.equal(blockedVideo.body.code, "VIDEO_NOT_READY");
    assert.equal(videoProviderCalls, 0, "负向视频请求不能触发厂商调用");

    const videoReadyAsset = await request<{
      id: string;
      version: number;
    }>("/api/v1/visual-assets", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "视频门禁·林晚雨夜服装",
        payload: {
          资产类型: "角色",
          关联对象: "林晚视频造型",
          权利状态: "已授权",
          费用状态: "已核对",
          服务状态: "可用",
          锁定状态: "未锁定",
        },
      }),
    });
    assert.equal(videoReadyAsset.status, 201);
    const adoptedVideoReadyAsset = await request<{
      id: string;
      version: number;
    }>(`/api/v1/visual-assets/${videoReadyAsset.body.id}/adopt`, {
      method: "POST",
    });
    assert.equal(adoptedVideoReadyAsset.status, 200);
    const lockedVideoReadyAsset = await request<{
      assets: Array<{ id: string; version: number }>;
    }>(`/api/v1/asset-center/${videoReadyAsset.body.id}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: "lock",
        version: adoptedVideoReadyAsset.body.version,
      }),
    });
    assert.equal(lockedVideoReadyAsset.status, 200);
    const lockedVideoReadyAssetVersion = lockedVideoReadyAsset.body.assets.find(
      (asset) => asset.id === videoReadyAsset.body.id,
    )?.version;
    assert.ok(lockedVideoReadyAssetVersion);
    const assignedVideoReadyAsset = await request<unknown>(
      `/api/v1/asset-center/${videoReadyAsset.body.id}/action`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "assign-shot",
          version: lockedVideoReadyAssetVersion,
          shotId: shot.body.id,
        }),
      },
    );
    assert.equal(assignedVideoReadyAsset.status, 200);
    const shotForVideo = await request<{
      title: string;
      version: number;
      payload: Record<string, unknown>;
    }>(`/api/v1/shots/${shot.body.id}`);
    const videoBaselineShot = await request<{ version: number }>(
      `/api/v1/shots/${shot.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: shotForVideo.body.title,
          version: shotForVideo.body.version,
          payload: { ...shotForVideo.body.payload, 时长: 5 },
        }),
      },
    );
    assert.equal(videoBaselineShot.status, 200);
    const adoptedStill = await request<{ id: string }>(
      `/api/v1/shot-stills/${imageRun.body.candidates[0]!.id}/adopt`,
      { method: "POST" },
    );
    assert.equal(adoptedStill.status, 200);
    const videoPreflight = await request<{
      ready: boolean;
      snapshotHash: string;
      lockedAssetIds: string[];
      adoptedStillId?: string;
      costStatus: string;
    }>(`/api/v1/shots/${shot.body.id}/video-generation/preflight`, {
      method: "POST",
      body: JSON.stringify({
        providerId: imageProviderConfig.body.id,
        projectId: project.body.id,
        episodeId: first.body.id,
        shotId: shot.body.id,
        prompt: "雨夜信封特写，竖屏构图，冷色光线",
        seconds: 5,
        confirmUnknownCost: true,
      }),
    });
    assert.equal(videoPreflight.status, 200);
    assert.equal(videoPreflight.body.ready, true);
    assert.equal(
      videoPreflight.body.adoptedStillId,
      imageRun.body.candidates[0]?.id,
    );
    assert.ok(
      videoPreflight.body.lockedAssetIds.includes(videoReadyAsset.body.id),
    );
    assert.equal(videoPreflight.body.costStatus, "unknown");
    const changedPromptPreflight = await request<{
      ready: boolean;
      blockers: string[];
    }>(`/api/v1/shots/${shot.body.id}/video-generation/preflight`, {
      method: "POST",
      body: JSON.stringify({
        providerId: imageProviderConfig.body.id,
        projectId: project.body.id,
        episodeId: first.body.id,
        shotId: shot.body.id,
        prompt: "改写后的镜头提示不得静默继承旧静帧",
        seconds: 5,
        confirmUnknownCost: true,
      }),
    });
    assert.equal(changedPromptPreflight.status, 200);
    assert.equal(changedPromptPreflight.body.ready, false);
    assert.ok(
      changedPromptPreflight.body.blockers.some((item) =>
        item.includes("偏离"),
      ),
    );
    const unconfirmedCostPreflight = await request<{
      ready: boolean;
      blockers: string[];
    }>(`/api/v1/shots/${shot.body.id}/video-generation/preflight`, {
      method: "POST",
      body: JSON.stringify({
        providerId: imageProviderConfig.body.id,
        projectId: project.body.id,
        episodeId: first.body.id,
        shotId: shot.body.id,
        prompt: "雨夜信封特写，竖屏构图，冷色光线",
        seconds: 5,
      }),
    });
    assert.equal(unconfirmedCostPreflight.status, 200);
    assert.equal(unconfirmedCostPreflight.body.ready, false);
    assert.ok(
      unconfirmedCostPreflight.body.blockers.some((item) =>
        item.includes("费用未知"),
      ),
    );
    const videoBatchPreflight = await request<{
      ready: boolean;
      unknownCostCount: number;
      blockers: string[];
      items: Array<{ ready: boolean }>;
    }>(`/api/v1/projects/${project.body.id}/video-generation/batch-preflight`, {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        submissions: [
          {
            providerId: imageProviderConfig.body.id,
            projectId: project.body.id,
            episodeId: first.body.id,
            shotId: shot.body.id,
            prompt: "雨夜信封特写，竖屏构图，冷色光线",
            seconds: 5,
            confirmUnknownCost: true,
          },
          {
            providerId: imageProviderConfig.body.id,
            projectId: project.body.id,
            episodeId: first.body.id,
            shotId: shot.body.id,
            prompt: "雨夜信封特写，竖屏构图，冷色光线",
            seconds: 5,
            confirmUnknownCost: true,
          },
        ],
      }),
    });
    assert.equal(videoBatchPreflight.status, 200);
    assert.equal(videoBatchPreflight.body.ready, false);
    assert.equal(videoBatchPreflight.body.unknownCostCount, 2);
    assert.ok(videoBatchPreflight.body.items.every((item) => !item.ready));
    assert.ok(
      videoBatchPreflight.body.blockers.some((item) =>
        item.includes("批量并发上限"),
      ),
    );

    const videoRun = await request<{
      id: string;
      status: string;
      taskId: string;
    }>("/api/v1/video-generation/runs", {
      method: "POST",
      headers: { "Idempotency-Key": "video-generation-contract" },
      body: JSON.stringify({
        providerId: imageProviderConfig.body.id,
        projectId: project.body.id,
        episodeId: first.body.id,
        shotId: shot.body.id,
        prompt: "雨夜信封特写，竖屏构图，冷色光线",
        seconds: 5,
        confirmUnknownCost: true,
        readinessHash: videoPreflight.body.snapshotHash,
      }),
    });
    assert.equal(videoRun.status, 201);
    assert.equal(videoRun.body.status, "running");
    assert.equal(videoProviderCalls, 1, "通过预检后才允许发起一次视频调用");
    const replayedVideoRun = await request<{ id: string }>(
      "/api/v1/video-generation/runs",
      {
        method: "POST",
        headers: { "Idempotency-Key": "video-generation-contract" },
        body: JSON.stringify({
          providerId: imageProviderConfig.body.id,
          projectId: project.body.id,
          episodeId: first.body.id,
          shotId: shot.body.id,
          prompt: "雨夜信封特写，竖屏构图，冷色光线",
          seconds: 5,
          confirmUnknownCost: true,
          readinessHash: videoPreflight.body.snapshotHash,
        }),
      },
    );
    assert.equal(replayedVideoRun.status, 201);
    assert.equal(replayedVideoRun.body.id, videoRun.body.id);
    assert.equal(videoProviderCalls, 1, "幂等重放不得重复调用视频服务商");
    const videoLedger = await request<
      Array<{ taskId?: string; kind: string; summary: string }>
    >(`/api/v1/projects/${project.body.id}/generation-ledger`);
    const videoLedgerRecord = videoLedger.body.find(
      (item) => item.taskId === videoRun.body.taskId,
    );
    assert.equal(videoLedgerRecord?.kind, "视频生成");
    assert.match(videoLedgerRecord?.summary ?? "", /费用未知已由用户确认/);
    const refreshedVideo = await request<{
      status: string;
      results: Array<{
        id: string;
        parentId?: string;
        payload: Record<string, unknown>;
      }>;
    }>(`/api/v1/video-generation/runs/${videoRun.body.id}/refresh`, {
      method: "POST",
    });
    assert.equal(refreshedVideo.status, 200);
    assert.equal(refreshedVideo.body.status, "succeeded");
    assert.equal(refreshedVideo.body.results[0]?.parentId, shot.body.id);
    const adoptedVideo = await request<{
      payload: Record<string, unknown>;
    }>(`/api/v1/videos/${refreshedVideo.body.results[0]!.id}/adopt`, {
      method: "POST",
    });
    assert.equal(adoptedVideo.status, 200);
    assert.equal(adoptedVideo.body.payload["采用状态"], "已采用");
    const videoAfterAdoption = await request<{
      results: Array<{ payload: Record<string, unknown> }>;
    }>(`/api/v1/video-generation/runs/${videoRun.body.id}`);
    assert.equal(
      videoAfterAdoption.body.results[0]?.payload["采用状态"],
      "已采用",
    );
    const retriedVideo = await request<{
      taskId: string;
      status: string;
    }>(`/api/v1/video-generation/runs/${videoRun.body.id}/retry`, {
      method: "POST",
      headers: { "Idempotency-Key": "video-retry-contract" },
      body: JSON.stringify({}),
    });
    assert.equal(retriedVideo.status, 201);
    assert.equal(retriedVideo.body.status, "running");
    const retriedTask =
      await request<Array<{ id: string; parentTaskId?: string }>>(
        "/api/v1/tasks",
      );
    assert.equal(retriedTask.status, 200);
    assert.equal(
      retriedTask.body.find((task) => task.id === retriedVideo.body.taskId)
        ?.parentTaskId,
      videoRun.body.taskId,
    );
    const voiceProfile = await request<{ id: string; status: string }>(
      "/api/v1/voice-profiles",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          title: "主角旁白音色",
          providerVoice: "zh-CN-demo",
        }),
      },
    );
    assert.equal(voiceProfile.status, 201);
    const adoptedVoice = await request<{ status: string }>(
      `/api/v1/voice-profiles/${voiceProfile.body.id}/adopt`,
      { method: "POST" },
    );
    assert.equal(adoptedVoice.status, 200);
    assert.equal(adoptedVoice.body.status, "adopted");
    const ttsRun = await request<{
      task: { status: string };
      asset: { id: string; parentId?: string };
    }>("/api/v1/tts-generation/runs", {
      method: "POST",
      headers: { "Idempotency-Key": "tts-generation-contract" },
      body: JSON.stringify({
        providerId: imageProviderConfig.body.id,
        projectId: project.body.id,
        episodeId: first.body.id,
        shotId: shot.body.id,
        voiceProfileId: voiceProfile.body.id,
        kind: "narration",
        input: "秘密来信改变了一切。",
        voice: "zh-CN-demo",
        responseFormat: "mp3",
      }),
    });
    assert.equal(ttsRun.status, 201);
    assert.equal(ttsRun.body.task.status, "succeeded");
    assert.equal(ttsRun.body.asset.parentId, first.body.id);
    const audioTrack = await request<{ id: string; stale: boolean }>(
      "/api/v1/audio-tracks",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          episodeId: first.body.id,
          kind: "narration",
          label: "第 1 集旁白草案",
          clips: [
            {
              shotId: shot.body.id,
              assetId: ttsRun.body.asset.id,
              voiceProfileId: voiceProfile.body.id,
              startSeconds: 0,
              durationSeconds: 3,
              text: "秘密来信改变了一切。",
            },
          ],
        }),
      },
    );
    assert.equal(audioTrack.status, 201);
    assert.equal(audioTrack.body.stale, false);
    const adoptedTrack = await request<{ status: string; stale: boolean }>(
      `/api/v1/audio-tracks/${audioTrack.body.id}/adopt`,
      { method: "POST" },
    );
    assert.equal(adoptedTrack.status, 200);
    assert.equal(adoptedTrack.body.status, "adopted");
    const initializedAnimatic = await request<{
      sourceFingerprint: string;
      clips: Array<{ shotId: string; mediaKind: string }>;
    }>(`/api/v1/episodes/${first.body.id}/animatic-initialization`);
    assert.equal(initializedAnimatic.status, 200);
    assert.equal(initializedAnimatic.body.clips.length, 1);
    assert.equal(initializedAnimatic.body.clips[0]?.shotId, shot.body.id);
    const animatic = await request<{
      id: string;
      version: number;
      status: string;
    }>("/api/v1/animatics", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        episodeId: first.body.id,
        sourceFingerprint: initializedAnimatic.body.sourceFingerprint,
        clips: initializedAnimatic.body.clips,
        annotations: "第 1 版节奏草案",
      }),
    });
    assert.equal(animatic.status, 201);
    const reviewedAnimatic = await request<{ status: string }>(
      `/api/v1/animatics/${animatic.body.id}/review`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "approved",
          version: animatic.body.version,
        }),
      },
    );
    assert.equal(reviewedAnimatic.status, 200);
    assert.equal(reviewedAnimatic.body.status, "approved");
    const renderPreflight = await request<{
      ok: boolean;
      blockers: string[];
      audioTrackIds: string[];
    }>(`/api/v1/episodes/${first.body.id}/render-preflight`);
    assert.equal(renderPreflight.status, 200);
    assert.equal(renderPreflight.body.ok, true);
    assert.ok(renderPreflight.body.audioTrackIds.includes(audioTrack.body.id));
    assert.equal(renderPreflight.body.blockers.length, 0);
    const canonicalTimeline = await request<{
      id: string;
      version: number;
      timebase: string;
      durationSeconds: number;
      tracks: Array<{
        kind: string;
        clips: Array<{
          id: string;
          shotId?: string;
          startSeconds: number;
          durationSeconds: number;
          mediaStatus: string;
        }>;
      }>;
    }>(`/api/v1/episodes/${first.body.id}/timeline`);
    assert.equal(canonicalTimeline.status, 200);
    assert.equal(canonicalTimeline.body.timebase, "seconds");
    const reopenedCanonicalTimeline = await request<
      typeof canonicalTimeline.body
    >(`/api/v1/episodes/${first.body.id}/timeline`);
    assert.equal(reopenedCanonicalTimeline.status, 200);
    assert.deepEqual(reopenedCanonicalTimeline.body, canonicalTimeline.body);
    assert.deepEqual(
      canonicalTimeline.body.tracks.map((track) => track.kind),
      ["video", "dialogue", "narration", "bgm", "sfx", "subtitle"],
    );
    const canonicalVideo = canonicalTimeline.body.tracks
      .find((track) => track.kind === "video")!
      .clips.find((clip) => clip.shotId === shot.body.id)!;
    assert.ok(canonicalVideo.id);
    const canonicalNarration = canonicalTimeline.body.tracks.find(
      (track) => track.kind === "narration",
    )!;
    assert.equal(canonicalNarration.clips.length, 1);
    const movedTimeline = await request<{
      version: number;
      tracks: Array<{ kind: string; clips: Array<{ startSeconds: number }> }>;
    }>(`/api/v1/timelines/${canonicalTimeline.body.id}/commands`, {
      method: "POST",
      body: JSON.stringify({
        version: canonicalTimeline.body.version,
        command: {
          type: "move",
          clipId: canonicalVideo.id,
          startSeconds: 1.21,
        },
      }),
    });
    assert.equal(movedTimeline.status, 200);
    assert.equal(
      movedTimeline.body.version,
      canonicalTimeline.body.version + 1,
    );
    assert.equal(
      movedTimeline.body.tracks.find((track) => track.kind === "video")
        ?.clips[0]?.startSeconds,
      1.2,
    );
    const splitTimeline = await request<{
      version: number;
      tracks: Array<{ kind: string; clips: Array<{ id: string }> }>;
    }>(`/api/v1/timelines/${canonicalTimeline.body.id}/commands`, {
      method: "POST",
      body: JSON.stringify({
        version: movedTimeline.body.version,
        command: {
          type: "split",
          clipId: canonicalVideo.id,
          atSeconds: 2.4,
        },
      }),
    });
    assert.equal(splitTimeline.status, 200);
    assert.equal(
      splitTimeline.body.tracks.find((track) => track.kind === "video")?.clips
        .length,
      2,
    );
    const undoTimeline = await request<{
      version: number;
      tracks: Array<{ kind: string; clips: Array<{ id: string }> }>;
    }>(`/api/v1/timelines/${canonicalTimeline.body.id}/undo`, {
      method: "POST",
    });
    assert.equal(undoTimeline.status, 200);
    assert.equal(
      undoTimeline.body.tracks.find((track) => track.kind === "video")?.clips
        .length,
      1,
    );
    const redoTimeline = await request<{
      version: number;
      tracks: Array<{ kind: string; clips: Array<{ id: string }> }>;
    }>(`/api/v1/timelines/${canonicalTimeline.body.id}/redo`, {
      method: "POST",
    });
    assert.equal(redoTimeline.status, 200);
    assert.equal(
      redoTimeline.body.tracks.find((track) => track.kind === "video")?.clips
        .length,
      2,
    );
    const timelineHistory = await request<{
      canUndo: boolean;
      canRedo: boolean;
    }>(`/api/v1/timelines/${canonicalTimeline.body.id}/history`);
    assert.equal(timelineHistory.status, 200);
    assert.equal(timelineHistory.body.canUndo, true);
    assert.equal(timelineHistory.body.canRedo, false);
    const playableTimelineAudio = await request<{ id: string }>(
      "/api/v1/assets",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          title: "可播放时间线短音频",
          payload: {
            file: {
              name: "timeline-tone.wav",
              storedName: "timeline-tone.wav",
            },
          },
        }),
      },
    );
    assert.equal(playableTimelineAudio.status, 201);
    writeFileSync(
      join(directory, "assets", "timeline-tone.wav"),
      Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
        0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
      ]),
    );
    const relinkedTimeline = await request<{
      version: number;
      tracks: Array<{
        kind: string;
        clips: Array<{ assetId?: string; mediaStatus: string }>;
      }>;
    }>(`/api/v1/timelines/${canonicalTimeline.body.id}/commands`, {
      method: "POST",
      body: JSON.stringify({
        version: redoTimeline.body.version,
        command: {
          type: "relink",
          clipId: canonicalNarration.clips[0]!.id,
          assetId: playableTimelineAudio.body.id,
        },
      }),
    });
    assert.equal(relinkedTimeline.status, 200);
    const relinkedClip = relinkedTimeline.body.tracks.find(
      (track) => track.kind === "narration",
    )!.clips[0]!;
    assert.equal(relinkedClip.assetId, playableTimelineAudio.body.id);
    assert.equal(relinkedClip.mediaStatus, "linked");
    const timelineAudioPreview = await request<{
      kind: string;
      dataUrl: string;
    }>(`/api/v1/timeline-media/${playableTimelineAudio.body.id}/preview`);
    assert.equal(timelineAudioPreview.status, 200);
    assert.equal(timelineAudioPreview.body.kind, "audio");
    assert.match(timelineAudioPreview.body.dataUrl, /^data:audio\/wav;base64,/);
    const timeline = await request<{
      clips: Array<{ shotId: string; mediaStatus: string }>;
    }>(`/api/v1/episodes/${first.body.id}/editor-timeline`);
    assert.equal(timeline.status, 200);
    assert.equal(timeline.body.clips.length, 1);
    assert.equal(timeline.body.clips[0]?.shotId, shot.body.id);
    assert.equal(timeline.body.clips[0]?.mediaStatus, "referenced");
    const timelinePreflight = await request<{
      canExport: boolean;
      relinkRequiredCount: number;
    }>(`/api/v1/episodes/${first.body.id}/editor-timeline/preflight`);
    assert.equal(timelinePreflight.status, 200);
    assert.equal(timelinePreflight.body.canExport, true);
    assert.equal(timelinePreflight.body.relinkRequiredCount, 0);
    const edl = await request<{ content: string }>(
      `/api/v1/episodes/${first.body.id}/editor-timeline/export/edl`,
    );
    assert.equal(edl.status, 200);
    assert.match(edl.body.content, /FROM CLIP NAME/);
    const reviewPackage = await request<{ id: string; status: string }>(
      `/api/v1/episodes/${first.body.id}/review-packages`,
      { method: "POST" },
    );
    assert.equal(reviewPackage.status, 201);
    assert.equal(reviewPackage.body.status, "exported");
    const reviewPage = await request<{ content: string }>(
      `/api/v1/review-packages/${reviewPackage.body.id}/export`,
    );
    assert.equal(reviewPage.status, 200);
    assert.match(reviewPage.body.content, /离线审片/);
    const reviewComment = await request<{ id: string; resolved: boolean }>(
      `/api/v1/review-packages/${reviewPackage.body.id}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          shotId: shot.body.id,
          timecodeSeconds: 1.2,
          authorAlias: "审片人",
          body: "建议加强信件特写的停留。",
        }),
      },
    );
    assert.equal(reviewComment.status, 201);
    assert.equal(reviewComment.body.resolved, false);
    const resolvedComment = await request<{ resolved: boolean }>(
      `/api/v1/review-comments/${reviewComment.body.id}`,
      { method: "PATCH", body: JSON.stringify({ resolved: true }) },
    );
    assert.equal(resolvedComment.status, 200);
    assert.equal(resolvedComment.body.resolved, true);
    const decision = await request<{ decision: string }>(
      `/api/v1/review-packages/${reviewPackage.body.id}/decisions`,
      {
        method: "POST",
        body: JSON.stringify({
          shotId: shot.body.id,
          decision: "request_changes",
          note: "补充镜头停留时长。",
        }),
      },
    );
    assert.equal(decision.status, 201);
    assert.equal(decision.body.decision, "request_changes");
    const asset = await request<{ id: string }>("/api/v1/assets", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "交付封面",
        payload: { 素材类型: "封面", 归档状态: "已核验" },
      }),
    });
    assert.equal(asset.status, 201);
    for (const [domain, title, payload] of [
      ["quality", "第 1 集质量检查", { 检查状态: "已通过" }],
      ["compliance", "第 1 集合规检查", { 检查状态: "已通过" }],
      ["review", "第 1 集审片记录", { 审片状态: "已通过" }],
      ["localization", "第 1 集中文本地化", { 采用状态: "已采用" }],
    ] as const) {
      const record = await request<{ id: string }>(`/api/v1/${domain}`, {
        method: "POST",
        body: JSON.stringify({
          projectId: project.body.id,
          parentId: first.body.id,
          title,
          payload,
        }),
      });
      assert.equal(record.status, 201);
    }
    const rights = await request<{ id: string }>("/api/v1/rights", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.body.id,
        title: "交付封面授权依据",
        payload: { 授权状态: "已核验" },
      }),
    });
    assert.equal(rights.status, 201);
    const complianceProfiles = await request<
      Array<{ id: string; active: boolean; sourceStatus: string }>
    >("/api/v1/compliance/profiles");
    assert.equal(complianceProfiles.status, 200);
    const officialProfile = complianceProfiles.body.find(
      (profile) => profile.sourceStatus === "official",
    );
    assert.ok(officialProfile);
    const activatedProfile = await request<{ active: boolean }>(
      `/api/v1/compliance/profiles/${officialProfile!.id}/activate`,
      { method: "POST" },
    );
    assert.equal(activatedProfile.status, 200);
    assert.equal(activatedProfile.body.active, true);
    const compliancePreflight = await request<{
      ok: boolean;
      visibleLabel: string;
      metadata: Record<string, string>;
    }>(`/api/v1/episodes/${first.body.id}/compliance-preflight`, {
      method: "POST",
      body: JSON.stringify({
        title: "雨夜来信",
        subtitleLanguage: "中文",
        targetPlatform: "抖音",
        targetRegion: "中国大陆",
        deliveryDate: "2026-08-09",
        aigcDeclared: true,
        manualContentReviewConfirmed: true,
      }),
    });
    assert.equal(compliancePreflight.status, 200);
    assert.equal(compliancePreflight.body.ok, true);
    assert.equal(compliancePreflight.body.visibleLabel, "AI Generated");
    assert.equal(compliancePreflight.body.metadata["dramaip:aigc"], "true");
    const profiles = await request<Array<{ id: string }>>(
      "/api/v1/platform-delivery/profiles",
    );
    assert.equal(profiles.status, 200);
    assert.ok(profiles.body.length >= 1);
    const variant = await request<{ id: string; status: string }>(
      `/api/v1/adaptations/${adaptation.body.id}/delivery-variants`,
      {
        method: "POST",
        body: JSON.stringify({
          label: "方案 A",
          title: "雨夜来信",
          description: "一封来信揭开主角不能说出的秘密。",
          tags: ["悬疑", "反转"],
          coverAssetId: asset.body.id,
          source: "manual",
        }),
      },
    );
    assert.equal(variant.status, 201);
    assert.equal(variant.body.status, "candidate");
    const candidatePreflight = await request<{
      ok: boolean;
      blockers: string[];
    }>(`/api/v1/episodes/${first.body.id}/platform-delivery/preflight`, {
      method: "POST",
      body: JSON.stringify({
        profileId: profiles.body[0]!.id,
        creativeVariantId: variant.body.id,
        manualFieldsConfirmed: true,
      }),
    });
    assert.equal(candidatePreflight.status, 200);
    assert.equal(candidatePreflight.body.ok, false);
    assert.match(candidatePreflight.body.blockers.join("\n"), /采用/);
    const adopted = await request<{ status: string }>(
      `/api/v1/delivery-variants/${variant.body.id}/adopt`,
      { method: "POST" },
    );
    assert.equal(adopted.status, 200);
    assert.equal(adopted.body.status, "adopted");
    const deliveryPreflight = await request<{
      ok: boolean;
      sourceFingerprint: string;
    }>(`/api/v1/episodes/${first.body.id}/platform-delivery/preflight`, {
      method: "POST",
      body: JSON.stringify({
        profileId: profiles.body[0]!.id,
        creativeVariantId: variant.body.id,
        manualFieldsConfirmed: true,
      }),
    });
    assert.equal(deliveryPreflight.status, 200);
    assert.equal(deliveryPreflight.body.ok, true);
    assert.match(deliveryPreflight.body.sourceFingerprint, /^sha256:/);
    const archive = await request<{ id: string; deliveryVersion: number }>(
      `/api/v1/episodes/${first.body.id}/platform-deliveries`,
      {
        method: "POST",
        body: JSON.stringify({
          profileId: profiles.body[0]!.id,
          creativeVariantId: variant.body.id,
          manualFieldsConfirmed: true,
        }),
      },
    );
    assert.equal(archive.status, 201);
    assert.equal(archive.body.deliveryVersion, 1);
    const archives = await request<Array<{ id: string }>>(
      `/api/v1/episodes/${first.body.id}/platform-deliveries`,
    );
    assert.equal(archives.status, 200);
    assert.deepEqual(
      archives.body.map((item) => item.id),
      [archive.body.id],
    );
    const archiveExport = await request<{ content: string }>(
      `/api/v1/platform-deliveries/${archive.body.id}/export`,
    );
    assert.equal(archiveExport.status, 200);
    assert.match(archiveExport.body.content, /平台提交资料清单/);
    const deletedScene = await request<void>(
      `/api/v1/scenes/${scene.body.id}`,
      {
        method: "DELETE",
      },
    );
    assert.equal(deletedScene.status, 204);
    const removedShot = await request<{ code: string }>(
      `/api/v1/shots/${shot.body.id}/review`,
    );
    assert.equal(removedShot.status, 404);
    assert.equal(removedShot.body.code, "NOT_FOUND");
    const deletedAdaptation = await request<void>(
      `/api/v1/adaptations/${adaptation.body.id}`,
      {
        method: "DELETE",
      },
    );
    assert.equal(deletedAdaptation.status, 204);
    const projectAfterCascade = await request<{ currentAdaptationId?: string }>(
      `/api/v1/projects/${project.body.id}`,
    );
    assert.equal(projectAfterCascade.body.currentAdaptationId, undefined);
    const removedEpisode = await request<{ code: string }>(
      `/api/v1/episodes/${first.body.id}`,
    );
    assert.equal(removedEpisode.status, 404);
    const removedArchive = await request<{ code: string }>(
      `/api/v1/platform-deliveries/${archive.body.id}/export`,
    );
    assert.equal(removedArchive.status, 404);
    const removedReviewPackage = await request<{ code: string }>(
      `/api/v1/review-packages/${reviewPackage.body.id}/export`,
    );
    assert.equal(removedReviewPackage.status, 404);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => imageProvider.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("desktop production boundary excludes local renderers and business IPC", () => {
  const renderer = readFileSync(
    new URL("../../../packages/app/src/main.tsx", import.meta.url),
    "utf8",
  );
  const desktopMain = readFileSync(
    new URL("../../../apps/desktop/electron/main-v3.ts", import.meta.url),
    "utf8",
  );
  const builder = readFileSync(
    new URL("../../../apps/desktop/electron-builder.yml", import.meta.url),
    "utf8",
  );
  const manifest = readFileSync(
    new URL("../../../package.json", import.meta.url),
    "utf8",
  );
  const openCodeEngine = readFileSync(
    new URL("../../ai/src/opencode-sidecar.ts", import.meta.url),
    "utf8",
  );
  const serverSource = readFileSync(
    new URL("./sidecar.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(renderer, /\bfetch\s*\(/);
  assert.doesNotMatch(desktopMain, /\bsafeStorage\b/);
  assert.match(desktopMain, /LocalCredentialVault/);
  assert.doesNotMatch(serverSource, /CREATE TABLE|ALTER TABLE/);
  assert.doesNotMatch(builder, /ffmpeg/i);
  assert.doesNotMatch(manifest, /ffmpeg-static/i);
  assert.doesNotMatch(manifest, /better-sqlite3/i);
  for (const capability of [
    "bash",
    "edit",
    "read",
    "glob",
    "grep",
    "list",
    "external_directory",
    "webfetch",
    "websearch",
    "task",
  ])
    assert.match(openCodeEngine, new RegExp(`${capability}: "deny"`));

  const channels = [
    ...desktopMain.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  assert.deepEqual(channels.sort(), [
    "desktop:awaitInitialization",
    "desktop:getCredentialStorageStatus",
    "desktop:openExternal",
    "desktop:pickFiles",
    "desktop:removeCredential",
    "desktop:retryInitialization",
    "desktop:revealPath",
    "desktop:saveTextFile",
    "desktop:storeCredential",
  ]);
});
