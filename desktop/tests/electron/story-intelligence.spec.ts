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
  IPTwinSnapshot,
  StoryCausalNode,
  ScenarioRun,
} from "@dramaip/contracts/creative-intelligence";

test("人工认知因果声明使用页内表单、明确快照与独立规则推演，原身份后台重启恢复、候选不混入、旧缓存和外项目拒绝", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-story-declarations-"));
  let application: ElectronApplication | undefined, page: Page;
  let bootstrap: { baseUrl: string; accessToken: string },
    dialogs = 0;
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
  const json = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        ...(body === undefined
          ? {}
          : { "Idempotency-Key": crypto.randomUUID() }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
    return (await response.json()) as T;
  };
  const open = async (query: string) => {
    await page.evaluate((route) => {
      window.location.hash = route;
    }, `#/create?${query}`);
    await expect(
      page.getByLabel("认知与因果声明工作台", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("认知与因果声明工作台", { exact: true }),
    ).toHaveAttribute(
      "data-project-id",
      new URLSearchParams(query).get("projectId")!,
    );
  };
  try {
    await launch();
    const first = (
      await json<{ project: { id: string } }>("projects", {
        title: "人工声明项目",
      })
    ).project;
    const other = (
      await json<{ project: { id: string } }>("projects", {
        title: "另一份声明项目",
      })
    ).project;
    const original = await json<{ id: string }>("chapters", {
      projectId: first.id,
      title: "原文不参与图操作",
      content: "PRIVATE 原文保持不变，不让人工图假装核验。",
    });
    const originalChapter = await json(`chapters/${original.id}`);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST")
        posts.push(new URL(request.url()).pathname);
    });
    await open(`projectId=${first.id}`);
    let panel = page.getByLabel("认知与因果声明工作台", { exact: true });
    await expect(
      panel.getByLabel("实际声明数量", { exact: true }),
    ).toContainText("人工确认节点：0");
    await panel
      .locator("summary")
      .filter({ hasText: /^添加节点声明$/ })
      .click();
    const addNode = async (title: string, kind: string, confirm: boolean) => {
      const form = panel.getByRole("form", {
        name: "节点声明表单",
        exact: true,
      });
      await form.getByLabel("节点类型", { exact: true }).selectOption(kind);
      await form.getByLabel("节点名称", { exact: true }).fill(title);
      await form
        .getByLabel("人工说明", { exact: true })
        .fill("人工判断，不是原文已核验事实。");
      const confirmation = form.getByRole("checkbox");
      await expect(confirmation).not.toBeChecked();
      if (confirm) await confirmation.check();
      await form
        .getByRole("button", { name: "保存节点声明", exact: true })
        .click();
      await expect(form.getByLabel("节点名称", { exact: true })).toHaveValue(
        "",
      );
      await expect(
        form.getByRole("button", { name: "保存节点声明", exact: true }),
      ).toBeDisabled();
      return (
        await json<{ nodes: StoryCausalNode[] }>(
          `projects/${first.id}/story-graph`,
        )
      ).nodes.find((node) => node.title === title)!;
    };
    const candidate = await addNode("候选不可当事实", "event", false);
    const character = await addNode("人工角色甲", "character", true);
    const secret = await addNode("人工秘密甲", "secret", true);
    expect(candidate.confirmed).toBe(false);
    await panel
      .locator("summary")
      .filter({ hasText: /^添加因果关系与认知声明$/ })
      .click();
    const edge = panel.getByRole("form", { name: "关系声明表单", exact: true });
    await edge
      .getByLabel("关系起点", { exact: true })
      .selectOption(candidate.id);
    await edge.getByLabel("关系终点", { exact: true }).selectOption(secret.id);
    await edge
      .getByLabel("关系说明", { exact: true })
      .fill("候选不能成为确认关系");
    await edge.getByRole("checkbox").check();
    await expect(
      edge.getByRole("button", { name: "保存关系声明", exact: true }),
    ).toBeDisabled();
    await edge
      .getByLabel("关系起点", { exact: true })
      .selectOption(character.id);
    await edge.getByLabel("关系类型", { exact: true }).selectOption("reveals");
    await edge
      .getByLabel("关系说明", { exact: true })
      .fill("人工声明角色揭示秘密");
    await edge
      .getByRole("button", { name: "保存关系声明", exact: true })
      .click();
    await expect(
      panel.getByLabel("实际声明数量", { exact: true }),
    ).toContainText("关系声明：1");
    const cognition = panel.getByRole("form", {
      name: "认知声明表单",
      exact: true,
    });
    await cognition
      .getByLabel("认知主体", { exact: true })
      .selectOption(character.id);
    await cognition
      .getByLabel("认知对象", { exact: true })
      .selectOption(secret.id);
    await cognition
      .getByLabel("认知状态", { exact: true })
      .selectOption("knows");
    await expect(
      cognition.getByRole("button", { name: "保存认知声明", exact: true }),
    ).toBeDisabled();
    await cognition
      .getByLabel("认知证据说明", { exact: true })
      .fill("人工设定第零顺序得知，不是原文引文");
    await cognition
      .getByRole("button", { name: "保存认知声明", exact: true })
      .click();
    await expect(
      panel.getByLabel("实际声明数量", { exact: true }),
    ).toContainText("认知声明：1");
    await panel
      .getByLabel("推演假设", { exact: true })
      .fill("如果人工角色甲提前知道人工秘密甲");
    const simulate = panel.getByRole("button", {
      name: "基于原快照创建规则推演",
      exact: true,
    });
    await expect(simulate).toBeDisabled();
    await panel
      .getByRole("button", { name: "明确创建新声明快照", exact: true })
      .click();
    const frozen = panel.getByLabel("冻结人工声明快照", { exact: true });
    await expect(frozen).toContainText(
      "冻结人工确认节点 2／关系 1／认知声明 1",
    );
    await expect(frozen).not.toContainText(candidate.title);
    await expect(simulate).toBeDisabled();
    await frozen.getByRole("checkbox").check();
    await simulate.click();
    const result = panel.getByLabel("原规则推演结果", { exact: true });
    await expect(result).toContainText(
      "原假设：如果人工角色甲提前知道人工秘密甲",
    );
    await expect(result).toContainText("未调用模型，无模型推断");
    const snapshotId = (await frozen.getAttribute("data-snapshot-id"))!,
      simulationId = (await result.getAttribute("data-simulation-id"))!;
    const restoredQuery = new URLSearchParams({
      projectId: first.id,
      storySnapshotId: snapshotId,
      storySimulationId: simulationId,
    }).toString();
    const originalResult = await json<ScenarioRun>(
      `projects/${first.id}/story-simulations/${simulationId}`,
    );
    const originalSnapshot = await json<IPTwinSnapshot>(
      `projects/${first.id}/ip-twins/${snapshotId}`,
    );
    expect(posts.filter((path) => path.endsWith("/ip-twin"))).toHaveLength(1);
    expect(
      posts.filter((path) => path.endsWith("/story-simulations")),
    ).toHaveLength(1);
    await application!.close();
    application = undefined;
    await launch();
    await open(restoredQuery);
    panel = page.getByLabel("认知与因果声明工作台", { exact: true });
    await expect(
      panel.getByLabel("原规则推演结果", { exact: true }),
    ).toHaveAttribute("data-simulation-id", simulationId);
    await expect(
      panel
        .getByLabel("冻结人工声明快照", { exact: true })
        .getByRole("checkbox"),
    ).not.toBeChecked();
    expect(
      await json(`projects/${first.id}/story-simulations/${simulationId}`),
    ).toEqual(originalResult);
    const foreign = await json<IPTwinSnapshot>(
      `projects/${other.id}/ip-twin`,
      {},
    );
    await open(
      new URLSearchParams({
        projectId: first.id,
        storySnapshotId: foreign.id,
        storySimulationId: simulationId,
      }).toString(),
    );
    await expect(panel.getByRole("alert")).toContainText("不自动换到最新来源");
    await expect(
      panel.getByRole("button", {
        name: "基于原快照创建规则推演",
        exact: true,
      }),
    ).toBeDisabled();
    await open(restoredQuery);
    await json(`projects/${first.id}/story-graph/nodes`, {
      kind: "rule",
      title: "原声明来源变化",
      summary: "新声明",
      sourceType: "manual",
      sourceId: crypto.randomUUID(),
      sourceVersion: 0,
      confirmed: true,
    });
    await expect(
      panel.getByLabel("冻结人工声明快照", { exact: true }),
    ).toContainText("原声明快照已失效");
    await expect(
      panel.getByLabel("冻结人工声明快照", { exact: true }),
    ).not.toContainText("原声明来源变化");
    expect(await json(`projects/${first.id}/ip-twins/${snapshotId}`)).toEqual({
      ...originalSnapshot,
      stale: true,
    });
    expect(
      await json(`projects/${first.id}/story-simulations/${simulationId}`),
    ).toEqual(originalResult);
    let rejectedGraphReads = 0;
    await page.route(`**/api/v2/projects/${first.id}/story-graph`, (route) => {
      rejectedGraphReads++;
      return route.abort();
    });
    await open(`projectId=${other.id}`);
    await open(restoredQuery);
    await expect(
      panel.getByRole("alert").filter({ hasText: "声明图读取失败" }),
    ).toContainText("旧缓存不作为可用来源");
    expect(rejectedGraphReads).toBeGreaterThan(0);
    await expect(panel.getByLabel("实际声明数量", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      panel.getByRole("button", { name: "明确创建新声明快照", exact: true }),
    ).toBeDisabled();
    await page.unroute(`**/api/v2/projects/${first.id}/story-graph`);
    await panel
      .getByRole("button", { name: "重查声明图", exact: true })
      .click();
    await expect(
      panel.getByLabel("实际声明数量", { exact: true }),
    ).toContainText("候选节点：1");
    expect(await json(`chapters/${original.id}`)).toEqual(originalChapter);
    expect(dialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
    await page.screenshot({
      path: "build/story-intelligence-workbench-verified.png",
      fullPage: true,
    });
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
