import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

test("AI 创作按钮与候选：操作要求、聊天草稿、采用和运行状态隔离", async () => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-creation-ui-"));
  const application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.getByRole("button", { name: "先看看示例" }).click();
    await page.getByRole("link", { name: "雨夜归来" }).click();
    const editor = page.getByRole("textbox", {
      name: "章节正文编辑器",
      exact: true,
    });
    await expect(editor).toBeVisible();
    const original = await editor.innerText();
    const projectId = await page.evaluate(
      () => window.location.hash.split("/")[2]!,
    );
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const chapters = (await (
      await fetch(
        `${bootstrap.baseUrl}/api/v2/projects/${projectId}/chapters`,
        {
          headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
        },
      )
    ).json()) as Array<{ id: string; version: number }>;
    const chapter = chapters[0]!;
    const id = crypto.randomUUID(),
      previewId = crypto.randomUUID(),
      taskId = crypto.randomUUID();
    let pending = false;
    let discarded = false;
    let rejectionStatus = 503;
    let revisionReadFails = false;
    const requests: Array<{ key: string; input: Record<string, unknown> }> = [];
    const preview = () => ({
      id: previewId,
      projectId,
      taskId,
      status: discarded ? "discarded" : "pending",
      targets: [
        {
          kind: "chapter",
          id: chapter.id,
          baseVersion: chapter.version,
          patch: { content: "这是一份用于界面验证的 AI 候选。" },
          displayDiff: { creationWorkflowId: id },
        },
      ],
      rationale: "界面隔离样例，非真实模型质量证据",
      contentHash: "ui-fixture",
      createdAt: "2026-09-06T00:00:00.000Z",
    });
    const workflow = () => ({
      id,
      taskId,
      previewId,
      input: {
        projectId,
        targetId: chapter.id,
        baseVersion: chapter.version,
        operation: "chapter",
        instruction: "界面测试",
        engineKind: "codex",
        sourceIds: [],
        narrativeContextRequest: {
          format: "narrative-context-v1",
          chapters: [],
        },
      },
      stage: discarded ? "discarded" : "awaiting-review",
      version: 0,
      runIds: [],
      contextSnapshotIds: [],
      referenceVersions: [],
      sources: [],
      contextEntries: [],
      issues: [],
      preparedPrompt: "界面隔离样例",
      output: {
        title: "候选",
        content: "这是一份用于界面验证的 AI 候选。",
        items: [],
      },
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    });
    // Only workflow responses are simulated. Chapter edits and autosave use the real Runtime.
    await page.route("**/api/v2/workflows/creation**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "POST") {
        requests.push({
          key: request.headers()["idempotency-key"]!,
          input: request.postDataJSON(),
        });
        await route.fulfill({
          status: rejectionStatus,
          contentType: "application/problem+json",
          json: {
            type: "https://dramaip.local/problems/connection",
            title: "连接测试",
            status: rejectionStatus,
            code: rejectionStatus === 409 ? "CONFLICT" : "UNAVAILABLE",
            detail: "测试连接尚未就绪。",
          },
        });
      } else
        await route.fulfill({
          json: url.pathname.endsWith(`/${id}`)
            ? workflow()
            : { items: pending ? [workflow()] : [] },
        });
    });
    await page.route(
      `**/api/v2/change-previews/${previewId}**`,
      async (route) => {
        if (
          new URL(route.request().url()).pathname.endsWith("/revision-effort")
        ) {
          if (revisionReadFails)
            return route.fulfill({
              status: 503,
              contentType: "application/problem+json",
              json: {
                type: "https://dramaip.local/problems/revision-history-unavailable",
                title: "原台账暂不可读",
                status: 503,
                code: "REVISION_HISTORY_UNAVAILABLE",
                detail: "受控读取失败，不可沿用旧记录",
              },
            });
          const url = new URL(route.request().url());
          expect(route.request().method()).toBe("GET");
          expect(url.searchParams.get("projectId")).toBe(projectId);
          expect(url.searchParams.get("contentHash")).toBe("ui-fixture");
          return route.fulfill({
            json: {
              format: "chapter-preview-revision-effort-v1",
              projectId,
              previewId,
              chapterId: chapter.id,
              taskId,
              rootPreviewId: previewId,
              contentHash: "ui-fixture",
              candidateSha256: createHash("sha256")
                .update(preview().targets[0]!.patch.content)
                .digest("hex"),
              journalSha256: "a".repeat(64),
              status: "pending",
              coverage: "partial",
              observedContentUpdates: 1,
              observedRebases: 0,
              observedContentChangingRebases: 0,
              localRevisionCount: null,
              scope: "exact-chapter-preview-chain",
              qualityStatus: "unverified",
            },
          });
        }
        if (new URL(route.request().url()).pathname.endsWith("/discard"))
          discarded = true;
        await route.fulfill({ json: preview() });
      },
    );
    const panel = page.getByLabel("章节辅助栏", { exact: true });
    await expect(
      panel.getByRole("button", { name: "续写本章", exact: true }),
    ).toBeEnabled();
    await panel.screenshot({
      path: test.info().outputPath("creation-panel.png"),
    });
    pending = true;
    await expect(editor).toContainText("界面验证的 AI 候选");
    const revisions = panel
      .getByLabel("候选正文实际修订台账", { exact: true })
      .first();
    await revisions
      .getByRole("button", { name: "查看候选正文实际修订次数", exact: true })
      .click();
    await expect(revisions).toContainText("已记录正文修改 1 次");
    await expect(revisions).toContainText("未知（历史不完整）");
    await expect(revisions).toContainText("尚未正式采用");
    await expect(revisions).toContainText("不包含模型修订阶段");
    await revisions.screenshot({
      path: test.info().outputPath("actual-preview-revisions-partial.png"),
    });
    revisionReadFails = true;
    await revisions
      .getByRole("button", { name: "查看候选正文实际修订次数", exact: true })
      .click();
    await expect(revisions.getByRole("alert")).toContainText(
      "不显示旧缓存或推定零修订",
    );
    await expect(
      revisions.getByLabel("实际候选修订记录", { exact: true }),
    ).toHaveCount(0);
    revisionReadFails = false;
    await expect(
      panel.getByRole("button", { name: "续写本章", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "增强冲突", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "原稿", exact: true }).click();
    await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("button", { name: "微调正文", exact: true }).click();
    const newest = `${original}\n用户在候选返回后新添的内容必须保留。`;
    // A read-only candidate must not replace the dirty author's recovery
    // snapshot. Delay the real chapter PATCH so the dirty state stays visible.
    let releaseSave!: () => void;
    const saveBarrier = new Promise<void>((resolveSave) => {
      releaseSave = resolveSave;
    });
    await page.route(`**/api/v2/chapters/${chapter.id}`, async (route) => {
      if (route.request().method() === "PATCH") await saveBarrier;
      await route.continue();
    });
    await editor.fill(newest);
    await page.getByRole("button", { name: "候选稿", exact: true }).click();
    await expect(editor).toContainText("界面验证的 AI 候选");
    await expect
      .poll(() =>
        page.evaluate((chapterId) => {
          const value = localStorage.getItem(
            `dramaip-novel-draft:${chapterId}`,
          );
          return value ? JSON.parse(value).content : undefined;
        }, chapter.id),
      )
      .toContain("用户在候选返回后新添的内容必须保留。");
    expect(
      await page.evaluate((chapterId) => {
        const value = localStorage.getItem(`dramaip-novel-draft:${chapterId}`);
        return value ? JSON.parse(value).content : undefined;
      }, chapter.id),
    ).not.toContain("界面验证的 AI 候选");
    releaseSave();
    await page.unroute(`**/api/v2/chapters/${chapter.id}`);
    await panel.getByRole("button", { name: "放弃候选", exact: true }).click();
    await expect(page.getByText("候选稿预览", { exact: true })).toBeHidden();
    await expect(editor).toContainText("用户在候选返回后新添的内容必须保留。");
    await expect(editor).not.toContainText("界面验证的 AI 候选");
    await expect
      .poll(async () => {
        const response = await fetch(
          `${bootstrap.baseUrl}/api/v2/chapters/${chapter.id}`,
          { headers: { Authorization: `Bearer ${bootstrap.accessToken}` } },
        );
        return ((await response.json()) as { content: string }).content;
      })
      .toContain("用户在候选返回后新添的内容必须保留。");

    pending = false;
    const input = panel.getByLabel("AI 创作要求");
    const generate = panel.getByRole("button", {
      name: "生成并检查本章正文",
      exact: true,
    });
    await input.fill("保留人物动机，调整节奏。");
    await generate.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await generate.click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]!.key).toBe(requests[0]!.key);
    expect(requests[1]!.input).toEqual(requests[0]!.input);
    await input.fill("增加环境细节，保留人物动机。");
    await generate.click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2]!.key).not.toBe(requests[1]!.key);
    await page.getByRole("button", { name: /第二章：旧照片/ }).click();
    await expect(editor).not.toContainText("用户在候选返回后新添的内容");
    await panel.getByLabel("AI 创作要求").fill("增加环境细节，保留人物动机。");
    await generate.click();
    await expect.poll(() => requests.length).toBe(4);
    expect(requests[3]!.key).not.toBe(requests[2]!.key);
    expect(requests[3]!.input.targetId).not.toBe(chapter.id);

    // Chat drafts must not become the instruction for a creation shortcut.
    await panel.getByRole("button", { name: "对话", exact: true }).click();
    await expect(panel.getByLabel("章节对话", { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "续写本章", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "增强冲突", exact: true }),
    ).toHaveCount(0);
    await panel
      .getByLabel("给 AI 写作助手发消息")
      .fill("聊天草稿：讨论书名，暂不生成正文。");
    await panel.getByRole("button", { name: "AI 创作", exact: true }).click();
    await input.fill("");
    await generate.click();
    await expect.poll(() => requests.length).toBe(5);
    expect(requests[4]!.input.instruction).toContain("生成并检查本章正文");
    expect(requests[4]!.input.wordGoal).toBe(2000);

    await panel.getByText("创作设置", { exact: true }).click();
    await panel.getByLabel("目标字数", { exact: true }).fill("2400");
    await panel.getByText("创作设置", { exact: true }).click();
    await input.fill("保留第三人称视角。");
    for (const [index, label] of [
      "续写本章",
      "改写本章",
      "润色本章",
      "扩写本章",
      "增强冲突",
      "强化悬念",
    ].entries()) {
      const button = panel.getByRole("button", { name: label, exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(() => requests.length).toBe(6 + index);
      const input = requests[5 + index]!.input;
      expect(input.instruction).toContain(`${label}：`);
      expect(input.instruction).toContain("保留第三人称视角。");
      expect(input.instruction).not.toContain("聊天草稿");
      expect(input.wordGoal).toBe(2400);
      expect(requests[5 + index]!.key).not.toBe(requests[4 + index]!.key);
    }
    // An unavailable response is not proof the original start was rejected.
    // In contrast, an explicit owner 409/CONFLICT is a definite rejection and
    // must release that action key rather than replay a poisoned request.
    rejectionStatus = 409;
    await generate.click();
    await expect.poll(() => requests.length).toBe(12);
    await expect(panel).toContainText("测试连接尚未就绪。");
    await generate.click();
    await expect.poll(() => requests.length).toBe(13);
    expect(requests[12]!.key).not.toBe(requests[11]!.key);
    expect(requests[12]!.input).toEqual(requests[11]!.input);
    await panel.getByRole("button", { name: "对话", exact: true }).click();
    await expect(panel.getByLabel("给 AI 写作助手发消息")).toHaveValue(
      "聊天草稿：讨论书名，暂不生成正文。",
    );
    await panel.getByRole("button", { name: "AI 创作", exact: true }).click();
    const runningId = crypto.randomUUID();
    let runId = crypto.randomUUID();
    let stage = "generating";
    const createdAt = new Date().toISOString();
    let eventFrames = "";
    let recoveredContent = "";
    let eventReads = 0;
    await page.route("**/api/v2/events*", (route) => {
      eventReads += 1;
      return route.fulfill({
        contentType: "text/event-stream",
        // A complete ignored frame keeps this controlled short-lived stream's
        // reconnect delay bounded. A comment-only response is not an event and
        // correctly triggers exponential reconnect backoff in the real SDK.
        body:
          eventFrames ||
          `data: ${JSON.stringify({ kind: "realtime", event: { id: crypto.randomUUID(), type: "agents.assistant-item-delta.v1", payload: { runId: crypto.randomUUID(), content: "" }, occurredAt: new Date().toISOString() } })}\n\n`,
      });
    });
    await page.route("**/api/v2/agent-runs/*/items", (route) =>
      route.fulfill({
        json: recoveredContent
          ? [
              {
                id: crypto.randomUUID(),
                runId,
                sequence: 1,
                type: "message",
                status: "streaming",
                content: recoveredContent,
                createdAt,
                updatedAt: new Date().toISOString(),
              },
            ]
          : [],
      }),
    );
    const emit = (type: string, payload: Record<string, unknown>) => {
      eventFrames = `data: ${JSON.stringify({ kind: "realtime", event: { id: crypto.randomUUID(), type, payload, occurredAt: new Date().toISOString() } })}\n\n`;
    };
    let startedInput: Record<string, unknown> | undefined;
    const runningWorkflow = () => ({
      ...workflow(),
      id: runningId,
      input: { ...workflow().input, ...startedInput },
      previewId: undefined,
      output:
        stage === "failed"
          ? {
              title: "检查前的候选",
              content: "检查前已经生成的正文仍然保留。",
              items: [],
            }
          : undefined,
      stage,
      runId,
      runIds: [runId],
      createdAt,
      updatedAt: new Date().toISOString(),
    });
    await page.route("**/api/v2/workflows/creation**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        startedInput = request.postDataJSON();
        await route.fulfill({ json: runningWorkflow() });
      } else {
        await route.fulfill({
          json: new URL(request.url()).pathname.endsWith(`/${runningId}`)
            ? runningWorkflow()
            : { items: startedInput ? [runningWorkflow()] : [] },
        });
      }
    });
    // The SDK intentionally shares one long-lived stream across subscribers.
    // Reload after installing the controlled route; otherwise the pre-existing
    // real Runtime connection never reaches this late interception at all.
    await page.reload();
    await expect(editor).toBeVisible();
    await expect.poll(() => eventReads).toBeGreaterThan(0);
    await panel.getByRole("button", { name: "续写本章", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "停止生成", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "润色本章", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "续写下一章", exact: true }),
    ).toBeDisabled();
    expect(startedInput?.instruction).toContain("续写本章：");
    const progress = panel.getByRole("region", {
      name: "AI 执行实时反馈",
      exact: true,
    });
    await expect(progress).toContainText("正在等待模型返回内容");
    const elapsed = await progress.getByLabel("创作已用时间").innerText();
    await expect(progress.getByLabel("创作已用时间")).not.toHaveText(elapsed);
    emit("agents.assistant-item-delta.v1", {
      runId: crypto.randomUUID(),
      content: '{"content":"其他任务不得串入"}',
    });
    await expect(progress).not.toContainText("其他任务不得串入");
    emit("agents.assistant-item-delta.v1", {
      runId,
      content: '{"title":"雨夜","content":"门外的雨声越来越近。',
    });
    await expect(
      progress.getByRole("region", { name: "AI 实时返回内容" }),
    ).toHaveText("门外的雨声越来越近。");
    await expect(progress).not.toContainText('"content"');
    emit("agents.assistant-item-started.v1", {
      runId,
      type: "stage",
      content: "正在读取项目资料",
    });
    await expect(progress).toContainText("正在读取项目资料");
    await progress.screenshot({
      path: test.info().outputPath("creation-live-progress.png"),
    });
    // Reopening uses persisted partial content even after the transient event is gone.
    recoveredContent = '{"content":"门外的雨声越来越近。林晚握紧门把手。';
    eventFrames = "";
    await panel.getByRole("button", { name: "对话", exact: true }).click();
    await panel.getByRole("button", { name: "AI 创作", exact: true }).click();
    await expect(progress).toContainText("林晚握紧门把手。");
    stage = "checking";
    runId = crypto.randomUUID();
    recoveredContent = "";
    await expect(progress).toContainText("正在核对创作要求");
    await expect(progress).not.toContainText("林晚握紧门把手。");
    emit("agents.assistant-item-delta.v1", {
      runId,
      content: '{"issues":[{"message":"正在核对人物动机',
    });
    await expect(progress).toContainText("正在核对人物动机");
    stage = "failed";
    recoveredContent = '{"content":"保留已返回的片段"}';
    await expect(progress).toContainText("生成片段（未采用）");
    await expect(progress).toContainText("检查前已经生成的正文仍然保留。");
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
