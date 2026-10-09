import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";

test("后台平台资料明确选择／采用原候选，旧预检拒绝且丢回复只读恢复原归档；不自动提交或声明发行", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-platform-metadata-ui-"),
  );
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined,
    page: Page,
    client: StudioClient;
  let archivePosts = 0,
    adoptPosts = 0,
    recoveryGets = 0;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: userData,
        DRAMAIP_DEBUG_BACKGROUND: "1",
      },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1200 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (
        r.method() === "POST" &&
        /^\/api\/v2\/episodes\/[^/]+\/platform-deliveries$/.test(path)
      )
        archivePosts++;
      if (
        r.method() === "POST" &&
        path.includes("/delivery-variants/") &&
        path.endsWith("/adopt")
      )
        adoptPosts++;
      if (r.method() === "GET" && path.includes("/platform-delivery/requests/"))
        recoveryGets++;
    });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    const hidden = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (w) => !w.isVisible() && !w.isFocused(),
      ),
    );
    expect(hidden).toBe(true);
  };
  try {
    await launch();
    const { project } = await client.projects.create({
      title: "后台原平台资料，非媒体发行",
    });
    const adaptation = await client.resources.create("adaptations", {
        projectId: project.id,
        title: "原改编",
        payload: {},
      }),
      episode = await client.resources.create("episodes", {
        projectId: project.id,
        parentId: adaptation.id,
        title: "原分集",
        payload: {},
      });
    const path = `/review?${new URLSearchParams({ projectId: project.id, adaptationId: adaptation.id, episodeId: episode.id, stage: "delivery" })}`;
    const navigate = () =>
        page.evaluate((p) => {
          window.location.hash = p;
        }, path),
      panel = () => page.getByTestId(`platform-metadata-${episode.id}`);
    await navigate();
    await expect(panel()).toBeVisible();
    await expect(
      panel().getByLabel("平台交付档案", { exact: true }),
    ).toHaveValue("");
    await expect(
      panel().getByLabel("当前创意候选", { exact: true }),
    ).toHaveValue("");
    expect(archivePosts).toBe(0);
    expect(adoptPosts).toBe(0);
    await panel()
      .getByLabel("平台标题", { exact: true })
      .fill("原作者提交标题");
    await panel()
      .getByLabel("平台简介", { exact: true })
      .fill("原作者提交简介");
    await panel().getByLabel("标签词", { exact: true }).fill("原标签,明确采用");
    await panel()
      .getByRole("button", { name: "保存为新候选", exact: true })
      .click();
    await expect(
      panel().getByText("已保存候选", { exact: false }),
    ).toBeVisible();
    const [candidate] = await client.platformDelivery.listVariants(
      adaptation.id,
      project.id,
    );
    expect(candidate!.adoptionVerified).toBe(false);
    await panel()
      .getByLabel("平台交付档案", { exact: true })
      .selectOption("00000000-0000-4000-8000-000000000001");
    const checkbox = () => panel().getByRole("checkbox");
    await checkbox().check();
    await panel()
      .getByRole("button", { name: "运行平台交付预检", exact: true })
      .click();
    await expect(
      panel().getByText("预检未通过", { exact: true }),
    ).toBeVisible();
    await expect(
      panel().getByRole("button", { name: "创建提交资料归档", exact: true }),
    ).toBeDisabled();
    await panel()
      .getByRole("button", { name: "采用此候选", exact: true })
      .click();
    await expect(
      panel().getByText("原候选已明确采用", { exact: false }),
    ).toBeVisible();
    await expect(checkbox()).not.toBeChecked();
    expect(adoptPosts).toBe(1);
    await checkbox().check();
    await panel()
      .getByRole("button", { name: "运行平台交付预检", exact: true })
      .click();
    await expect(
      panel().getByTestId("platform-metadata-original"),
    ).toContainText("原作者提交标题");
    await client.resources.update("episodes", episode.id, {
      version: episode.version,
      title: "后来的分集",
      payload: { 原记录已变: true },
    });
    await panel()
      .getByRole("button", { name: "创建提交资料归档", exact: true })
      .click();
    await expect(
      panel().getByTestId("platform-metadata-pending"),
    ).toBeVisible();
    await expect(
      panel().getByRole("button", {
        name: "保留原拒绝记录，重新核对来源",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await client.platformDelivery.listArchives(episode.id, project.id),
    ).toEqual([]);
    await panel()
      .getByRole("button", {
        name: "保留原拒绝记录，重新核对来源",
        exact: true,
      })
      .click();
    await expect(checkbox()).not.toBeChecked();
    await expect(panel().getByTestId("platform-metadata-original")).toHaveCount(
      0,
    );
    await checkbox().check();
    await panel()
      .getByRole("button", { name: "运行平台交付预检", exact: true })
      .click();
    await expect(
      panel().getByTestId("platform-metadata-original"),
    ).toBeVisible();
    let lost = false;
    await page.route(
      "**/api/v2/episodes/*/platform-deliveries",
      async (route) => {
        if (route.request().method() !== "POST" || lost) {
          await route.continue();
          return;
        }
        lost = true;
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        await route.abort("failed");
      },
    );
    await panel()
      .getByRole("button", { name: "创建提交资料归档", exact: true })
      .click();
    await expect(
      panel().getByTestId("platform-metadata-pending"),
    ).toBeVisible();
    await expect(
      panel().getByRole("button", {
        name: "明确用原键重发原请求",
        exact: true,
      }),
    ).toBeEnabled();
    expect(archivePosts).toBe(2);
    const [archive] = await client.platformDelivery.listArchives(
      episode.id,
      project.id,
    );
    expect(archive!.scope).toBe("submission-metadata-only");
    if (archive!.scope !== "submission-metadata-only")
      throw Error("Expected frozen metadata");
    expect(archive!.preflight.snapshot!.variant.title).toBe("原作者提交标题");
    expect(archive!.releaseReady).toBe(false);
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) =>
          k.startsWith("dramaip:platform-metadata:") &&
          !k.includes(":rejected:"),
      ),
    );
    expect(keys).toHaveLength(1);
    await page.reload();
    await navigate();
    await expect(panel()).toBeVisible();
    await expect(panel().getByTestId("platform-metadata-pending")).toHaveCount(
      0,
    );
    await expect(
      panel().getByText("原预检提交资料已归档", { exact: false }),
    ).toBeVisible();
    expect(archivePosts).toBe(2);
    expect(recoveryGets).toBeGreaterThan(0);
    await expect(
      panel().getByLabel("平台交付档案", { exact: true }),
    ).toHaveValue("");
    await expect(
      panel().getByLabel("当前创意候选", { exact: true }),
    ).toHaveValue("");
    await expect(panel().getByTestId("platform-metadata-original")).toHaveCount(
      0,
    );
    const document = await client.platformDelivery.exportArchive(
      archive!.id,
      project.id,
    );
    expect(JSON.parse(document.content)).toEqual(archive);
    await page.screenshot({
      path: info.outputPath("original-metadata-not-release-approval.png"),
      fullPage: true,
    });
    manager!.disconnect();
    manager = undefined;
    await application!.close();
    application = undefined;
    await launch();
    await navigate();
    await expect(panel()).toBeVisible();
    expect(archivePosts).toBe(2);
    expect(adoptPosts).toBe(1);
    expect(
      await client.platformDelivery.listArchives(episode.id, project.id),
    ).toEqual([archive]);
    await expect(
      panel().getByLabel("平台交付档案", { exact: true }),
    ).toHaveValue("");
    await expect(
      panel().getByLabel("当前创意候选", { exact: true }),
    ).toHaveValue("");
  } finally {
    manager?.disconnect();
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
