import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import type { ProjectInput } from "@dramaip/contracts/product";

for (const variant of ["novel", "adaptation", "direct"] as const) {
  test(`首页 ${variant} 真实读取失败不沿用缓存推荐生成，原稿仍可打开且后台重启可恢复`, async ({}, info) => {
    test.setTimeout(150_000);
    const userData = await mkdtemp(join(tmpdir(), "dramaip-home-progress-"));
    let application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    let manager = new ServerConnectionManager();
    const attemptedWrites: string[] = [];
    try {
      let page = await application.firstWindow();
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      await manager.attach({
        ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
        source: "spawned",
      });
      const client = createStudioClient(manager.createTransport());
      const input: ProjectInput =
        variant === "novel"
          ? { title: "首页真实小说", mode: "series_longform" }
          : {
              title: `首页真实 ${variant}`,
              mode: "single_season",
              modeConfig: {
                mode: "single_season",
                entryPath: variant === "direct" ? "script" : "source-import",
              },
            };
      const { project } = await client.projects.create(input);
      // This is an actual author-owned manuscript, not a generated adoption.
      const chapter = await client.chapters.create({
        projectId: project.id,
        title: "仍可打开的作者原稿",
        content: "PRIVATE 作者原稿，读取错误不能成为继续生成或采用的授权。",
      });
      const originalProject = await client.projects.get(project.id);
      const originalChapters = await client.chapters.list(project.id);
      const originalWorkflows = await client.creation.list(project.id);
      const originalTasks = await client.tasks.list();
      const navigate = (route: string) =>
        page.evaluate((value) => {
          window.location.hash = value;
        }, route);
      const card = () => page.getByLabel("继续当前项目", { exact: true });
      const observeReadsOnly = async () => {
        await page.route("**/api/v2/**", (route) => {
          const method = route.request().method();
          const path = new URL(route.request().url()).pathname;
          // AppRoot syncs only the isolated native window's theme on mounts.
          // This existing Host command is not a business/content mutation.
          if (
            ["GET", "OPTIONS"].includes(method) ||
            (method === "POST" && path === "/api/v2/system/host/window/theme")
          )
            return route.continue();
          attemptedWrites.push(`${method} ${path}`);
          return route.abort();
        });
      };
      await observeReadsOnly();
      await navigate(`/projects/${project.id}?chapterId=${chapter.id}`);
      await expect(
        page.getByRole("navigation", { name: "当前项目导航", exact: true }),
      ).toBeVisible();
      await navigate("/");
      await expect(
        card().getByText("推荐原因：", { exact: false }),
      ).toBeVisible();
      const normalAction = await card()
        .getByRole("link")
        .first()
        .getAttribute("href");
      const domainPath =
        variant === "novel"
          ? `projects/${project.id}/chapter-adoptions**`
          : variant === "adaptation"
            ? `projects/${project.id}/diagnosis-sources**`
            : `projects/${project.id}/episode-development-sources**`;
      const paths = [
        `projects/${project.id}/production-graph`,
        "tasks",
        ...(variant === "novel" ? [`projects/${project.id}/chapters`] : []),
        domainPath,
      ];
      for (const [index, path] of paths.entries()) {
        let failedReads = 0;
        const pattern = `**/api/v2/${path}`;
        await navigate(`/tasks?projectId=${project.id}`);
        await page.route(pattern, (route) => {
          failedReads++;
          return route.abort("failed");
        });
        // The real QueryClient cache lasts five seconds. Let it become stale
        // without reaching into React internals or fabricating a response.
        await page.waitForTimeout(5_200);
        await navigate("/");
        await expect
          .poll(() => failedReads, { timeout: 10_000 })
          .toBeGreaterThan(0);
        await expect(card().getByRole("alert")).toContainText(
          "项目进度尚未核验",
          { timeout: 10_000 },
        );
        await expect(
          card().getByText("推荐原因：", { exact: false }),
        ).toHaveCount(0);
        const safeOpen = card().getByRole("link", {
          name: "打开已有项目",
          exact: true,
        });
        await expect(safeOpen).toHaveAttribute(
          "href",
          `#/projects/${project.id}`,
        );
        await expect(card().getByRole("link")).toHaveCount(1);
        expect(await page.evaluate(() => window.location.hash)).toBe("#/");
        await card().screenshot({
          path: info.outputPath(`${variant}-read-failed-${index}.png`),
        });
        await safeOpen.click();
        await expect(
          page.getByRole("navigation", { name: "当前项目导航", exact: true }),
        ).toBeVisible();
        if (variant === "novel" && !path.endsWith("/chapters"))
          await expect(
            page.locator("main").getByText(chapter.content, { exact: true }),
          ).toBeVisible();
        await page.unroute(pattern);
        await navigate("/");
        await expect(
          card().getByText("推荐原因：", { exact: false }),
        ).toBeVisible();
        await expect(card().getByRole("alert")).toHaveCount(0);
        expect(
          await card().getByRole("link").first().getAttribute("href"),
        ).toBe(normalAction);
      }
      expect(attemptedWrites).toEqual([]);
      expect(await client.projects.get(project.id)).toEqual(originalProject);
      expect(await client.chapters.list(project.id)).toEqual(originalChapters);
      expect(await client.creation.list(project.id)).toEqual(originalWorkflows);
      expect(await client.tasks.list()).toEqual(originalTasks);
      expect(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => !window.isVisible() && !window.isFocused(),
          ),
        ),
      ).toBe(true);
      manager.disconnect();
      await application.close();
      application = await electron.launch({
        args: [resolve("apps/desktop/out/main/index.js")],
        env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
      });
      page = await application.firstWindow();
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      manager = new ServerConnectionManager();
      await manager.attach({
        ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
        source: "spawned",
      });
      await observeReadsOnly();
      await navigate("/");
      await expect(
        card().getByText("推荐原因：", { exact: false }),
      ).toBeVisible();
      expect(await card().getByRole("link").first().getAttribute("href")).toBe(
        normalAction,
      );
      const restored = createStudioClient(manager.createTransport());
      expect(await restored.chapters.get(chapter.id)).toEqual(chapter);
      expect(await restored.creation.list(project.id)).toEqual(
        originalWorkflows,
      );
      expect(attemptedWrites).toEqual([]);
      expect(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => !window.isVisible() && !window.isFocused(),
          ),
        ),
      ).toBe(true);
    } finally {
      manager.disconnect();
      await application.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}
