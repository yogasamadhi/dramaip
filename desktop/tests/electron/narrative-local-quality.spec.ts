import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";

test("独立本地人工／规则质量：无模型、丢回复原请求后台重启、明确采用、原 GET 失败不回填缓存及来源失效", async ({}, info) => {
  test.setTimeout(120000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-native-local-quality-e2e-"),
  );
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined,
    page: Page,
    client: StudioClient;
  const diagnostics: string[] = [];
  let blockedModelWrites = 0,
    nativeDialogs = 0,
    fullHistoryReads = 0;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    application
      .process()
      .stdout?.on("data", (chunk) => diagnostics.push(String(chunk)));
    application
      .process()
      .stderr?.on("data", (chunk) => diagnostics.push(String(chunk)));
    page = await application.firstWindow();
    page.on("dialog", async (dialog) => {
      nativeDialogs++;
      await dialog.dismiss();
    });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    await page.route(
      "**/api/v2/projects/*/narrative-local-reviews",
      (route) => {
        if (route.request().method() === "GET") fullHistoryReads++;
        return route.continue();
      },
    );
    for (const pattern of [
      "**/api/v2/workflows/creation",
      "**/api/v2/workflows/creation/*/actions",
      "**/api/v2/agent-context/previews",
      "**/api/v2/provider-action-previews/*/execute",
    ])
      await page.route(pattern, (route) => {
        if (route.request().method() === "GET") return route.continue();
        blockedModelWrites++;
        return route.abort();
      });
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  };
  const close = async () => {
    manager?.disconnect();
    manager = undefined;
    await application?.close();
    application = undefined;
  };
  const navigate = (path: string) =>
    page.evaluate((route) => {
      window.location.hash = route;
    }, `#${path}`);
  const panel = () => page.getByLabel("独立本地质量评议", { exact: true });
  const confirm = async (label: string) => {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: label, exact: true })
      .click();
  };
  const allocations = () => {
    const result = spawnSync(
      "node",
      [
        "scripts/run-node.mjs",
        "--input-type=module",
        "--eval",
        'import { DatabaseSync } from "node:sqlite";const db=new DatabaseSync(process.argv[1],{readOnly:true});const tables=["automation_creation_workflows","automation_tasks","agent_context_previews","agent_context_snapshots","narrative_quality_reports"];console.log(JSON.stringify(Object.fromEntries(tables.map(table=>[table,db.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]))));db.close();',
        join(userData, "dramaip.db"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim());
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "无需模型的人工评议小说",
      mode: "series_longform",
      modeConfig: { mode: "series_longform" },
    });
    const paragraph =
      "作者仍须判断动机、叙事和节奏，程序不会认证文学质量。这里保存的完整原文字段是独立小说正文，既不要求分集，也不要求模型或媒体。";
    const chapter = await client!.chapters.create({
      projectId: project.id,
      title: "明确原目标",
      content: `${paragraph}\n\n${paragraph}`,
    });
    const before = allocations();
    await navigate(`/projects/${project.id}/tools/quality-review`);
    await page
      .getByRole("combobox", { name: "质量检查目标", exact: true })
      .selectOption(`chapter:${chapter.id}`);
    await page
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await panel()
      .getByRole("button", { name: "读取并确认本地完整来源", exact: true })
      .click();
    await confirm("确认此完整本地来源");
    await panel()
      .getByRole("textbox", { name: "人工评议总结", exact: true })
      .fill("作者独立声明：这不是语义认证或模型意见。");
    await panel()
      .getByRole("button", { name: "添加人工问题", exact: true })
      .click();
    await panel()
      .getByRole("combobox", { name: "人工问题 1 维度", exact: true })
      .selectOption("causality");
    await panel()
      .getByRole("combobox", { name: "人工问题 1 程度", exact: true })
      .selectOption("error");
    await panel()
      .getByRole("textbox", { name: "人工问题 1 说明", exact: true })
      .fill("作者需要核对动机");
    await panel()
      .getByRole("textbox", { name: "人工问题 1 建议", exact: true })
      .fill("只记录问题，不改正文");
    const field = panel().getByRole("combobox", {
      name: "人工问题 1 原字段",
      exact: true,
    });
    await field.selectOption({ index: 1 });
    await panel()
      .getByRole("textbox", { name: "人工问题 1 引文", exact: true })
      .fill(paragraph);
    let droppedKey: string | undefined;
    await page.route(
      `**/api/v2/projects/${project.id}/narrative-local-reviews`,
      async (route) => {
        if (route.request().method() !== "POST" || droppedKey)
          return route.continue();
        droppedKey = route.request().headers()["idempotency-key"];
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        return route.abort("failed");
      },
    );
    await panel()
      .getByRole("button", { name: "保存人工声明草稿", exact: true })
      .click();
    await confirm("确认保存人工草稿");
    await expect(
      panel().getByRole("button", {
        name: "恢复并重发原本地请求",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        client!.narrativeQuality
          .localList(project.id)
          .then((page) => page.items.length),
      )
      .toBe(1);
    const original = (await client!.narrativeQuality.localList(project.id))
      .items[0]!;
    expect(original.origin).toBe("human-declared");
    expect(droppedKey).toBeTruthy();
    await close();
    await launch();
    await navigate(`/projects/${project.id}/tools/quality-review`);
    await panel()
      .getByRole("button", { name: "恢复并重发原本地请求", exact: true })
      .click();
    const record = () =>
      panel().locator(`[data-local-quality-review-id="${original.id}"]`);
    await expect(record()).toBeVisible();
    await expect(
      record().getByText("作者独立声明：这不是语义认证或模型意见。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await client!.narrativeQuality.localList(project.id)).items,
    ).toHaveLength(1);
    expect(await client!.chapters.get(chapter.id)).toEqual(chapter);
    await navigate("/pending?category=waiting");
    const pendingOriginal = page.locator(
      `[data-confirmation-key="narrative-local-review:${original.id}"]`,
    );
    await expect(pendingOriginal).toContainText("人工声明评议候选");
    await expect(pendingOriginal).toContainText("质量未认证");
    await expect(pendingOriginal).not.toContainText(paragraph);
    await expect(pendingOriginal).not.toContainText(original.content.summary);
    await pendingOriginal
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`localReviewId=${original.id}$`));
    await expect(record()).toBeVisible();
    await record()
      .getByRole("button", { name: "采用本地评议记录", exact: true })
      .click();
    await confirm("确认采用本地记录");
    await expect(record().getByRole("heading", { level: 3 })).toContainText(
      "当前采用位置",
    );
    // A newer genuinely clean adopted head cannot hide the older adopted
    // error. The global read model carries no private body or fake workflow.
    const cleanSource = await client!.narrativeQuality.localPreview(
      project.id,
      original.source.basis.request,
    );
    let clean = await client!.narrativeQuality.localCreate(
      project.id,
      {
        origin: "human-declared",
        request: cleanSource.basis.request,
        sourceFingerprint: cleanSource.sourceFingerprint,
        baseReviewId: cleanSource.baseReviewId,
        confirmed: true,
        content: {
          summary: "PRIVATE newer clean declaration",
          reviewedDimensions: cleanSource.basis.request.dimensions,
          issues: [],
        },
      },
      crypto.randomUUID(),
    );
    clean = await client!.narrativeQuality.localDecide(
      clean.id,
      { version: clean.version, action: "adopt", confirmed: true },
      crypto.randomUUID(),
    );
    await navigate("/pending?category=attention");
    await expect(pendingOriginal).toContainText("1 项待处理");
    await expect(
      page.locator(
        `[data-confirmation-key="narrative-local-review:${clean.id}"]`,
      ),
    ).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(
      "PRIVATE newer clean declaration",
    );
    const summaryPath = `**/api/v2/projects/${project.id}/narrative-local-review-summaries*`;
    await page.route(summaryPath, async (route) => {
      if (new URL(route.request().url()).searchParams.has("cursor"))
        return route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "https://dramaip.local/problems/controlled-read",
            title: "后页原owner不可用",
            status: 503,
            code: "CONTROLLED_READ",
            traceId: crypto.randomUUID(),
          }),
        });
      const response = await route.fetch(),
        value = await response.json();
      const first = value.items[0];
      return route.fulfill({
        response,
        json: { projectId: project.id, items: [first], nextCursor: first.id },
      });
    });
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "本地人工／规则评议" }),
    ).toBeVisible();
    await expect(pendingOriginal).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /需要处理/ })).toContainText(
      "未核全",
    );
    await page.unroute(summaryPath);
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect(pendingOriginal).toBeVisible();
    await pendingOriginal.scrollIntoViewIfNeeded();
    await pendingOriginal.screenshot({
      path: info.outputPath("native-pending-original-metadata.png"),
    });
    await pendingOriginal
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(record()).toBeVisible();
    const issue = record().locator("[data-local-quality-issue-id]");
    const issueId = await issue.getAttribute("data-local-quality-issue-id");
    expect(issueId).toBeTruthy();
    await issue
      .getByRole("textbox", { name: `本地问题 ${issueId} 的说明`, exact: true })
      .fill("作者明确接受风险，不代表修复。");
    await issue
      .getByRole("button", { name: "声明接受风险", exact: true })
      .click();
    await confirm("确认记录声明");
    await expect(
      issue.locator("[data-local-quality-disposition]"),
    ).toHaveAttribute("data-local-quality-disposition", "accepted-risk");
    await record().scrollIntoViewIfNeeded();
    await record().screenshot({
      path: info.outputPath("native-human-original.png"),
    });
    await page.route(
      `**/api/v2/narrative-local-reviews/${original.id}`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "https://dramaip.local/problems/controlled-read",
            title: "原本地 owner 读取不可用",
            detail: "原本地 owner 读取不可用",
            status: 503,
            code: "CONTROLLED_READ",
            traceId: crypto.randomUUID(),
          }),
        }),
    );
    await expect(record()).toHaveCount(0);
    await expect(panel().getByRole("alert")).toContainText(
      "原本地 owner 读取不可用",
    );
    await page.unroute(`**/api/v2/narrative-local-reviews/${original.id}`);
    await expect(record()).toBeVisible();
    await panel()
      .getByRole("button", { name: "读取并确认本地完整来源", exact: true })
      .click();
    await confirm("确认此完整本地来源");
    await panel()
      .getByRole("button", { name: "运行本地重复段落规则", exact: true })
      .click();
    await confirm("确认运行本地规则");
    await expect(
      panel().getByRole("heading", { name: /本地逐字重复规则 · v0/ }),
    ).toBeVisible();
    await expect(
      panel().getByText(/规则语义覆盖：未评估；未检出重复不代表质量通过。/u),
    ).toBeVisible();
    const all = (await client!.narrativeQuality.localList(project.id)).items;
    expect(all).toHaveLength(3);
    expect(all.find((value) => value.origin === "rule")?.qualityState).toBe(
      "unverified",
    );
    await navigate(
      `/projects/${project.id}/tools/quality-review?localReviewId=${original.id}`,
    );
    await expect(record()).toBeVisible();
    await client!.chapters.update(chapter.id, {
      version: chapter.version,
      content: "作者已经修改正式原文，不自动换用新内容。",
    });
    await expect(
      panel().getByRole("button", { name: "查看原记录新状态", exact: true }),
    ).toBeVisible();
    await panel()
      .getByRole("button", { name: "查看原记录新状态", exact: true })
      .click();
    await expect(record()).toContainText("原来源失效，仅保留历史");
    expect(
      (await client!.narrativeQuality.localGet(original.id)).source.references,
    ).toEqual(original.source.references);
    await navigate(
      `/projects/${project.id}/tools/quality-review?localReviewId=${original.id}&localReviewId=${original.id}`,
    );
    await expect(record()).toHaveCount(0);
    await expect(panel()).toContainText("链接重复／空白／非法");
    const foreign = (
      await client!.projects.create({ title: "不能串用原本地记录" })
    ).project;
    await navigate(
      `/projects/${foreign.id}/tools/quality-review?localReviewId=${original.id}`,
    );
    await expect(record()).toHaveCount(0);
    await expect(panel()).toContainText("项目或身份不符");
    expect(allocations()).toEqual(before);
    expect(blockedModelWrites).toBe(0);
    expect(nativeDialogs).toBe(0);
    expect(fullHistoryReads).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await close();
    await info.attach("native-local-diagnostics", {
      body: diagnostics.join("\n"),
      contentType: "text/plain",
    });
    await rm(userData, { recursive: true, force: true });
  }
});
