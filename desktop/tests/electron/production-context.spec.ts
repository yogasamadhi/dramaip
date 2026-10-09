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

test("后台跨工作区保留实际对象、核对全父级、拒绝错误引用且重启可恢复", async ({}, info) => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-production-context-"));
  let application: ElectronApplication | undefined;
  let manager: ServerConnectionManager | undefined;
  let page: Page;
  let client: StudioClient;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
  };
  const navigate = (route: string) =>
    page.evaluate((value) => {
      window.location.hash = value;
    }, route);
  const hidden = async () =>
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  const declared = async (key: string, value: string) =>
    expect
      .poll(() =>
        page.evaluate(
          (name) =>
            new URLSearchParams(window.location.hash.split("?")[1]).get(name),
          key,
        ),
      )
      .toBe(value);
  const active = () => page.getByLabel("当前制作对象", { exact: true });
  const episodeSelect = () =>
    active().getByRole("combobox", {
      name: "分集",
      exact: true,
      includeHidden: true,
    });
  const chain = async (projectId: string, label: string) => {
    let parentId: string | undefined;
    const records = [];
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ]) {
      const record = await client.resources.create(kind, {
        projectId,
        parentId,
        title: `${label} ${kind}`,
        payload: {
          动作: "只读导航核对",
          剧本内容: "INT. ROOM - DAY\n\nActual owned screenplay.",
        },
      });
      records.push(record);
      parentId = record.id;
    }
    return records;
  };
  try {
    await launch();
    await hidden();
    const { project } = await client!.projects.create({
      title: "跨页实际对象",
    });
    const original = await chain(project.id, "指定原对象");
    const otherEpisode = await chain(project.id, "同项目另一集");
    const selectableEpisode = await client!.resources.create("episodes", {
      projectId: project.id,
      parentId: original[0]!.id,
      title: "原方案内另选分集",
    });
    const { project: other } = await client!.projects.create({
      title: "其他项目不替代",
    });
    const foreign = await chain(other.id, "外项目对象");
    const originalRoute = `/adapt?${new URLSearchParams({ projectId: project.id, shotId: original[4]!.id, stage: "shots" })}`;
    await navigate(originalRoute);
    await expect(active()).toContainText(original[1]!.title);
    await expect(active()).toContainText(original[4]!.title);
    await expect(active().locator("details")).not.toHaveAttribute("open");
    await expect(episodeSelect()).toBeHidden();
    // The only declared shot has its real parent chain inferred from owner GETs.
    const sidebar = () =>
      page.getByRole("navigation", { name: "当前项目导航", exact: true });
    await expect(
      sidebar().getByRole("link", { name: "制作", exact: true }),
    ).toHaveAttribute("href", new RegExp(`shotId=${original[4]!.id}`));
    await sidebar().getByRole("link", { name: "制作", exact: true }).click();
    await declared("projectId", project.id);
    await declared("shotId", original[4]!.id);
    await expect(active()).toContainText(original[1]!.title);
    await sidebar()
      .getByRole("link", { name: "审核交付", exact: true })
      .click();
    await declared("shotId", original[4]!.id);
    await expect(active()).toContainText(original[1]!.title);
    await expect(episodeSelect()).toBeHidden();
    await navigate(`/projects/${project.id}/tools`);
    await expect(
      sidebar().getByRole("link", { name: "制作", exact: true }),
    ).toHaveAttribute("href", new RegExp(`shotId=${original[4]!.id}`));
    await sidebar().getByRole("link", { name: "制作", exact: true }).click();
    await expect(active()).toContainText(original[1]!.title);
    await active().locator("summary").click();
    await expect(episodeSelect()).toBeVisible();
    await episodeSelect().selectOption(selectableEpisode.id);
    await declared("episodeId", selectableEpisode.id);
    await expect(active()).toContainText(selectableEpisode.title);
    expect(
      await page.evaluate(() =>
        new URLSearchParams(window.location.hash.split("?")[1]).has("shotId"),
      ),
    ).toBe(false);
    await navigate(originalRoute);
    await expect(active()).toContainText(original[1]!.title);
    const badRoutes = [
      `/produce?projectId=${project.id}&shotId=${foreign[4]!.id}`,
      `/review?projectId=${project.id}&episodeId=${otherEpisode[1]!.id}&shotId=${original[4]!.id}`,
      `/adapt?projectId=${project.id}&episodeId=stable-formal-episode-key`,
      `/produce?projectId=${crypto.randomUUID()}&shotId=${original[4]!.id}`,
      `/review?projectId=${project.id}&episodeId=${original[1]!.id}&episodeId=${otherEpisode[1]!.id}`,
      `/produce?projectId=${project.id}&projectId=${other.id}&shotId=${original[4]!.id}`,
      `/review?projectId=&episodeId=${original[1]!.id}`,
      `/produce?projectId=${crypto.randomUUID()}`,
    ];
    for (const route of badRoutes) {
      await navigate(route);
      await expect(page.getByLabel("制作对象归属核对")).toContainText(
        "未改读最近项目、列表首项或上次选择",
      );
      await expect(active()).toHaveCount(0);
      expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(
        route,
      );
    }
    await navigate(originalRoute);
    await expect(active()).toContainText(original[4]!.title);
    await hidden();
    await page.screenshot({
      path: info.outputPath("actual-object-context.png"),
    });
    manager!.disconnect();
    manager = undefined;
    await application!.close();
    application = undefined;
    await launch();
    await hidden();
    await navigate(`/projects/${project.id}/tools`);
    await expect(
      sidebar().getByRole("link", { name: "制作", exact: true }),
    ).toHaveAttribute("href", new RegExp(`shotId=${original[4]!.id}`));
    await sidebar().getByRole("link", { name: "制作", exact: true }).click();
    await expect(active()).toContainText(original[1]!.title);
    expect(
      (await client!.resources.list("shots", project.id))
        .map((record) => record.id)
        .sort(),
    ).toEqual([original[4]!.id, otherEpisode[4]!.id].sort());
  } finally {
    manager?.disconnect();
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
