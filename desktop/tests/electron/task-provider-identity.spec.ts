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
import { CreationWorkflowSchema } from "@dramaip/contracts/creation";

test("任务实际归属、未知币种、旧参数和变更后的费用确认不启动远程调用，后台重启不保留确认", async ({}, info) => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-task-provider-identity-"),
  );
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
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
  };
  // Public APIs do not create provider previews. Controlled records are seeded
  // only in this isolated fixture DB; all assertions read the actual Runtime
  // and UI. No provider, credential, model, engine or external executor is used.
  const fixtureWrite = (script: string, data: unknown) => {
    const result = spawnSync(
      "node",
      [
        "scripts/run-node.mjs",
        "--input-type=module",
        "--eval",
        `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=5000'); const data=JSON.parse(process.argv[2]); ${script}; db.close();`,
        join(userData, "dramaip.db"),
        JSON.stringify(data),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  };
  const navigate = (value: string) =>
    page.evaluate((route) => {
      window.location.hash = route;
    }, value);
  const hidden = async () =>
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  let releaseRead: (() => void) | undefined;
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "实际费用确认项目",
    });
    const { project: other } = await client!.projects.create({
      title: "其他费用项目",
    });
    const now = new Date().toISOString();
    const providerId = crypto.randomUUID();
    const records = [
      {
        taskId: crypto.randomUUID(),
        previewId: crypto.randomUUID(),
        projectId: project.id,
        currency: "CNY",
        estimatedCost: 0,
        prompt: "ACTUAL CURRENT ZERO PARAMETERS",
        title: "真实零估值任务",
      },
      {
        taskId: crypto.randomUUID(),
        previewId: crypto.randomUUID(),
        projectId: project.id,
        estimatedCost: 1,
        prompt: "ACTUAL UNKNOWN CURRENCY PARAMETERS",
        title: "未知币种任务",
      },
      {
        taskId: crypto.randomUUID(),
        previewId: crypto.randomUUID(),
        projectId: other.id,
        currency: "CNY",
        estimatedCost: 3,
        prompt: "FOREIGN PRIVATE PARAMETERS",
        title: "外项目预览错误绑定",
      },
      {
        taskId: crypto.randomUUID(),
        previewId: crypto.randomUUID(),
        projectId: project.id,
        currency: "CNY",
        estimatedCost: 4,
        prompt: "ACTUAL ACCEPTED PARAMETERS",
        title: "仅受理不等于采用或结算",
      },
    ];
    const acceptedTaskId = crypto.randomUUID();
    const workflowTaskId = crypto.randomUUID();
    const workflow = CreationWorkflowSchema.parse({
      id: crypto.randomUUID(),
      taskId: workflowTaskId,
      input: {
        projectId: project.id,
        operation: "chapter",
        instruction: "Controlled binding fixture only",
        engineKind: "pi",
      },
      stage: "canceled",
      version: 0,
      runIds: [],
      contextSnapshotIds: [],
      sources: [],
      preparedPrompt: "CONTROLLED WORKFLOW CONTEXT",
      issues: [],
      createdAt: now,
      updatedAt: now,
    });
    fixtureWrite(
      `
      const insertTask=db.prepare("INSERT INTO automation_tasks(id,kind,status,title,progress,project_id,result_json,created_at,updated_at,attention_status) VALUES (?,'controlled-preview','succeeded',?,1,?,?,?,?,'open')");
      const insertPreview=db.prepare("INSERT INTO automation_provider_action_previews(id,project_id,task_id,kind,provider_id,parameters_json,estimated_cost,currency,status,created_at) VALUES (?,?,?,'image',?,?,?,?,'pending',?)");
      for(const item of data.records){const snapshot={id:item.previewId, projectId:data.projectId, taskId:item.taskId, kind:'image',providerId:data.providerId,parameters:{prompt:'STALE PRIVATE SNAPSHOT PARAMETERS'},estimatedCost:99,currency:'USD',status:'pending',createdAt:data.now};insertTask.run(item.taskId,item.title,data.projectId,JSON.stringify({providerActionPreview:snapshot}),data.now,data.now);insertPreview.run(item.previewId,item.projectId,item.taskId,data.providerId,JSON.stringify({prompt:item.prompt}),item.estimatedCost,item.currency??null,data.now);}
      insertTask.run(data.acceptedTaskId,'受控受理任务',data.projectId,JSON.stringify({providerActionPreviewId:data.records[3].previewId}),data.now,data.now);
      db.prepare("UPDATE automation_tasks SET status='queued',progress=0 WHERE id=?").run(data.acceptedTaskId);
      db.prepare("UPDATE automation_provider_action_previews SET status='executed',task_id=?,executed_at=? WHERE id=?").run(data.acceptedTaskId,data.now,data.records[3].previewId);
      insertTask.run(data.workflow.taskId,'真实运行绑定任务',data.projectId,JSON.stringify({creationWorkflowId:data.workflow.id}),data.now,data.now);
      db.prepare("INSERT INTO automation_creation_workflows(id,project_id,stage,request_key,request_hash,value_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(data.workflow.id,data.projectId,data.workflow.stage,data.workflow.id,'controlled-fixture-only',JSON.stringify(data.workflow),data.now,data.now);
    `,
      {
        records,
        acceptedTaskId,
        projectId: project.id,
        providerId,
        workflow,
        now,
      },
    );
    let executeRequests = 0;
    // Any unexpected execute is counted and aborted before Runtime/executor.
    const preventExecution = async () =>
      page.route("**/api/v2/provider-action-previews/*/execute", (route) => {
        executeRequests++;
        return route.abort();
      });
    await preventExecution();
    // M1 reads the owner's complete body-free list, including an independent
    // preview with no task/conversation. No public preview-creation API exists.
    const standaloneId = crypto.randomUUID();
    fixtureWrite(
      "db.prepare(\"INSERT INTO automation_provider_action_previews(id,project_id,kind,provider_id,parameters_json,estimated_cost,currency,status,created_at) VALUES (?,?,'image',?,?,0,'CNY','pending',?)\").run(data.id,data.projectId,data.providerId,JSON.stringify({prompt:'STANDALONE ACTUAL PRIVATE PARAMETERS'}),data.now)",
      { id: standaloneId, projectId: project.id, providerId, now },
    );
    const feePage = await client!.providerActionPreviews.summaries(project.id);
    expect(feePage.items.map((item) => item.id).sort()).toEqual(
      [
        records[0]!.previewId,
        records[1]!.previewId,
        records[3]!.previewId,
        standaloneId,
      ].sort(),
    );
    expect(JSON.stringify(feePage)).not.toContain("parameters");
    await navigate(`/pending?projectId=${project.id}`);
    const feeItem = (id: string) =>
      page.locator(`[data-confirmation-key="provider-action:${id}"]`);
    await expect(feeItem(records[0]!.previewId)).toContainText("0.0000 CNY");
    await expect(
      page.locator(`[data-confirmation-key="task:${records[0]!.taskId}"]`),
    ).toHaveCount(0);
    await expect(feeItem(records[3]!.previewId)).toHaveCount(0);
    for (const marker of [
      "STALE PRIVATE",
      "ACTUAL CURRENT ZERO PARAMETERS",
      "STANDALONE ACTUAL PRIVATE PARAMETERS",
      "FOREIGN PRIVATE",
    ])
      await expect(page.locator("main")).not.toContainText(marker);
    await feeItem(standaloneId)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const feeRegion = () =>
      page.getByRole("region", { name: "指定费用与外部调用确认", exact: true });
    await expect(feeRegion()).toContainText("0.0000 CNY");
    await expect(
      feeRegion().getByRole("button", {
        name: "确认并创建远程任务",
        exact: true,
      }),
    ).toBeEnabled();
    expect(executeRequests).toBe(0);
    await feeRegion().screenshot({
      path: info.outputPath("m1-standalone-fee-owner.png"),
    });
    await navigate(`/pending?projectId=${project.id}&category=attention`);
    await expect(feeItem(records[1]!.previewId)).toContainText("币种未知");
    await feeItem(records[1]!.previewId)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(
      feeRegion().getByRole("button", {
        name: "确认并创建远程任务",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(feeRegion()).toContainText("不能据此确认远程调用");
    await navigate(
      `/pending?projectId=${other.id}&providerActionPreviewId=${standaloneId}`,
    );
    await expect(feeRegion().getByRole("alert")).toContainText("归属不符");
    await expect(
      feeRegion().getByRole("button", {
        name: "确认并创建远程任务",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(
      "STANDALONE ACTUAL PRIVATE PARAMETERS",
    );
    for (const search of [
      `projectId=${project.id}&providerActionPreviewId=`,
      `projectId=${project.id}&providerActionPreviewId=${standaloneId}&providerActionPreviewId=${records[0]!.previewId}`,
      `projectId=${project.id}&projectId=${other.id}&providerActionPreviewId=${standaloneId}`,
      `providerActionPreviewId=${standaloneId}`,
    ]) {
      await navigate(`/pending?${search}`);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "指定费用预览的项目或身份重复／为空" }),
      ).toBeVisible();
      await expect(feeRegion()).toHaveCount(0);
      expect(executeRequests).toBe(0);
    }
    await hidden();
    expect(executeRequests).toBe(0);
    const exact = (taskId: string) =>
      `/tasks?projectId=${project.id}&taskId=${taskId}`;
    const object = () =>
      page.getByRole("region", { name: "对应待确认对象", exact: true });
    const card = () =>
      object().getByRole("region", { name: "实际厂商调用预览", exact: true });
    const execute = () =>
      card().getByRole("button", { name: "确认并创建远程任务", exact: true });
    const original = records[0]!;
    await navigate(exact(original.taskId));
    await expect(card()).toContainText("0.0000 CNY");
    await expect(execute()).toBeEnabled();
    await card().getByText("查看实际记录参数", { exact: true }).click();
    await expect(card()).toContainText(original.prompt);
    await expect(page.locator("main")).not.toContainText("STALE PRIVATE");
    await expect(card()).not.toContainText("99.0000 USD");
    const unknown = records[1]!;
    await navigate(exact(unknown.taskId));
    await expect(card()).toContainText("预估费用或币种未知");
    await expect(execute()).toBeDisabled();
    await expect(card()).not.toContainText("USD");
    await expect(object()).not.toContainText(original.prompt);
    await navigate(exact(records[3]!.taskId));
    await expect(card()).toContainText("已创建任务（账单未知）");
    await expect(object().getByText("已应用", { exact: true })).toHaveCount(0);
    await expect(execute()).toHaveCount(0);
    const bad = [
      exact(records[2]!.taskId),
      `/tasks?projectId=${other.id}&taskId=${original.taskId}`,
      `/tasks?projectId=${project.id}&taskId=${crypto.randomUUID()}&workflowId=${workflow.id}`,
      `/tasks?projectId=${project.id}&taskId=${original.taskId}&workflowId=${workflow.id}`,
      `/tasks?projectId=${project.id}&taskId=${original.taskId}&taskId=${unknown.taskId}`,
      `/tasks?projectId=${project.id}&taskId=`,
      `/tasks?projectId=${project.id}&projectId=${other.id}&taskId=${original.taskId}`,
      `/tasks?projectId=&taskId=${original.taskId}`,
    ];
    for (const route of bad) {
      await navigate(route);
      await expect(object().getByRole("alert")).toContainText(
        /引用|绑定|归属|不存在/,
      );
      await expect(
        page.locator("main").getByRole("region", { name: "实际厂商调用预览" }),
      ).toHaveCount(0);
      for (const marker of [
        "STALE PRIVATE",
        original.prompt,
        unknown.prompt,
        "FOREIGN PRIVATE",
      ])
        await expect(page.locator("main")).not.toContainText(marker);
      expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(
        route,
      );
    }
    // In the ordinary worklist, the foreign preview must not appear through a
    // valid task title. These are current owner GETs, not snapshot candidates.
    await navigate(`/tasks?projectId=${project.id}`);
    await expect(
      page
        .locator(`[data-task-id="${original.taskId}"]`)
        .getByRole("region", { name: "实际厂商调用预览" }),
    ).toContainText("0.0000 CNY");
    await expect(
      page
        .locator(`[data-task-id="${unknown.taskId}"]`)
        .getByRole("button", { name: "确认并创建远程任务" }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: /历史/ }).click();
    await expect(
      page.locator(`[data-task-id="${records[2]!.taskId}"]`).getByRole("alert"),
    ).toContainText("归属不符");
    await expect(page.locator("main")).not.toContainText("FOREIGN PRIVATE");
    await navigate(
      `/tasks?projectId=${project.id}&taskId=${workflow.taskId}&workflowId=${workflow.id}`,
    );
    await expect(object()).toContainText("已取消");
    await expect(object()).toContainText("Controlled binding fixture only");
    // Parameters are immutable in the public API. Change the isolated owner
    // row as an adversarial stale-record fixture while a confirmation is open.
    await navigate(exact(original.taskId));
    await expect(execute()).toBeEnabled();
    await execute().click();
    const dialog = page.getByRole("dialog", { name: "确认操作", exact: true });
    await expect(dialog).toContainText("0.0000 CNY");
    fixtureWrite(
      "db.prepare('UPDATE automation_provider_action_previews SET estimated_cost=2,parameters_json=? WHERE id=?').run(JSON.stringify({prompt:'ACTUAL CHANGED PARAMETERS'}),data.id)",
      { id: original.previewId },
    );
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(card()).toContainText("2.0000 CNY");
    await expect(card().getByRole("alert")).toContainText("未执行原确认");
    expect(executeRequests).toBe(0);
    // A failed actual GET takes precedence over cached parameters and controls.
    await page.route(
      `**/api/v2/provider-action-previews/${original.previewId}`,
      (route) => route.abort(),
    );
    await expect(object().getByRole("alert")).toBeVisible();
    await expect(
      object().getByRole("region", { name: "实际厂商调用预览" }),
    ).toHaveCount(0);
    await expect(object()).not.toContainText("ACTUAL CHANGED PARAMETERS");
    await page.unroute(
      `**/api/v2/provider-action-previews/${original.previewId}`,
    );
    await expect(execute()).toBeEnabled();
    // Delay the real confirmation GET, leave the object, then release it.
    let signalRead!: () => void;
    const received = new Promise<void>((done) => {
      signalRead = done;
    });
    const resumed = new Promise<void>((done) => {
      releaseRead = done;
    });
    let signalReply!: () => void;
    const replied = new Promise<void>((done) => {
      signalReply = done;
    });
    const readRoute = `**/api/v2/provider-action-previews/${original.previewId}`;
    await page.route(readRoute, async (route) => {
      const response = await route.fetch();
      signalRead();
      await resumed;
      await route.fulfill({ response });
      signalReply();
    });
    await execute().click();
    await received;
    await navigate(exact(unknown.taskId));
    await expect(execute()).toBeDisabled();
    releaseRead!();
    await replied;
    await page.unroute(readRoute);
    await expect(
      page.getByRole("dialog", { name: "确认操作", exact: true }),
    ).toHaveCount(0);
    expect(executeRequests).toBe(0);
    await hidden();
    // Restarting never restores a previous confirmation; status is re-read.
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await preventExecution();
    await navigate(exact(original.taskId));
    await expect(card()).toContainText("2.0000 CNY");
    await expect(
      page.getByRole("dialog", { name: "确认操作", exact: true }),
    ).toHaveCount(0);
    expect(
      (await client!.providerActionPreviews.get(original.previewId)).status,
    ).toBe("pending");
    expect(
      (await client!.providerActionPreviews.get(unknown.previewId)).currency,
    ).toBeUndefined();
    expect(executeRequests).toBe(0);
    await card()
      .getByRole("button", { name: "放弃此次调用", exact: true })
      .click();
    await expect(card()).toContainText("已放弃（不证明无历史费用）");
    expect(
      (await client!.providerActionPreviews.get(original.previewId)).status,
    ).toBe("discarded");
    expect(
      (await client!.providerActionPreviews.get(unknown.previewId)).status,
    ).toBe("pending");
    await hidden();
    await page.screenshot({
      path: info.outputPath("task-provider-actual-identity.png"),
    });
  } finally {
    releaseRead?.();
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
