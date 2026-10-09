import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AuthorIntent,
  AuthorIntentCurrent,
  AuthorIntentPage,
} from "@dramaip/contracts/workspace";

test("作者意图未保存编辑跨项目与后台重启恢复原基准，来源变化不自动重绑，明确清空不改候选或正式内容", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-author-intent-draft-"),
  );
  let application: ElectronApplication | undefined;
  let page: Page;
  let bootstrap: { baseUrl: string; accessToken: string };
  const launch = async () => {
    const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1800, height: 1100 });
    bootstrap = await page.evaluate(() => window.runtimeBootstrap.resolve());
  };
  const json = async <T>(
    path: string,
    body?: unknown,
    headers = {},
    method?: string,
  ): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
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
    return (await response.json()) as T;
  };
  const open = async (id: string) => {
    await page.evaluate((route) => {
      window.location.hash = route;
    }, `#/projects/${id}/tools/author-intent`);
    await expect(
      page.getByLabel("正式作者意图工作台", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("作品主题", { exact: true })).toBeEnabled();
  };
  try {
    await launch();
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const first = (
      await json<{ project: { id: string; version: number } }>("projects", {
        title: "仅本机编辑的作品",
        mode: "series_longform",
      })
    ).project;
    const second = (
      await json<{ project: { id: string; version: number } }>("projects", {
        title: "另一份编辑的作品",
        mode: "series_longform",
      })
    ).project;
    const originalSecond = await json(`projects/${second.id}`);
    const values = {
      作品主题: "PRIVATE 未保存的作者原意",
      情绪承诺: "不强制反转，保留迟疑",
      目标受众: "温和成长小说读者",
      叙事声音与风格: "克制生活化",
      必须保留: "第一条\n\n未写完的第二条：",
    };
    await open(first.id);
    for (const [label, value] of Object.entries(values))
      await page.getByLabel(label, { exact: true }).fill(value);
    await expect(
      page.getByLabel("作者意图本地草稿状态", { exact: true }),
    ).toContainText("已保存到本机");
    await open(second.id);
    await expect(page.getByLabel("作品主题", { exact: true })).toHaveValue("");
    await page
      .getByLabel("作品主题", { exact: true })
      .fill("PRIVATE 第二份作品，不串入第一份");
    await open(first.id);
    for (const [label, value] of Object.entries(values))
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    expect(
      (await json<AuthorIntentPage>(`projects/${first.id}/author-intents`))
        .items,
    ).toEqual([]);
    expect(
      (await json<AuthorIntentCurrent>(`projects/${first.id}/author-intent`))
        .current,
    ).toBeUndefined();
    await json(
      `projects/${first.id}`,
      {
        version: first.version,
        synopsis: "项目来源已明确改变，但不替作者刷新编辑基准。",
      },
      { "If-Match": `"${first.version}"` },
      "PATCH",
    );
    await application!.close();
    application = undefined;
    await launch();
    await open(first.id);
    for (const [label, value] of Object.entries(values))
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    const panel = page.getByLabel("正式作者意图工作台", { exact: true });
    await expect(panel).toContainText(`冻结项目版本 ${first.version}`);
    await expect(panel.getByRole("alert")).toContainText("来源已变化");
    expect(
      (await json<AuthorIntentCurrent>(`projects/${first.id}/author-intent`))
        .current,
    ).toBeUndefined();
    await panel
      .getByRole("button", { name: "清空本地编辑草稿", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "清空本地意图编辑草稿",
      exact: true,
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByLabel("作品主题", { exact: true })).toHaveValue(
      values["作品主题"],
    );
    await panel
      .getByRole("button", { name: "清空本地编辑草稿", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "清空本地意图编辑草稿",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "确认清空编辑草稿", exact: true })
      .click();
    await expect(page.getByLabel("作品主题", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("必须保留", { exact: true })).toHaveValue("");
    await open(second.id);
    await expect(page.getByLabel("作品主题", { exact: true })).toHaveValue(
      "PRIVATE 第二份作品，不串入第一份",
    );
    expect(await json(`projects/${second.id}`)).toEqual(originalSecond);
    for (const id of [first.id, second.id])
      expect(
        (await json<AuthorIntentPage>(`projects/${id}/author-intents`)).items,
      ).toEqual([]);
    await application!.close();
    application = undefined;
    await launch();
    await open(first.id);
    await expect(page.getByLabel("作品主题", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("必须保留", { exact: true })).toHaveValue("");
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("正式作者意图经差异预览、明确采用、来源冲突与重启恢复，待确认返回精确版本且不改作者稿", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-author-intent-"));
  let application: ElectronApplication | undefined;
  let page: Page;
  let bootstrap: { baseUrl: string; accessToken: string };
  const launch = async () => {
    const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1800, height: 1100 });
    bootstrap = await page.evaluate(() => window.runtimeBootstrap.resolve());
  };
  // Actual Runtime calls seed authors' existing content and inspect receipts.
  // Candidate preview/adoption/discard below use the normal UI, without mocks.
  const json = async <T>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    method?: string,
  ): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
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
    return (await response.json()) as T;
  };
  const open = async (path: string) => {
    await page.evaluate((route) => {
      window.location.hash = route;
    }, `#${path}`);
  };
  const confirm = async (accept: boolean) => {
    const dialog = page.getByRole("dialog", {
      name: /^(采用作者意图|放弃作者意图候选)$/,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", {
        name: accept ? /^(确认采用|确认放弃)$/ : "取消",
        exact: true,
      })
      .click();
    await expect(dialog).not.toBeVisible();
  };
  try {
    await launch();
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const first = (
      await json<{ project: { id: string; version: number } }>("projects", {
        title: "旧书店作者意图",
        mode: "series_longform",
        targetAudience: "温和成长小说读者",
        emotionalCore: "学会求助，不把迟疑当成失败",
        styleGuide: "【主题】旧标题不得被自动解析为正式主题",
      })
    ).project;
    const other = (
      await json<{ project: { id: string; version: number } }>("projects", {
        title: "另一份作品",
        mode: "series_longform",
      })
    ).project;
    const chapter = await json<{
      id: string;
      content: string;
      version: number;
    }>("chapters", {
      projectId: first.id,
      title: "第一章",
      content: "作者原稿：小禾把铜钥匙交给阿桥，请他保管到明天。",
    });
    const originalProject = await json(`projects/${first.id}`);
    const tool = `/projects/${first.id}/tools/author-intent`;
    await open(tool);
    const panel = () => page.getByLabel("正式作者意图工作台", { exact: true });
    const preview = () =>
      panel().getByLabel("指定作者意图预览", { exact: true });
    await expect(panel()).toContainText("尚无正式采用版本");
    await panel()
      .getByRole("button", { name: "带入旧项目字段（待确认）", exact: true })
      .click();
    await expect(panel().getByLabel("作品主题", { exact: true })).toHaveValue(
      "",
    );
    await expect(panel().getByLabel("目标受众", { exact: true })).toHaveValue(
      "温和成长小说读者",
    );
    await panel()
      .getByLabel("作品主题", { exact: true })
      .fill("PRIVATE 学会求助也可以保有自己的节奏");
    await panel()
      .getByLabel("叙事声音与风格", { exact: true })
      .fill("克制、生活化，不强制短剧化");
    await panel()
      .getByLabel("必须保留", { exact: true })
      .fill("母女关系\n铜钥匙的保管与归还");
    await panel()
      .getByLabel("允许改变", { exact: true })
      .fill("可以合并次要客人");
    await panel()
      .getByLabel("必须避免", { exact: true })
      .fill("不强制机械反转");
    await panel()
      .getByRole("button", { name: "保存意图候选并预览差异", exact: true })
      .click();
    await expect(preview()).toContainText("等待审阅采用");
    await expect(preview()).toContainText("PRIVATE 学会求助");
    const firstIntentId = (
      await json<AuthorIntentPage>(`projects/${first.id}/author-intents`)
    ).items[0]!.id;
    expect(
      (await json<AuthorIntentCurrent>(`projects/${first.id}/author-intent`))
        .current,
    ).toBeUndefined();
    await preview()
      .getByRole("button", { name: "确认采用此作者意图", exact: true })
      .click();
    await confirm(false);
    expect(
      (await json<AuthorIntent>(`author-intents/${firstIntentId}`)).status,
    ).toBe("pending");

    await open(`/pending?projectId=${first.id}`);
    const pending = () =>
      page.locator(`[data-confirmation-key="author-intent:${firstIntentId}"]`);
    await expect(pending()).toContainText("作者意图候选");
    await expect(pending()).not.toContainText("PRIVATE");
    await pending()
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(preview()).toHaveAttribute(
      "data-intent-preview-id",
      firstIntentId,
    );
    await application!.close();
    application = undefined;
    await launch();
    await open(`${tool}?intentId=${firstIntentId}`);
    await expect(preview()).toContainText("等待审阅采用");
    expect(
      (await json<AuthorIntentCurrent>(`projects/${first.id}/author-intent`))
        .current,
    ).toBeUndefined();
    await preview()
      .getByRole("button", { name: "确认采用此作者意图", exact: true })
      .click();
    await confirm(true);
    await expect(panel().locator("[data-current-intent-id]")).toHaveAttribute(
      "data-current-intent-id",
      firstIntentId,
    );
    const adopted = await json<AuthorIntent>(`author-intents/${firstIntentId}`);
    expect(adopted).toMatchObject({
      status: "adopted",
      isCurrent: true,
      version: 1,
      content: {
        endingContract: "",
        mustKeep: ["母女关系", "铜钥匙的保管与归还"],
      },
      source: {
        kind: "legacy-project",
        legacyFields: { styleGuide: "【主题】旧标题不得被自动解析为正式主题" },
      },
    });
    expect(await json(`projects/${first.id}`)).toEqual(originalProject);
    expect(await json(`chapters/${chapter.id}`)).toMatchObject(chapter);

    await panel()
      .getByRole("button", { name: "基于当前正式版本创建候选", exact: true })
      .click();
    await panel()
      .getByLabel("作品主题", { exact: true })
      .fill("PRIVATE 第二份候选等待核对");
    await panel()
      .getByRole("button", { name: "保存意图候选并预览差异", exact: true })
      .click();
    await expect(preview()).toContainText("PRIVATE 第二份候选");
    const secondId = (
      await json<AuthorIntentPage>(`projects/${first.id}/author-intents`)
    ).items[0]!.id;
    const before = await json<AuthorIntent>(`author-intents/${secondId}`);
    await json(
      `projects/${first.id}`,
      { version: first.version, targetAudience: "作者重新确认的新受众" },
      { "If-Match": `"${first.version}"` },
      "PATCH",
    );
    // An already-open panel must react to the real project event, without reload.
    await expect(preview().getByRole("alert")).toContainText(
      "不能直接采用旧候选",
    );
    await expect(
      preview().getByRole("button", {
        name: "确认采用此作者意图",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await json<AuthorIntent>(`author-intents/${secondId}`),
    ).toMatchObject({
      status: "pending",
      sourceState: "stale",
      stateVersion: before.stateVersion,
      updatedAt: before.updatedAt,
    });
    await open(`/pending?projectId=${first.id}`);
    await page.getByRole("tab", { name: /需要处理/ }).click();
    const staleItem = page.locator(
      `[data-confirmation-key="author-intent:${secondId}"]`,
    );
    await expect(staleItem).toContainText("意图来源或正式版本已变化");
    await staleItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(preview()).toHaveAttribute("data-intent-preview-id", secondId);
    await preview()
      .getByRole("button", { name: "放弃此意图候选", exact: true })
      .click();
    await confirm(true);
    await expect(preview()).toContainText("已放弃");
    expect(
      (await json<AuthorIntentCurrent>(`projects/${first.id}/author-intent`))
        .current?.id,
    ).toBe(firstIntentId);
    expect(await json(`chapters/${chapter.id}`)).toMatchObject(chapter);
    await open(
      `/projects/${other.id}/tools/author-intent?intentId=${firstIntentId}`,
    );
    await expect(panel().getByRole("alert")).toContainText("不属于此项目");
    await expect(
      panel().getByLabel("指定作者意图预览", { exact: true }),
    ).toHaveCount(0);
    await expect(panel()).not.toContainText("PRIVATE 学会求助");
    await application!.close();
    application = undefined;
    await launch();
    await open(`${tool}?intentId=${firstIntentId}`);
    await expect(panel().locator("[data-current-intent-id]")).toHaveAttribute(
      "data-current-intent-id",
      firstIntentId,
    );
    await expect(preview()).toContainText("PRIVATE 学会求助");
    expect(
      (await json<AuthorIntent>(`author-intents/${secondId}`)).status,
    ).toBe("discarded");
    await open(`/pending?projectId=${first.id}`);
    await expect(
      page.getByRole("heading", { name: "待确认中心", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-confirmation-key^="author-intent:"]'),
    ).toHaveCount(0);
    expect(await json(`chapters/${chapter.id}`)).toMatchObject(chapter);
    expect(await json(`scripts?projectId=${first.id}`)).toEqual([]);
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
