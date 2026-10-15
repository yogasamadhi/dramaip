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
  StoryDeclaration,
  StoryAssertion,
} from "@dramaip/contracts/knowledge";
import type { ScreenplaySource } from "@dramaip/contracts/production";

test("明确节点／关系／认知撤回替换：独立新审阅、后台重启、丢回复回执和失败缓存保护", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-source-lifecycle-e2e-"),
  );
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
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        /\/(withdraw|replace)$/u.test(new URL(req.url()).pathname)
      )
        writes.push(new URL(req.url()).pathname);
    });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    bootstrap = await page.evaluate(() => window.runtimeBootstrap.resolve());
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
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
  const open = async (
    projectId: string,
    kind: "node" | "assertion",
    id: string,
  ) => {
    await page.evaluate(
      (query) => {
        window.location.hash = `#/create?${query}`;
      },
      new URLSearchParams({
        projectId,
        [kind === "node" ? "storyDeclarationId" : "storyAssertionId"]: id,
      }).toString(),
    );
    const panel = page.getByLabel(
      kind === "node" ? "原正式来源声明审阅" : "原关系认知来源审阅",
      { exact: true },
    );
    await expect(panel).toContainText(id);
    return panel.getByLabel("来源声明撤回与替换", { exact: true });
  };
  try {
    await launch();
    const { project } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      { title: "三类明确来源生命周期" },
    );
    const script = await api<{ id: string; version: number }>(
      "scripts",
      "POST",
      {
        projectId: project.id,
        title: "真实保存原稿",
        payload: {
          剧本内容: "INT. ROOM - DAY\n\nACTUAL 新旧解释共同引用的保存动作。",
        },
      },
    );
    const source = await api<ScreenplaySource>(
      `projects/${project.id}/screenplay-sources/${script.id}`,
    );
    if (source.source.state !== "available")
      throw new Error("Actual saved source missing");
    const sources = [
      {
        kind: "screenplay-blocks",
        scriptId: script.id,
        scriptVersion: script.version,
        documentId: source.source.document.id,
        documentVersion: source.source.document.version,
        documentContentHash: source.source.contentHash,
        blockIds: [
          source.source.document.blocks.find((b) => b.type === "action")!.id,
        ],
      },
    ];
    const manual = (kind: "character" | "secret") =>
      api<{ id: string; version: number }>(
        `projects/${project.id}/story-graph/nodes`,
        "POST",
        {
          kind,
          title: `实际${kind}`,
          summary: "独立手工确认节点",
          sourceType: "manual",
          sourceId: project.id,
          sourceVersion: 0,
          confirmed: true,
        },
      );
    const fromActual = await manual("character"),
      toActual = await manual("secret");
    const from = { id: fromActual.id, version: fromActual.version },
      to = { id: toActual.id, version: toActual.version };
    const definitions = [
      {
        kind: "node" as const,
        input: {
          kind: "event",
          title: "原节点",
          statement: "PRIVATE 原节点解释",
          sources,
        },
      },
      {
        kind: "assertion" as const,
        input: {
          kind: "relationship",
          title: "原关系",
          statement: "PRIVATE 原关系解释",
          interpretation: "author-inferred",
          from,
          to,
          relation: "reveals",
          confidence: 0.7,
          sources,
        },
      },
      {
        kind: "assertion" as const,
        input: {
          kind: "cognition",
          title: "原认知",
          statement: "PRIVATE 原认知解释",
          interpretation: "source-stated",
          subject: { kind: "character", node: from },
          target: to,
          storyOrder: 3,
          state: "suspects",
          sources,
        },
      },
    ];
    const pairs: {
      kind: "node" | "assertion";
      base: string;
      old: StoryDeclaration | StoryAssertion;
      next: StoryDeclaration | StoryAssertion;
    }[] = [];
    for (const definition of definitions) {
      const base = `projects/${project.id}/${definition.kind === "node" ? "story-declarations" : "story-assertions"}`;
      const pending = await api<StoryDeclaration | StoryAssertion>(
        base,
        "POST",
        definition.input,
      );
      const old = await api<StoryDeclaration | StoryAssertion>(
        `${base}/${pending.id}/adopt`,
        "POST",
        {
          sourceFingerprint: pending.basis.fingerprint,
          confirmedSourceReview: true,
          confirmedInterpretationReview: true,
        },
        { "If-Match": pending.etag },
      );
      const next = await api<StoryDeclaration | StoryAssertion>(base, "POST", {
        ...definition.input,
        title: `新${definition.input.title}`,
        statement: `新独立解释 ${definition.input.title}`,
      });
      pairs.push({ kind: definition.kind, base, old, next });
    }
    const beforeScript = await api(`scripts/${script.id}`),
      beforeSource = await api(
        `projects/${project.id}/screenplay-sources/${script.id}`,
      );
    const twin = await api<{
      id: string;
      nodes: { id: string }[];
      edges: { id: string }[];
      audienceStates: { id: string }[];
    }>(`projects/${project.id}/ip-twin`, "POST", {});
    const tasks = await api("tasks");
    let lostReceipt:
      | { path: string; body: unknown; headers: Record<string, string> }
      | undefined;
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index]!;
      let review = await open(project.id, pair.kind, pair.old.id);
      await expect(
        review.getByLabel("已审阅原记录退役与不自动重连", { exact: true }),
      ).not.toBeChecked();
      await expect(
        review.getByLabel("指定新来源候选 ID", { exact: true }),
      ).toHaveValue("");
      await expect(
        review.getByRole("button", { name: "明确撤回该原声明", exact: true }),
      ).toBeDisabled();
      if (index === 0) {
        await review
          .getByLabel("撤回替换理由", { exact: true })
          .fill("先明确撤回原节点，不删除历史");
        await review
          .getByLabel("已审阅原记录退役与不自动重连", { exact: true })
          .check();
        await review
          .getByRole("button", { name: "明确撤回该原声明", exact: true })
          .click();
        await expect(review).toContainText("当前生效状态：已撤回");
        pair.old = await api(`${pair.base}/${pair.old.id}`);
      }
      await review
        .getByLabel("指定新来源候选 ID", { exact: true })
        .fill(pair.next.id);
      await review
        .getByRole("button", { name: "读取并审阅此新草稿", exact: true })
        .click();
      let newReview = review.getByLabel("替换新候选独立审阅", { exact: true });
      await expect(newReview).toContainText(pair.next.id);
      await expect(
        newReview.getByLabel("已核对替换新候选实际来源", { exact: true }),
      ).not.toBeChecked();
      await expect(
        newReview.getByRole("button", {
          name: "明确替换并独立采用此新草稿",
          exact: true,
        }),
      ).toBeDisabled();
      if (index === 2) {
        await newReview
          .getByLabel("已核对替换新候选实际来源", { exact: true })
          .check();
        await newReview
          .getByLabel("已审阅替换新候选解释", { exact: true })
          .check();
        const writesBefore = writes.length;
        await application!.close();
        application = undefined;
        await launch();
        review = await open(project.id, pair.kind, pair.old.id);
        await expect(
          review.getByLabel("指定新来源候选 ID", { exact: true }),
        ).toHaveValue("");
        await expect(
          review.getByLabel("已审阅原记录退役与不自动重连", { exact: true }),
        ).not.toBeChecked();
        expect(writes).toHaveLength(writesBefore);
        await review
          .getByLabel("指定新来源候选 ID", { exact: true })
          .fill(pair.next.id);
        await review
          .getByRole("button", { name: "读取并审阅此新草稿", exact: true })
          .click();
        newReview = review.getByLabel("替换新候选独立审阅", { exact: true });
        await expect(newReview).toContainText(pair.next.id);
        await expect(
          newReview.getByLabel("已核对替换新候选实际来源", { exact: true }),
        ).not.toBeChecked();
        const pattern = `**/${pair.base}/${pair.next.id}`;
        await page.route(pattern, (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Controlled",
              status: 503,
              detail: "controlled candidate unavailable",
            }),
          }),
        );
        await review
          .getByRole("button", { name: "读取并审阅此新草稿", exact: true })
          .click();
        await expect(review.getByRole("alert")).toContainText(
          "指定新候选读取失败",
        );
        await expect(newReview).toHaveCount(0);
        await page.unroute(pattern);
        await review
          .getByRole("button", { name: "读取并审阅此新草稿", exact: true })
          .click();
        await expect(newReview).toContainText(pair.next.id);
      }
      await review
        .getByLabel("撤回替换理由", { exact: true })
        .fill(`明确替换 ${pair.old.id}`);
      await newReview
        .getByLabel("已核对替换新候选实际来源", { exact: true })
        .check();
      await newReview
        .getByLabel("已审阅替换新候选解释", { exact: true })
        .check();
      await review
        .getByLabel("已审阅原记录退役与不自动重连", { exact: true })
        .check();
      if (index === 1)
        await page.route(
          `**/${pair.base}/${pair.old.id}/replace`,
          async (route) => {
            lostReceipt = {
              path: `${pair.base}/${pair.old.id}/replace`,
              body: route.request().postDataJSON(),
              headers: {
                "If-Match": route.request().headers()["if-match"]!,
                "Idempotency-Key": route.request().headers()[
                  "idempotency-key"
                ]!,
              },
            };
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            await route.abort("failed");
          },
        );
      await newReview
        .getByRole("button", {
          name: "明确替换并独立采用此新草稿",
          exact: true,
        })
        .click();
      await expect(review).toContainText("当前生效状态：已替换");
      const saved = await api<StoryDeclaration | StoryAssertion>(
        `${pair.base}/${pair.old.id}`,
      );
      expect(saved.basis).toEqual(pair.old.basis);
      expect(saved.input).toEqual(pair.old.input);
      expect(saved.lifecycle).toMatchObject({
        state: "replaced",
        replacementId: pair.next.id,
      });
      const current = await api<StoryDeclaration | StoryAssertion>(
        `${pair.base}/${pair.next.id}`,
      );
      expect(current.lifecycle!.state).toBe("active");
      expect(current.lifecycle!.record.id).not.toBe(
        pair.old.lifecycle!.record.id,
      );
      if (index !== 1)
        await review.screenshot({
          path: info.outputPath(`source-lifecycle-${index}.png`),
        });
    }
    expect(writes).toHaveLength(4);
    await application!.close();
    application = undefined;
    await launch();
    if (!lostReceipt) throw new Error("Lost response not exercised");
    const replay = await api<StoryAssertion>(
      lostReceipt.path,
      "POST",
      lostReceipt.body,
      lostReceipt.headers,
    );
    expect(replay.lifecycle!.state).toBe("replaced");
    for (const pair of pairs) {
      const count = writes.length,
        review = await open(project.id, pair.kind, pair.old.id);
      await expect(review).toContainText("当前生效状态：已替换");
      await expect(
        review.getByRole("button", { name: "明确撤回该原声明", exact: true }),
      ).toHaveCount(0);
      expect(writes).toHaveLength(count);
    }
    expect(await api(`scripts/${script.id}`)).toEqual(beforeScript);
    expect(
      await api(`projects/${project.id}/screenplay-sources/${script.id}`),
    ).toEqual(beforeSource);
    expect(await api("tasks")).toEqual(tasks);
    const graph = await api<typeof twin>(`projects/${project.id}/story-graph`);
    for (const pair of pairs)
      expect(
        [...graph.nodes, ...graph.edges, ...graph.audienceStates].some(
          (record) => record.id === pair.old.lifecycle!.record.id,
        ),
      ).toBe(false);
    const oldTwin = await api(`projects/${project.id}/ip-twins/${twin.id}`);
    expect(oldTwin).toEqual({ ...twin, stale: true });
    expect(dialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
