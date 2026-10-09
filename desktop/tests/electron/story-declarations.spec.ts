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
import type { IPTwinSnapshot } from "@dramaip/contracts";

test("正式来源声明实际段落候选与双重审阅采用，后台重启恢复原身份、旧来源及失败缓存拒绝", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-anchored-declarations-"),
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
  ): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        ...(method === "POST"
          ? { "Idempotency-Key": crypto.randomUUID() }
          : {}),
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
      {
        title: "精确声明项目",
        mode: "series_longform",
        modeConfig: { mode: "series_longform" },
      },
    );
    const { project: other } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "不同声明项目" },
    );
    const chapter = await api<{ id: string; version: number; content: string }>(
      "chapters",
      "POST",
      {
        projectId: project.id,
        title: "声明原章",
        content: "实际所选段落保留。\n\nUNSELECTED 不可混入的正文。",
      },
    );
    await open(project.id);
    let panel = page.getByLabel("正式来源声明工作台", { exact: true });
    await panel
      .locator("summary")
      .filter({ hasText: /^从实际原文或精确采用资料创建声明$/ })
      .click();
    const form = panel.getByRole("form", {
      name: "正式来源候选表单",
      exact: true,
    });
    await expect(form.getByLabel("声明原章节", { exact: true })).toBeEnabled();
    await form
      .getByLabel("声明原章节", { exact: true })
      .selectOption(chapter.id);
    const first = form.getByRole("checkbox", {
        name: "选择实际段落 1",
        exact: true,
      }),
      second = form.getByRole("checkbox", {
        name: "选择实际段落 2",
        exact: true,
      });
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();
    await form
      .getByLabel("正式声明名称", { exact: true })
      .fill("实际段落的作者解释");
    await form
      .getByLabel("作者声明解释", { exact: true })
      .fill("PRIVATE 人工解释仍需审阅，不是语义证明。");
    const save = form.getByRole("button", {
      name: "仅保存正式来源候选",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await first.check();
    await expect(save).toBeEnabled();
    const time = {
      storyOrder: 0,
      timeLabel: "PRIVATE TIME 开场前三日",
      interpretation: "author-inferred",
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
    await form
      .getByLabel("事件故事时间标签", { exact: true })
      .fill(time.timeLabel);
    await expect(save).toBeDisabled();
    await form.getByLabel("事件故事时间顺序", { exact: true }).fill("0");
    await expect(save).toBeEnabled();
    let lostResponse = false;
    const candidateRoute = `**/projects/${project.id}/story-declarations`;
    await page.route(candidateRoute, async (route) => {
      if (!lostResponse && route.request().method() === "POST") {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        lostResponse = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await save.click();
    await expect(panel.getByRole("status")).toBeVisible();
    expect(lostResponse).toBe(true);
    await page.unroute(candidateRoute);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      panel.getByLabel("原正式来源声明审阅", { exact: true }),
    ).toContainText("pending");
    let originalId = new URLSearchParams(
      (await page.evaluate(() => window.location.hash)).split("?")[1],
    ).get("storyDeclarationId")!;
    const pending = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations/${originalId}`,
    );
    expect(pending.status).toBe("pending");
    expect(pending.input.eventTimeline).toEqual(time);
    expect(pending.basis.sources[0]!.quote).toBe("实际所选段落保留。");
    expect(JSON.stringify(pending)).not.toContain("UNSELECTED");
    expect(
      (await api<{ nodes: unknown[] }>(`projects/${project.id}/story-graph`))
        .nodes,
    ).toEqual([]);
    let review = panel.getByLabel("原正式来源声明审阅", { exact: true }),
      adopt = review.getByRole("button", {
        name: "明确采用该原声明",
        exact: true,
      });
    await expect(adopt).toBeDisabled();
    await review
      .getByRole("checkbox", {
        name: "我已核对原章节版本、所选来源和实际引文位置",
        exact: true,
      })
      .check();
    await expect(adopt).toBeDisabled();
    await review
      .getByRole("checkbox", {
        name: "我已审阅声明解释；引文存在不等于解释正确",
        exact: true,
      })
      .check();
    await expect(adopt).toBeEnabled();
    await adopt.click();
    await expect(review).toContainText("adopted");
    await expect(review).toContainText(time.timeLabel);
    const applied = await api<StoryDeclaration>(
      `projects/${project.id}/story-declarations/${originalId}`,
    );
    expect(applied).toMatchObject({
      id: pending.id,
      version: 1,
      status: "adopted",
      basis: pending.basis,
      input: pending.input,
    });
    const graph = await api<{
      nodes: Array<{ id: string; sourceId: string; sourceType: string }>;
    }>(`projects/${project.id}/story-graph`);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      id: applied.adoptedNode!.id,
      sourceId: applied.id,
      sourceType: "source-anchored-declaration-v1",
    });
    const snapshot = await api<IPTwinSnapshot>(
      `projects/${project.id}/ip-twin`,
      "POST",
      {},
    );
    expect(snapshot.nodes).toHaveLength(1);
    let writeCount = writes.length;
    expect(writeCount).toBe(3);
    expect(
      (
        await api<{ items: unknown[] }>(
          `projects/${project.id}/story-declarations`,
        )
      ).items,
    ).toHaveLength(1);
    // Success ends the action identity; an explicitly new identical candidate
    // must be distinct from retrying the lost response above.
    await form
      .getByLabel("正式声明名称", { exact: true })
      .fill(pending.input.title);
    await form
      .getByLabel("作者声明解释", { exact: true })
      .fill(pending.input.statement);
    await first.check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      panel.getByLabel("原正式来源声明审阅", { exact: true }),
    ).toContainText("pending");
    const newId = new URLSearchParams(
      (await page.evaluate(() => window.location.hash)).split("?")[1],
    ).get("storyDeclarationId")!;
    expect(newId).not.toBe(originalId);
    expect(
      (
        await api<{ items: unknown[] }>(
          `projects/${project.id}/story-declarations`,
        )
      ).items,
    ).toHaveLength(2);
    expect(
      (await api<{ nodes: unknown[] }>(`projects/${project.id}/story-graph`))
        .nodes,
    ).toHaveLength(1);
    writeCount = writes.length;
    expect(writeCount).toBe(4);
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
    expect(writes).toHaveLength(writeCount);
    await open(project.id, originalId);
    await expect(
      page.getByLabel("原正式来源声明审阅", { exact: true }),
    ).toContainText(applied.id);
    let failedReads = 0;
    await page.route(
      `**/projects/${project.id}/story-declarations/${originalId}`,
      async (route) => {
        if (route.request().method() === "GET") {
          failedReads++;
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await open(other.id, originalId);
    await open(project.id, originalId);
    await expect(
      page.getByLabel("原正式来源声明审阅", { exact: true }),
    ).toContainText("不允许采用旧缓存");
    expect(failedReads).toBeGreaterThan(0);
    expect(writes).toHaveLength(writeCount);
    await page.unroute(
      `**/projects/${project.id}/story-declarations/${originalId}`,
    );
    await panel
      .getByRole("button", { name: "重读实际来源与原声明", exact: true })
      .click();
    await expect(review).toContainText(applied.id);
    await api(`chapters/${chapter.id}`, "PATCH", {
      version: chapter.version,
      content: "作者新的正文；旧声明不能自动改绑。",
    });
    await panel
      .getByRole("button", { name: "重读实际来源与原声明", exact: true })
      .click();
    await expect(review).toContainText("来源 stale");
    await expect(review).toContainText(time.timeLabel);
    await expect(review).toContainText("实际所选段落保留。");
    expect(
      (
        await api<StoryDeclaration>(
          `projects/${project.id}/story-declarations/${originalId}`,
        )
      ).basis,
    ).toEqual(applied.basis);
    const staleSnapshot = await api<IPTwinSnapshot>(
      `projects/${project.id}/ip-twins/${snapshot.id}`,
    );
    expect(staleSnapshot).toMatchObject({
      id: snapshot.id,
      stale: true,
      nodes: snapshot.nodes,
    });
    expect(
      (await api<IPTwinSnapshot>(`projects/${project.id}/ip-twin`, "POST", {}))
        .nodes,
    ).toEqual([]);
    expect(
      (await api<{ content: string }>(`chapters/${chapter.id}`)).content,
    ).toBe("作者新的正文；旧声明不能自动改绑。");
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
      path: resolve("build/story-declaration-source-stale-verified.png"),
    });
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
