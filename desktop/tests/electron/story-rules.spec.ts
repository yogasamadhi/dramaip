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
} from "@dramaip/contracts";

test("原冻结规则定位的准确方向／作者解释／完整证据、后台恢复、错版本拒绝和历史不升级", async () => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-story-rules-"));
  let application: ElectronApplication | undefined, page: Page;
  let bootstrap: { baseUrl: string; accessToken: string },
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
      if (request.method() === "POST")
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
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
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
    ).toHaveAttribute(
      "data-project-id",
      new URLSearchParams(query).get("projectId")!,
    );
  };
  try {
    await launch();
    const { project } = await api<{ project: { id: string } }>("projects", {
      title: "规则仅供人工复核",
    });
    const { project: other } = await api<{ project: { id: string } }>(
      "projects",
      { title: "独立项目" },
    );
    const createNode = (title: string, kind: string, confirmed = true) =>
      api<StoryCausalNode>(`projects/${project.id}/story-graph/nodes`, {
        title,
        kind,
        confirmed,
        summary: "作者原声明，不是原文核验。",
        sourceType: "manual",
        sourceId: crypto.randomUUID(),
        sourceVersion: 0,
      });
    const event = await createNode("实际原因", "event"),
      secret = await createNode("实际秘密", "secret"),
      character = await createNode("实际角色", "character");
    const candidate = await createNode("候选不入规则", "event", false);
    const createEdge = (
      fromNodeId: string,
      toNodeId: string,
      relation: string,
    ) =>
      api(`projects/${project.id}/story-graph/edges`, {
        fromNodeId,
        toNodeId,
        relation,
        rationale: "作者有意安排，仅供原声明复核。",
        confidence: 0.7,
        confirmed: true,
      });
    await createEdge(event.id, secret.id, "causes");
    await createEdge(secret.id, event.id, "depends_on");
    await createEdge(secret.id, event.id, "reveals");
    await createEdge(event.id, secret.id, "conflicts_with");
    for (const [storyOrder, state] of [
      [1, "knows"],
      [2, "unknown"],
    ])
      await api(`projects/${project.id}/audience-knowledge`, {
        subjectType: "character",
        subjectId: character.id,
        knowledgeNodeId: secret.id,
        storyOrder,
        state,
        evidence: "有意失忆解释保留，不能断言无解释。",
      });
    const chaptersBefore = await api(`projects/${project.id}/chapters`),
      tasksBefore = await api("tasks");
    await open(`projectId=${project.id}`);
    let panel = page.getByLabel("认知与因果声明工作台", { exact: true });
    await panel
      .getByRole("button", { name: "明确创建新声明快照", exact: true })
      .click();
    let frozen = panel.getByLabel("冻结人工声明快照", { exact: true });
    await expect(frozen).toContainText(
      "冻结人工确认节点 3／关系 4／认知声明 2",
    );
    const snapshotId = (await frozen.getAttribute("data-snapshot-id"))!;
    const snapshotPath = `projects/${project.id}/ip-twins/${snapshotId}`;
    const original = await api<IPTwinSnapshot>(snapshotPath);
    expect(original.ruleAnalysis?.findings.map((value) => value.code)).toEqual([
      "cognition-decrease",
      "declared-conflict",
      "secret-without-incoming-reveal",
    ]);
    expect(original.nodes.some((value) => value.id === candidate.id)).toBe(
      false,
    );
    let review = frozen.getByLabel("原冻结规则定位", { exact: true });
    await expect(review).toContainText("只检查声明结构");
    await expect(review).toContainText("不判定回退错误");
    await expect(review.locator("[data-rule-code=causal-cycle]")).toHaveCount(
      0,
    );
    const decrease = review.locator("[data-rule-code=cognition-decrease]");
    await decrease.locator("summary").click();
    await expect(decrease).toContainText("有意失忆解释保留");
    await expect(decrease.locator("[data-rule-record-id]")).toHaveCount(
      original.ruleAnalysis!.findings[0]!.records.length,
    );
    const recordProof = decrease.locator("[data-rule-record-id]").first();
    await recordProof.scrollIntoViewIfNeeded();
    await recordProof.screenshot({
      path: "build/story-rules-record-verified.png",
    });
    await decrease.locator("summary").click();
    await review.scrollIntoViewIfNeeded();
    await review.screenshot({ path: "build/story-rules-located-verified.png" });
    await panel
      .getByLabel("推演假设", { exact: true })
      .fill("如果实际角色提前知道实际秘密");
    await frozen.getByRole("checkbox").check();
    await panel
      .getByRole("button", { name: "基于原快照创建规则推演", exact: true })
      .click();
    const result = panel.getByLabel("原规则推演结果", { exact: true });
    await expect(result).toContainText("未调用模型，无模型推断");
    const simulationId = (await result.getAttribute("data-simulation-id"))!;
    const simulation = await api<ScenarioRun>(
      `projects/${project.id}/story-simulations/${simulationId}`,
    );
    expect(simulation.deterministicFindings.slice(0, 3)).toEqual(
      original.conflicts,
    );
    const query = new URLSearchParams({
      projectId: project.id,
      storySnapshotId: snapshotId,
      storySimulationId: simulationId,
    }).toString();
    await application!.close();
    application = undefined;
    await launch();
    await open(query);
    panel = page.getByLabel("认知与因果声明工作台", { exact: true });
    frozen = panel.getByLabel("冻结人工声明快照", { exact: true });
    await expect(
      frozen.getByLabel("原冻结规则定位", { exact: true }),
    ).toContainText("当前冻结声明范围");
    await expect(frozen.getByRole("checkbox")).not.toBeChecked();
    expect(await api(snapshotPath)).toEqual(original);
    expect(
      await api(`projects/${project.id}/story-simulations/${simulationId}`),
    ).toEqual(simulation);

    let rejectedReads = 0;
    const route = `**/api/v2/${snapshotPath}`;
    const wrong = structuredClone(original);
    wrong.ruleAnalysis!.findings[0]!.records[0]!.version++;
    await page.route(route, (request) => {
      rejectedReads++;
      return request.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(wrong),
      });
    });
    await open(`projectId=${other.id}`);
    await open(query);
    await expect(
      panel.getByRole("alert").filter({ hasText: "原快照／推演无法核对" }),
    ).toContainText("规则定位");
    await expect(
      panel.getByLabel("原冻结规则定位", { exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "基于原快照创建规则推演",
        exact: true,
      }),
    ).toBeDisabled();
    expect(rejectedReads).toBeGreaterThan(0);
    await page.unroute(route);

    const legacy = structuredClone(original);
    delete legacy.ruleAnalysis;
    legacy.conflicts = ["历史文本仅供复核，不回填原快照。"];
    await page.route(route, (request) =>
      request.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(legacy),
      }),
    );
    await open(`projectId=${other.id}`);
    await open(query);
    await expect(
      panel.getByLabel("历史规则边界", { exact: true }),
    ).toContainText("未回填新版定位");
    await expect(
      panel.getByLabel("原冻结规则定位", { exact: true }),
    ).toHaveCount(0);
    await page.unroute(route);
    await open(`projectId=${other.id}`);
    await open(query);
    await expect(
      panel.getByLabel("原冻结规则定位", { exact: true }),
    ).toBeVisible();
    await createEdge(event.id, secret.id, "depends_on");
    await expect(frozen).toContainText("原声明快照已失效");
    expect(await api(snapshotPath)).toEqual({ ...original, stale: true });
    await expect(frozen.locator("[data-rule-code=causal-cycle]")).toHaveCount(
      0,
    );
    await panel
      .getByRole("button", { name: "明确创建新声明快照", exact: true })
      .click();
    await expect(frozen).not.toHaveAttribute("data-snapshot-id", snapshotId);
    await expect(frozen.locator("[data-rule-code=causal-cycle]")).toHaveCount(
      1,
    );
    await expect(frozen).not.toContainText(candidate.title);
    expect(await api(`projects/${project.id}/chapters`)).toEqual(
      chaptersBefore,
    );
    expect(await api("tasks")).toEqual(tasksBefore);
    expect(writes.filter((value) => value.endsWith("/ip-twin"))).toHaveLength(
      2,
    );
    expect(
      writes.filter((value) => value.endsWith("/story-simulations")),
    ).toHaveLength(1);
    expect(dialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
