import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  CreationWorkflow,
  CreationRebaseRequest,
} from "@dramaip/contracts/creation";
import type {
  ScreenplayBlock,
  ScreenplayDocument,
} from "@dramaip/contracts/production";

test("真实剧本块正文与排序分别确认，已成功丢回复的原请求后台重启精确重发，再明确采用（受控接口）", async () => {
  test.setTimeout(150000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-script-order-e2e-"));
  const model = "controlled-script-order-v1",
    credential = "only-local-controlled-fixture";
  let candidate: ScreenplayBlock[] = [];
  const calls: string[] = [],
    errors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/v1/chat/completions" ||
        request.headers.authorization !== `Bearer ${credential}`
      )
        throw new Error("unexpected fixture request");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        stream: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      if (body.model !== model || !body.stream)
        throw new Error("wrong configured controlled model");
      const prompt = body.messages
        .filter((v) => v.role === "user")
        .map((v) => v.content)
        .join("\n");
      calls.push(prompt);
      const output = prompt.includes("审阅候选与冻结")
        ? { issues: [] }
        : {
            title: "完整稳定块修订候选",
            content: candidate
              .map((v) => ("text" in v ? v.text : ""))
              .join("\n\n"),
            items: candidate.map((v) => ({
              ref: v.id,
              kind: "screenplay-block",
              title: v.type,
              data: v,
            })),
          };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finish_reason] of [
        [{ role: "assistant", content: JSON.stringify(output) }, null],
        [{}, "stop"],
      ])
        response.write(
          `data: ${JSON.stringify({ id: "controlled-script-order", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      response.end("data: [DONE]\n\n");
    } catch (cause) {
      errors.push(String(cause));
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: errors.at(-1) } }));
    }
  });
  await new Promise<void>((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("loopback fixture missing");
  let running: { application: ElectronApplication; page: Page } | undefined;
  const launch = async () => {
    const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
    const application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1800, height: 1200 });
    return { application, page };
  };
  const request = async <T>(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    headers: Record<string, string> = {},
  ): Promise<T> => {
    const bootstrap = await running!.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        ...(body === undefined
          ? {}
          : { "Idempotency-Key": crypto.randomUUID() }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
    return response.json() as Promise<T>;
  };
  try {
    running = await launch();
    let { page, application } = running;
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page
      .getByRole("combobox", { name: "服务商", exact: true })
      .selectOption("other");
    await page
      .getByRole("textbox", { name: "服务商名称", exact: true })
      .fill("本地受控剧本合并接口");
    await page
      .getByRole("textbox", { name: "模型名称", exact: true })
      .fill(model);
    await page
      .getByRole("textbox", { name: "服务地址", exact: true })
      .fill(`http://127.0.0.1:${address.port}/v1`);
    const capturePromise = application.waitForEvent("window");
    await page
      .getByRole("button", { name: "添加模型服务商", exact: true })
      .click();
    const capture = await capturePromise;
    await capture.waitForLoadState("domcontentloaded");
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          visible: window.isVisible(),
          focused: window.isFocused(),
        })),
      ),
    ).toEqual([
      { visible: false, focused: false },
      { visible: false, focused: false },
    ]);
    await capture
      .getByRole("textbox", { name: "安全凭据", exact: true })
      .fill(credential);
    await Promise.all([
      capture.waitForEvent("close"),
      capture.getByRole("button", { name: "安全保存", exact: true }).click(),
    ]);
    await page
      .getByLabel("模型服务商 本地受控剧本合并接口", { exact: true })
      .getByRole("button", { name: "设为智能助手模型", exact: true })
      .click();
    await expect(page.getByText(/本地受控剧本合并接口：.*已/)).toBeVisible();
    await page
      .getByRole("combobox", { name: "全局默认引擎", exact: true })
      .selectOption("langgraph");
    await page
      .getByRole("button", { name: "保存全局默认值", exact: true })
      .click();
    await expect(
      page.getByText("全局默认智能引擎已保存", { exact: true }),
    ).toBeVisible();
    const { project } = await request<{ project: { id: string } }>("projects", {
      title: "完整稳定块合并",
      mode: "single_season",
      modeConfig: { mode: "single_season", entryPath: "script" },
      synopsis: "直接剧本修订，不先写小说，不生成媒体。",
    });
    const adaptation = await request<{ id: string }>("adaptations", {
      projectId: project.id,
      title: "单季作者剧本",
    });
    const episode = await request<{ id: string }>("episodes", {
      projectId: project.id,
      parentId: adaptation.id,
      title: "第一集",
    });
    const script = await request<{ id: string; version: number }>("scripts", {
      projectId: project.id,
      parentId: episode.id,
      title: "作者原稿",
      payload: {
        剧本内容:
          "INT. ROOM - NIGHT\n\n林晚推门。\n\n雨声停了。\n\n林晚取出信。",
      },
    });
    const doc = await request<ScreenplayDocument>(
      `scripts/${script.id}/screenplay`,
    );
    expect(doc.blocks).toHaveLength(4);
    const [h, a, b, c] = doc.blocks as [
      ScreenplayBlock,
      ScreenplayBlock,
      ScreenplayBlock,
      ScreenplayBlock,
    ];
    const text = (v: ScreenplayBlock, value: string): ScreenplayBlock => {
      if (v.type === "page_break") throw new Error("textual fixture required");
      return { ...v, text: value };
    };
    const x: ScreenplayBlock = {
        id: crypto.randomUUID(),
        type: "action",
        text: "仅当前稿新增的独立证据。",
      },
      y: ScreenplayBlock = {
        id: crypto.randomUUID(),
        type: "action",
        text: "仅候选新增的独立线索。",
      };
    const branchA = text(a, "候选为归还信件推门。"),
      mainB = text(b, "当前稿独立修改雨声。"),
      branchC = text(c, "候选独立修改取信动机。");
    candidate = [h, branchA, y, b, branchC];
    const route = `#/adapt?projectId=${project.id}&scriptId=${script.id}&stage=scripts`;
    await page.evaluate((value) => {
      window.location.hash = value;
    }, route);
    let panel = page.getByLabel("AI 剧本修订", { exact: true });
    await expect(
      panel.getByRole("button", { name: "生成并检查剧本修订", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "生成并检查剧本修订", exact: true })
      .click();
    await expect(panel.getByText("等待审阅采用", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const original = (
      await request<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${project.id}&targetId=${script.id}`,
      )
    ).items[0]!;
    expect(original.stage).toBe("awaiting-review");
    // An actual read primes this original candidate. A later owner failure
    // must not leave the cached body or its adoption controls usable.
    const originalHeading = () =>
      panel.getByRole("heading", {
        name: "完整稳定块修订候选",
        exact: true,
      });
    await expect(originalHeading()).toBeVisible();
    const beforeOwnerFailure = calls.length;
    let originalReads = 0;
    const originalOwnerPath = `**/api/v2/workflows/creation/${original.id}`;
    let releaseOriginalRead!: () => void;
    const heldOriginalRead = new Promise<void>((resolveRead) => {
      releaseOriginalRead = resolveRead;
    });
    await page.route(originalOwnerPath, async (intercepted) => {
      originalReads += 1;
      await heldOriginalRead;
      await intercepted.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Original owner read unavailable",
          status: 503,
          detail: "本次原运行读取不可用",
        }),
      });
    });
    // Remount the same original identity with its cache already populated.
    // A held first GET is not an actual read of this mount.
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${project.id}/tools`);
    await expect(panel).toHaveCount(0);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route);
    await expect.poll(() => originalReads).toBeGreaterThan(0);
    await expect(originalHeading()).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "采用", exact: true }),
    ).toHaveCount(0);
    await expect(panel).toContainText("未恢复缓存 AI 草稿或重新生成");
    releaseOriginalRead();
    await expect(panel.getByRole("alert")).toContainText("原运行");
    await expect(
      panel.getByRole("button", { name: "采用", exact: true }),
    ).toHaveCount(0);
    expect(calls).toHaveLength(beforeOwnerFailure);
    expect(
      (await request<CreationWorkflow>(`workflows/creation/${original.id}`))
        .stage,
    ).toBe("awaiting-review");
    await page.screenshot({
      path: test.info().outputPath("shared-workbench-owner-failed-cache.png"),
    });
    await page.unroute(originalOwnerPath);
    await expect(originalHeading()).toBeVisible();
    expect(calls).toHaveLength(beforeOwnerFailure);
    let previewReads = 0;
    const originalPreviewPath = `**/api/v2/change-previews/${original.previewId}`;
    await page.route(originalPreviewPath, async (intercepted) => {
      previewReads += 1;
      await intercepted.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Original preview read unavailable",
          status: 503,
          detail: "本次原预览读取不可用",
        }),
      });
    });
    await expect.poll(() => previewReads).toBeGreaterThan(0);
    await expect(originalHeading()).toHaveCount(0);
    await expect(panel.getByRole("alert")).toContainText("原预览");
    await expect(
      panel.getByRole("button", { name: "采用", exact: true }),
    ).toHaveCount(0);
    expect(calls).toHaveLength(beforeOwnerFailure);
    expect(
      (await request<CreationWorkflow>(`workflows/creation/${original.id}`))
        .stage,
    ).toBe("awaiting-review");
    await page.screenshot({
      path: test.info().outputPath("shared-workbench-preview-failed-cache.png"),
    });
    await page.unroute(originalPreviewPath);
    await expect(originalHeading()).toBeVisible();
    // A successful GET with another task is not the original preview either.
    let wrongPreviewReads = 0;
    await page.route(originalPreviewPath, async (intercepted) => {
      wrongPreviewReads += 1;
      const response = await intercepted.fetch();
      const actual = await response.json();
      await intercepted.fulfill({
        response,
        json: { ...actual, taskId: crypto.randomUUID() },
      });
    });
    await expect.poll(() => wrongPreviewReads).toBeGreaterThan(0);
    await expect(originalHeading()).toHaveCount(0);
    await expect(panel.getByRole("alert")).toContainText(
      "实际身份／任务／目标不符",
    );
    await expect(
      panel.getByRole("button", { name: "采用", exact: true }),
    ).toHaveCount(0);
    expect(calls).toHaveLength(beforeOwnerFailure);
    await page.unroute(originalPreviewPath);
    await expect(originalHeading()).toBeVisible();
    // The record workbench must not be mounted from the previous target cache
    // while its own original script GET is held or fails on this mount.
    let targetReads = 0;
    let releaseTargetRead!: () => void;
    const heldTargetRead = new Promise<void>((resolveRead) => {
      releaseTargetRead = resolveRead;
    });
    const targetOwnerPath = `**/api/v2/scripts/${script.id}`;
    await page.route(targetOwnerPath, async (intercepted) => {
      targetReads += 1;
      await heldTargetRead;
      await intercepted.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Original target read unavailable",
          status: 503,
          detail: "本次实际创作对象读取不可用",
        },
      });
    });
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${project.id}/tools`);
    await expect(panel).toHaveCount(0);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route);
    await expect.poll(() => targetReads).toBeGreaterThan(0);
    await expect(panel).toHaveCount(0);
    releaseTargetRead();
    await expect.poll(() => page.getByRole("alert").count()).toBeGreaterThan(0);
    await expect(panel).toHaveCount(0);
    expect(calls).toHaveLength(beforeOwnerFailure);
    await page.unroute(targetOwnerPath);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${project.id}/tools`);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route);
    await expect(originalHeading()).toBeVisible();
    // The actual task entry reads the original RunCard too, not the newest run.
    const taskRoute = `#/tasks?projectId=${project.id}&workflowId=${original.id}&taskId=${original.taskId}`;
    const taskObject = page.getByLabel("对应待确认对象", { exact: true });
    const taskHeading = () =>
      taskObject.getByRole("heading", {
        name: "完整稳定块修订候选",
        exact: true,
      });
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, taskRoute);
    await expect(taskHeading()).toBeVisible();
    let taskReads = 0;
    let releaseTaskRead!: () => void;
    const heldTaskRead = new Promise<void>((resolveRead) => {
      releaseTaskRead = resolveRead;
    });
    await page.route(originalOwnerPath, async (intercepted) => {
      taskReads += 1;
      await heldTaskRead;
      await intercepted.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Original task workflow read unavailable",
          status: 503,
          detail: "本次原任务运行读取不可用",
        },
      });
    });
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${project.id}/tools`);
    await expect(taskObject).toHaveCount(0);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, taskRoute);
    await expect.poll(() => taskReads).toBeGreaterThan(0);
    await expect(taskHeading()).toHaveCount(0);
    releaseTaskRead();
    await expect(taskObject.getByRole("alert")).toBeVisible();
    await expect(taskHeading()).toHaveCount(0);
    expect(calls).toHaveLength(beforeOwnerFailure);
    expect(
      (await request<CreationWorkflow>(`workflows/creation/${original.id}`))
        .stage,
    ).toBe("awaiting-review");
    await page.unroute(originalOwnerPath);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${project.id}/tools`);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, taskRoute);
    await expect(taskHeading()).toBeVisible();
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route);
    await expect(originalHeading()).toBeVisible();
    expect(calls).toHaveLength(beforeOwnerFailure);
    await request(
      `scripts/${script.id}/screenplay`,
      {
        version: doc.version,
        blocks: [h, text(a, "当前稿为寻找姐姐推门。"), x, mainB, c],
      },
      "PATCH",
      { "If-Match": `"${doc.version}"` },
    );
    await panel.getByRole("button", { name: "采用", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "剧本已有变化，请确认合并",
      exact: true,
    });
    await expect(dialog).toContainText("排序存在冲突");
    const mergeButton = dialog.getByRole("button", {
      name: "合并并复检",
      exact: true,
    });
    await expect(mergeButton).toBeDisabled();
    await dialog
      .getByRole("combobox", { name: "剧本冲突块选择", exact: true })
      .selectOption("branch");
    await dialog
      .getByRole("button", { name: "以 AI 草稿块顺序为排序起点", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "上移合并块 6", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "上移合并块 5", exact: true })
      .click();
    const order = dialog.getByLabel("剧本完整块顺序核对", { exact: true });
    expect(
      await order
        .locator("ol > li")
        .evaluateAll((elements) =>
          elements.map(
            (el) =>
              el.querySelector("p")!.textContent!.match(/[a-f0-9-]{36}/u)![0],
          ),
        ),
    ).toEqual([h.id, a.id, y.id, x.id, b.id, c.id]);
    await expect(mergeButton).toBeDisabled();
    await dialog
      .getByRole("checkbox", {
        name: "我已逐项核对完整块顺序（含增删与位置）；不代表语义安全",
        exact: true,
      })
      .check();
    await expect(mergeButton).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath("script-merge-order-confirmation.png"),
    });
    const posts: Array<{ key: string; input: CreationRebaseRequest }> = [];
    await page.route(
      `**/api/v2/workflows/creation/${original.id}/rebase`,
      async (intercepted) => {
        posts.push({
          key: intercepted.request().headers()["idempotency-key"]!,
          input: intercepted.request().postDataJSON(),
        });
        const response = await intercepted.fetch();
        expect(response.status()).toBe(200);
        await intercepted.abort("failed"); // The real server already committed; only the reply is lost.
      },
    );
    await mergeButton.click();
    await expect(
      panel.getByLabel("原剧本合并请求恢复", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => posts.length).toBe(1);
    const pendingKey = `dramaip-script-merge-request:${project.id}:${script.id}`;
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), pendingKey),
      )
      .not.toBeNull();
    expect(posts[0]!.input.blockOrder).toEqual([
      h.id,
      a.id,
      y.id,
      x.id,
      b.id,
      c.id,
    ]);
    const merged = (
      await request<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${project.id}&targetId=${script.id}`,
      )
    ).items.find((v) => v.sourceWorkflowId === original.id)!;
    await expect
      .poll(
        async () =>
          (await request<CreationWorkflow>(`workflows/creation/${merged.id}`))
            .stage,
        { timeout: 30000 },
      )
      .toBe("awaiting-review");
    const requestsBefore = (
      await request<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${project.id}`,
      )
    ).items
      .map((v) => v.id)
      .sort();
    await application.close();
    running = await launch();
    ({ page, application } = running);
    await page.evaluate((value) => {
      window.location.hash = value;
    }, route);
    panel = page.getByLabel("AI 剧本修订", { exact: true });
    const recovery = panel.getByLabel("原剧本合并请求恢复", { exact: true });
    await expect(recovery).toContainText(original.id);
    await expect(recovery).toContainText("不会自动重发");
    const recoverPosts: Array<{ key: string; input: CreationRebaseRequest }> =
      [];
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().endsWith(`/workflows/creation/${original.id}/rebase`)
      )
        recoverPosts.push({
          key: req.headers()["idempotency-key"]!,
          input: req.postDataJSON(),
        });
    });
    await recovery
      .getByRole("button", { name: "重发原合并请求并核对回执", exact: true })
      .click();
    await expect(recovery).toHaveCount(0);
    expect(recoverPosts).toEqual(posts);
    expect(
      (
        await request<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${project.id}`,
        )
      ).items
        .map((v) => v.id)
        .sort(),
    ).toEqual(requestsBefore);
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        pendingKey,
      ),
    ).toBeNull();
    await expect(
      panel.getByText("等待审阅采用", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "采用", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await request<CreationWorkflow>(`workflows/creation/${merged.id}`))
            .stage,
      )
      .toBe("applied");
    expect(
      (await request<ScreenplayDocument>(`scripts/${script.id}/screenplay`))
        .blocks,
    ).toEqual([h, branchA, y, x, mainB, branchC]);
    expect(calls.filter((v) => !v.includes("审阅候选与冻结"))).toHaveLength(1);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("script-merge-order-adopted.png"),
    });
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await running?.application.close();
    server.closeAllConnections();
    await new Promise<void>((resolvePromise, reject) =>
      server.close((cause) => (cause ? reject(cause) : resolvePromise())),
    );
    await rm(userData, { recursive: true, force: true });
  }
});
