import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { EngineEvent, EngineSession } from "@dramaip/contracts";
import type { EngineControlBridge, EngineKind } from "@dramaip/agents";
import { bootDramaRuntime } from "@dramaip/runtime";

class FakeEngineBridge implements EngineControlBridge {
  readonly calls: Array<{ kind: EngineKind; method: string }> = [];

  async call<T>(
    kind: EngineKind,
    method: string,
    _payload: unknown,
  ): Promise<T> {
    this.calls.push({ kind, method });
    if (method === "health")
      return { status: "healthy", version: "ignored" } as T;
    if (method === "capabilities") {
      return {
        streaming: true,
        interrupt: true,
        resume: true,
        fork: true,
        tools: [],
      } as T;
    }
    if (method === "createSession") {
      return {
        sessionId: `engine-${crypto.randomUUID()}`,
        engineKind: kind,
        createdAt: new Date().toISOString(),
      } satisfies EngineSession as T;
    }
    if (method === "fork") {
      return {
        sessionId: `fork-${crypto.randomUUID()}`,
        engineKind: kind,
        createdAt: new Date().toISOString(),
      } satisfies EngineSession as T;
    }
    return undefined as T;
  }

  async *stream(
    kind: EngineKind,
    method: string,
    payload: any,
  ): AsyncIterable<EngineEvent> {
    this.calls.push({ kind, method });
    yield { type: "run.started", runId: payload.runId };
    yield { type: "token.delta", runId: payload.runId, delta: "你好" };
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    yield {
      type: "item.completed",
      runId: payload.runId,
      item: { text: "完整结果" },
    };
    yield {
      type: "run.completed",
      runId: payload.runId,
      usage: { input: 12, output: 8 },
    };
  }
}

test("studio profile loads all product contexts and all five engine fibers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-next-full-"));
  const profileText = await readFile(
    new URL("../../profiles/studio.json", import.meta.url),
    "utf8",
  );
  const bridge = new FakeEngineBridge();
  const capabilities = new Map<string, { path: string; name: string }>();
  const sourcePath = join(directory, "source.md");
  await writeFile(
    sourcePath,
    "# 第一章 雨夜\n林默：别回头。\n【旧车站】里传来《倒计时》的声音。\n\n# 第二章 追踪\n苏遥：我们没有退路。",
    "utf8",
  );
  capabilities.set("source-capability-token", {
    path: sourcePath,
    name: "source.md",
  });
  const authorization = `Basic ${Buffer.from("launch:full-secret").toString("base64")}`;
  const kernel = await bootDramaRuntime({
    profileText,
    databaseFile: join(directory, "dramaip.db"),
    backupDirectory: join(directory, "backups"),
    username: "launch",
    password: "full-secret",
    allowedOrigins: ["dramaip://app"],
    engineBridge: bridge,
    engineTokens: {
      opencode: "test-token-opencode",
      codex: "test-token-codex",
      dsh: "test-token-dsh",
      pi: "test-token-pi",
      langgraph: "test-token-langgraph",
    },
    fileCapabilityResolver: {
      async resolve(token) {
        return capabilities.get(token);
      },
    },
  });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", authorization);
    headers.set("origin", "dramaip://app");
    if (init.body) headers.set("content-type", "application/json");
    return kernel.context.http.fetch(
      new Request(`http://127.0.0.1${path}`, { ...init, headers }),
    );
  };

  try {
    const projectResponse = await request("/api/v2/workspace/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "全链路项目",
        description: "studio profile",
      }),
    });
    assert.equal(projectResponse.status, 201);
    const project = (await projectResponse.json()) as { id: string };

    const characterResponse = await request("/api/v2/knowledge/characters", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        title: "林默",
        data: {
          role: "主角",
          biography: "编剧",
          traits: ["坚韧"],
          relationships: [],
        },
      }),
    });
    assert.equal(characterResponse.status, 201);
    let character = (await characterResponse.json()) as {
      id: string;
      title: string;
      version: number;
      data: { currentState: string };
    };

    const changeSetResponse = await request("/api/v2/knowledge/change-sets", {
      method: "POST",
      headers: { "idempotency-key": "knowledge-change-set-one" },
      body: JSON.stringify({
        projectId: project.id,
        rationale: "章节后更新人物状态",
        changes: [
          {
            targetKind: "character",
            targetId: character.id,
            operation: "update",
            baseVersion: character.version,
            title: character.title,
            patch: { currentState: "发现旧车站的秘密" },
          },
        ],
      }),
    });
    assert.equal(changeSetResponse.status, 201);
    let changeSet = (await changeSetResponse.json()) as {
      id: string;
      version: number;
      status: string;
      items: Array<{ id: string }>;
    };
    const applyChangeSetResponse = await request(
      `/api/v2/knowledge/change-sets/${changeSet.id}/actions/apply`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${changeSet.version}"`,
          "idempotency-key": "knowledge-change-set-apply",
        },
        body: JSON.stringify({
          selectedItemIds: changeSet.items.map((item) => item.id),
        }),
      },
    );
    assert.equal(applyChangeSetResponse.status, 200);
    changeSet = (await applyChangeSetResponse.json()) as typeof changeSet;
    character = (await (
      await request(`/api/v2/knowledge/characters/${character.id}`)
    ).json()) as typeof character;
    assert.equal(character.data.currentState, "发现旧车站的秘密");
    const undoChangeSetResponse = await request(
      `/api/v2/knowledge/change-sets/${changeSet.id}/actions/undo`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${changeSet.version}"`,
          "idempotency-key": "knowledge-change-set-undo",
        },
      },
    );
    assert.equal(undoChangeSetResponse.status, 200);
    character = (await (
      await request(`/api/v2/knowledge/characters/${character.id}`)
    ).json()) as typeof character;
    assert.equal(character.data.currentState, "");

    const mediaPreviewResponse = await request("/api/v2/media/image-runs", {
      method: "POST",
      headers: { "idempotency-key": "media-preview" },
      body: JSON.stringify({
        projectId: project.id,
        title: "概念图",
        data: { provider: "test", prompt: "雨夜街道", outputAssetIds: [] },
      }),
    });
    assert.equal(mediaPreviewResponse.status, 201);
    const mediaPreview = (await mediaPreviewResponse.json()) as {
      id: string;
      version: number;
      status: string;
    };
    assert.equal(mediaPreview.status, "preview");
    const disabledExecution = await request(
      `/api/v2/media/image-runs/${mediaPreview.id}/actions/submit`,
      {
        method: "POST",
        headers: { "if-match": `"v${mediaPreview.version}"` },
        body: JSON.stringify({}),
      },
    );
    assert.equal(disabledExecution.status, 409);
    assert.equal(
      ((await disabledExecution.json()) as { code: string }).code,
      "EXTERNAL_EXECUTION_DISABLED",
    );

    const providersResponse = await request("/api/v2/agents/providers");
    assert.equal(providersResponse.status, 200);
    const providers = (await providersResponse.json()) as {
      items: Array<{ kind: string; version: string }>;
    };
    assert.deepEqual(providers.items.map((provider) => provider.kind).sort(), [
      "codex",
      "dsh",
      "langgraph",
      "opencode",
      "pi",
    ]);
    assert.equal(
      providers.items.find((provider) => provider.kind === "opencode")?.version,
      "1.18.15",
    );

    const configureProvider = await request(
      "/api/v2/agents/providers/opencode/configuration",
      {
        method: "PUT",
        body: JSON.stringify({
          providerKind: "openai",
          providerAdapter: "openai",
          model: "test-model",
          credentialRef: crypto.randomUUID(),
        }),
      },
    );
    assert.equal(configureProvider.status, 201);
    assert.equal(configureProvider.headers.get("etag"), '"v1"');
    const configuration = (await configureProvider.json()) as {
      configured: boolean;
      credentialRef?: string;
    };
    assert.equal(configuration.configured, true);
    assert.equal(configuration.credentialRef, undefined);
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "opencode" && call.method === "configure",
      ),
      true,
    );

    const missingProviderPrecondition = await request(
      "/api/v2/agents/providers/opencode/configuration",
      {
        method: "PUT",
        body: JSON.stringify({
          providerKind: "openai",
          providerAdapter: "openai",
          model: "test-model-v2",
          credentialRef: crypto.randomUUID(),
        }),
      },
    );
    assert.equal(missingProviderPrecondition.status, 428);

    const sessionResponse = await request("/api/v2/agents/sessions", {
      method: "POST",
      headers: { "idempotency-key": "session-one" },
      body: JSON.stringify({
        projectId: project.id,
        engineKind: "opencode",
        title: "默认引擎",
      }),
    });
    assert.equal(sessionResponse.status, 201);
    const session = (await sessionResponse.json()) as { id: string };
    const getSessionResponse = await request(
      `/api/v2/agents/sessions/${session.id}`,
    );
    assert.equal(getSessionResponse.status, 200);
    assert.equal(getSessionResponse.headers.get("etag"), '"v1"');

    const runResponse = await request(
      `/api/v2/agents/sessions/${session.id}/runs`,
      {
        method: "POST",
        headers: { "idempotency-key": "run-one" },
        body: JSON.stringify({ prompt: "写一个开场" }),
      },
    );
    assert.equal(runResponse.status, 202);
    const task = (await runResponse.json()) as { taskId: string; href: string };
    assert.equal(task.href, `/api/v2/agents/runs/${task.taskId}`);

    const mcpResponse = await kernel.context.http.fetch(
      new Request("http://127.0.0.1/api/v2/agents/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token-opencode",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "dramaip.project", arguments: {} },
        }),
      }),
    );
    assert.equal(mcpResponse.status, 200);
    const mcp = (await mcpResponse.json()) as {
      result: { content: Array<{ text: string }> };
    };
    assert.match(mcp.result.content[0]!.text, new RegExp(project.id));

    let run: { state: string } | undefined;
    for (let index = 0; index < 20; index++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const response = await request(task.href);
      run = (await response.json()) as { state: string };
      if (run.state === "succeeded") break;
    }
    assert.equal(run?.state, "succeeded");
    const itemsResponse = await request(
      `/api/v2/agents/runs/${task.taskId}/items`,
    );
    assert.equal(itemsResponse.status, 200);
    const items = (await itemsResponse.json()) as {
      items: Array<{ payload: { text: string } }>;
    };
    assert.equal(items.items[0]?.payload.text, "完整结果");
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "opencode" && call.method === "run",
      ),
      true,
    );
    assert.equal(
      bridge.calls.some(
        (call) => call.kind !== "opencode" && call.method === "run",
      ),
      false,
    );

    const sessionsResponse = await request(
      `/api/v2/agents/sessions?projectId=${project.id}&limit=1`,
    );
    assert.equal(sessionsResponse.status, 200);
    const sessions = (await sessionsResponse.json()) as {
      items: Array<{ id: string }>;
    };
    assert.equal(sessions.items[0]?.id, session.id);

    const forkResponse = await request(
      `/api/v2/agents/sessions/${session.id}/actions/fork`,
      {
        method: "POST",
        headers: {
          "if-match": '"v1"',
          "idempotency-key": "fork-one",
        },
        body: JSON.stringify({ title: "分支会话" }),
      },
    );
    assert.equal(forkResponse.status, 201);
    const forked = (await forkResponse.json()) as { id: string };
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "opencode" && call.method === "fork",
      ),
      true,
    );

    const disposeFork = await request(`/api/v2/agents/sessions/${forked.id}`, {
      method: "DELETE",
      headers: { "if-match": '"v1"' },
    });
    assert.equal(disposeFork.status, 204);
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "opencode" && call.method === "dispose",
      ),
      true,
    );

    const interruptibleResponse = await request(
      `/api/v2/agents/sessions/${session.id}/runs`,
      {
        method: "POST",
        headers: { "idempotency-key": "run-interruptible" },
        body: JSON.stringify({ prompt: "生成后中断并恢复" }),
      },
    );
    assert.equal(interruptibleResponse.status, 202);
    const interruptibleTask = (await interruptibleResponse.json()) as {
      taskId: string;
      href: string;
    };
    const runningResponse = await request(interruptibleTask.href);
    assert.equal(runningResponse.status, 200);
    const running = (await runningResponse.json()) as {
      state: string;
      version: number;
    };
    assert.equal(running.state, "running");

    const interruptResponse = await request(
      `/api/v2/agents/runs/${interruptibleTask.taskId}/actions/interrupt`,
      {
        method: "POST",
        headers: { "if-match": `"v${running.version}"` },
      },
    );
    assert.equal(interruptResponse.status, 200);
    const interrupted = (await interruptResponse.json()) as {
      state: string;
      version: number;
    };
    assert.equal(interrupted.state, "interrupted");

    const checkpointsResponse = await request(
      `/api/v2/agents/runs/${interruptibleTask.taskId}/checkpoints`,
    );
    assert.equal(checkpointsResponse.status, 200);
    const checkpoints = (await checkpointsResponse.json()) as {
      items: Array<{ runId: string; payload: { prompt: string } }>;
    };
    assert.equal(checkpoints.items.length, 1);
    assert.equal(checkpoints.items[0]?.runId, interruptibleTask.taskId);
    assert.equal(checkpoints.items[0]?.payload.prompt, "生成后中断并恢复");

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const resumeResponse = await request(
      `/api/v2/agents/runs/${interruptibleTask.taskId}/actions/resume`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${interrupted.version}"`,
          "idempotency-key": "resume-one",
        },
      },
    );
    assert.equal(resumeResponse.status, 202);
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "opencode" && call.method === "resume",
      ),
      true,
    );
    for (let index = 0; index < 20; index++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const response = await request(interruptibleTask.href);
      const resumed = (await response.json()) as { state: string };
      if (resumed.state === "succeeded") break;
      if (index === 19) assert.fail(`resumed run stayed ${resumed.state}`);
    }

    const runsResponse = await request(
      `/api/v2/agents/sessions/${session.id}/runs?limit=50`,
    );
    assert.equal(runsResponse.status, 200);
    const runs = (await runsResponse.json()) as {
      items: Array<{ id: string }>;
    };
    assert.deepEqual(
      new Set(runs.items.map((item) => item.id)),
      new Set([task.taskId, interruptibleTask.taskId]),
    );

    const chapterResponse = await request(
      `/api/v2/writing/projects/${project.id}/chapters`,
      {
        method: "POST",
        body: JSON.stringify({ title: "雨夜来客", content: "雨落在旧车站。" }),
      },
    );
    assert.equal(chapterResponse.status, 201);
    let chapter = (await chapterResponse.json()) as {
      id: string;
      content: string;
      version: number;
    };

    const importPreviewResponse = await request(
      "/api/v2/workspace/source-imports/actions/preview",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          capability: "source-capability-token",
        }),
      },
    );
    assert.equal(importPreviewResponse.status, 201);
    const importPreview = (await importPreviewResponse.json()) as {
      id: string;
      chapters: Array<{ id: string }>;
      candidates: Array<{ id: string; kind: string }>;
    };
    assert.equal(importPreview.candidates.length, 5);
    assert.equal(importPreview.chapters.length, 2);
    const characterExtraction = importPreview.candidates.find(
      (candidate) => candidate.kind === "character",
    )!;
    const importCommitResponse = await request(
      `/api/v2/workspace/source-imports/${importPreview.id}/actions/commit`,
      {
        method: "POST",
        headers: { "idempotency-key": "source-import-one" },
        body: JSON.stringify({
          rightsConfirmed: true,
          selectedCandidateIds: importPreview.candidates.map(
            (candidate) => candidate.id,
          ),
        }),
      },
    );
    assert.equal(importCommitResponse.status, 200);
    const extractionResponse = await request(
      `/api/v2/knowledge/import-extractions/${characterExtraction.id}/actions/adopt`,
      {
        method: "POST",
        headers: { "idempotency-key": "adopt-extraction-one" },
      },
    );
    assert.equal(extractionResponse.status, 200);
    const extraction = (await extractionResponse.json()) as {
      status: string;
      createdResourceIds: string[];
    };
    assert.equal(extraction.status, "adopted");
    assert.equal(extraction.createdResourceIds.length, 2);
    const undoImportResponse = await request(
      `/api/v2/workspace/source-imports/${importPreview.id}/actions/undo`,
      {
        method: "POST",
        headers: { "idempotency-key": "source-import-undo" },
      },
    );
    assert.equal(undoImportResponse.status, 200);
    const undoneImport = (await undoImportResponse.json()) as {
      status: string;
    };
    assert.equal(undoneImport.status, "undone");

    const unboundConversationResponse = await request(
      "/api/v2/agents/assistant/conversations",
      {
        method: "POST",
        body: JSON.stringify({ title: "未绑定对话", engineKind: "opencode" }),
      },
    );
    assert.equal(unboundConversationResponse.status, 201);
    const unboundConversation = (await unboundConversationResponse.json()) as {
      id: string;
      version: number;
    };
    const clarificationResponse = await request(
      `/api/v2/agents/assistant/conversations/${unboundConversation.id}/messages`,
      {
        method: "POST",
        headers: { "idempotency-key": "clarification-one" },
        body: JSON.stringify({
          content: "请润色这一章",
          taskType: "chapter-polish",
          chapterId: chapter.id,
        }),
      },
    );
    assert.equal(clarificationResponse.status, 200);
    const clarification = (await clarificationResponse.json()) as {
      clarification: boolean;
      run?: unknown;
    };
    assert.equal(clarification.clarification, true);
    assert.equal(clarification.run, undefined);
    const renameConversationResponse = await request(
      `/api/v2/agents/assistant/conversations/${unboundConversation.id}`,
      {
        method: "PATCH",
        headers: { "if-match": `"v${unboundConversation.version}"` },
        body: JSON.stringify({ title: "已重命名对话" }),
      },
    );
    assert.equal(renameConversationResponse.status, 200);
    let managedConversation = (await renameConversationResponse.json()) as {
      id: string;
      title: string;
      status: string;
      version: number;
    };
    assert.equal(managedConversation.title, "已重命名对话");
    const archiveConversationResponse = await request(
      `/api/v2/agents/assistant/conversations/${managedConversation.id}/actions/archive`,
      {
        method: "POST",
        headers: { "if-match": `"v${managedConversation.version}"` },
      },
    );
    assert.equal(archiveConversationResponse.status, 200);
    managedConversation =
      (await archiveConversationResponse.json()) as typeof managedConversation;
    assert.equal(managedConversation.status, "archived");
    const restoreConversationResponse = await request(
      `/api/v2/agents/assistant/conversations/${managedConversation.id}/actions/restore`,
      {
        method: "POST",
        headers: { "if-match": `"v${managedConversation.version}"` },
      },
    );
    assert.equal(restoreConversationResponse.status, 200);
    managedConversation =
      (await restoreConversationResponse.json()) as typeof managedConversation;
    assert.equal(managedConversation.status, "active");

    const projectSettingsResponse = await request(
      `/api/v2/agents/projects/${project.id}/settings`,
    );
    assert.equal(projectSettingsResponse.status, 200);
    const projectSettings = (await projectSettingsResponse.json()) as {
      version: number;
    };
    const updateProjectSettingsResponse = await request(
      `/api/v2/agents/projects/${project.id}/settings`,
      {
        method: "PUT",
        headers: { "if-match": `"v${projectSettings.version}"` },
        body: JSON.stringify({
          engineKind: "pi",
          model: "test-pi-model",
          advancedMode: true,
        }),
      },
    );
    assert.equal(updateProjectSettingsResponse.status, 200);
    const updatedProjectSettings =
      (await updateProjectSettingsResponse.json()) as {
        engineKind: string;
        advancedMode: boolean;
      };
    assert.equal(updatedProjectSettings.engineKind, "pi");
    assert.equal(updatedProjectSettings.advancedMode, true);

    const conversationResponse = await request(
      "/api/v2/agents/assistant/conversations",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "章节助手",
          engineKind: "codex",
        }),
      },
    );
    assert.equal(conversationResponse.status, 201);
    const conversation = (await conversationResponse.json()) as {
      id: string;
      engineKind: string;
    };
    assert.equal(conversation.engineKind, "codex");

    const sendAssistant = async (key: string, viaWriting = false) => {
      const response = await request(
        viaWriting
          ? `/api/v2/writing/projects/${project.id}/chapters/actions/continue`
          : `/api/v2/agents/assistant/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "idempotency-key": key },
          body: JSON.stringify(
            viaWriting
              ? {
                  conversationId: conversation.id,
                  chapterId: chapter.id,
                  instruction: "请续写，保持克制的悬疑感",
                }
              : {
                  content: "请续写，保持克制的悬疑感",
                  taskType: "chapter-continue",
                  chapterId: chapter.id,
                },
          ),
        },
      );
      assert.equal(response.status, 202);
      const result = (await response.json()) as {
        run: { taskId: string; href: string };
      };
      for (let index = 0; index < 30; index++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        const runResponse = await request(result.run.href);
        const current = (await runResponse.json()) as { state: string };
        if (current.state === "succeeded") break;
        if (index === 29) assert.fail(`assistant run stayed ${current.state}`);
      }
      const messagesResponse = await request(
        `/api/v2/agents/assistant/conversations/${conversation.id}/messages?limit=200`,
      );
      const messages = (await messagesResponse.json()) as {
        items: Array<{
          runId: string | null;
          role: string;
          content: string;
          changePreviewId: string | null;
        }>;
      };
      const answer = messages.items.find(
        (item) => item.role === "assistant" && item.runId === result.run.taskId,
      );
      assert.equal(answer?.content, "完整结果");
      assert.ok(answer?.changePreviewId);
      return answer.changePreviewId!;
    };

    const conflictingPreviewId = await sendAssistant("assistant-write-one");
    const manualEditResponse = await request(
      `/api/v2/writing/chapters/${chapter.id}`,
      {
        method: "PATCH",
        headers: { "if-match": `"v${chapter.version}"` },
        body: JSON.stringify({ content: `${chapter.content}\n作者手动补写。` }),
      },
    );
    assert.equal(manualEditResponse.status, 200);
    chapter = (await manualEditResponse.json()) as typeof chapter;
    const conflictingCommit = await request(
      `/api/v2/automation/change-previews/${conflictingPreviewId}/actions/commit`,
      {
        method: "POST",
        headers: {
          "if-match": '"v1"',
          "idempotency-key": "conflicting-preview-commit",
        },
      },
    );
    assert.equal(conflictingCommit.status, 412);
    const discardConflict = await request(
      `/api/v2/automation/change-previews/${conflictingPreviewId}/actions/discard`,
      {
        method: "POST",
        headers: {
          "if-match": '"v1"',
          "idempotency-key": "conflicting-preview-discard",
        },
      },
    );
    assert.equal(discardConflict.status, 200);

    const previewId = await sendAssistant("assistant-write-two", true);
    const previewResponse = await request(
      `/api/v2/automation/change-previews/${previewId}`,
    );
    assert.equal(previewResponse.status, 200);
    const preview = (await previewResponse.json()) as {
      version: number;
      targets: Array<{ baseVersion: number; kind: string }>;
    };
    assert.equal(preview.targets[0]?.baseVersion, chapter.version);
    assert.equal(preview.targets[0]?.kind, "writing.chapter");
    const commitPreviewResponse = await request(
      `/api/v2/automation/change-previews/${previewId}/actions/commit`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${preview.version}"`,
          "idempotency-key": "preview-commit-two",
        },
      },
    );
    assert.equal(commitPreviewResponse.status, 200);
    const adoptedChapterResponse = await request(
      `/api/v2/writing/chapters/${chapter.id}`,
    );
    chapter = (await adoptedChapterResponse.json()) as typeof chapter;
    assert.match(chapter.content, /作者手动补写。\n完整结果/u);
    const versionsResponse = await request(
      `/api/v2/writing/chapters/${chapter.id}/versions`,
    );
    const chapterVersions = (await versionsResponse.json()) as {
      items: Array<{ id: string; reason: string; content: string }>;
    };
    assert.ok(
      chapterVersions.items.some(
        (version) => version.reason === "agent-commit",
      ),
    );
    assert.ok(
      chapterVersions.items.some(
        (version) => version.reason === "restore-checkpoint",
      ),
    );
    const contentVersionsResponse = await request(
      `/api/v2/writing/projects/${project.id}/content-versions?limit=50`,
    );
    assert.equal(contentVersionsResponse.status, 200);
    const contentVersions = (await contentVersionsResponse.json()) as {
      items: Array<{
        id: string;
        projectId: string;
        chapterId: string;
        content: string;
      }>;
    };
    const currentContentVersion = contentVersions.items.find(
      (version) =>
        version.chapterId === chapter.id && version.content === chapter.content,
    );
    assert.ok(currentContentVersion);
    const missingRestorePrecondition = await request(
      `/api/v2/writing/content-versions/${currentContentVersion.id}/actions/restore`,
      {
        method: "POST",
        headers: { "idempotency-key": "content-version-no-match" },
      },
    );
    assert.equal(missingRestorePrecondition.status, 428);
    const restoreContentVersion = await request(
      `/api/v2/writing/content-versions/${currentContentVersion.id}/actions/restore`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${chapter.version}"`,
          "idempotency-key": "content-version-restore",
        },
      },
    );
    assert.equal(restoreContentVersion.status, 200);
    chapter = (await restoreContentVersion.json()) as typeof chapter;
    assert.equal(chapter.content, currentContentVersion.content);

    const createEmptyLocalization = await request(
      "/api/v2/writing/localizations",
      {
        method: "POST",
        headers: { "idempotency-key": "localization-empty" },
        body: JSON.stringify({
          projectId: project.id,
          sourceId: chapter.id,
          locale: "en-US",
          content: "",
        }),
      },
    );
    assert.equal(createEmptyLocalization.status, 201);
    let localization = (await createEmptyLocalization.json()) as {
      id: string;
      content: string;
      status: string;
      version: number;
    };
    const adoptEmptyLocalization = await request(
      `/api/v2/writing/localizations/${localization.id}/actions/adopt`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${localization.version}"`,
          "idempotency-key": "localization-adopt-empty",
        },
      },
    );
    assert.equal(adoptEmptyLocalization.status, 409);
    const updateLocalization = await request(
      `/api/v2/writing/localizations/${localization.id}`,
      {
        method: "PATCH",
        headers: { "if-match": `"v${localization.version}"` },
        body: JSON.stringify({ content: "Rain fell over the old station." }),
      },
    );
    assert.equal(updateLocalization.status, 200);
    localization = (await updateLocalization.json()) as typeof localization;
    const staleLocalizationUpdate = await request(
      `/api/v2/writing/localizations/${localization.id}`,
      {
        method: "PATCH",
        headers: { "if-match": '"v1"' },
        body: JSON.stringify({ content: "stale" }),
      },
    );
    assert.equal(staleLocalizationUpdate.status, 412);
    const adoptLocalization = await request(
      `/api/v2/writing/localizations/${localization.id}/actions/adopt`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${localization.version}"`,
          "idempotency-key": "localization-adopt-one",
        },
      },
    );
    assert.equal(adoptLocalization.status, 200);
    localization = (await adoptLocalization.json()) as typeof localization;
    assert.equal(localization.status, "adopted");
    const subtitlesResponse = await request(
      `/api/v2/writing/localizations/${localization.id}/subtitles/srt`,
    );
    assert.equal(subtitlesResponse.status, 200);
    const subtitles = (await subtitlesResponse.json()) as {
      mimeType: string;
      content: string;
    };
    assert.equal(subtitles.mimeType, "application/x-subrip");
    assert.match(subtitles.content, /00:00:00,000 --> 00:00:02,800/u);

    const siblingLocalizationResponse = await request(
      "/api/v2/writing/localizations",
      {
        method: "POST",
        headers: { "idempotency-key": "localization-sibling" },
        body: JSON.stringify({
          projectId: project.id,
          sourceId: chapter.id,
          locale: "en-US",
          content: "The old station was wrapped in rain.",
        }),
      },
    );
    assert.equal(siblingLocalizationResponse.status, 201);
    const siblingLocalization = (await siblingLocalizationResponse.json()) as {
      id: string;
      version: number;
    };
    const adoptSiblingLocalization = await request(
      `/api/v2/writing/localizations/${siblingLocalization.id}/actions/adopt`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${siblingLocalization.version}"`,
          "idempotency-key": "localization-adopt-sibling",
        },
      },
    );
    assert.equal(adoptSiblingLocalization.status, 200);
    const archivedLocalization = (await (
      await request(`/api/v2/writing/localizations/${localization.id}`)
    ).json()) as { status: string };
    assert.equal(archivedLocalization.status, "archived");
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "codex" && call.method === "run",
      ),
      true,
    );

    const snapshotLinks = kernel.context.uow.execute((tx) =>
      tx.all<{ run_id: string; fragment_count: number }>(
        `SELECT s.run_id, COUNT(f.id) AS fragment_count
         FROM agent_context_snapshots s
         JOIN agent_context_fragments f ON f.snapshot_id = s.id
         WHERE s.conversation_id = ? GROUP BY s.id`,
        conversation.id,
      ),
    );
    assert.equal(snapshotLinks.length, 2);
    assert.ok(snapshotLinks.every((snapshot) => snapshot.fragment_count >= 2));

    const resumableConversationResponse = await request(
      "/api/v2/agents/assistant/conversations",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "可恢复章节助手",
          engineKind: "pi",
        }),
      },
    );
    const resumableConversation =
      (await resumableConversationResponse.json()) as { id: string };
    const resumableMessageResponse = await request(
      `/api/v2/agents/assistant/conversations/${resumableConversation.id}/messages`,
      {
        method: "POST",
        headers: { "idempotency-key": "assistant-resumable-message" },
        body: JSON.stringify({
          content: "请润色这一章",
          taskType: "chapter-polish",
          chapterId: chapter.id,
        }),
      },
    );
    assert.equal(resumableMessageResponse.status, 202);
    const resumableMessage = (await resumableMessageResponse.json()) as {
      run: { taskId: string; href: string };
    };
    const activeAssistantRunResponse = await request(resumableMessage.run.href);
    const activeAssistantRun = (await activeAssistantRunResponse.json()) as {
      version: number;
      state: string;
    };
    assert.equal(activeAssistantRun.state, "running");
    const interruptAssistantResponse = await request(
      `/api/v2/agents/runs/${resumableMessage.run.taskId}/actions/interrupt`,
      {
        method: "POST",
        headers: { "if-match": `"v${activeAssistantRun.version}"` },
      },
    );
    const interruptedAssistant = (await interruptAssistantResponse.json()) as {
      version: number;
      state: string;
    };
    assert.equal(interruptedAssistant.state, "interrupted");
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const resumeAssistantResponse = await request(
      `/api/v2/agents/runs/${resumableMessage.run.taskId}/actions/resume`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${interruptedAssistant.version}"`,
          "idempotency-key": "assistant-resume-original-engine",
        },
      },
    );
    assert.equal(resumeAssistantResponse.status, 202);
    for (let index = 0; index < 30; index++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const response = await request(resumableMessage.run.href);
      const current = (await response.json()) as { state: string };
      if (current.state === "succeeded") break;
      if (index === 29)
        assert.fail(`resumed assistant run stayed ${current.state}`);
    }
    const resumedTurns = (await (
      await request(
        `/api/v2/agents/assistant/conversations/${resumableConversation.id}/messages?limit=20`,
      )
    ).json()) as {
      items: Array<{
        role: string;
        content: string;
        changePreviewId: string | null;
      }>;
    };
    const resumedAnswer = resumedTurns.items.find(
      (turn) => turn.role === "assistant",
    );
    assert.equal(resumedAnswer?.content, "完整结果");
    assert.ok(resumedAnswer?.changePreviewId);
    assert.equal(
      bridge.calls.some(
        (call) => call.kind === "pi" && call.method === "resume",
      ),
      true,
    );

    const experimentResponse = await request("/api/v2/agents/experiments", {
      method: "POST",
      headers: { "idempotency-key": "blind-experiment-one" },
      body: JSON.stringify({
        projectId: project.id,
        chapterId: chapter.id,
        taskType: "chapter-polish",
        prompt: "分别润色本章开头",
        engines: ["dsh", "langgraph"],
      }),
    });
    assert.equal(experimentResponse.status, 202);
    let experiment = (await experimentResponse.json()) as {
      id: string;
      status: string;
      version: number;
      revealed: boolean;
      candidates: Array<{ id: string; engineKind: string | null }>;
    };
    assert.equal(experiment.revealed, false);
    assert.ok(
      experiment.candidates.every((candidate) => !candidate.engineKind),
    );
    for (let index = 0; index < 30; index++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const response = await request(
        `/api/v2/agents/experiments/${experiment.id}`,
      );
      experiment = (await response.json()) as typeof experiment;
      if (experiment.status === "ready") break;
      if (index === 29) assert.fail(`experiment stayed ${experiment.status}`);
    }
    assert.equal(experiment.revealed, false);
    assert.ok(
      experiment.candidates.every((candidate) => !candidate.engineKind),
    );
    const reviewResponse = await request(
      `/api/v2/agents/experiments/${experiment.id}/actions/review`,
      {
        method: "POST",
        headers: {
          "if-match": `"v${experiment.version}"`,
          "idempotency-key": "blind-experiment-review",
        },
        body: JSON.stringify({
          selectedCandidateId: experiment.candidates[0]!.id,
          notes: "盲评后选择第一项",
        }),
      },
    );
    assert.equal(reviewResponse.status, 200);
    experiment = (await reviewResponse.json()) as typeof experiment;
    assert.equal(experiment.revealed, true);
    assert.deepEqual(
      new Set(experiment.candidates.map((candidate) => candidate.engineKind)),
      new Set(["dsh", "langgraph"]),
    );

    const packageResponse = await request(
      `/api/v2/workspace/projects/${project.id}/exports/project-package`,
    );
    assert.equal(packageResponse.status, 200);
    const projectPackage = await packageResponse.json();
    const packagePath = join(directory, "roundtrip.dramaip-next.json");
    await writeFile(packagePath, JSON.stringify(projectPackage), "utf8");
    capabilities.set("package-capability-token", {
      path: packagePath,
      name: "roundtrip.dramaip-next.json",
    });
    const packagePreviewResponse = await request(
      "/api/v2/workspace/project-packages/actions/preview",
      {
        method: "POST",
        body: JSON.stringify({ capability: "package-capability-token" }),
      },
    );
    assert.equal(packagePreviewResponse.status, 201);
    const packagePreview = (await packagePreviewResponse.json()) as {
      id: string;
    };
    const packageCommitResponse = await request(
      `/api/v2/workspace/project-packages/${packagePreview.id}/actions/commit`,
      {
        method: "POST",
        headers: { "idempotency-key": "package-roundtrip-one" },
        body: JSON.stringify({ name: "全链路项目·往返副本" }),
      },
    );
    assert.equal(packageCommitResponse.status, 201);
    const importedProject = (await packageCommitResponse.json()) as {
      id: string;
    };
    const importedWorkspace = (await (
      await request(`/api/v2/writing/projects/${importedProject.id}/workspace`)
    ).json()) as { chapters: Array<{ title: string; content: string }> };
    assert.ok(importedWorkspace.chapters.length >= 1);
    assert.ok(
      importedWorkspace.chapters.some((item) =>
        item.content.includes("完整结果"),
      ),
    );

    const paths = (kernel.context.http.openapiDocument().paths ?? {}) as Record<
      string,
      unknown
    >;
    for (const path of [
      "/api/v2/workspace/source-imports/actions/preview",
      "/api/v2/writing/projects/{projectId}/chapters",
      "/api/v2/writing/chapters/{id}/versions",
      "/api/v2/knowledge/characters",
      "/api/v2/knowledge/projects/{projectId}/story-bible/change-sets",
      "/api/v2/automation/tasks",
      "/api/v2/automation/change-previews/{id}",
      "/api/v2/creative-quality/quality-checks",
      "/api/v2/agents/assistant/conversations",
      "/api/v2/agents/experiments",
    ]) {
      assert.ok(paths[path], `missing OpenAPI path ${path}`);
    }
    for (const path of [
      "/api/v2/production/shots",
      "/api/v2/media/assets",
      "/api/v2/timeline/timelines",
      "/api/v2/review/packages",
      "/api/v2/delivery/exports",
      "/api/v2/insights/generation-ledger",
    ]) {
      assert.ok(paths[path], `missing full-profile OpenAPI path ${path}`);
    }
  } finally {
    await kernel.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
