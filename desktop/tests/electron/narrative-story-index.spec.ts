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
import type { Chapter } from "@dramaip/contracts/writing";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type {
  NarrativeIndexDetail,
  NarrativeStoryIndex,
  StoryDeclaration,
  StoryAssertion,
} from "@dramaip/contracts/knowledge";

test("来源叙事目录的后台明确选择／当前owner失败保护／实际冻结输入／撤回与重启原身份恢复", async () => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-story-index-e2e-"));
  const modelId = "controlled-story-index-local-v1",
    key = "only-a-controlled-local-fixture-not-a-provider-key";
  const sent: string[] = [],
    errors: string[] = [],
    creationBodies: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/v1/chat/completions" ||
        request.headers.authorization !== `Bearer ${key}`
      )
        throw new Error("Unexpected controlled provider request");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        stream: boolean;
        messages: { role: string; content: string }[];
      };
      if (body.model !== modelId || body.stream !== true)
        throw new Error("Only the explicit loopback model is permitted");
      const prompt = body.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n");
      sent.push(prompt);
      const output = prompt.includes("审阅候选与冻结")
        ? { issues: [] }
        : {
            title: "作者待审阅的续写",
            content: "这是受控候选，不自动采用作者正文。",
            items: [],
          };
      const id = crypto.randomUUID();
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finishReason] of [
        [{ role: "assistant", content: JSON.stringify(output) }, null],
        [{}, "stop"],
      ])
        response.write(
          `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: modelId, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
        );
      response.end("data: [DONE]\n\n");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "Controlled fixture error" } }),
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Loopback fixture unavailable");
  let application: ElectronApplication | undefined,
    page: Page,
    bootstrap: { baseUrl: string; accessToken: string },
    dialogs = 0;
  const hidden = async () =>
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    page.on("dialog", async (dialog) => {
      dialogs++;
      await dialog.dismiss();
    });
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/workflows/creation"
      )
        creationBodies.push(request.postDataJSON());
    });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    bootstrap = await page.evaluate(() => window.runtimeBootstrap.resolve());
    await hidden();
  };
  const api = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        ...(method === "POST"
          ? { "Idempotency-Key": crypto.randomUUID() }
          : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
    return (await response.json()) as T;
  };
  const navigate = (route: string) =>
    page.evaluate((value) => {
      window.location.hash = value;
    }, route);
  const workbench = () => page.getByLabel("AI 本章正文", { exact: true });
  const storyPanel = () =>
    workbench().getByLabel("来源锚定叙事索引", { exact: true });
  const openContext = async () => {
    const summary = workbench()
      .locator("summary")
      .filter({ hasText: "本轮前文来源" });
    if (
      !(await summary
        .locator("..")
        .evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await summary.click();
    await expect(storyPanel()).toBeVisible();
  };
  const openFrozen = async () => {
    const summary = workbench()
      .locator("summary")
      .filter({ hasText: "引用资料 ·" });
    if (
      !(await summary
        .locator("..")
        .evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await summary.click();
    await expect(
      workbench().getByLabel("本轮冻结叙事解释", { exact: true }),
    ).toBeVisible();
  };
  try {
    await launch();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page
      .getByRole("combobox", { name: "服务商", exact: true })
      .selectOption("other");
    await page
      .getByRole("textbox", { name: "服务商名称", exact: true })
      .fill("叙事索引本地受控验收");
    await page
      .getByRole("textbox", { name: "模型名称", exact: true })
      .fill(modelId);
    await page
      .getByRole("textbox", { name: "服务地址", exact: true })
      .fill(`http://127.0.0.1:${address.port}/v1`);
    const capturePromise = application!.waitForEvent("window");
    await page
      .getByRole("button", { name: "添加模型服务商", exact: true })
      .click();
    const capture = await capturePromise;
    await capture.waitForLoadState("domcontentloaded");
    await hidden();
    await capture
      .getByRole("textbox", { name: "安全凭据", exact: true })
      .fill(key);
    await Promise.all([
      capture.waitForEvent("close"),
      capture.getByRole("button", { name: "安全保存", exact: true }).click(),
    ]);
    await page
      .getByLabel("模型服务商 叙事索引本地受控验收", { exact: true })
      .getByRole("button", { name: "设为智能助手模型", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "全局默认引擎", exact: true })
      .selectOption("langgraph");
    await page
      .getByRole("button", { name: "保存全局默认值", exact: true })
      .click();
    await expect(
      page.getByText("全局默认智能引擎已保存", { exact: true }),
    ).toBeVisible();
    const { project } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      {
        title: "人物因果认知解释的独立小说",
        mode: "series_longform",
        modeConfig: { mode: "series_longform" },
      },
    );
    const volumes = [];
    for (const title of ["来源第一卷", "跨章第二卷"])
      volumes.push(
        await api<{ id: string; version: number }>(
          `projects/${project.id}/volumes`,
          "POST",
          { projectId: project.id, title },
        ),
      );
    const first = await api<Chapter>("chapters", "POST", {
      projectId: project.id,
      volumeId: volumes[0]!.id,
      title: "来源章",
      content: "PRIVATE SOURCE 原文不随声明外发。\n\nPRIVATE UNSELECTED 后文。",
    });
    const second = await api<Chapter>("chapters", "POST", {
      projectId: project.id,
      volumeId: volumes[1]!.id,
      title: "跨卷原来源章",
      content: "PRIVATE SECOND 跨章引文不随声明目录外发。",
    });
    const target = await api<Chapter>("chapters", "POST", {
      projectId: project.id,
      title: "待写目标章",
      content: "",
    });
    const detail = await api<NarrativeIndexDetail>(
      `projects/${project.id}/narrative-context-index/chapters/${first.id}`,
    );
    const sources = [
      {
        kind: "paragraphs",
        chapterId: first.id,
        chapterVersion: first.version,
        chapterContentHash: detail.chapter.contentHash,
        paragraphIds: [detail.paragraphs[0]!.id],
      },
    ];
    const secondDetail = await api<NarrativeIndexDetail>(
      `projects/${project.id}/narrative-context-index/chapters/${second.id}`,
    );
    const crossSources = [
      ...sources,
      {
        kind: "paragraphs",
        chapterId: second.id,
        chapterVersion: second.version,
        chapterContentHash: secondDetail.chapter.contentHash,
        paragraphIds: [secondDetail.paragraphs[0]!.id],
      },
    ];
    const arc = await api<{ id: string }>("story-arcs", "POST", {
      projectId: project.id,
      title: "明确跨卷故事弧",
      payload: {
        narrativeChapterScope: {
          format: "chapter-refs-v1",
          chapters: [first, second].map(({ id, version }) => ({ id, version })),
        },
      },
    });
    await api("story-arcs", "POST", {
      projectId: project.id,
      title: "未绑定旧章号弧",
      payload: { startChapter: 1, endChapter: 2 },
    });
    const candidate = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations`,
      "POST",
      {
        kind: "character",
        title: "已确认来源角色",
        statement: "作者确认的角色动机解释，不是原文事实认证。",
        sources,
      },
    );
    const declaration = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations/${candidate.id}/adopt`,
      "POST",
      {
        sourceFingerprint: candidate.basis.fingerprint,
        confirmedSourceReview: true,
        confirmedInterpretationReview: true,
      },
      { "If-Match": candidate.etag },
    );
    const secret = await api<{ id: string; version: number }>(
      `projects/${project.id}/story-graph/nodes`,
      "POST",
      {
        kind: "secret",
        title: "真实秘密端点",
        summary: "PRIVATE ENDPOINT 不随名称外发。",
        sourceType: "manual",
        sourceId: project.id,
        sourceVersion: 0,
        confirmed: true,
      },
    );
    for (const kind of ["relationship", "cognition"] as const) {
      const value = await api<StoryAssertion>(
        `projects/${project.id}/story-assertions`,
        "POST",
        {
          kind,
          title: `已确认${kind}解释`,
          statement: `${kind}明确作者解释，不能升级为整章覆盖。`,
          interpretation: "author-inferred",
          sources: crossSources,
          ...(kind === "relationship"
            ? {
                from: declaration.adoptedNode!,
                to: { id: secret.id, version: secret.version },
                relation: "reveals",
                confidence: 0.7,
              }
            : {
                subject: { kind: "character", node: declaration.adoptedNode! },
                target: { id: secret.id, version: secret.version },
                storyOrder: 3,
                state: "suspects",
              }),
        },
      );
      await api(
        `projects/${project.id}/story-assertions/${value.id}/adopt`,
        "POST",
        {
          sourceFingerprint: value.basis.fingerprint,
          confirmedSourceReview: true,
          confirmedInterpretationReview: true,
        },
        { "If-Match": value.etag },
      );
    }
    const eventTimeline = {
      storyOrder: 0,
      timeLabel: "回忆：开场前三日",
      interpretation: "author-inferred",
    };
    const eventCandidate = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations`,
      "POST",
      {
        kind: "event",
        title: "跨卷事件故事时间",
        statement: "作者确认事件在开场前，时间解释不是文学语义证明。",
        sources: crossSources,
        eventTimeline,
      },
    );
    const event = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations/${eventCandidate.id}/adopt`,
      "POST",
      {
        sourceFingerprint: eventCandidate.basis.fingerprint,
        confirmedSourceReview: true,
        confirmedInterpretationReview: true,
      },
      { "If-Match": eventCandidate.etag },
    );
    const pending = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations`,
      "POST",
      {
        kind: "event",
        title: "未采用来源候选",
        statement: "候选不能自动进入上下文。",
        sources,
      },
    );
    const catalog = await api<NarrativeStoryIndex>(
      `projects/${project.id}/narrative-story-index`,
    );
    const chosen = catalog.entries.filter(
      (entry) => entry.eligibility.state === "eligible",
    );
    expect(chosen).toHaveLength(4);
    const route = `#/projects/${project.id}?chapterId=${target.id}`;
    await navigate(route);
    await expect(workbench()).toBeVisible();
    await openContext();
    await storyPanel()
      .getByRole("button", {
        name: "读取人物／因果／认知来源目录",
        exact: true,
      })
      .click();
    for (const entry of chosen) {
      const checkbox = storyPanel().getByLabel(
        `纳入叙事声明 ${entry.selection.id}`,
        { exact: true },
      );
      await expect(checkbox).toBeEnabled();
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
    }
    await expect(
      storyPanel().getByLabel(`纳入叙事声明 ${pending.id}`, { exact: true }),
    ).toBeDisabled();
    await expect(storyPanel()).not.toContainText("PRIVATE SOURCE");
    await expect(storyPanel()).not.toContainText("PRIVATE ENDPOINT");
    await expect(workbench()).toContainText("明确选择 0 章 + 4 条叙事解释");
    const timeline = () =>
      storyPanel().getByRole("table", {
        name: "来源事件时间线",
        exact: true,
      });
    await expect(timeline()).toContainText(eventTimeline.timeLabel);
    await expect(timeline()).toContainText("事件故事时间顺序 0");
    await expect(timeline()).toContainText("时间未标注");
    await expect(timeline()).toContainText(first.id);
    await expect(timeline()).toContainText(second.id);
    await timeline().screenshot({
      path: test.info().outputPath("story-index-authored-event-timeline.png"),
    });
    await expect(storyPanel()).toContainText("当前全书／卷／显式故事弧目录");
    await expect(
      storyPanel().locator(`[data-story-group="story-arc:${arc.id}"]`),
    ).toContainText("当前目录");
    await expect(storyPanel()).toContainText("未绑定旧章号弧");
    const table = storyPanel().getByRole("table", {
      name: "来源关系与认知结构表",
      exact: true,
    });
    await expect(table).toContainText("原章节 来源章 v0");
    await expect(table).toContainText("原章节 跨卷原来源章 v0");
    await expect(table).toContainText("来源第一卷");
    await expect(table).toContainText("跨章第二卷");
    await expect(table).toContainText("已确认来源角色 v0");
    await expect(table).toContainText("真实秘密端点 v0");
    await expect(table).toContainText("人工声明顺序 3");
    const storageKey = `dramaip-novel-context:${project.id}:${target.id}`;
    const originalSelection = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      storageKey,
    );
    expect(originalSelection).toEqual({
      format: "narrative-context-v1",
      chapters: [],
      story: chosen.map((entry) => entry.selection),
    });
    await storyPanel()
      .getByLabel("叙事目录层级筛选", { exact: true })
      .selectOption(`volume:${volumes[1]!.id}`);
    await expect(storyPanel().locator("[data-story-index-id]")).toHaveCount(3);
    await expect(timeline()).toContainText(eventTimeline.timeLabel);
    await expect(timeline()).toContainText(first.id);
    await expect(storyPanel()).toContainText("筛选外仍有 1 个原选择");
    await expect(table).toContainText(first.id);
    await expect(table).toContainText(second.id);
    await storyPanel()
      .getByLabel("叙事索引结构展示", { exact: true })
      .selectOption("cognition");
    await expect(storyPanel().locator("[data-story-index-id]")).toHaveCount(1);
    await expect(table).toContainText("怀疑");
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storageKey,
      ),
    ).toEqual(originalSelection);
    await table.screenshot({
      path: test.info().outputPath("story-index-cross-volume-cognition.png"),
    });
    expect(
      await table.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await table.locator("[data-story-structured-connection]").screenshot({
      path: test
        .info()
        .outputPath("story-index-cognition-direction-readable.png"),
    });
    await table.locator("[data-story-structured-origins]").screenshot({
      path: test
        .info()
        .outputPath("story-index-cognition-full-origins-readable.png"),
    });
    await storyPanel()
      .getByLabel("叙事目录层级筛选", { exact: true })
      .selectOption("");
    await storyPanel()
      .getByLabel("叙事索引结构展示", { exact: true })
      .selectOption("all");
    expect(sent).toHaveLength(0);
    expect(creationBodies).toHaveLength(0);
    await storyPanel().screenshot({
      path: test.info().outputPath("story-index-explicit-selection.png"),
    });
    const pattern = `**/api/v2/projects/${project.id}/narrative-story-index`;
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...catalog,
          hierarchy: {
            state: "unavailable",
            projectId: project.id,
            reason: "基础叙事目录归属暂不可完整核对，未换源或认定为空范围。",
          },
        }),
      }),
    );
    await storyPanel()
      .getByRole("button", {
        name: "读取人物／因果／认知来源目录",
        exact: true,
      })
      .click();
    await expect(storyPanel()).toContainText(
      "当前章节／卷／故事弧归属未完整核对",
    );
    await expect(storyPanel().locator("[data-story-group]")).toHaveCount(0);
    await expect(storyPanel().locator("[data-story-index-id]")).toHaveCount(5);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storageKey,
      ),
    ).toEqual(originalSelection);
    await page.unroute(pattern);
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://dramaip.local/problems/controlled-index-read",
          status: 503,
          title: "Controlled index read failure",
          detail: "本次目录无法完整核对",
          code: "CONTROLLED_INDEX_READ",
          traceId: crypto.randomUUID(),
        }),
      }),
    );
    await storyPanel()
      .getByRole("button", {
        name: "读取人物／因果／认知来源目录",
        exact: true,
      })
      .click();
    await expect(storyPanel()).toContainText("旧缓存不作为本次选择依据");
    await expect(storyPanel().locator("[data-story-index-id]")).toHaveCount(0);
    await expect(timeline()).toHaveCount(0);
    await expect(
      storyPanel().getByRole("button", { name: "移除此原选择", exact: true }),
    ).toHaveCount(4);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storageKey,
      ),
    ).toEqual(originalSelection);
    await storyPanel().screenshot({
      path: test.info().outputPath("story-index-owner-read-failed.png"),
    });
    await page.unroute(pattern);
    await storyPanel()
      .getByRole("button", {
        name: "读取人物／因果／认知来源目录",
        exact: true,
      })
      .click();
    await expect(storyPanel().locator("[data-story-index-id]")).toHaveCount(5);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v2/workflows/creation",
    );
    await workbench()
      .getByRole("button", { name: "生成并检查本章正文", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status(), await response.text()).toBe(200);
    const started = (await response.json()) as CreationWorkflow;
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 30_000 },
    );
    expect(creationBodies).toHaveLength(1);
    expect(creationBodies[0]!.narrativeContextRequest).toEqual(
      originalSelection,
    );
    const workflow = await api<CreationWorkflow>(
      `workflows/creation/${started.id}`,
    );
    expect(
      workflow.narrativeContextBasis?.story?.map((source) => source.selection),
    ).toEqual(originalSelection.story);
    expect(workflow.narrativeContextBasis?.chapters).toEqual([]);
    expect(workflow.narrativeContextBasis?.omitted).toEqual([
      { id: first.id, version: first.version, reason: "not-selected" },
      { id: second.id, version: second.version, reason: "not-selected" },
    ]);
    expect((await api<Chapter>(`chapters/${target.id}`)).content).toBe("");
    expect(sent.length).toBeGreaterThan(0);
    for (const prompt of sent) {
      expect(prompt).toContain(eventTimeline.timeLabel);
      for (const entry of chosen) expect(prompt).toContain(entry.statement);
      expect(prompt).not.toContain("PRIVATE SOURCE");
      expect(prompt).not.toContain("PRIVATE ENDPOINT");
      expect(prompt).not.toContain("PRIVATE SECOND");
      expect(prompt).not.toContain(pending.input.statement);
    }
    const frozen = workbench().getByLabel("本轮冻结叙事解释", { exact: true });
    await openFrozen();
    await expect(frozen).toContainText("本轮冻结叙事解释 4 条");
    const runSnapshots = [];
    for (const runId of workflow.runIds) {
      const snapshot = await api<{
        entries: Array<{
          sourceId: string;
          sourceVersion: number;
          included: boolean;
          value: unknown;
        }>;
        finalPrompt: string;
      }>(`agent-runs/${runId}/context-snapshot`);
      expect(
        snapshot.entries.find((entry) => entry.sourceId === event.id),
      ).toMatchObject({
        sourceVersion: event.version,
        included: true,
        value: { eventTimeline },
      });
      expect(snapshot.finalPrompt).toContain(eventTimeline.timeLabel);
      runSnapshots.push(snapshot);
    }
    for (const entry of chosen)
      await expect(frozen).toContainText(
        `${entry.selection.id} v${entry.selection.version}`,
      );
    await frozen.screenshot({
      path: test.info().outputPath("story-index-original-input-frozen.png"),
    });
    await api(
      `projects/${project.id}/story-declarations/${declaration.id}/withdraw`,
      "POST",
      {
        lifecycleVersion: declaration.lifecycle!.version,
        record: declaration.lifecycle!.record,
        reason: "明确撤回原来源角色解释，不自动重连",
        confirmedRetirementReview: true,
      },
      { "If-Match": declaration.etag },
    );
    await workbench()
      .getByRole("button", { name: "放弃 AI 草稿", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "已放弃",
    );
    await openContext();
    await storyPanel()
      .getByRole("button", {
        name: "读取人物／因果／认知来源目录",
        exact: true,
      })
      .click();
    await expect(storyPanel()).toContainText("已撤回");
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storageKey,
      ),
    ).toEqual(originalSelection);
    await storyPanel().screenshot({
      path: test
        .info()
        .outputPath("story-index-withdrawn-original-selection.png"),
    });
    const calls = sent.length;
    await hidden();
    await application!.close();
    application = undefined;
    await launch();
    await navigate(`${route}&workflowId=${workflow.id}`);
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "已放弃",
    );
    await openFrozen();
    await expect(
      workbench().getByLabel("本轮冻结叙事解释", { exact: true }),
    ).toContainText(`declaration ${declaration.id} v${declaration.version}`);
    await openContext();
    await expect(storyPanel()).toContainText("已撤回");
    await storyPanel()
      .getByRole("button", {
        name: "读取人物／因果／认知来源目录",
        exact: true,
      })
      .click();
    await expect(timeline()).toContainText(eventTimeline.timeLabel);
    for (const [index, runId] of workflow.runIds.entries())
      expect(await api(`agent-runs/${runId}/context-snapshot`)).toEqual(
        runSnapshots[index],
      );
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storageKey,
      ),
    ).toEqual(originalSelection);
    expect(
      (await api<CreationWorkflow>(`workflows/creation/${workflow.id}`))
        .narrativeContextBasis,
    ).toEqual(workflow.narrativeContextBasis);
    expect(sent).toHaveLength(calls);
    expect(creationBodies).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(dialogs).toBe(0);
    await hidden();
    await workbench()
      .getByLabel("本轮冻结叙事解释", { exact: true })
      .screenshot({
        path: test.info().outputPath("story-index-restart-original-frozen.png"),
      });
  } finally {
    if (application) await application.close();
    server.closeAllConnections();
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
    await rm(userData, { recursive: true, force: true });
  }
});
