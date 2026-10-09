import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StoryAssertion } from "@dramaip/contracts/knowledge";
import type { StoryCausalNode, IPTwinSnapshot } from "@dramaip/contracts";

test("关系和认知独立来源的后台候选／双重审阅／响应丢失重放／小说与剧本／原ID恢复和失效保护", async () => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-assertion-e2e-"));
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
        request.url().includes("/story-assertions")
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
  const open = async (projectId: string, id?: string) => {
    await page.evaluate(
      (query) => {
        window.location.hash = `#/create?${query}`;
      },
      new URLSearchParams({
        projectId,
        ...(id ? { storyAssertionId: id } : {}),
      }).toString(),
    );
    await expect(
      page.getByLabel("关系认知来源工作台", { exact: true }),
    ).toHaveAttribute("data-project-id", projectId);
  };
  const currentId = async () =>
    new URLSearchParams(
      (await page.evaluate(() => window.location.hash)).split("?")[1],
    ).get("storyAssertionId")!;
  try {
    await launch();
    const { project } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "关系独立证据项目" },
    );
    const { project: other } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "不同项目不得恢复原声明" },
    );
    const node = (kind: "character" | "secret") =>
      api<StoryCausalNode>(`projects/${project.id}/story-graph/nodes`, "POST", {
        kind,
        title: kind === "character" ? "实际角色" : "实际秘密",
        summary: "作者确认的手工节点不是原文证明",
        sourceType: "manual",
        sourceId: project.id,
        sourceVersion: 0,
        confirmed: true,
      });
    const character = await node("character"),
      target = await node("secret");
    const script = await api<{ id: string; version: number }>(
      "scripts",
      "POST",
      {
        projectId: project.id,
        title: "关系原稿",
        payload: {
          剧本内容:
            "INT. TEST ROOM - DAY\n\nSELECTED 关系实际证据。\n\nUNSELECTED 不混入本声明。",
        },
      },
    );
    expect(await api(`projects/${project.id}/chapters`)).toEqual([]);
    await open(project.id);
    let panel = page.getByLabel("关系认知来源工作台", { exact: true });
    await panel.locator("summary").click();
    await panel
      .getByLabel("关系认知来源类型", { exact: true })
      .selectOption("screenplay");
    let form = panel.getByRole("form", {
      name: "关系认知剧本来源表单",
      exact: true,
    });
    await expect(form.getByLabel("关系来源节点", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      form.getByLabel("关系认知解释类型", { exact: true }),
    ).toHaveValue("");
    await form
      .getByLabel("声明原剧本", { exact: true })
      .selectOption(script.id);
    await expect(
      form.getByLabel("选择实际剧本块 2", { exact: true }),
    ).not.toBeChecked();
    await form
      .getByLabel("关系认知名称", { exact: true })
      .fill("关系实际证据候选");
    await form
      .getByLabel("关系认知作者解释", { exact: true })
      .fill("PRIVATE 作者认为角色揭示秘密，不是语义证明。");
    await form
      .getByLabel("关系认知解释类型", { exact: true })
      .selectOption("author-inferred");
    await form
      .getByLabel("关系来源节点", { exact: true })
      .selectOption(character.id);
    await form
      .getByLabel("关系目标节点", { exact: true })
      .selectOption(target.id);
    await form.getByLabel("作者关系置信估计", { exact: true }).fill("0.7");
    let save = form.getByRole("button", {
      name: "仅保存关系认知来源候选",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await form.getByLabel("选择实际剧本块 2", { exact: true }).check();
    await expect(save).toBeEnabled();
    let lost = false;
    const routePath = `**/projects/${project.id}/story-assertions`;
    await page.route(routePath, async (route) => {
      if (!lost && route.request().method() === "POST") {
        const result = await route.fetch();
        expect(result.status()).toBe(201);
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
    let review = panel.getByLabel("原关系认知来源审阅", { exact: true });
    await expect(review).toContainText("pending");
    const relationId = await currentId(),
      pending = await api<StoryAssertion>(
        `projects/${project.id}/story-assertions/${relationId}`,
      );
    expect(pending.basis.sourceBasis.sources[0]!.quote).toBe(
      "SELECTED 关系实际证据。",
    );
    expect(JSON.stringify(pending)).not.toContain("UNSELECTED");
    expect(
      (await api<{ edges: unknown[] }>(`projects/${project.id}/story-graph`))
        .edges,
    ).toEqual([]);
    let adopt = review.getByRole("button", {
      name: "明确采用该原关系认知声明",
      exact: true,
    });
    await expect(adopt).toBeDisabled();
    await review
      .getByLabel("已核对关系认知原文与节点版本", { exact: true })
      .check();
    await expect(adopt).toBeDisabled();
    await review
      .getByLabel("已审阅关系认知解释与不确定性", { exact: true })
      .check();
    await adopt.click();
    await expect(review).toContainText("adopted");
    const applied = await api<StoryAssertion>(
      `projects/${project.id}/story-assertions/${relationId}`,
    );
    expect(applied.basis).toEqual(pending.basis);
    expect(applied.adoptedRecord!.kind).toBe("edge");
    expect(writes).toHaveLength(3);
    // A second independent result uses actual novel paragraphs, not a fake node.
    const chapter = await api<{ id: string }>("chapters", "POST", {
      projectId: project.id,
      title: "认知原文",
      content:
        "NOVEL SELECTED 角色此时只是怀疑。\n\nNOVEL UNSELECTED 未选后文。",
    });
    await panel
      .getByLabel("来源声明结果", { exact: true })
      .selectOption("cognition");
    await panel
      .getByLabel("关系认知来源类型", { exact: true })
      .selectOption("novel");
    form = panel.getByRole("form", {
      name: "关系认知小说来源表单",
      exact: true,
    });
    await form
      .getByLabel("关系认知原章节", { exact: true })
      .selectOption(chapter.id);
    await form
      .getByLabel("关系认知名称", { exact: true })
      .fill("角色认知实际证据");
    await form
      .getByLabel("关系认知作者解释", { exact: true })
      .fill("作者认为角色在顺序3只是怀疑");
    await form
      .getByLabel("关系认知解释类型", { exact: true })
      .selectOption("source-stated");
    await form
      .getByLabel("来源认知角色", { exact: true })
      .selectOption(character.id);
    await form
      .getByLabel("来源认知目标节点", { exact: true })
      .selectOption(target.id);
    await form.getByLabel("作者认知故事顺序", { exact: true }).fill("3");
    await form
      .getByLabel("来源认知状态", { exact: true })
      .selectOption("suspects");
    save = form.getByRole("button", {
      name: "仅保存关系认知来源候选",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await form.getByLabel("关系认知选择实际段落 1", { exact: true }).check();
    await save.click();
    await expect(review).toContainText("角色认知实际证据");
    const cognitionId = await currentId(),
      cognition = await api<StoryAssertion>(
        `projects/${project.id}/story-assertions/${cognitionId}`,
      );
    expect(cognition.basis.sourceBasis.sources[0]!.quote).toBe(
      "NOVEL SELECTED 角色此时只是怀疑。",
    );
    expect(JSON.stringify(cognition)).not.toContain("NOVEL UNSELECTED");
    await review
      .getByLabel("已核对关系认知原文与节点版本", { exact: true })
      .check();
    await review
      .getByLabel("已审阅关系认知解释与不确定性", { exact: true })
      .check();
    await review
      .getByRole("button", { name: "明确采用该原关系认知声明", exact: true })
      .click();
    await expect(review).toContainText("adopted");
    const twin = await api<IPTwinSnapshot>(
      `projects/${project.id}/ip-twin`,
      "POST",
      {},
    );
    expect(twin.nodes).toHaveLength(2);
    expect(twin.edges).toHaveLength(1);
    expect(twin.audienceStates).toHaveLength(1);
    expect(writes).toHaveLength(5);
    await application!.close();
    application = undefined;
    await launch();
    await open(project.id, relationId);
    panel = page.getByLabel("关系认知来源工作台", { exact: true });
    review = panel.getByLabel("原关系认知来源审阅", { exact: true });
    await expect(review).toContainText(applied.id);
    await expect(review).toContainText("adopted");
    await expect(
      review.getByLabel("已核对关系认知原文与节点版本", { exact: true }),
    ).not.toBeChecked();
    expect(writes).toHaveLength(5);
    await open(other.id, relationId);
    await expect(review.getByRole("alert")).toBeVisible();
    await expect(review).not.toContainText(pending.input.statement);
    await open(project.id, relationId);
    await expect(review).toContainText(applied.id);
    await panel
      .getByLabel("关系认知来源类型", { exact: true })
      .selectOption("screenplay");
    form = panel.getByRole("form", {
      name: "关系认知剧本来源表单",
      exact: true,
    });
    await form
      .getByLabel("声明原剧本", { exact: true })
      .selectOption(script.id);
    await expect(
      form.getByLabel("可选实际剧本块", { exact: true }),
    ).toBeVisible();
    let failures = 0;
    const sourcePath = `**/projects/${project.id}/screenplay-sources/${script.id}`;
    await page.route(sourcePath, async (route) => {
      failures++;
      await route.abort("failed");
    });
    await panel
      .getByRole("button", { name: "重读关系认知来源与原候选", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("旧缓存不作为当前依据");
    expect(failures).toBeGreaterThan(0);
    await expect(
      form.getByLabel("可选实际剧本块", { exact: true }),
    ).toHaveCount(0);
    await expect(
      form.getByRole("button", { name: "仅保存关系认知来源候选", exact: true }),
    ).toBeDisabled();
    await page.unroute(sourcePath);
    await api(`scripts/${script.id}`, "PATCH", {
      version: script.version,
      payload: {
        剧本内容: "INT. NEW ROOM - DAY\n\nNEW 原稿不能替换冻结证据。",
      },
    });
    await panel
      .getByRole("button", { name: "重读关系认知来源与原候选", exact: true })
      .click();
    await expect(review).toContainText("来源 stale");
    await expect(review).toContainText("SELECTED 关系实际证据。");
    await expect(
      review.getByRole("button", {
        name: "明确采用该原关系认知声明",
        exact: true,
      }),
    ).toBeDisabled();
    const old = await api<IPTwinSnapshot>(
      `projects/${project.id}/ip-twins/${twin.id}`,
    );
    expect(old.stale).toBe(true);
    expect(old.edges).toEqual(twin.edges);
    const fresh = await api<IPTwinSnapshot>(
      `projects/${project.id}/ip-twin`,
      "POST",
      {},
    );
    expect(fresh.nodes).toHaveLength(2);
    expect(fresh.edges).toEqual([]);
    expect(fresh.audienceStates).toHaveLength(1);
    await review.scrollIntoViewIfNeeded();
    await review.screenshot({
      path: resolve("build/story-assertion-stale-verified.png"),
    });
    expect(
      (
        await api<{ items: unknown[] }>(
          `projects/${project.id}/story-assertions`,
        )
      ).items,
    ).toHaveLength(2);
    expect(writes).toHaveLength(5);
    expect(dialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
