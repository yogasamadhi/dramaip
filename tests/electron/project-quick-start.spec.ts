import { expect, test } from "@playwright/test";

import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "playwright";
import { electron } from "./desktop-host";
import { openProjectCreation, quickCreateProject } from "./project-tools";

const projectNav = (page: Page) =>
  page.getByRole("navigation", { name: "当前项目导航" });

test("新建项目只选写小说、写剧本或小说改剧本，名称可不填", async () => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-quick-start-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // A first launch opens on the three choices, with nothing else required.
    await expect(
      page.getByRole("radiogroup", { name: "开始方式" }).getByRole("radio"),
    ).toHaveCount(3);

    // 写小说: an empty name gets a placeholder; the project is novel-only.
    await quickCreateProject(page, "写小说");
    await expect(
      page.getByRole("button", { name: "当前项目：未命名小说" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/projects\/[^/?]+/);
    const novelNav = projectNav(page);
    await expect(
      novelNav.getByRole("link", { name: "故事", exact: true }),
    ).toBeVisible();
    for (const label of ["改编", "制作"])
      await expect(
        novelNav.getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);

    // 写剧本: opens the script workspace directly and keeps video production.
    await quickCreateProject(page, "写剧本", "我的短剧");
    await expect(
      page.getByRole("button", { name: "当前项目：我的短剧" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/adapt\?.*stage=scripts/);
    await expect(
      projectNav(page).getByRole("link", { name: "制作", exact: true }),
    ).toBeVisible();

    // 小说改剧本: no file is needed up front; the novel is imported inside.
    await quickCreateProject(page, "小说改剧本");
    await expect(
      page.getByRole("button", { name: "当前项目：未命名改编" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/projects\/[^/?]+\/tools\/import/);
    await expect(
      page.getByRole("heading", { name: "导入小说原稿或漫剧剧本" }),
    ).toBeVisible();
    await expect(
      projectNav(page).getByRole("link", { name: "制作", exact: true }),
    ).toBeVisible();

    // A second unnamed novel does not clash with the first.
    await quickCreateProject(page, "写小说");
    await expect(
      page.getByRole("button", { name: "当前项目：未命名小说 2" }),
    ).toBeVisible();

    // A form left half-way (only clicks, nothing typed) must not take over:
    // after a reload, 新建项目 opens the quick start and scrolls to it.
    await openProjectCreation(page);
    await page.getByRole("button", { name: "从创意开始", exact: true }).click();
    await page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("heading", { name: "项目工作台" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const quick = page.getByRole("radiogroup", { name: "开始方式" });
    await expect(quick).toBeVisible();
    await expect(quick).toBeInViewport();
    await expect(
      page.getByRole("heading", { name: "你现在手中有什么素材？" }),
    ).toHaveCount(0);
  } finally {
    await application.close();
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
