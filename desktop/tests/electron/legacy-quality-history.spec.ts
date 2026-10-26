import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";

test("旧固定／数量质量只读未认证，实际读取故障不回填缓存，原历史后台重启且零自动评议", async ({}, info) => {
  test.setTimeout(120000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-legacy-quality-e2e-"));
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined;
  let page: Page,
    client: StudioClient,
    unexpectedWrites = 0,
    nativeDialogs = 0;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    page.on("dialog", async (dialog) => {
      nativeDialogs++;
      await dialog.dismiss();
    });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    for (const pattern of [
      "**/api/v2/creative/diagnostics",
      "**/api/v2/creative/issue-acknowledgements",
      "**/api/v2/workflows/creation",
      "**/api/v2/workflows/episodes/run",
      "**/api/v2/projects/*/narrative-local-reviews",
      "**/api/v2/provider-action-previews/*/execute",
    ])
      await page.route(pattern, (route) => {
        if (route.request().method() === "GET") return route.continue();
        unexpectedWrites++;
        return route.abort();
      });
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  };
  const close = async () => {
    manager?.disconnect();
    manager = undefined;
    await application?.close();
    application = undefined;
  };
  const navigate = (path: string) =>
    page.evaluate((route) => {
      window.location.hash = route;
    }, `#${path}`);
  const history = () =>
    page.getByLabel("旧兼容诊断历史（未认证）", { exact: true });
  const sql = (script: string, args: string[] = []) => {
    const result = spawnSync(
      "node",
      [
        "scripts/run-node.mjs",
        "--input-type=module",
        "--eval",
        script,
        join(userData, "dramaip.db"),
        ...args,
      ],
      { encoding: "utf8", timeout: 10000, windowsHide: true },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const storage = () =>
    sql(
      'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync(process.argv[1],{readOnly:true});const tables=["creative_quality_records","automation_tasks","automation_idempotency","narrative_local_quality_reviews","narrative_quality_reports"];console.log(JSON.stringify(Object.fromEntries(tables.map(table=>[table,db.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]))));db.close();',
    );
  try {
    await launch();
    const { project } = await client.projects.create({
      title: "仅保留历史不认证质量",
      mode: "series_longform",
      modeConfig: { mode: "series_longform" },
    });
    const { project: other } = await client.projects.create({
      title: "其他项目无旧诊断",
      mode: "series_longform",
      modeConfig: { mode: "series_longform" },
    });
    await close();
    await launch();
    const adaptation = await client.resources.create("adaptations", {
      projectId: project.id,
      title: "实际原改编",
      payload: {},
    });
    const episode = await client.resources.create("episodes", {
      projectId: project.id,
      parentId: adaptation.id,
      title: "实际原分集",
      payload: {},
    });
    await close();
    const id = crypto.randomUUID(),
      taskId = crypto.randomUUID(),
      createdAt = "2026-01-01T00:00:00.000Z";
    const value = {
      projectId: project.id,
      targetKind: "project",
      targetTitle: "原项目",
      kind: "quality_gate",
      title: "原固定诊断仍保留",
      summary: "原未认证总结",
      scores: [{ label: "资料完整度", value: 72 }],
      findings: ["原问题"],
      recommendations: ["原建议"],
      curve: [35, 52, 68, 81],
      sourceFingerprint: "old-input-not-content-evidence",
      createdAt,
    };
    // Controlled pre-upgrade seed, only while this isolated app is closed.
    sql(
      'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync(process.argv[1]);const x=JSON.parse(process.argv[2]);db.prepare("INSERT INTO creative_quality_records(id,kind,project_id,parent_id,value_json,version,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)").run(x.id,"diagnostic",x.value.projectId,null,JSON.stringify(x.value),x.createdAt,x.createdAt);db.prepare("INSERT INTO creative_quality_records(id,kind,project_id,parent_id,value_json,version,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)").run(x.ackId,"acknowledgement",x.value.projectId,x.id,JSON.stringify({projectId:x.value.projectId,diagnosticId:x.id,issueKey:"原问题",disposition:"fixed",note:"旧人工声明不认证修复",createdAt:x.createdAt}),x.createdAt,x.createdAt);db.prepare("INSERT INTO automation_tasks(id,kind,status,title,progress,project_id,result_json,created_at,updated_at,attention_status) VALUES(?,? ,?,? ,1,?,?,?,?,?)").run(x.taskId,"quality-check","succeeded","原数量质量任务",x.value.projectId,JSON.stringify({summary:"分集质量检查已完成。"}),x.createdAt,x.createdAt,"open");db.close();',
      [
        JSON.stringify({
          id,
          taskId,
          ackId: crypto.randomUUID(),
          value,
          createdAt,
        }),
      ],
    );
    sql(
      'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync(process.argv[1]);const x=JSON.parse(process.argv[2]);db.prepare("INSERT INTO creative_quality_records(id,kind,project_id,parent_id,value_json,version,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)").run(x.id,"episode-analysis",null,x.adaptationId,JSON.stringify({adaptationId:x.adaptationId,episodeCount:0,hookCoverage:0,cliffhangerCoverage:0,outlineCoverage:0,overallScore:0,summary:"原零覆盖分析仍保留",suggestions:["原零建议"]}),x.createdAt,x.createdAt);db.close();',
      [
        JSON.stringify({
          id: crypto.randomUUID(),
          adaptationId: adaptation.id,
          createdAt,
        }),
      ],
    );
    await launch();
    const before = storage();
    await expect(
      client.creative.runDiagnostics({
        projectId: project.id,
        kinds: ["quality_gate"],
      }),
    ).rejects.toThrow("已停止新生成");
    await expect(
      client.creative.acknowledgeIssue({
        projectId: project.id,
        diagnosticId: id,
        issueKey: "原问题",
        disposition: "fixed",
      }),
    ).rejects.toThrow("不再新增问题确认");
    await expect(
      client.workflows.runEpisode(
        {
          projectId: project.id,
          episodeId: crypto.randomUUID(),
          kind: "quality-check",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("已停止新生成");
    await expect(
      client.adaptationAnalysis.run(crypto.randomUUID()),
    ).rejects.toThrow("已停止新生成");
    const route = `/create?projectId=${project.id}`,
      otherRoute = `/create?projectId=${other.id}`;
    await navigate(route);
    await expect(
      history().getByText(value.title, { exact: true }),
    ).toBeVisible();
    await expect(
      history().getByRole("button", { name: "生成创意诊断", exact: true }),
    ).toHaveCount(0);
    await expect(
      history().getByRole("button", { name: "确认知悉", exact: true }),
    ).toHaveCount(0);
    await expect(
      history().getByText(value.summary, { exact: false }),
    ).not.toBeVisible();
    await history()
      .getByText("展开原记录（未认证，量纲未知）", { exact: true })
      .click();
    await expect(
      history().getByText("原数值（未认证／量纲未知）：资料完整度 72", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(history()).not.toContainText("72.0/10");
    await expect(history()).toContainText("旧人工声明（不认证修复或质量）");
    const original = await client.creative.listDiagnostics(project.id);
    expect(original).toMatchObject([
      {
        id,
        scores: value.scores,
        curve: value.curve,
        sourceFingerprint: value.sourceFingerprint,
      },
    ]);
    let heldRead = false,
      release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const pattern = `**/api/v2/projects/${project.id}/creative-diagnostics`;
    await page.route(pattern, async (route) => {
      heldRead = true;
      await held;
      await route.continue();
    });
    await navigate(otherRoute);
    await expect(history()).toContainText("本项目没有旧兼容诊断");
    await navigate(route);
    await expect.poll(() => heldRead).toBe(true);
    await expect(history().getByText(value.title, { exact: true })).toHaveCount(
      0,
    );
    await expect(history()).toContainText("正在实际读取本项目历史诊断");
    release();
    await page.unroute(pattern);
    await expect(
      history().getByText(value.title, { exact: true }),
    ).toBeVisible();
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "受控原历史读取不可用",
          status: 503,
          code: "CONTROLLED_HISTORY_UNAVAILABLE",
        }),
      }),
    );
    await navigate(otherRoute);
    await expect(history()).toContainText("本项目没有旧兼容诊断");
    await navigate(route);
    await expect(history()).toContainText("历史诊断读取失败；未显示旧缓存");
    await expect(history().getByText(value.title, { exact: true })).toHaveCount(
      0,
    );
    await history().screenshot({
      path: info.outputPath("legacy-history-owner-failed.png"),
    });
    await page.unroute(pattern);
    await navigate(otherRoute);
    await expect(history()).toContainText("本项目没有旧兼容诊断");
    await navigate(route);
    await expect(
      history().getByText(value.title, { exact: true }),
    ).toBeVisible();
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      const rows = await response.json();
      rows[0].projectId = other.id;
      await route.fulfill({ response, json: rows });
    });
    await navigate(otherRoute);
    await expect(history()).toContainText("本项目没有旧兼容诊断");
    await navigate(route);
    await expect(history()).toContainText("历史记录身份或项目不一致");
    await expect(history().getByText(value.title, { exact: true })).toHaveCount(
      0,
    );
    await page.unroute(pattern);
    await close();
    await launch();
    await navigate(route);
    await expect(
      history().getByText(value.title, { exact: true }),
    ).toBeVisible();
    await history()
      .getByText("展开原记录（未认证，量纲未知）", { exact: true })
      .click();
    await expect(history()).toContainText(
      "原曲线数值（未认证／量纲未知）：35 → 52 → 68 → 81",
    );
    await history().screenshot({
      path: info.outputPath("legacy-history-restored-unverified.png"),
    });
    await history()
      .getByRole("link", { name: "打开独立质量评议", exact: true })
      .click();
    await expect(
      page.getByLabel("独立本地质量评议", { exact: true }),
    ).toBeVisible();
    await navigate(`/tasks?taskId=${taskId}`);
    const card = page.locator(`[data-task-id="${taskId}"]`);
    await expect(card).toContainText("历史记录 · 质量未认证");
    await expect(card).toContainText("固定／数量评分不代表当前质量通过");
    await expect(
      card.getByRole("link", { name: "返回原操作", exact: true }),
    ).toHaveAttribute("href", `#/create?projectId=${project.id}`);
    const adaptationRoute = `/adapt?projectId=${project.id}&adaptationId=${adaptation.id}&episodeId=${episode.id}&stage=adaptations`;
    await navigate(adaptationRoute);
    const analysis = () =>
      page.getByLabel("旧分集分析（未认证）", { exact: true });
    await expect(analysis()).toBeVisible();
    await expect(
      analysis().getByText("展开原分集分析（未认证／量纲未知）", {
        exact: true,
      }),
    ).toBeVisible();
    for (const name of ["开始分析", "重新分析", "删除分析"])
      await expect(
        analysis().getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    await analysis()
      .getByText("展开原分集分析（未认证／量纲未知）", { exact: true })
      .click();
    await expect(analysis()).toContainText("原零覆盖分析仍保留");
    await expect(analysis()).toContainText("不证明覆盖");
    const analysisPattern = `**/api/v2/adaptations/${adaptation.id}/episode-analysis`;
    await page.route(analysisPattern, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "受控原分析读取失败",
          status: 503,
          code: "CONTROLLED_ANALYSIS_UNAVAILABLE",
        }),
      }),
    );
    await navigate(route);
    await expect(
      history().getByText(value.title, { exact: true }),
    ).toBeVisible();
    await navigate(adaptationRoute);
    await expect(analysis()).toContainText("原分集分析读取失败；未显示旧缓存");
    await expect(
      analysis().getByText("展开原分集分析（未认证／量纲未知）", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.unroute(analysisPattern);
    await navigate(route);
    await expect(
      history().getByText(value.title, { exact: true }),
    ).toBeVisible();
    await navigate(adaptationRoute);
    await expect(
      analysis().getByText("展开原分集分析（未认证／量纲未知）", {
        exact: true,
      }),
    ).toBeVisible();
    await analysis()
      .getByText("展开原分集分析（未认证／量纲未知）", { exact: true })
      .click();
    await analysis().screenshot({
      path: info.outputPath("legacy-episode-analysis-unverified.png"),
    });
    expect(storage()).toBe(before);
    expect(unexpectedWrites).toBe(0);
    expect(nativeDialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await close();
    await rm(userData, { recursive: true, force: true });
  }
});
