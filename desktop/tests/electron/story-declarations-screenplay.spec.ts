import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StoryDeclaration } from "@dramaip/contracts/knowledge";
import type { ScreenplaySource } from "@dramaip/contracts/production";

test("直接剧本无需小说，后台实际块候选／双重审阅／请求重放／重启和旧来源保护", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-script-declaration-e2e-"),
  );
  let application: ElectronApplication | undefined,
    page: Page,
    bootstrap: { baseUrl: string; accessToken: string },
    dialogs = 0;
  const writes: string[] = [];
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
        request.url().includes("/story-declarations")
      )
        writes.push(new URL(request.url()).pathname);
    });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    bootstrap = await page.evaluate(() => window.runtimeBootstrap.resolve());
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  };
  const api = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        ...(method === "POST"
          ? { "Idempotency-Key": crypto.randomUUID() }
          : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
    return (await response.json()) as T;
  };
  const open = async (projectId: string, declarationId?: string) => {
    await page.evaluate(
      (query) => {
        window.location.hash = `#/create?${query}`;
      },
      new URLSearchParams({
        projectId,
        ...(declarationId ? { storyDeclarationId: declarationId } : {}),
      }).toString(),
    );
    await expect(
      page.getByLabel("正式来源声明工作台", { exact: true }),
    ).toHaveAttribute("data-project-id", projectId);
  };
  try {
    await launch();
    const { project } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "纯剧本声明项目" },
    );
    const { project: other } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "不同实际项目" },
    );
    const script = await api<{ id: string }>("scripts", "POST", {
      projectId: project.id,
      title: "原直接剧本",
      payload: {
        剧本内容:
          "INT. SAVED ROOM - DAY\n\nSELECTED 实际剧本动作。\n\nUNSELECTED 后文不能混入声明。",
      },
    });
    expect(await api(`projects/${project.id}/chapters`)).toEqual([]);
    await open(project.id);
    let panel = page.getByLabel("正式来源声明工作台", { exact: true });
    await panel
      .locator("summary")
      .filter({ hasText: /^从实际原文或精确采用资料创建声明$/ })
      .click();
    await panel
      .getByLabel("声明来源类型", { exact: true })
      .selectOption("screenplay");
    let form = panel.getByRole("form", {
      name: "正式剧本来源草稿表单",
      exact: true,
    });
    await expect(form.getByLabel("声明原剧本", { exact: true })).toBeEnabled();
    await expect(form.getByLabel("声明原剧本", { exact: true })).toHaveValue(
      "",
    );
    await form
      .getByLabel("声明原剧本", { exact: true })
      .selectOption(script.id);
    const selected = form.getByRole("checkbox", {
        name: "选择实际剧本块 2",
        exact: true,
      }),
      omitted = form.getByRole("checkbox", {
        name: "选择实际剧本块 3",
        exact: true,
      });
    await expect(selected).not.toBeChecked();
    await expect(omitted).not.toBeChecked();
    await form
      .getByLabel("正式声明名称", { exact: true })
      .fill("剧本实际动作解释");
    await form
      .getByLabel("作者声明解释", { exact: true })
      .fill("PRIVATE 作者解释仍需审阅，不是语义证明。");
    const save = form.getByRole("button", {
      name: "仅保存正式来源草稿",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await selected.check();
    await expect(save).toBeEnabled();
    const time = {
      storyOrder: 2,
      timeLabel: "PRIVATE TIME 第二日黄昏",
      interpretation: "source-stated",
    };
    await expect(
      form.getByRole("checkbox", {
        name: "明确标注此事件的故事时间",
        exact: true,
      }),
    ).not.toBeChecked();
    await form
      .getByRole("checkbox", { name: "明确标注此事件的故事时间", exact: true })
      .check();
    await expect(save).toBeDisabled();
    await form.getByLabel("事件故事时间顺序", { exact: true }).fill("2");
    await form
      .getByLabel("事件故事时间标签", { exact: true })
      .fill(time.timeLabel);
    await form
      .getByLabel("事件时间解释来源", { exact: true })
      .selectOption("source-stated");
    await expect(save).toBeEnabled();
    let lost = false;
    const routePath = `**/projects/${project.id}/story-declarations`;
    await page.route(routePath, async (route) => {
      if (!lost && route.request().method() === "POST") {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        lost = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await save.click();
    await expect(panel.getByRole("status")).toBeVisible();
    expect(lost).toBe(true);
    await page.unroute(routePath);
    await expect(save).toBeEnabled();
    await save.click();
    let review = panel.getByLabel("原正式来源声明审阅", { exact: true });
    await expect(review).toContainText("pending");
    const originalId = new URLSearchParams(
      (await page.evaluate(() => window.location.hash)).split("?")[1],
    ).get("storyDeclarationId")!;
    const pending = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations/${originalId}`,
    );
    expect(pending.basis.sources[0]!.quote).toBe("SELECTED 实际剧本动作。");
    expect(pending.input.eventTimeline).toEqual(time);
    expect(pending.basis.sources[0]!.anchors[0]).toMatchObject({
      blockIndex: 1,
      blockType: "action",
    });
    expect(pending.basis.sources[0]!.anchors[0]).not.toHaveProperty(
      "paragraphIds",
    );
    expect(JSON.stringify(pending)).not.toContain("UNSELECTED");
    expect(
      (await api<{ nodes: unknown[] }>(`projects/${project.id}/story-graph`))
        .nodes,
    ).toEqual([]);
    let adopt = review.getByRole("button", {
      name: "明确采用该原声明",
      exact: true,
    });
    await expect(adopt).toBeDisabled();
    await review.getByRole("checkbox").first().check();
    await expect(adopt).toBeDisabled();
    await review.getByRole("checkbox").nth(1).check();
    await expect(adopt).toBeEnabled();
    await adopt.click();
    await expect(review).toContainText("adopted");
    const applied = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations/${originalId}`,
    );
    expect(applied.basis).toEqual(pending.basis);
    expect(applied.input).toEqual(pending.input);
    expect(applied.adoptedNode).toBeDefined();
    const writeCount = writes.length;
    expect(writeCount).toBe(3);
    const originalSource = await api<ScreenplaySource>(
      `projects/${project.id}/screenplay-sources/${script.id}`,
    );
    if (originalSource.source.state !== "available")
      throw new Error("Saved source unavailable");
    await application!.close();
    application = undefined;
    await launch();
    await open(project.id, originalId);
    panel = page.getByLabel("正式来源声明工作台", { exact: true });
    review = panel.getByLabel("原正式来源声明审阅", { exact: true });
    await expect(review).toContainText(applied.id);
    await expect(review).toContainText("adopted");
    await expect(review).toContainText(time.timeLabel);
    await expect(review.getByRole("checkbox").first()).not.toBeChecked();
    expect(writes).toHaveLength(writeCount);
    await open(other.id, originalId);
    await expect(
      page.getByLabel("原正式来源声明审阅", { exact: true }),
    ).toContainText("不替换为本项目最新声明");
    await open(project.id, originalId);
    await expect(review).toContainText(applied.id);
    await panel
      .getByLabel("声明来源类型", { exact: true })
      .selectOption("screenplay");
    form = panel.getByRole("form", {
      name: "正式剧本来源草稿表单",
      exact: true,
    });
    await form
      .getByLabel("声明原剧本", { exact: true })
      .selectOption(script.id);
    await expect(
      form.getByLabel("可选实际剧本块", { exact: true }),
    ).toBeVisible();
    let failed = 0;
    const sourceRoute = `**/projects/${project.id}/screenplay-sources/${script.id}`;
    await page.route(sourceRoute, async (route) => {
      failed++;
      await route.abort("failed");
    });
    await panel
      .getByRole("button", { name: "重读实际来源与原声明", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("旧缓存不作为当前依据");
    await expect(
      form.getByLabel("可选实际剧本块", { exact: true }),
    ).toHaveCount(0);
    await expect(
      form.getByRole("button", { name: "仅保存正式来源草稿", exact: true }),
    ).toBeDisabled();
    expect(failed).toBeGreaterThan(0);
    await page.unroute(sourceRoute);
    await api(
      `scripts/${script.id}/screenplay`,
      "PATCH",
      {
        version: originalSource.source.document.version,
        blocks: originalSource.source.document.blocks.map((block) =>
          "text" in block && block.text.includes("SELECTED 实际")
            ? { ...block, text: "CHANGED 新剧本动作。" }
            : block,
        ),
      },
      { "If-Match": `"${originalSource.source.document.version}"` },
    );
    await panel
      .getByRole("button", { name: "重读实际来源与原声明", exact: true })
      .click();
    await expect(review).toContainText("来源 stale");
    await expect(review).toContainText(time.timeLabel);
    await expect(review).toContainText("SELECTED 实际剧本动作。");
    expect(
      (
        await api<StoryDeclaration>(
          `projects/${project.id}/story-declarations/${originalId}`,
        )
      ).basis,
    ).toEqual(applied.basis);
    expect(
      (
        await api<{ nodes: unknown[] }>(
          `projects/${project.id}/ip-twin`,
          "POST",
          {},
        )
      ).nodes,
    ).toEqual([]);
    expect(await api(`projects/${project.id}/chapters`)).toEqual([]);
    expect(writes).toHaveLength(writeCount);
    expect(dialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
    await review.screenshot({
      path: resolve("build/story-declaration-screenplay-stale-verified.png"),
    });
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
