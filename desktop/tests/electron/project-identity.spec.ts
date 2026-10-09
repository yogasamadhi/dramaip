import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";

test("小说普通项目页不把错误项目、章节或参数替换成缓存原稿", async ({}, info) => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-project-identity-"));
  const application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  const manager = new ServerConnectionManager();
  let releasePendingRead: (() => void) | undefined;
  try {
    const page = await application.firstWindow();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    const client = createStudioClient(manager.createTransport());
    const { project } = await client.projects.create({
      title: "小说精确原项目",
    });
    const { project: other } = await client.projects.create({
      title: "不能替代的其他小说",
    });
    const original = await client.chapters.create({
      projectId: project.id,
      title: "指定本章",
      content: "PRIVATE 原项目的唯一正文，不能借错误地址读取。",
    });
    const second = await client.chapters.create({
      projectId: project.id,
      title: "另选的实际本章",
      content: "PRIVATE 同项目第二章的实际正文。",
    });
    const foreign = await client.chapters.create({
      projectId: other.id,
      title: "其他项目本章",
      content: "PRIVATE 其他项目正文不可冒充当前本章。",
    });
    const originals = await client.chapters.list(project.id);
    const navigate = (route: string) =>
      page.evaluate((value) => {
        window.location.hash = value;
      }, route);
    const body = (content: string) =>
      page.locator("main").getByText(content, { exact: true });
    const originalRoute = `/projects/${project.id}?chapterId=${original.id}`;
    await navigate(originalRoute);
    await expect(body(original.content)).toBeVisible();
    await navigate(`/projects/${project.id}?chapterId=${second.id}`);
    await expect(body(second.content)).toBeVisible();
    await navigate(originalRoute);
    await expect(body(original.content)).toBeVisible();
    const wrong = [
      `/projects/${crypto.randomUUID()}?chapterId=${original.id}`,
      `/projects/${project.id}?chapterId=${foreign.id}`,
      `/projects/${project.id}?chapterId=${crypto.randomUUID()}`,
      `/projects/${project.id}?chapterId=${original.id}&chapterId=${second.id}`,
      `/projects/${project.id}?chapterId=`,
      `/projects/${project.id}?chapterId=${original.id}&projectId=${other.id}`,
    ];
    for (const route of wrong) {
      await navigate(route);
      for (const chapter of [original, second, foreign])
        await expect(body(chapter.content)).toHaveCount(0);
      expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(
        route,
      );
      await expect(page.locator("main").getByRole("alert")).toContainText(
        /指定|归属|读取|身份|未找到/,
      );
    }
    await navigate(originalRoute);
    await expect(body(original.content)).toBeVisible();
    // Delay only the real GET reply, not its authoritative data. A read that
    // completes after returning to the original project must not replace it.
    let signalRead: () => void;
    const pendingRead = new Promise<void>((resolveRead) => {
      signalRead = resolveRead;
    });
    const resumeRead = new Promise<void>((resolveRead) => {
      releasePendingRead = resolveRead;
    });
    const delayedRoute = `**/api/v2/projects/${other.id}`;
    let signalReply: () => void;
    const replied = new Promise<void>((resolveReply) => {
      signalReply = resolveReply;
    });
    await page.route(delayedRoute, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      signalRead();
      await resumeRead;
      await route.fulfill({ response });
      signalReply();
    });
    await navigate(`/projects/${other.id}?chapterId=${foreign.id}`);
    await pendingRead;
    await expect(body(original.content)).toHaveCount(0);
    await navigate(originalRoute);
    await expect(body(original.content)).toBeVisible();
    releasePendingRead!();
    await replied;
    await page.unroute(delayedRoute);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(body(original.content)).toBeVisible();
    await expect(body(foreign.content)).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(
      originalRoute,
    );
    expect(await client.chapters.list(project.id)).toEqual(originals);
    expect(await client.chapters.get(foreign.id)).toEqual(foreign);
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("exact-project-chapter.png"),
    });
  } finally {
    releasePendingRead?.();
    manager.disconnect();
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
