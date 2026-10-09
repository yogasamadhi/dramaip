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
  ProductionQualitySource,
  ProductionRecord,
  ProductionQualitySourcePage,
} from "@dramaip/contracts/production";

test("普通剧本与独立场景只读来源：无小说／模型或自动初始化、实际父文档变化和后台精确恢复", async () => {
  test.setTimeout(120000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-production-quality-sources-"),
  );
  let application: ElectronApplication | undefined,
    page: Page,
    bootstrap: { baseUrl: string; accessToken: string },
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
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30000 });
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
  try {
    await launch();
    const { project } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "只读实际剧本／场景来源前置" },
    );
    const script = await api<ProductionRecord>("scripts", "POST", {
      projectId: project.id,
      title: "实际保存原稿",
      payload: { 剧本内容: "INT. ACTUAL ROOM - DAY\n\nACTUAL SAVED ACTION." },
    });
    const scene = await api<ProductionRecord>("scenes", "POST", {
      projectId: project.id,
      title: "独立场景，无父剧本",
      payload: { 场景动作: "ACTUAL INDEPENDENT SCENE." },
    });
    const linked = await api<ProductionRecord>("scenes", "POST", {
      projectId: project.id,
      parentId: script.id,
      title: "有真实父级的场景",
      payload: { 场景动作: "ACTUAL LINKED SCENE." },
    });
    const path = `projects/${project.id}/production-quality-sources`;
    const get = (id: string) => api<ProductionQualitySource>(`${path}/${id}`);
    const beforeTasks = await api("tasks"),
      beforeWorkflows = await api(`workflows/creation?projectId=${project.id}`);
    const sources = await Promise.all(
      [script, scene, linked].map((record) => get(record.id)),
    );
    for (const source of sources)
      expect(source.source.state, JSON.stringify(source)).toBe("available");
    expect(sources[1]!.source).not.toHaveProperty("document");
    const items: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await api<ProductionQualitySourcePage>(
        `${path}?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(JSON.stringify(page)).not.toMatch(
        /ACTUAL|payload|document|policyDependencies|contentHash/u,
      );
      items.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(items)).toEqual(new Set([script.id, scene.id, linked.id]));
    expect(await api(`projects/${project.id}/chapters`)).toEqual([]);
    // Catalog integration is now explicit; this source journey still does not run a model or validate a report.
    const catalog = await api<{
      targets: {
        target: {
          kind: string;
          id: string;
          version: number;
          sourceFingerprint?: string;
        };
      }[];
    }>(`projects/${project.id}/narrative-quality-sources`);
    for (const source of sources) {
      if (source.source.state !== "available")
        throw new Error("Actual source missing");
      expect(
        catalog.targets.find((item) => item.target.id === source.id)?.target,
      ).toEqual({
        kind: source.kind,
        id: source.id,
        version: source.version,
        sourceFingerprint: source.source.contentHash,
      });
    }
    await application!.close();
    application = undefined;
    await launch();
    for (const source of sources) expect(await get(source.id)).toEqual(source);
    expect(await api(`scripts/${script.id}`)).toEqual(script);
    expect(await api(`scenes/${scene.id}`)).toEqual(scene);
    expect(await api(`scenes/${linked.id}`)).toEqual(linked);
    const original = sources[0]!;
    if (original.source.state !== "available" || !original.source.document)
      throw new Error("Actual saved source missing");
    await api(
      `scripts/${script.id}/screenplay`,
      "PATCH",
      {
        version: original.source.document.version,
        blocks: original.source.document.blocks.map((block) =>
          "text" in block && block.text === "ACTUAL SAVED ACTION."
            ? { ...block, text: "ACTUAL SAVED CHANGED ACTION." }
            : block,
        ),
      },
      { "If-Match": `"${original.source.document.version}"` },
    );
    const changed = await get(script.id),
      changedLinked = await get(linked.id),
      originalLinked = sources[2]!;
    if (
      changed.source.state !== "available" ||
      changedLinked.source.state !== "available" ||
      originalLinked.source.state !== "available"
    )
      throw new Error("Changed source missing");
    expect(changed.source.contentHash).not.toBe(original.source.contentHash);
    expect(changedLinked.source.contentHash).not.toBe(
      originalLinked.source.contentHash,
    );
    expect(changedLinked.version).toBe(linked.version);
    expect(await get(scene.id)).toEqual(sources[1]);
    expect(await api("tasks")).toEqual(beforeTasks);
    expect(await api(`workflows/creation?projectId=${project.id}`)).toEqual(
      beforeWorkflows,
    );
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
