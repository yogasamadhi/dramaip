import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { CreationWorkflowSchema } from "@dramaip/contracts/creation";
import { ChangePreviewSchema } from "@dramaip/contracts/automation";

test("小说驾驶舱精确返回较早未决运行，后台重启不换候选，已处理失败不反复占据主操作", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-novel-cockpit-run-"));
  let application: ElectronApplication | undefined;
  let manager: ServerConnectionManager | undefined;
  let page: Page;
  let client: StudioClient;
  let unexpectedWrites = 0;
  const diagnostics: string[] = [];
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    application
      .process()
      .stdout?.on("data", (chunk) => diagnostics.push(String(chunk)));
    application
      .process()
      .stderr?.on("data", (chunk) => diagnostics.push(String(chunk)));
    page = await application.firstWindow();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    // A read/return/restart is not a new generation or adoption. Abort any
    // such accidental request before Runtime; explicit discard/attention below
    // remain real owner API writes. No model/provider is configured or called.
    for (const pattern of [
      "**/api/v2/workflows/creation",
      "**/api/v2/workflows/creation/*/actions",
      "**/api/v2/workflows/creation/*/merge",
      "**/api/v2/workflows/creation/*/rebase",
      "**/api/v2/change-previews/*/commit",
      "**/api/v2/provider-action-previews/*/execute",
    ])
      await page.route(pattern, (route) => {
        if (route.request().method() === "GET") return route.continue();
        unexpectedWrites++;
        return route.abort();
      });
  };
  // Workflows/previews have no public seed API. Only isolated terminal review
  // fixtures use SQL; IDs and content are parsed by the official schemas.
  // Actual project/chapter creation, GETs, discard, attention and UI are live.
  const seed = (script: string, data: unknown) => {
    const result = spawnSync(
      "bun",
      [
        "scripts/run-node.mjs",
        "--input-type=module",
        "--eval",
        `import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=5000'); const data=JSON.parse(process.argv[2]); ${script}; db.close();`,
        join(userData, "dramaip.db"),
        JSON.stringify(data),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
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
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "原候选必须能找回的小说",
    });
    const chapter = await client!.chapters.create({
      projectId: project.id,
      title: "当前作者稿",
      content: "作者自行写下的正文，导航和已处理失败不应改动它。",
    });
    const createdAt = new Date().toISOString();
    const makeWorkflow = (
      stage: "awaiting-review" | "canceled" | "failed",
      offset: number,
    ) =>
      CreationWorkflowSchema.parse({
        id: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        input: {
          projectId: project.id,
          targetId: chapter.id,
          operation: "chapter",
          baseVersion: chapter.version,
          instruction: `指定原运行 ${stage}`,
          engineKind: "pi",
        },
        stage,
        version: 1,
        runIds: [],
        contextSnapshotIds: [],
        sources: [
          { kind: "chapter", id: chapter.id, version: chapter.version },
        ],
        preparedPrompt: "CONTROLLED REVIEW FIXTURE, NOT REAL GENERATION",
        issues: [],
        ...(stage !== "failed"
          ? {
              output: {
                title:
                  stage === "awaiting-review"
                    ? "较早仍待审的原候选"
                    : "较新已取消的其他候选",
                content:
                  stage === "awaiting-review"
                    ? "PRIVATE ORIGINAL UNRESOLVED CANDIDATE"
                    : "PRIVATE NEWER CANCELED CANDIDATE",
                items: [],
              },
            }
          : { error: "受控历史失败仍未处理" }),
        createdAt: new Date(Date.parse(createdAt) + offset).toISOString(),
        updatedAt: createdAt,
      });
    const original = makeWorkflow("awaiting-review", 0);
    const newer = makeWorkflow("canceled", 1000);
    const targets = [
      {
        kind: "chapter" as const,
        id: chapter.id,
        baseVersion: chapter.version,
        patch: { content: original.output!.content },
        displayDiff: { creationWorkflowId: original.id },
      },
    ];
    const preview = ChangePreviewSchema.parse({
      id: crypto.randomUUID(),
      projectId: project.id,
      taskId: original.taskId,
      targets,
      rationale: "只供后台原候选返回测试，不代表真实模型输出",
      status: "pending",
      contentHash: createHash("sha256")
        .update(JSON.stringify(targets))
        .digest("hex"),
      createdAt,
    });
    original.previewId = preview.id;
    const insert = `
      const task=db.prepare("INSERT INTO automation_tasks(id,kind,status,title,progress,project_id,result_json,error,created_at,updated_at,attention_status) VALUES (?,'creation.chapter',?,?,1,?,?,?,?,?,'open')");
      const workflow=db.prepare("INSERT INTO automation_creation_workflows(id,project_id,target_id,stage,version,request_key,request_hash,value_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
      for(const item of data.workflows){task.run(item.taskId,item.stage==='failed'?'failed':'succeeded',item.input.instruction,item.input.projectId,JSON.stringify({creationWorkflowId:item.id}),item.error??null,item.createdAt,item.updatedAt); workflow.run(item.id,item.input.projectId,item.input.targetId,item.stage,item.version,item.id,'controlled-review-fixture-only',JSON.stringify(item),item.createdAt,item.updatedAt);}
    `;
    seed(
      `${insert}
      db.prepare("INSERT INTO automation_change_previews(id,project_id,task_id,targets_json,rationale,status,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?)").run(data.preview.id,data.preview.projectId,data.preview.taskId,JSON.stringify(data.preview.targets),data.preview.rationale,data.preview.status,data.preview.contentHash,data.preview.createdAt);
    `,
      { workflows: [original, newer], preview },
    );
    const cockpitRoute = `/projects/${project.id}/tools/cockpit`;
    const exactRoute = `/tasks?projectId=${project.id}&taskId=${original.taskId}&workflowId=${original.id}`;
    const cockpit = () =>
      page.getByRole("region", { name: "项目驾驶舱", exact: true });
    const primary = () =>
      cockpit().getByRole("article", { name: "唯一推荐下一步", exact: true });
    const object = () =>
      page.getByRole("region", { name: "对应待确认对象", exact: true });
    await navigate(cockpitRoute);
    await expect(
      primary().getByRole("link", { name: "审阅小说候选", exact: true }),
    ).toHaveAttribute("href", `#${exactRoute}`);
    await primary()
      .getByRole("link", { name: "审阅小说候选", exact: true })
      .click();
    await expect(object()).toContainText(original.output!.content);
    await expect(object()).not.toContainText(newer.output!.content);
    expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(
      exactRoute,
    );
    await expect(
      object().getByRole("button", { name: "放弃候选", exact: true }),
    ).toBeEnabled();
    await hidden();
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate(cockpitRoute);
    await expect(
      primary().getByRole("link", { name: "审阅小说候选", exact: true }),
    ).toHaveAttribute("href", `#${exactRoute}`);
    await primary()
      .getByRole("link", { name: "审阅小说候选", exact: true })
      .click();
    await expect(object()).toContainText(original.output!.content);
    await expect(object()).not.toContainText(newer.output!.content);
    await page.screenshot({
      path: info.outputPath("original-unresolved-run-restored.png"),
    });
    expect(await client!.chapters.get(chapter.id)).toEqual(chapter);
    expect(unexpectedWrites).toBe(0);
    await object()
      .getByRole("button", { name: "放弃候选", exact: true })
      .click();
    await expect
      .poll(async () => (await client!.creation.get(original.id)).stage)
      .toBe("discarded");
    expect((await client!.creation.get(newer.id)).stage).toBe("canceled");
    expect(await client!.chapters.get(chapter.id)).toEqual(chapter);

    const failure = makeWorkflow("failed", 2000);
    seed(insert, { workflows: [failure] });
    const failureRoute = `/tasks?projectId=${project.id}&taskId=${failure.taskId}&workflowId=${failure.id}`;
    await navigate(cockpitRoute);
    await expect(
      primary().getByRole("link", { name: "处理小说创作失败", exact: true }),
    ).toHaveAttribute("href", `#${failureRoute}`);
    await primary()
      .getByRole("link", { name: "处理小说创作失败", exact: true })
      .click();
    await expect(object()).toContainText(failure.error!);
    await navigate(`/tasks?projectId=${project.id}&taskId=${failure.taskId}`);
    await object()
      .getByRole("button", { name: "标记为已处理", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await client!.tasks.list()).find(
            (item) => item.id === failure.taskId,
          )?.attentionStatus,
      )
      .toBe("acknowledged");
    await navigate(cockpitRoute);
    await expect(
      primary().getByRole("link", { name: "继续 AI 创作", exact: true }),
    ).toBeVisible();
    await expect(
      cockpit().getByRole("article", { name: "正文与章节采用", exact: true }),
    ).toContainText("作者稿已保存");
    await expect(cockpit()).not.toContainText("当前正文已采用");
    await expect(cockpit()).not.toContainText("完整稿件已核验保存");
    await expect(
      primary().getByRole("link", { name: "处理小说创作失败", exact: true }),
    ).toHaveCount(0);
    expect(await client!.chapters.get(chapter.id)).toEqual(chapter);
    expect((await client!.creation.get(failure.id)).stage).toBe("failed");
    expect((await client!.creation.get(original.id)).stage).toBe("discarded");
    expect((await client!.creation.get(newer.id)).stage).toBe("canceled");
    expect(unexpectedWrites).toBe(0);
    await hidden();
    await page.screenshot({
      path: info.outputPath(
        "acknowledged-failure-independent-author-manuscript.png",
      ),
    });
  } catch (error) {
    await info.attach("isolated-runtime-diagnostics", {
      body: diagnostics.join(""),
      contentType: "text/plain",
    });
    await page
      ?.screenshot({ path: info.outputPath("failure-state.png") })
      .catch(() => undefined);
    throw error;
  } finally {
    manager?.disconnect();
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
