import { expect, test } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import type { PilotPackagePreview } from "@dramaip/contracts/delivery";
import type {
  NarrativeQualityRequest,
  NarrativeQualityReport,
} from "@dramaip/contracts/creative-quality";
import type {
  NarrativeIndexCatalog,
  NarrativeIndexDetail,
  NarrativeSummary,
  NarrativeSummaryScopes,
  StoryDeclaration,
} from "@dramaip/contracts/knowledge";
import {
  CreationInputSchema,
  CreationWorkflowSchema,
  CreationExecutionReceiptSchema,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import { createStudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "playwright";
import { openProjectTool } from "./project-tools";
import type {
  AuthorIntentCurrent,
  AuthorIntentContent,
} from "@dramaip/contracts/workspace";
import type {
  AdaptationDiagnosis,
  AdaptationStrategy,
  SeasonPlan,
  EpisodeDevelopmentResult,
  EpisodeDevelopmentImpact,
  ProductionRecordMergeComparison,
  EpisodeScriptRevision,
  EpisodeTopologyRevision,
  EpisodeSourceRevision,
  EpisodeScriptContent,
  EpisodeOutlineContent,
  ScreenplayImportPreview,
  ScreenplayIntakePreview,
  ScreenplayDocument,
  StoryboardAttributionSource,
  StoryboardAttribution,
  ScreenplaySource,
  ProductionQualitySource,
} from "@dramaip/contracts/production";
import { EpisodeScriptContentSchema } from "@dramaip/contracts/production";
import {
  MediaRecordSchema,
  type MediaRecord,
  type MediaSourceStatus,
} from "@dramaip/contracts/media";
import type {
  CreativeOutcomeSummary,
  CreativeOutcomePage,
} from "@dramaip/contracts/insights";
import { canonicalCreativeMetricJSON } from "@dramaip/contracts/insights";

const MODEL = "controlled-novel-fixture-v1";
const KEY = "only-a-local-controlled-fixture-not-a-provider-key";

async function assertCurrentOriginalOwnerRead(
  page: Page,
  ownerPath: string,
  originalRoute: string,
  card: () => Locator,
  imageName: string,
) {
  const pattern = `**/api/v2/${ownerPath}`;
  let reads = 0,
    release!: () => void;
  const held = new Promise<void>((resolveRead) => {
    release = resolveRead;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    reads++;
    await held;
    return route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://dramaip.local/problems/controlled-owner-read",
        title: "本次原owner读取不可用",
        detail: "本次原owner读取不可用",
        status: 503,
        code: "CONTROLLED_OWNER_READ",
        traceId: randomUUID(),
      }),
    });
  });
  const navigate = (hash: string) =>
    page.evaluate((value) => {
      window.location.hash = value;
    }, hash);
  try {
    // This is an actual new mount after its original card has primed the cache.
    await navigate("#/pending?category=waiting");
    await expect(
      page.getByRole("heading", { name: "待确认中心", exact: true }),
    ).toBeVisible();
    await navigate(originalRoute);
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(card()).toHaveCount(0); // While the actual read is still held.
    release();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(card()).toHaveCount(0); // A read error cannot revive that cache.
    await page.screenshot({ path: test.info().outputPath(imageName) });
  } finally {
    release();
    await page.unroute(pattern);
  }
  await navigate("#/pending?category=waiting");
  await expect(
    page.getByRole("heading", { name: "待确认中心", exact: true }),
  ).toBeVisible();
  await navigate(originalRoute);
  await expect(card()).toHaveCount(1); // Recovery requires another actual GET.
}

function nativeIntakeFault(databasePath: string, sql: string) {
  // Actual isolated database failure; do not forge business rows or responses.
  const child = spawnSync(
    "bun",
    [
      "scripts/run-node.mjs",
      "--input-type=module",
      "--eval",
      "import { DatabaseSync } from 'node:sqlite'; const database = new DatabaseSync(process.argv[1]); database.exec(process.argv[2]); database.close();",
      databasePath,
      sql,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
}
const TITLE = "铜钥匙与旧书店";
const INTENT: AuthorIntentContent = {
  themeStatement: "学会求助也可以保有自己的节奏",
  emotionalPromise: "在小事中得到接纳与成长",
  targetAudience: "温和成长小说读者",
  mustKeep: ["铜钥匙的保管与归还", "小禾与阿桥的互助"],
  mayChange: ["次要客人的出现顺序"],
  mustAvoid: ["不强制短剧化或机械反转"],
  endingContract: "小禾留在书店继续学习",
  toneAndVoice: "克制生活化的第三人称",
};
const FIRST_FACT = "小禾把铜钥匙交给阿桥，请他保管到明天。";
const SECOND_FACT = "阿桥从口袋里取出昨天保管的铜钥匙，交还给小禾。";
const FIRST_TEXT = [
  "小禾第一次替母亲照看旧书店，便把柜台上的账簿翻反了。窗外刚下过雨，巷子里有卖早点的铃声，她听见铃声就想起还没吃完的半块烧饼。母亲留下的便条只写着别急，她却每见一位客人，都忍不住先解释自己是新来的。",
  FIRST_FACT,
  "阿桥没有笑她，先帮她把门口的纸箱挪到干燥处，再指给她看账簿封面上的小箭头。两人整理了一下午，终于给那摞没人认领的旧书贴好了标签。小禾在便条背面记下今天做成的三件小事，最后一件是学会向人求助。关门时她仍不熟练，但没有再把每一次停顿都当成失败。她把剩下的烧饼分给阿桥，两人坐在门槛上看雨水慢慢退去，约好明天一起开门。",
].join("\n\n");
const SECOND_TEXT = [
  SECOND_FACT,
  "小禾把门锁转了两次才打开，第一件事却是给阿桥倒一杯温水。昨天新贴的标签还歪着，她今天没有急着撕下来重做，而是挑出最难找的那一摞书，给它们画了一张简单的索引。母亲打来电话时，她先说账簿已经放正，然后认真问了两处不明白的地方。",
  "午后，一位常来的老人找到了记忆里那本封皮褪色的诗集。老人坐在窗边读了很久，小禾没有催促，也没有替他猜故事。阿桥临走前说，标签稍微歪一点也能把书送到需要的人手里。她把这句话写在昨天的便条旁边，给自己留下明天可以继续改进的地方。关门时，铜钥匙安稳地躺在她口袋里，她终于觉得这间书店也给自己留了一个位置。",
].join("\n\n");

async function assertLocalResultLedger(
  page: Page,
  projectId: string,
  expected: Record<string, number>,
  imageName: string,
) {
  const requests: Array<{ method: string; url: string }> = [];
  const observe = (request: import("playwright").Request) => {
    if (
      request.url().includes("/creative-outcomes") ||
      request.url().includes("/creative-continuations/summary")
    )
      requests.push({ method: request.method(), url: request.url() });
  };
  page.on("request", observe);
  try {
    await page.evaluate(() => {
      window.location.hash = "#/insights";
    });
    await page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(projectId);
    const ledger = page.getByLabel("本地创作结果台账", { exact: true });
    await expect(ledger).toBeVisible();
    for (const [label, count] of Object.entries(expected))
      await expect(
        ledger.getByText(label, { exact: true }).locator(".."),
      ).toContainText(`累计 ${count} · 最近 7 天 ${count}`);
    await expect(ledger).toContainText("模型来源未知");
    await expect(ledger).toContainText("暂不计算");
    const funnel = ledger.getByLabel("本地首候选与采用耗时", { exact: true });
    await expect(funnel).toBeVisible();
    await expect(funnel).toContainText("包含待决定");
    await expect(funnel).toContainText("当前运行分类均未知");
    const strategyFunnel = funnel.getByLabel("独立改编策略首候选", {
      exact: true,
    });
    await expect(strategyFunnel).toBeVisible();
    if (expected["独立改编策略明确单选版本"]) {
      await expect(strategyFunnel).toContainText(
        "原首候选内明确选项采用 1 / 1",
      );
      await expect(strategyFunnel).toContainText(
        "明确选项 independent-reorder（非整包采用）",
      );
    } else {
      await expect(strategyFunnel).toContainText("未建立分母");
    }
    const continuation = ledger.getByLabel("本地七天续写观察", { exact: true });
    await expect(continuation).toBeVisible();
    await expect(continuation).toContainText(
      "全本地有记录项目（非当前项目分母）",
    );
    await expect(continuation).toContainText("未建立满窗分母");
    const novelWindow = continuation.getByLabel("下一章七天观察", {
      exact: true,
    });
    const scriptWindow = continuation.getByLabel("第二集七天观察", {
      exact: true,
    });
    if (expected["正式章节采用版本"]) {
      await expect(novelWindow).toContainText("七天待观察");
      await expect(novelWindow).toContainText(
        "请求 1 · 真实启动 1 · 后续正式目标 1",
      );
      await expect(novelWindow).toContainText("已提前续接 1");
      await expect(scriptWindow).toContainText("未建立观察窗");
    } else {
      await expect(scriptWindow).toContainText("七天待观察");
      await expect(scriptWindow).toContainText("请求 0 · 真实启动 0");
      await expect(novelWindow).toContainText("未建立观察窗");
    }
    if (expected["正式章节采用版本"]) {
      await expect(
        funnel.getByLabel("小说章节首候选", { exact: true }),
      ).toContainText("原首候选直接采用 2 / 2");
      await expect(
        funnel.getByLabel("小说章节首候选", { exact: true }),
      ).toContainText("请求至采用");
    } else {
      await expect(
        funnel.getByLabel("改编诊断首候选", { exact: true }),
      ).toContainText("原首候选直接采用 1 / 1");
      await expect(
        funnel.getByLabel("整季方案首候选", { exact: true }),
      ).toContainText("原首候选直接采用 0 / 1");
      await expect(
        funnel.getByLabel("整季方案首候选", { exact: true }),
      ).toContainText("改写后采用 1");
      await expect(
        funnel.getByLabel("标准分集剧本首候选", { exact: true }),
      ).toContainText("原首候选直接采用 1 / 1");
    }
    await ledger
      .locator("summary")
      .filter({ hasText: /^查看不含正文的权威回执$/u })
      .click();
    await expect(ledger.getByRole("listitem").first()).toBeVisible();
    await expect(ledger).not.toContainText(FIRST_TEXT);
    await expect(ledger).not.toContainText(KEY);
    await ledger.screenshot({ path: test.info().outputPath(imageName) });
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.every(
        (request) =>
          request.url.includes(`/projects/${projectId}/creative-outcomes`) ||
          request.url.endsWith("/api/v2/creative-continuations/summary"),
      ),
    ).toBe(true);
  } finally {
    page.off("request", observe);
  }
}
const THIRD_FACT = "小禾把铜钥匙挂到柜台后的木钩上。";
const THIRD_TEXT = [
  THIRD_FACT,
  "早上开门时，她先把昨天的索引翻到第一张，照着书名把新送来的旧书放上架。遇到看不清的字迹，她没有急着替原主人猜，而是在纸边留下一格，等母亲回来一起核对。阿桥路过门口时，见她仍有事情没做完，就停下来帮忙搬走挡住过道的空纸箱。她把需要核对的两本书递给他，说明了自己已经确认和还不能确认的地方。",
  "午后，来找诗集的老人带来另一张写着书名的纸。小禾先问清是哪一版，才沿着索引去找。阿桥在旁边扶稳梯子，等她取下书来，两人又核对了一遍封面的年份。她发现昨日画错的箭头，擦掉后重新标明，没有因为一处小错把整张纸丢掉。关门之前，她把需要母亲回答的问题排成三行，把已经核对的两项划去，留下明天继续整理的空格。窗外的巷子渐渐安静，铜钥匙仍在木钩上，她知道下一次开门时不用再从头找起。",
].join("\n\n");

type RunningApp = { application: ElectronApplication; page: Page };
type Chapter = {
  id: string;
  title: string;
  content: string;
  version: number;
};
type RecordEntity = {
  id: string;
  title: string;
  version: number;
  payload: Record<string, unknown>;
};
type Workflow = {
  id: string;
  taskId: string;
  stage: string;
  error?: string;
  previewId?: string;
  memoryState?: string;
  input: { operation: string; targetId?: string; engineKind: string };
  sources: Array<{ kind: string; id: string; version: number }>;
  authorIntent?: { state: "adopted" | "none"; id?: string; version?: number };
  narrativePlanningBasis?: CreationWorkflow["narrativePlanningBasis"];
};

async function launch(userData: string): Promise<RunningApp> {
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  const page = await application.firstWindow();
  // Preserve real public creation failures before this isolated profile is
  // disposed. Never record Runtime credentials, prompts or response headers.
  page.on("response", async (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.startsWith(
        "/api/v2/workflows/creation",
      ) &&
      response.status() >= 400
    ) {
      const problem = await response.json().catch(() => undefined);
      if (problem)
        await test.info().attach("creation-request-problem", {
          body: JSON.stringify({
            status: response.status(),
            code: problem.code,
            title: problem.title,
            detail: problem.detail,
          }),
          contentType: "application/json",
        });
    }
  });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1800, height: 1100 });
  return { application, page };
}

async function runtimeReader(page: Page) {
  const bootstrap = await page.evaluate(() =>
    window.runtimeBootstrap.resolve(),
  );
  // These read-only probes run in the test process, not Renderer business code.
  return async <T>(path: string): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
    return (await response.json()) as T;
  };
}

// Exercise two real local-model candidates, not SQL-seeded formal records. A
// terminal decision about the newer candidate must leave the older one pending.
async function discardNewerEpisodeCandidate(
  get: <T>(path: string) => Promise<T>,
  workbench: () => Locator,
  original: CreationWorkflow,
) {
  const projectId = original.input.projectId;
  const formalBefore = await get(`projects/${projectId}/episode-development`);
  const list = async () =>
    (
      await get<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${projectId}`,
      )
    ).items;
  const beforeIds = new Set((await list()).map((item) => item.id));
  await workbench()
    .getByRole("button", { name: "按要求生成新 AI 草稿", exact: true })
    .click();
  let newer: CreationWorkflow | undefined;
  await expect
    .poll(
      async () => {
        newer = (await list()).find(
          (item) =>
            !beforeIds.has(item.id) &&
            item.input.operation === original.input.operation,
        );
        return newer?.stage;
      },
      { timeout: 25_000 },
    )
    .toBe("awaiting-review");
  expect(newer!.input.episodeDevelopmentRequest).toEqual(
    original.input.episodeDevelopmentRequest,
  );
  expect(newer!.episodeDevelopmentBasis?.request).toEqual(
    original.episodeDevelopmentBasis?.request,
  );
  expect(newer!.id).not.toBe(original.id);
  await expect(workbench().locator("header").getByRole("status")).toHaveText(
    "等待审阅采用",
  );
  await workbench()
    .getByRole("button", { name: "放弃 AI 草稿", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get<CreationWorkflow>(`workflows/creation/${newer!.id}`)).stage,
    )
    .toBe("discarded");
  expect(
    (await get<CreationWorkflow>(`workflows/creation/${original.id}`)).stage,
  ).toBe("awaiting-review");
  expect(await get(`change-previews/${original.previewId}`)).toMatchObject({
    id: original.previewId,
    status: "pending",
  });
  expect(await get(`change-previews/${newer!.previewId}`)).toMatchObject({
    id: newer!.previewId,
    status: "discarded",
  });
  expect(await get(`projects/${projectId}/episode-development`)).toEqual(
    formalBefore,
  );
  return newer!;
}

async function adoptIntentInUi(page: Page, content: AuthorIntentContent) {
  await openProjectTool(page, "作者意图");
  const panel = page.getByLabel("正式作者意图工作台", { exact: true });
  // Editing is now restored with its original basis. A new author decision
  // must explicitly refresh that basis, not rely on a route remount to rebind it.
  await panel
    .getByRole("button", { name: "刷新来源与状态", exact: true })
    .click();
  await expect(
    panel.getByText("已刷新来源版本，编辑内容仍保留；请重新核对后预览。", {
      exact: false,
    }),
  ).toBeVisible();
  const labels: Record<keyof AuthorIntentContent, string> = {
    themeStatement: "作品主题",
    emotionalPromise: "情绪承诺",
    targetAudience: "目标受众",
    mustKeep: "必须保留",
    mayChange: "允许改变",
    mustAvoid: "必须避免",
    endingContract: "结局约束（可暂不决定）",
    toneAndVoice: "叙事声音与风格",
  };
  for (const key of Object.keys(labels) as Array<keyof AuthorIntentContent>) {
    const value = content[key];
    await panel
      .getByLabel(labels[key], { exact: true })
      .fill(Array.isArray(value) ? value.join("\n") : value);
  }
  await panel
    .getByRole("button", { name: "保存意图草稿并预览差异", exact: true })
    .click();
  const preview = panel.locator("[data-intent-preview-id]");
  await expect(preview).toContainText("等待审阅采用");
  const id = await preview.getAttribute("data-intent-preview-id");
  await preview
    .getByRole("button", { name: "确认采用此作者意图", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "采用作者意图", exact: true })
    .getByRole("button", { name: "确认采用", exact: true })
    .click();
  await expect(panel.locator("[data-current-intent-id]")).toHaveAttribute(
    "data-current-intent-id",
    id!,
  );
}

function mixedAdaptationSources(prompt: string) {
  const raw = prompt.match(/冻结(?:范围|基准)：(\{[^\n]+\})/u)?.[1];
  if (!raw) return undefined;
  const scope = JSON.parse(raw) as {
    chapters: { id: string; version: number }[];
    actualExpressions?: {
      summaries: { id: string; chapters: { id: string; version: number }[] }[];
    };
  };
  if (!scope.actualExpressions) return undefined;
  const sources = [
    ...prompt.matchAll(
      /(\/(?:chapters|knowledge|narrative-summaries)\/[^\s]+) \(source=(chapter|knowledge):([a-f0-9-]{36})@(\d+)\)\n([^\n]+)/gu,
    ),
  ].map((match) => ({
    sourceId: match[3]!,
    sourceVersion: Number(match[4]),
    fieldPath: match[1]!,
    value: JSON.parse(match[5]!) as { content?: string; summary?: string },
  }));
  if (!sources.length)
    throw new Error("Mixed adaptation must have actual frozen expressions");
  return {
    chapters: scope.chapters,
    reviewedSources: sources.map(({ sourceId, sourceVersion, fieldPath }) => ({
      sourceId,
      sourceVersion,
      fieldPath,
    })),
    evidence: sources.map((source) => {
      const higher = scope.actualExpressions!.summaries?.find(
        (item) => item.id === source.sourceId,
      );
      const chapter =
        higher?.chapters[0] ??
        scope.chapters.find((item) => item.id === source.sourceId);
      if (!chapter)
        throw new Error("Mixed evidence requires a real covered chapter");
      return {
        chapterId: chapter.id,
        chapterVersion: chapter.version,
        quote: (source.value.summary ?? source.value.content)!.slice(0, 30),
        source: {
          sourceId: source.sourceId,
          sourceVersion: source.sourceVersion,
          fieldPath: source.fieldPath,
          valuePath: source.value.summary ? "/summary" : "/content",
        },
      };
    }),
  };
}

async function localModelFixture(
  higherContinuation = false,
  usageReport = false,
  auxiliaryMemory = false,
  contextRevision = false,
) {
  const calls: Array<{ prompt: string; kind: string; model: string }> = [];
  const errors: string[] = [];
  let chapterCalls = 0;
  let scriptForStoryboard: EpisodeScriptContent | undefined;
  let qualityClean = false;
  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/v1/chat/completions" ||
        request.headers.authorization !== `Bearer ${KEY}`
      )
        throw new Error(
          `Unexpected fixture request: ${request.method} ${request.url}`,
        );
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        stream: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      if (body.model !== MODEL || body.stream !== true)
        throw new Error(
          "Only the configured controlled streaming model is allowed",
        );
      const prompt = body.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n");
      let kind: string;
      let output: unknown;
      if (
        auxiliaryMemory &&
        prompt.includes("你是 DramaIP 的创意会话整理器。")
      ) {
        kind = "inspiration-memory";
        output = { summary: "A07 受控灵感摘要，仅用于工程验证", memories: [] };
      } else if (auxiliaryMemory && prompt.includes("A07受控灵感问答")) {
        kind = "inspiration-chat";
        output = { summary: "受控回应", content: "A07受控灵感回应", items: [] };
      } else if (prompt.includes("审阅候选与冻结")) {
        kind = "check";
        output = {
          issues: contextRevision
            ? [
                {
                  severity: "warning",
                  message: "受控作者意图局部修订要求",
                  evidence: "铜钥匙",
                  location: "作者意图／必须保留",
                  suggestion: "明确作者希望保留的动作",
                  source: "model",
                },
              ]
            : [],
        };
      } else if (prompt.includes("生成供作者审阅的作者意图建议")) {
        kind = "author-intent";
        output = {
          title: "八字段作者意图建议",
          content: "",
          items: [
            {
              ref: "author-intent",
              kind: "author-intent",
              title: "待作者确认的建议",
              data: INTENT,
            },
          ],
        };
      } else if (prompt.includes("kind=narrative-summary")) {
        kind = "narrative-summary";
        const entries = [
          ...prompt.matchAll(
            /(\/(?:chapters|knowledge)\/[a-f0-9-]{36}) \(source=(chapter|knowledge):([a-f0-9-]{36})@(\d+)\)\n([^\n]+)/gu,
          ),
        ].map((match) => ({
          path: match[1]!,
          kind: match[2]!,
          id: match[3]!,
          version: Number(match[4]),
          value: JSON.parse(match[5]!) as {
            id: string;
            version: number;
            content?: string;
            summary?: string;
            sourceChapter?: { id: string; version: number };
          },
        }));
        if (
          entries.length !== 2 ||
          !entries.some((entry) => entry.kind === "knowledge") ||
          !entries.some((entry) => entry.kind === "chapter")
        )
          throw new Error(
            "Hierarchical summary requires the actual full two-chapter mixed source selection",
          );
        const covered = entries.map((entry) =>
          entry.kind === "knowledge"
            ? entry.value.sourceChapter!
            : { id: entry.value.id, version: entry.value.version },
        );
        output = {
          title: "旧书店全书派生摘要",
          content: "小禾学习求助，阿桥保管并归还铜钥匙。",
          items: [
            {
              ref: "book-summary",
              kind: "narrative-summary",
              title: "旧书店全书派生摘要",
              data: {
                summary:
                  "小禾从独自解释自己的失误，逐渐学会向阿桥与母亲求助。铜钥匙经保管与归还串起两天的行动，两人继续整理旧书店；这是当前两章的派生概括，不承诺未写出的未来情节。",
                coveredChapters: covered,
                evidence: entries.map((entry, position) => ({
                  chapter: covered[position],
                  sourceId: entry.id,
                  sourceVersion: entry.version,
                  fieldPath: entry.path,
                  quote:
                    entry.kind === "knowledge"
                      ? entry.value.summary
                      : SECOND_FACT,
                })),
              },
            },
          ],
        };
      } else if (prompt.includes("kind=narrative-quality-report")) {
        kind = "quality-review";
        const raw = prompt.match(/目标：(\{"target":[^\n]+\})\n/u)?.[1];
        if (!raw)
          throw new Error("Quality requires an explicit actual target request");
        const input = JSON.parse(raw) as NarrativeQualityRequest;
        const savedKind =
          input.target.kind === "script" || input.target.kind === "scene";
        const savedRaw = savedKind
          ? prompt.match(
              new RegExp(
                `/production/${input.target.id} \\(source=production:${input.target.id}@${input.target.version}\\)\\n([^\\n]+)`,
                "u",
              ),
            )?.[1]
          : undefined;
        if (savedKind && !savedRaw)
          throw new Error(
            "Saved quality requires the actual full frozen target, not a cached formal script",
          );
        const savedContent = savedRaw
          ? (
              JSON.parse(savedRaw) as {
                content: {
                  blocks?: Array<{ text?: string }>;
                  场景动作?: string;
                };
              }
            ).content
          : undefined;
        const blockIndex =
          savedContent?.blocks?.findIndex((block) => Boolean(block.text)) ??
          scriptForStoryboard?.blocks.findIndex(
            (block) => "text" in block && Boolean(block.text),
          ) ??
          -1;
        const block = scriptForStoryboard?.blocks[blockIndex];
        const quote = savedContent
          ? input.target.kind === "scene"
            ? savedContent.场景动作
            : savedContent.blocks?.[blockIndex]?.text
          : input.target.kind === "chapter"
            ? FIRST_FACT
            : input.target.kind === "chapter-set"
              ? "explicit-cross-chapter"
              : block && "text" in block
                ? block.text
                : "";
        if (
          !quote ||
          (input.target.kind !== "chapter-set" && !prompt.includes(quote))
        )
          throw new Error("Quality quote must be in the actual frozen context");
        const selected = input.chapterScope?.chapters;
        const chapterValues = (input.context ? undefined : selected)?.map(
          (chapter) => {
            const rawChapter = prompt.match(
              new RegExp(
                `/chapters/${chapter.id} \\(source=chapter:${chapter.id}@${chapter.version}\\)\\n(\\{[^\\n]+\\})`,
                "u",
              ),
            )?.[1];
            if (!rawChapter)
              throw new Error(
                "Every selected chapter must be an actual full frozen reference",
              );
            const value = JSON.parse(rawChapter) as { content: string };
            if (!value.content.trim())
              throw new Error("An empty chapter cannot provide evidence");
            return {
              ...chapter,
              quote: value.content.includes(FIRST_FACT)
                ? FIRST_FACT
                : value.content.trim().slice(0, 120),
            };
          },
        );
        const mixedSources = input.context
          ? [
              ...prompt.matchAll(
                /(\/(?:chapters|knowledge|narrative-summaries)\/[^\s]+) \(source=(chapter|knowledge):([a-f0-9-]{36})@(\d+)\)\n([^\n]+)/gu,
              ),
            ].map((match) => ({
              sourceId: match[3]!,
              sourceVersion: Number(match[4]),
              fieldPath: match[1]!,
              value: JSON.parse(match[5]!) as {
                summary?: string;
                content?: string;
              },
            }))
          : undefined;
        if (mixedSources && !mixedSources.length)
          throw new Error(
            "Quality expressions must be real frozen sources, not a model coverage claim",
          );
        const evidence = mixedSources
          ? mixedSources.map((source) => ({
              sourceId: source.sourceId,
              sourceVersion: source.sourceVersion,
              fieldPath: source.fieldPath,
              valuePath: source.value.summary ? "/summary" : "/content",
              quote: (source.value.summary ?? source.value.content)!.slice(
                0,
                30,
              ),
            }))
          : chapterValues
            ? [chapterValues[0]!, chapterValues.at(-1)!].map((chapter) => ({
                sourceId: chapter.id,
                sourceVersion: chapter.version,
                fieldPath: `/chapters/${chapter.id}`,
                valuePath: "/content",
                quote: chapter.quote,
              }))
            : [
                {
                  sourceId: input.target.id,
                  sourceVersion: input.target.version,
                  fieldPath: `/${input.target.kind === "chapter" ? "chapters" : "production"}/${input.target.id}`,
                  valuePath:
                    input.target.kind === "chapter"
                      ? "/content"
                      : input.target.kind === "scene"
                        ? "/content/场景动作"
                        : `/content/blocks/${blockIndex}/text`,
                  quote,
                },
              ];
        output = {
          title: "实际版本质量报告",
          content: "模型评议，不改正文。",
          items: [
            {
              ref: "report",
              kind: "narrative-quality-report",
              title: "版本与证据",
              data: {
                summary: "模型评议，不代表文学质量保证；只核对所选目标与范围。",
                reviewedDimensions: input.dimensions,
                ...(savedKind
                  ? {
                      reviewedSources: [
                        {
                          sourceId: input.target.id,
                          sourceVersion: input.target.version,
                          fieldPath: `/production/${input.target.id}`,
                        },
                      ],
                    }
                  : {}),
                ...(selected ? { reviewedChapters: selected } : {}),
                ...(mixedSources
                  ? {
                      reviewedSources: mixedSources.map(
                        ({ sourceId, sourceVersion, fieldPath }) => ({
                          sourceId,
                          sourceVersion,
                          fieldPath,
                        }),
                      ),
                    }
                  : {}),
                issues: qualityClean
                  ? []
                  : [
                      {
                        id: "key-return",
                        category: "timeline",
                        severity: "error",
                        source: "model",
                        message:
                          "模型认为钥匙归还时序需要作者核对；可能是误报。",
                        suggestion: "由作者核对真实行动，不自动改写正文。",
                        evidence,
                      },
                    ],
              },
            },
          ],
        };
      } else if (
        /协议 selected-(?:storyboard-(?:shots|block-structure)|scene-(?:shot|topology)-plan)-v1/u.test(
          prompt,
        )
      ) {
        kind = "storyboard-package";
        const structural = prompt.includes(
          "协议 selected-storyboard-block-structure-v1",
        );
        const shotPlan = prompt.includes("协议 selected-scene-shot-plan-v1");
        const topology = prompt.includes(
          "协议 selected-scene-topology-plan-v1",
        );
        const scope = [
          ...prompt.matchAll(
            /\/production\/[^\s]+ \(source=production:([a-f0-9-]{36})@(\d+)\)\n([^\n]+)/gu,
          ),
        ]
          .map(
            (match) =>
              JSON.parse(match[3]!) as {
                receipt?: {
                  scope: string;
                  topologyPlan?: {
                    scenes: {
                      sceneId: string;
                      mode: string;
                      shots: {
                        id: string;
                        orderIndex: number;
                        durationSeconds: number;
                        assetIds: string[];
                        retains?: { recordId: string; version: number };
                      }[];
                    }[];
                  };
                  sceneMappings?: {
                    sceneId: string;
                    currentBlockIds: string[];
                  }[];
                  scenePlans?: {
                    sceneId: string;
                    shots: {
                      id: string;
                      orderIndex: number;
                      durationSeconds: number;
                      assetIds: string[];
                      retains?: { recordId: string; version: number };
                    }[];
                  }[];
                };
                shots?: Record<string, unknown>[];
              },
          )
          .find(
            (entry) =>
              entry.receipt?.scope ===
              (topology
                ? "author-frozen-scene-topology-plan-v1"
                : shotPlan
                  ? "author-frozen-scene-shot-plan-v1"
                  : structural
                    ? "confirmed-block-structure-fixed-shots-duration-assets-v1"
                    : "stable-mapping-fixed-duration-existing-assets-v1"),
          );
        if (!scope?.shots?.length)
          throw new Error("Selected redo requires an actual frozen selection");
        output = {
          title: "明确选中镜头重做",
          content: "保留未选镜头，只重做明确冻结镜头。",
          items: [
            {
              ref: "selected",
              kind: "storyboard-package",
              title: "局部候选",
              data: {
                format: topology
                  ? "selected-scene-topology-plan-v1"
                  : shotPlan
                    ? "selected-scene-shot-plan-v1"
                    : structural
                      ? "selected-storyboard-block-structure-v1"
                      : "selected-storyboard-shots-v1",
                shots: topology
                  ? scope
                      .receipt!.topologyPlan!.scenes.filter(
                        (scene) => scene.mode === "generate",
                      )
                      .flatMap((scene) =>
                        scene.shots.map(({ retains: _retains, ...planned }) => {
                          const template =
                            scope.shots!.find(
                              (shot) => shot.sceneId === scene.sceneId,
                            ) ?? scope.shots![0]!;
                          const { sceneId: _scene, ...shot } = template;
                          const mapping = scriptForStoryboard?.sceneLinks.find(
                            (link) => link.sceneId === scene.sceneId,
                          );
                          if (!mapping || !planned.durationSeconds)
                            throw new Error(
                              "Actual confirmed topology required",
                            );
                          return {
                            ...shot,
                            ...planned,
                            sourceBlockIds: mapping.blockIds,
                            visualAction: "双正式拓扑：明确新旧身份",
                            prompt: "TOPOLOGY PLAN PROMPT: 作者冻结结构",
                          };
                        }),
                      )
                  : shotPlan
                    ? scope.receipt!.scenePlans!.flatMap((scene) =>
                        scene.shots.map(({ retains: _retains, ...planned }) => {
                          const template = scope.shots!.find(
                            (shot) => shot.sceneId === scene.sceneId,
                          )!;
                          const { sceneId: _scene, ...shot } = template;
                          return {
                            ...shot,
                            ...planned,
                            sourceBlockIds:
                              scope.receipt?.sceneMappings?.find(
                                (mapping) => mapping.sceneId === scene.sceneId,
                              )?.currentBlockIds ?? shot.sourceBlockIds,
                            visualAction: "作者镜头计划：明确新旧身份",
                            prompt: "SHOT PLAN PROMPT: 作者冻结结构",
                          };
                        }),
                      )
                    : scope.shots.map(({ sceneId, ...shot }) => ({
                        ...shot,
                        ...(structural
                          ? {
                              sourceBlockIds:
                                scope.receipt?.sceneMappings?.find(
                                  (mapping) => mapping.sceneId === sceneId,
                                )?.currentBlockIds ?? shot.sourceBlockIds,
                            }
                          : {}),
                        visualAction: structural
                          ? "已确认新块结构接续：林晚核对证据"
                          : "人工确认后局部重做：林晚认真核实警告",
                        prompt: structural
                          ? "STRUCTURE REDO PROMPT: 新块映射证据核对"
                          : "SELECTED REDO PROMPT: 克制地核实警告",
                      })),
                subtitles: [],
                costRisks: [],
              },
            },
          ],
        };
      } else if (prompt.includes("kind=storyboard-package")) {
        kind = "storyboard-package";
        const source = [
          ...prompt.matchAll(
            /\/knowledge\/[^\s]+ \(source=knowledge:([a-f0-9-]{36})@(\d+)\)\n([^\n]+)/gu,
          ),
        ].find(
          (match) =>
            (JSON.parse(match[3]!) as { kind?: string }).kind === "story-bible",
        );
        if (
          !source ||
          !scriptForStoryboard ||
          scriptForStoryboard.blocks.some((block) => !prompt.includes(block.id))
        )
          throw new Error(
            "Storyboard requires the actual frozen script and approved Bible",
          );
        output = {
          title: "主动求证分镜包",
          content: "逐场覆盖正式稳定块，先验证静帧，不要求生成视频。",
          items: [
            {
              ref: "storyboard",
              kind: "storyboard-package",
              title: "首集分镜方案",
              data: {
                title: "主动求证分镜包",
                visualDirection: "克制现实夜景",
                productionNotes: ["先验证角色与环境静帧，不自动提交媒体"],
                assets: [
                  {
                    id: "lin",
                    kind: "character",
                    title: "林晚",
                    description: "维持已批准设定，不添加超能力",
                    sourceBibleIds: [source[1]],
                  },
                ],
                scenes: scriptForStoryboard.sceneLinks.map((link, index) => ({
                  sceneId: link.sceneId,
                  scriptBlockIds: link.blockIds,
                  shots: [
                    {
                      id: `pilot-shot-${index}`,
                      orderIndex: 0,
                      sourceBlockIds: link.blockIds,
                      visualAction:
                        index === 0 ? "林晚记录警告" : "林晚出门求证",
                      composition: "中近景",
                      camera: "平视",
                      movement: "缓慢推进",
                      durationSeconds: 45,
                      sound: "室内环境音",
                      prompt:
                        index === 0
                          ? "林晚在房间核对号码"
                          : "林晚在夜间走廊行动",
                      negativePrompt: "无水印、无额外角色",
                      assetIds: ["lin"],
                    },
                  ],
                })),
                subtitles: [],
                costRisks: [
                  {
                    severity: "medium",
                    reason: "低光一致性需要测试",
                    shotIds: ["pilot-shot-0", "pilot-shot-1"],
                    mitigation: "先审阅静帧",
                  },
                ],
                externalDependencies: ["角色静帧和声音尚待采用"],
              },
            },
          ],
        };
      } else if (prompt.includes("kind=episode-outline")) {
        kind = "episode-outline";
        const source = prompt.match(/source=chapter:([a-f0-9-]{36})@(\d+)/u);
        const mapped = prompt.match(/本集映射 (\[[^\n]*?\])。/u)?.[1];
        const mappedChapters = mapped
          ? (JSON.parse(mapped) as { id: string; version: number }[])
          : undefined;
        const directSources = prompt.match(
          /真实故事来源身份：(\[[^\n]*?\])。/u,
        )?.[1];
        const directReferences = directSources
          ? (JSON.parse(directSources) as {
              sourceKind: string;
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
            }[])
          : undefined;
        const quoteIdentities = prompt.match(
          /逐场可引用身份：(\[[^\n]*?\])。/u,
        )?.[1];
        const quotedSources = quoteIdentities
          ? (JSON.parse(quoteIdentities) as NonNullable<
              EpisodeOutlineContent["scenes"][number]["sourceEvidence"]
            >[number]["source"][])
          : undefined;
        const quoteEntries = [
          ...prompt.matchAll(
            /([^\s]+) \(source=(chapter|knowledge|project|production):([a-f0-9-]{36})@(\d+)\)\n([^\n]+)/gu,
          ),
        ].map((match) => ({
          path: match[1],
          kind: match[2],
          id: match[3],
          version: Number(match[4]),
          value: JSON.parse(match[5]!) as Record<string, unknown>,
        }));
        if (!source && !mappedChapters?.length && !directReferences?.length)
          throw new Error(
            "Outline requires actual chapter or explicit direct author source",
          );
        for (const ref of directReferences ?? [])
          if (
            !prompt.includes(
              `source=${ref.sourceKind}:${ref.sourceId}@${ref.sourceVersion}`,
            )
          )
            throw new Error(
              "Direct outline requires the actual frozen author source, not identity-only metadata",
            );
        output = {
          title: "主动求证单集大纲",
          content: "电话警告促使林晚先记录再核对，保留姐妹信任。",
          items: [
            {
              ref: "outline",
              kind: "episode-outline",
              title: "求证场景目标",
              data: {
                title: "主动求证",
                logline: "林晚核对失联电话",
                goal: "寻找姐姐",
                mainConflict: "是否相信来电",
                turningPoint: "线索矛盾",
                endingHook: "求证行动展开",
                scenes: [0, 1].map((orderIndex) => ({
                  id: `pilot-scene-${orderIndex}`,
                  orderIndex,
                  location: orderIndex === 0 ? "林晚房间" : "走廊",
                  timeOfDay: "夜",
                  goal: "核对通话",
                  conflict: "来电可信度",
                  outcome: orderIndex === 0 ? "记录号码" : "选择求证",
                  characters: ["林晚"],
                  durationSeconds: 45,
                  sourceChapters: directReferences
                    ? []
                    : (mappedChapters ?? [
                        { id: source![1], version: Number(source![2]) },
                      ]),
                  ...(directReferences
                    ? { sourceReferences: directReferences }
                    : {}),
                  ...(quotedSources
                    ? {
                        sourceEvidence: quotedSources.flatMap(
                          (ref, sourceIndex) => {
                            const entry = quoteEntries.find(
                              (item) =>
                                item.path === ref.fieldPath &&
                                item.kind === ref.sourceKind &&
                                item.id === ref.sourceId &&
                                item.version === ref.sourceVersion,
                            );
                            if (!entry)
                              throw new Error(
                                "Scene quote needs actual frozen expression",
                              );
                            const sceneChapters =
                              mappedChapters ??
                              (source
                                ? [
                                    {
                                      id: source[1]!,
                                      version: Number(source[2]),
                                    },
                                  ]
                                : []);
                            if (
                              ref.sourceKind === "chapter" &&
                              !sceneChapters.some(
                                (chapter) => chapter.id === ref.sourceId,
                              )
                            )
                              return [];
                            let valuePath =
                              ref.sourceKind === "knowledge"
                                ? "/summary"
                                : "/content";
                            let prose = entry.value[valuePath.slice(1)];
                            if (ref.sourceKind === "knowledge") {
                              const chapter = entry.value.sourceChapter as
                                { id: string } | undefined;
                              const coverage = entry.value.coveredChapters as
                                { id: string }[] | undefined;
                              if (
                                !sceneChapters.some(
                                  (item) =>
                                    chapter?.id === item.id ||
                                    coverage?.some((c) => c.id === item.id),
                                )
                              )
                                return [];
                            }
                            if (ref.sourceKind === "project") {
                              valuePath = "/content/synopsis";
                              prose = (
                                entry.value.content as { synopsis: string }
                              ).synopsis;
                            }
                            if (
                              ref.sourceKind === "production" &&
                              Array.isArray(entry.value.blocks)
                            ) {
                              const index = entry.value.blocks.findIndex(
                                (block: { type: string; text?: string }) =>
                                  ["action", "dialogue"].includes(block.type) &&
                                  block.text?.trim(),
                              );
                              if (index !== -1) {
                                valuePath = `/blocks/${index}/text`;
                                prose = (
                                  entry.value.blocks[index] as { text: string }
                                ).text;
                              }
                            }
                            if (typeof prose !== "string" || !prose.trim())
                              throw new Error(
                                "Scene quote needs provided prose, not metadata",
                              );
                            return [
                              {
                                id: `actual-quote-${orderIndex}-${sourceIndex}`,
                                source: ref,
                                valuePath,
                                quote: prose.slice(0, 20),
                                rationale:
                                  "PRIVATE MODEL DECLARED SCENE ATTRIBUTION",
                              },
                            ];
                          },
                        ),
                      }
                    : {}),
                  beats: [
                    {
                      id: `pilot-beat-${orderIndex}`,
                      action:
                        orderIndex === 0
                          ? "记录姐姐警告"
                          : "核对相互矛盾的线索",
                      causalLink:
                        orderIndex === 0
                          ? "失联导致怀疑"
                          : "警告与记录矛盾促使求证",
                    },
                  ],
                })),
              },
            },
          ],
        };
      } else if (prompt.includes("kind=episode-script")) {
        kind = "episode-script";
        const blocks = [
          {
            id: randomUUID(),
            type: "scene_heading",
            text: "INT. 林晚房间 - NIGHT",
          },
          {
            id: randomUUID(),
            type: "action",
            text: "林晚记下姐姐的警告，核对屏幕上的号码。",
          },
          {
            id: randomUUID(),
            type: "scene_heading",
            text: "INT. 走廊 - NIGHT",
          },
          {
            id: randomUUID(),
            type: "action",
            text: "林晚发现线索矛盾，决定出门求证。",
          },
        ];
        output = {
          title: "主动求证首集剧本",
          content: blocks.map((item) => item.text).join("\n\n"),
          items: [
            {
              ref: "script",
              kind: "episode-script",
              title: "稳定块标准剧本",
              data: {
                blocks,
                sceneLinks: [0, 1].map((index) => ({
                  sceneId: `pilot-scene-${index}`,
                  blockIds: blocks
                    .slice(index * 2, index * 2 + 2)
                    .map((item) => item.id),
                })),
              },
            },
          ],
        };
        scriptForStoryboard = EpisodeScriptContentSchema.parse({
          blocks,
          sceneLinks: [0, 1].map((index) => ({
            sceneId: `pilot-scene-${index}`,
            blockIds: blocks
              .slice(index * 2, index * 2 + 2)
              .map((item) => item.id),
          })),
        });
      } else if (prompt.includes("故事圣经与视觉设定方案")) {
        kind = "knowledge-plan";
        output = {
          title: "林晚故事圣经",
          content: "求证动机与姐妹关系为约束，不声称真相已揭开。",
          items: [
            {
              ref: "bible",
              kind: "story-bible",
              title: "林晚与姐姐",
              data: {
                内容: "已批准约束：保留姐妹信任，林晚尚不知道失联真相，不凭空添加超能力。",
                依据: "作者明确采用的设定",
              },
            },
          ],
        };
      } else if (prompt.includes("kind=adaptation-strategy")) {
        kind = "adaptation-strategy";
        const mixed = mixedAdaptationSources(prompt);
        output = {
          title: "独立改编策略比较",
          content: "两种不同叙事动作，只供比较，不默认选择。",
          items: [
            {
              ref: "independent-strategy",
              kind: "adaptation-strategy",
              title: "独立策略",
              data: {
                ...(mixed ? { reviewedSources: mixed.reviewedSources } : {}),
                summary: "继承实际已读表达，比较忠实人物弧与悬念重排。",
                options: ["faithful", "reorder"].map((id) => ({
                  id: `independent-${id}`,
                  title: id === "faithful" ? "独立忠实人物弧" : "独立悬念重排",
                  rationale:
                    id === "faithful"
                      ? "按原行动顺序呈现"
                      : "电话开场后补人物动机",
                  preserve: ["姐姐警告与林晚求证"],
                  merge: [],
                  remove: [],
                  reorder: id === "reorder" ? ["前置失联电话"] : [],
                  restructure: [],
                  rhythm: "保留主动求证",
                  findingIds: ["phone"],
                  risks: ["局部表达不是全书语义判断"],
                  productionRisk: "unknown",
                  productionNotes: "未试制，实际费用未知",
                })),
              },
            },
          ],
        };
      } else if (prompt.includes("kind=season-plan")) {
        kind = "season-plan";
        const mixed = mixedAdaptationSources(prompt);
        const source = prompt.match(/source=chapter:([a-f0-9-]{36})@(\d+)/u);
        if (!source && !mixed)
          throw new Error(
            "Season plan did not include an actual chapter reference",
          );
        output = {
          title: mixed ? "旧书店两集方案" : "失联电话两集方案",
          content: "仅使用已采用局部诊断与唯一策略，不冒充全文覆盖。",
          items: [
            {
              ref: "season-plan",
              kind: "season-plan",
              title: mixed ? "旧书店分集方案" : "失联电话完整方案",
              data: {
                ...(mixed ? { reviewedSources: mixed.reviewedSources } : {}),
                theme: "信任与求证",
                mainConflict: mixed ? "独自承担还是主动求助" : "来电是否可信",
                emotionalPromise: "主动选择",
                omittedSources: [],
                risks: ["未读章节不能视为已读；制作仍需验证"],
                episodes: [0, 1].map((orderIndex) => ({
                  id: `stable-episode-${orderIndex}`,
                  orderIndex,
                  title: mixed
                    ? orderIndex === 0
                      ? "借出的钥匙"
                      : "归还的钥匙"
                    : orderIndex === 0
                      ? "失联警告"
                      : "主动求证",
                  logline: mixed
                    ? orderIndex === 0
                      ? "小禾学习托付与保管"
                      : "阿桥归还钥匙，两人整理旧书店"
                    : orderIndex === 0
                      ? "姐姐来电留下警告后失联"
                      : "林晚主动核对通话线索",
                  goal: mixed ? "学会求助" : "寻找姐姐",
                  mainConflict: mixed ? "怕犯错而独自承担" : "是否相信来电",
                  turningPoint: mixed
                    ? orderIndex === 0
                      ? "明确托付钥匙"
                      : "钥匙归还"
                    : orderIndex === 0
                      ? "电话中断"
                      : "线索矛盾",
                  endingHook: mixed
                    ? orderIndex === 0
                      ? "约定明日归还"
                      : "继续整理旧书店"
                    : orderIndex === 0
                      ? "姐姐去向不明"
                      : "求证行动展开",
                  sourceChapters: [
                    {
                      id: mixed
                        ? mixed.chapters[orderIndex % mixed.chapters.length]!.id
                        : source![1],
                      version: mixed
                        ? mixed.chapters[orderIndex % mixed.chapters.length]!
                            .version
                        : Number(source![2]),
                      adaptationAction: "preserve",
                      rationale: mixed
                        ? "保留求助、托付与归还动机"
                        : "保留姐姐警告与求证动机",
                    },
                  ],
                  characterProgress: [
                    {
                      character: mixed ? "小禾" : "林晚",
                      before: "迟疑",
                      after: "求证",
                      relationshipChange: mixed
                        ? "保留小禾与阿桥互助"
                        : "保护姐妹信任",
                    },
                  ],
                  plantedForeshadowing: [],
                  paidOffForeshadowing: [],
                  estimatedScenes: 2,
                  estimatedCharacters: 2,
                  durationSeconds: 90,
                  productionRisk: "unknown",
                  productionNotes: "尚需实际试制，不是报价",
                })),
              },
            },
          ],
        };
      } else if (prompt.includes("独立改编诊断，不生成季纲")) {
        kind = "adaptation-diagnosis";
        const mixed = mixedAdaptationSources(prompt);
        const source = prompt.match(/source=chapter:([a-f0-9-]{36})@(\d+)/u);
        if (!source && !mixed)
          throw new Error(
            "Diagnosis did not include an actual chapter reference",
          );
        const quote = "电话接通时，姐姐只留下“不要相信来电的人”便失去声音。";
        output = {
          title: mixed ? "旧书店改编诊断" : "雨夜来信改编诊断",
          content:
            "仅诊断实际选中的表达；比较忠实人物弧与重排，不声称已经生成整季或检查全部原文。",
          items: [
            {
              ref: "diagnosis",
              kind: "adaptation-diagnosis",
              title: mixed ? "旧书店策略" : "雨夜来信策略",
              data: {
                ...(mixed ? { reviewedSources: mixed.reviewedSources } : {}),
                summary: mixed
                  ? "小禾从独自承担走向求助；摘要和片段不代表全文诊断。"
                  : "姐姐失联提供追查动机；未覆盖章节不能视为已读。",
                theme: "信任与求证",
                emotionalPromise: mixed ? "温和成长与接纳" : "悬疑中的主动选择",
                sellingPoints: [mixed ? "铜钥匙的托付与归还" : "失联电话"],
                mainLine: mixed ? "小禾与阿桥整理旧书店" : "林晚决定求证来电",
                characterArcs: [
                  mixed ? "从独自承担到主动求助" : "从迟疑到主动追查",
                ],
                relationships: [mixed ? "小禾与阿桥互助" : "姐妹信任"],
                findings: [
                  {
                    id: "phone",
                    kind: "suspense",
                    claim: mixed
                      ? "托付与归还可承载人物信任"
                      : "电话中断形成可视化悬念",
                    evidence: mixed?.evidence ?? [
                      {
                        chapterId: source![1],
                        chapterVersion: Number(source![2]),
                        quote,
                      },
                    ],
                    suggestion: "保留人物动机，不提前虚构真相",
                  },
                ],
                strategies: ["faithful", "reorder"].map((id) => ({
                  id,
                  title: id === "faithful" ? "忠实人物弧" : "悬念重排",
                  rationale:
                    id === "faithful"
                      ? "保护原叙事顺序"
                      : "以失联电话开场后补动机",
                  preserve: ["姐姐警告与林晚追查"],
                  merge: [],
                  remove: [],
                  reorder: id === "reorder" ? ["电话开场"] : [],
                  restructure: [],
                  rhythm: "按人物求证推进",
                  findingIds: ["phone"],
                  risks: ["局部范围，不能保证全书因果"],
                  productionRisk: "unknown",
                  productionNotes: "电话场景可试制，角色一致性与成本仍需核验",
                })),
              },
            },
          ],
        };
      } else if (prompt.includes("仅提取正文明确发生的事实")) {
        kind = "memory";
        const second = prompt.includes(SECOND_FACT);
        const fact = prompt.includes(THIRD_FACT)
          ? THIRD_FACT
          : second
            ? SECOND_FACT
            : FIRST_FACT;
        output = {
          title: second ? "第二章铜钥匙事实" : "第一章铜钥匙事实",
          content: fact,
          items: [
            {
              ref: "memory",
              kind: "chapter-memories",
              title: second ? "第二章铜钥匙事实" : "第一章铜钥匙事实",
              data: { evidence: fact, 章节摘要: fact },
            },
          ],
        };
      } else if (prompt.includes("生成一集完整的剧本、场景和分镜方案")) {
        kind = "legacy-episode";
        const title = `旧候选 ${calls.filter((item) => item.kind === "legacy-episode").length + 1}`;
        const content = `INT. BOOKSHOP - DAY\n\n${title}：小禾打开木门。`;
        output = {
          title,
          content,
          items: [
            {
              ref: "script",
              kind: "scripts",
              title,
              data: { 剧本内容: content },
            },
            {
              ref: "scene",
              parentRef: "script",
              kind: "scenes",
              title: "书店",
              data: { 场景动作: "开门" },
            },
            {
              ref: "shot",
              parentRef: "scene",
              kind: "shots",
              title: "推门",
              data: { 镜头描述: "手推木门", 生成提示: "自然光木门", 时长: "5" },
            },
          ],
        };
      } else if (prompt.includes("items 的 kind 为 characters")) {
        kind = "characters";
        output = {
          title: "旧书店人物方案",
          content: "温和成长小说，不要求机械反转或短剧化。",
          items: [
            {
              ref: "xiaohe",
              kind: "characters",
              title: "小禾",
              data: {
                角色定位: "旧书店学徒",
                欲望与目标: "学会照看书店并向人求助",
              },
            },
          ],
        };
      } else if (prompt.includes("items 的 kind 为 story-arcs")) {
        kind = "story-arc";
        output = {
          title: "旧书店卷与单元规划",
          content: "阶段性规划，不是已发生事实。",
          items: [
            {
              ref: "arc",
              kind: "story-arcs",
              title: "独立卷与单元候选",
              data: { 层级: "卷", 核心冲突: "学会求助" },
            },
          ],
        };
      } else if (prompt.includes("items 的 kind 为 outlines")) {
        const chapterOutline = prompt.includes("「大纲层级」=「章节」");
        kind = chapterOutline ? "chapter-outline" : "book-outline";
        output = {
          title: "旧书店两章规划",
          content: "第一章学会求助，第二章找到自己的位置。",
          items: [
            {
              ref: "book",
              kind: "outlines",
              title: "旧书店两章规划",
              data: {
                大纲层级: chapterOutline ? "章节" : "全书",
                内容: "第一章小禾把铜钥匙交给阿桥保管；第二章阿桥还钥匙，小禾继续学会照看书店。",
              },
            },
          ],
        };
      } else if (prompt.includes("content 只放完整小说正文")) {
        if (higherContinuation && prompt.includes("hierarchical-summary")) {
          kind = "chapter-higher-context";
          output = { title: "第三章 继续整理", content: THIRD_TEXT, items: [] };
        } else {
          chapterCalls++;
          if (chapterCalls > 2)
            throw new Error("Unexpected extra chapter generation");
          kind = `chapter-${chapterCalls}`;
          output = {
            title:
              chapterCalls === 1 ? "第一章 借出的钥匙" : "第二章 归还的钥匙",
            content: chapterCalls === 1 ? FIRST_TEXT : SECOND_TEXT,
            items: [],
          };
        }
      } else throw new Error("Unrecognized creation prompt");
      calls.push({ prompt, kind, model: body.model });
      const id = `controlled-${randomUUID()}`;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finishReason: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created: 1,
            model: MODEL,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      chunk({ role: "assistant", content: JSON.stringify(output) });
      chunk({}, "stop");
      // Explicit reports only exercise persistence/format; never measured billing.
      if (usageReport)
        response.write(
          `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: MODEL, choices: [], usage: { prompt_tokens: 0, completion_tokens: 12, total_tokens: 12 } })}\n\n`,
        );
      // Other fixtures intentionally omit usage; missing is not measured zero.
      response.end("data: [DONE]\n\n");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: errors.at(-1) } }));
    }
  });
  await new Promise<void>((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture did not bind to loopback");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    calls,
    errors,
    setQualityClean(value: boolean) {
      qualityClean = value;
    },
    setConfirmedTopologyScript(value: EpisodeScriptContent) {
      // Only this controlled provider's response fixture changes. The test
      // obtains this exact immutable content from the public adopted result.
      scriptForStoryboard = EpisodeScriptContentSchema.parse(value);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
    },
  };
}

async function configureLocalModel(running: RunningApp, url: string) {
  const { application, page } = running;
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page
    .getByRole("combobox", { name: "服务商", exact: true })
    .selectOption("other");
  await page
    .getByRole("textbox", { name: "服务商名称", exact: true })
    .fill("本地受控小说验收接口");
  await page
    .getByRole("textbox", { name: "模型名称", exact: true })
    .fill(MODEL);
  await page.getByRole("textbox", { name: "服务地址", exact: true }).fill(url);
  const capturePromise = application.waitForEvent("window");
  await page
    .getByRole("button", { name: "添加模型服务商", exact: true })
    .click();
  const capture = await capturePromise;
  await capture.waitForLoadState("domcontentloaded");
  if (!process.env.DRAMAIP_E2E_EXECUTABLE) {
    const windows = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
        ...(process.platform === "linux"
          ? {}
          : { focusable: window.isFocusable() }),
      })),
    );
    expect(windows).toHaveLength(2);
    const hidden = {
      visible: false,
      focused: false,
      ...(process.platform === "linux" ? {} : { focusable: false }),
    };
    expect(windows).toEqual([hidden, hidden]);
  }
  await capture
    .getByRole("textbox", { name: "安全凭据", exact: true })
    .fill(KEY);
  await Promise.all([
    capture.waitForEvent("close"),
    capture.getByRole("button", { name: "安全保存", exact: true }).click(),
  ]);
  const provider = page.getByLabel("模型服务商 本地受控小说验收接口", {
    exact: true,
  });
  await provider
    .getByRole("button", { name: "设为智能助手模型", exact: true })
    .click();
  await expect(page.getByText(/本地受控小说验收接口：.*已/)).toBeVisible();
  await page
    .getByRole("combobox", { name: "全局默认引擎", exact: true })
    .selectOption("langgraph");
  await page
    .getByRole("button", { name: "保存全局默认值", exact: true })
    .click();
  await expect(
    page.getByText("全局默认智能引擎已保存", { exact: true }),
  ).toBeVisible();
}

test("生成账本在后台保留旧金额未知单位，内嵌手工零和原观察可只读，项目切换及失败不泄露缓存（受控旧记录非账单）", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-generation-cost-ui-"));
  let running: RunningApp | undefined;
  const manager = new ServerConnectionManager();
  const recordId = randomUUID();
  let modelWrites = 0;
  const observe = (page: Page) =>
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /(?:image-generation\/runs|video-generation\/runs|agent-sessions\/[^/]+\/runs)/u.test(
          new URL(request.url()).pathname,
        )
      )
        modelWrites++;
    });
  try {
    running = await launch(userData);
    await manager.attach({
      ...(await running.page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    let client = createStudioClient(manager.createTransport());
    const { project } = await client.projects.create({
      title: "费用声明原项目",
    });
    const { project: other } = await client.projects.create({
      title: "没有账本的另一个项目",
    });
    manager.disconnect();
    await running.application.close();
    running = undefined;
    // Explicitly simulate a persisted legacy amount in this test's isolated
    // profile only. It is not a provider output, certified bill or formal IP.
    nativeIntakeFault(
      join(userData, "dramaip.db"),
      `INSERT INTO insights_generation_records VALUES ('${recordId}', '${project.id}', NULL, 'controlled-legacy', '受控旧费用记录', 'completed', '本地旧记录模拟，不是真实账单', 0.001, 'CNY', NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');`,
    );
    running = await launch(userData);
    observe(running.page);
    await manager.attach({
      ...(await running.page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    const openLedger = async () => {
      await running!.page.evaluate(() => {
        window.location.hash = "#/settings";
      });
      await expect(
        running!.page.getByRole("heading", { name: "生成账本", exact: true }),
      ).toBeVisible();
      await running!.page
        .locator("#settings-advanced")
        .getByRole("combobox")
        .selectOption(project.id);
    };
    const ledger = () => running!.page.locator("#settings-advanced");
    const entry = () =>
      ledger().locator("article").filter({ hasText: "受控旧费用记录" });
    await openLedger();
    await expect(entry()).toContainText(
      "旧记录未认证 · 0.001 · 单位未知 · 结算状态未知",
    );
    await entry()
      .getByRole("button", { name: "补录费用声明", exact: true })
      .click();
    await expect(entry().getByLabel("声明金额", { exact: true })).toHaveValue(
      "",
    );
    await expect(entry().getByLabel("声明单位", { exact: true })).toHaveValue(
      "",
    );
    await entry().getByLabel("声明金额", { exact: true }).fill("0");
    await entry()
      .getByLabel("声明备注", { exact: true })
      .fill("显式手工零，不是认证账单");
    await entry()
      .getByRole("button", { name: "保存未认证声明", exact: true })
      .click();
    await expect(entry()).toContainText(
      "手工声明（未认证） · 0 · 单位未知 · 结算状态未知",
    );
    const wrapper = () => entry().locator("..");
    await wrapper()
      .getByRole("button", { name: "只读费用观察", exact: true })
      .click();
    await expect(wrapper()).toContainText(
      "观察 2 · 手工声明（未认证） · 0 · 单位未知",
    );
    await expect(wrapper()).toContainText(
      "观察 1 · 旧记录未认证 · 0.001 · 单位未知",
    );
    const original = await client.generationCosts.list(recordId, project.id);
    expect(original.observationCount).toBe(2);
    expect(modelWrites).toBe(0);
    await ledger().getByRole("combobox").selectOption(other.id);
    await expect(entry()).toHaveCount(0);
    await expect(ledger()).not.toContainText("显式手工零");
    await ledger().getByRole("combobox").selectOption(project.id);
    await expect(entry()).toContainText("手工声明（未认证） · 0 · 单位未知");
    await wrapper()
      .getByRole("button", { name: "只读费用观察", exact: true })
      .click();
    await expect(wrapper()).toContainText(
      "观察 1 · 旧记录未认证 · 0.001 · 单位未知",
    );
    manager.disconnect();
    await running.application.close();
    running = await launch(userData);
    observe(running.page);
    await manager.attach({
      ...(await running.page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    expect(await client.generationCosts.list(recordId, project.id)).toEqual(
      original,
    );
    await openLedger();
    await wrapper()
      .getByRole("button", { name: "只读费用观察", exact: true })
      .click();
    await expect(wrapper()).toContainText(
      "观察 1 · 旧记录未认证 · 0.001 · 单位未知",
    );
    await running.page.screenshot({
      path: info.outputPath("generation-cost-observations.png"),
    });
    let failedReads = 0;
    await running.page.route(
      `**/api/v2/generation-ledger/${recordId}/cost-observations?**`,
      (route) => {
        failedReads++;
        return route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "https://dramaip.local/problems/controlled-cost-read",
            title: "受控只读失败",
            detail: "受控只读失败",
            status: 503,
            code: "CONTROLLED_COST_READ",
            traceId: randomUUID(),
          }),
        });
      },
    );
    await wrapper()
      .getByRole("button", { name: "收起费用观察", exact: true })
      .click();
    await wrapper()
      .getByRole("button", { name: "只读费用观察", exact: true })
      .click();
    await expect(wrapper().getByRole("alert")).toContainText(
      "未继续展示缓存费用",
    );
    expect(failedReads).toBe(1);
    await expect(wrapper()).not.toContainText("观察 1 ·");
    await expect(wrapper()).not.toContainText("观察 2 ·");
    expect(modelWrites).toBe(0);
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => window.isVisible() || window.isFocused(),
        ),
      ),
    ).toBe(false);
  } finally {
    manager.disconnect();
    await running?.application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("灵感整理保留自己的原运行报告，字符预算不冒充 token，后台重启后明确只读不再调用模型（受控报告非账单）", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-memory-usage-journey-"),
  );
  const fixture = await localModelFixture(false, true, true);
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/inspiration";
    });
    const consentDialog = running.page.getByRole("dialog");
    await expect(consentDialog).toContainText(
      "是否允许灵感空间自动学习你的创作偏好？",
    );
    await consentDialog
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(
      running.page.getByRole("heading", { name: "灵感空间", exact: true }),
    ).toBeVisible();
    await running.page
      .getByRole("switch", { name: "联网搜索 · 自动", exact: true })
      .click();
    await expect(
      running.page.getByRole("switch", {
        name: "联网搜索 · 关闭",
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "false");
    await running.page
      .getByPlaceholder("说出一个画面、人物、疑问，或任何还没成形的念头…")
      .fill("A07受控灵感问答：请只谈旧书店故事，不联网。");
    await running.page
      .getByRole("button", { name: "发送", exact: true })
      .click();
    await expect(
      running.page.getByText("A07受控灵感回应", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      running.page.getByRole("button", { name: "停止", exact: true }),
    ).toHaveCount(0);
    const conversationId = await running.page.evaluate(() =>
      window.localStorage.getItem("dramaip-inspiration-conversation"),
    );
    expect(conversationId).toBeTruthy();
    await running.page
      .getByRole("button", { name: "重新整理", exact: true })
      .click();
    let read = await runtimeReader(running.page);
    type Job = {
      id: string;
      status: string;
      inputTokens?: number;
      outputTokens?: number;
      usageRuns: Array<{ runId: string; projectId?: string }>;
    };
    const jobsPath = `inspiration-memory-jobs?conversationId=${conversationId}`;
    await expect
      .poll(async () => (await read<Job[]>(jobsPath))[0]?.status, {
        timeout: 30_000,
      })
      .toBe("completed");
    const job = (await read<Job[]>(jobsPath))[0]!;
    expect(job).not.toHaveProperty("inputTokens");
    expect(job).not.toHaveProperty("outputTokens");
    expect(job.usageRuns).toHaveLength(1);
    expect(job.usageRuns[0]).not.toHaveProperty("projectId");
    const usagePath = `agent-runs/${job.usageRuns[0]!.runId}/usage-observations`;
    const original =
      await read<import("@dramaip/contracts").AgentUsageObservationPage>(
        usagePath,
      );
    expect(original).toMatchObject({
      observationCount: 1,
      items: [
        {
          inputTokens: { status: "reported", value: 0 },
          outputTokens: { status: "reported", value: 12 },
          cachedTokens: { status: "unreported" },
          measurementScope: "response-increment",
        },
      ],
    });
    const reportButton = running.page.getByRole("button", {
      name: "查看原运行用量报告",
      exact: true,
    });
    await expect(reportButton).toBeVisible();
    await reportButton.click();
    const report = running.page.getByLabel("运行用量只读记录", { exact: true });
    await expect(report).toContainText(job.usageRuns[0]!.runId);
    await expect(report).toContainText("输入 0 · 输出 12 · 缓存读取 未报告");
    await report.scrollIntoViewIfNeeded();
    await expect(
      running.page.getByText(
        "上下文预算与字符估算不是实际 token；历史缺报告不补零。",
        { exact: true },
      ),
    ).toBeVisible();
    await running.page.screenshot({
      path: info.outputPath("memory-reported-usage.png"),
      fullPage: true,
    });
    const modelCalls = fixture.calls.length;
    expect(
      fixture.calls.filter((call) => call.kind === "inspiration-memory"),
    ).toHaveLength(1);
    await running.application.close();
    running = await launch(userData);
    await running.page.evaluate(() => {
      window.location.hash = "#/inspiration";
    });
    read = await runtimeReader(running.page);
    await expect
      .poll(async () => (await read<Job[]>(jobsPath))[0]?.id)
      .toBe(job.id);
    expect(await read(usagePath)).toEqual(original);
    await expect(
      running.page.getByRole("button", {
        name: "查看原运行用量报告",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      running.page.getByLabel("引擎用量观测", { exact: true }),
    ).toHaveCount(0);
    await running.page
      .getByRole("button", { name: "查看原运行用量报告", exact: true })
      .click();
    await expect(
      running.page.getByLabel("运行用量只读记录", { exact: true }),
    ).toContainText(job.usageRuns[0]!.runId);
    expect(fixture.calls).toHaveLength(modelCalls);
    expect(fixture.errors).toEqual([]);
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => window.isVisible() || window.isFocused(),
        ),
      ),
    ).toBe(false);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

for (const contextRevision of [false, true])
  test(`引擎用量报告只读原运行，报告零与未报告区分、断网留历史且后台重启恢复不再调用模型（受控报告非账单）${contextRevision ? "／生成检查修订复检各自原上下文" : ""}`, async ({}, info) => {
    test.setTimeout(120_000);
    const userData = await mkdtemp(join(tmpdir(), "dramaip-usage-journey-"));
    const fixture = await localModelFixture(
      false,
      true,
      false,
      contextRevision,
    );
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      const bootstrap = await running.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      const created = await fetch(`${bootstrap.baseUrl}/api/v2/projects`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          title: "用量报告独立验收",
          mode: "single_season",
          modeConfig: { mode: "single_season", entryPath: "inspiration" },
          synopsis: "作者想写旧书店成长故事。",
        }),
      });
      expect(created.status).toBe(201);
      const { project } = (await created.json()) as { project: { id: string } };
      const route = `#/projects/${project.id}/tools/author-intent`;
      await running.page.evaluate((route) => {
        window.location.hash = route;
      }, route);
      const panel = () =>
        running!.page.getByLabel("AI 作者意图候选", { exact: true });
      await panel()
        .getByRole("button", { name: "确认 AI 意图来源", exact: true })
        .click();
      await panel()
        .getByRole("button", { name: "生成并检查作者意图建议", exact: true })
        .click();
      const link = panel().getByRole("link", {
        name: "比较并确认此 AI 意图草稿",
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 30_000 });
      const href = await link.getAttribute("href");
      const workflowId = new URLSearchParams(href!.split("?")[1]).get(
        "intentWorkflowId",
      )!;
      let read = await runtimeReader(running.page);
      const workflow = await read<CreationWorkflow>(
        `workflows/creation/${workflowId}`,
      );
      expect(workflow.runId).toBeTruthy();
      if (contextRevision) {
        const issue = workflow.issues.find(
          (value) => value.source === "model",
        )!;
        expect(issue.evidence).toBe("铜钥匙");
        expect(issue.candidateEvidence?.candidateSha256).toBe(
          createHash("sha256")
            .update(JSON.stringify(workflow.output))
            .digest("hex"),
        );
        expect(issue.candidateEvidence!.matches.length).toBeGreaterThan(0);
        const evidence = () =>
          panel().getByLabel("本轮候选引文定位", { exact: true });
        await expect(evidence()).toHaveCount(1);
        await evidence().locator("summary").click();
        await expect(evidence()).toContainText("不证明模型判断正确");
        await expect(evidence()).toContainText(
          issue.candidateEvidence!.candidateSha256,
        );
        for (const match of issue.candidateEvidence!.matches) {
          await expect(evidence()).toContainText(match.valuePath);
          await expect(evidence()).toContainText(
            `[${match.start}, ${match.end})`,
          );
        }
        await evidence().screenshot({
          path: info.outputPath(
            "creation-check-original-candidate-evidence.png",
          ),
        });
      } else
        expect(workflow.issues.some((value) => value.candidateEvidence)).toBe(
          false,
        );
      const usagePath = `agent-runs/${workflow.runId}/usage-observations?projectId=${project.id}`;
      const original =
        await read<import("@dramaip/contracts").AgentUsageObservationPage>(
          usagePath,
        );
      expect(original).toMatchObject({
        observationCount: 1,
        coverage: "partial-or-unknown",
        billingStatus: "unknown",
        items: [
          {
            measurementScope: "response-increment",
            inputTokens: { status: "reported", value: 0 },
            outputTokens: { status: "reported", value: 12 },
            cachedTokens: { status: "unreported" },
            runClassification: "unknown",
          },
        ],
      });
      const usage = () =>
        panel().getByLabel("运行用量只读记录", { exact: true }).first();
      await usage()
        .getByRole("button", { name: "查看原运行用量报告", exact: true })
        .click();
      await expect(usage()).toContainText(`原运行 ${workflow.runId}`);
      await expect(usage()).toContainText("输入 0 · 输出 12 · 缓存读取 未报告");
      await expect(usage()).toContainText("费用与结算未知");
      const executionPath = `workflows/creation/${workflowId}/execution?projectId=${project.id}`;
      const receipt = CreationExecutionReceiptSchema.parse(
        await read(executionPath),
      );
      expect(receipt.runs.map((run) => run.runId)).toEqual(workflow.runIds);
      expect(
        receipt.runs.map((run) => run.state === "recorded" && run.phase),
      ).toEqual(
        contextRevision
          ? ["generating", "checking", "revising", "rechecking"]
          : ["generating", "checking"],
      );
      const originalContexts = new Map<
        string,
        import("@dramaip/contracts/agent-context").AgentContextSnapshot
      >();
      for (const run of receipt.runs) {
        if (run.state !== "recorded") throw new Error("实际原阶段缺失");
        const snapshot = await read<
          import("@dramaip/contracts/agent-context").AgentContextSnapshot
        >(`agent-runs/${run.runId}/context-snapshot`);
        expect(snapshot.id).toBe(run.execution.contextSnapshotId);
        expect(snapshot.projectId).toBe(project.id);
        originalContexts.set(run.runId, snapshot);
      }
      expect(
        new Set([...originalContexts.values()].map((value) => value.id)).size,
      ).toBe(contextRevision ? 4 : 2);
      expect(
        new Set(
          [...originalContexts.values()].map(
            (value) => value.finalPromptSha256,
          ),
        ).size,
      ).toBeGreaterThanOrEqual(2);
      await panel()
        .getByRole("button", { name: "查看全部创作阶段执行记录", exact: true })
        .click();
      const stages = () =>
        panel().getByLabel("创作阶段执行回执", { exact: true });
      await expect(stages()).toContainText(MODEL);
      for (const run of receipt.runs) {
        expect(run.state).toBe("recorded");
        if (run.state !== "recorded") throw new Error("实际阶段记录缺失");
        expect(run.execution.timing.status).toBe("measured");
        await expect(stages()).toContainText(run.runId);
      }
      await expect(stages()).toContainText("不是跨重试总量");
      const readOriginalPhaseContext = async (runId: string) => {
        const context = stages().getByLabel(`阶段原上下文 ${runId}`, {
          exact: true,
        });
        await context
          .getByRole("button", { name: "查看此阶段原上下文", exact: true })
          .click();
        const actual = context.getByLabel("原阶段上下文快照", { exact: true });
        const original = originalContexts.get(runId)!;
        await expect(actual).toContainText(original.id);
        await expect(actual).toContainText(original.finalPromptSha256);
        await expect(actual).toContainText("不是全书章节覆盖率");
        await expect(actual).toContainText("不证明模型已经读取或理解");
        await actual
          .getByText("查看此阶段完整原提示（可能包含本地私有正文或 AI 草稿）", {
            exact: true,
          })
          .click();
        await expect(actual.locator("pre").last()).toHaveText(
          original.finalPrompt,
        );
        expect(await actual.locator("pre").last().textContent()).toBe(
          original.finalPrompt,
        );
        return context;
      };
      for (const run of receipt.runs) await readOriginalPhaseContext(run.runId);
      const firstPhase = receipt.runs[0]!;
      const contextFailurePattern = `**/api/v2/agent-runs/${firstPhase.runId}/context-snapshot`;
      await running.page.route(contextFailurePattern, (route) =>
        route.abort("internetdisconnected"),
      );
      const firstContext = stages().getByLabel(
        `阶段原上下文 ${firstPhase.runId}`,
        { exact: true },
      );
      await firstContext
        .getByRole("button", { name: "查看此阶段原上下文", exact: true })
        .click();
      await expect(firstContext.getByRole("alert")).toContainText(
        "不显示旧缓存，不补造已读或覆盖率",
      );
      await expect(
        firstContext.getByLabel("原阶段上下文快照", { exact: true }),
      ).toHaveCount(0);
      await running.page.unroute(contextFailurePattern);
      await readOriginalPhaseContext(firstPhase.runId);
      await firstContext.screenshot({
        path: info.outputPath("original-phase-context-restored.png"),
      });
      await stages().screenshot({
        path: info.outputPath("creation-execution-original-phases.png"),
      });
      await running.page.route(
        "**/api/v2/workflows/creation/*/execution?*",
        (route) => route.abort("internetdisconnected"),
      );
      await panel()
        .getByRole("button", { name: "查看全部创作阶段执行记录", exact: true })
        .click();
      await expect(
        panel().getByLabel("全部创作阶段执行记录", { exact: true }),
      ).toContainText("原阶段读取失败，不使用旧缓存或换运行");
      await expect(stages()).toHaveCount(0);
      await running.page.unroute("**/api/v2/workflows/creation/*/execution?*");
      const calls = fixture.calls.length;
      await running.page.route(
        "**/api/v2/agent-runs/*/usage-observations?*",
        (route) => route.abort("internetdisconnected"),
      );
      await usage()
        .getByRole("button", { name: "重新读取原运行用量报告", exact: true })
        .click();
      await expect(usage()).toContainText("上次记录仅作历史查看");
      await expect(usage()).toContainText(`原运行 ${workflow.runId}`);
      await running.page.unroute("**/api/v2/agent-runs/*/usage-observations?*");
      await usage()
        .getByRole("button", { name: "重新读取原运行用量报告", exact: true })
        .click();
      await expect(usage().getByRole("alert")).toHaveCount(0);
      await running.page.screenshot({
        path: info.outputPath("reported-usage-readonly.png"),
      });
      await running.application.close();
      running = await launch(userData);
      await running.page.evaluate((route) => {
        window.location.hash = route;
      }, href!);
      await expect(
        panel().getByRole("link", {
          name: "比较并确认此 AI 意图草稿",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30_000 });
      read = await runtimeReader(running.page);
      expect(await read(`workflows/creation/${workflowId}`)).toEqual(workflow);
      expect(await read(usagePath)).toEqual(original);
      expect(
        CreationExecutionReceiptSchema.parse(await read(executionPath)),
      ).toEqual(receipt);
      await expect(stages()).toHaveCount(0);
      await panel()
        .getByRole("button", { name: "查看全部创作阶段执行记录", exact: true })
        .click();
      await expect(stages()).toContainText(MODEL);
      for (const run of receipt.runs) {
        await expect(stages()).toContainText(run.runId);
        expect(await read(`agent-runs/${run.runId}/context-snapshot`)).toEqual(
          originalContexts.get(run.runId),
        );
        await expect(
          stages()
            .getByLabel(`阶段原上下文 ${run.runId}`, { exact: true })
            .getByLabel("原阶段上下文快照", { exact: true }),
        ).toHaveCount(0);
        await readOriginalPhaseContext(run.runId);
      }
      await expect(
        usage().getByRole("button", {
          name: "查看原运行用量报告",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        usage().getByLabel("引擎用量观测", { exact: true }),
      ).toHaveCount(0);
      await usage()
        .getByRole("button", { name: "查看原运行用量报告", exact: true })
        .click();
      await expect(usage()).toContainText(`原运行 ${workflow.runId}`);
      expect(fixture.calls.length).toBe(calls);
      expect(fixture.errors).toEqual([]);
      const windows = await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          visible: window.isVisible(),
          focused: window.isFocused(),
        })),
      );
      expect(windows).toEqual([{ visible: false, focused: false }]);
    } finally {
      await running?.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

test("AI 作者意图支持简报独立入口、明确后章与已有剧本，后台重启和精确待确认恢复后才明确采用，不改原稿（受控接口）", async () => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-ai-intent-journey-"));
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  const records: Array<{
    projectId: string;
    workflowId: string;
    intentId: string;
    path: string;
    original: unknown;
  }> = [];
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    const request = async <T>(path: string, body?: unknown): Promise<T> => {
      const bootstrap = await running!.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          ...(body === undefined ? {} : { "Idempotency-Key": randomUUID() }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(
        true,
      );
      return (await response.json()) as T;
    };
    for (const entry of ["brief", "chapter", "script"] as const) {
      const { project } = await request<{
        project: { id: string; version: number };
      }>("projects", {
        title: `AI 意图 ${entry} 独立入口`,
        mode: entry === "chapter" ? "series_longform" : "single_season",
        modeConfig:
          entry === "chapter"
            ? { mode: "series_longform" }
            : {
                mode: "single_season",
                entryPath: entry === "script" ? "script" : "inspiration",
              },
        synopsis: "温和的旧书店成长故事，不强制小说改编或制作媒体。",
      });
      let sourceTitle: string | undefined;
      let path = `projects/${project.id}`;
      if (entry === "chapter") {
        await request("chapters", {
          projectId: project.id,
          title: "未选开头，不代表读过全书",
          content: "PRIVATE 未选正文不能进入 AI 意图。",
        });
        sourceTitle = "明确第二章原稿";
        const chapter = await request<{ id: string }>("chapters", {
          projectId: project.id,
          title: sourceTitle,
          content: SECOND_TEXT,
        });
        path = `chapters/${chapter.id}`;
      } else if (entry === "script") {
        sourceTitle = "明确作者剧本原稿";
        const script = await request<{ id: string }>("scripts", {
          projectId: project.id,
          title: sourceTitle,
          payload: {
            剧本内容:
              "INT. 旧书店 - DAY\n\n小禾归还铜钥匙，阿桥接过账簿。\n\n小禾\n我可以慢慢学。",
          },
        });
        path = `scripts/${script.id}`;
      }
      const original = await request(path);
      await running.page.evaluate((route) => {
        window.location.hash = route;
      }, `#/projects/${project.id}/tools/author-intent`);
      const panel = running.page.getByLabel("AI 作者意图候选", { exact: true });
      await expect(
        panel.getByRole("button", { name: "确认 AI 意图来源", exact: true }),
      ).toBeEnabled();
      if (sourceTitle)
        await panel
          .getByLabel(`意图来源：${sourceTitle}`, { exact: true })
          .check();
      await panel
        .getByRole("button", { name: "确认 AI 意图来源", exact: true })
        .click();
      await expect(panel).toContainText(
        `所选完整来源 ${sourceTitle ? 1 : 0} 份`,
      );
      if (entry === "brief")
        await running.page.screenshot({
          path: test
            .info()
            .outputPath("ai-author-intent-confirmed-sources.png"),
        });
      await panel
        .getByRole("button", { name: "生成并检查作者意图建议", exact: true })
        .click();
      const link = panel.getByRole("link", {
        name: "比较并确认此 AI 意图草稿",
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 30_000 });
      const href = await link.getAttribute("href");
      const search = new URLSearchParams(href!.split("?")[1]);
      const intentId = search.get("intentId")!;
      const workflowId = search.get("intentWorkflowId")!;
      expect(intentId).toBeTruthy();
      expect(workflowId).toBeTruthy();
      await link.click();
      const candidate = running.page.locator(
        `[data-intent-preview-id="${intentId}"]`,
      );
      await expect(candidate).toContainText("AI 建议，须作者明确确认");
      await expect(candidate).toContainText(INTENT.themeStatement);
      await assertCurrentOriginalOwnerRead(
        running.page,
        `author-intents/${intentId}`,
        `#/projects/${project.id}/tools/author-intent?intentId=${intentId}&intentWorkflowId=${workflowId}`,
        () => candidate,
        `author-intent-current-owner-${entry}.png`,
      );
      expect(
        (
          await request<AuthorIntentCurrent>(
            `projects/${project.id}/author-intent`,
          )
        ).current,
      ).toBeUndefined();
      expect(await request(path)).toEqual(original);
      const workflow = await request<CreationWorkflow>(
        `workflows/creation/${workflowId}`,
      );
      expect(workflow).toMatchObject({
        stage: "awaiting-review",
        authorIntentId: intentId,
        input: {
          operation: "author-intent",
          authorIntentRequest: {
            sources: sourceTitle ? [expect.any(Object)] : [],
          },
        },
      });
      records.push({
        projectId: project.id,
        intentId,
        workflowId,
        path,
        original,
      });
    }
    expect(fixture.errors).toEqual([]);
    expect(
      fixture.calls.filter((call) => call.kind === "author-intent"),
    ).toHaveLength(3);
    expect(
      fixture.calls.every((call) => !call.prompt.includes("PRIVATE 未选正文")),
    ).toBe(true);
    await running.application.close();
    running = await launch(userData);
    await running.page.evaluate(() => {
      window.location.hash = "#/pending";
    });
    await expect(
      running.page.getByRole("heading", { name: "待确认中心", exact: true }),
    ).toBeVisible();
    // Use exact stored candidate links; don't select the newest workflow.
    for (const record of records) {
      const link = running.page
        .locator(
          `a[href="#/projects/${record.projectId}/tools/author-intent?intentId=${record.intentId}&intentWorkflowId=${record.workflowId}"]`,
        )
        .first();
      await expect(link).toBeVisible({ timeout: 30_000 });
    }
    for (const record of records) {
      await running.page.evaluate((route) => {
        window.location.hash = route;
      }, `#/projects/${record.projectId}/tools/author-intent?intentId=${record.intentId}&intentWorkflowId=${record.workflowId}`);
      const candidate = running.page.locator(
        `[data-intent-preview-id="${record.intentId}"]`,
      );
      await expect(candidate).toContainText(INTENT.themeStatement);
      await candidate
        .getByRole("button", { name: "确认采用此作者意图", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用作者意图", exact: true })
        .getByRole("button", { name: "确认采用", exact: true })
        .click();
      await expect(
        running.page.locator("[data-current-intent-id]"),
      ).toHaveAttribute("data-current-intent-id", record.intentId);
      expect(await request(record.path)).toEqual(record.original);
      await expect
        .poll(
          async () =>
            (
              await request<CreationWorkflow>(
                `workflows/creation/${record.workflowId}`,
              )
            ).stage,
        )
        .toBe("applied");
    }
    await running.page
      .locator(`[data-intent-preview-id="${records.at(-1)!.intentId}"]`)
      .scrollIntoViewIfNeeded();
    await running.page.screenshot({
      path: test.info().outputPath("ai-author-intent-adopted.png"),
    });
    expect(
      fixture.calls.filter((call) => call.kind === "author-intent"),
    ).toHaveLength(3);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("五类规划独立确认实际段落、不隐式读正文，目录失败阻止新生成，后台重启精确恢复后明确采用且来源变化拒绝旧候选（受控接口）", async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-planning-journey-"));
  const fixture = await localModelFixture();
  const manager = new ServerConnectionManager();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await manager.attach({
      ...(await running.page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    let client = createStudioClient(manager.createTransport());
    const { project } = await client.projects.create({
      title: "五类规划明确来源",
      mode: "series_longform",
    });
    const chapter = await client.chapters.create({
      projectId: project.id,
      title: "作者选择的第一章",
      content:
        "PRIVATE 实际所选规划段落。\n\nPRIVATE 同章未选后段不得自动纳入。",
    });
    const omitted = await client.chapters.create({
      projectId: project.id,
      title: "作者未选第二章",
      content: "PRIVATE 未选第二章不得补入规划。",
    });
    const originalProject = await client.projects.get(project.id),
      originalChapters = await client.chapters.list(project.id);
    const records: Array<{
      label: string;
      domain: string;
      workflow: CreationWorkflow;
    }> = [];
    const navigate = (route: string) =>
      running!.page.evaluate((value) => {
        window.location.hash = value;
      }, `#${route}`);
    const open = async (operation: string) => {
      if (operation === "knowledge-plan")
        await navigate(`/create?projectId=${project.id}`);
      else {
        await navigate(`/projects/${project.id}`);
        await running!.page
          .getByRole("button", {
            name: operation === "characters" ? "人物" : "大纲",
            exact: true,
          })
          .click();
        if (operation !== "characters")
          await running!.page
            .getByRole("button", {
              name:
                operation === "story-arc"
                  ? "卷与单元"
                  : operation === "chapter-outline"
                    ? "章节大纲"
                    : "全书大纲",
              exact: true,
            })
            .click();
      }
    };
    const confirmParagraph = async () => {
      const planning = running!.page.getByLabel("本轮规划来源确认", {
        exact: true,
      });
      await planning
        .getByRole("radio", { name: "明确局部章节范围", exact: true })
        .check();
      await planning
        .getByLabel(`规划范围 ${chapter.title}`, { exact: true })
        .check();
      await expect(
        planning.getByRole("button", {
          name: "确认本轮规划范围与表达",
          exact: true,
        }),
      ).toBeDisabled();
      await planning
        .locator("summary")
        .filter({ hasText: "规划来源表达" })
        .click();
      const source = planning.getByLabel(`前文来源 ${chapter.title}`, {
        exact: true,
      });
      await source
        .getByRole("button", { name: "读取此章摘要和段落", exact: true })
        .click();
      await expect(
        source
          .getByRole("combobox", {
            name: `前文表达 ${chapter.title}`,
            exact: true,
          })
          .locator('option[value="paragraphs"]'),
      ).toBeEnabled();
      await source
        .getByRole("combobox", {
          name: `前文表达 ${chapter.title}`,
          exact: true,
        })
        .selectOption("paragraphs");
      await source
        .getByLabel(`上下文段落 ${chapter.title} 0`, { exact: true })
        .check();
      await planning
        .getByRole("button", { name: "确认本轮规划范围与表达", exact: true })
        .click();
      await expect(
        planning.locator('[data-planning-confirmed="true"]'),
      ).toBeVisible();
    };
    for (const [operation, label, domain] of [
      ["characters", "人物方案", "characters"],
      ["book-outline", "全书大纲", "outlines"],
      ["chapter-outline", "章节大纲", "outlines"],
      ["story-arc", "卷与单元方案", "story-arcs"],
      ["knowledge-plan", "故事与视觉设定", "story-bible"],
    ]) {
      await open(operation!);
      const planning = running.page.getByLabel("本轮规划来源确认", {
          exact: true,
        }),
        workbench = running.page.getByLabel(`AI ${label}`, { exact: true });
      const generate = workbench.getByRole("button", {
        name: `生成并检查${label}`,
        exact: true,
      });
      await expect(generate).toBeDisabled();
      if (operation === "characters") {
        const pattern = `**/api/v2/projects/${project.id}/chapters`;
        let failed = 0;
        await running.page.route(pattern, (route) => {
          failed++;
          return route.abort();
        });
        await planning
          .getByRole("button", { name: "重新读取规划来源目录", exact: true })
          .click();
        await expect(planning.getByRole("alert")).toContainText(
          "规划正文目录尚未核全",
        );
        expect(failed).toBeGreaterThan(0);
        await expect(generate).toBeDisabled();
        expect(fixture.calls).toEqual([]);
        expect((await client.creation.list(project.id)).items).toEqual([]);
        await running.page.unroute(pattern);
        await planning
          .getByRole("button", { name: "重新读取规划来源目录", exact: true })
          .click();
        await expect(planning.getByRole("alert")).toHaveCount(0);
        // The recommended full scope with original text is preselected, but it
        // is not used until explicitly confirmed.
        await expect(
          planning.getByRole("radio", {
            name: "当前全部非空正文目录（不代表全文表达或全书质量通过）",
            exact: true,
          }),
        ).toBeChecked();
        await expect(
          planning.getByRole("button", {
            name: "确认本轮规划范围与表达",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          planning.locator('[data-planning-confirmed="false"]'),
        ).toBeVisible();
        await expect(generate).toBeDisabled();
      }
      await confirmParagraph();
      await generate.click();
      await expect(workbench.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        { timeout: 30_000 },
      );
      const workflow = (await client.creation.list(project.id)).items.find(
        (item) => item.input.operation === operation,
      )!;
      expect(workflow.narrativePlanningBasis).toMatchObject({
        operation,
        request: {
          chapterScope: {
            mode: "selection",
            chapters: [{ id: chapter.id, version: chapter.version }],
          },
        },
        coverage: {
          included: [{ id: chapter.id, representations: ["paragraphs"] }],
          excluded: [{ id: omitted.id, reason: "not-selected" }],
        },
      });
      expect(workflow.input.targetId).toBeUndefined();
      expect(
        (
          await (
            await runtimeReader(running.page)
          )<RecordEntity[]>(`${domain}?projectId=${project.id}`)
        ).filter((item) => item.payload.sourceWorkflowId === workflow.id),
      ).toEqual([]);
      await workbench
        .locator("summary")
        .filter({ hasText: "引用资料" })
        .click();
      await expect(
        workbench.getByLabel("规划运行实际来源表达", { exact: true }),
      ).toContainText("所选原文段落");
      if (operation === "characters")
        await running.page.screenshot({
          path: test
            .info()
            .outputPath("planning-explicit-paragraph-candidate.png"),
        });
      records.push({ label: label!, domain: domain!, workflow });
    }
    expect(await client.chapters.list(project.id)).toEqual(originalChapters);
    expect(await client.projects.get(project.id)).toEqual(originalProject);
    expect(fixture.calls).toHaveLength(10);
    for (const call of fixture.calls) {
      expect(call.prompt).toContain("PRIVATE 实际所选规划段落。");
      expect(call.prompt).not.toContain("PRIVATE 同章未选后段");
      expect(call.prompt).not.toContain(omitted.content);
    }
    await expect
      .poll(async () => {
        const value = await client.creativeOutcomes.summary(project.id);
        return value.planningFunnel?.measures.reduce(
          (sum, item) => sum + item.pendingDecision,
          0,
        );
      })
      .toBe(5);
    const pendingSummary = await client.creativeOutcomes.summary(project.id);
    expect(pendingSummary.planningBatches).toMatchObject({
      recordedBatches: 0,
      items: [],
    });
    await running.application.close();
    manager.disconnect();
    running = await launch(userData);
    await manager.attach({
      ...(await running.page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    const get = await runtimeReader(running.page);
    expect(
      (await client.creativeOutcomes.summary(project.id)).planningFunnel,
    ).toEqual(pendingSummary.planningFunnel);
    for (const record of records) {
      await navigate("/pending");
      const link = running.page.locator(
        `a[href*="workflowId=${record.workflow.id}"]`,
      );
      await expect(link).toHaveCount(1);
      const href = await link.getAttribute("href");
      const params = new URLSearchParams(href!.split("?")[1]);
      expect(params.get("projectId")).toBe(project.id);
      expect(params.get("taskId")).toBe(record.workflow.taskId);
      await link.click();
      const workbench = running.page.getByLabel(`AI ${record.label}`, {
        exact: true,
      });
      await expect(workbench.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
      );
      await workbench
        .locator("summary")
        .filter({ hasText: "引用资料" })
        .click();
      await expect(
        workbench.getByLabel("规划运行实际来源表达", { exact: true }),
      ).toContainText("所选原文段落");
      const restored = await client.creation.get(record.workflow.id);
      expect(restored.narrativePlanningBasis).toEqual(
        record.workflow.narrativePlanningBasis,
      );
      expect(restored.sourceSnapshotId).toBe(record.workflow.sourceSnapshotId);
      expect(fixture.calls).toHaveLength(10);
      const traffic: Array<{
        method: string;
        path: string;
        status?: number;
        failed?: boolean;
      }> = [];
      const requestObserved = (request: import("playwright").Request) => {
        if (new URL(request.url()).pathname.startsWith("/api/v2/"))
          traffic.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
          });
      };
      const responseObserved = (response: import("playwright").Response) => {
        if (new URL(response.url()).pathname.startsWith("/api/v2/"))
          traffic.push({
            method: response.request().method(),
            path: new URL(response.url()).pathname,
            status: response.status(),
          });
      };
      running.page.on("request", requestObserved);
      running.page.on("response", responseObserved);
      const committedResponse = running.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v2/change-previews/${restored.previewId}/commit`,
      );
      await workbench
        .getByRole("button", { name: "采用", exact: true })
        .click();
      const committed = await committedResponse
        .catch(async (cause: unknown) => {
          await test.info().attach("planning-commit-safe-traffic", {
            body: JSON.stringify({
              expectedPreviewId: restored.previewId,
              workflowId: restored.id,
              stage: (await client.creation.get(restored.id)).stage,
              traffic,
            }),
            contentType: "application/json",
          });
          throw cause;
        })
        .finally(() => {
          running!.page.off("request", requestObserved);
          running!.page.off("response", responseObserved);
        });
      expect(committed.status(), await committed.text()).toBe(200);
      await expect(workbench.locator("header").getByRole("status")).toHaveText(
        "已采用",
        { timeout: 30_000 },
      );
      const adopted = (
        await get<RecordEntity[]>(`${record.domain}?projectId=${project.id}`)
      ).filter((item) => item.payload.sourceWorkflowId === record.workflow.id);
      expect(adopted).toHaveLength(1);
      expect(adopted[0]!.payload.narrativePlanningBasis).toEqual(
        record.workflow.narrativePlanningBasis,
      );
    }
    await open("characters");
    await confirmParagraph();
    const workbench = running.page.getByLabel("AI 人物方案", { exact: true });
    await workbench
      .getByRole("button", { name: "生成并检查人物方案", exact: true })
      .click();
    await expect(workbench.locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 30_000 },
    );
    const old = (await client.creation.list(project.id)).items.find(
      (item) =>
        item.input.operation === "characters" &&
        item.stage === "awaiting-review",
    )!;
    const changed = await client.chapters.update(chapter.id, {
      version: chapter.version,
      content: `${chapter.content}\n\n作者新版本不可换入旧规划。`,
    });
    await workbench.getByRole("button", { name: "采用", exact: true }).click();
    await expect(workbench.getByRole("alert")).toContainText(
      /来源|上下文|版本|当前/u,
    );
    expect(
      await get<RecordEntity[]>(`characters?projectId=${project.id}`),
    ).toHaveLength(1);
    expect((await client.creation.get(old.id)).narrativePlanningBasis).toEqual(
      old.narrativePlanningBasis,
    );
    expect(await client.chapters.get(chapter.id)).toEqual(changed);
    expect(await client.chapters.get(omitted.id)).toEqual(omitted);
    await running.page.screenshot({
      path: test.info().outputPath("planning-source-change-rejected.png"),
    });
    await expect
      .poll(async () => {
        const value = await client.creativeOutcomes.summary(project.id);
        return value.planningFunnel?.measures.find(
          (item) => item.operation === "characters",
        )?.adoptionRejectedCount;
      })
      .toBe(1);
    const adoptedSummary = await client.creativeOutcomes.summary(project.id);
    expect(adoptedSummary.planningBatches?.recordedBatches).toBe(5);
    for (const record of records) {
      const batch = adoptedSummary.planningBatches!.items.find(
        (item) => item.fact.workflowId === record.workflow.id,
      )!;
      expect(batch.fact).toMatchObject({
        operation: record.workflow.input.operation,
        candidate: { id: record.workflow.previewId },
        recordCount: 1,
        recordDisplay: "first-five-actual-records",
      });
      const actual = (
        await get<RecordEntity[]>(`${record.domain}?projectId=${project.id}`)
      ).filter((item) => item.payload.sourceWorkflowId === record.workflow.id);
      expect(batch.fact.records).toEqual(
        actual.map((item) => ({
          id: item.id,
          version: 0,
          kind: record.domain,
        })),
      );
    }
    expect(
      adoptedSummary.planningFunnel?.measures.find(
        (item) => item.operation === "characters",
      ),
    ).toMatchObject({
      recordedRequests: 2,
      requestedTargets: 2,
      firstCandidates: 2,
      firstAdopted: 1,
      pendingDecision: 1,
      adoptionRejectedCount: 1,
      firstCandidateAdoptionRatio: 0.5,
    });
    const originalBatch = adoptedSummary.planningBatches!.items.find(
      (item) => item.fact.operation === "characters",
    )!;
    const originalConflict = adoptedSummary.planningFunnel!.measures.find(
      (item) => item.operation === "characters",
    )!.sourceConflicts!;
    expect(originalConflict).toMatchObject({
      candidateCount: 1,
      last: {
        candidate: { id: old.previewId },
        sourceConflict: {
          projectId: project.id,
          workflowId: old.id,
          changes: [
            {
              sourceKind: "chapter",
              frozen: { id: chapter.id, version: chapter.version },
              current: { id: changed.id, version: changed.version },
            },
          ],
        },
      },
    });
    expect(
      adoptedSummary
        .planningFunnel!.measures.filter(
          (item) => item.operation !== "characters",
        )
        .every(
          (item) =>
            item.sourceConflicts?.candidateCount === 0 &&
            item.sourceConflicts.last === null,
        ),
    ).toBe(true);
    const readonlyTraffic: Array<{ method: string; path: string }> = [];
    let conflictScreenshotPhase = 0;
    const showPlanningLedger = async () => {
      running!.page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/v2/"))
          readonlyTraffic.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
          });
      });
      await navigate("/insights");
      await running!.page
        .getByRole("combobox", { name: "所属项目", exact: true })
        .selectOption(project.id);
      const panel = running!.page.getByLabel("独立故事规划批次与原请求", {
        exact: true,
      });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("本机已记录 5 个采用批次");
      await expect(
        panel.locator('[data-planning-funnel-operation="characters"]'),
      ).toContainText("1/2（50.0%）");
      const sourceProof = panel.locator(
        `[data-planning-source-conflict-workflow-id="${old.id}"]`,
      );
      await expect(sourceProof).toHaveCount(1);
      await sourceProof.locator("summary").click();
      for (const value of [
        old.id,
        old.previewId!,
        originalConflict.last!.candidate.contentFingerprint,
        originalConflict.last!.eventId,
        `原版本 ${chapter.id} @ ${chapter.version}`,
        `当前观察 ${changed.id} @ ${changed.version}`,
      ])
        await expect(sourceProof).toContainText(value);
      await expect(panel).toContainText("已核对来源冲突候选 1");
      await sourceProof.scrollIntoViewIfNeeded();
      await running!.page.screenshot({
        path: test
          .info()
          .outputPath(
            conflictScreenshotPhase++ === 0
              ? "planning-conflict-original.png"
              : "planning-conflict-restored.png",
          ),
      });
      const proof = panel.locator(
        `[data-planning-batch-workflow-id="${originalBatch.fact.workflowId}"]`,
      );
      await proof.locator("summary").click();
      await expect(proof).toContainText(originalBatch.fact.candidate.id);
      await expect(proof).toContainText(
        originalBatch.fact.candidate.contentFingerprint,
      );
      for (const record of originalBatch.fact.records)
        await expect(proof).toContainText(record.id);
      await proof.scrollIntoViewIfNeeded();
      await running!.page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await expect(proof).toBeVisible();
    };
    const calls = fixture.calls.length;
    await showPlanningLedger();
    await running.page.screenshot({
      path: test.info().outputPath("planning-batch-original.png"),
    });
    await running.application.close();
    manager.disconnect();
    running = await launch(userData);
    await manager.attach({
      ...(await running.page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    await showPlanningLedger();
    const recovered = await client.creativeOutcomes.summary(project.id);
    expect(recovered.planningBatches).toEqual(adoptedSummary.planningBatches);
    expect(recovered.planningFunnel).toEqual(adoptedSummary.planningFunnel);
    expect(await client.chapters.get(chapter.id)).toEqual(changed);
    expect(await client.chapters.get(omitted.id)).toEqual(omitted);
    const restoredRead = await runtimeReader(running.page);
    for (const record of records)
      expect(
        (
          await restoredRead<CreationWorkflow>(
            `workflows/creation/${record.workflow.id}`,
          )
        ).output,
      ).toEqual(record.workflow.output);
    expect(
      (await restoredRead<CreationWorkflow>(`workflows/creation/${old.id}`))
        .output,
    ).toEqual(old.output);
    expect(readonlyTraffic.length).toBeGreaterThan(0);
    await test.info().attach("planning-ledger-readonly-traffic", {
      body: JSON.stringify(readonlyTraffic),
      contentType: "application/json",
    });
    // A restarted renderer may still synchronize its native window theme.
    // Keep that actual POST in evidence; every business request stays read-only.
    const themeTraffic = readonlyTraffic.filter(
      ({ path }) => path === "/api/v2/system/host/window/theme",
    );
    expect(themeTraffic.every(({ method }) => method === "POST")).toBe(true);
    expect(
      readonlyTraffic
        .filter(({ path }) => path !== "/api/v2/system/host/window/theme")
        .every(({ method }) => method === "GET"),
    ).toBe(true);
    expect(fixture.calls).toHaveLength(calls);
    expect(fixture.errors).toEqual([]);
    const windows = await running.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
    await running.page.screenshot({
      path: test.info().outputPath("planning-batch-restored.png"),
    });
  } finally {
    manager.disconnect();
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("普通导入的新建回复丢失和项目内最终保存故障都按冻结原请求后台重启恢复，不重复章节", async ({}, info) => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-ordinary-import-recovery-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  const filename = resolve("tests/fixtures/lm6/lm6-00/novel-higher-context.md");
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    const chooseFixture = () =>
      running!.application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, filename);
    await chooseFixture();
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "导入小说或大纲", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("原普通导入恢复");
    await running.page
      .getByRole("button", { name: "选择文件", exact: true })
      .click();
    await running.page
      .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
      .check();
    let mainCommits = 0;
    let originalKey: string | undefined;
    let originalInput: unknown;
    let originalImportId: string | undefined;
    await running.page.route(
      "**/api/v2/source-imports/*/commit",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        originalKey = route.request().headers()["idempotency-key"];
        originalInput = route.request().postDataJSON();
        originalImportId = new URL(route.request().url()).pathname
          .split("/")
          .at(-2);
        const local = await running!.page.evaluate(
          () =>
            JSON.parse(
              window.localStorage.getItem("dramaip-creation-draft:v1")!,
            ).sourceImportAttempt,
        );
        expect(local.requestKey).toBe(originalKey);
        expect(local.input).toEqual(originalInput);
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        mainCommits++;
        await route.abort("failed");
      },
    );
    await running.page
      .getByRole("button", { name: "创建系列长篇并导入", exact: true })
      .click();
    await expect.poll(() => mainCommits).toBe(1);
    await expect(running.page.getByRole("alert")).toContainText(
      "恢复同一次导入",
    );
    let get = await runtimeReader(running.page);
    const projects = await get<Array<{ id: string }>>("projects");
    expect(projects).toHaveLength(1);
    const projectId = projects[0]!.id;
    const originalChapters = await get<Chapter[]>(
      `projects/${projectId}/chapters`,
    );
    expect(originalChapters).toHaveLength(2);
    await expect(
      running.page.getByRole("button", { name: "重新选择", exact: true }),
    ).toBeDisabled();
    await expect(
      running.page.getByRole("textbox", { name: "导入章节正文", exact: true }),
    ).toBeDisabled();
    await running.page
      .getByRole("button", { name: "清空", exact: true })
      .click();
    await expect(running.page.getByRole("alert")).toContainText(
      "保留原预览和动作键",
    );
    await running.page.screenshot({
      path: info.outputPath("ordinary-create-original.png"),
    });
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    const saved = await running.page.evaluate(
      () =>
        JSON.parse(window.localStorage.getItem("dramaip-creation-draft:v1")!)
          .sourceImportAttempt,
    );
    expect(saved).toMatchObject({
      importId: originalImportId,
      requestKey: originalKey,
      input: originalInput,
    });
    expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
      originalChapters,
    );
    let retried = 0;
    await running.page.route(
      "**/api/v2/source-imports/*/commit",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        expect(route.request().headers()["idempotency-key"]).toBe(originalKey);
        expect(route.request().postDataJSON()).toEqual(originalInput);
        retried++;
        await route.continue();
      },
    );
    await running.page
      .getByRole("button", { name: "创建系列长篇并导入", exact: true })
      .click();
    await expect(running.page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    expect(retried).toBe(1);
    expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
      originalChapters,
    );
    expect(
      await running.page.evaluate(() =>
        window.localStorage.getItem("dramaip-creation-draft:v1"),
      ),
    ).toBeNull();
    await running.page.unroute("**/api/v2/source-imports/*/commit");
    await chooseFixture();
    await running.page.evaluate((id) => {
      window.location.hash = `#/projects/${id}/tools/import`;
    }, projectId);
    const panel = () =>
      running!.page.locator("section").filter({
        has: running!.page.getByRole("heading", {
          name: "导入小说原稿或漫剧剧本",
          exact: true,
        }),
      });
    await expect(panel()).toBeVisible();
    await panel()
      .getByRole("button", { name: "选择文件并解析", exact: true })
      .click();
    await panel()
      .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
      .check();
    nativeIntakeFault(
      join(userData, "dramaip.db"),
      "CREATE TRIGGER controlled_ordinary_import_finalization BEFORE UPDATE OF result_json ON workspace_source_import_commits BEGIN SELECT RAISE(ABORT, 'controlled ordinary finalization failure'); END;",
    );
    await panel()
      .getByRole("button", { name: "确认导入", exact: true })
      .click();
    await expect(panel()).toContainText("导入提交未完成");
    const attempt = await running.page.evaluate(
      (id) =>
        JSON.parse(
          window.localStorage.getItem(`dramaip-source-import-attempt:${id}`)!,
        ),
      projectId,
    );
    const batchChapters = await get<Chapter[]>(
      `projects/${projectId}/chapters`,
    );
    expect(batchChapters).toHaveLength(4);
    await expect(
      panel().getByRole("button", { name: "重新选择", exact: true }),
    ).toBeDisabled();
    await expect(
      panel().getByRole("textbox", { name: "导入章节正文", exact: true }),
    ).toBeDisabled();
    await panel().getByRole("button", { name: "取消", exact: true }).click();
    expect(
      await running.page.evaluate(
        (id) =>
          JSON.parse(
            window.localStorage.getItem(`dramaip-source-import-attempt:${id}`)!,
          ),
        projectId,
      ),
    ).toEqual(attempt);
    await running.application.close();
    nativeIntakeFault(
      join(userData, "dramaip.db"),
      "DROP TRIGGER controlled_ordinary_import_finalization;",
    );
    running = await launch(userData);
    get = await runtimeReader(running.page);
    let panelCommits = 0;
    await running.page.route(
      "**/api/v2/source-imports/*/commit",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        expect(route.request().headers()["idempotency-key"]).toBe(
          attempt.requestKey,
        );
        expect(route.request().postDataJSON()).toEqual(attempt.input);
        panelCommits++;
        await route.continue();
      },
    );
    await running.page.evaluate((id) => {
      window.location.hash = `#/projects/${id}/tools/import`;
    }, projectId);
    await expect(
      panel().locator(`[data-source-import-id="${attempt.importId}"]`),
    ).toBeVisible();
    await expect(panel()).toContainText("原导入尚待完成");
    expect(panelCommits).toBe(0);
    expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
      batchChapters,
    );
    await panel().screenshot({
      path: info.outputPath("ordinary-panel-original-restored.png"),
    });
    await panel()
      .getByRole("button", { name: "恢复同一次导入", exact: true })
      .click();
    await expect(running.page).toHaveURL(
      new RegExp(`/projects/${projectId}/tools/review$`),
    );
    expect(panelCommits).toBe(1);
    expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
      batchChapters,
    );
    expect(
      await running.page.evaluate(
        (id) =>
          window.localStorage.getItem(`dramaip-source-import-attempt:${id}`),
        projectId,
      ),
    ).toBeNull();
    expect(
      await get<unknown[]>(
        `projects/${projectId}/import-extractions/change-sets`,
      ),
    ).toHaveLength(2);
    const recovery = await get<
      import("@dramaip/contracts/workspace").SourceImportCommitRecovery
    >(
      `source-imports/${attempt.importId}/commit?${new URLSearchParams({ projectId, requestKey: attempt.requestKey })}`,
    );
    expect(recovery.state).toBe("committed");
    expect(recovery.input).toEqual(attempt.input);
    await expect
      .poll(
        async () =>
          (
            await get<CreativeOutcomeSummary>(
              `projects/${projectId}/creative-outcomes/summary`,
            )
          ).sourceConfirmations.recordedConfirmations,
      )
      .toBe(2);
    const sourceHistory = (
      await get<CreativeOutcomeSummary>(
        `projects/${projectId}/creative-outcomes/summary`,
      )
    ).sourceConfirmations;
    expect(sourceHistory.items.map((item) => item.sourceId)).toEqual([
      attempt.importId,
      originalImportId,
    ]);
    expect(
      sourceHistory.items.every(
        (item) =>
          item.owner === "workspace" &&
          item.projectId === projectId &&
          item.projectMode === "series_longform" &&
          item.workflowPath === "novel" &&
          item.entryCount === 2 &&
          item.rightsState === "declared-not-verified" &&
          item.qualityState === "unverified" &&
          item.currentValidity === "not-assessed",
      ),
    ).toBe(true);
    expect(sourceHistory.items[1]!.entries.map((entry) => entry.id)).toEqual(
      originalChapters.map((chapter) => chapter.id),
    );
    expect(sourceHistory.items[0]!.entries.map((entry) => entry.id)).toEqual(
      batchChapters
        .filter(
          (chapter) => !originalChapters.some((old) => old.id === chapter.id),
        )
        .map((chapter) => chapter.id),
    );
    await running.page.evaluate(() => {
      window.location.hash = "#/insights";
    });
    await running.page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(projectId);
    const sourceView = () =>
      running!.page.getByLabel("来源确认历史", { exact: true });
    await expect(sourceView()).toContainText("本机已记录 2 次");
    await expect(sourceView()).toContainText("当前有效性未评估");
    for (const source of sourceHistory.items) {
      const card = sourceView().locator(
        `[data-source-confirmation-id="${source.sourceId}"]`,
      );
      await expect(card).toContainText(
        `原项目 ${projectId} @ ${source.projectVersion}`,
      );
      for (const entry of source.entries)
        await expect(
          card.locator(`[data-original-source-binding-id="${entry.id}"]`),
        ).toContainText(`${entry.id} @ ${entry.version}`);
    }
    await sourceView().evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    await sourceView().screenshot({
      path: info.outputPath("ordinary-source-history-original.png"),
    });
    const unavailable = `**/api/v2/projects/${projectId}/creative-outcomes/summary`;
    await running.page.route(unavailable, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://dramaip.local/problems/controlled-source-read",
          status: 503,
          title: "Controlled source history read unavailable",
          detail: "Controlled source history read unavailable",
          code: "CONTROLLED_SOURCE_HISTORY_READ",
          traceId: randomUUID(),
        }),
      }),
    );
    await running.page
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(
      running.page.getByRole("alert").filter({ hasText: "结果台账读取失败" }),
    ).toBeVisible();
    await expect(sourceView()).toHaveCount(0);
    await running.page.unroute(unavailable);
    await running.page
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(sourceView()).toBeVisible();
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    let unexpectedSourcePosts = 0;
    running.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/api\/v2\/source-imports\//u.test(request.url())
      )
        unexpectedSourcePosts++;
    });
    await running.page.evaluate(() => {
      window.location.hash = "#/insights";
    });
    await running.page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(projectId);
    await expect(sourceView()).toContainText("本机已记录 2 次");
    for (const source of sourceHistory.items)
      await expect(
        sourceView().locator(
          `[data-source-confirmation-id="${source.sourceId}"]`,
        ),
      ).toContainText(`原项目 ${projectId} @ ${source.projectVersion}`);
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).sourceConfirmations,
    ).toEqual(sourceHistory);
    expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
      batchChapters,
    );
    expect(unexpectedSourcePosts).toBe(0);
    await sourceView().evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    for (const source of sourceHistory.items)
      for (const entry of source.entries)
        await expect(
          sourceView().locator(
            `[data-original-source-binding-id="${entry.id}"]`,
          ),
        ).toBeVisible();
    await sourceView().screenshot({
      path: info.outputPath("ordinary-source-history-restored.png"),
    });
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.errors).toEqual([]);
    const windows = await running.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("明确初始目标在回复丢失后按冻结原请求恢复，旧默认草稿不补确认，台账后台重启只读保留", async ({}, info) => {
  test.setTimeout(100_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-initial-goal-recovery-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    const draft = () =>
      running!.page.evaluate(() =>
        JSON.parse(window.localStorage.getItem("dramaip-creation-draft:v1")!),
      );
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    expect((await draft()).goalConfirmation).toBeUndefined();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    expect((await draft()).goalConfirmation).toEqual({
      confirmed: true,
      goal: "novel-first",
      material: "inspiration",
    });
    await running.page
      .getByRole("button", { name: "更换素材", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    expect((await draft()).goalConfirmation).toBeUndefined();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("冻结的原小说目标");
    let commits = 0;
    let originalKey: string | undefined;
    let originalInput: unknown;
    await running.page.route("**/api/v2/projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      originalKey = route.request().headers()["idempotency-key"];
      originalInput = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      commits++;
      await route.abort("failed");
    });
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(
      running.page
        .getByRole("status")
        .filter({ hasText: "同次创建已冻结原请求" }),
    ).toBeVisible();
    await expect.poll(() => commits).toBe(1);
    const saved = await draft();
    expect(saved.attemptId).toBe(originalKey);
    expect(saved.frozenProjectInput).toEqual(originalInput);
    expect(saved.createdProjectId).toBeUndefined();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("后来编辑不替换原请求");
    expect((await draft()).attemptId).toBe(originalKey);
    expect((await draft()).frozenProjectInput).toEqual(originalInput);
    await expect(
      running.page.getByRole("button", { name: "更换目标", exact: true }),
    ).toBeDisabled();
    await running.page
      .getByRole("button", { name: "清空", exact: true })
      .click();
    await expect(running.page.getByRole("alert")).toContainText(
      "原创建结果尚未核验；保留同一创建键，先明确重试核验，不清空或换键创建。",
    );
    const edited = await draft();
    await running.application.close();
    running = await launch(userData);
    let get = await runtimeReader(running.page);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    expect(await draft()).toEqual(edited);
    const projects =
      await get<Array<{ id: string; title: string }>>("projects");
    expect(projects).toHaveLength(1);
    const projectId = projects[0]!.id;
    expect(projects[0]!.title).toBe("冻结的原小说目标");
    await expect
      .poll(
        async () =>
          (
            await get<CreativeOutcomeSummary>(
              `projects/${projectId}/creative-outcomes/summary`,
            )
          ).goalConfirmations.recordedProjects,
      )
      .toBe(1);
    const goals = (
      await get<CreativeOutcomeSummary>(
        `projects/${projectId}/creative-outcomes/summary`,
      )
    ).goalConfirmations;
    let replayKey: string | undefined;
    let replayInput: unknown;
    running.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/projects"
      ) {
        replayKey = request.headers()["idempotency-key"];
        replayInput = request.postDataJSON();
      }
    });
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    expect(replayKey).toBe(originalKey);
    expect(replayInput).toEqual(originalInput);
    expect(await get("projects")).toHaveLength(1);
    const summary = await get<CreativeOutcomeSummary>(
      `projects/${projectId}/creative-outcomes/summary`,
    );
    expect(summary.goalConfirmations).toEqual(goals);
    expect(summary.counts.every((item) => item.total === 0)).toBe(true);
    await running.page.evaluate(() => {
      window.location.hash = "#/insights";
    });
    await running.page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(projectId);
    const history = () =>
      running!.page.getByLabel("初始创作目标确认", { exact: true });
    await expect(history()).toContainText("先完成小说 · 素材：创意");
    await expect(history()).toContainText(`原项目 ${projectId} @ 0`);
    await history().screenshot({
      path: info.outputPath("initial-goal-original.png"),
    });
    const unavailable = `**/api/v2/projects/${projectId}/creative-outcomes/summary`;
    await running.page.route(unavailable, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://dramaip.local/problems/controlled-goal-read",
          status: 503,
          title: "Controlled goal read unavailable",
          detail: "Controlled goal read unavailable",
          code: "CONTROLLED_GOAL_READ",
          traceId: randomUUID(),
        }),
      }),
    );
    await running.page
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(
      running.page.getByRole("alert").filter({ hasText: "结果台账读取失败" }),
    ).toBeVisible();
    await expect(history()).toHaveCount(0);
    await running.page.unroute(unavailable);
    await running.page
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(history()).toBeVisible();
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await running.page.evaluate(() => {
      window.location.hash = "#/insights";
    });
    await running.page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(projectId);
    await expect(history()).toContainText(`原项目 ${projectId} @ 0`);
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).goalConfirmations,
    ).toEqual(goals);
    await history().evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    await history().screenshot({
      path: info.outputPath("initial-goal-restored.png"),
    });
    // A genuinely old UI draft has neither an explicit button receipt nor a frozen request.
    await running.page.evaluate((old) => {
      delete old.goalConfirmation;
      delete old.attemptId;
      delete old.frozenProjectInput;
      delete old.createdProjectId;
      old.brief.title = "旧默认草稿保持未知";
      old.intakeStep = 3;
      old.initializationSteps = [];
      window.localStorage.setItem(
        "dramaip-creation-draft:v1",
        JSON.stringify(old),
      );
      window.location.hash = "#/";
    }, saved);
    await running.page.reload();
    expect((await draft()).goalConfirmation).toBeUndefined();
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const oldId = running.page.url().split("/").at(-1)!;
    expect(oldId).not.toBe(projectId);
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${oldId}/creative-outcomes/summary`,
        )
      ).goalConfirmations.recordedProjects,
    ).toBe(0);
    expect(await get("projects")).toHaveLength(2);
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("fresh profile 完成小说规划、两章候选显式采用、事实记忆、本地分层索引、Host 稿件保存和重启恢复（受控模型接口）", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-novel-creation-journey-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page.getByRole("textbox", { name: "项目名称" }).fill(TITLE);
    await running.page
      .getByRole("textbox", { name: "故事构思（可选）", exact: true })
      .fill(
        "温和的旧书店成长小说，小禾学会求助。第三人称，不强制反转，不改编，不生成媒体。每章约 300 字。",
      );
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    const chapterWrites: Array<{ method: string; version?: number }> = [];
    running.page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        /\/api\/v2\/chapters\/[^/]+$/u.test(request.url())
      )
        chapterWrites.push({
          method: request.method(),
          version: request.postDataJSON()?.version,
        });
    });
    let get = await runtimeReader(running.page);
    const providers = await get<RecordEntity[]>("providers");
    expect(providers).toHaveLength(1);
    expect(providers[0]!.payload).toMatchObject({
      服务地址: fixture.url,
      模型名称: MODEL,
    });
    expect(JSON.stringify(providers)).not.toContain(KEY);
    const list = (kind: string) =>
      get<RecordEntity[]>(`${kind}?projectId=${projectId}`);
    const workflows = async () =>
      (
        await get<{ items: Workflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        )
      ).items;
    const currentWorkflow = async (operation: string, targetId?: string) => {
      const found = (await workflows()).filter(
        (value) =>
          value.input.operation === operation &&
          value.input.targetId === targetId,
      );
      expect(found).toHaveLength(1);
      return found[0]!;
    };
    // Explicit UI adoption is the only authority. The same version remains
    // frozen for planning and both chapters, including restart and checks.
    await adoptIntentInUi(running.page, INTENT);
    const adoptedIntent = (
      await get<AuthorIntentCurrent>(`projects/${projectId}/author-intent`)
    ).current!;
    expect(adoptedIntent.content).toEqual(INTENT);
    await running.page.evaluate((id) => {
      window.location.hash = `#/projects/${id}`;
    }, projectId);
    for (const [tab, label, operation, domain, itemTitle] of [
      ["人物", "人物方案", "characters", "characters", "小禾"],
      ["大纲", "全书大纲", "book-outline", "outlines", "旧书店两章规划"],
    ]) {
      await running.page
        .getByRole("button", { name: tab, exact: true })
        .click();
      const workbench = running.page.getByLabel(`AI ${label}`, { exact: true });
      const planning = running.page.getByLabel("本轮规划来源确认", {
        exact: true,
      });
      // With no saved chapter text, the only possible scope is preselected
      // and confirmed; the explicit choice remains available and idempotent.
      await expect(
        planning.locator('[data-planning-confirmed="true"]'),
      ).toBeVisible();
      await expect(
        planning.getByRole("radio", {
          name: "明确不使用正文，仅依据简报与正式作者意图规划",
          exact: true,
        }),
      ).toBeChecked();
      await planning
        .getByRole("button", { name: "确认本轮规划范围与表达", exact: true })
        .click();
      await workbench
        .getByRole("button", { name: `生成并检查${label}`, exact: true })
        .click();
      await expect(workbench.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        {
          timeout: 20_000,
        },
      );
      expect(
        (await list(domain!)).some((item) => item.title === itemTitle),
      ).toBe(false);
      await workbench
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await expect(workbench.locator("header").getByRole("status")).toHaveText(
        "已采用",
      );
      expect(
        (await list(domain!)).filter((item) => item.title === itemTitle),
      ).toHaveLength(1);
      expect((await currentWorkflow(operation!)).input.engineKind).toBe(
        "langgraph",
      );
      expect(
        (await currentWorkflow(operation!)).narrativePlanningBasis,
      ).toMatchObject({
        operation,
        request: { chapterScope: { mode: "none", chapters: [] } },
        coverage: { included: [] },
      });
    }
    await running.page
      .getByRole("button", { name: "正文", exact: true })
      .click();
    const initial = (
      await get<Chapter[]>(`projects/${projectId}/chapters`)
    )[0]!;
    expect(initial.content).toBe("");
    const workbench = () =>
      running!.page.getByLabel("AI 本章正文", { exact: true });
    await workbench()
      .locator("summary")
      .filter({ hasText: "创作设置" })
      .click();
    await workbench()
      .getByRole("spinbutton", { name: "目标字数", exact: true })
      .fill("300");
    await workbench()
      .getByRole("button", { name: "生成并检查本章正文", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      {
        timeout: 20_000,
      },
    );
    // Observe beyond the 850 ms autosave debounce: a read-only candidate must
    // never become a dirty draft merely because the editor was made readonly.
    await running.page
      .getByRole("button", { name: "原稿", exact: true })
      .click();
    await expect(
      running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      }),
    ).not.toContainText(FIRST_FACT);
    await running.page
      .getByRole("button", { name: "AI 草稿", exact: true })
      .click();
    await expect(
      running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      }),
    ).toContainText(FIRST_FACT);
    await running.page.waitForTimeout(1200);
    expect(chapterWrites).toEqual([]);
    expect(await get<Chapter>(`chapters/${initial.id}`)).toMatchObject({
      content: "",
      version: initial.version,
    });
    const firstWorkflow = await currentWorkflow("chapter", initial.id);
    expect(JSON.stringify(firstWorkflow)).not.toContain(KEY);
    await openProjectTool(running.page, "项目驾驶舱");
    let cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByRole("link", { name: "审阅小说候选", exact: true }),
    ).toBeVisible();
    await expect(
      cockpit.getByLabel("正文与章节采用", { exact: true }),
    ).toHaveAttribute("data-gate-status", "needs-human");
    expect(
      (
        await get<{ items: unknown[] }>(
          `projects/${projectId}/chapter-adoptions`,
        )
      ).items,
    ).toEqual([]);
    await cockpit
      .getByRole("link", { name: "审阅小说候选", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
    );
    await workbench()
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await get<Workflow>(`workflows/creation/${firstWorkflow.id}`))
            .memoryState,
        { timeout: 20_000 },
      )
      .toBe("synced");
    const first = await get<Chapter>(`chapters/${initial.id}`);
    expect(first.content).toBe(FIRST_TEXT);
    expect(first.version, JSON.stringify(chapterWrites)).toBe(
      initial.version + 1,
    );
    const firstMemory = (await list("chapter-memories")).find(
      (item) => item.payload.sourceChapterId === first.id,
    )!;
    expect(firstMemory.payload).toMatchObject({
      sourceChapterId: first.id,
      sourceVersion: first.version,
      evidence: FIRST_FACT,
    });
    await expect(workbench()).toContainText("已按采用版本更新");
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByRole("link", { name: "继续下一章", exact: true }),
    ).toBeVisible();
    await expect(
      cockpit.getByLabel("正文与章节采用", { exact: true }),
    ).toContainText(`v${first.version}`);
    await expect(
      cockpit.getByLabel("连续性事实记忆", { exact: true }),
    ).toHaveAttribute("data-gate-status", "ready");
    await cockpit
      .getByRole("link", { name: "继续下一章", exact: true })
      .click();
    await workbench()
      .locator("summary")
      .filter({ hasText: "下一章来源范围" })
      .click();
    const contextSource = workbench().getByRole("group", {
      name: `前文来源 ${first.title}`,
      exact: true,
    });
    await contextSource
      .getByRole("button", { name: "读取此章摘要和段落", exact: true })
      .click();
    await expect(
      contextSource
        .getByLabel(`前文表达 ${first.title}`, { exact: true })
        .locator(`option[value="summary:${firstMemory.id}"]`),
    ).toHaveCount(1);
    const callsBeforeContext = fixture.calls.length;
    await contextSource
      .getByLabel(`前文表达 ${first.title}`, { exact: true })
      .selectOption("paragraphs");
    await contextSource
      .getByLabel(`上下文段落 ${first.title} 0`, { exact: true })
      .check();
    await contextSource
      .getByLabel(`前文表达 ${first.title}`, { exact: true })
      .selectOption("original");
    await contextSource
      .getByLabel(`前文表达 ${first.title}`, { exact: true })
      .selectOption(`summary:${firstMemory.id}`);
    expect(fixture.calls).toHaveLength(callsBeforeContext);
    await contextSource.scrollIntoViewIfNeeded();
    await running.page.screenshot({
      path: test.info().outputPath("novel-context-selection.png"),
    });
    await workbench()
      .getByRole("button", { name: "续写下一章", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      {
        timeout: 20_000,
      },
    );
    const two = await get<Chapter[]>(`projects/${projectId}/chapters`);
    expect(two).toHaveLength(2);
    const second = two[1]!;
    expect(second.content).toBe("");
    const secondWorkflow = await currentWorkflow("chapter", second.id);
    expect(
      await running.page.evaluate(
        (key) => JSON.parse(window.localStorage.getItem(key) ?? "null"),
        `dramaip-novel-context:${projectId}:${second.id}`,
      ),
    ).toEqual(secondWorkflow.input.narrativeContextRequest);
    expect(secondWorkflow.narrativeContextBasis?.chapters).toMatchObject([
      {
        id: first.id,
        version: first.version,
        representation: "summary",
        record: { id: firstMemory.id, version: firstMemory.version },
      },
    ]);
    expect(
      secondWorkflow.sources.some(
        (source) =>
          source.kind === "knowledge" &&
          source.id === firstMemory.id &&
          source.version === firstMemory.version,
      ),
    ).toBe(true);
    const sent = fixture.calls.find(
      (call) => call.kind === "chapter-2",
    )!.prompt;
    expect(sent).not.toContain(JSON.stringify(FIRST_TEXT));
    expect(sent).toContain("已采用派生摘要");
    expect(sent).toContain(FIRST_FACT);
    const callsBeforeRestart = fixture.calls.length;
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await running.page.getByRole("link", { name: TITLE }).click();
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByRole("link", { name: "审阅小说候选", exact: true }),
    ).toBeVisible();
    await expect(
      cockpit.getByRole("link", { name: "审阅小说候选", exact: true }),
    ).toHaveAttribute(
      "href",
      `#/tasks?projectId=${projectId}&taskId=${secondWorkflow.taskId}&workflowId=${secondWorkflow.id}`,
    );
    await cockpit
      .getByRole("link", { name: "审阅小说候选", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
    );
    expect((await currentWorkflow("chapter", second.id)).id).toBe(
      secondWorkflow.id,
    );
    expect((await get<Chapter>(`chapters/${second.id}`)).content).toBe("");
    expect(fixture.calls).toHaveLength(callsBeforeRestart);
    // The global inbox reads the actual frozen workflow. Opening it must not
    // adopt a chapter or replace this historical candidate with a newer run.
    await running.page
      .getByRole("link", { name: "待确认", exact: true })
      .click();
    await expect(
      running.page.getByRole("heading", { name: "待确认中心", exact: true }),
    ).toBeVisible();
    const pendingChapter = running.page.locator(
      `[data-confirmation-key="creation:${secondWorkflow.id}"]`,
    );
    await expect(pendingChapter).toContainText("等待审阅采用");
    await expect(
      pendingChapter.getByRole("link", { name: "返回对应对象", exact: true }),
    ).toHaveAttribute("href", new RegExp(`workflowId=${secondWorkflow.id}`));
    await pendingChapter
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const exactCandidate = running.page.getByLabel("对应待确认对象", {
      exact: true,
    });
    await expect(exactCandidate).toContainText(SECOND_TEXT);
    expect((await currentWorkflow("chapter", second.id)).id).toBe(
      secondWorkflow.id,
    );
    expect((await get<Chapter>(`chapters/${second.id}`)).content).toBe("");
    expect(fixture.calls).toHaveLength(callsBeforeRestart);
    await running.page.evaluate((path) => {
      window.location.hash = path;
    }, `#/projects/${projectId}?chapterId=${second.id}`);
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
    );
    await workbench()
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await get<Workflow>(`workflows/creation/${secondWorkflow.id}`))
            .memoryState,
        { timeout: 20_000 },
      )
      .toBe("synced");
    const adoptedSecond = await get<Chapter>(`chapters/${second.id}`);
    expect(adoptedSecond.content).toBe(SECOND_TEXT);
    expect(adoptedSecond.version).toBe(second.version + 1);
    expect(
      (await list("chapter-memories")).find(
        (item) => item.payload.sourceChapterId === second.id,
      )?.payload,
    ).toMatchObject({
      sourceVersion: adoptedSecond.version,
      evidence: SECOND_FACT,
    });
    // Normal UI creates a planning arc, then explicitly binds real current
    // chapter IDs/versions. Numeric chapter labels alone must remain unbound.
    await running.page
      .getByRole("button", { name: "大纲", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "卷与单元", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "补充已有规划", exact: true })
      .click();
    const arcEditor = running.page.getByRole("dialog", {
      name: "新建规划",
      exact: true,
    });
    await arcEditor
      .getByLabel("规划标题", { exact: true })
      .fill("铜钥匙归还范围");
    await arcEditor.getByLabel("起始章节", { exact: true }).fill("1");
    await arcEditor.getByLabel("结束章节", { exact: true }).fill("2");
    await arcEditor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(arcEditor).not.toBeVisible();
    const planningArc = (await list("story-arcs")).find(
      (item) => item.title === "铜钥匙归还范围",
    )!;
    const indexPath = `projects/${projectId}/narrative-context-index`;
    expect(
      (await get<NarrativeIndexCatalog>(indexPath)).groups.find(
        (group) => group.id === planningArc.id,
      )?.state,
    ).toBe("unbound");
    const indexCalls = fixture.calls.length;
    await openProjectTool(running.page, "质量报告");
    await running.page
      .locator("summary")
      .filter({ hasText: /^本地长篇来源索引$/u })
      .click();
    const indexPanel = () =>
      running!.page.getByLabel("本地长篇来源索引", { exact: true });
    await expect(
      indexPanel().locator('[data-index-group="book"]'),
    ).toContainText("2 章有效派生摘要");
    await indexPanel()
      .getByRole("button", {
        name: `索引章节 ${adoptedSecond.title}`,
        exact: true,
      })
      .click();
    await expect(
      indexPanel().getByLabel("章节来源详情", { exact: true }),
    ).toContainText(SECOND_FACT);
    await expect(
      indexPanel().locator("[data-index-summary-state]"),
    ).toHaveAttribute("data-index-summary-state", "current");
    expect(fixture.calls).toHaveLength(indexCalls);
    await indexPanel()
      .locator("summary")
      .filter({ hasText: "明确故事弧的规划章节范围" })
      .click();
    await indexPanel()
      .getByLabel("索引故事弧", { exact: true })
      .selectOption(planningArc.id);
    await indexPanel()
      .getByLabel(`故事弧范围章节 ${first.title}`, { exact: true })
      .check();
    await indexPanel()
      .getByLabel(`故事弧范围章节 ${adoptedSecond.title}`, { exact: true })
      .check();
    await indexPanel()
      .getByRole("button", { name: "确认故事弧章节范围", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "确认故事弧章节范围", exact: true })
      .getByRole("button", { name: "确认记录章节范围", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await get<NarrativeIndexCatalog>(indexPath)).groups.find(
            (group) => group.id === planningArc.id,
          )?.state,
      )
      .toBe("current");
    const boundArc = (await list("story-arcs")).find(
      (item) => item.id === planningArc.id,
    )!;
    expect(boundArc.payload).toMatchObject({
      起始章节: 1,
      结束章节: 2,
      narrativeChapterScope: {
        format: "chapter-refs-v1",
        chapters: [first, adoptedSecond].map(({ id, version }) => ({
          id,
          version,
        })),
      },
    });
    // Standalone regeneration is a real candidate, not implicit adoption.
    await indexPanel()
      .getByRole("button", { name: `索引章节 ${first.title}`, exact: true })
      .first()
      .click();
    await indexPanel()
      .getByRole("button", { name: "审阅生成本章派生记忆", exact: true })
      .click();
    const memoryWorkbench = indexPanel().getByLabel("AI 故事记忆", {
      exact: true,
    });
    await memoryWorkbench
      .getByRole("button", { name: "生成并检查故事记忆", exact: true })
      .click();
    await expect(
      memoryWorkbench.locator("header").getByRole("status"),
    ).toHaveText("等待审阅采用", { timeout: 20_000 });
    const beforeMemory = await get<NarrativeIndexDetail>(
      `${indexPath}/chapters/${first.id}`,
    );
    expect(beforeMemory.summaries).toHaveLength(1);
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).counts.find((item) => item.kind === "novel.chapter-memory-written")
        ?.total,
    ).toBe(2);
    await memoryWorkbench
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await get<NarrativeIndexDetail>(`${indexPath}/chapters/${first.id}`))
            .summaries.length,
      )
      .toBe(2);
    expect((await get<Chapter>(`chapters/${first.id}`)).version).toBe(
      first.version,
    );
    expect((await get<Chapter>(`chapters/${first.id}`)).content).toBe(
      FIRST_TEXT,
    );
    await indexPanel()
      .getByRole("button", {
        name: `索引章节 ${adoptedSecond.title}`,
        exact: true,
      })
      .first()
      .click();
    await indexPanel()
      .getByRole("heading", {
        name: `${adoptedSecond.title} · v${adoptedSecond.version}`,
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await running.page.screenshot({
      path: test.info().outputPath("novel-local-source-index.png"),
    });
    // Close the memory workbench before opening another independent workflow;
    // the summary panel adds no permanent SSE when folded.
    await running.page
      .locator("summary")
      .filter({ hasText: /^本地长篇来源索引$/u })
      .click();
    await running.page
      .locator("summary")
      .filter({ hasText: /^卷／故事弧／全书派生摘要$/u })
      .click();
    const summaryPanel = () =>
      running!.page.getByLabel("分层摘要工作台", { exact: true });
    await summaryPanel()
      .getByLabel("实际摘要范围", { exact: true })
      .selectOption(`book:${projectId}`);
    const beforeSummaryCalls = fixture.calls.length;
    const firstSource = summaryPanel()
      .locator("fieldset")
      .filter({ hasText: first.title });
    await firstSource
      .getByRole("button", { name: "读取此章已采用摘要", exact: true })
      .click();
    const actualSummarySource = (
      await get<NarrativeIndexDetail>(`${indexPath}/chapters/${first.id}`)
    ).summaries[0]!;
    await firstSource
      .getByLabel(`${first.title}摘要来源表达`, { exact: true })
      .selectOption(actualSummarySource.id);
    expect(fixture.calls).toHaveLength(beforeSummaryCalls);
    await summaryPanel()
      .getByRole("button", { name: "确认本轮摘要来源", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "确认分层摘要来源范围", exact: true })
      .getByRole("button", { name: "确认本轮摘要来源", exact: true })
      .click();
    const summaryWorkbench = summaryPanel().getByLabel(
      "AI 卷／故事弧／全书摘要",
      { exact: true },
    );
    await summaryWorkbench
      .getByRole("button", {
        name: "生成并检查卷／故事弧／全书摘要",
        exact: true,
      })
      .click();
    await expect(
      summaryWorkbench.locator("header").getByRole("status"),
    ).toHaveText("等待审阅采用", { timeout: 20_000 });
    const summaryWorkflow = await get<CreationWorkflow>(
      `workflows/creation/${(await currentWorkflow("narrative-summary", projectId)).id}`,
    );
    expect(
      summaryWorkflow.narrativeSummaryBasis?.references.map(
        (entry) => entry.representation,
      ),
    ).toEqual(["summary", "original"]);
    const summaryPath = `projects/${projectId}/narrative-summaries/${summaryWorkflow.narrativeSummaryId}`;
    expect(await get<NarrativeSummary>(summaryPath)).toMatchObject({
      status: "awaiting-review",
      isCurrent: false,
    });
    const summaryCall = fixture.calls.find(
      (call) => call.kind === "narrative-summary",
    )!;
    expect(summaryCall.prompt).toContain(actualSummarySource.text);
    expect(summaryCall.prompt).toContain(JSON.stringify(SECOND_TEXT));
    expect(summaryCall.prompt).not.toContain(JSON.stringify(FIRST_TEXT));
    await summaryWorkbench
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(async () => (await get<NarrativeSummary>(summaryPath)).isCurrent)
      .toBe(true);
    const savedSummary = await get<NarrativeSummary>(summaryPath);
    expect(savedSummary.content.coveredChapters).toEqual([
      { id: first.id, version: first.version },
      { id: second.id, version: adoptedSecond.version },
    ]);
    expect(savedSummary.usage).toEqual({ state: "unknown" });
    const summaryScopes = await get<NarrativeSummaryScopes>(
      `projects/${projectId}/narrative-summaries/scopes`,
    );
    expect(
      summaryScopes.scopes.find((scope) => scope.target.kind === "book")?.head
        ?.id,
    ).toBe(savedSummary.id);
    // Adoption changes the workflow version used by the summary query. Wait
    // for its terminal projection before scrolling the newly read details.
    await expect(
      summaryWorkbench.locator("header").getByRole("status"),
    ).toHaveText("已采用");
    await expect(
      summaryPanel()
        .getByLabel("分层摘要详情", { exact: true })
        .getByRole("heading"),
    ).toContainText("已采用派生摘要");
    await summaryPanel()
      .getByLabel("分层摘要详情", { exact: true })
      .getByRole("heading")
      .scrollIntoViewIfNeeded();
    await running.page.screenshot({
      path: test.info().outputPath("novel-book-summary-adopted.png"),
    });
    expect((await get<Chapter>(`chapters/${first.id}`)).content).toBe(
      FIRST_TEXT,
    );
    expect((await get<Chapter>(`chapters/${second.id}`)).content).toBe(
      SECOND_TEXT,
    );
    // Return to the manuscript path without foreground/native interaction.
    await running.page.evaluate((path) => {
      window.location.hash = path;
    }, `#/projects/${projectId}?chapterId=${second.id}`);
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
      "visual-assets",
    ])
      expect(await list(kind)).toEqual([]);
    const savedPath = join(userData, "adopted-novel-submission.md");
    await running.application.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({
        canceled: true,
        filePath: undefined,
      });
    });
    await running.page
      .getByRole("button", { name: "输入输出", exact: true })
      .click();
    await running.page
      .getByRole("menuitem", { name: "导出投稿包文档", exact: true })
      .click();
    const manuscriptDialog = () =>
      running!.page.getByRole("dialog", {
        name: "核验并导出投稿稿件",
        exact: true,
      });
    await manuscriptDialog()
      .getByRole("button", { name: "生成稿件预览", exact: true })
      .click();
    await expect(
      manuscriptDialog().getByLabel("实际稿件内容", { exact: true }),
    ).toContainText(FIRST_TEXT);
    await expect(
      manuscriptDialog().getByLabel("实际稿件内容", { exact: true }),
    ).toContainText(SECOND_TEXT);
    // Long manuscripts must scroll inside their preview, not cover consent controls.
    await expect(
      manuscriptDialog().getByLabel("实际稿件内容", { exact: true }),
    ).toHaveCSS("overflow-y", "auto");
    const confirmSave = () =>
      manuscriptDialog().getByRole("button", {
        name: "确认范围与权利并保存稿件",
        exact: true,
      });
    await expect(confirmSave()).toBeDisabled();
    const pendingPreview = (
      await get<{ items: Array<{ id: string; status: string }> }>(
        `projects/${projectId}/manuscripts`,
      )
    ).items.find((item) => item.status === "awaiting-confirmation")!;
    await manuscriptDialog()
      .getByRole("button", { name: "关闭稿件预览", exact: true })
      .click();
    await running.page
      .getByRole("link", { name: "待确认", exact: true })
      .click();
    const pendingManuscript = running.page.locator(
      `[data-confirmation-key="manuscript:${pendingPreview.id}"]`,
    );
    await expect(pendingManuscript).toContainText("范围与权利待确认");
    await pendingManuscript
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(manuscriptDialog()).toContainText(FIRST_TEXT);
    await expect(confirmSave()).toBeDisabled();
    const previewBounds = await manuscriptDialog().boundingBox();
    const previewViewport = await running.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(previewBounds).not.toBeNull();
    expect(previewBounds!.x + previewBounds!.width / 2).toBeCloseTo(
      previewViewport.width / 2,
      0,
    );
    expect(previewBounds!.height).toBeLessThan(previewViewport.height);
    await manuscriptDialog().screenshot({
      path: test.info().outputPath("manuscript-preview.png"),
    });
    const rightsCheck = () =>
      manuscriptDialog().getByRole("checkbox", {
        name: "我确认上述章节版本与范围，并有权导出这份稿件",
        exact: true,
      });
    await rightsCheck().check();
    await confirmSave().click();
    await expect(manuscriptDialog()).toContainText(
      "已取消保存，未记录成功交付。",
    );
    await expect(readFile(savedPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const canceledPage = await get<{
      items: Array<{ status: string; receipt?: unknown }>;
    }>(`projects/${projectId}/manuscripts`);
    expect(canceledPage.items).toHaveLength(1);
    expect(canceledPage.items[0]).toMatchObject({ status: "canceled" });
    expect(canceledPage.items[0]!.receipt).toBeUndefined();
    // Only the OS save-location picker is controlled; generation and Host writes are real.
    await running.application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, savedPath);
    await manuscriptDialog()
      .getByRole("button", { name: "重新选择范围与生成预览", exact: true })
      .click();
    await manuscriptDialog()
      .getByRole("button", { name: "生成稿件预览", exact: true })
      .click();
    await expect(confirmSave()).toBeDisabled();
    await rightsCheck().check();
    await confirmSave().click();
    await expect(manuscriptDialog()).toContainText("稿件已保存并核验。");
    const manuscriptPage = await get<{
      items: Array<{
        id: string;
        status: string;
        sourceState: string;
        manifest: {
          chapters: Array<{ id: string; version: number }>;
          contentSha256: string;
          byteSize: number;
        };
        receipt?: { sha256: string; byteSize: number; artifactRef: string };
      }>;
    }>(`projects/${projectId}/manuscripts`);
    const savedManuscript = manuscriptPage.items.find(
      (item) => item.status === "saved",
    )!;
    expect(savedManuscript.sourceState).toBe("current");
    expect(
      savedManuscript.manifest.chapters.map((item) => ({
        id: item.id,
        version: item.version,
      })),
    ).toEqual([
      { id: first.id, version: first.version },
      { id: second.id, version: adoptedSecond.version },
    ]);
    expect(savedManuscript.receipt).toMatchObject({
      sha256: savedManuscript.manifest.contentSha256,
      byteSize: savedManuscript.manifest.byteSize,
    });
    await manuscriptDialog()
      .getByRole("button", { name: "关闭稿件预览", exact: true })
      .click();
    const exported = await readFile(savedPath, "utf8");
    expect(exported).toContain(TITLE);
    expect(exported).toContain(FIRST_TEXT);
    expect(exported).toContain(SECOND_TEXT);
    expect(exported.indexOf(FIRST_TEXT)).toBeLessThan(
      exported.indexOf(SECOND_TEXT),
    );
    expect(exported).not.toContain("资源 JSON");
    const ledgerCalls = fixture.calls.length;
    await assertLocalResultLedger(
      running.page,
      projectId,
      {
        正式章节采用版本: 2,
        章节派生记忆实际写入批次: 3,
        "人物 / 大纲 / 故事弧采用版本": 2,
        已保存的稿件版本集合: 1,
        标准剧本采用版本: 0,
      },
      "novel-local-result-ledger.png",
    );
    expect(fixture.calls).toHaveLength(ledgerCalls);
    const ownerFacts = await get<CreativeOutcomePage>(
      `projects/${projectId}/creative-outcomes`,
    );
    expect(
      ownerFacts.items.filter((item) => item.kind === "novel.chapter-adopted"),
    ).toHaveLength(2);
    const memoryWrites = ownerFacts.items.filter(
      (item) => item.kind === "novel.chapter-memory-written",
    );
    expect(memoryWrites).toHaveLength(3);
    expect(
      memoryWrites.every(
        (item) =>
          item.resultStatus === "written" &&
          item.evidenceKind === "rule" &&
          item.memoryWrite!.records.length > 0,
      ),
    ).toBe(true);
    await expect(
      running.page.getByLabel("本地创作结果台账", { exact: true }),
    ).toContainText("非人工正文采用");
    expect(
      ownerFacts.items.filter(
        (item) => item.kind === "novel.manuscript-exported",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(ownerFacts)).not.toContain(FIRST_TEXT);
    const completedCalls = fixture.calls.length;
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await running.page.getByRole("link", { name: TITLE }).click();
    await expect(
      running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      }),
    ).toContainText(SECOND_FACT);
    expect(
      (await get<Chapter[]>(`projects/${projectId}/chapters`)).map(
        (chapter) => chapter.content,
      ),
    ).toEqual([FIRST_TEXT, SECOND_TEXT]);
    expect((await currentWorkflow("chapter", second.id)).stage).toBe("applied");
    expect(await readFile(savedPath, "utf8")).toBe(exported);
    expect(await get<NarrativeSummary>(summaryPath)).toEqual(savedSummary);
    const restoredOutcomes = await get<CreativeOutcomeSummary>(
      `projects/${projectId}/creative-outcomes/summary`,
    );
    expect(
      restoredOutcomes.counts.find(
        (item) => item.kind === "novel.chapter-adopted",
      )?.total,
    ).toBe(2);
    expect(
      restoredOutcomes.counts.find(
        (item) => item.kind === "novel.chapter-memory-written",
      )?.total,
    ).toBe(3);
    expect(
      restoredOutcomes.counts.find(
        (item) => item.kind === "novel.manuscript-exported",
      )?.total,
    ).toBe(1);
    const adoptionPage = await get<{
      items: Array<{ chapterId: string; version: number }>;
    }>(`projects/${projectId}/chapter-adoptions`);
    expect(adoptionPage.items).toHaveLength(2);
    expect(adoptionPage.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chapterId: first.id,
          version: first.version,
        }),
        expect.objectContaining({
          chapterId: second.id,
          version: adoptedSecond.version,
        }),
      ]),
    );
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByLabel("连续性事实记忆", { exact: true }),
    ).toHaveAttribute("data-gate-status", "ready");
    await expect(
      cockpit.getByLabel("连续性事实记忆", { exact: true }),
    ).toContainText("2/2");
    await expect(
      cockpit.getByLabel("稿件与投稿导出", { exact: true }),
    ).toHaveAttribute("data-gate-status", "ready");
    await expect(
      cockpit.getByLabel("稿件与投稿导出", { exact: true }),
    ).toContainText("完整稿件已核验保存");
    await cockpit
      .getByLabel("稿件与投稿导出", { exact: true })
      .getByRole("link", { name: "返回相关稿件与资料", exact: true })
      .click();
    await expect(manuscriptDialog()).toContainText("稿件已保存并核验。");
    await manuscriptDialog()
      .getByRole("button", { name: "关闭稿件预览", exact: true })
      .click();
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await cockpit.screenshot({
      path: test.info().outputPath("novel-cockpit-gates.png"),
    });
    // Manual author edits create a newer draft version, not another adoption.
    // Both the old AI receipt and old factual memory must stop certifying it.
    await cockpit
      .getByLabel("正文与章节采用", { exact: true })
      .getByRole("link", { name: "返回相关稿件与资料", exact: true })
      .click();
    await expect(
      running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      }),
    ).toContainText(SECOND_FACT);
    await running.page.getByText("更多操作", { exact: true }).click();
    await running.page
      .getByRole("button", { name: "微调正文", exact: true })
      .click();
    const revised = `${SECOND_TEXT}\n\n作者修订：小禾把铜钥匙留在柜台抽屉，不再带回家。`;
    await running.page
      .getByRole("textbox", { name: "章节正文编辑器", exact: true })
      .fill(revised);
    await expect
      .poll(async () => (await get<Chapter>(`chapters/${second.id}`)).version)
      .toBe(adoptedSecond.version + 1);
    expect((await get<Chapter>(`chapters/${second.id}`)).content).toContain(
      "作者修订：小禾把铜钥匙留在柜台抽屉",
    );
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByLabel("正文与章节采用", { exact: true }),
    ).toHaveAttribute("data-gate-status", "stale");
    await expect(
      cockpit.getByLabel("连续性事实记忆", { exact: true }),
    ).toHaveAttribute("data-gate-status", "pending");
    await expect(
      cockpit.getByLabel("连续性事实记忆", { exact: true }),
    ).toContainText("1/2");
    await expect(
      cockpit.getByLabel("稿件与投稿导出", { exact: true }),
    ).toHaveAttribute("data-gate-status", "stale");
    expect(
      (
        await get<typeof manuscriptPage>(`projects/${projectId}/manuscripts`)
      ).items.find((item) => item.id === savedManuscript.id),
    ).toMatchObject({
      status: "saved",
      sourceState: "stale",
      receipt: savedManuscript.receipt,
    });
    expect(
      (
        await get<{ items: Array<{ chapterId: string; version: number }> }>(
          `projects/${projectId}/chapter-adoptions`,
        )
      ).items,
    ).toEqual(adoptionPage.items);
    const changedIndex = await get<NarrativeIndexCatalog>(indexPath);
    expect(await get<NarrativeSummary>(summaryPath)).toMatchObject({
      isHead: true,
      isCurrent: false,
      sourceState: "stale",
      updatedAt: savedSummary.updatedAt,
      content: savedSummary.content,
    });
    expect(
      changedIndex.chapters.find((chapter) => chapter.id === second.id)
        ?.summaryState,
    ).toBe("stale");
    expect(
      changedIndex.groups.find((group) => group.id === planningArc.id),
    ).toMatchObject({ state: "stale", coverage: { chapterCount: 0 } });
    const indexCallsAfterEdit = fixture.calls.length;
    await openProjectTool(running.page, "质量报告");
    await running.page
      .locator("summary")
      .filter({ hasText: /^本地长篇来源索引$/u })
      .click();
    await indexPanel()
      .getByRole("button", {
        name: `索引章节 ${adoptedSecond.title}`,
        exact: true,
      })
      .click();
    await expect(
      indexPanel().locator("[data-index-summary-state]"),
    ).toHaveAttribute("data-index-summary-state", "stale");
    await expect(
      indexPanel().locator('[data-index-group="story-arc"]'),
    ).toContainText("范围已失效，未计覆盖");
    expect(fixture.calls).toHaveLength(indexCallsAfterEdit);
    expect(await readFile(savedPath, "utf8")).toBe(exported);
    // A selected-range JSON manuscript restores its actual format/range;
    // reopening never restores rights consent or silently exports the whole book.
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await cockpit
      .getByLabel("正文与章节采用", { exact: true })
      .getByRole("link", { name: "返回相关稿件与资料", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "输入输出", exact: true })
      .click();
    await running.page
      .getByRole("menuitem", { name: "导出投稿包数据", exact: true })
      .click();
    await manuscriptDialog()
      .getByRole("checkbox", {
        name: `${first.title} · v${first.version}`,
        exact: true,
      })
      .uncheck();
    await manuscriptDialog()
      .getByRole("button", { name: "生成稿件预览", exact: true })
      .click();
    await expect(manuscriptDialog()).toContainText("所选章节稿件");
    await expect(manuscriptDialog()).toContainText("JSON");
    await expect(confirmSave()).toBeDisabled();
    const jsonPage = await get<{
      items: Array<{
        id: string;
        status: string;
        manifest: {
          format: string;
          scope: string;
          chapters: Array<{ id: string; version: number }>;
        };
      }>;
    }>(`projects/${projectId}/manuscripts`);
    const jsonPreview = jsonPage.items.find(
      (item) =>
        item.status === "awaiting-confirmation" &&
        item.manifest.format === "json",
    )!;
    expect(jsonPreview.manifest.scope).toBe("selected-chapters");
    expect(jsonPreview.manifest.chapters.map((item) => item.id)).toEqual([
      second.id,
    ]);
    await manuscriptDialog()
      .getByRole("button", { name: "关闭稿件预览", exact: true })
      .click();
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await cockpit
      .getByRole("link", { name: "核对稿件交付", exact: true })
      .click();
    await expect(manuscriptDialog()).toContainText("JSON");
    await expect(rightsCheck()).not.toBeChecked();
    await manuscriptDialog()
      .getByRole("button", { name: "重新选择范围与生成预览", exact: true })
      .click();
    await expect(
      manuscriptDialog().getByRole("checkbox", {
        name: `${first.title} · v${first.version}`,
        exact: true,
      }),
    ).not.toBeChecked();
    await manuscriptDialog()
      .getByRole("button", { name: "生成稿件预览", exact: true })
      .click();
    await expect(manuscriptDialog()).toContainText("JSON");
    await expect(confirmSave()).toBeDisabled();
    const jsonPath = join(userData, "selected-novel-submission.json");
    await running.application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, jsonPath);
    await rightsCheck().check();
    await confirmSave().click();
    await expect(manuscriptDialog()).toContainText("稿件已保存并核验。");
    const selectedDocument = JSON.parse(await readFile(jsonPath, "utf8")) as {
      chapters: Array<{ id: string; content: string }>;
      resources?: unknown[];
    };
    expect(selectedDocument.chapters.map((item) => item.id)).toEqual([
      second.id,
    ]);
    expect(selectedDocument.chapters[0]!.content).toContain(
      "作者修订：小禾把铜钥匙留在柜台抽屉",
    );
    expect(selectedDocument.resources).toBeUndefined();
    await manuscriptDialog()
      .getByRole("button", { name: "关闭稿件预览", exact: true })
      .click();
    await openProjectTool(running.page, "项目驾驶舱");
    cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByLabel("稿件与投稿导出", { exact: true }),
    ).toContainText("所选范围已核验保存");
    await expect(
      cockpit.getByLabel("稿件与投稿导出", { exact: true }),
    ).toContainText("1/2");
    expect(fixture.calls).toHaveLength(completedCalls);
    for (const workflow of (await workflows()).filter((value) =>
      ["characters", "book-outline", "chapter"].includes(value.input.operation),
    )) {
      expect(workflow.authorIntent).toMatchObject({
        state: "adopted",
        id: adoptedIntent.id,
        version: adoptedIntent.version,
      });
      expect(workflow.sources).toContainEqual({
        kind: "author-intent",
        id: adoptedIntent.id,
        version: adoptedIntent.version,
      });
    }
    for (const call of fixture.calls.filter(
      (value) =>
        !value.prompt.includes("仅提取正文明确发生的事实") &&
        !value.prompt.includes("kind=narrative-summary"),
    )) {
      expect(call.prompt).toContain(
        `author_intent:${adoptedIntent.id}@${adoptedIntent.version}`,
      );
      expect(call.prompt).toContain(JSON.stringify(INTENT));
    }
    for (const call of fixture.calls.filter((value) =>
      value.prompt.includes("kind=narrative-summary"),
    )) {
      expect(call.prompt).not.toContain("author_intent:");
      expect(call.prompt).not.toContain(JSON.stringify(INTENT));
    }
    expect(
      fixture.calls.filter((call) => call.kind.startsWith("chapter-")),
    ).toHaveLength(2);
    await running.page.evaluate(() => {
      window.location.hash = "#/pending?category=attention";
    });
    const summaryAttention = running.page.locator(
      `[data-confirmation-key="narrative-summary:${savedSummary.id}"]`,
    );
    await expect(summaryAttention).toContainText("冻结摘要来源不可用，需复核");
    await expect(summaryAttention).not.toContainText(
      savedSummary.content.summary,
    );
    await summaryAttention
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(running.page).toHaveURL(
      new RegExp(
        `summaryId=${savedSummary.id}&summaryWorkflowId=${summaryWorkflow.id}`,
      ),
    );
    const summaryDetails = running.page.getByLabel("分层摘要详情", {
      exact: true,
    });
    await expect(summaryDetails.first()).toContainText(
      savedSummary.content.summary,
    );
    await expect(summaryDetails.first()).toContainText(
      "采用头已失效，保留历史",
    );
    await expect(summaryDetails).toHaveCount(1);
    await expect(
      running.page.getByRole("button", {
        name: "生成并检查卷／故事弧／全书摘要",
        exact: true,
      }),
    ).toHaveCount(0);
    await running.page.evaluate(
      ({ projectId, summaryId, workflowId }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?summaryId=${summaryId}&summaryWorkflowId=${workflowId}`;
      },
      { projectId, summaryId: savedSummary.id, workflowId: randomUUID() },
    );
    await expect(
      running.page.getByRole("alert").filter({ hasText: "指定摘要或工作流" }),
    ).toBeVisible();
    await expect(summaryDetails).toHaveCount(0);
    await expect(
      running.page.getByLabel("AI 卷／故事弧／全书摘要", { exact: true }),
    ).toHaveCount(0);
    await running.page.evaluate(
      ({ projectId, summaryId, workflowId }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?summaryId=${summaryId}&summaryWorkflowId=${workflowId}`;
      },
      { projectId, summaryId: savedSummary.id, workflowId: summaryWorkflow.id },
    );
    await expect(summaryDetails).toHaveCount(1);
    await expect(summaryDetails).toContainText(savedSummary.content.summary);
    await assertCurrentOriginalOwnerRead(
      running.page,
      `projects/${projectId}/narrative-summaries/${savedSummary.id}`,
      `#/projects/${projectId}/tools/quality-review?summaryId=${savedSummary.id}&summaryWorkflowId=${summaryWorkflow.id}`,
      () => summaryDetails,
      "summary-current-owner-failed-cache.png",
    );
    await running.page.screenshot({
      path: test.info().outputPath("summary-source-attention-exact.png"),
    });
    expect(await get<NarrativeSummary>(summaryPath)).toMatchObject({
      updatedAt: savedSummary.updatedAt,
      content: savedSummary.content,
      status: "adopted",
    });
    expect(fixture.calls).toHaveLength(completedCalls);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

for (const independentEpisode of [false, true]) {
  test(`已采用全书冻结范围摘要与原文段落明确混合续写下一章，候选和选择后台重启恢复且不夹带整章原文（受控模型接口）${independentEpisode ? "／单集独立重选实际输入" : ""}`, async () => {
    test.setTimeout(independentEpisode ? 240_000 : 180_000);
    const userData = await mkdtemp(
      join(tmpdir(), "dramaip-higher-novel-journey-"),
    );
    const fixture = await localModelFixture(true);
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      await running.application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, resolve("tests/fixtures/lm6/lm6-00/novel-higher-context.md"));
      await running.page.evaluate(() => {
        window.location.hash = "#/";
      });
      await running.page
        .getByRole("button", { name: "导入小说或大纲", exact: true })
        .click();
      await running.page
        .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
        .click();
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill("高层范围续写验收");
      await running.page
        .getByRole("button", { name: "选择文件", exact: true })
        .click();
      await running.page
        .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
        .check();
      await running.page
        .getByRole("button", { name: "创建系列长篇并导入", exact: true })
        .click();
      await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
      const projectId = running.page.url().split("/").at(-1)!;
      let get = await runtimeReader(running.page);
      const originals = await get<Chapter[]>(`projects/${projectId}/chapters`);
      expect(originals).toHaveLength(2);
      const first = originals[0]!,
        second = originals[1]!;
      expect(first.content).toContain(FIRST_FACT);
      expect(second.content).toContain(SECOND_FACT);
      await openProjectTool(running.page, "质量报告");
      await running.page
        .locator("summary")
        .filter({ hasText: /^本地长篇来源索引$/u })
        .click();
      const index = () =>
        running!.page.getByLabel("本地长篇来源索引", { exact: true });
      await index()
        .getByRole("button", { name: `索引章节 ${first.title}`, exact: true })
        .first()
        .click();
      await index()
        .getByRole("button", { name: "审阅生成本章派生记忆", exact: true })
        .click();
      const memory = index().getByLabel("AI 故事记忆", { exact: true });
      await memory
        .getByRole("button", { name: "生成并检查故事记忆", exact: true })
        .click();
      await expect(memory.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        { timeout: 20_000 },
      );
      await memory.getByRole("button", { name: "采用", exact: true }).click();
      const indexPath = `projects/${projectId}/narrative-context-index/chapters/`;
      await expect
        .poll(
          async () =>
            (await get<NarrativeIndexDetail>(indexPath + first.id)).summaries
              .length,
        )
        .toBe(1);
      const record = (await get<NarrativeIndexDetail>(indexPath + first.id))
        .summaries[0]!;
      await running.page
        .locator("summary")
        .filter({ hasText: /^本地长篇来源索引$/u })
        .click();
      await running.page
        .locator("summary")
        .filter({ hasText: /^卷／故事弧／全书派生摘要$/u })
        .click();
      const summaryPanel = () =>
        running!.page.getByLabel("分层摘要工作台", { exact: true });
      await summaryPanel()
        .getByLabel("实际摘要范围", { exact: true })
        .selectOption(`book:${projectId}`);
      const source = summaryPanel()
        .locator("fieldset")
        .filter({ hasText: first.title });
      await source
        .getByRole("button", { name: "读取此章已采用摘要", exact: true })
        .click();
      await source
        .getByLabel(`${first.title}摘要来源表达`, { exact: true })
        .selectOption(record.id);
      await summaryPanel()
        .getByRole("button", { name: "确认本轮摘要来源", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "确认分层摘要来源范围", exact: true })
        .getByRole("button", { name: "确认本轮摘要来源", exact: true })
        .click();
      const summaryWorkbench = summaryPanel().getByLabel(
        "AI 卷／故事弧／全书摘要",
        { exact: true },
      );
      await summaryWorkbench
        .getByRole("button", {
          name: "生成并检查卷／故事弧／全书摘要",
          exact: true,
        })
        .click();
      await expect(
        summaryWorkbench.locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 20_000 });
      await summaryWorkbench
        .getByRole("button", { name: "采用", exact: true })
        .click();
      const summariesPath = `projects/${projectId}/narrative-summaries`;
      await expect
        .poll(
          async () =>
            (await get<{ items: NarrativeSummary[] }>(summariesPath)).items[0]
              ?.isCurrent,
        )
        .toBe(true);
      const adopted = (await get<{ items: NarrativeSummary[] }>(summariesPath))
        .items[0]!;
      await running.page.evaluate((path) => {
        window.location.hash = path;
      }, `#/projects/${projectId}?chapterId=${second.id}`);
      const workbench = () =>
        running!.page.getByLabel("AI 本章正文", { exact: true });
      await workbench()
        .locator("summary")
        .filter({ hasText: "创作设置" })
        .click();
      await workbench()
        .getByRole("spinbutton", { name: "目标字数", exact: true })
        .fill("300");
      await workbench()
        .locator("summary")
        .filter({ hasText: "下一章来源范围" })
        .click();
      const next = () =>
        workbench().getByLabel("小说高层摘要来源", { exact: true });
      const beforeSelection = fixture.calls.length;
      await workbench()
        .getByLabel(`前文表达 ${second.title}`, { exact: true })
        .selectOption("none");
      await next()
        .getByRole("button", {
          name: "读取卷／故事弧／全书采用头",
          exact: true,
        })
        .click();
      const higher = next().getByRole("group", {
        name: "高层摘要来源 高层范围续写验收",
        exact: true,
      });
      await higher
        .getByRole("button", { name: "读取此摘要的冻结范围", exact: true })
        .click();
      await higher
        .getByLabel(`纳入高层摘要 ${adopted.id}`, { exact: true })
        .check();
      const firstSource = workbench().getByRole("group", {
        name: `前文来源 ${first.title}`,
        exact: true,
      });
      await firstSource
        .getByRole("button", { name: "读取此章摘要和段落", exact: true })
        .click();
      await firstSource
        .getByLabel(`前文表达 ${first.title}`, { exact: true })
        .selectOption("paragraphs");
      await firstSource
        .getByLabel(`上下文段落 ${first.title} 0`, { exact: true })
        .check();
      expect(fixture.calls).toHaveLength(beforeSelection);
      await next().scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("novel-higher-context-selection.png"),
      });
      // Fixture setup uses the real policy API from the test process, never a
      // business-route interception or Renderer fetch. The write itself stays
      // in Agents; the denied continuation still starts through the actual UI.
      const setSourcePolicy = async (version: number, deny: boolean) => {
        const bootstrap = await running!.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        );
        const response = await fetch(
          `${bootstrap.baseUrl}/api/v2/projects/${projectId}/agent-context-policies`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${bootstrap.accessToken}`,
              "Content-Type": "application/json",
              "If-Match": `"${version}"`,
            },
            body: JSON.stringify({
              version,
              policies: deny
                ? [
                    { fieldPath: `/knowledge/${record.id}`, mode: "never" },
                    {
                      fieldPath: `/narrative-summaries/${adopted.id}`,
                      mode: "always",
                    },
                  ]
                : [],
            }),
          },
        );
        expect(response.status, await response.clone().text()).toBe(200);
      };
      const beforeRejected = await get(
        `workflows/creation?projectId=${projectId}`,
      );
      const tasksBeforeRejected = await get("tasks");
      await setSourcePolicy(0, true);
      await workbench()
        .getByRole("button", { name: "续写下一章", exact: true })
        .click();
      await expect(
        running.page.getByText(
          /明确选择的小说原文、摘要或段落未完整纳入冻结上下文/u,
        ),
      ).toBeVisible();
      expect(await get(`projects/${projectId}/chapters`)).toEqual(originals);
      expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
        beforeRejected,
      );
      expect(await get("tasks")).toEqual(tasksBeforeRejected);
      expect(fixture.calls).toHaveLength(beforeSelection);
      expect(
        await get<NarrativeSummary>(`${summariesPath}/${adopted.id}`),
      ).toMatchObject({
        isCurrent: true,
        sourceState: "current",
        version: adopted.version,
        updatedAt: adopted.updatedAt,
      });
      await running.page.screenshot({
        path: test
          .info()
          .outputPath("novel-continuation-preflight-rejected.png"),
      });
      await setSourcePolicy(1, false);
      await workbench()
        .getByRole("button", { name: "续写下一章", exact: true })
        .click();
      await expect(
        workbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const chapters = await get<Chapter[]>(`projects/${projectId}/chapters`);
      expect(chapters).toHaveLength(3);
      const target = chapters.find(
        (chapter) => !originals.some((item) => item.id === chapter.id),
      )!;
      expect(target.content).toBe("");
      const workflow = (
        await get<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        )
      ).items.find(
        (item) =>
          item.input.operation === "chapter" &&
          item.input.targetId === target.id,
      )!;
      expect(workflow.narrativeContextBasis?.summaries).toMatchObject([
        {
          id: adopted.id,
          version: adopted.version,
          scopeState: "stale",
          chapters: originals.map(({ id, version }) => ({ id, version })),
        },
      ]);
      expect(workflow.narrativeContextBasis?.chapters).toMatchObject([
        { id: first.id, representation: "paragraphs" },
      ]);
      expect(workflow.narrativeContextBasis?.omitted).toEqual([]);
      const generated = fixture.calls.filter(
        (call) => call.kind === "chapter-higher-context",
      );
      expect(generated).toHaveLength(1);
      expect(generated[0]!.prompt).toContain(adopted.content.summary);
      expect(generated[0]!.prompt).not.toContain(JSON.stringify(first.content));
      expect(generated[0]!.prompt).not.toContain(
        JSON.stringify(second.content),
      );
      const selectedKey = `dramaip-novel-context:${projectId}:${second.id}:next`;
      const readSelection = () =>
        running!.page.evaluate(
          (key) => window.localStorage.getItem(key),
          selectedKey,
        );
      const savedSelection = await readSelection();
      expect(JSON.parse(savedSelection!).summaries).toEqual([
        { id: adopted.id, version: adopted.version },
      ]);
      expect(savedSelection).not.toContain(adopted.content.summary);
      const callsBeforeRestart = fixture.calls.length;
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      expect(await readSelection()).toBe(savedSelection);
      await running.page.evaluate((path) => {
        window.location.hash = path;
      }, `#/projects/${projectId}?chapterId=${target.id}&workflowId=${workflow.id}`);
      await expect(
        workbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用");
      expect(
        (await get<CreationWorkflow>(`workflows/creation/${workflow.id}`))
          .narrativeContextBasis,
      ).toEqual(workflow.narrativeContextBasis);
      expect(fixture.calls).toHaveLength(callsBeforeRestart);
      const enginesBeforeAdoption = await get("agent-engines");
      await workbench()
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await expect
        .poll(async () => (await get<Chapter>(`chapters/${target.id}`)).content)
        .toBe(THIRD_TEXT);
      await expect
        .poll(
          async () =>
            (await get<CreationWorkflow>(`workflows/creation/${workflow.id}`))
              .memoryState,
          { timeout: 20_000 },
        )
        .toMatch(/^(synced|failed|review-required)$/u);
      const finalWorkflow = await get<CreationWorkflow>(
        `workflows/creation/${workflow.id}`,
      );
      expect(
        finalWorkflow.memoryState,
        JSON.stringify({
          memoryError: finalWorkflow.memoryError,
          engineKind: finalWorkflow.input.engineKind,
          enginesBeforeAdoption,
          fixtureErrors: fixture.errors,
          calls: fixture.calls.map((call) => call.kind),
        }),
      ).toBe("synced");
      for (const original of originals)
        expect(await get<Chapter>(`chapters/${original.id}`)).toEqual(original);
      expect(
        await get<NarrativeSummary>(`${summariesPath}/${adopted.id}`),
      ).toMatchObject({
        isCurrent: false,
        sourceState: "stale",
        contextEligibility: { state: "eligible" },
        content: adopted.content,
        version: adopted.version,
        updatedAt: adopted.updatedAt,
      });
      // The same exact adopted range is explicitly selected for a quality report;
      // no model or business route is intercepted and originals stay unchanged.
      await openProjectTool(running.page, "质量报告");
      const qualityPanel = () =>
        running!.page.getByLabel("版本绑定质量报告工作台", { exact: true });
      const qualityWorkbench = () =>
        qualityPanel().getByLabel("AI 版本绑定的质量报告", { exact: true });
      await qualityPanel()
        .getByLabel("质量检查目标", { exact: true })
        .selectOption(`chapter-set:${projectId}`);
      for (const chapter of originals)
        await qualityPanel()
          .getByLabel(`质量范围章节 ${chapter.title}`, { exact: true })
          .check();
      await qualityPanel()
        .getByLabel("质量评议使用明确混合表达", { exact: true })
        .check();
      const qualitySources = () =>
        qualityPanel()
          .locator("details")
          .filter({
            has: running!.page
              .locator("summary")
              .filter({ hasText: /^质量评议实际表达/u }),
          })
          .first();
      await qualityPanel()
        .locator("summary")
        .filter({ hasText: /^质量评议实际表达/u })
        .click();
      const direct = qualitySources().getByLabel(`前文来源 ${first.title}`, {
        exact: true,
      });
      await direct
        .getByRole("button", { name: "读取此章摘要和段落", exact: true })
        .click();
      await expect(
        direct
          .getByLabel(`前文表达 ${first.title}`, { exact: true })
          .locator('option[value="paragraphs"]'),
      ).toBeEnabled();
      await direct
        .getByLabel(`前文表达 ${first.title}`, { exact: true })
        .selectOption("paragraphs");
      const firstParagraph = (
        await get<NarrativeIndexDetail>(indexPath + first.id)
      ).paragraphs[0]!;
      await direct
        .getByLabel(`上下文段落 ${first.title} ${firstParagraph.start}`, {
          exact: true,
        })
        .check();
      await qualitySources()
        .getByRole("button", {
          name: "读取卷／故事弧／全书采用头",
          exact: true,
        })
        .click();
      await qualitySources()
        .getByRole("button", { name: "读取此摘要的冻结范围", exact: true })
        .click();
      await expect(
        qualitySources().getByLabel(`纳入高层摘要 ${adopted.id}`, {
          exact: true,
        }),
      ).toBeEnabled();
      await qualitySources()
        .getByLabel(`纳入高层摘要 ${adopted.id}`, { exact: true })
        .check();
      await qualityPanel()
        .getByRole("button", { name: "确认本轮质量基准", exact: true })
        .click();
      const qualityKey = `dramaip-quality-scope:${projectId}`;
      const savedQuality = await running.page.evaluate(
        (key) => window.localStorage.getItem(key),
        qualityKey,
      );
      expect(JSON.parse(savedQuality!).context.summaries).toEqual([
        { id: adopted.id, version: adopted.version },
      ]);
      expect(savedQuality).not.toContain(adopted.content.summary);
      const beforeQualityReject = await get(
        `workflows/creation?projectId=${projectId}`,
      );
      const beforeQualityTasks = await get("tasks");
      const beforeQualityChapters = await get(`projects/${projectId}/chapters`);
      const beforeQualityCalls = fixture.calls.length;
      await setSourcePolicy(2, true);
      await qualityWorkbench()
        .getByRole("button", {
          name: "生成并检查版本绑定的质量报告",
          exact: true,
        })
        .click();
      await expect(
        qualityPanel().getByText(
          /质量评议的目标、作者意图或可信知识未完整纳入冻结上下文/u,
        ),
      ).toBeVisible();
      expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
        beforeQualityReject,
      );
      expect(await get("tasks")).toEqual(beforeQualityTasks);
      expect(await get(`projects/${projectId}/chapters`)).toEqual(
        beforeQualityChapters,
      );
      expect(fixture.calls).toHaveLength(beforeQualityCalls);
      await setSourcePolicy(3, false);
      await qualityWorkbench()
        .getByRole("button", {
          name: "生成并检查版本绑定的质量报告",
          exact: true,
        })
        .click();
      await expect(
        qualityWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const qualityRun = (
        await get<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        )
      ).items.find((item) => item.input.operation === "quality-review")!;
      const qualityReport = await get<NarrativeQualityReport>(
        `narrative-quality-reports/${qualityRun.narrativeReportId}`,
      );
      expect(qualityReport.basis.chapterCoverage?.included).toMatchObject([
        {
          id: first.id,
          representations: ["paragraphs", "hierarchical-summary"],
        },
        { id: second.id, representations: ["hierarchical-summary"] },
      ]);
      expect(qualityReport.content.reviewedSources).toHaveLength(2);
      const qualityCalls = fixture.calls.filter(
        (call) => call.kind === "quality-review",
      );
      expect(qualityCalls).toHaveLength(1);
      expect(qualityCalls[0]!.prompt).not.toContain(
        JSON.stringify(second.content),
      );
      expect(qualityCalls[0]!.prompt).not.toContain(
        JSON.stringify(first.content),
      );
      const frozenQualityCard = () =>
        qualityPanel()
          .locator(`[data-narrative-report-id="${qualityReport.id}"]`)
          .getByLabel("质量评议原参考内容表达", { exact: true });
      await expect(frozenQualityCard()).toBeVisible();
      const originalReferences = qualityReport.basis.sourceBasis!.references;
      expect(originalReferences).toHaveLength(2);
      await frozenQualityCard()
        .locator("[data-frozen-narrative-references] > summary")
        .click();
      for (const reference of originalReferences) {
        await expect(frozenQualityCard()).toContainText(reference.sourceId);
        await expect(frozenQualityCard()).toContainText(reference.fieldPath);
        await expect(frozenQualityCard()).toContainText(reference.contentHash);
      }
      await expect(frozenQualityCard()).toContainText(
        "不读取最新正文、改选来源或证明模型已经理解",
      );
      await frozenQualityCard().screenshot({
        path: test
          .info()
          .outputPath("mixed-quality-frozen-reference-identities.png"),
      });
      await qualityPanel()
        .getByLabel("质量报告实际章节覆盖", { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(qualityPanel()).toContainText("不是全文评议");
      await running.page.screenshot({
        path: test.info().outputPath("mixed-quality-actual-coverage.png"),
      });
      const qualityLocation = new URL(running.page.url()).hash;
      const qualityCallsBeforeRestart = fixture.calls.length;
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await running.page.evaluate((hash) => {
        window.location.hash = hash;
      }, qualityLocation);
      await expect(
        qualityPanel().locator(
          `[data-narrative-report-id="${qualityReport.id}"]`,
        ),
      ).toBeVisible();
      expect(
        await get(`narrative-quality-reports/${qualityReport.id}`),
      ).toEqual(qualityReport);
      expect(
        await running.page.evaluate(
          (key) => window.localStorage.getItem(key),
          qualityKey,
        ),
      ).toBe(savedQuality);
      expect(fixture.calls).toHaveLength(qualityCallsBeforeRestart);
      await expect(frozenQualityCard()).toBeVisible();
      for (const reference of originalReferences) {
        await expect(frozenQualityCard()).toContainText(reference.sourceId);
        await expect(frozenQualityCard()).toContainText(reference.fieldPath);
        await expect(frozenQualityCard()).toContainText(reference.contentHash);
      }
      await qualityPanel()
        .getByRole("button", { name: "采用此质量报告", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用质量报告", exact: true })
        .getByRole("button", { name: "确认采用报告", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              await get<NarrativeQualityReport>(
                `narrative-quality-reports/${qualityReport.id}`,
              )
            ).status,
        )
        .toBe("adopted");
      expect(await get(`projects/${projectId}/chapters`)).toEqual(
        beforeQualityChapters,
      );
      // AI intent is another independent operation. Explicit expressions reuse
      // the selected original scope; this candidate is not adopted as author intent.
      await running.page.evaluate((id) => {
        window.location.hash = `#/projects/${id}/tools/author-intent`;
      }, projectId);
      const aiIntent = () =>
        running!.page.getByLabel("AI 作者意图候选", { exact: true });
      for (const source of [first, second])
        await aiIntent()
          .getByLabel(`意图来源：${source.title}`, { exact: true })
          .check();
      await aiIntent()
        .getByLabel("AI 意图使用明确混合表达", { exact: true })
        .check();
      const aiExpressions = () =>
        aiIntent().getByLabel("AI 意图明确来源表达", { exact: true });
      await expect(
        aiExpressions()
          .locator("summary")
          .filter({ hasText: /^AI 意图来源表达/u }),
      ).toBeVisible();
      await aiExpressions()
        .locator("summary")
        .filter({ hasText: /^AI 意图来源表达/u })
        .click();
      const aiDirect = aiExpressions().getByLabel(`前文来源 ${first.title}`, {
        exact: true,
      });
      await aiDirect
        .getByRole("button", { name: "读取此章摘要和段落", exact: true })
        .click();
      await expect(
        aiDirect
          .getByLabel(`前文表达 ${first.title}`, { exact: true })
          .locator('option[value="paragraphs"]'),
      ).toBeEnabled();
      await aiDirect
        .getByLabel(`前文表达 ${first.title}`, { exact: true })
        .selectOption("paragraphs");
      await aiDirect
        .getByLabel(`上下文段落 ${first.title} ${firstParagraph.start}`, {
          exact: true,
        })
        .check();
      await aiExpressions()
        .getByRole("button", {
          name: "读取卷／故事弧／全书采用头",
          exact: true,
        })
        .click();
      await aiExpressions()
        .getByRole("button", { name: "读取此摘要的冻结范围", exact: true })
        .click();
      await expect(
        aiExpressions().getByLabel(`纳入高层摘要 ${adopted.id}`, {
          exact: true,
        }),
      ).toBeEnabled();
      await aiExpressions()
        .getByLabel(`纳入高层摘要 ${adopted.id}`, { exact: true })
        .check();
      const beforeAiIntentCalls = fixture.calls.length;
      await aiIntent()
        .getByRole("button", { name: "确认 AI 意图来源", exact: true })
        .click();
      await expect(aiIntent()).toContainText(
        "实际表达另行冻结，不代表全文已读",
      );
      await aiIntent()
        .getByRole("button", { name: "生成并检查作者意图建议", exact: true })
        .click();
      await expect(
        aiIntent().getByRole("link", {
          name: "比较并确认此 AI 意图草稿",
          exact: true,
        }),
      ).toBeVisible({ timeout: 25_000 });
      const aiRun = (
        await get<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        )
      ).items.find((item) => item.input.operation === "author-intent")!;
      expect(aiRun.stage).toBe("awaiting-review");
      expect(aiRun.input.authorIntentRequest!.context).toEqual(
        JSON.parse(savedQuality!).context,
      );
      expect(aiRun.authorIntentBasis!.request).toEqual(
        aiRun.input.authorIntentRequest,
      );
      expect(aiRun.authorIntentBasis!.chapters!.map((item) => item.id)).toEqual(
        [first.id, second.id],
      );
      expect(aiRun.authorIntentBasis!.sourceBasis!.references).toEqual(
        originalReferences,
      );
      const intentPrompts = fixture.calls.slice(beforeAiIntentCalls);
      expect(intentPrompts).toHaveLength(2);
      expect(
        intentPrompts.filter((call) => call.kind === "author-intent"),
      ).toHaveLength(1);
      for (const call of intentPrompts) {
        expect(call.prompt).not.toContain(JSON.stringify(first.content));
        expect(call.prompt).not.toContain(JSON.stringify(second.content));
      }
      const aiCard = () =>
        aiIntent().getByLabel("AI 意图原参考内容表达", { exact: true });
      await aiIntent()
        .locator("summary")
        .filter({ hasText: /^引用资料 · \d+ 项$/u })
        .click();
      await expect(aiCard()).toBeVisible();
      await aiCard()
        .locator("[data-frozen-narrative-references] > summary")
        .click();
      for (const reference of originalReferences) {
        await expect(aiCard()).toContainText(reference.sourceId);
        await expect(aiCard()).toContainText(reference.fieldPath);
        await expect(aiCard()).toContainText(reference.contentHash);
      }
      await aiCard().screenshot({
        path: test
          .info()
          .outputPath("ai-intent-mixed-frozen-reference-identities.png"),
      });
      const aiLocation = new URL(running.page.url()).hash;
      const aiOriginal = await get(`author-intents/${aiRun.authorIntentId}`);
      const aiModelCalls = fixture.calls.length;
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await running.page.evaluate((hash) => {
        window.location.hash = hash;
      }, aiLocation);
      await aiIntent()
        .locator("summary")
        .filter({ hasText: /^引用资料 · \d+ 项$/u })
        .click();
      await expect(aiCard()).toBeVisible();
      await aiCard()
        .locator("[data-frozen-narrative-references] > summary")
        .click();
      expect(await get(`workflows/creation/${aiRun.id}`)).toEqual(aiRun);
      expect(await get(`author-intents/${aiRun.authorIntentId}`)).toEqual(
        aiOriginal,
      );
      for (const reference of originalReferences) {
        await expect(aiCard()).toContainText(reference.sourceId);
        await expect(aiCard()).toContainText(reference.fieldPath);
        await expect(aiCard()).toContainText(reference.contentHash);
      }
      expect(fixture.calls).toHaveLength(aiModelCalls);
      expect(await get(`projects/${projectId}/chapters`)).toEqual(
        beforeQualityChapters,
      );
      // This remains a separate, explicitly authorized adaptation path. The
      // novel's existing quality report cannot silently create a diagnosis.
      await adoptIntentInUi(running.page, INTENT);
      await openProjectTool(running.page, "改编诊断");
      const diagnosisPanel = () =>
        running!.page.getByLabel("改编诊断工作台", { exact: true });
      const diagnosisWorkbench = () =>
        diagnosisPanel().getByLabel("AI 改编诊断", { exact: true });
      await diagnosisPanel()
        .getByLabel(`诊断来源 ${first.title}`, { exact: true })
        .check();
      await diagnosisPanel()
        .getByLabel(`诊断来源 ${second.title}`, { exact: true })
        .check();
      await diagnosisPanel()
        .getByLabel("诊断使用明确混合表达", { exact: true })
        .check();
      await diagnosisPanel()
        .locator("summary")
        .filter({ hasText: /^诊断实际表达/u })
        .click();
      const diagnosisSources = () =>
        diagnosisPanel()
          .locator("details")
          .filter({
            has: running!.page
              .locator("summary")
              .filter({ hasText: /^诊断实际表达/u }),
          })
          .first();
      const diagnosisDirect = diagnosisSources().getByLabel(
        `前文来源 ${first.title}`,
        { exact: true },
      );
      await diagnosisDirect
        .getByRole("button", { name: "读取此章摘要和段落", exact: true })
        .click();
      await expect(
        diagnosisDirect
          .getByLabel(`前文表达 ${first.title}`, { exact: true })
          .locator('option[value="paragraphs"]'),
      ).toBeEnabled();
      await diagnosisDirect
        .getByLabel(`前文表达 ${first.title}`, { exact: true })
        .selectOption("paragraphs");
      await diagnosisDirect
        .getByLabel(`上下文段落 ${first.title} ${firstParagraph.start}`, {
          exact: true,
        })
        .check();
      await diagnosisSources()
        .getByRole("button", {
          name: "读取卷／故事弧／全书采用头",
          exact: true,
        })
        .click();
      await diagnosisSources()
        .getByRole("button", { name: "读取此摘要的冻结范围", exact: true })
        .click();
      await expect(
        diagnosisSources().getByLabel(`纳入高层摘要 ${adopted.id}`, {
          exact: true,
        }),
      ).toBeEnabled();
      await diagnosisSources()
        .getByLabel(`纳入高层摘要 ${adopted.id}`, { exact: true })
        .check();
      await diagnosisPanel()
        .getByLabel("诊断来源权利声明", { exact: true })
        .check();
      await diagnosisPanel()
        .getByLabel("诊断目标集数", { exact: true })
        .fill("2");
      await diagnosisPanel()
        .getByRole("button", { name: "确认本轮来源与版本", exact: true })
        .click();
      const diagnosisKey = `dramaip-diagnosis-scope:${projectId}`;
      const savedDiagnosis = await running.page.evaluate(
        (key) => window.localStorage.getItem(key),
        diagnosisKey,
      );
      expect(JSON.parse(savedDiagnosis!).context).toEqual(
        JSON.parse(savedQuality!).context,
      );
      expect(savedDiagnosis).not.toContain(adopted.content.summary);
      const beforeDiagnosisReject = await get(
        `workflows/creation?projectId=${projectId}`,
      );
      const tasksBeforeDiagnosis = await get("tasks");
      const callsBeforeDiagnosis = fixture.calls.length;
      await setSourcePolicy(4, true);
      await diagnosisWorkbench()
        .getByRole("button", { name: "生成并检查改编诊断", exact: true })
        .click();
      await expect(
        diagnosisPanel().getByText(
          /诊断／季纲的明确混合表达未完整纳入冻结上下文/u,
        ),
      ).toBeVisible();
      expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
        beforeDiagnosisReject,
      );
      expect(await get("tasks")).toEqual(tasksBeforeDiagnosis);
      expect(fixture.calls).toHaveLength(callsBeforeDiagnosis);
      await setSourcePolicy(5, false);
      await diagnosisWorkbench()
        .getByRole("button", { name: "生成并检查改编诊断", exact: true })
        .click();
      await expect(
        diagnosisWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const diagnostic = (
        await get<{ items: AdaptationDiagnosis[] }>(
          `projects/${projectId}/diagnoses`,
        )
      ).items[0]!;
      expect(diagnostic).toMatchObject({
        status: "pending",
        sourceState: "current",
        basis: {
          sourceBasis: {
            summaries: [{ id: adopted.id, version: adopted.version }],
          },
        },
      });
      expect(diagnostic.content.reviewedSources).toHaveLength(2);
      await diagnosisPanel()
        .getByLabel("诊断实际来源表达", { exact: true })
        .scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("mixed-diagnosis-actual-expressions.png"),
      });
      await diagnosisPanel()
        .locator("summary")
        .filter({ hasText: "旧诊断内策略（旧版流程）" })
        .click();
      await diagnosisPanel()
        .getByRole("radio", { name: "选择策略 忠实人物弧", exact: true })
        .check();
      await diagnosisPanel()
        .getByRole("button", { name: "采用选定策略与诊断", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用诊断与选定策略", exact: true })
        .getByRole("button", { name: "确认采用选定策略", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await get<AdaptationDiagnosis>(`diagnoses/${diagnostic.id}`))
              .status,
        )
        .toBe("adopted");
      await diagnosisPanel()
        .getByRole("link", {
          name: "兼容：从诊断内策略继续整季方案 →",
          exact: true,
        })
        .click();
      const seasonPanel = () =>
        running!.page.getByLabel("整季方案工作台", { exact: true });
      const seasonWorkbench = () =>
        seasonPanel().getByLabel("AI 整季分集方案", { exact: true });
      await seasonPanel()
        .getByRole("button", { name: "确认本轮季纲基准", exact: true })
        .click();
      const beforeSeasonReject = await get(
        `workflows/creation?projectId=${projectId}`,
      );
      const callsBeforeSeason = fixture.calls.length;
      await setSourcePolicy(6, true);
      await seasonWorkbench()
        .getByRole("button", { name: "生成并检查整季分集方案", exact: true })
        .click();
      await expect(
        seasonPanel().getByText(
          /诊断／季纲的明确混合表达未完整纳入冻结上下文/u,
        ),
      ).toBeVisible();
      expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
        beforeSeasonReject,
      );
      expect(fixture.calls).toHaveLength(callsBeforeSeason);
      await setSourcePolicy(7, false);
      await seasonWorkbench()
        .getByRole("button", { name: "生成并检查整季分集方案", exact: true })
        .click();
      await expect(
        seasonWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const season = (
        await get<{ items: SeasonPlan[] }>(`projects/${projectId}/season-plans`)
      ).items[0]!;
      expect(season.basis.sourceBasis).toEqual(diagnostic.basis.sourceBasis);
      expect(season.content.reviewedSources).toEqual(
        diagnostic.content.reviewedSources,
      );
      expect(season.coverage.map((item) => item.chapterId)).toEqual([
        first.id,
        second.id,
      ]);
      for (const call of fixture.calls.filter(
        (call) =>
          call.kind === "adaptation-diagnosis" || call.kind === "season-plan",
      )) {
        expect(call.prompt).not.toContain(JSON.stringify(first.content));
        expect(call.prompt).not.toContain(JSON.stringify(second.content));
        expect(call.prompt).toContain(adopted.content.summary);
      }
      await seasonPanel()
        .getByLabel("季纲继承的实际来源表达", { exact: true })
        .scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("mixed-season-inherited-expressions.png"),
      });
      const seasonKey = `dramaip-season-plan-basis:${projectId}`;
      const savedSeason = await running.page.evaluate(
        (key) => window.localStorage.getItem(key),
        seasonKey,
      );
      const seasonLocation = new URL(running.page.url()).hash;
      const callsBeforeMixedRestart = fixture.calls.length;
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await running.page.evaluate((hash) => {
        window.location.hash = hash;
      }, seasonLocation);
      await expect(
        seasonPanel().getByLabel(`整季方案 v${season.version}`, {
          exact: true,
        }),
      ).toBeVisible();
      expect(await get(`season-plans/${season.id}`)).toEqual(season);
      expect(
        await running.page.evaluate(
          (key) => window.localStorage.getItem(key),
          diagnosisKey,
        ),
      ).toBe(savedDiagnosis);
      expect(
        await running.page.evaluate(
          (key) => window.localStorage.getItem(key),
          seasonKey,
        ),
      ).toBe(savedSeason);
      expect(fixture.calls).toHaveLength(callsBeforeMixedRestart);
      await seasonPanel()
        .getByRole("button", { name: "采用这个整季方案", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用这个整季方案？", exact: true })
        .getByRole("button", { name: "明确采用方案", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await get<SeasonPlan>(`season-plans/${season.id}`)).status,
        )
        .toBe("adopted");
      expect(await get(`projects/${projectId}/chapters`)).toEqual(
        beforeQualityChapters,
      );
      for (const kind of [
        "adaptations",
        "episodes",
        "scripts",
        "scenes",
        "shots",
        "visual-assets",
      ])
        expect(await get(`${kind}?projectId=${projectId}`)).toEqual([]);
      // Continue the actual mixed plan through the native formal development UI.
      // The whole frozen two-chapter expression is explicitly confirmed; the
      // first episode's mapping still contains only its one assigned chapter.
      await openProjectTool(running.page, "单集开发");
      const developmentPanel = () =>
        running!.page.getByLabel("单集开发工作台", { exact: true });
      await expect(
        developmentPanel().getByLabel("单集实际表达确认", { exact: true }),
      ).toContainText("本集映射 1 章");
      await expect(
        developmentPanel().getByLabel("单集实际表达确认", { exact: true }),
      ).toContainText("整季已确认范围 2 章");
      const bibleWorkbench = developmentPanel().getByLabel("AI Story Bible", {
        exact: true,
      });
      await bibleWorkbench
        .getByRole("button", { name: "生成并检查Story Bible", exact: true })
        .click();
      await expect(
        bibleWorkbench.locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await bibleWorkbench
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await expect(developmentPanel()).toContainText(
        "已批准 Story Bible：1 份",
      );
      const callsBeforeEpisodes = fixture.calls.length;
      const episodeSelection = {
        format: "narrative-context-v1" as const,
        chapters: [
          {
            id: first.id,
            version: first.version,
            representation: "paragraphs" as const,
            paragraphIds: [firstParagraph.id],
          },
        ],
      };
      if (independentEpisode) {
        await developmentPanel()
          .getByLabel("本集实际输入方式", { exact: true })
          .selectOption("episode");
        await developmentPanel()
          .locator("summary")
          .filter({ hasText: /^本集独立实际表达/u })
          .click();
        const picker = developmentPanel().getByRole("group", {
          name: `前文来源 ${first.title}`,
          exact: true,
        });
        await expect(
          picker.getByLabel(`前文表达 ${first.title}`, { exact: true }),
        ).toHaveValue("none");
        await picker
          .getByRole("button", { name: "读取此章摘要和段落", exact: true })
          .click();
        await expect(
          picker
            .getByLabel(`前文表达 ${first.title}`, { exact: true })
            .locator('option[value="paragraphs"]'),
        ).toBeEnabled();
        await picker
          .getByLabel(`前文表达 ${first.title}`, { exact: true })
          .selectOption("paragraphs");
        await picker
          .getByLabel(`上下文段落 ${first.title} ${firstParagraph.start}`, {
            exact: true,
          })
          .check();
        const failedRoute = `**/api/v2/projects/${projectId}/chapters`;
        let readsFailed = 0;
        await running.page.route(failedRoute, async (route) => {
          readsFailed++;
          await route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Service Unavailable",
              status: 503,
              detail: "Controlled independent episode scope read failed",
            }),
          });
        });
        await developmentPanel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        await expect(
          developmentPanel().getByText(
            "本集独立来源读取失败，旧选择尚未重新核对；不能确认基准。",
            { exact: true },
          ),
        ).toBeVisible({ timeout: 25_000 });
        expect(readsFailed).toBeGreaterThan(0);
        await expect(
          developmentPanel().getByLabel("AI 单集大纲", { exact: true }),
        ).toHaveCount(0);
        await running.page.unroute(failedRoute);
      }
      await developmentPanel()
        .getByRole("button", { name: "确认本轮单集基准", exact: true })
        .click();
      const beforeEpisodeReject = await get(
        `workflows/creation?projectId=${projectId}`,
      );
      await setSourcePolicy(8, true);
      await developmentPanel()
        .getByLabel("AI 单集大纲", { exact: true })
        .getByRole("button", { name: "生成并检查单集大纲", exact: true })
        .click();
      await expect(
        developmentPanel().getByText(
          independentEpisode
            ? /正式单集故事来源.*未完整纳入上下文/u
            : /单集的明确混合表达未完整纳入冻结上下文/u,
        ),
      ).toBeVisible();
      expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
        beforeEpisodeReject,
      );
      expect(fixture.calls).toHaveLength(callsBeforeEpisodes);
      await setSourcePolicy(9, false);
      const formal: EpisodeDevelopmentResult[] = [];
      for (const stage of [
        {
          tab: "单集大纲",
          workbench: "AI 单集大纲",
          generate: "生成并检查单集大纲",
          dialog: "明确采用单集大纲？",
          result: "正式单集大纲 v1",
          operation: "episode-outline",
        },
        {
          tab: "标准剧本",
          workbench: "AI 单集标准剧本",
          generate: "生成并检查单集标准剧本",
          dialog: "明确采用标准剧本？",
          result: "正式标准剧本 v1",
          operation: "episode-script",
        },
        {
          tab: "分镜包",
          workbench: "AI 单集分镜包",
          generate: "生成并检查单集分镜包",
          dialog: "明确采用单集分镜包？",
          result: "正式分镜包 v1",
          operation: "storyboard-package",
        },
      ]) {
        await developmentPanel()
          .getByRole("button", { name: stage.tab, exact: true })
          .click();
        await developmentPanel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const workbench = developmentPanel().getByLabel(stage.workbench, {
          exact: true,
        });
        await workbench
          .getByRole("button", { name: stage.generate, exact: true })
          .click();
        await expect(
          workbench.locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用", { timeout: 25_000 });
        const workflows = await get<{
          items: import("@dramaip/contracts/creation").CreationWorkflow[];
        }>(`workflows/creation?projectId=${projectId}`);
        const workflow = workflows.items.find(
          (item) => item.input.operation === stage.operation,
        )!;
        if (independentEpisode) {
          expect(
            workflow.episodeDevelopmentBasis?.sourceBasis?.chapters,
          ).toEqual([season.basis.sourceBasis!.chapters[0]]);
          expect(
            workflow.episodeDevelopmentBasis?.sourceBasis?.omitted,
          ).toEqual([
            { id: second.id, version: second.version, reason: "not-selected" },
          ]);
          expect(
            workflow.input.episodeDevelopmentRequest?.episodeNarrativeContext,
          ).toEqual(episodeSelection);
        } else
          expect(workflow.episodeDevelopmentBasis?.sourceBasis).toEqual(
            season.basis.sourceBasis,
          );
        expect(workflow.episodeDevelopmentBasis?.chapters).toHaveLength(1);
        expect(workflow.episodeDevelopmentBasis?.contextChapters).toHaveLength(
          independentEpisode ? 1 : 2,
        );
        expect(
          workflow.input.episodeDevelopmentRequest?.inheritSeasonNarrative,
        ).toBe(independentEpisode ? undefined : true);
        await workbench
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: stage.dialog, exact: true })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          developmentPanel().getByLabel(stage.result, { exact: true }),
        ).toBeVisible();
        const results = await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        );
        const result = results.items.find(
          (item) => item.operation === stage.operation,
        )!;
        expect(result.sourceState).toBe("current");
        expect(result.basis.sourceBasis).toEqual(
          workflow.episodeDevelopmentBasis?.sourceBasis,
        );
        formal.push(result);
        await expect(
          developmentPanel().getByLabel(stage.result, { exact: true }),
        ).toContainText(
          new RegExp(
            `本集映射 1 章；实际冻结输入表达\\s*${independentEpisode ? 1 : 2} 章`,
            "u",
          ),
        );
        await expect(
          developmentPanel().getByLabel(stage.result, { exact: true }),
        ).not.toContainText("实际冻结整季表达");
        if (stage.operation === "episode-outline") {
          const actualOutline = developmentPanel().getByLabel(stage.result, {
            exact: true,
          });
          await actualOutline.screenshot({
            path: test.info().outputPath("formal-episode-input-expression.png"),
          });
          await actualOutline
            .locator("summary")
            .filter({ hasText: /^场景 1 ·/u })
            .click();
          const quotes = actualOutline
            .getByLabel("逐场实际引文", { exact: true })
            .first();
          await expect(quotes).toBeVisible();
          await expect(quotes).toContainText("模型声明关联");
          await expect(quotes).toContainText(
            "PRIVATE MODEL DECLARED SCENE ATTRIBUTION",
          );
          await quotes.locator("details").first().locator("summary").click();
          await expect(quotes).toContainText("表达 [");
          if (!independentEpisode)
            await quotes.locator("details").last().locator("summary").click();
          await expect(quotes.getByText(/^实际段落 /u)).toBeVisible();
          await expect(quotes.getByText(/；原章节 \[/u).first()).toBeVisible();
          await quotes.scrollIntoViewIfNeeded();
          await running.page.screenshot({
            path: test
              .info()
              .outputPath("actual-scene-quotes-and-positions.png"),
          });
          expect(
            await running.page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
          ).toBe(true);
        }
      }
      for (const call of fixture.calls.slice(callsBeforeEpisodes)) {
        if (independentEpisode)
          expect(call.prompt).toContain("明确独立重选本集实际表达");
        else expect(call.prompt).toContain(adopted.content.summary);
        expect(call.prompt).not.toContain(JSON.stringify(first.content));
        expect(call.prompt).not.toContain(JSON.stringify(second.content));
      }
      expect(await get(`projects/${projectId}/chapters`)).toEqual(
        beforeQualityChapters,
      );
      await developmentPanel()
        .getByLabel("单集实际表达确认", { exact: true })
        .scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("mixed-episode-input-versus-mapping.png"),
      });
      const pilotPath = join(userData, "actual-mixed-input-evidence.zip");
      await running.application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, pilotPath);
      await developmentPanel()
        .getByLabel("正式分镜包 v1", { exact: true })
        .getByRole("button", { name: "预览内部试制包", exact: true })
        .click();
      const pilotDialog = () =>
        running!.page.getByRole("dialog", {
          name: "核验并保存内部试制包",
          exact: true,
        });
      const workflowChoice = pilotDialog().getByLabel(
        "明确附所选三正式阶段的原工作流脱敏谱系（不含指令、正文或 AI 草稿；缺失保留未知，人工确认不当新模型运行）",
        { exact: true },
      );
      await expect(workflowChoice).not.toBeChecked();
      const callsBeforeWorkflowChoice = fixture.calls.length;
      await workflowChoice.check();
      expect(fixture.calls).toHaveLength(callsBeforeWorkflowChoice);
      await pilotDialog()
        .getByRole("button", { name: "生成统一试制包预览", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("待明确确认");
      for (const name of [
        "我确认这些正式版本，并有权导出这份试制包",
        "我确认此包仅用于内部试制审阅，不作为发行就绪证明",
        "我已知悉质量、授权范围、费用与上述缺失项尚未全部核验",
      ])
        await pilotDialog().getByLabel(name, { exact: true }).check();
      const callsBeforePilot = fixture.calls.length;
      await pilotDialog()
        .getByRole("button", { name: "确认并保存 ZIP 试制包", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("试制包已保存并核验。");
      const pilotSummary = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items.find((item) => item.status === "saved")!;
      const savedPilot = await get<PilotPackagePreview>(
        `pilot-packages/${pilotSummary.id}`,
      );
      const zipBytes = await readFile(pilotPath);
      const zip = unzipSync(zipBytes);
      expect(savedPilot.receipt).toMatchObject({
        sha256: createHash("sha256").update(zipBytes).digest("hex"),
        byteSize: zipBytes.length,
      });
      const workflowEvidence = JSON.parse(
        strFromU8(zip["workflow-lineage.json"]!),
      );
      expect(workflowEvidence).toMatchObject({
        format: "pilot-selected-workflow-lineage-v1",
        sourceProject: {
          id: projectId,
          version: savedPilot.manifest.projectVersion,
        },
        textIncluded: false,
        semanticVerification: "unverified",
        coverage:
          "selected-adopted-production-workflows-only-not-project-history",
      });
      expect(workflowEvidence.stages).toHaveLength(3);
      for (const [index, result] of formal.entries()) {
        const stage = workflowEvidence.stages[index];
        expect(stage.result).toEqual({
          id: result.id,
          version: result.version,
        });
        expect(stage.state).toBe("available");
        expect(stage.receipt).toMatchObject({
          id: result.workflowId,
          projectId,
          operation: result.operation,
          stage: "applied",
          sourceSnapshotId: result.sourceSnapshotId,
          outputs: { episodeResultId: result.id },
          runIds: result.runIds,
        });
      }
      for (const forbidden of [
        "preparedPrompt",
        "baseText",
        "baseBlocks",
        "instruction",
        "credential",
        "PRIVATE",
        adopted.content.summary,
      ])
        expect(strFromU8(zip["workflow-lineage.json"]!)).not.toContain(
          forbidden,
        );
      const inputEvidence = JSON.parse(strFromU8(zip["source-context.json"]!));
      expect(inputEvidence).toMatchObject({
        textIncluded: false,
        provesModelUnderstanding: false,
        provesParagraphToShotMapping: false,
      });
      for (const [index, result] of formal.entries()) {
        const stage = inputEvidence.stages[index];
        expect(stage.result).toEqual({
          id: result.id,
          version: result.version,
        });
        expect(stage.inputKind).toBe(
          independentEpisode
            ? "author-selected-episode-expressions"
            : "author-selected-season-expressions",
        );
        expect(stage.episodeChapterMapping).toHaveLength(1);
        expect(stage.contextChapters).toHaveLength(independentEpisode ? 1 : 2);
        expect(stage.references).toEqual(result.basis.references);
        if (independentEpisode) {
          expect(stage.selection.higherSummaries).toEqual([]);
          expect(stage.selection.omitted).toEqual([
            { id: second.id, version: second.version, reason: "not-selected" },
          ]);
        } else
          expect(stage.selection.higherSummaries[0]).toMatchObject({
            id: adopted.id,
            version: adopted.version,
            scopeFingerprint: adopted.basis.request.scopeFingerprint,
          });
      }
      expect(strFromU8(zip["source-context.json"]!)).not.toContain(
        adopted.content.summary,
      );
      expect(strFromU8(zip["source-context.json"]!)).not.toContain("PRIVATE");
      expect(formal[0]!.basis.request.sourceEvidenceFormat).toBe(
        "exact-expression-quotes-v1",
      );
      expect(formal[0]!.sourceEvidence?.length).toBeGreaterThan(0);
      expect(formal[1]!.sourceEvidence).toEqual(formal[0]!.sourceEvidence);
      expect(formal[2]!.sourceEvidence).toEqual(formal[0]!.sourceEvidence);
      const sceneLineage = JSON.parse(strFromU8(zip["lineage.json"]!));
      for (const scene of sceneLineage) {
        const evidence = formal[0]!.sourceEvidence!.filter(
          (item) => item.sceneId === scene.sceneId,
        );
        expect(scene.sourceEvidence).toEqual(evidence);
        expect(scene.scriptBlockIds.length).toBeGreaterThan(1);
        expect(scene.shots[0]).toMatchObject({
          associationScope: "scene",
          sceneEvidenceIds: evidence.map((item) => item.evidenceId),
        });
        for (const item of evidence) {
          expect(item.semanticVerification).toBe("unverified");
          if (item.source.sourceKind === "knowledge")
            expect(item.matches[0]).not.toHaveProperty("chapterStart");
        }
      }
      expect(strFromU8(zip["outline.json"]!)).not.toContain("sourceEvidence");
      for (const file of savedPilot.files)
        expect(file.content).not.toContain(
          "PRIVATE MODEL DECLARED SCENE ATTRIBUTION",
        );
      expect(fixture.calls).toHaveLength(callsBeforePilot);
      for (const file of savedPilot.files) {
        expect(strFromU8(zip[file.fileName]!)).toBe(file.content);
        expect(
          createHash("sha256").update(zip[file.fileName]!).digest("hex"),
        ).toBe(file.sha256);
      }
      await running.page
        .getByRole("button", { name: "关闭试制预览", exact: true })
        .click();
      const episodeKey = `dramaip-episode-development-basis:${projectId}`;
      const savedEpisode = await running.page.evaluate(
        (key) => window.localStorage.getItem(key),
        episodeKey,
      );
      const episodeLocation = new URL(running.page.url()).hash;
      const callsBeforeEpisodeRestart = fixture.calls.length;
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await running.page.evaluate((hash) => {
        window.location.hash = hash;
      }, episodeLocation);
      await expect(
        developmentPanel().getByLabel("正式分镜包 v1", { exact: true }),
      ).toBeVisible();
      expect(
        await running.page.evaluate(
          (key) => window.localStorage.getItem(key),
          episodeKey,
        ),
      ).toBe(savedEpisode);
      for (const result of formal)
        expect(await get(`episode-development/${result.id}`)).toEqual(result);
      expect(await get(`pilot-packages/${savedPilot.id}`)).toEqual(savedPilot);
      expect(fixture.calls).toHaveLength(callsBeforeEpisodeRestart);
      expect(fixture.errors).toEqual([]);
    } finally {
      await running?.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

// Preserve every original reorder journey. Body changes have different source
// versions and require actual fresh diagnosis/strategy/season adoption instead.
for (const { novelMode, sourceChange } of [
  ...(
    [
      "inherit",
      "original",
      "paragraphs",
      "summary",
      "higher",
      "mixed",
      "volume",
      "story-arc",
    ] as const
  ).map((novelMode) => ({
    novelMode,
    sourceChange: "season-reorder" as const,
  })),
  ...(["inherit", "paragraphs"] as const).map((novelMode) => ({
    novelMode,
    sourceChange: "chapter-body" as const,
  })),
]) {
  const journey =
    sourceChange === "chapter-body"
      ? "小说正文改版完整下游普通后台"
      : "小说新来源完整下游普通后台";
  test(`${journey} ${novelMode}：真实逐镜头关联、新版季纲确认、原分镜明确范围重做、物理ZIP与重启恢复`, async ({}, info) => {
    test.setTimeout(300_000);
    const userData = await mkdtemp(
      join(tmpdir(), "dramaip-novel-source-confirm-"),
    );
    const fixture = await localModelFixture();
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      // Only this isolated test app's controlled dialog is stubbed. The actual
      // Host reads the fixture file; no ordinary/native app is opened or hidden.
      await running.application.evaluate(
        ({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path],
          });
        },
        resolve(
          `tests/fixtures/lm6/lm6-00/${["summary", "higher", "mixed", "volume", "story-arc"].includes(novelMode) ? "novel-higher-context.md" : "source-reconfirmation-import.md"}`,
        ),
      );
      const navigate = (hash: string) =>
        running!.page.evaluate((value) => {
          window.location.hash = value;
        }, hash);
      await navigate("#/");
      await running.page
        .getByRole("button", { name: "导入小说或大纲", exact: true })
        .click();
      await running.page
        .getByRole("button", { name: "开发剧本 · 单季短剧", exact: true })
        .click();
      await running.page
        .getByRole("button", { name: "选择文件", exact: true })
        .click();
      await expect(
        running.page.getByText(
          ["summary", "higher", "mixed", "volume", "story-arc"].includes(
            novelMode,
          )
            ? "novel-higher-context.md"
            : "source-reconfirmation-import.md",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill(`小说新来源正式确认 ${novelMode}`);
      await running.page
        .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。", {
          exact: true,
        })
        .check();
      await running.page
        .getByRole("button", { name: "创建单季短剧并导入", exact: true })
        .click();
      await expect(running.page).toHaveURL(/\/projects\/[^/]+$/u);
      const projectId = new URL(running.page.url()).hash.split("/").at(-1)!;
      let get = await runtimeReader(running.page);
      let chapters = await get<Chapter[]>(`projects/${projectId}/chapters`);
      let importedChapters = chapters.filter((chapter) =>
        chapter.content.trim(),
      );
      expect(importedChapters).toHaveLength(2);
      expect(
        chapters
          .filter((chapter) => !chapter.content.trim())
          .map((chapter) => chapter.title),
      ).toEqual(["单季故事母稿"]);
      let summaryTarget = `book:${projectId}`,
        summaryTitle = `小说新来源正式确认 ${novelMode}`;
      if (novelMode === "volume" || novelMode === "story-arc") {
        summaryTitle = `作者实际${novelMode === "volume" ? "卷" : "故事弧"}来源`;
        if (novelMode === "story-arc") {
          await running.page
            .getByRole("button", { name: "大纲", exact: true })
            .click();
          await running.page
            .getByRole("button", { name: "卷与单元", exact: true })
            .click();
          await running.page
            .getByRole("button", { name: "补充已有规划", exact: true })
            .click();
          const editor = running.page.getByRole("dialog", {
            name: "新建规划",
            exact: true,
          });
          await editor
            .getByLabel("规划标题", { exact: true })
            .fill(summaryTitle);
          await editor.getByLabel("起始章节", { exact: true }).fill("1");
          await editor.getByLabel("结束章节", { exact: true }).fill("2");
          await editor
            .getByRole("button", { name: "保存", exact: true })
            .click();
          await expect(editor).not.toBeVisible();
        }
        const openIndex = async () => {
          await openProjectTool(running!.page, "质量报告");
          await running!.page
            .locator("summary")
            .filter({ hasText: /^本地长篇来源索引$/u })
            .click();
          return running!.page.getByLabel("本地长篇来源索引", { exact: true });
        };
        let index = await openIndex();
        if (novelMode === "volume") {
          await index
            .locator("summary")
            .filter({ hasText: /^管理实际卷与章节归属$/u })
            .click();
          let editor = index.getByLabel("实际卷与章节归属", { exact: true });
          await editor
            .getByLabel("实际卷名称", { exact: true })
            .fill(summaryTitle);
          await editor
            .getByLabel("实际卷规划", { exact: true })
            .fill("作者明确的两章归属，不是数字故事弧范围。");
          let volume:
            import("@dramaip/contracts/writing").WritingVolume | undefined;
          let request: { key: string; body: unknown } | undefined;
          const pattern = `**/api/v2/projects/${projectId}/volumes`;
          await running.page.route(pattern, async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            request = {
              key: route.request().headers()["idempotency-key"]!,
              body: route.request().postDataJSON(),
            };
            const response = await route.fetch();
            expect(response.status(), await response.text()).toBe(201);
            volume = await response.json();
            await route.abort("failed");
          });
          const beforeCalls = fixture.calls.length;
          await editor
            .getByRole("button", { name: "创建实际卷", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "确认创建实际卷", exact: true })
            .getByRole("button", { name: "确认创建实际卷", exact: true })
            .click();
          await expect.poll(() => volume?.id).toBeTruthy();
          await expect(
            editor.getByLabel("原卷请求恢复", { exact: true }),
          ).toBeVisible();
          await running.application.close();
          running = undefined;
          running = await launch(userData);
          get = await runtimeReader(running.page);
          await navigate(`#/projects/${projectId}`);
          index = await openIndex();
          await index
            .locator("summary")
            .filter({ hasText: /^管理实际卷与章节归属$/u })
            .click();
          editor = index.getByLabel("实际卷与章节归属", { exact: true });
          await expect(
            editor.getByLabel("原卷请求恢复", { exact: true }),
          ).toContainText(request!.key);
          let replay: typeof request;
          running.page.on("request", (item) => {
            if (
              item.method() === "POST" &&
              item.url().endsWith(`/projects/${projectId}/volumes`)
            )
              replay = {
                key: item.headers()["idempotency-key"]!,
                body: item.postDataJSON(),
              };
          });
          expect(replay).toBeUndefined();
          await editor
            .getByRole("button", { name: "恢复原卷请求", exact: true })
            .click();
          await expect(
            editor.getByLabel("原卷请求恢复", { exact: true }),
          ).not.toBeVisible();
          expect(replay).toEqual(request);
          expect(
            (await get<{ items: unknown[] }>(`projects/${projectId}/volumes`))
              .items,
          ).toEqual([volume]);
          await editor
            .getByLabel("目标实际卷", { exact: true })
            .selectOption(volume!.id);
          for (const chapter of importedChapters)
            await editor
              .getByLabel(`卷归属章节 ${chapter.title}`, { exact: true })
              .check();
          await editor
            .getByRole("button", { name: "确认所选章节归属", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "确认实际卷归属", exact: true })
            .getByRole("button", { name: "确认整批归属", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await get<Chapter[]>(`projects/${projectId}/chapters`)).filter(
                  (chapter) => chapter.volumeId === volume!.id,
                ).length,
            )
            .toBe(2);
          const after = await get<Chapter[]>(`projects/${projectId}/chapters`);
          for (const original of chapters) {
            const current = after.find(
              (chapter) => chapter.id === original.id,
            )!;
            expect(current.content).toBe(original.content);
            expect(current.version).toBe(
              original.version + (original.content.trim() ? 1 : 0),
            );
          }
          chapters = after;
          importedChapters = after.filter((chapter) => chapter.content.trim());
          expect(fixture.calls).toHaveLength(beforeCalls);
          summaryTarget = `volume:${volume!.id}`;
        } else {
          const arc = (
            await get<RecordEntity[]>(`story-arcs?projectId=${projectId}`)
          ).find((item) => item.title === summaryTitle)!;
          expect(arc).toBeDefined();
          await index
            .locator("summary")
            .filter({ hasText: "明确故事弧的规划章节范围" })
            .click();
          await index
            .getByLabel("索引故事弧", { exact: true })
            .selectOption(arc.id);
          for (const chapter of importedChapters)
            await index
              .getByLabel(`故事弧范围章节 ${chapter.title}`, { exact: true })
              .check();
          await index
            .getByRole("button", { name: "确认故事弧章节范围", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "确认故事弧章节范围", exact: true })
            .getByRole("button", { name: "确认记录章节范围", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (
                  await get<NarrativeIndexCatalog>(
                    `projects/${projectId}/narrative-context-index`,
                  )
                ).groups.find((group) => group.id === arc.id)?.state,
            )
            .toBe("current");
          summaryTarget = `story-arc:${arc.id}`;
        }
        await navigate(`#/projects/${projectId}`);
      }
      let source = importedChapters[1]!;
      const independent = novelMode !== "inherit";
      const higherOnly = ["higher", "volume", "story-arc"].includes(novelMode);
      const withHigher = higherOnly || novelMode === "mixed";
      const bookFixture = [
        "summary",
        "higher",
        "mixed",
        "volume",
        "story-arc",
      ].includes(novelMode);
      expect(source.content).toContain(
        bookFixture ? SECOND_FACT : "不要相信来电的人",
      );
      let chapterSummary: NarrativeIndexDetail["summaries"][number] | undefined;
      let higherSummary: NarrativeSummary | undefined;
      // Real public workflows and explicit author adoption create all summary
      // sources. No SQL rows, adopted heads or successful receipts are fabricated.
      if (bookFixture) {
        await openProjectTool(running.page, "质量报告");
        await running.page
          .locator("summary")
          .filter({ hasText: /^本地长篇来源索引$/u })
          .click();
        const index = running.page.getByLabel("本地长篇来源索引", {
          exact: true,
        });
        const memorySource = withHigher ? importedChapters[0]! : source;
        await index
          .getByRole("button", {
            name: `索引章节 ${memorySource.title}`,
            exact: true,
          })
          .first()
          .click();
        await index
          .getByRole("button", { name: "审阅生成本章派生记忆", exact: true })
          .click();
        const memory = index.getByLabel("AI 故事记忆", { exact: true });
        await memory
          .getByRole("button", { name: "生成并检查故事记忆", exact: true })
          .click();
        await expect(memory.locator("header").getByRole("status")).toHaveText(
          "等待审阅采用",
          { timeout: 25_000 },
        );
        await memory.getByRole("button", { name: "采用", exact: true }).click();
        const detailPath = `projects/${projectId}/narrative-context-index/chapters/${memorySource.id}`;
        await expect
          .poll(
            async () =>
              (await get<NarrativeIndexDetail>(detailPath)).summaries.length,
          )
          .toBe(1);
        chapterSummary = (await get<NarrativeIndexDetail>(detailPath))
          .summaries[0]!;
        if (withHigher) {
          await running.page
            .locator("summary")
            .filter({ hasText: /^本地长篇来源索引$/u })
            .click();
          await running.page
            .locator("summary")
            .filter({ hasText: /^卷／故事弧／全书派生摘要$/u })
            .click();
          const summaryPanel = running.page.getByLabel("分层摘要工作台", {
            exact: true,
          });
          await summaryPanel
            .getByLabel("实际摘要范围", { exact: true })
            .selectOption(summaryTarget);
          const summarySource = summaryPanel
            .locator("fieldset")
            .filter({ hasText: memorySource.title });
          await summarySource
            .getByRole("button", { name: "读取此章已采用摘要", exact: true })
            .click();
          await summarySource
            .getByLabel(`${memorySource.title}摘要来源表达`, { exact: true })
            .selectOption(chapterSummary.id);
          await summaryPanel
            .getByRole("button", { name: "确认本轮摘要来源", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "确认分层摘要来源范围", exact: true })
            .getByRole("button", { name: "确认本轮摘要来源", exact: true })
            .click();
          const workbench = summaryPanel.getByLabel("AI 卷／故事弧／全书摘要", {
            exact: true,
          });
          await workbench
            .getByRole("button", {
              name: "生成并检查卷／故事弧／全书摘要",
              exact: true,
            })
            .click();
          await expect(
            workbench.locator("header").getByRole("status"),
          ).toHaveText("等待审阅采用", { timeout: 25_000 });
          await workbench
            .getByRole("button", { name: "采用", exact: true })
            .click();
          const summaryPath = `projects/${projectId}/narrative-summaries`;
          await expect
            .poll(
              async () =>
                (await get<{ items: NarrativeSummary[] }>(summaryPath)).items[0]
                  ?.isCurrent,
            )
            .toBe(true);
          higherSummary = (
            await get<{ items: NarrativeSummary[] }>(summaryPath)
          ).items[0]!;
          expect(higherSummary.content.coveredChapters).toEqual(
            importedChapters.map(({ id, version }) => ({ id, version })),
          );
        }
      }
      await adoptIntentInUi(running.page, INTENT);
      await openProjectTool(running.page, "改编诊断");
      const diagnosisPanel = () =>
        running!.page.getByLabel("改编诊断工作台", { exact: true });
      await diagnosisPanel()
        .getByLabel(`诊断来源 ${source.title}`, { exact: true })
        .check();
      if (bookFixture) {
        if (withHigher)
          await diagnosisPanel()
            .getByLabel(`诊断来源 ${importedChapters[0]!.title}`, {
              exact: true,
            })
            .check();
        await diagnosisPanel()
          .getByLabel("诊断使用明确混合表达", { exact: true })
          .check();
        const expressions = diagnosisPanel()
          .locator("details")
          .filter({
            has: running.page
              .locator("summary")
              .filter({ hasText: "诊断实际表达" }),
          })
          .first();
        await expressions.locator("summary").first().click();
        for (const chapter of withHigher ? importedChapters : [source]) {
          await expressions
            .getByLabel(`前文来源 ${chapter.title}`, { exact: true })
            .getByLabel(`前文表达 ${chapter.title}`, { exact: true })
            .selectOption("original");
        }
      }
      await diagnosisPanel()
        .getByLabel("诊断来源权利声明", { exact: true })
        .check();
      await diagnosisPanel()
        .getByLabel("诊断目标集数", { exact: true })
        .fill("2");
      await diagnosisPanel()
        .getByRole("button", { name: "确认本轮来源与版本", exact: true })
        .click();
      const diagnosisWorkbench = diagnosisPanel().getByLabel("AI 改编诊断", {
        exact: true,
      });
      await diagnosisWorkbench
        .getByRole("button", { name: "生成并检查改编诊断", exact: true })
        .click();
      await expect(
        diagnosisWorkbench.locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await diagnosisPanel()
        .getByRole("button", { name: "采用诊断，下一步独立策略", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用改编诊断", exact: true })
        .getByRole("button", { name: "确认采用诊断", exact: true })
        .click();
      await expect(
        diagnosisWorkbench.locator("header").getByRole("status"),
      ).toHaveText("已采用");
      await openProjectTool(running.page, "独立策略");
      const strategyPanel = running.page.getByLabel("独立改编策略工作台", {
        exact: true,
      });
      await strategyPanel
        .getByRole("button", { name: "确认独立策略来源", exact: true })
        .click();
      const strategyWorkbench = strategyPanel.getByLabel("AI 独立改编策略", {
        exact: true,
      });
      await strategyWorkbench
        .getByRole("button", { name: "生成并检查独立改编策略", exact: true })
        .click();
      await expect(
        strategyWorkbench.locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await strategyPanel
        .getByRole("radio", { name: "选择独立策略 独立悬念重排", exact: true })
        .check();
      await strategyPanel
        .getByRole("button", { name: "采用此独立策略", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用独立改编策略", exact: true })
        .getByRole("button", { name: "确认采用此策略", exact: true })
        .click();
      await expect(
        strategyWorkbench.locator("header").getByRole("status"),
      ).toHaveText("已采用");
      await openProjectTool(running.page, "整季方案");
      const seasonPanel = () =>
        running!.page.getByLabel("整季方案工作台", { exact: true });
      await seasonPanel()
        .getByRole("button", { name: "确认本轮季纲基准", exact: true })
        .click();
      const seasonWorkbench = seasonPanel().getByLabel("AI 整季分集方案", {
        exact: true,
      });
      await seasonWorkbench
        .getByRole("button", { name: "生成并检查整季分集方案", exact: true })
        .click();
      await expect(
        seasonWorkbench.locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await seasonPanel()
        .getByRole("button", { name: "采用这个整季方案", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用这个整季方案？", exact: true })
        .getByRole("button", { name: "明确采用方案", exact: true })
        .click();
      await expect(
        seasonWorkbench.locator("header").getByRole("status"),
      ).toHaveText("已采用");
      const plan = (
        await get<{ items: SeasonPlan[] }>(`projects/${projectId}/season-plans`)
      ).items.find((item) => item.isCurrent)!;
      const episodeId = "stable-episode-1";
      expect(
        plan.content.episodes.find((episode) => episode.id === episodeId)!
          .orderIndex,
      ).toBe(1);
      const bare = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-script`;
      await navigate(
        `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-outline`,
      );
      const panel = () =>
        running!.page.getByLabel("单集开发工作台", { exact: true });
      const bible = panel().getByLabel("AI Story Bible", { exact: true });
      await bible
        .getByRole("button", { name: "生成并检查Story Bible", exact: true })
        .click();
      await expect(bible.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        { timeout: 25_000 },
      );
      await bible.getByRole("button", { name: "采用", exact: true }).click();
      await expect(panel()).toContainText("已批准 Story Bible：1 份");
      for (const [tab, label, dialog] of [
        ["单集大纲", "单集大纲", "明确采用单集大纲？"],
        ["标准剧本", "单集标准剧本", "明确采用标准剧本？"],
        ["分镜包", "单集分镜包", "明确采用单集分镜包？"],
      ] as const) {
        await panel().getByRole("button", { name: tab, exact: true }).click();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const workbench = panel().getByLabel(`AI ${label}`, { exact: true });
        await workbench
          .getByRole("button", { name: `生成并检查${label}`, exact: true })
          .click();
        await expect(
          workbench.locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用", { timeout: 25_000 });
        await workbench
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: dialog, exact: true })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel(`正式${tab} v1`, { exact: true }),
        ).toBeVisible();
      }
      const original = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find(
        (item) =>
          item.operation === "episode-script" && item.episodeId === episodeId,
      )!;
      const oldOutline = await get<EpisodeDevelopmentResult>(
        `episode-development/${original.basis.request.outline!.id}`,
      );
      const manuscript = await get<ScreenplayDocument>(
        `scripts/${original.scriptId}/screenplay`,
      );
      const originalBoard = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find(
        (item) => item.operation === "storyboard-package" && item.isCurrent,
      )!;
      expect(originalBoard).toBeDefined();
      const actualShotSource = await get<StoryboardAttributionSource>(
        `projects/${projectId}/storyboard-attribution-sources/${originalBoard.id}?version=${originalBoard.version}`,
      );
      const association = () =>
        panel().getByLabel("逐镜头明确来源关联", { exact: true });
      await association()
        .getByRole("button", { name: "打开逐镜头关联审阅", exact: true })
        .click();
      await association()
        .getByRole("button", {
          name: "读取并明确确认当前关联来源",
          exact: true,
        })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确确认逐镜头关联来源", exact: true })
        .getByRole("button", { name: "确认此正式版本来源", exact: true })
        .click();
      for (const shot of actualShotSource.shots) {
        const evidence = actualShotSource.evidence.find(
          (item) => item.sceneId === shot.sceneId,
        )!;
        expect(evidence).toBeDefined();
        await association()
          .getByLabel("明确关联镜头", { exact: true })
          .selectOption(shot.shotId);
        for (const blockId of shot.sourceBlockIds)
          await association()
            .getByLabel(`关联剧本块 ${blockId}`, { exact: true })
            .check();
        await association()
          .getByLabel("明确关联引文", { exact: true })
          .selectOption(evidence.evidenceId);
        await association()
          .getByLabel("明确引文匹配位置", { exact: true })
          .selectOption("0");
        await association()
          .getByLabel("人工镜头关联理由", { exact: true })
          .fill("PRIVATE NOVEL UI 原镜头明确关联，不认证语义");
        await association()
          .getByRole("button", { name: "加入此镜头的明确关联", exact: true })
          .click();
      }
      await association()
        .getByRole("button", {
          name: "保存明确关联草稿（尚不采用）",
          exact: true,
        })
        .click();
      await running.page
        .getByRole("dialog", { name: "保存明确镜头关联草稿", exact: true })
        .getByRole("button", { name: "保存原关联草稿", exact: true })
        .click();
      await expect(
        association().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toBeVisible();
      for (const label of [
        "已审阅实际来源与具体匹配位置",
        "已核对所选镜头／稳定块／可选节点及未关联范围",
        "理解人工声明和位置规则不证明语义或合法授权",
      ])
        await association().getByLabel(label, { exact: true }).check();
      await association()
        .getByRole("button", { name: "采用此原镜头关联", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确采用原逐镜头关联", exact: true })
        .getByRole("button", { name: "采用此原关联", exact: true })
        .click();
      await expect(
        association().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toContainText("当前明确采用");
      const originalAssociation = (
        await get<{ items: StoryboardAttribution[] }>(
          `projects/${projectId}/storyboard-attributions`,
        )
      ).items.find((item) => item.isCurrent && item.status === "adopted")!;
      expect(originalAssociation.links).toHaveLength(
        actualShotSource.shots.length,
      );
      // Optional pre-existing media does not become a novel/delivery Gate. These
      // actual public records exercise source status, never generated binaries.
      const originalMedia: Array<{
        kind: "shot-stills" | "video" | "assets";
        record: MediaRecord;
        status: MediaSourceStatus;
        shot: StoryboardAttributionSource["shots"][number];
      }> = [];
      const bootstrap = await running.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      const mediaManager = new ServerConnectionManager();
      try {
        await mediaManager.attach({
          type: "desktop",
          baseUrl: bootstrap.baseUrl,
          accessToken: bootstrap.accessToken,
        });
        const mediaClient = createStudioClient(mediaManager.createTransport());
        for (const kind of ["shot-stills", "video", "assets"] as const)
          for (const shot of actualShotSource.shots) {
            const record = MediaRecordSchema.parse(
              await mediaClient.resources.create(kind, {
                projectId,
                parentId: shot.shotRecord.id,
                title: "PRIVATE UI original optional media",
                payload: {
                  采用状态: "已采用",
                  sourceShotVersion: 999,
                  ...(kind === "shot-stills"
                    ? {
                        预览类型: "image",
                        预览数据:
                          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5sAAAAASUVORK5CYII=",
                      }
                    : {
                        说明: "PRIVATE optional original record, no generated media",
                      }),
                },
              }),
            );
            const status = await mediaClient.mediaSources.status(record.id);
            expect(status).toMatchObject({
              state: "current",
              binding: {
                shotId: shot.shotRecord.id,
                shotVersion: shot.shotRecord.version,
                origin: "manual-record",
                version: 1,
              },
            });
            expect(status.binding!.shotVersion).not.toBe(999);
            originalMedia.push({ kind, record, status, shot });
          }
      } finally {
        mediaManager.disconnect();
      }
      expect(originalMedia).toHaveLength(actualShotSource.shots.length * 3);
      const actualEpisode = await get<
        import("@dramaip/contracts/production").ProductionRecord
      >(`episodes/${originalBoard.episodeRecordId}`);
      expect(actualEpisode.parentId).toBeTruthy();
      const mediaRoute = (shot: StoryboardAttributionSource["shots"][number]) =>
        `#/produce?${new URLSearchParams({
          projectId,
          adaptationId: actualEpisode.parentId!,
          episodeId: actualEpisode.id,
          scriptId: originalBoard.scriptId!,
          sceneId: shot.sceneRecord.id,
          shotId: shot.shotRecord.id,
          stage: "image",
        })}`;
      const assertMediaBeforeRedo = async () => {
        for (const retained of originalMedia) {
          const status = await get<MediaSourceStatus>(
            `media-records/${retained.record.id}/source`,
          );
          expect(status.state).toBe("stale");
          expect(status.binding).toEqual(retained.status.binding);
          expect(status.actualShotVersion).toBe(
            retained.status.binding!.shotVersion,
          );
          expect(
            await get<MediaRecord>(`${retained.kind}/${retained.record.id}`),
          ).toEqual(retained.record);
        }
      };
      const assertStaleMediaCard = async (imageName: string) => {
        const retained = originalMedia.find(
          (item) => item.kind === "shot-stills",
        )!;
        await navigate(mediaRoute(retained.shot));
        const card = running!.page.getByTestId(
          `media-source-${retained.record.id}`,
        );
        await expect(
          card.getByText("旧素材待复核", { exact: false }),
        ).toBeVisible();
        await expect(
          card.getByRole("button", { name: "采用此静帧", exact: true }),
        ).toBeDisabled();
        await card.screenshot({ path: info.outputPath(imageName) });
      };
      const originalRecords: Record<string, RecordEntity[]> = {};
      for (const kind of ["scenes", "shots", "visual-assets"])
        originalRecords[kind] = await get<RecordEntity[]>(
          `${kind}?projectId=${projectId}`,
        );
      let modelCalls = fixture.calls.length;
      let taskIds = (await get<Array<{ id: string }>>("tasks")).map(
        (task) => task.id,
      );
      if (sourceChange === "chapter-body") {
        const chaptersBeforeBodyEdit = structuredClone(chapters);
        const sourceBeforeBodyEdit = structuredClone(source);
        const changedChapterBody =
          source.content +
          "\n\n实际作者正文第二版：林晚决定先核对号码，不覆盖其他章节或原剧本。";
        const bodyWrites: Array<{ path: string; body: unknown }> = [];
        running.page.on("request", (request) => {
          if (
            request.method() === "PATCH" &&
            new URL(request.url()).pathname ===
              "/api/v2/chapters/" + sourceBeforeBodyEdit.id
          )
            bodyWrites.push({
              path: new URL(request.url()).pathname,
              body: request.postDataJSON(),
            });
        });
        await navigate("#/projects/" + projectId + "?chapterId=" + source.id);
        await running.page.getByText("更多操作", { exact: true }).click();
        await running.page
          .getByRole("button", { name: "微调正文", exact: true })
          .click();
        await running.page
          .getByRole("textbox", { name: "章节正文编辑器", exact: true })
          .fill(changedChapterBody);
        await expect
          .poll(
            async () =>
              (await get<Chapter>("chapters/" + sourceBeforeBodyEdit.id))
                .version,
          )
          .toBe(sourceBeforeBodyEdit.version + 1);
        source = await get<Chapter>("chapters/" + sourceBeforeBodyEdit.id);
        expect(source.content).toBe(changedChapterBody);
        expect(bodyWrites).toHaveLength(1);
        expect(bodyWrites[0]!.body).toMatchObject({
          version: sourceBeforeBodyEdit.version,
          content: changedChapterBody,
        });
        chapters = await get<Chapter[]>("projects/" + projectId + "/chapters");
        for (const retained of chaptersBeforeBodyEdit.filter(
          (item) => item.id !== source.id,
        ))
          expect(chapters.find((item) => item.id === retained.id)).toEqual(
            retained,
          );
        importedChapters = chapters.filter((chapter) => chapter.content.trim());
        expect(
          await get<ScreenplayDocument>(
            "scripts/" + original.scriptId + "/screenplay",
          ),
        ).toEqual(manuscript);
        expect(fixture.calls).toHaveLength(modelCalls);
        expect(
          (await get<SeasonPlan>("season-plans/" + plan.id)).sourceState,
        ).toBe("stale");
        expect(
          (
            await get<EpisodeDevelopmentResult>(
              "episode-development/" + originalBoard.id,
            )
          ).sourceState,
        ).toBe("stale");
        await assertMediaBeforeRedo();
        await assertStaleMediaCard("novel-body-changed-original-media.png");
        {
          await openProjectTool(running.page, "改编诊断");
          const diagnosisPanel = () =>
            running!.page.getByLabel("改编诊断工作台", { exact: true });
          await diagnosisPanel()
            .getByLabel(`诊断来源 ${source.title}`, { exact: true })
            .check();
          if (bookFixture) {
            if (withHigher)
              await diagnosisPanel()
                .getByLabel(`诊断来源 ${importedChapters[0]!.title}`, {
                  exact: true,
                })
                .check();
            await diagnosisPanel()
              .getByLabel("诊断使用明确混合表达", { exact: true })
              .check();
            const expressions = diagnosisPanel()
              .locator("details")
              .filter({
                has: running.page
                  .locator("summary")
                  .filter({ hasText: "诊断实际表达" }),
              })
              .first();
            await expressions.locator("summary").first().click();
            for (const chapter of withHigher ? importedChapters : [source]) {
              await expressions
                .getByLabel(`前文来源 ${chapter.title}`, { exact: true })
                .getByLabel(`前文表达 ${chapter.title}`, { exact: true })
                .selectOption("original");
            }
          }
          await diagnosisPanel()
            .getByLabel("诊断来源权利声明", { exact: true })
            .check();
          await diagnosisPanel()
            .getByLabel("诊断目标集数", { exact: true })
            .fill("2");
          await diagnosisPanel()
            .getByRole("button", { name: "确认本轮来源与版本", exact: true })
            .click();
          const diagnosisWorkbench = diagnosisPanel().getByLabel(
            "AI 改编诊断",
            {
              exact: true,
            },
          );
          await diagnosisWorkbench
            .getByRole("button", { name: "生成并检查改编诊断", exact: true })
            .click();
          await expect(
            diagnosisWorkbench.locator("header").getByRole("status"),
          ).toHaveText("等待审阅采用", { timeout: 25_000 });
          await diagnosisPanel()
            .getByRole("button", {
              name: "采用诊断，下一步独立策略",
              exact: true,
            })
            .click();
          await running.page
            .getByRole("dialog", { name: "采用改编诊断", exact: true })
            .getByRole("button", { name: "确认采用诊断", exact: true })
            .click();
          await expect(
            diagnosisWorkbench.locator("header").getByRole("status"),
          ).toHaveText("已采用");
          await openProjectTool(running.page, "独立策略");
          const strategyPanel = running.page.getByLabel("独立改编策略工作台", {
            exact: true,
          });
          await strategyPanel
            .getByRole("button", { name: "确认独立策略来源", exact: true })
            .click();
          const strategyWorkbench = strategyPanel.getByLabel(
            "AI 独立改编策略",
            {
              exact: true,
            },
          );
          await strategyWorkbench
            .getByRole("button", {
              name: "生成并检查独立改编策略",
              exact: true,
            })
            .click();
          await expect(
            strategyWorkbench.locator("header").getByRole("status"),
          ).toHaveText("等待审阅采用", { timeout: 25_000 });
          await strategyPanel
            .getByRole("radio", {
              name: "选择独立策略 独立悬念重排",
              exact: true,
            })
            .check();
          await strategyPanel
            .getByRole("button", { name: "采用此独立策略", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "采用独立改编策略", exact: true })
            .getByRole("button", { name: "确认采用此策略", exact: true })
            .click();
          await expect(
            strategyWorkbench.locator("header").getByRole("status"),
          ).toHaveText("已采用");
          await openProjectTool(running.page, "整季方案");
          const seasonPanel = () =>
            running!.page.getByLabel("整季方案工作台", { exact: true });
          await seasonPanel()
            .getByRole("button", { name: "确认本轮季纲基准", exact: true })
            .click();
          const seasonWorkbench = seasonPanel().getByLabel("AI 整季分集方案", {
            exact: true,
          });
          await seasonWorkbench
            .getByRole("button", {
              name: "生成并检查整季分集方案",
              exact: true,
            })
            .click();
          await expect(
            seasonWorkbench.locator("header").getByRole("status"),
          ).toHaveText("等待审阅采用", { timeout: 25_000 });
          await seasonPanel()
            .getByRole("button", { name: "采用这个整季方案", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "采用这个整季方案？", exact: true })
            .getByRole("button", { name: "明确采用方案", exact: true })
            .click();
          await expect(
            seasonWorkbench.locator("header").getByRole("status"),
          ).toHaveText("已采用");
        }
      } else {
        await navigate(
          `#/projects/${projectId}/tools/season-plan?seasonPlanId=${plan.id}`,
        );
        await expect(
          seasonPanel().getByLabel("整季方案 v1", { exact: true }),
        ).toBeVisible();
        await seasonPanel()
          .getByRole("button", { name: `上移 ${episodeId}`, exact: true })
          .click();
        await seasonPanel()
          .getByRole("button", { name: "保存重排为新草稿", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "保存重排为新草稿？", exact: true })
          .getByRole("button", { name: "保存新草稿", exact: true })
          .click();
        await expect(
          seasonPanel().getByLabel("整季方案 v2", { exact: true }),
        ).toBeVisible();
        await seasonPanel()
          .getByRole("button", { name: "采用这个整季方案", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "采用这个整季方案？", exact: true })
          .getByRole("button", { name: "明确采用方案", exact: true })
          .click();
      }
      const currentPlan = (
        await get<{ items: SeasonPlan[] }>(`projects/${projectId}/season-plans`)
      ).items.find((item) => item.isCurrent)!;
      expect(currentPlan.id).not.toBe(plan.id);
      expect(currentPlan.origin).toBe(
        sourceChange === "chapter-body" ? "model" : "human-reorder",
      );
      if (sourceChange === "chapter-body") {
        expect(currentPlan.sourceState).toBe("current");
        expect(
          currentPlan.basis.chapters.map(({ id, version }) => ({
            id,
            version,
          })),
        ).toEqual([{ id: source.id, version: source.version }]);
        expect(currentPlan.basis.diagnosis.id).not.toBe(
          plan.basis.diagnosis.id,
        );
        expect(currentPlan.basis.strategy!.id).not.toBe(
          plan.basis.strategy!.id,
        );
        expect(
          fixture.calls
            .slice(modelCalls)
            .some((call) => call.prompt.includes("实际作者正文第二版")),
        ).toBe(true);
        for (const kind of [
          "adaptation-diagnosis",
          "adaptation-strategy",
          "season-plan",
        ])
          expect(
            fixture.calls.slice(modelCalls).some((call) => call.kind === kind),
          ).toBe(true);
        modelCalls = fixture.calls.length;
        taskIds = (await get<Array<{ id: string }>>("tasks")).map(
          (task) => task.id,
        );
      }
      await assertMediaBeforeRedo();
      await assertStaleMediaCard("novel-upstream-stale-original-media.png");
      expect(
        currentPlan.content.episodes.find(
          (episode) => episode.id === episodeId,
        )!.orderIndex,
      ).toBe(sourceChange === "chapter-body" ? 1 : 0);
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${original.id}`,
          )
        ).sourceState,
      ).toBe("stale");
      await navigate(bare);
      const sourcePanel = () =>
        panel().getByLabel("新来源正式确认", { exact: true });
      await sourcePanel()
        .getByRole("button", { name: "新来源正式确认", exact: true })
        .click();
      const mode = () =>
        sourcePanel().getByLabel("新来源小说表达模式", { exact: true });
      const prepare = () =>
        sourcePanel().getByRole("button", {
          name: "明确新来源，准备完整审阅草稿",
          exact: true,
        });
      let selectedParagraph:
        NarrativeIndexDetail["paragraphs"][number] | undefined;
      if (independent) {
        await mode().selectOption("independent");
        await expect(prepare()).toBeEnabled();
        const picker = sourcePanel()
          .locator("details")
          .filter({
            has: running.page
              .locator("summary")
              .filter({ hasText: "新来源本集实际表达" }),
          })
          .first();
        await picker.locator("summary").first().click();
        const chapterPicker = picker.getByLabel(`前文来源 ${source.title}`, {
          exact: true,
        });
        if (!higherOnly) {
          if (novelMode !== "original")
            await chapterPicker
              .getByRole("button", { name: "读取此章摘要和段落", exact: true })
              .click();
          const detail = await get<NarrativeIndexDetail>(
            `projects/${projectId}/narrative-context-index/chapters/${source.id}`,
          );
          selectedParagraph = detail.paragraphs[0]!;
          expect(selectedParagraph).toBeDefined();
          const expression =
            novelMode === "summary"
              ? `summary:${chapterSummary!.id}`
              : novelMode === "original"
                ? "original"
                : "paragraphs";
          if (novelMode !== "original")
            await expect(
              chapterPicker
                .getByLabel(`前文表达 ${source.title}`, { exact: true })
                .locator(`option[value="${expression}"]`),
            ).toBeEnabled();
          await chapterPicker
            .getByLabel(`前文表达 ${source.title}`, { exact: true })
            .selectOption(expression);
          if (novelMode === "paragraphs" || novelMode === "mixed")
            await chapterPicker
              .getByLabel(
                `上下文段落 ${source.title} ${selectedParagraph.start}`,
                { exact: true },
              )
              .check();
        }
        if (withHigher) {
          await picker
            .getByRole("button", {
              name: "读取卷／故事弧／全书采用头",
              exact: true,
            })
            .click();
          const higher = picker.getByLabel(`高层摘要来源 ${summaryTitle}`, {
            exact: true,
          });
          await higher
            .getByRole("button", { name: "读取此摘要的冻结范围", exact: true })
            .click();
          await expect(
            higher.getByLabel(`纳入高层摘要 ${higherSummary!.id}`, {
              exact: true,
            }),
          ).toBeEnabled();
          await higher
            .getByLabel(`纳入高层摘要 ${higherSummary!.id}`, { exact: true })
            .check();
        }
      }
      await expect(prepare()).toBeEnabled();
      await prepare().click();
      const create = () =>
        sourcePanel().getByRole("button", {
          name: "创建完整新来源预览（不调用模型）",
          exact: true,
        });
      await expect(create()).toBeEnabled();
      // A changed visible choice cannot submit the prior frozen request.
      await mode().selectOption(independent ? "inherit" : "independent");
      await expect(create()).toBeDisabled();
      await expect(
        sourcePanel().getByLabel("新来源完整审阅草稿", { exact: true }),
      ).toContainText("当前选择已变化");
      await mode().selectOption(independent ? "independent" : "inherit");
      await expect(prepare()).toBeEnabled();
      await prepare().click();
      if (independent) {
        const chapterPattern = `**/api/v2/projects/${projectId}/chapters`;
        let failedReads = 0;
        await running.page.route(chapterPattern, (route) => {
          failedReads++;
          return route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            json: {
              type: "about:blank",
              status: 503,
              title: "本次小说来源章节未核全",
              detail: "本次小说来源章节未核全",
            },
          });
        });
        await sourcePanel()
          .getByRole("button", {
            name: "重读原成果、实际文档与来源",
            exact: true,
          })
          .click();
        await expect.poll(() => failedReads).toBeGreaterThan(0);
        await expect(create()).toBeDisabled();
        expect(
          (
            await get<{ items: EpisodeSourceRevision[] }>(
              `projects/${projectId}/episode-source-revisions`,
            )
          ).items,
        ).toEqual([]);
        await running.page.unroute(chapterPattern);
        await sourcePanel()
          .getByRole("button", {
            name: "重读原成果、实际文档与来源",
            exact: true,
          })
          .click();
        await expect(prepare()).toBeEnabled();
        await prepare().click();
      }
      if (sourceChange === "chapter-body")
        await sourcePanel()
          .getByRole("button", {
            name: "明确更新所选同一来源 ID 的场景引用版本",
            exact: true,
          })
          .click();
      await sourcePanel()
        .getByLabel("新来源大纲本集目标", { exact: true })
        .fill("作者按新版季纲确认本集来源，保留实际原稿和完整映射。");
      if (novelMode !== "inherit" && novelMode !== "original") {
        // The old quote is explicitly rejected, with no new model or server
        // candidate. Clearing only this local request record does not pretend
        // to discard a server candidate or silently retry a changed request.
        await create().click();
        await expect(sourcePanel().getByRole("alert")).toContainText(
          "逐场引文未对应本次实际表达",
        );
        expect(
          (
            await get<{ items: EpisodeSourceRevision[] }>(
              `projects/${projectId}/episode-source-revisions`,
            )
          ).items,
        ).toEqual([]);
        expect(fixture.calls).toHaveLength(modelCalls);
        await sourcePanel()
          .getByRole("button", { name: "只解除本机恢复记录", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "解除本机原请求恢复记录？",
            exact: true,
          })
          .getByRole("button", { name: "确认继续", exact: true })
          .click();
        await expect(
          sourcePanel().getByLabel("来源确认原请求恢复", { exact: true }),
        ).toHaveCount(0);
        // Every scene explicitly binds the chosen expression, including both
        // expressions for mixed input. Unselected full prose is never guessed.
        if (oldOutline.content.kind !== "episode-outline")
          throw new Error("actual original outline required");
        const edited = structuredClone(oldOutline.content.value);
        edited.goal = "作者按新版季纲确认本集来源，保留实际原稿和完整映射。";
        edited.scenes.forEach((scene, index) => {
          if (sourceChange === "chapter-body")
            scene.sourceChapters = scene.sourceChapters.map((ref) =>
              ref.id === source.id ? { ...ref, version: source.version } : ref,
            );
          const evidence: NonNullable<
            EpisodeOutlineContent["scenes"][number]["sourceEvidence"]
          > = [];
          if (novelMode === "paragraphs" || novelMode === "mixed")
            evidence.push({
              id: `explicit-paragraph-${index}`,
              source: {
                sourceKind: "chapter",
                sourceId: source.id,
                sourceVersion: source.version,
                fieldPath: `/chapters/${source.id}/paragraphs/${encodeURIComponent(selectedParagraph!.id)}`,
              },
              valuePath: "/content",
              quote: source.content.slice(
                selectedParagraph!.start,
                Math.min(selectedParagraph!.end, selectedParagraph!.start + 32),
              ),
              rationale:
                "作者明确选定当前实际段落，声明本场来源，不认证语义正确。",
            });
          if (novelMode === "summary")
            evidence.push({
              id: `explicit-summary-${index}`,
              source: {
                sourceKind: "knowledge",
                sourceId: chapterSummary!.id,
                sourceVersion: chapterSummary!.version,
                fieldPath: `/knowledge/${chapterSummary!.id}`,
              },
              valuePath: "/summary",
              quote: chapterSummary!.text.slice(0, 32),
              rationale: "作者明确引用已采用章节摘要，不把它当成完整原文。",
            });
          if (withHigher)
            evidence.push({
              id: `explicit-higher-${index}`,
              source: {
                sourceKind: "knowledge",
                sourceId: higherSummary!.id,
                sourceVersion: higherSummary!.version,
                fieldPath: `/narrative-summaries/${higherSummary!.id}`,
              },
              valuePath: "/summary",
              quote: higherSummary!.content.summary.slice(0, 32),
              rationale:
                "作者明确引用已采用全书冻结范围摘要，不宣称全文语义验证。",
            });
          scene.sourceEvidence = evidence;
        });
        await sourcePanel()
          .getByText("增删／重排场景及完整引用的高级编辑", { exact: true })
          .click();
        await sourcePanel()
          .getByLabel("完整大纲结构", { exact: true })
          .fill(JSON.stringify(edited));
        await expect(create()).toBeDisabled();
        await sourcePanel()
          .getByRole("button", { name: "应用完整大纲结构", exact: true })
          .click();
      }
      const previewPattern = `**/api/v2/episode-development/${original.id}/source-revision-previews`;
      let pending: EpisodeSourceRevision | undefined,
        originalRequest: { key: string; body: unknown } | undefined;
      await running.page.route(previewPattern, async (route) => {
        originalRequest = {
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postDataJSON(),
        };
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
        pending = (await response.json()) as EpisodeSourceRevision;
        await route.abort("failed"); // Real owner completed; only the reply is lost.
      });
      await expect(create()).toBeEnabled();
      await create().click();
      await expect.poll(() => pending?.status).toBe("pending");
      expect(pending!.outlineBasis.request.seasonPlan).toEqual({
        id: currentPlan.id,
        version: currentPlan.version,
      });
      expect(pending!.episodeId).toBe(episodeId);
      expect(pending!.outlineBasis.request.direct).toBeUndefined();
      if (novelMode === "paragraphs") {
        expect(selectedParagraph!.end - selectedParagraph!.start).toBeLessThan(
          source.content.length,
        );
        expect(
          pending!.input.request.episodeNarrativeContext?.chapters,
        ).toEqual([
          {
            id: source.id,
            version: source.version,
            representation: "paragraphs",
            paragraphIds: [selectedParagraph!.id],
          },
        ]);
        expect(pending!.outlineBasis.sourceBasis?.chapters[0]).toMatchObject({
          id: source.id,
          representation: "paragraphs",
        });
        expect(pending!.input.request.inheritSeasonNarrative).toBeUndefined();
      }
      if (independent) {
        const expression = pending!.input.request.episodeNarrativeContext!;
        expect(pending!.outlineBasis.sourceBasis).toBeDefined();
        const expectedChapters = higherOnly
          ? []
          : [
              {
                id: source.id,
                version: source.version,
                ...(novelMode === "summary"
                  ? {
                      representation: "summary",
                      record: {
                        id: chapterSummary!.id,
                        version: chapterSummary!.version,
                      },
                    }
                  : novelMode === "original"
                    ? { representation: "original" }
                    : {
                        representation: "paragraphs",
                        paragraphIds: [selectedParagraph!.id],
                      }),
              },
            ];
        expect(expression.chapters).toEqual(expectedChapters);
        expect(expression.summaries ?? []).toEqual(
          withHigher
            ? [{ id: higherSummary!.id, version: higherSummary!.version }]
            : [],
        );
        expect(pending!.input.request.inheritSeasonNarrative).toBeUndefined();
        expect(
          pending!.outlineBasis.sourceBasis?.chapters.map(
            ({ id, representation }) => ({ id, representation }),
          ),
        ).toEqual(
          expectedChapters.map(({ id, representation }) => ({
            id,
            representation,
          })),
        );
        expect(
          pending!.outlineBasis.sourceBasis?.summaries?.map(
            ({ id, version }) => ({ id, version }),
          ) ?? [],
        ).toEqual(expression.summaries ?? []);
      }
      expect(fixture.calls).toHaveLength(modelCalls);
      await expect(
        sourcePanel().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toBeVisible();
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(bare);
      await expect(
        sourcePanel().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toContainText(originalRequest!.key);
      let replayed: { key: string; body: unknown } | undefined;
      await running.page.route(previewPattern, (route) => {
        replayed = {
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postDataJSON(),
        };
        return route.continue();
      });
      await expect(
        sourcePanel().getByRole("button", {
          name: "重放原键与原输入",
          exact: true,
        }),
      ).toBeEnabled();
      await sourcePanel()
        .getByRole("button", { name: "重放原键与原输入", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "重放完整原请求？", exact: true })
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(
        sourcePanel().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toHaveCount(0);
      expect(replayed).toEqual(originalRequest);
      await navigate(`#/pending?projectId=${projectId}&category=waiting`);
      const exactLink = running.page.locator(
        `a[href*="sourceRevisionId=${pending!.id}"]`,
      );
      await expect(exactLink).toHaveCount(1);
      await expect(exactLink).toHaveAttribute(
        "href",
        new RegExp(
          `episodeId=${episodeId}.*resultId=${original.id}&sourceRevisionId=${pending!.id}$`,
        ),
      );
      await exactLink.click();
      const candidate = () =>
        sourcePanel().getByLabel("本次读取的新来源预览", { exact: true });
      const bodyPanel = () =>
        candidate().getByLabel("本次完整实际来源正文", { exact: true });
      await expect(bodyPanel()).toBeVisible();
      const actualBody = await get<{
        entries: Array<{
          sourceKind: string;
          sourceId: string;
          fieldPath: string;
          value: unknown;
        }>;
      }>(`episode-source-revisions/${pending!.id}/source-context`);
      const chapterBody = actualBody.entries.filter(
        (entry) => entry.sourceKind === "chapter",
      );
      expect(chapterBody).toHaveLength(
        novelMode === "summary" || higherOnly ? 0 : 1,
      );
      if (chapterBody.length) expect(chapterBody[0]!.sourceId).toBe(source.id);
      if (novelMode === "paragraphs" || novelMode === "mixed") {
        expect(JSON.stringify(chapterBody[0]!.value)).toContain(
          JSON.stringify(
            source.content.slice(
              selectedParagraph!.start,
              selectedParagraph!.end,
            ),
          ).slice(1, -1),
        );
        expect(JSON.stringify(chapterBody[0]!.value)).not.toContain(
          JSON.stringify(source.content),
        );
        expect(JSON.stringify(chapterBody[0]!.value)).not.toContain(
          "未选段落专用标记",
        );
        expect(chapterBody[0]!.fieldPath).toBe(
          `/chapters/${source.id}/paragraphs/${encodeURIComponent(selectedParagraph!.id)}`,
        );
      } else if (novelMode === "inherit" || novelMode === "original")
        expect(JSON.stringify(chapterBody[0]!.value)).toContain(
          JSON.stringify(source.content).slice(1, -1),
        );
      if (novelMode === "summary" || withHigher) {
        const reference =
          novelMode === "summary" ? chapterSummary! : higherSummary!;
        const summaryBody = actualBody.entries.filter(
          (entry) =>
            entry.sourceKind === "knowledge" && entry.sourceId === reference.id,
        );
        expect(summaryBody).toHaveLength(1);
        expect(summaryBody[0]!.fieldPath).toBe(
          novelMode === "summary"
            ? `/knowledge/${reference.id}`
            : `/narrative-summaries/${reference.id}`,
        );
        expect(JSON.stringify(summaryBody[0]!.value)).toContain(
          JSON.stringify(
            novelMode === "summary"
              ? chapterSummary!.text
              : higherSummary!.content.summary,
          ).slice(1, -1),
        );
        expect(
          actualBody.entries.some(
            (entry) => entry.fieldPath === `/chapters/${source.id}`,
          ),
        ).toBe(false);
        for (const chapter of importedChapters)
          expect(JSON.stringify(actualBody.entries)).not.toContain(
            JSON.stringify(chapter.content).slice(1, -1),
          );
      }
      for (const summary of await bodyPanel()
        .locator("details > summary")
        .all())
        await summary.click();
      await bodyPanel().scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: info.outputPath("novel-source-actual-selected-body.png"),
      });
      const checks = candidate().getByRole("checkbox");
      await expect(checks).toHaveCount(5);
      const adopt = () =>
        candidate().getByRole("button", {
          name: "独立采用新来源与两份正式成果",
          exact: true,
        });
      for (let index = 0; index < 5; index++) {
        await checks.nth(index).check();
        if (index < 4) await expect(adopt()).toBeDisabled();
      }
      await adopt().click();
      await running.page
        .getByRole("dialog", {
          name: "确认新来源与两份新正式成果？",
          exact: true,
        })
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(candidate()).toContainText("状态 adopted");
      const adopted = await get<EpisodeSourceRevision>(
        `episode-source-revisions/${pending!.id}`,
      );
      const newScript = await get<EpisodeDevelopmentResult>(
        `episode-development/${adopted.results!.script.id}`,
      );
      await assertMediaBeforeRedo();
      const newOutline = await get<EpisodeDevelopmentResult>(
        `episode-development/${adopted.results!.outline.id}`,
      );
      expect(newScript.origin).toBe("human-source-revision");
      expect(newScript.scriptId).toBe(original.scriptId);
      expect(newScript.basis.request.seasonPlan).toEqual({
        id: currentPlan.id,
        version: currentPlan.version,
      });
      expect(newScript.workflowId).toBeUndefined();
      expect(newScript.runIds).toEqual([]);
      expect(newOutline.content.kind).toBe("episode-outline");
      expect(newOutline.basis.sourceBasis).toEqual(
        pending!.outlineBasis.sourceBasis,
      );
      expect(newScript.basis.sourceBasis).toEqual(
        pending!.outlineBasis.sourceBasis,
      );
      // A real human adoption creates a formal outline after its input snapshot.
      // The saved-source owner must authenticate that adoption and all original
      // privacy ancestry without inventing a model run or repairing the draft.
      const confirmedQualitySource = await get<ProductionQualitySource>(
        `projects/${projectId}/production-quality-sources/${original.scriptId}`,
      );
      expect(confirmedQualitySource.source.state).toBe("available");
      if (confirmedQualitySource.source.state !== "available")
        throw new Error("Actual source-confirmed quality evidence missing");
      expect(confirmedQualitySource.source.document).toMatchObject({
        id: manuscript.id,
        version: manuscript.version,
        title: manuscript.title,
        blocks: manuscript.blocks,
      });
      expect(confirmedQualitySource.source.policyDependencies).toEqual(
        expect.arrayContaining([
          {
            sourceId: adopted.id,
            sourceVersion: adopted.stateVersion,
            fieldPath: `/production/${adopted.id}`,
          },
          {
            sourceId: newOutline.id,
            sourceVersion: newOutline.version,
            fieldPath: `/production/${newOutline.id}`,
          },
          {
            sourceId: newScript.id,
            sourceVersion: newScript.version,
            fieldPath: `/production/${newScript.id}`,
          },
          {
            sourceId: original.id,
            sourceVersion: original.version,
            fieldPath: `/production/${original.id}`,
          },
        ]),
      );
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${original.id}`,
          )
        ).content,
      ).toEqual(original.content);
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${oldOutline.id}`,
          )
        ).basis,
      ).toEqual(oldOutline.basis);
      expect(
        await get<ScreenplayDocument>(
          `scripts/${original.scriptId}/screenplay`,
        ),
      ).toEqual(manuscript);
      expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
        chapters,
      );
      expect(
        (await get<Array<{ id: string }>>("tasks")).map((task) => task.id),
      ).toEqual(taskIds);
      for (const kind of ["scenes", "shots", "visual-assets"])
        expect(await get(`${kind}?projectId=${projectId}`)).toEqual(
          originalRecords[kind],
        );
      expect(fixture.calls).toHaveLength(modelCalls);
      expect(fixture.errors).toEqual([]);
      const exactRoute = new URL(running.page.url()).hash;
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(exactRoute);
      await expect(candidate()).toContainText("状态 adopted");
      await expect(bodyPanel()).toBeVisible();
      expect(
        await get<EpisodeSourceRevision>(
          `episode-source-revisions/${pending!.id}`,
        ),
      ).toEqual(adopted);
      expect(
        await get<ProductionQualitySource>(
          `projects/${projectId}/production-quality-sources/${original.scriptId}`,
        ),
      ).toEqual(confirmedQualitySource);
      expect(
        await get<ScreenplayDocument>(
          `scripts/${original.scriptId}/screenplay`,
        ),
      ).toEqual(manuscript);
      expect(fixture.calls).toHaveLength(modelCalls);
      // The confirmed source is now real; reuse the OLD board's identities.
      const route = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package`;
      await navigate(route);
      const range = () =>
        panel().getByLabel("局部分镜重做范围", { exact: true });
      const selectedShot = actualShotSource.shots[0]!;
      // This author/test explicitly chooses the scope; the application never
      // auto-selects it. Changed expression modes may require ALL old shots.
      // Same-expression cases select only one, proving retained-row protection.
      // Every shot in the body fixture depends on the changed chapter; review
      // all affected shots. Original reorder cases still prove unselected rows.
      const selectedShotIds =
        sourceChange === "chapter-body"
          ? actualShotSource.shots.map((shot) => shot.shotId)
          : ["inherit", "original", "paragraphs"].includes(novelMode)
            ? [selectedShot.shotId]
            : actualShotSource.shots.map((shot) => shot.shotId);
      for (const shotId of selectedShotIds)
        await range()
          .getByRole("checkbox", { name: new RegExp(`^重做 ${shotId} ·`, "u") })
          .check();
      await range()
        .getByLabel("将明确原关联影响审阅绑定本轮局部重做", { exact: true })
        .check();
      const impactView = () =>
        range().getByLabel("分镜实际变化影响", { exact: true });
      await impactView()
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      await impactView()
        .getByLabel("影响观察原关联版本", { exact: true })
        .selectOption(
          `${originalAssociation.id}:${originalAssociation.version}`,
        );
      await impactView()
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      const composer = () =>
        impactView().getByLabel("完整来源影响审阅", { exact: true });
      await expect(composer()).toBeVisible();
      const observation = await get<EpisodeDevelopmentImpact>(
        `episode-development/${originalBoard.id}/impact?attributionId=${originalAssociation.id}&attributionVersion=${originalAssociation.version}`,
      );
      expect(observation.confirmedSourceTransition?.currentScript).toEqual(
        adopted.results!.script,
      );
      for (const shot of observation.shots) {
        await expect(
          composer().getByLabel(`来源审阅镜头决定 ${shot.shotId}`, {
            exact: true,
          }),
        ).toHaveValue("");
        await composer()
          .getByLabel(`来源审阅镜头决定 ${shot.shotId}`, { exact: true })
          .selectOption(
            selectedShotIds.includes(shot.shotId) ? "redo" : "retain",
          );
      }
      for (const label of [
        "我已核对明确的原关联身份与版本",
        "我已审阅本次完整实际影响观察",
        "我已逐一决定全部实际镜头的重做或保留",
        "我已单独核对未关联范围，未将其当作未变化",
        "我知悉机械观察与作者确认不证明语义安全",
      ])
        await composer().getByLabel(label, { exact: true }).check();
      await composer()
        .getByRole("button", { name: "冻结本次完整来源审阅", exact: true })
        .click();
      await expect(composer().getByRole("status")).toContainText(
        "完整来源审阅已冻结",
      );
      await panel()
        .getByRole("button", { name: "确认本轮单集基准", exact: true })
        .click();
      const workbench = () =>
        panel().getByLabel("AI 单集分镜包", { exact: true });
      await expect(workbench()).toBeVisible();
      await workbench()
        .getByLabel("AI 创作要求", { exact: true })
        .fill(
          "实际小说新来源：只重做本次逐一明确选中的镜头；如有未选镜头，保留其全部实际字段。",
        );
      let createdId: string | undefined;
      const createPattern = "**/api/v2/workflows/creation";
      await running.page.route(createPattern, async (request) => {
        if (request.request().method() !== "POST") return request.continue();
        const response = await request.fetch();
        expect(response.status()).toBe(200);
        createdId = ((await response.json()) as CreationWorkflow).id;
        await request.abort("failed");
      });
      await workbench()
        .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
        .click();
      // The pending card appears when the original request is persisted,
      // before the intercepted HTTP response has finished being read.
      // Do not close its API context while the route handler is still reading.
      await expect.poll(() => createdId, { timeout: 25_000 }).toBeTruthy();
      await expect(
        workbench().getByLabel("原来源重做创建请求待核对", { exact: true }),
      ).toBeVisible();
      expect(createdId).toBeDefined();
      await expect
        .poll(
          async () =>
            (await get<CreationWorkflow>(`workflows/creation/${createdId}`))
              .stage,
          { timeout: 25_000 },
        )
        .toBe("awaiting-review");
      const callsAfterCreate = fixture.calls.length;
      const pendingStartKey = `dramaip-source-redo-start:${projectId}:${episodeId}`;
      const originalStart = await running.page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        pendingStartKey,
      );
      expect(originalStart.key).toBeTruthy();
      expect(originalStart.input).toBeDefined();
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(route);
      await expect(workbench()).toHaveCount(0);
      await panel()
        .getByRole("button", {
          name: "恢复本机原来源审阅请求（不换基准）",
          exact: true,
        })
        .click();
      await expect(
        workbench().getByLabel("原来源重做创建请求待核对", { exact: true }),
      ).toBeVisible();
      const replayRequests: Array<{ key: string | undefined; body: unknown }> =
        [];
      running.page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v2/workflows/creation" &&
          request.method() === "POST"
        )
          replayRequests.push({
            key: request.headers()["idempotency-key"],
            body: request.postDataJSON(),
          });
      });
      await workbench()
        .getByRole("button", {
          name: "重发原来源重做创建请求（不换键）",
          exact: true,
        })
        .click();
      await expect(
        workbench().getByLabel("原来源重做创建请求待核对", { exact: true }),
      ).toHaveCount(0);
      expect(replayRequests).toEqual([
        { key: originalStart.key, body: originalStart.input },
      ]);
      expect(fixture.calls).toHaveLength(callsAfterCreate);
      const workflow = await get<CreationWorkflow>(
        `workflows/creation/${createdId}`,
      );
      expect(workflow.input.episodeDevelopmentRequest?.script).toEqual(
        adopted.results!.script,
      );
      expect(workflow.input.episodeDevelopmentRequest?.outline).toEqual(
        adopted.results!.outline,
      );
      expect(
        workflow.input.episodeDevelopmentRequest?.redoShots?.map(
          (shot) => shot.shotId,
        ),
      ).toEqual(selectedShotIds);
      expect(workflow.creationRequestReceipt).toEqual({
        format: "creation-request-receipt-v1",
        key: originalStart.key,
        requestHash: createHash("sha256")
          .update(JSON.stringify({ input: originalStart.input }))
          .digest("hex"),
      });
      await navigate(`${route}&workflowId=${createdId}`);
      await expect(
        workbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await workbench()
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await running.page
        .getByRole("dialog", {
          name: "明确采用选中镜头局部重做？",
          exact: true,
        })
        .getByRole("button", { name: "明确采用", exact: true })
        .click();
      await expect(
        panel().getByLabel("正式分镜包 v2", { exact: true }),
      ).toBeVisible();
      const current = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find(
        (item) => item.operation === "storyboard-package" && item.isCurrent,
      )!;
      expect(current.basis.request.script).toEqual(adopted.results!.script);
      expect(current.basis.request.outline).toEqual(adopted.results!.outline);
      const mediaAfterRedo = new Map<
        string,
        { record: MediaRecord; status: MediaSourceStatus }
      >();
      for (const retained of originalMedia) {
        const record = await get<MediaRecord>(
          `${retained.kind}/${retained.record.id}`,
        );
        const status = await get<MediaSourceStatus>(
          `media-records/${retained.record.id}/source`,
        );
        const selected = selectedShotIds.includes(retained.shot.shotId);
        expect(status.binding).toEqual(retained.status.binding);
        expect(status.state).toBe(selected ? "stale" : "current");
        if (selected) {
          expect(record.version).toBe(retained.record.version + 1);
          expect(record.title).toBe(retained.record.title);
          expect(record.parentId).toBe(retained.record.parentId);
          expect(record.payload).toEqual({
            ...retained.record.payload,
            stale: true,
            staleReason: "关联镜头已局部重做，旧素材保留待复核。",
            invalidatedByStoryboardResultId: current.id,
            invalidatedShotVersion: retained.status.binding!.shotVersion + 1,
          });
        } else expect(record).toEqual(retained.record);
        mediaAfterRedo.set(record.id, { record, status });
      }
      await assertStaleMediaCard(
        "novel-selected-redo-original-media-stale.png",
      );
      const unselectedStill = originalMedia.find(
        (item) =>
          item.kind === "shot-stills" &&
          !selectedShotIds.includes(item.shot.shotId),
      );
      if (unselectedStill) {
        await navigate(mediaRoute(unselectedStill.shot));
        const card = running.page.getByTestId(
          `media-source-${unselectedStill.record.id}`,
        );
        await expect(
          card.getByText("来源版本一致（机械核对）", { exact: true }),
        ).toBeVisible();
        await card.screenshot({
          path: info.outputPath("novel-unselected-original-media-current.png"),
        });
      }
      await navigate(route);
      await expect(
        panel().getByLabel("正式分镜包 v2", { exact: true }),
      ).toBeVisible();
      const oldShots = originalRecords.shots!,
        oldScenes = originalRecords.scenes!;
      const currentShots = await get<RecordEntity[]>(
          `shots?projectId=${projectId}`,
        ),
        currentScenes = await get<RecordEntity[]>(
          `scenes?projectId=${projectId}`,
        );
      const selectedRecordIds = actualShotSource.shots
        .filter((shot) => selectedShotIds.includes(shot.shotId))
        .map((shot) => shot.shotRecord.id);
      const selectedSceneIds = actualShotSource.shots
        .filter((shot) => selectedShotIds.includes(shot.shotId))
        .map((shot) => shot.sceneRecord.id);
      expect(currentShots.map((shot) => shot.id).sort()).toEqual(
        oldShots.map((shot) => shot.id).sort(),
      );
      expect(currentScenes.map((scene) => scene.id).sort()).toEqual(
        oldScenes.map((scene) => scene.id).sort(),
      );
      for (const shot of oldShots.filter(
        (item) => !selectedRecordIds.includes(item.id),
      ))
        expect(currentShots.find((item) => item.id === shot.id)).toEqual(shot);
      for (const scene of oldScenes.filter(
        (item) => !selectedSceneIds.includes(item.id),
      ))
        expect(currentScenes.find((item) => item.id === scene.id)).toEqual(
          scene,
        );
      expect(
        await get<ScreenplayDocument>(
          `scripts/${original.scriptId}/screenplay`,
        ),
      ).toEqual(manuscript);
      expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
        chapters,
      );
      const pilotPath = join(userData, "novel-confirmed-selected-redo.zip");
      await running.application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, pilotPath);
      await panel()
        .getByLabel("正式分镜包 v2", { exact: true })
        .getByRole("button", { name: "预览内部试制包", exact: true })
        .click();
      const pilot = () =>
        running!.page.getByRole("dialog", {
          name: "核验并保存内部试制包",
          exact: true,
        });
      await pilot()
        .getByRole("button", { name: "生成统一试制包预览", exact: true })
        .click();
      await expect(pilot()).toContainText("待明确确认");
      for (const label of [
        "我确认这些正式版本，并有权导出这份试制包",
        "我确认此包仅用于内部试制审阅，不作为发行就绪证明",
        "我已知悉质量、授权范围、费用与上述缺失项尚未全部核验",
      ])
        await pilot().getByLabel(label, { exact: true }).check();
      await pilot()
        .getByRole("button", { name: "确认并保存 ZIP 试制包", exact: true })
        .click();
      await expect(pilot()).toContainText("试制包已保存并核验。");
      const summary = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items.find((item) => item.status === "saved")!;
      const saved = await get<PilotPackagePreview>(
        `pilot-packages/${summary.id}`,
      );
      const zip = await readFile(pilotPath),
        archive = unzipSync(zip);
      expect(createHash("sha256").update(zip).digest("hex")).toBe(
        saved.receipt!.sha256,
      );
      expect(saved.manifest.adopted.storyboard).toEqual({
        id: current.id,
        version: current.version,
      });
      expect(archive["lineage.json"]).toBeDefined();
      for (const contents of Object.values(archive))
        expect(strFromU8(contents)).not.toContain("PRIVATE");
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(route);
      await expect(
        panel().getByLabel("正式分镜包 v2", { exact: true }),
      ).toBeVisible();
      expect(
        await get<PilotPackagePreview>(`pilot-packages/${saved.id}`),
      ).toEqual(saved);
      expect(await readFile(pilotPath)).toEqual(zip);
      for (const retained of originalMedia) {
        expect({
          record: await get<MediaRecord>(
            `${retained.kind}/${retained.record.id}`,
          ),
          status: await get<MediaSourceStatus>(
            `media-records/${retained.record.id}/source`,
          ),
        }).toEqual(mediaAfterRedo.get(retained.record.id));
      }
      expect(fixture.calls).toHaveLength(callsAfterCreate);
      const testWindows = await running.application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => ({
            visible: window.isVisible(),
            focused: window.isFocused(),
          })),
      );
      expect(testWindows.length).toBeGreaterThan(0);
      for (const windowState of testWindows)
        expect(windowState).toEqual({ visible: false, focused: false });
      await running.page.screenshot({
        path: info.outputPath("novel-source-adopted-original-retained.png"),
      });
    } finally {
      await running?.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

for (const entryPath of ["inspiration", "script"] as const) {
  test(`新来源正式确认普通后台 ${entryPath}：完整选源／原稿／五审阅、存储拒绝零请求与创建采用丢回复重启原键恢复`, async ({}, info) => {
    test.setTimeout(300_000);
    const userData = await mkdtemp(
      join(tmpdir(), "dramaip-source-confirm-ui-"),
    );
    const fixture = await localModelFixture();
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      const navigate = async (hash: string) =>
        running!.page.evaluate((value) => {
          window.location.hash = value;
        }, hash);
      await navigate("#/");
      await running.page
        .getByRole("button", {
          name: entryPath === "script" ? "导入已有剧本" : "从创意开始",
          exact: true,
        })
        .click();
      await running.page
        .getByRole("button", { name: "开发剧本 · 单季短剧", exact: true })
        .click();
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill(`完整新来源确认 ${entryPath}`);
      if (entryPath === "script") {
        await running.page
          .getByRole("textbox", { name: /^已有剧本内容(?:\s|$)/u })
          .fill(
            "INT. 林晚房间 - NIGHT\n\n林晚记下姐姐的警告，核对屏幕上的号码。\n\nINT. 走廊 - NIGHT\n\n林晚发现线索矛盾，决定出门求证。",
          );
        await running.page
          .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。", {
            exact: true,
          })
          .check();
      } else
        await running.page
          .getByRole("textbox", { name: "故事构思（可选）", exact: true })
          .fill(
            "林晚接到姐姐警告，记录号码后核对矛盾线索并主动出门；不先写小说。",
          );
      await running.page
        .getByRole("button", { name: "创建单季短剧", exact: true })
        .click();
      await expect(running.page).toHaveURL(/#\/adapt\?projectId=/);
      const projectId = new URLSearchParams(
        new URL(running.page.url()).hash.split("?")[1],
      ).get("projectId")!;
      let get = await runtimeReader(running.page);
      const episodeId = (
        await get<RecordEntity[]>(`episodes?projectId=${projectId}`)
      )[0]!.id;
      await adoptIntentInUi(running.page, {
        ...INTENT,
        mustKeep: ["姐妹信任与姐姐警告"],
        mustAvoid: ["不强迫先写小说，不补诊断或季纲"],
      });
      const bare = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-script`;
      await navigate(
        `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-outline`,
      );
      const panel = () =>
        running!.page.getByLabel("单集开发工作台", { exact: true });
      const bible = panel().getByLabel("AI Story Bible", { exact: true });
      await bible
        .getByRole("button", { name: "生成并检查Story Bible", exact: true })
        .click();
      await expect(bible.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        { timeout: 25_000 },
      );
      await bible.getByRole("button", { name: "采用", exact: true }).click();
      await expect(panel()).toContainText("已批准 Story Bible：1 份");
      for (const [tab, label, dialog] of [
        ["单集大纲", "单集大纲", "明确采用单集大纲？"],
        ["标准剧本", "单集标准剧本", "明确采用标准剧本？"],
      ] as const) {
        await panel().getByRole("button", { name: tab, exact: true }).click();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const workbench = panel().getByLabel(`AI ${label}`, { exact: true });
        await workbench
          .getByRole("button", { name: `生成并检查${label}`, exact: true })
          .click();
        await expect(
          workbench.locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用", { timeout: 25_000 });
        await workbench
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: dialog, exact: true })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel(`正式${tab} v1`, { exact: true }),
        ).toBeVisible();
      }
      const original = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find((value) => value.operation === "episode-script")!;
      const oldOutline = await get<EpisodeDevelopmentResult>(
        `episode-development/${original.basis.request.outline!.id}`,
      );
      const manuscript = await get<ScreenplayDocument>(
        `scripts/${original.scriptId}/screenplay`,
      );
      const modelCalls = fixture.calls.length;
      // Actual Workspace owner mutation; no formal result is SQL-seeded or mocked.
      const project = await get<{
        id: string;
        version: number;
        synopsis: string;
      }>(`projects/${projectId}`);
      const bootstrap = await running.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      const patched = await fetch(
        `${bootstrap.baseUrl}/api/v2/projects/${projectId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${bootstrap.accessToken}`,
            "Content-Type": "application/json",
            "If-Match": `"${project.version}"`,
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            version: project.version,
            synopsis: `${project.synopsis}\n作者明确补充：保留原稿与原引文，只更新故事来源说明。`,
          }),
        },
      );
      expect(patched.ok, await patched.clone().text()).toBe(true);
      await navigate("#/pending");
      await navigate(bare);
      const source = () =>
        panel().getByLabel("新来源正式确认", { exact: true });
      await source()
        .getByRole("button", { name: "新来源正式确认", exact: true })
        .click();
      if (entryPath === "script")
        await source()
          .getByLabel("新来源实际剧本", { exact: true })
          .selectOption(original.basis.request.direct!.sourceScript!.id);
      await expect(
        source().getByRole("button", {
          name: "明确新来源，准备完整审阅草稿",
          exact: true,
        }),
      ).toBeEnabled();
      await source()
        .getByRole("button", {
          name: "明确新来源，准备完整审阅草稿",
          exact: true,
        })
        .click();
      await source()
        .getByRole("button", {
          name: "明确更新所选同一来源 ID 的场景引用版本",
          exact: true,
        })
        .click();
      await source()
        .getByLabel("新来源大纲本集目标", { exact: true })
        .fill("作者确认新版来源后仍核对通话，保留原稿。");
      const create = () =>
        source().getByRole("button", {
          name: "创建完整新来源预览（不调用模型）",
          exact: true,
        });
      let previewPosts = 0;
      running.page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request
            .url()
            .endsWith(
              `/episode-development/${original.id}/source-revision-previews`,
            )
        )
          previewPosts++;
      });
      await running.page.evaluate(() => {
        const actual = Storage.prototype.setItem;
        Object.assign(window, { sourceRecoveryActualSet: actual });
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key.startsWith("dramaip-source-revision-request:"))
            throw new Error("controlled-source-recovery-storage-refusal");
          actual.call(this, key, value);
        };
      });
      await create().click();
      await expect(source().getByRole("alert").first()).toContainText(
        "本机原请求未可靠保存；未发送请求",
      );
      expect(previewPosts).toBe(0);
      await running.page.evaluate(() => {
        Storage.prototype.setItem = (
          window as unknown as {
            sourceRecoveryActualSet: typeof Storage.prototype.setItem;
          }
        ).sourceRecoveryActualSet;
      });
      const previewPattern = `**/api/v2/episode-development/${original.id}/source-revision-previews`;
      let pending: EpisodeSourceRevision | undefined,
        previewRequest: { key: string; body: unknown } | undefined;
      await running.page.route(previewPattern, async (route) => {
        previewRequest = {
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postDataJSON(),
        };
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
        pending = (await response.json()) as EpisodeSourceRevision;
        await route.abort("failed"); // Owner actually committed, only reply is lost.
      });
      await expect(create()).toBeEnabled();
      await create().click();
      await expect.poll(() => pending?.status).toBe("pending");
      await expect(
        source().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toBeVisible();
      expect(fixture.calls).toHaveLength(modelCalls);
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(bare);
      await expect(
        source().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toContainText(previewRequest!.key);
      let replayedPreview: { key: string; body: unknown } | undefined;
      await running.page.route(previewPattern, async (route) => {
        replayedPreview = {
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postDataJSON(),
        };
        await route.continue();
      });
      await expect(
        source().getByRole("button", { name: "重放原键与原输入", exact: true }),
      ).toBeEnabled();
      await source()
        .getByRole("button", { name: "重放原键与原输入", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "重放完整原请求？", exact: true })
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(
        source().getByLabel("本次读取的新来源预览", { exact: true }),
      ).toBeVisible();
      expect(replayedPreview).toEqual(previewRequest);
      const exactRoute = await running.page.evaluate(
        () => window.location.hash,
      );
      expect(exactRoute).toContain(`resultId=${original.id}`);
      expect(exactRoute).toContain(`sourceRevisionId=${pending!.id}`);
      await navigate(`#/pending?projectId=${projectId}&category=waiting`);
      await expect(
        running.page.getByRole("heading", { name: "待确认中心", exact: true }),
      ).toBeVisible();
      const sourcePending = running.page.locator(
        `a[href*="sourceRevisionId=${pending!.id}"]`,
      );
      await expect(sourcePending).toHaveCount(1);
      await expect(sourcePending).toHaveAttribute(
        "href",
        new RegExp(`resultId=${original.id}&sourceRevisionId=${pending!.id}$`),
      );
      await expect(running.page.getByRole("main")).not.toContainText(
        "PRIVATE MODEL DECLARED SCENE ATTRIBUTION",
      );
      await sourcePending.click();
      await expect(running.page).toHaveURL(
        new RegExp(`sourceRevisionId=${pending!.id}$`),
      );
      await expect(
        source().getByLabel("本次读取的新来源预览", { exact: true }),
      ).toBeVisible();
      const candidate = () =>
        source().getByLabel("本次读取的新来源预览", { exact: true });
      const actualSourceBody = () =>
        candidate().getByLabel("本次完整实际来源正文", { exact: true });
      await expect(actualSourceBody()).toBeVisible();
      const body = await get<{ entries: Array<{ value: unknown }> }>(
        `episode-source-revisions/${pending!.id}/source-context`,
      );
      await expect(actualSourceBody().locator("details")).toHaveCount(
        body.entries.length,
      );
      for (const summary of await actualSourceBody()
        .locator("details > summary")
        .all())
        await summary.click();
      await expect(actualSourceBody()).toContainText(
        "作者明确补充：保留原稿与原引文，只更新故事来源说明。",
      );
      await expect(actualSourceBody()).not.toContainText(
        "PRIVATE MODEL DECLARED SCENE ATTRIBUTION",
      );
      await running.page.screenshot({
        path: info.outputPath("source-confirm-actual-selected-body.png"),
      });
      const adopt = () =>
        candidate().getByRole("button", {
          name: "独立采用新来源与两份正式成果",
          exact: true,
        });
      await expect(adopt()).toBeDisabled();
      const ownerPattern = `**/api/v2/episode-source-revisions/${pending!.id}`;
      await running.page.route(ownerPattern, async (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          json: {
            status: 503,
            title: "本次来源读取不可用",
            detail: "本次来源读取不可用",
            type: "https://dramaip.local/problems/source-owner-read",
            code: "CONTROLLED_SOURCE_OWNER_READ",
            traceId: randomUUID(),
          },
        }),
      );
      await source()
        .getByRole("button", {
          name: "重读原成果、实际文档与来源",
          exact: true,
        })
        .click();
      await expect(candidate()).toHaveCount(0);
      await expect(source().getByRole("alert").first()).toContainText(
        "本次来源读取失败",
      );
      await running.page.screenshot({
        path: info.outputPath("source-confirm-owner-error-no-cache.png"),
      });
      await running.page.unroute(ownerPattern);
      await source()
        .getByRole("button", {
          name: "重读原成果、实际文档与来源",
          exact: true,
        })
        .click();
      await expect(candidate()).toBeVisible();
      await expect(actualSourceBody()).toBeVisible();
      const checks = candidate().getByRole("checkbox");
      await expect(checks).toHaveCount(5);
      for (let index = 0; index < 5; index++) {
        await checks.nth(index).check();
        if (index < 4) await expect(adopt()).toBeDisabled();
      }
      await expect(adopt()).toBeEnabled();
      const contextPattern = `**/api/v2/episode-source-revisions/${pending!.id}/source-context`;
      await running.page.route(contextPattern, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          json: {
            status: 503,
            title: "本次完整来源正文不可用",
            detail: "本次完整来源正文不可用",
            type: "https://dramaip.local/problems/source-body-read",
            code: "CONTROLLED_SOURCE_BODY_READ",
            traceId: randomUUID(),
          },
        }),
      );
      await source()
        .getByRole("button", {
          name: "重读原成果、实际文档与来源",
          exact: true,
        })
        .click();
      await expect(candidate().getByRole("alert")).toContainText(
        "本次完整来源正文读取失败",
      );
      await expect(actualSourceBody()).toHaveCount(0);
      for (let index = 0; index < 5; index++) {
        await expect(checks.nth(index)).not.toBeChecked();
        await expect(checks.nth(index)).toBeDisabled();
      }
      await expect(adopt()).toBeDisabled();
      await running.page.screenshot({
        path: info.outputPath("source-confirm-body-error-no-cache.png"),
      });
      await running.page.unroute(contextPattern);
      await source()
        .getByRole("button", {
          name: "重读原成果、实际文档与来源",
          exact: true,
        })
        .click();
      await expect(actualSourceBody()).toBeVisible();
      for (let index = 0; index < 5; index++) await checks.nth(index).check();
      await expect(adopt()).toBeEnabled();
      let adopted: EpisodeSourceRevision | undefined,
        adoptRequest: { key: string; body: unknown } | undefined;
      const adoptPattern = `**/api/v2/episode-source-revisions/${pending!.id}/adopt`;
      await running.page.route(adoptPattern, async (route) => {
        adoptRequest = {
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postDataJSON(),
        };
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
        adopted = (await response.json()) as EpisodeSourceRevision;
        await route.abort("failed");
      });
      await adopt().click();
      await running.page
        .getByRole("dialog", {
          name: "确认新来源与两份新正式成果？",
          exact: true,
        })
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect.poll(() => adopted?.status).toBe("adopted");
      await expect(
        source().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toBeVisible();
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(exactRoute);
      await expect(
        source().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toContainText(adoptRequest!.key);
      let replayedAdopt: { key: string; body: unknown } | undefined;
      await running.page.route(adoptPattern, async (route) => {
        replayedAdopt = {
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postDataJSON(),
        };
        await route.continue();
      });
      await expect(
        source().getByRole("button", { name: "重放原键与原输入", exact: true }),
      ).toBeEnabled();
      await source()
        .getByRole("button", { name: "重放原键与原输入", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "重放完整原请求？", exact: true })
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(
        source().getByLabel("来源确认原请求恢复", { exact: true }),
      ).toHaveCount(0);
      await expect(candidate()).toContainText("状态 adopted");
      expect(replayedAdopt).toEqual(adoptRequest);
      const newScript = await get<EpisodeDevelopmentResult>(
          `episode-development/${adopted!.results!.script.id}`,
        ),
        newOutline = await get<EpisodeDevelopmentResult>(
          `episode-development/${adopted!.results!.outline.id}`,
        );
      expect(newScript.origin).toBe("human-source-revision");
      expect(newScript.workflowId).toBeUndefined();
      expect(newScript.runIds).toEqual([]);
      expect(newScript.scriptId).toBe(original.scriptId);
      expect(newOutline.content.kind).toBe("episode-outline");
      expect(newOutline.basis.request.direct?.project.version).toBe(
        project.version + 1,
      );
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${original.id}`,
          )
        ).content,
      ).toEqual(original.content);
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${oldOutline.id}`,
          )
        ).content,
      ).toEqual(oldOutline.content);
      expect(
        await get<ScreenplayDocument>(
          `scripts/${original.scriptId}/screenplay`,
        ),
      ).toEqual(manuscript);
      expect(await get<unknown[]>(`projects/${projectId}/chapters`)).toEqual(
        [],
      );
      expect(fixture.calls).toHaveLength(modelCalls);
      expect(fixture.errors).toEqual([]);
      expect(
        await running.application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => !window.isVisible() && !window.isFocused(),
          ),
        ),
      ).toBe(true);
      await running.page.screenshot({
        path: info.outputPath("source-confirm-adopted-original-retained.png"),
      });
    } finally {
      if (running) await running.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

for (const { entryPath, sourceReviewUi, sourceConfirmationUi } of [
  {
    entryPath: "inspiration",
    sourceReviewUi: false,
    sourceConfirmationUi: false,
  },
  { entryPath: "script", sourceReviewUi: false, sourceConfirmationUi: false },
  {
    entryPath: "inspiration",
    sourceReviewUi: true,
    sourceConfirmationUi: false,
  },
  {
    entryPath: "inspiration",
    sourceReviewUi: true,
    sourceConfirmationUi: true,
  },
] as const) {
  test(`${sourceConfirmationUi ? "新来源正式确认后" : ""}${sourceReviewUi ? "完整来源审阅重做普通后台；" : ""}逐镜头人工关联在普通后台界面明确选择 ${entryPath}，存储拒绝零写入、创建与采用丢回复原键重启恢复，精确读取失败隐藏缓存并明确选择实际 ZIP`, async ({}, info) => {
    test.setTimeout(300_000);
    const userData = await mkdtemp(
      join(tmpdir(), "dramaip-shot-attribution-ui-"),
    );
    const fixture = await localModelFixture();
    let running: RunningApp | undefined;
    let releaseOwner: (() => void) | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      await running.page.evaluate(() => {
        window.location.hash = "#/";
      });
      await running.page
        .getByRole("button", {
          name: entryPath === "script" ? "导入已有剧本" : "从创意开始",
          exact: true,
        })
        .click();
      await running.page
        .getByRole("button", { name: "开发剧本 · 单季短剧", exact: true })
        .click();
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill(`逐镜头明确关联独立 ${entryPath}`);
      if (entryPath === "script") {
        await running.page
          .getByRole("textbox", { name: /^已有剧本内容(?:\s|$)/u })
          .fill(
            "INT. 林晚房间 - NIGHT\n\n林晚记下姐姐的警告，核对屏幕上的号码。再次检查。林晚记下姐姐的警告，核对屏幕上的号码。再次检查。\n\nINT. 走廊 - NIGHT\n\n林晚发现线索矛盾，决定出门求证。",
          );
        await running.page
          .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。", {
            exact: true,
          })
          .check();
      } else {
        await running.page
          .getByRole("textbox", { name: "故事构思（可选）", exact: true })
          .fill(
            "林晚接到姐姐警告，记录号码后核对矛盾线索并主动出门；不先写小说。",
          );
      }
      await running.page
        .getByRole("button", { name: "创建单季短剧", exact: true })
        .click();
      await expect(running.page).toHaveURL(/#\/adapt\?projectId=/);
      const projectId = new URLSearchParams(
        new URL(running.page.url()).hash.split("?")[1],
      ).get("projectId")!;
      let get = await runtimeReader(running.page);
      // Fixture setup uses real owner APIs in the test process, not Renderer business code or SQL seeding.
      const write = async <T>(
        path: string,
        input: unknown,
        headers: Record<string, string> = {},
      ): Promise<T> => {
        const bootstrap = await running!.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        );
        const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bootstrap.accessToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            ...headers,
          },
          body: JSON.stringify(input),
        });
        expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(
          true,
        );
        return (await response.json()) as T;
      };
      const episodes = await get<RecordEntity[]>(
          `episodes?projectId=${projectId}`,
        ),
        episodeId = episodes[0]!.id;
      await adoptIntentInUi(running.page, {
        ...INTENT,
        mustKeep: ["姐妹信任与姐姐警告"],
        mustAvoid: ["不强迫先写小说，不补诊断或季纲"],
      });
      const route = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package`;
      const navigate = async (hash: string) => {
        await running!.page.evaluate((value) => {
          window.location.hash = value;
        }, hash);
      };
      await navigate(
        `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-outline`,
      );
      const panel = () =>
        running!.page.getByLabel("单集开发工作台", { exact: true });
      const bible = panel().getByLabel("AI Story Bible", { exact: true });
      await bible
        .getByRole("button", { name: "生成并检查Story Bible", exact: true })
        .click();
      await expect(bible.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        { timeout: 25_000 },
      );
      await bible.getByRole("button", { name: "采用", exact: true }).click();
      await expect(panel()).toContainText("已批准 Story Bible：1 份");
      for (const [tab, label, dialog] of [
        ["单集大纲", "单集大纲", "明确采用单集大纲？"],
        ["标准剧本", "单集标准剧本", "明确采用标准剧本？"],
        ["分镜包", "单集分镜包", "明确采用单集分镜包？"],
      ] as const) {
        await panel().getByRole("button", { name: tab, exact: true }).click();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const workbench = panel().getByLabel(`AI ${label}`, { exact: true });
        await workbench
          .getByRole("button", { name: `生成并检查${label}`, exact: true })
          .click();
        await expect(
          workbench.locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用", { timeout: 25_000 });
        await workbench
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: dialog, exact: true })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel(`正式${tab} v1`, { exact: true }),
        ).toBeVisible();
      }
      const board = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find((value) => value.operation === "storyboard-package")!;
      const source = await get<StoryboardAttributionSource>(
        `projects/${projectId}/storyboard-attribution-sources/${board.id}?version=${board.version}`,
      );
      const shot = source.shots[0]!,
        evidence = source.evidence.find(
          (value) =>
            value.sceneId === shot.sceneId &&
            (entryPath !== "script" || Boolean(value.sourceBlockId)),
        )!;
      let declaration: StoryDeclaration | undefined;
      if (entryPath === "script") {
        expect(source.originalScriptDocument).toBeDefined();
        expect(evidence.sourceBlockId).toBeDefined();
        const original = await get<ScreenplaySource>(
          `projects/${projectId}/screenplay-sources/${source.originalScriptDocument!.scriptId}`,
        );
        if (original.source.state !== "available")
          throw new Error("Actual saved original screenplay missing");
        declaration = await write<StoryDeclaration>(
          `projects/${projectId}/story-declarations`,
          {
            kind: "event",
            title: "实际原稿警告节点",
            statement: "PRIVATE NODE UI 节点解释，关联导出不能包括此正文",
            sources: [
              {
                kind: "screenplay-blocks",
                scriptId: original.scriptId,
                scriptVersion: original.scriptVersion,
                documentId: original.source.document.id,
                documentVersion: original.source.document.version,
                documentContentHash: original.source.contentHash,
                blockIds: [evidence.sourceBlockId],
              },
            ],
          },
        );
        declaration = await write<StoryDeclaration>(
          `projects/${projectId}/story-declarations/${declaration.id}/adopt`,
          {
            sourceFingerprint: declaration.basis.fingerprint,
            confirmedSourceReview: true,
            confirmedInterpretationReview: true,
          },
          { "If-Match": declaration.etag },
        );
        expect(declaration.adoptedNode).toBeDefined();
      }
      const link = () =>
        panel().getByLabel("逐镜头明确来源关联", { exact: true });
      await link()
        .getByRole("button", { name: "打开逐镜头关联审阅", exact: true })
        .click();
      await link()
        .getByRole("button", {
          name: "读取并明确确认当前关联来源",
          exact: true,
        })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确确认逐镜头关联来源", exact: true })
        .getByRole("button", { name: "确认此正式版本来源", exact: true })
        .click();
      await expect(
        link().getByLabel("明确关联镜头", { exact: true }),
      ).toHaveValue("");
      await link()
        .getByLabel("明确关联镜头", { exact: true })
        .selectOption(shot.shotId);
      await expect(
        link().getByLabel(`关联剧本块 ${shot.sourceBlockIds[0]}`, {
          exact: true,
        }),
      ).not.toBeChecked();
      await link()
        .getByLabel(`关联剧本块 ${shot.sourceBlockIds[0]}`, { exact: true })
        .check();
      await link()
        .getByLabel("明确关联引文", { exact: true })
        .selectOption(evidence.evidenceId);
      await expect(
        link().getByLabel("明确引文匹配位置", { exact: true }),
      ).toHaveValue("");
      await expect(
        link().getByLabel("可选关联故事节点", { exact: true }),
      ).toHaveValue("");
      const matchIndex = evidence.matches.length > 1 ? 1 : 0;
      if (entryPath === "script") {
        expect(evidence.matches).toHaveLength(2);
        expect(matchIndex).toBe(1);
        expect(evidence.matches[1]!.start).toBeGreaterThan(
          evidence.matches[0]!.end,
        );
      }
      await link()
        .getByLabel("明确引文匹配位置", { exact: true })
        .selectOption(String(matchIndex));
      await link()
        .getByLabel("人工镜头关联理由", { exact: true })
        .fill("PRIVATE SHOT UI 作者明确原镜头位置，不能导出此理由");
      if (declaration) {
        const nodePath = `**/api/v2/projects/${projectId}/story-declarations/${declaration.id}`;
        await expect(
          link()
            .getByLabel("可选关联故事节点", { exact: true })
            .locator(`option[value="${declaration.id}"]`),
        ).toHaveCount(1);
        await running.page.route(nodePath, async (request) =>
          request.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              status: 503,
              title: "实际节点owner本次不可读",
            }),
          }),
        );
        await link()
          .getByLabel("可选关联故事节点", { exact: true })
          .selectOption(declaration.id);
        await expect(link().getByRole("alert")).toContainText("原节点读取失败");
        await expect(
          link().getByLabel("实际采用节点来源", { exact: true }),
        ).toHaveCount(0);
        await expect(
          link().getByRole("button", {
            name: "加入此镜头的明确关联",
            exact: true,
          }),
        ).toBeDisabled();
        await running.page.unroute(nodePath);
        await expect(
          link().getByLabel("实际采用节点来源", { exact: true }),
        ).toBeVisible();
        await link()
          .getByLabel("实际采用节点来源", { exact: true })
          .locator("summary")
          .click();
        await expect(
          link().getByLabel("实际采用节点来源", { exact: true }),
        ).toContainText("PRIVATE NODE UI");
        await expect(
          link().getByLabel("实际采用节点来源", { exact: true }),
        ).toContainText(evidence.sourceBlockId!);
      }
      await link()
        .getByRole("button", { name: "加入此镜头的明确关联", exact: true })
        .click();
      const storageKey = `dramaip-shot-attribution:${projectId}:${board.id}:${board.version}`;
      const calls = fixture.calls.length;
      let writes = 0;
      const createPath = `**/api/v2/projects/${projectId}/storyboard-attributions`;
      await running.page.route(createPath, async (request) => {
        if (request.request().method() === "POST") writes++;
        await request.continue();
      });
      await running.page.evaluate((key) => {
        const original = Storage.prototype.setItem;
        (
          window as unknown as { restoreShotStorage: () => void }
        ).restoreShotStorage = () => {
          Storage.prototype.setItem = original;
        };
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new Error("controlled quota failure");
          return original.call(this, name, value);
        };
      }, storageKey);
      const saveCandidate = async () => {
        await link()
          .getByRole("button", {
            name: "保存明确关联草稿（尚不采用）",
            exact: true,
          })
          .click();
        await running!.page
          .getByRole("dialog", { name: "保存明确镜头关联草稿", exact: true })
          .getByRole("button", { name: "保存原关联草稿", exact: true })
          .click();
      };
      await saveCandidate();
      await expect(link().getByRole("alert")).toContainText(
        "本机原请求未完整保存",
      );
      expect(writes).toBe(0);
      expect(
        (
          await get<{ items: StoryboardAttribution[] }>(
            `projects/${projectId}/storyboard-attributions`,
          )
        ).items,
      ).toEqual([]);
      await running.page.evaluate(() => {
        (
          window as unknown as { restoreShotStorage: () => void }
        ).restoreShotStorage();
      });
      await running.page.unroute(createPath);
      await running.page.route(createPath, async (request) => {
        if (request.request().method() !== "POST") return request.continue();
        const response = await request.fetch();
        expect(response.status()).toBe(201);
        writes++;
        await request.abort("failed");
      });
      await saveCandidate();
      await expect(
        link().getByLabel("原关联请求待核对", { exact: true }),
      ).toBeVisible();
      const storedCreate = await running.page.evaluate(
        (key) => JSON.parse(window.localStorage.getItem(key)!),
        storageKey,
      );
      const pending = (
        await get<{ items: StoryboardAttribution[] }>(
          `projects/${projectId}/storyboard-attributions`,
        )
      ).items[0]!;
      expect(pending.input.selections[0]!.matchIndex).toBe(matchIndex);
      expect(pending.input.selections[0]!.blockIds).toEqual([
        shot.sourceBlockIds[0],
      ]);
      expect(pending.input.selections[0]!.storyNode).toEqual(
        declaration?.adoptedNode,
      );
      if (declaration) {
        expect(pending.links[0]!.storyNode).toMatchObject({
          node: declaration.adoptedNode,
          declaration: { id: declaration.id, version: declaration.version },
          linkKind: "screenplay-block",
          semanticVerification: "unverified",
        });
      }
      expect(pending).not.toHaveProperty("workflowId");
      expect(writes).toBe(1);
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(route);
      await expect(
        link().getByLabel("原关联请求待核对", { exact: true }),
      ).toBeVisible();
      const createReplays: Array<{ key: string | undefined; body: unknown }> =
        [];
      await running.page.route(createPath, async (request) => {
        if (request.request().method() === "POST")
          createReplays.push({
            key: request.request().headers()["idempotency-key"],
            body: request.request().postDataJSON(),
          });
        await request.continue();
      });
      await link()
        .getByRole("button", { name: "重发原关联请求（不换键）", exact: true })
        .click();
      await expect(
        link().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toContainText(pending.id);
      expect(createReplays).toEqual([
        { key: storedCreate.pending.key, body: storedCreate.pending.input },
      ]);
      expect(
        (
          await get<{ items: StoryboardAttribution[] }>(
            `projects/${projectId}/storyboard-attributions`,
          )
        ).items,
      ).toHaveLength(1);
      const exactRoute = new URL(running.page.url()).hash;
      expect(exactRoute).toContain(`resultId=${board.id}`);
      expect(exactRoute).toContain(`shotAttributionId=${pending.id}`);
      let ownerReads = 0;
      const ownerGate = new Promise<void>((resolveRead) => {
        releaseOwner = resolveRead;
      });
      await running.page.route(
        `**/api/v2/projects/${projectId}/storyboard-attributions/${pending.id}`,
        async (request) => {
          ownerReads++;
          await ownerGate;
          await request.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({ status: 503, title: "原关联owner读取失败" }),
          });
        },
      );
      await navigate(route);
      await expect(
        link().getByRole("button", { name: "打开逐镜头关联审阅", exact: true }),
      ).toBeVisible();
      await navigate(exactRoute);
      await expect.poll(() => ownerReads).toBeGreaterThan(0);
      await expect(
        link().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toHaveCount(0);
      await expect(
        link().getByRole("button", { name: "采用此原镜头关联", exact: true }),
      ).toHaveCount(0);
      await expect(
        link().getByRole("button", {
          name: "读取并明确确认当前关联来源",
          exact: true,
        }),
      ).toBeDisabled();
      releaseOwner!();
      await expect(link().getByRole("alert")).toContainText("原关联读取失败");
      await expect(
        link().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toHaveCount(0);
      await expect(
        link().getByRole("button", {
          name: "读取并明确确认当前关联来源",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        link().getByRole("button", { name: "采用此原镜头关联", exact: true }),
      ).toHaveCount(0);
      await link().scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: info.outputPath("shot-attribution-owner-failed-no-cache.png"),
      });
      await running.page.unroute(
        `**/api/v2/projects/${projectId}/storyboard-attributions/${pending.id}`,
      );
      await link()
        .getByRole("button", { name: "重读此原关联与来源", exact: true })
        .click();
      await expect(
        link().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toBeVisible();
      const decisionPath = `**/api/v2/projects/${projectId}/storyboard-attributions/${pending.id}/decision`;
      await running.page.route(decisionPath, async (request) => {
        const response = await request.fetch();
        expect(response.status()).toBe(200);
        await request.abort("failed");
      });
      for (const label of [
        "已审阅实际来源与具体匹配位置",
        "已核对所选镜头／稳定块／可选节点及未关联范围",
        "理解人工声明和位置规则不证明语义或合法授权",
      ])
        await link().getByLabel(label, { exact: true }).check();
      await link()
        .getByRole("button", { name: "采用此原镜头关联", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确采用原逐镜头关联", exact: true })
        .getByRole("button", { name: "采用此原关联", exact: true })
        .click();
      await expect(
        link().getByLabel("原关联请求待核对", { exact: true }),
      ).toBeVisible();
      const storedDecision = await running.page.evaluate(
        (key) => JSON.parse(window.localStorage.getItem(key)!),
        storageKey,
      );
      expect(
        (
          await get<StoryboardAttribution>(
            `projects/${projectId}/storyboard-attributions/${pending.id}`,
          )
        ).status,
      ).toBe("adopted");
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await navigate(exactRoute);
      await expect(
        link().getByLabel("原关联请求待核对", { exact: true }),
      ).toBeVisible();
      const decisionReplays: Array<{ key: string | undefined; body: unknown }> =
        [];
      await running.page.route(decisionPath, async (request) => {
        decisionReplays.push({
          key: request.request().headers()["idempotency-key"],
          body: request.request().postDataJSON(),
        });
        await request.continue();
      });
      await link()
        .getByRole("button", { name: "重发原关联请求（不换键）", exact: true })
        .click();
      await expect(
        link().getByLabel("原关联请求待核对", { exact: true }),
      ).toHaveCount(0);
      await expect(
        link().getByLabel("精确原镜头关联候选", { exact: true }),
      ).toContainText("当前明确采用");
      expect(decisionReplays).toEqual([
        { key: storedDecision.pending.key, body: storedDecision.pending.input },
      ]);
      await link().scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: info.outputPath("shot-attribution-adopted-after-restart.png"),
      });
      const adopted = await get<StoryboardAttribution>(
        `projects/${projectId}/storyboard-attributions/${pending.id}`,
      );
      await navigate(route);
      const impact = () =>
        panel()
          .getByLabel("正式分镜包 v1", { exact: true })
          .getByLabel("分镜实际变化影响", { exact: true });
      await impact()
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      const impactSelection = () =>
        impact().getByLabel("影响观察原关联版本", { exact: true });
      await expect(impactSelection()).toHaveValue("");
      await expect(
        impactSelection().locator(
          `option[value="${adopted.id}:${adopted.version}"]`,
        ),
      ).toHaveCount(1);
      await expect(
        impact().getByLabel("原人工关联逐链接影响", { exact: true }),
      ).toHaveCount(0);
      await impactSelection().selectOption(`${adopted.id}:${adopted.version}`);
      const impactPattern = `**/api/v2/episode-development/${board.id}/impact?*`;
      const impactRequests: string[] = [];
      let releaseImpact!: () => void;
      const heldImpact = new Promise<void>((resolveRead) => {
        releaseImpact = resolveRead;
      });
      releaseOwner = releaseImpact;
      await running.page.route(impactPattern, async (request) => {
        impactRequests.push(new URL(request.request().url()).search);
        await heldImpact;
        await request.continue();
      });
      await impact()
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      await expect.poll(() => impactRequests.length).toBe(1);
      await expect(
        impact().getByLabel("原人工关联逐链接影响", { exact: true }),
      ).toHaveCount(0);
      releaseImpact();
      releaseOwner = undefined;
      const impactView = () =>
        impact().getByLabel("原人工关联逐链接影响", { exact: true });
      await expect(impactView()).toContainText(adopted.id);
      expect(impactRequests).toEqual([
        `?attributionId=${adopted.id}&attributionVersion=${adopted.version}`,
      ]);
      await impactView().locator("summary").first().click();
      await expect(impactView()).toContainText(
        `明确匹配位置 ${matchIndex + 1}`,
      );
      await expect(impactView()).toContainText(
        "原明确位置逐字一致（不是语义安全）",
      );
      await expect(impactView()).not.toContainText("PRIVATE SHOT UI");
      await expect(impactView()).not.toContainText("PRIVATE NODE UI");
      if (declaration)
        await expect(impactView()).toContainText(declaration.adoptedNode!.id);
      else
        await expect(impactView()).toContainText(
          "原链接未选择故事节点，不自动添加",
        );
      await running.page.unroute(impactPattern);
      await running.page.route(impactPattern, async (request) =>
        request.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            status: 503,
            title: "本次明确原关联影响读取失败",
          }),
        }),
      );
      await impact()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impact().getByRole("alert")).toContainText(
        "影响清单读取失败，旧缓存不能作为本轮核对结果",
      );
      await expect(impactView()).toHaveCount(0);
      await expect(impactSelection()).toHaveValue(
        `${adopted.id}:${adopted.version}`,
      );
      await impact().scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: info.outputPath("attribution-impact-owner-error-no-cache.png"),
      });
      await running.page.unroute(impactPattern);
      await impact()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impactView()).toContainText(adopted.id);
      let impactOriginal = await get<EpisodeDevelopmentImpact>(
        `episode-development/${board.id}/impact?attributionId=${adopted.id}&attributionVersion=${adopted.version}`,
      );
      expect(impactOriginal.attributionImpact!.links[0]!.original).toEqual(
        adopted.links[0],
      );
      await running.page.route(impactPattern, async (request) =>
        request.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...impactOriginal,
            attributionImpact: {
              ...impactOriginal.attributionImpact,
              attribution: { id: adopted.id, version: adopted.version + 1 },
            },
          }),
        }),
      );
      await impact()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impact().getByRole("alert")).toContainText(
        "影响清单读取失败",
      );
      await expect(impactView()).toHaveCount(0);
      await running.page.unroute(impactPattern);
      await impact()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impactView()).toContainText(adopted.id);
      const pilotPath = join(userData, "explicit-shot-attribution.zip");
      await running.application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, pilotPath);
      await navigate(route);
      await panel()
        .getByLabel("正式分镜包 v1", { exact: true })
        .getByRole("button", { name: "预览内部试制包", exact: true })
        .click();
      const pilot = () =>
        running!.page.getByRole("dialog", {
          name: "核验并保存内部试制包",
          exact: true,
        });
      await expect(
        pilot().getByLabel("试制包明确镜头关联", { exact: true }),
      ).toHaveValue("");
      await expect(
        pilot()
          .getByLabel("试制包明确镜头关联", { exact: true })
          .locator(`option[value="${adopted.id}"]`),
      ).toHaveCount(1);
      await pilot()
        .getByLabel("试制包明确镜头关联", { exact: true })
        .selectOption(adopted.id);
      await pilot()
        .getByRole("button", { name: "生成统一试制包预览", exact: true })
        .click();
      await expect(pilot()).toContainText("待明确确认");
      for (const label of [
        "我确认这些正式版本，并有权导出这份试制包",
        "我确认此包仅用于内部试制审阅，不作为发行就绪证明",
        "我已知悉质量、授权范围、费用与上述缺失项尚未全部核验",
      ])
        await pilot().getByLabel(label, { exact: true }).check();
      await pilot()
        .getByRole("button", { name: "确认并保存 ZIP 试制包", exact: true })
        .click();
      await expect(pilot()).toContainText("试制包已保存并核验。");
      const saved = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items.find((value) => value.status === "saved")!;
      expect(saved.manifest.adopted.shotAttribution).toEqual({
        id: adopted.id,
        version: adopted.version,
      });
      const archive = unzipSync(await readFile(pilotPath)),
        exported = JSON.parse(strFromU8(archive["shot-attributions.json"]!));
      expect(exported.attribution).toEqual({
        id: adopted.id,
        version: adopted.version,
      });
      expect(exported.links[0].matchIndex).toBe(matchIndex);
      expect(exported.links[0].blockIds).toEqual([shot.sourceBlockIds[0]]);
      expect(exported.textIncluded).toBe(false);
      expect(exported.semanticVerification).toBe("unverified");
      expect(strFromU8(archive["shot-attributions.json"]!)).not.toContain(
        "PRIVATE SHOT UI",
      );
      expect(exported).not.toHaveProperty("input");
      expect(strFromU8(archive["shot-attributions.json"]!)).not.toContain(
        "PRIVATE NODE UI",
      );
      if (declaration) {
        expect(exported.links[0].storyNode.node).toEqual(
          declaration.adoptedNode,
        );
        expect(exported.links[0].storyNode.linkKind).toBe("screenplay-block");
        await write(
          `projects/${projectId}/story-declarations/${declaration.id}/withdraw`,
          {
            lifecycleVersion: declaration.lifecycle?.version ?? 0,
            record: { kind: "node", ...declaration.adoptedNode! },
            reason: "作者撤回实际节点，旧关联须保留但失效",
            confirmedRetirementReview: true,
          },
          { "If-Match": declaration.etag },
        );
        const stale = await get<StoryboardAttribution>(
          `projects/${projectId}/storyboard-attributions/${adopted.id}`,
        );
        expect(stale.sourceState).toBe("stale");
        expect(stale.input).toEqual(adopted.input);
        expect(stale.links).toEqual(adopted.links);
        expect(stale.isCurrent).toBe(true); // Historical adopted position remains; source validity is separate.
        expect(
          (await get<PilotPackagePreview>(`pilot-packages/${saved.id}`))
            .sourceState,
        ).toBe("stale");
        expect(unzipSync(await readFile(pilotPath))).toEqual(archive);
        await pilot()
          .getByRole("button", { name: "关闭试制预览", exact: true })
          .click();
        await navigate(exactRoute);
        await expect(
          link().getByLabel("精确原镜头关联候选", { exact: true }),
        ).toContainText("来源 stale");
        await expect(
          link().getByLabel("精确原镜头关联候选", { exact: true }),
        ).toContainText(declaration.adoptedNode!.id);
        await link().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: info.outputPath(
            "shot-attribution-node-withdrawn-preserves-original.png",
          ),
        });
        await impact()
          .getByRole("button", { name: "核对变化影响", exact: true })
          .click();
        await expect(impactSelection()).toHaveValue("");
        await expect(
          impactSelection().locator(
            `option[value="${adopted.id}:${adopted.version}"]`,
          ),
        ).toHaveCount(1);
        await impactSelection().selectOption(
          `${adopted.id}:${adopted.version}`,
        );
        await impact()
          .getByRole("button", { name: "核对变化影响", exact: true })
          .click();
        await expect(impactView()).toContainText(adopted.id);
        await impactView().locator("summary").first().click();
        await expect(impactView()).toContainText("原节点采用已明确撤回");
        await expect(impactView()).toContainText(declaration.adoptedNode!.id);
        await expect(impactView()).toContainText(
          `明确匹配位置 ${matchIndex + 1}`,
        );
        await impactView().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: info.outputPath(
            "attribution-impact-node-withdrawn-original-link.png",
          ),
        });
      }
      expect(await get(`projects/${projectId}/chapters`)).toEqual([]);
      expect(
        (await get<{ items: unknown[] }>(`projects/${projectId}/diagnoses`))
          .items,
      ).toEqual([]);
      expect(
        (await get<{ items: unknown[] }>(`projects/${projectId}/season-plans`))
          .items,
      ).toEqual([]);
      expect(fixture.calls).toHaveLength(calls);
      expect(fixture.errors).toEqual([]);
      if (sourceReviewUi) {
        await pilot()
          .getByRole("button", { name: "关闭试制预览", exact: true })
          .click();
        let confirmedSource: EpisodeSourceRevision | undefined;
        if (sourceConfirmationUi) {
          const originals = (
            await get<{ items: EpisodeDevelopmentResult[] }>(
              `projects/${projectId}/episode-development`,
            )
          ).items;
          const originalScript = originals.find(
              (value) =>
                value.operation === "episode-script" && value.isCurrent,
            )!,
            originalOutline = originals.find(
              (value) =>
                value.operation === "episode-outline" && value.isCurrent,
            )!;
          const retainedDocument = await get<ScreenplayDocument>(
              `scripts/${originalScript.scriptId}/screenplay`,
            ),
            retainedShots = await get<RecordEntity[]>(
              `shots?projectId=${projectId}`,
            ),
            retainedScenes = await get<RecordEntity[]>(
              `scenes?projectId=${projectId}`,
            );
          const project = await get<{
            id: string;
            version: number;
            synopsis: string;
          }>(`projects/${projectId}`);
          const bootstrap = await running.page.evaluate(() =>
            window.runtimeBootstrap.resolve(),
          );
          const changed = await fetch(
            `${bootstrap.baseUrl}/api/v2/projects/${projectId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${bootstrap.accessToken}`,
                "Content-Type": "application/json",
                "If-Match": `"${project.version}"`,
                "Idempotency-Key": randomUUID(),
              },
              body: JSON.stringify({
                version: project.version,
                synopsis: `${project.synopsis}\n作者明确补充：保留原稿和原关联，独立审阅新来源后只重做明确选中镜头。`,
              }),
            },
          );
          expect(changed.ok, await changed.clone().text()).toBe(true);
          await navigate("#/pending");
          await expect(
            running.page.getByRole("heading", {
              name: "待确认中心",
              exact: true,
            }),
          ).toBeVisible();
          await navigate(
            `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-script`,
          );
          const sourcePanel = () =>
            panel().getByLabel("新来源正式确认", { exact: true });
          await sourcePanel()
            .getByRole("button", { name: "新来源正式确认", exact: true })
            .click();
          await sourcePanel()
            .getByRole("button", {
              name: "明确新来源，准备完整审阅草稿",
              exact: true,
            })
            .click();
          await sourcePanel()
            .getByRole("button", {
              name: "明确更新所选同一来源 ID 的场景引用版本",
              exact: true,
            })
            .click();
          await sourcePanel()
            .getByLabel("新来源大纲本集目标", { exact: true })
            .fill("保留实际原稿与旧镜头，明确新来源后独立审阅全部镜头。");
          const createdResponse = running.page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                `/api/v2/episode-development/${originalScript.id}/source-revision-previews`,
          );
          await sourcePanel()
            .getByRole("button", {
              name: "创建完整新来源预览（不调用模型）",
              exact: true,
            })
            .click();
          const created = await createdResponse;
          expect(created.status()).toBe(200);
          const preview = (await created.json()) as EpisodeSourceRevision;
          const candidate = () =>
            sourcePanel().getByLabel("本次读取的新来源预览", { exact: true });
          const actualBody = candidate().getByLabel("本次完整实际来源正文", {
            exact: true,
          });
          await expect(actualBody).toBeVisible();
          for (const summary of await actualBody
            .locator("details > summary")
            .all())
            await summary.click();
          await expect(actualBody).toContainText(
            "独立审阅新来源后只重做明确选中镜头",
          );
          const confirm = candidate().getByRole("button", {
            name: "独立采用新来源与两份正式成果",
            exact: true,
          });
          await expect(confirm).toBeDisabled();
          const checks = candidate().getByRole("checkbox");
          await expect(checks).toHaveCount(5);
          for (let index = 0; index < 4; index++) {
            await expect(checks.nth(index)).not.toBeChecked();
            await checks.nth(index).check();
          }
          await expect(confirm).toBeDisabled();
          await expect(checks.nth(4)).not.toBeChecked();
          await checks.nth(4).check();
          let adoptedResponseValue: EpisodeSourceRevision | undefined;
          const sourceRequests: Array<{
            method: string;
            path: string;
            status: number;
          }> = [];
          running.page.on("response", async (response) => {
            const path = new URL(response.url()).pathname;
            if (!path.startsWith("/api/v2/episode-source-revisions/")) return;
            sourceRequests.push({
              method: response.request().method(),
              path,
              status: response.status(),
            });
            if (
              response.request().method() === "POST" &&
              path === `/api/v2/episode-source-revisions/${preview.id}/adopt` &&
              response.ok()
            )
              adoptedResponseValue =
                (await response.json()) as EpisodeSourceRevision;
          });
          await confirm.click();
          await expect
            .poll(
              async () => ({
                dialogs: await running!.page
                  .getByRole("dialog", {
                    name: "确认新来源与两份新正式成果？",
                    exact: true,
                  })
                  .count(),
                alerts: await sourcePanel()
                  .getByRole("alert")
                  .allTextContents(),
              }),
              { timeout: 5_000 },
            )
            .toEqual({ dialogs: 1, alerts: [] });
          await running.page
            .getByRole("dialog", {
              name: "确认新来源与两份新正式成果？",
              exact: true,
            })
            .getByRole("button", { name: "确认", exact: true })
            .click();
          await expect
            .poll(
              async () => ({
                adopted: Boolean(adoptedResponseValue),
                alerts: await sourcePanel()
                  .getByRole("alert")
                  .allTextContents(),
                sourceRequests,
              }),
              { timeout: 10_000 },
            )
            .toMatchObject({ adopted: true, alerts: [] });
          confirmedSource = adoptedResponseValue!;
          expect(confirmedSource.status).toBe("adopted");
          const currentScript = await get<EpisodeDevelopmentResult>(
              `episode-development/${confirmedSource.results!.script.id}`,
            ),
            currentOutline = await get<EpisodeDevelopmentResult>(
              `episode-development/${confirmedSource.results!.outline.id}`,
            );
          expect(currentScript.origin).toBe("human-source-revision");
          expect(currentScript.scriptId).toBe(originalScript.scriptId);
          expect(currentScript.runIds).toEqual([]);
          expect(currentScript.sourceContextIntegrity).toEqual({
            snapshotId: preview.sourceSnapshotId,
            manifestSha256: preview.sourceManifestHash,
            finalPromptSha256: preview.sourcePromptHash,
          });
          expect(
            await get<ScreenplayDocument>(
              `scripts/${originalScript.scriptId}/screenplay`,
            ),
          ).toEqual(retainedDocument);
          expect(
            await get<RecordEntity[]>(`shots?projectId=${projectId}`),
          ).toEqual(retainedShots);
          expect(
            await get<RecordEntity[]>(`scenes?projectId=${projectId}`),
          ).toEqual(retainedScenes);
          expect(fixture.calls).toHaveLength(calls);
          impactOriginal = await get<EpisodeDevelopmentImpact>(
            `episode-development/${board.id}/impact?attributionId=${adopted.id}&attributionVersion=${adopted.version}`,
          );
          expect(impactOriginal.confirmedSourceTransition).toMatchObject({
            originalOutline: {
              id: originalOutline.id,
              version: originalOutline.version,
            },
            originalScript: {
              id: originalScript.id,
              version: originalScript.version,
            },
            currentOutline: {
              id: currentOutline.id,
              version: currentOutline.version,
            },
            currentScript: {
              id: currentScript.id,
              version: currentScript.version,
            },
            document: {
              id: retainedDocument.id,
              version: retainedDocument.version,
            },
            confirmationPreviews: [
              { id: preview.id, version: confirmedSource.stateVersion },
            ],
            completeAuthorReviewRequired: true,
            semanticVerification: "unverified",
          });
          expect(impactOriginal.globalReviewReasons.length).toBeGreaterThan(0);
          expect(impactOriginal.attributionImpact!.links[0]!.original).toEqual(
            adopted.links[0],
          );
          expect(
            impactOriginal.attributionImpact!.links[0]!.associationImpact,
          ).toBe("affected");
        }
        await navigate(route);
        const range = () =>
          panel().getByLabel("局部分镜重做范围", { exact: true });
        // The changed actual synopsis affects the original linked expression.
        // Its other shot is unassociated, so the new-source review must not
        // silently retain that uncovered scope. Both are explicitly selected.
        const selectedForRedo = sourceConfirmationUi
          ? impactOriginal.shots.map((actual) => actual.shotId)
          : [shot.shotId];
        for (const shotId of selectedForRedo)
          await range()
            .getByRole("checkbox", {
              name: new RegExp(`^重做 ${shotId} ·`, "u"),
            })
            .check();
        await range()
          .getByLabel("将明确原关联影响审阅绑定本轮局部重做", { exact: true })
          .check();
        const reviewImpact = () =>
          range().getByLabel("分镜实际变化影响", { exact: true });
        await reviewImpact()
          .getByRole("button", { name: "核对变化影响", exact: true })
          .click();
        await expect(
          reviewImpact().getByLabel("影响观察原关联版本", { exact: true }),
        ).toHaveValue("");
        await reviewImpact()
          .getByLabel("影响观察原关联版本", { exact: true })
          .selectOption(`${adopted.id}:${adopted.version}`);
        await reviewImpact()
          .getByRole("button", { name: "核对变化影响", exact: true })
          .click();
        const composer = () =>
          reviewImpact().getByLabel("完整来源影响审阅", { exact: true });
        await expect(composer()).toContainText("未关联，不等于未变化");
        if (confirmedSource) {
          await expect(composer()).toContainText("机械受影响，必须明确重做");
          const transition = () =>
            reviewImpact().getByLabel("本次实际来源确认链", { exact: true });
          await expect(transition()).toBeVisible();
          await transition().locator("summary").click();
          await expect(transition()).toContainText(confirmedSource.id);
          await expect(transition()).toContainText(
            confirmedSource.results!.script.id,
          );
          await expect(transition()).toContainText(
            "未知范围继续拒绝，不自动选镜头",
          );
          await expect(transition()).not.toContainText("PRIVATE SHOT UI");
          await expect(transition()).not.toContainText(
            "PRIVATE MODEL DECLARED SCENE ATTRIBUTION",
          );
          await running.page.screenshot({
            path: info.outputPath(
              "actual-source-transition-complete-review-required.png",
            ),
          });
        }
        const reviewLabels = [
          "我已核对明确的原关联身份与版本",
          "我已审阅本次完整实际影响观察",
          "我已逐一决定全部实际镜头的重做或保留",
          "我已单独核对未关联范围，未将其当作未变化",
          "我知悉机械观察与作者确认不证明语义安全",
        ];
        const fillReview = async () => {
          for (const actual of impactOriginal.shots)
            await composer()
              .getByLabel(`来源审阅镜头决定 ${actual.shotId}`, { exact: true })
              .selectOption(
                selectedForRedo.includes(actual.shotId) ? "redo" : "retain",
              );
          for (const label of reviewLabels.slice(0, 4))
            await composer().getByLabel(label, { exact: true }).check();
          await expect(
            composer().getByRole("button", {
              name: "冻结本次完整来源审阅",
              exact: true,
            }),
          ).toBeDisabled();
          await composer()
            .getByLabel(reviewLabels[4]!, { exact: true })
            .check();
          await composer()
            .getByRole("button", { name: "冻结本次完整来源审阅", exact: true })
            .click();
          await expect(composer().getByRole("status")).toContainText(
            "完整来源审阅已冻结",
          );
        };
        for (const actual of impactOriginal.shots)
          await expect(
            composer().getByLabel(`来源审阅镜头决定 ${actual.shotId}`, {
              exact: true,
            }),
          ).toHaveValue("");
        await fillReview();
        await running.page.route(impactPattern, async (request) =>
          request.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              status: 503,
              title: "完整来源审阅本次读取失败",
            }),
          }),
        );
        await reviewImpact()
          .getByRole("button", { name: "重新核对变化影响", exact: true })
          .click();
        await expect(composer()).toHaveCount(0);
        await expect(
          reviewImpact().getByLabel("本次实际来源确认链", { exact: true }),
        ).toHaveCount(0);
        await expect(
          panel().getByLabel("AI 单集分镜包", { exact: true }),
        ).toHaveCount(0);
        await running.page.unroute(impactPattern);
        await reviewImpact()
          .getByRole("button", { name: "重新核对变化影响", exact: true })
          .click();
        for (const label of reviewLabels)
          await expect(
            composer().getByLabel(label, { exact: true }),
          ).not.toBeChecked();
        await fillReview();
        await composer().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: info.outputPath("full-source-review-explicit-scope.png"),
        });
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const basisKey = `dramaip-episode-development-basis:${projectId}`;
        await expect
          .poll(async () =>
            running!.page.evaluate(
              (key) =>
                JSON.parse(localStorage.getItem(key) ?? "null")?.request
                  ?.redoSourceReview,
              basisKey,
            ),
          )
          .not.toBeUndefined();
        const savedBasis = await running.page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!),
          basisKey,
        );
        const originalReview = savedBasis.request.redoSourceReview;
        expect(originalReview.attribution).toEqual({
          id: adopted.id,
          version: adopted.version,
        });
        expect(originalReview.impactHash).toBe(impactOriginal.snapshotHash);
        expect(originalReview.shots).toHaveLength(impactOriginal.shots.length);
        expect(
          originalReview.shots
            .filter((value: { decision: string }) => value.decision === "redo")
            .map((value: { shotId: string }) => value.shotId),
        ).toEqual(selectedForRedo);
        const oldShots = await get<RecordEntity[]>(
            `shots?projectId=${projectId}`,
          ),
          oldScenes = await get<RecordEntity[]>(
            `scenes?projectId=${projectId}`,
          ),
          oldManuscript = await get<ScreenplayDocument>(
            `scripts/${board.scriptId}/screenplay`,
          );
        const workbench = () =>
          panel().getByLabel("AI 单集分镜包", { exact: true });
        await expect(workbench()).toBeVisible();
        await workbench()
          .getByLabel("AI 创作要求", { exact: true })
          .fill("完整来源审阅原要求：只改明确选中镜头，不补来源或媒体。");
        const createPattern = "**/api/v2/workflows/creation";
        const creates: { key: string | undefined; body: unknown }[] = [];
        running.page.on("request", (request) => {
          if (
            new URL(request.url()).pathname === "/api/v2/workflows/creation" &&
            request.method() === "POST"
          )
            creates.push({
              key: request.headers()["idempotency-key"],
              body: request.postDataJSON(),
            });
        });
        await running.page.evaluate(() => {
          const original = Storage.prototype.setItem;
          (
            window as unknown as { restoreSourceRedoStorage(): void }
          ).restoreSourceRedoStorage = () => {
            Storage.prototype.setItem = original;
          };
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith("dramaip-source-redo-start:"))
              throw new Error("Source redo storage denied");
            return original.call(this, key, value);
          };
        });
        await workbench()
          .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
          .click();
        await expect(workbench().getByRole("alert")).toContainText(
          "操作未能完成，请稍后重试。",
        );
        expect(creates).toHaveLength(0);
        expect(fixture.calls).toHaveLength(calls);
        await running.page.evaluate(() =>
          (
            window as unknown as { restoreSourceRedoStorage(): void }
          ).restoreSourceRedoStorage(),
        );
        let createdId = "";
        await running.page.route(createPattern, async (request) => {
          const response = await request.fetch();
          expect(response.ok()).toBe(true);
          createdId = ((await response.json()) as CreationWorkflow).id;
          await request.abort("failed");
        });
        await workbench()
          .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
          .click();
        await expect.poll(() => createdId).not.toBe("");
        await expect(
          workbench().getByLabel("原来源重做创建请求待核对", { exact: true }),
        ).toBeVisible();
        expect(creates).toHaveLength(1);
        const pendingStartKey = `dramaip-source-redo-start:${projectId}:${episodeId}`;
        const originalStart = await running.page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!),
          pendingStartKey,
        );
        expect(creates[0]).toEqual({
          key: originalStart.key,
          body: originalStart.input,
        });
        await expect
          .poll(
            async () =>
              (await get<CreationWorkflow>(`workflows/creation/${createdId}`))
                .stage,
          )
          .toBe("awaiting-review");
        const modelCallsAfterCreate = fixture.calls.length;
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await navigate(route);
        await expect(workbench()).toHaveCount(0);
        await panel()
          .getByRole("button", {
            name: "恢复本机原来源审阅请求（不换基准）",
            exact: true,
          })
          .click();
        await expect(
          workbench().getByLabel("原来源重做创建请求待核对", { exact: true }),
        ).toContainText(originalStart.key);
        await workbench()
          .getByLabel("AI 创作要求", { exact: true })
          .fill("新要求不能改变待核对原请求");
        const replay: { key: string | undefined; body: unknown }[] = [];
        const replayResponses: {
          status: number;
          valid: boolean;
          issues: unknown;
          origin: string | undefined;
          allowedOrigin: string | undefined;
        }[] = [];
        const replayFailures: string[] = [];
        const replayConsole: string[] = [];
        running.page.on("requestfailed", (request) => {
          if (new URL(request.url()).pathname === "/api/v2/workflows/creation")
            replayFailures.push(request.failure()?.errorText ?? "unknown");
        });
        running.page.on("console", (event) => {
          if (
            event.type() === "error" &&
            /CORS|net::ERR|fetch/iu.test(event.text())
          )
            replayConsole.push(
              event.text().replace(/https?:\/\/[^\s'"<>]+/gu, "[local-url]"),
            );
        });
        running.page.on("response", async (response) => {
          const request = response.request();
          if (
            new URL(request.url()).pathname !== "/api/v2/workflows/creation" ||
            request.method() !== "POST"
          )
            return;
          const parsed = CreationWorkflowSchema.safeParse(
            await response.json().catch(() => undefined),
          );
          const headers = await request.allHeaders();
          replayResponses.push({
            status: response.status(),
            valid: parsed.success,
            origin: headers["origin"],
            allowedOrigin: response.headers()["access-control-allow-origin"],
            issues: parsed.success
              ? []
              : parsed.error.issues.map((issue) => ({
                  code: issue.code,
                  path: issue.path,
                })),
          });
        });
        running.page.on("request", (request) => {
          if (
            new URL(request.url()).pathname === "/api/v2/workflows/creation" &&
            request.method() === "POST"
          )
            replay.push({
              key: request.headers()["idempotency-key"],
              body: request.postDataJSON(),
            });
        });
        await workbench()
          .getByRole("button", {
            name: "重发原来源重做创建请求（不换键）",
            exact: true,
          })
          .click();
        await expect
          .poll(() =>
            replayResponses.map(
              ({ origin: _origin, allowedOrigin: _allowed, ...value }) => value,
            ),
          )
          .toEqual([{ status: 200, valid: true, issues: [] }]);
        await expect
          .poll(() => ({
            failures: replayFailures,
            console: replayConsole,
            originsMatch: replayResponses.every(
              (value) =>
                typeof value.origin === "string" &&
                value.origin === value.allowedOrigin,
            ),
          }))
          .toEqual({ failures: [], console: [], originsMatch: true });
        await info.attach("original-start-replay-response-metadata", {
          body: JSON.stringify(replayResponses),
          contentType: "application/json",
        });
        await expect(
          workbench().getByLabel("原来源重做创建请求待核对", { exact: true }),
        ).toHaveCount(0);
        expect(replay).toEqual([
          { key: originalStart.key, body: originalStart.input },
        ]);
        expect(fixture.calls).toHaveLength(modelCallsAfterCreate);
        const workflow = await get<CreationWorkflow>(
          `workflows/creation/${createdId}`,
        );
        const { model: _resolved, ...actualInput } = workflow.input;
        const { model: _requested, ...originalInput } = originalStart.input;
        expect(actualInput).toEqual(originalInput);
        expect(workflow.creationRequestReceipt).toEqual({
          format: "creation-request-receipt-v1",
          key: originalStart.key,
          requestHash: createHash("sha256")
            .update(JSON.stringify({ input: originalStart.input }))
            .digest("hex"),
        });
        expect(
          workflow.episodeDevelopmentBasis?.storyboardRedo?.sourceReview
            ?.review,
        ).toEqual(originalReview);
        await navigate(`${route}&workflowId=${createdId}`);
        await expect(
          range().getByLabel("将明确原关联影响审阅绑定本轮局部重做", {
            exact: true,
          }),
        ).toBeChecked();
        await expect(
          workbench().getByLabel("冻结完整来源审阅", { exact: true }),
        ).toContainText(adopted.id);
        const commitPattern = `**/api/v2/change-previews/${workflow.previewId}/commit`;
        let committed = false;
        await running.page.route(commitPattern, async (request) => {
          const response = await request.fetch();
          expect(response.ok()).toBe(true);
          committed = true;
          await request.abort("failed");
        });
        await workbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "明确采用选中镜头局部重做？",
            exact: true,
          })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect.poll(() => committed).toBe(true);
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await navigate(route);
        await expect(
          panel().getByLabel("正式分镜包 v2", { exact: true }),
        ).toBeVisible();
        const formal = (
          await get<{ items: EpisodeDevelopmentResult[] }>(
            `projects/${projectId}/episode-development`,
          )
        ).items.find(
          (value) =>
            value.operation === "storyboard-package" && value.isCurrent,
        )!;
        expect(formal.storyboardRedo?.sourceReview?.review).toEqual(
          originalReview,
        );
        if (confirmedSource) {
          expect(
            await get<EpisodeSourceRevision>(
              `episode-source-revisions/${confirmedSource.id}`,
            ),
          ).toEqual(confirmedSource);
          expect(formal.basis.request.script).toEqual(
            confirmedSource.results!.script,
          );
          expect(formal.basis.request.outline).toEqual(
            confirmedSource.results!.outline,
          );
          expect(
            (
              await get<EpisodeDevelopmentResult>(
                `episode-development/${board.id}`,
              )
            ).sourceState,
          ).toBe("stale");
        }
        expect(
          (await get<CreationWorkflow>(`workflows/creation/${createdId}`))
            .stage,
        ).toBe("applied");
        const actualShots = await get<RecordEntity[]>(
            `shots?projectId=${projectId}`,
          ),
          selectedRecords = new Set<string>(
            originalReview.shots
              .filter(
                (value: { decision: string }) => value.decision === "redo",
              )
              .map((value: { record: { id: string } }) => value.record.id),
          );
        for (const actual of oldShots.filter(
          (value) => !selectedRecords.has(value.id),
        ))
          expect(actualShots.find((value) => value.id === actual.id)).toEqual(
            actual,
          );
        expect(
          await get<ScreenplayDocument>(`scripts/${board.scriptId}/screenplay`),
        ).toEqual(oldManuscript);
        const actualScenes = await get<RecordEntity[]>(
          `scenes?projectId=${projectId}`,
        );
        const selectedSceneRecords = new Set(
          source.shots
            .filter((value) => selectedForRedo.includes(value.shotId))
            .map((value) => value.sceneRecord.id),
        );
        for (const actual of oldScenes.filter(
          (value) => !selectedSceneRecords.has(value.id),
        ))
          expect(actualScenes.find((value) => value.id === actual.id)).toEqual(
            actual,
          );
        expect(
          (
            await get<EpisodeDevelopmentResult>(
              `episode-development/${board.id}`,
            )
          ).content,
        ).toEqual(board.content);
        expect(fixture.calls).toHaveLength(modelCallsAfterCreate);
        expect(fixture.errors).toEqual([]);
        expect(
          await running.application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every(
              (window) => !window.isVisible() && !window.isFocused(),
            ),
          ),
        ).toBe(true);
        await running.page.screenshot({
          path: info.outputPath("full-source-review-adopted-restart.png"),
        });
      }
      expect(
        await running.application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => !window.isVisible() && !window.isFocused(),
          ),
        ),
      ).toBe(true);
    } finally {
      releaseOwner?.();
      await running?.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

test("制作明确来源在普通后台界面确认真实原文与段落，首读错误不信缓存，重启保留原选择且来源变化不换源采用", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-production-narrative-ui-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined,
    manager: ServerConnectionManager | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    const connect = async () => {
      manager = new ServerConnectionManager();
      await manager.attach({
        ...(await running!.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        )),
        source: "spawned",
      });
      return createStudioClient(manager.createTransport());
    };
    let client = await connect();
    const { project } = await client.projects.create({
      title: "明确制作来源，不认证语义质量",
    });
    const first = await client.chapters.create({
      projectId: project.id,
      title: "第一章明确原文",
      content: "PRIVATE_PRODUCTION_UI_ORIGINAL。",
    });
    await client.chapters.create({
      projectId: project.id,
      title: "第二章未选",
      content: "PRIVATE_PRODUCTION_UI_OMITTED_SECOND。",
    });
    await client.chapters.create({
      projectId: project.id,
      title: "第三章未选",
      content: "PRIVATE_PRODUCTION_UI_OMITTED_THIRD。",
    });
    const fourth = await client.chapters.create({
      projectId: project.id,
      title: "第四章明确段落",
      content:
        "PRIVATE_PRODUCTION_UI_PARAGRAPH。\n\nPRIVATE_PRODUCTION_UI_UNSELECTED_TAIL。",
    });
    const adaptation = await client.resources.create("adaptations", {
      projectId: project.id,
      title: "原改编",
      payload: {},
    });
    const episode = await client.resources.create("episodes", {
      projectId: project.id,
      parentId: adaptation.id,
      title: "原分集",
      payload: {},
    });
    const route = `/adapt?projectId=${project.id}&adaptationId=${adaptation.id}&episodeId=${episode.id}&stage=episodes`;
    const navigate = (hash: string) =>
      running!.page.evaluate((value) => {
        window.location.hash = value;
      }, hash);
    const compatibility = () =>
      running!.page.getByLabel("旧 episode 兼容路径", { exact: true });
    const sources = () =>
      compatibility().getByLabel("本轮制作来源选择", { exact: true });
    const generate = () =>
      compatibility().getByRole("button", {
        name: "生成并检查本集剧本与分镜（旧 episode 兼容）",
        exact: true,
      });
    const openCompatibility = async () => {
      await expect(compatibility()).toBeVisible();
      if ((await compatibility().getAttribute("open")) === null)
        await compatibility()
          .locator("summary")
          .filter({ hasText: "旧版流程：一次生成本集剧本与分镜" })
          .click();
    };
    await navigate(route);
    await openCompatibility();
    await expect(sources()).not.toHaveAttribute("open");
    await expect(generate()).toBeEnabled();
    expect(fixture.calls).toHaveLength(0);
    await sources()
      .locator("summary")
      .filter({ hasText: "明确选择原著表达" })
      .click();
    await expect(generate()).toBeDisabled();
    await sources()
      .getByRole("radio", {
        name: "明确不使用正文、段落或摘要；不读取正文目录",
        exact: true,
      })
      .check();
    await sources()
      .getByRole("button", { name: "确认本轮制作范围与表达", exact: true })
      .click();
    await expect(generate()).toBeEnabled();
    expect(fixture.calls).toHaveLength(0);
    await sources()
      .getByRole("radio", { name: "明确选择局部章节范围", exact: true })
      .check();
    await sources()
      .getByRole("checkbox", { name: `制作范围 ${first.title}`, exact: true })
      .check();
    await sources()
      .getByRole("checkbox", { name: `制作范围 ${fourth.title}`, exact: true })
      .check();
    await expect(generate()).toBeDisabled();
    const expressions = () =>
      sources()
        .locator("details")
        .filter({
          has: running!.page.locator("summary", { hasText: "制作来源表达" }),
        });
    await expressions()
      .locator("summary")
      .filter({ hasText: "制作来源表达" })
      .click();
    await expressions()
      .getByRole("combobox", { name: `前文表达 ${first.title}`, exact: true })
      .selectOption("original");
    const chapter = () =>
      expressions().getByRole("group", {
        name: `前文来源 ${fourth.title}`,
        exact: true,
      });
    await chapter()
      .getByRole("button", { name: "读取此章摘要和段落", exact: true })
      .click();
    await expect(chapter().getByRole("combobox")).toHaveText(/明确原文段落/);
    await expect
      .poll(async () =>
        chapter().locator('option[value="paragraphs"]').isDisabled(),
      )
      .toBe(false);
    await chapter().getByRole("combobox").selectOption("paragraphs");
    await chapter()
      .getByRole("checkbox", {
        name: `上下文段落 ${fourth.title} 0`,
        exact: true,
      })
      .check();
    await sources()
      .getByRole("button", { name: "确认本轮制作范围与表达", exact: true })
      .click();
    await expect(generate()).toBeEnabled();
    const key = `dramaip-production-source-choice:${project.id}:episode:${episode.id}:[]`;
    const originalRequest = JSON.parse(
      (await running.page.evaluate(
        (value) => window.localStorage.getItem(value),
        key,
      ))!,
    );
    expect(originalRequest.chapterScope.chapters).toEqual([
      { id: first.id, version: first.version },
      { id: fourth.id, version: fourth.version },
    ]);
    expect(
      originalRequest.context.chapters.map(
        (item: { representation: string }) => item.representation,
      ),
    ).toEqual(["original", "paragraphs"]);
    let reads = 0,
      release!: () => void;
    const held = new Promise<void>((resolveRead) => {
      release = resolveRead;
    });
    const pattern = `**/api/v2/projects/${project.id}/narrative-context-index/chapters/${fourth.id}`;
    await running.page.route(pattern, async (request) => {
      reads++;
      await held;
      return request.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://dramaip.local/problems/controlled-owner-read",
          title: "本次段落来源读取不可用",
          status: 503,
          detail: "本次段落来源读取不可用",
          code: "CONTROLLED_OWNER_READ",
          traceId: randomUUID(),
        }),
      });
    });
    try {
      await navigate("#/pending?category=waiting");
      await expect(
        running.page.getByRole("heading", { name: "待确认中心", exact: true }),
      ).toBeVisible();
      await navigate(route);
      await openCompatibility();
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(generate()).toBeDisabled();
      release();
      await expect(
        sources()
          .getByRole("alert")
          .filter({ hasText: "所选段落／章摘要未核全" }),
      ).toBeVisible();
      await expect(generate()).toBeDisabled();
      expect(fixture.calls).toHaveLength(0);
      await running.page.screenshot({
        path: info.outputPath("production-source-first-read-error.png"),
      });
    } finally {
      release();
      await running.page.unroute(pattern);
    }
    await navigate("#/pending?category=waiting");
    await expect(
      running.page.getByRole("heading", { name: "待确认中心", exact: true }),
    ).toBeVisible();
    await navigate(route);
    await openCompatibility();
    await expect(generate()).toBeEnabled();
    await generate().click();
    const workbench = () =>
      compatibility().getByLabel("AI 本集剧本与分镜（旧 episode 兼容）", {
        exact: true,
      });
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const original = (await client.creation.list(project.id, episode.id))
      .items[0]!;
    expect(original.input.productionNarrativeRequest).toEqual(originalRequest);
    expect(original.input.sourceIds).toEqual([]);
    expect(original.productionNarrativeBasis?.coverage.included).toMatchObject([
      { id: first.id, representations: ["original"] },
      { id: fourth.id, representations: ["paragraphs"] },
    ]);
    for (const call of fixture.calls) {
      expect(call.prompt).toContain("PRIVATE_PRODUCTION_UI_ORIGINAL");
      expect(call.prompt).toContain("PRIVATE_PRODUCTION_UI_PARAGRAPH");
      expect(call.prompt).not.toContain(
        "PRIVATE_PRODUCTION_UI_UNSELECTED_TAIL",
      );
      expect(call.prompt).not.toContain("PRIVATE_PRODUCTION_UI_OMITTED_SECOND");
      expect(call.prompt).not.toContain("PRIVATE_PRODUCTION_UI_OMITTED_THIRD");
    }
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
    const calls = fixture.calls.length;
    manager!.disconnect();
    manager = undefined;
    await running.application.close();
    running = await launch(userData);
    client = await connect();
    await navigate(route);
    await openCompatibility();
    await expect(
      sources().locator('[data-production-confirmed="true"]'),
    ).toBeVisible();
    expect(
      JSON.parse(
        (await running.page.evaluate(
          (value) => window.localStorage.getItem(value),
          key,
        ))!,
      ),
    ).toEqual(originalRequest);
    expect(fixture.calls).toHaveLength(calls);
    await navigate(`${route}&workflowId=${original.id}`);
    await openCompatibility();
    await workbench()
      .getByText(`引用资料 · ${original.sources.length} 项`, { exact: true })
      .click();
    await expect(
      workbench().locator("[data-production-source-coverage]"),
    ).toContainText("实际纳入 2 章，未纳入 2 章");
    await expect(
      workbench().getByLabel("制作运行实际来源表达", { exact: true }),
    ).toContainText("所选原文段落");
    await running.page.screenshot({
      path: info.outputPath("production-source-exact-restored.png"),
    });
    await workbench()
      .locator("[data-production-source-coverage]")
      .screenshot({
        path: info.outputPath("production-source-exact-coverage.png"),
      });
    await client.chapters.update(fourth.id, {
      version: fourth.version,
      content: "PRIVATE_PRODUCTION_UI_NEW_SOURCE。",
    });
    await workbench()
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect(workbench().getByRole("alert")).toContainText(
      "原已选制作章节无法核对或版本已变化",
    );
    expect(
      (await client.creation.get(original.id)).productionNarrativeBasis,
    ).toEqual(original.productionNarrativeBasis);
    expect(await client.resources.list("scripts", project.id)).toEqual([]);
    expect(fixture.calls).toHaveLength(calls);
    expect(fixture.errors).toEqual([]);
  } finally {
    manager?.disconnect();
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("旧 episode 默认折叠，后台重启精确恢复原候选并按兼容规则采用，较新候选和其他项目不被替换", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-legacy-episode-ui-"));
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  let manager: ServerConnectionManager | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    const connect = async () => {
      const bootstrap = await running!.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      manager = new ServerConnectionManager();
      await manager.attach({ ...bootstrap, source: "spawned" });
      return createStudioClient(manager.createTransport());
    };
    let client = await connect();
    const { project } = await client.projects.create({
      title: "旧候选兼容验收",
    });
    const adaptation = await client.resources.create("adaptations", {
      projectId: project.id,
      title: "原改编",
      payload: {},
    });
    const episode = await client.resources.create("episodes", {
      projectId: project.id,
      parentId: adaptation.id,
      title: "原分集",
      payload: {},
    });
    const route = `/adapt?projectId=${project.id}&adaptationId=${adaptation.id}&episodeId=${episode.id}&stage=episodes`;
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, route);
    await expect(
      running.page.getByLabel("独立创作主流程", { exact: true }),
    ).toBeVisible();
    const compatibility = () =>
      running!.page.getByLabel("旧 episode 兼容路径", { exact: true });
    await expect(compatibility()).not.toHaveAttribute("open");
    const generate = running.page.getByRole("button", {
      name: "生成并检查本集剧本与分镜（旧 episode 兼容）",
      exact: true,
    });
    await expect(generate).not.toBeVisible();
    expect(fixture.calls).toHaveLength(0);
    await compatibility()
      .locator("summary")
      .filter({ hasText: "旧版流程：一次生成本集剧本与分镜" })
      .click();
    await expect(generate).toBeEnabled();
    await generate.click();
    const workbench = () =>
      compatibility().getByLabel("AI 本集剧本与分镜（旧 episode 兼容）", {
        exact: true,
      });
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const original = (await client.creation.list(project.id, episode.id))
      .items[0]!;
    expect(original.input.operation).toBe("episode");
    expect(original.output?.title).toBe("旧候选 1");
    const newer = await client.creation.start(
      CreationInputSchema.parse({
        ...original.input,
        instruction: "明确生成另一份旧候选，不覆盖第一份",
      }),
      randomUUID(),
    );
    await expect
      .poll(async () => (await client.creation.get(newer.id)).stage)
      .toBe("awaiting-review", { timeout: 25_000 });
    expect((await client.creation.get(newer.id)).output?.title).toBe(
      "旧候选 2",
    );
    expect(await client.resources.list("scripts", project.id)).toEqual([]);
    manager!.disconnect();
    manager = undefined;
    await running.application.close();
    running = await launch(userData);
    client = await connect();
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `${route}&workflowId=${original.id}`);
    await expect(workbench()).toContainText("旧候选 1");
    await expect(workbench()).not.toContainText("旧候选 2");
    expect(await client.creation.get(original.id)).toMatchObject({
      id: original.id,
      contextSnapshotIds: original.contextSnapshotIds,
      input: original.input,
    });
    // Prime both exact route caches, then create a third local selection. A
    // cached same-project navigation must still select its declared workflow.
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `${route}&workflowId=${newer.id}`);
    await expect(workbench()).toContainText("旧候选 2");
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `${route}&workflowId=${original.id}`);
    await expect(workbench()).toContainText("旧候选 1");
    await workbench()
      .getByRole("button", { name: "按要求生成新 AI 草稿", exact: true })
      .click();
    await expect(workbench()).toContainText("旧候选 3", {
      timeout: 25_000,
    });
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
    );
    const third = (
      await client.creation.list(project.id, episode.id)
    ).items.find((item) => item.output?.title === "旧候选 3")!;
    expect(third.id).not.toBe(original.id);
    expect(third.id).not.toBe(newer.id);
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `${route}&workflowId=${newer.id}`);
    await expect(workbench()).toContainText("旧候选 2");
    await expect(workbench()).not.toContainText("旧候选 3");
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `${route}&workflowId=${original.id}`);
    await expect(workbench()).toContainText("旧候选 1");
    await expect(workbench()).not.toContainText("旧候选 3");
    await running.page.screenshot({
      path: info.outputPath("legacy-exact-restored.png"),
    });
    await workbench()
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "已采用",
      { timeout: 25_000 },
    );
    expect((await client.creation.get(newer.id)).stage).toBe("awaiting-review");
    expect((await client.creation.get(third.id)).stage).toBe("awaiting-review");
    const scripts = await client.resources.list("scripts", project.id);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.parentId).toBe(episode.id);
    expect(scripts[0]!.payload["剧本内容"]).toContain("旧候选 1");
    expect(await client.resources.list("scenes", project.id)).toHaveLength(1);
    expect(await client.resources.list("shots", project.id)).toHaveLength(1);
    const { project: other } = await client.projects.create({
      title: "不属于此候选的项目",
    });
    // A mismatched exact route must not recover a latest candidate instead.
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `/adapt?projectId=${other.id}&workflowId=${original.id}`);
    await expect(compatibility().getByRole("alert")).toContainText(
      "指定工作流不属于当前项目",
    );
    await expect(running.page).toHaveURL(
      new RegExp(`projectId=${other.id}&workflowId=${original.id}`),
    );
    await running.page.evaluate((value) => {
      window.location.hash = value;
    }, `/adapt?projectId=${randomUUID()}&workflowId=${original.id}`);
    await expect(
      running.page.getByLabel("制作对象归属核对").getByRole("alert"),
    ).toContainText("指定项目或制作对象未能读取");
    await expect(compatibility()).toHaveCount(0);
    await expect(workbench()).toHaveCount(0);
    expect(await client.resources.list("scripts", other.id)).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(
      fixture.calls.filter((call) => call.kind === "legacy-episode"),
    ).toHaveLength(3);
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    manager?.disconnect();
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

for (const independentStrategy of [false, true]) {
  test(`真实小说导入后完成诊断、${independentStrategy ? "独立改编策略与" : ""}季纲重排、单集大纲、标准剧本与分镜包、来源失效及重启恢复（受控模型接口）`, async () => {
    test.setTimeout(180_000);
    const userData = await mkdtemp(
      join(tmpdir(), "dramaip-diagnosis-journey-"),
    );
    const fixture = await localModelFixture();
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      await running.application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, resolve("tests/fixtures/lm6/lm6-00/source-import.md"));
      await running.page.evaluate(() => {
        window.location.hash = "#/";
      });
      await running.page
        .getByRole("button", { name: "导入小说或大纲", exact: true })
        .click();
      await running.page.getByRole("button", { name: /单季短剧/ }).click();
      await running.page
        .getByRole("button", { name: "选择文件", exact: true })
        .click();
      await expect(
        running.page.getByText("source-import.md", { exact: true }),
      ).toBeVisible();
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill("真实来源诊断验收");
      await running.page
        .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
        .check();
      await running.page
        .getByRole("button", { name: "创建单季短剧并导入", exact: true })
        .click();
      await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
      const projectId = running.page.url().split("/").at(-1)!;
      let get = await runtimeReader(running.page);
      const chapters = await get<Chapter[]>(`projects/${projectId}/chapters`);
      const source = chapters.find((item) => item.title === "第二章 失联电话")!;
      expect(source.content).toContain("不要相信来电的人");
      const beforeProduction = new Map<string, unknown>();
      for (const kind of [
        "adaptations",
        "episodes",
        "scripts",
        "scenes",
        "shots",
      ])
        beforeProduction.set(kind, await get(`${kind}?projectId=${projectId}`));
      await adoptIntentInUi(running.page, {
        ...INTENT,
        themeStatement: "林晚主动求证",
        mustKeep: ["姐妹信任与姐姐警告"],
        mustAvoid: ["不得虚构已读全书或生成媒体"],
      });
      await openProjectTool(running.page, "改编诊断");
      const panel = () =>
        running!.page.getByLabel("改编诊断工作台", { exact: true });
      const workbench = () =>
        panel().getByLabel("AI 改编诊断", { exact: true });
      const generate = () =>
        workbench().getByRole("button", {
          name: "生成并检查改编诊断",
          exact: true,
        });
      await expect(generate()).toBeDisabled();
      await panel()
        .getByLabel(`诊断来源 ${source.title}`, { exact: true })
        .check();
      await panel().getByLabel("诊断来源权利声明", { exact: true }).check();
      await panel().getByLabel("诊断目标集数", { exact: true }).fill("2");
      await panel()
        .getByRole("button", { name: "确认本轮来源与版本", exact: true })
        .click();
      await expect(generate()).toBeEnabled();
      await generate().click();
      await expect(
        workbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const page = await get<{ items: AdaptationDiagnosis[] }>(
        `projects/${projectId}/diagnoses`,
      );
      const pending = page.items[0]!;
      expect(pending).toMatchObject({
        status: "pending",
        sourceState: "current",
        isCurrent: false,
      });
      expect(pending.basis.chapters.map((item) => item.id)).toEqual([
        source.id,
      ]);
      expect(pending.basis.omittedChapters).toHaveLength(1);
      const candidate = () =>
        panel().getByLabel("诊断候选 v1", { exact: true });
      await expect(candidate()).toContainText("实际覆盖：1 / 2 章");
      if (independentStrategy) {
        const adoptDiagnosis = candidate().getByRole("button", {
          name: "采用诊断，下一步独立策略",
          exact: true,
        });
        await expect(adoptDiagnosis).toBeEnabled();
        await expect(candidate().getByRole("radio")).toHaveCount(0);
        await adoptDiagnosis.click();
        await running.page
          .getByRole("dialog", { name: "采用改编诊断", exact: true })
          .getByRole("button", { name: "确认采用诊断", exact: true })
          .click();
      } else {
        await candidate()
          .locator("summary")
          .filter({ hasText: "旧诊断内策略（旧版流程）" })
          .click();
        const adopt = candidate().getByRole("button", {
          name: "采用选定策略与诊断",
          exact: true,
        });
        await expect(adopt).toBeDisabled();
        await expect(
          candidate().getByRole("radio", {
            name: "选择策略 忠实人物弧",
            exact: true,
          }),
        ).not.toBeChecked();
        await candidate()
          .getByRole("radio", { name: "选择策略 悬念重排", exact: true })
          .check();
        await adopt.click();
        await running.page
          .getByRole("dialog", { name: "采用诊断与选定策略", exact: true })
          .getByRole("button", { name: "确认采用选定策略", exact: true })
          .click();
      }
      await expect
        .poll(
          async () =>
            (await get<AdaptationDiagnosis>(`diagnoses/${pending.id}`)).status,
        )
        .toBe("adopted");
      await expect(
        workbench().locator("header").getByRole("status"),
      ).toHaveText("已采用");
      const adopted = await get<AdaptationDiagnosis>(`diagnoses/${pending.id}`);
      expect(adopted.isCurrent).toBe(true);
      expect(adopted.selectedStrategyId).toBe(
        independentStrategy ? undefined : "reorder",
      );
      let formalStrategy: AdaptationStrategy | undefined;
      if (independentStrategy) {
        await openProjectTool(running.page, "独立策略");
        const strategyPanel = () =>
          running!.page.getByLabel("独立改编策略工作台", { exact: true });
        const strategyWorkbench = () =>
          strategyPanel().getByLabel("AI 独立改编策略", { exact: true });
        const generateStrategy = () =>
          strategyWorkbench().getByRole("button", {
            name: "生成并检查独立改编策略",
            exact: true,
          });
        await expect(generateStrategy()).toBeDisabled();
        await strategyPanel()
          .getByRole("button", { name: "确认独立策略来源", exact: true })
          .click();
        await generateStrategy().click();
        await expect(
          strategyWorkbench().locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用", { timeout: 25_000 });
        const pendingStrategy = (
          await get<{ items: AdaptationStrategy[] }>(
            `projects/${projectId}/adaptation-strategies`,
          )
        ).items[0]!;
        expect(pendingStrategy).toMatchObject({
          status: "pending",
          isCurrent: false,
          basis: { diagnosis: { id: adopted.id, version: adopted.version } },
        });
        expect(pendingStrategy.selectedOptionId).toBeUndefined();
        const strategyCandidate = () =>
          strategyPanel().locator(
            `[data-adaptation-strategy-id="${pendingStrategy.id}"]`,
          );
        await expect(strategyCandidate().getByRole("radio")).toHaveCount(2);
        await expect(
          strategyCandidate().getByRole("button", {
            name: "采用此独立策略",
            exact: true,
          }),
        ).toBeDisabled();
        await strategyCandidate().screenshot({
          path: test
            .info()
            .outputPath("independent-strategy-before-selection.png"),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page
          .getByRole("link", { name: "待确认", exact: true })
          .click();
        const exact = running.page.locator(
          `[data-confirmation-key="creation:${pendingStrategy.workflowId}"]`,
        );
        await expect(exact).toContainText("独立改编策略");
        const returnLink = exact.getByRole("link", {
          name: "返回对应对象",
          exact: true,
        });
        await expect(returnLink).toHaveAttribute(
          "href",
          new RegExp(
            `strategyId=${pendingStrategy.id}.*workflowId=${pendingStrategy.workflowId}|workflowId=${pendingStrategy.workflowId}.*strategyId=${pendingStrategy.id}`,
          ),
        );
        await returnLink.click();
        await expect(strategyCandidate()).toBeVisible();
        const strategyIdentityCalls = fixture.calls.length;
        const unavailableStrategy = `**/api/v2/adaptation-strategies/${pendingStrategy.id}`;
        let strategyOwnerFailures = 0;
        await running.page.route(unavailableStrategy, (route) => {
          strategyOwnerFailures++;
          return route.abort("failed");
        });
        await expect.poll(() => strategyOwnerFailures).toBeGreaterThan(0);
        await expect(strategyPanel().getByRole("alert").first()).toBeVisible();
        await expect(strategyCandidate()).toHaveCount(0);
        await expect(strategyWorkbench()).toHaveCount(0);
        expect(fixture.calls).toHaveLength(strategyIdentityCalls);
        await running.page.unroute(unavailableStrategy);
        await expect(strategyCandidate()).toBeVisible();
        const unavailableStrategyWorkflow = `**/api/v2/workflows/creation/${pendingStrategy.workflowId}`;
        let strategyWorkflowFailures = 0;
        await running.page.route(unavailableStrategyWorkflow, (route) => {
          strategyWorkflowFailures++;
          return route.abort("failed");
        });
        await expect.poll(() => strategyWorkflowFailures).toBeGreaterThan(0);
        await expect(strategyPanel().getByRole("alert").first()).toBeVisible();
        await expect(strategyCandidate()).toHaveCount(0);
        await expect(strategyWorkbench()).toHaveCount(0);
        await running.page.unroute(unavailableStrategyWorkflow);
        await expect(strategyCandidate()).toBeVisible();
        await running.page.evaluate(
          ({ projectId, strategyId }) => {
            window.location.hash = `#/projects/${projectId}/tools/adaptation-strategy?strategyId=${strategyId}`;
          },
          { projectId, strategyId: pendingStrategy.id },
        );
        await expect(strategyCandidate()).toBeVisible();
        await expect(strategyWorkbench()).toHaveCount(0);
        await strategyCandidate()
          .getByRole("link", {
            name: "打开此策略原运行（不切换最近运行）",
            exact: true,
          })
          .click();
        await expect(strategyWorkbench()).toBeVisible();
        expect(fixture.calls).toHaveLength(strategyIdentityCalls);
        await running.page.evaluate(
          ({ projectId, workflowId, strategyId }) => {
            window.location.hash = `#/projects/${projectId}/tools/adaptation-strategy?workflowId=${workflowId}&strategyId=${strategyId}`;
          },
          {
            projectId,
            workflowId: adopted.workflowId,
            strategyId: pendingStrategy.id,
          },
        );
        await expect(strategyPanel().getByRole("alert").first()).toContainText(
          "指定工作流",
        );
        await expect(strategyCandidate()).toHaveCount(0);
        await expect(strategyWorkbench()).toHaveCount(0);
        await expect(running.page).toHaveURL(
          new RegExp(`workflowId=${adopted.workflowId}`),
        );
        expect(fixture.calls).toHaveLength(strategyIdentityCalls);
        await running.page.evaluate(
          ({ projectId, workflowId, strategyId }) => {
            window.location.hash = `#/projects/${projectId}/tools/adaptation-strategy?workflowId=${workflowId}&strategyId=${strategyId}`;
          },
          {
            projectId,
            workflowId: pendingStrategy.workflowId,
            strategyId: pendingStrategy.id,
          },
        );
        await expect(strategyCandidate()).toBeVisible();
        await expect(
          strategyCandidate().getByRole("radio", {
            name: "选择独立策略 独立悬念重排",
            exact: true,
          }),
        ).not.toBeChecked();
        expect(
          await get<AdaptationStrategy>(
            `adaptation-strategies/${pendingStrategy.id}`,
          ),
        ).toMatchObject({
          sourceSnapshotId: pendingStrategy.sourceSnapshotId,
          content: pendingStrategy.content,
          basis: pendingStrategy.basis,
        });
        await strategyCandidate()
          .getByRole("radio", {
            name: "选择独立策略 独立悬念重排",
            exact: true,
          })
          .check();
        await strategyCandidate()
          .getByRole("button", { name: "采用此独立策略", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "采用独立改编策略", exact: true })
          .getByRole("button", { name: "确认采用此策略", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (
                await get<AdaptationStrategy>(
                  `adaptation-strategies/${pendingStrategy.id}`,
                )
              ).status,
          )
          .toBe("adopted");
        formalStrategy = await get<AdaptationStrategy>(
          `adaptation-strategies/${pendingStrategy.id}`,
        );
        expect(formalStrategy).toMatchObject({
          selectedOptionId: "independent-reorder",
          isCurrent: true,
          sourceState: "current",
        });
        expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(source);
        await strategyCandidate().screenshot({
          path: test
            .info()
            .outputPath("independent-strategy-adopted-after-restart.png"),
        });
        await running.page.evaluate(
          ({ projectId, diagnosisId }) => {
            window.location.hash = `#/projects/${projectId}/tools/adaptation-diagnosis?diagnosisId=${diagnosisId}`;
          },
          { projectId, diagnosisId: adopted.id },
        );
      }
      const cockpit = () =>
        running!.page.getByLabel("项目驾驶舱", { exact: true });
      const next = () =>
        cockpit().getByLabel("唯一推荐下一步", { exact: true });
      let legacyPlanStarted = false;
      const assertGates = async (states: string[]) => {
        await openProjectTool(running!.page, "项目驾驶舱");
        const gates = cockpit()
          .getByLabel("改编结果 Gate", { exact: true })
          .getByRole("article");
        const newMainFlow = independentStrategy || !legacyPlanStarted;
        if (newMainFlow)
          states = [
            ...states.slice(0, 2),
            independentStrategy ? states[1]! : "pending",
            ...states.slice(2),
          ];
        await expect(gates).toHaveCount(newMainFlow ? 6 : 5);
        for (let index = 0; index < states.length; index++)
          await expect(gates.nth(index)).toHaveAttribute(
            "data-gate-status",
            states[index]!,
          );
        await expect(next().getByRole("link")).toHaveCount(1);
        await expect(cockpit()).not.toContainText("确认首个静帧");
      };
      expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(source);
      for (const kind of [
        "adaptations",
        "episodes",
        "scripts",
        "scenes",
        "shots",
      ])
        expect(await get(`${kind}?projectId=${projectId}`)).toEqual(
          beforeProduction.get(kind),
        );
      await candidate().screenshot({
        path: test.info().outputPath("diagnosis-strategy-comparison.png"),
      });
      await assertGates(["ready", "ready", "pending", "pending", "pending"]);
      await expect(
        cockpit().getByLabel("改编诊断", { exact: true }),
      ).toContainText("实际范围 1/2 章");
      if (independentStrategy) {
        await next()
          .getByRole("link", { name: "确认整季分集方案", exact: true })
          .click();
      } else {
        await expect(
          next().getByRole("link", { name: "确认独立改编策略", exact: true }),
        ).toBeVisible();
        // The old test explicitly chooses compatibility instead of making it
        // the recommended main flow for fresh projects.
        await openProjectTool(running.page, "改编诊断");
        await panel()
          .getByRole("link", {
            name: "兼容：从诊断内策略继续整季方案 →",
            exact: true,
          })
          .click();
      }
      const seasonPanel = () =>
        running!.page.getByLabel("整季方案工作台", { exact: true });
      const seasonWorkbench = () =>
        seasonPanel().getByLabel("AI 整季分集方案", { exact: true });
      const seasonGenerate = seasonWorkbench().getByRole("button", {
        name: "生成并检查整季分集方案",
        exact: true,
      });
      await expect(seasonGenerate).toBeDisabled();
      await seasonPanel()
        .getByRole("button", { name: "确认本轮季纲基准", exact: true })
        .click();
      await seasonGenerate.click();
      await expect(
        seasonWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const modelPlan = (
        await get<{ items: SeasonPlan[] }>(`projects/${projectId}/season-plans`)
      ).items[0]!;
      legacyPlanStarted = true;
      expect(modelPlan).toMatchObject({
        origin: "model",
        status: "pending",
        basis: {
          diagnosis: {
            id: adopted.id,
            version: adopted.version,
            strategyId: formalStrategy?.selectedOptionId ?? "reorder",
          },
          authorIntent: adopted.authorIntent,
        },
      });
      expect(modelPlan.content.episodes).toHaveLength(2);
      if (formalStrategy)
        expect(modelPlan.basis.strategy).toEqual({
          id: formalStrategy.id,
          version: formalStrategy.version,
          optionId: formalStrategy.selectedOptionId,
        });
      expect(modelPlan.coverage).toHaveLength(1);
      expect(modelPlan.coverage[0]!.episodeIds).toEqual([
        "stable-episode-0",
        "stable-episode-1",
      ]);
      await expect(
        seasonPanel().getByLabel("季纲来源覆盖", { exact: true }),
      ).toContainText("诊断未读：1 章，不计入已覆盖");
      await seasonPanel()
        .getByRole("button", { name: "上移 stable-episode-1", exact: true })
        .click();
      await expect(
        seasonPanel().getByRole("button", {
          name: "采用这个整季方案",
          exact: true,
        }),
      ).toBeDisabled();
      await seasonPanel()
        .getByRole("button", { name: "保存重排为新草稿", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "保存重排为新草稿？", exact: true })
        .getByRole("button", { name: "保存新草稿", exact: true })
        .click();
      await expect(
        seasonPanel().getByLabel("整季方案 v2", { exact: true }),
      ).toBeVisible();
      const orderedPlan = (
        await get<{ items: SeasonPlan[] }>(`projects/${projectId}/season-plans`)
      ).items.find((item) => item.version === 2)!;
      expect(orderedPlan.content.episodes.map((item) => item.id)).toEqual([
        "stable-episode-1",
        "stable-episode-0",
      ]);
      expect(
        (await get<SeasonPlan>(`season-plans/${modelPlan.id}`)).content,
      ).toEqual(modelPlan.content);
      // Same-page links must change the actual identity, even when both
      // versions are cached and the panel has a local reorder selection.
      const seasonIdentityCalls = fixture.calls.length;
      await assertCurrentOriginalOwnerRead(
        running.page,
        `season-plans/${orderedPlan.id}`,
        `#/projects/${projectId}/tools/season-plan?workflowId=${orderedPlan.workflowId}&seasonPlanId=${orderedPlan.id}`,
        () => seasonPanel().getByLabel("整季方案 v2", { exact: true }),
        "season-current-owner-failed-cache.png",
      );
      for (const selectedPlan of [modelPlan, orderedPlan, modelPlan]) {
        await running.page.evaluate(
          ({ projectId, workflowId, seasonPlanId }) => {
            window.location.hash = `#/projects/${projectId}/tools/season-plan?workflowId=${workflowId}&seasonPlanId=${seasonPlanId}`;
          },
          {
            projectId,
            workflowId: selectedPlan.workflowId,
            seasonPlanId: selectedPlan.id,
          },
        );
        await expect(
          seasonPanel().getByLabel(`整季方案 v${selectedPlan.version}`, {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          seasonPanel().locator('article[aria-label^="整季方案 v"]'),
        ).toHaveCount(1);
      }
      await running.page.evaluate(
        ({ projectId, workflowId, seasonPlanId }) => {
          window.location.hash = `#/projects/${projectId}/tools/season-plan?workflowId=${workflowId}&seasonPlanId=${seasonPlanId}`;
        },
        {
          projectId,
          workflowId: pending.workflowId,
          seasonPlanId: modelPlan.id,
        },
      );
      await expect(seasonPanel().getByRole("alert")).toContainText(
        "指定季纲或工作流",
      );
      await expect(
        seasonPanel().locator('article[aria-label^="整季方案 v"]'),
      ).toHaveCount(0);
      await expect(seasonWorkbench()).toHaveCount(0);
      await running.page.evaluate(
        ({ projectId, workflowId }) => {
          window.location.hash = `#/projects/${projectId}/tools/season-plan?workflowId=${workflowId}`;
        },
        { projectId, workflowId: modelPlan.workflowId },
      );
      await expect(
        seasonPanel().getByLabel("整季方案 v1", { exact: true }),
      ).toBeVisible();
      expect(fixture.calls).toHaveLength(seasonIdentityCalls);
      await assertGates([
        "ready",
        "ready",
        "needs-human",
        "pending",
        "pending",
      ]);
      await expect(next().getByRole("link")).toHaveAttribute(
        "href",
        new RegExp(`seasonPlanId=${orderedPlan.id}`),
      );
      await next().getByRole("link").click();
      await seasonPanel()
        .getByRole("button", { name: "采用这个整季方案", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用这个整季方案？", exact: true })
        .getByRole("button", { name: "明确采用方案", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await get<SeasonPlan>(`season-plans/${orderedPlan.id}`)).status,
        )
        .toBe("adopted");
      await expect(
        seasonWorkbench().locator("header").getByRole("status"),
      ).toHaveText("已采用");
      await seasonPanel()
        .getByLabel("整季方案 v2", { exact: true })
        .screenshot({
          path: test.info().outputPath("season-plan-adopted-order.png"),
        });
      await assertGates(["ready", "ready", "ready", "pending", "pending"]);
      await expect(next().getByRole("link")).toHaveAttribute(
        "href",
        /episodeId=stable-episode-1.*operation=episode-outline/u,
      );
      await next().getByRole("link").click();
      const developmentPanel = () =>
        running!.page.getByLabel("单集开发工作台", { exact: true });
      const bibleWorkbench = developmentPanel().getByLabel("AI Story Bible", {
        exact: true,
      });
      await bibleWorkbench
        .getByRole("button", { name: "生成并检查Story Bible", exact: true })
        .click();
      await expect(
        bibleWorkbench.locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await bibleWorkbench
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await expect(developmentPanel()).toContainText(
        "已批准 Story Bible：1 份",
      );
      await developmentPanel()
        .getByRole("button", { name: "确认本轮单集基准", exact: true })
        .click();
      const outlineWorkbench = () =>
        developmentPanel().getByLabel("AI 单集大纲", { exact: true });
      await outlineWorkbench()
        .getByRole("button", { name: "生成并检查单集大纲", exact: true })
        .click();
      await expect(
        outlineWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const outlineWorkflow = (
        await get<{
          items: Array<
            Workflow & {
              episodeDevelopmentBasis: {
                request: { episodeId: string; seasonPlan: { id: string } };
              };
            }
          >;
        }>(`workflows/creation?projectId=${projectId}`)
      ).items.find((item) => item.input.operation === "episode-outline")!;
      expect(outlineWorkflow.episodeDevelopmentBasis.request).toMatchObject({
        episodeId: "stable-episode-1",
        seasonPlan: { id: orderedPlan.id },
      });
      if (independentStrategy) {
        const original = await get<CreationWorkflow>(
          `workflows/creation/${outlineWorkflow.id}`,
        );
        const discarded = await discardNewerEpisodeCandidate(
          get,
          outlineWorkbench,
          original,
        );
        const callsAfterDiscard = fixture.calls.length;
        await assertGates([
          "ready",
          "ready",
          "ready",
          "needs-human",
          "pending",
        ]);
        await expect(next().getByRole("link")).toHaveAttribute(
          "href",
          new RegExp(`workflowId=${original.id}`),
        );
        expect(
          await next().getByRole("link").getAttribute("href"),
        ).not.toContain(discarded.id);
        await cockpit().screenshot({
          path: test
            .info()
            .outputPath("adaptation-original-pending-cockpit.png"),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate((id) => {
          window.location.hash = `#/projects/${id}/tools/cockpit`;
        }, projectId);
        await assertGates([
          "ready",
          "ready",
          "ready",
          "needs-human",
          "pending",
        ]);
        await expect(next().getByRole("link")).toHaveAttribute(
          "href",
          new RegExp(`workflowId=${original.id}`),
        );
        await next().getByRole("link").click();
        await expect(
          outlineWorkbench().locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用");
        expect(
          (await get<CreationWorkflow>(`workflows/creation/${original.id}`))
            .episodeDevelopmentBasis,
        ).toEqual(original.episodeDevelopmentBasis);
        expect(
          (await get<CreationWorkflow>(`workflows/creation/${discarded.id}`))
            .stage,
        ).toBe("discarded");
        expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(source);
        for (const kind of [
          "adaptations",
          "episodes",
          "scripts",
          "scenes",
          "shots",
        ])
          expect(await get(`${kind}?projectId=${projectId}`)).toEqual(
            beforeProduction.get(kind),
          );
        expect(fixture.calls).toHaveLength(callsAfterDiscard);
      }
      await running.page
        .getByRole("link", { name: "待确认", exact: true })
        .click();
      const outlineItem = running.page.locator(
        `[data-confirmation-key="creation:${outlineWorkflow.id}"]`,
      );
      await expect(outlineItem).toContainText("单集大纲");
      await outlineItem
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(
        outlineWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用");
      await outlineWorkbench()
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确采用单集大纲？", exact: true })
        .getByRole("button", { name: "明确采用", exact: true })
        .click();
      await expect(
        developmentPanel().getByLabel("正式单集大纲 v1", { exact: true }),
      ).toBeVisible();
      const formalOutline = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find((item) => item.operation === "episode-outline")!;
      await developmentPanel()
        .getByRole("button", { name: "标准剧本", exact: true })
        .click();
      await developmentPanel()
        .getByRole("button", { name: "确认本轮单集基准", exact: true })
        .click();
      const scriptWorkbench = () =>
        developmentPanel().getByLabel("AI 单集标准剧本", { exact: true });
      await scriptWorkbench()
        .getByRole("button", { name: "生成并检查单集标准剧本", exact: true })
        .click();
      await expect(
        scriptWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await scriptWorkbench()
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确采用标准剧本？", exact: true })
        .getByRole("button", { name: "明确采用", exact: true })
        .click();
      await expect(
        developmentPanel().getByLabel("正式标准剧本 v1", { exact: true }),
      ).toBeVisible();
      const formalScript = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find((item) => item.operation === "episode-script")!;
      expect(formalScript.basis.request.outline).toEqual({
        id: formalOutline.id,
        version: formalOutline.version,
      });
      expect(formalScript.basis.request.episodeId).toBe("stable-episode-1");
      expect(formalScript.content.kind).toBe("episode-script");
      if (formalScript.content.kind !== "episode-script")
        throw new Error("Missing typed script");
      const nativeScript = await get<{ blocks: unknown[] }>(
        `scripts/${formalScript.scriptId}/screenplay`,
      );
      expect(nativeScript.blocks).toEqual(formalScript.content.value.blocks);
      const productionLink = running.page
        .getByRole("navigation", { name: "当前项目导航", exact: true })
        .getByRole("link", { name: "制作", exact: true });
      await expect(productionLink).toHaveAttribute(
        "href",
        new RegExp(`episodeId=${formalScript.episodeRecordId}`),
      );
      await expect(productionLink).toHaveAttribute(
        "href",
        new RegExp(`scriptId=${formalScript.scriptId}`),
      );
      expect(await productionLink.getAttribute("href")).not.toContain(
        "episodeId=stable-episode-1",
      );
      for (const kind of ["scenes", "shots"])
        expect(await get(`${kind}?projectId=${projectId}`)).toEqual(
          beforeProduction.get(kind),
        );
      expect((await get<Chapter>(`chapters/${source.id}`)).content).toBe(
        source.content,
      );
      await running.page.screenshot({
        path: test.info().outputPath("episode-development-adopted.png"),
      });
      await developmentPanel()
        .getByLabel("正式标准剧本 v1", { exact: true })
        .screenshot({
          path: test.info().outputPath("episode-script-formal-result.png"),
        });
      await assertGates(["ready", "ready", "ready", "ready", "pending"]);
      await expect(
        cockpit().getByLabel("首集剧本", { exact: true }),
      ).toContainText("stable-episode-1");
      await next()
        .getByRole("link", { name: "开发首集分镜包", exact: true })
        .click();
      await developmentPanel()
        .getByRole("button", { name: "确认本轮单集基准", exact: true })
        .click();
      const storyboardWorkbench = () =>
        developmentPanel().getByLabel("AI 单集分镜包", { exact: true });
      await storyboardWorkbench()
        .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
        .click();
      await expect(
        storyboardWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      await expect(
        storyboardWorkbench().getByLabel("分镜包完整内容", { exact: true }),
      ).toContainText("不是费用报价");
      const storyboardWorkflow = (
        await get<{ items: Workflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        )
      ).items.find((item) => item.input.operation === "storyboard-package")!;
      for (const kind of ["scenes", "shots"])
        expect(await get(`${kind}?projectId=${projectId}`)).toEqual(
          beforeProduction.get(kind),
        );
      await running.page
        .getByRole("link", { name: "待确认", exact: true })
        .click();
      const storyboardPending = running.page.locator(
        `[data-confirmation-key="creation:${storyboardWorkflow.id}"]`,
      );
      await expect(storyboardPending).toContainText("单集分镜包");
      await storyboardPending
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(
        storyboardWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用");
      await storyboardWorkbench()
        .getByRole("button", { name: "采用", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确采用单集分镜包？", exact: true })
        .getByRole("button", { name: "明确采用", exact: true })
        .click();
      await expect(
        developmentPanel().getByLabel("正式分镜包 v1", { exact: true }),
      ).toBeVisible();
      const formalStoryboard = (
        await get<{ items: EpisodeDevelopmentResult[] }>(
          `projects/${projectId}/episode-development`,
        )
      ).items.find((item) => item.operation === "storyboard-package")!;
      expect(formalStoryboard.basis.request.script).toEqual({
        id: formalScript.id,
        version: formalScript.version,
      });
      expect(formalStoryboard.productionRecords).toHaveLength(4);
      if (formalStrategy)
        for (const result of [formalOutline, formalScript, formalStoryboard])
          expect(result.basis.strategy).toEqual({
            id: formalStrategy.id,
            version: formalStrategy.version,
            optionId: formalStrategy.selectedOptionId,
          });
      const adoptedShots = await get<RecordEntity[]>(
        `shots?projectId=${projectId}`,
      );
      expect(adoptedShots).toHaveLength(
        (beforeProduction.get("shots") as unknown[]).length + 2,
      );
      expect(
        adoptedShots.filter(
          (item) => item.payload.storyboardResultId === formalStoryboard.id,
        ),
      ).toHaveLength(2);
      expect(
        (
          await get<{ blocks: unknown[] }>(
            `scripts/${formalScript.scriptId}/screenplay`,
          )
        ).blocks,
      ).toEqual(nativeScript.blocks);
      await storyboardWorkbench().scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("storyboard-candidate-adopted.png"),
      });
      await developmentPanel()
        .getByLabel("正式分镜包 v1", { exact: true })
        .scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("storyboard-formal-result.png"),
      });
      const impactPanel = () =>
        developmentPanel()
          .getByLabel("正式分镜包 v1", { exact: true })
          .getByLabel("分镜实际变化影响", { exact: true });
      const callsBeforeImpact = fixture.calls.length;
      await impactPanel()
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      await expect(impactPanel()).toContainText("0 个稳定块变化");
      await expect(impactPanel()).toContainText(
        "0 个关联受影响 · 2 个未观察到关联变化 · 0 个范围未核全",
      );
      await expect(impactPanel()).toContainText(
        "未观察到关联变化不证明语义安全",
      );
      const unchangedImpact = await get<EpisodeDevelopmentImpact>(
        `episode-development/${formalStoryboard.id}/impact`,
      );
      expect(unchangedImpact.recordBaselines!.records).toHaveLength(4);
      expect(
        unchangedImpact.recordBaselines!.records.every(
          (item) =>
            item.state === "unchanged" &&
            item.frozen?.capturedResult.id === formalStoryboard.id,
        ),
      ).toBe(true);
      const baselinePanel = () =>
        impactPanel().getByLabel("实际场景与镜头字段基准", { exact: true });
      await baselinePanel().locator("summary").first().click();
      await expect(baselinePanel()).toContainText("4 个字段基准一致");
      await expect(baselinePanel()).toContainText("不执行冲突合并");
      await baselinePanel()
        .locator("details")
        .first()
        .locator("summary")
        .click();
      await expect(baselinePanel()).toContainText(formalStoryboard.id);
      await expect(baselinePanel()).not.toContainText("林晚记录来电");
      await baselinePanel().scrollIntoViewIfNeeded();
      await baselinePanel().screenshot({
        path: test.info().outputPath("storyboard-actual-record-baselines.png"),
      });
      await baselinePanel().locator("summary").first().click();
      const constraintPanel = () =>
        impactPanel().getByLabel("上游正式约束版本核对", { exact: true });
      expect(
        unchangedImpact.upstreamConstraints!.items.map((item) => item.kind),
      ).toEqual([
        "season-plan",
        "adaptation-diagnosis",
        ...(independentStrategy ? ["adaptation-strategy"] : []),
        "author-intent",
        "story-bible",
        "episode-outline",
        "episode-script",
      ]);
      expect(
        unchangedImpact.upstreamConstraints!.items.every(
          (item) => item.change === "same-reference",
        ),
      ).toBe(true);
      await expect(constraintPanel()).toContainText(
        "身份／版本一致不证明正文不变",
      );
      await expect(constraintPanel().locator("tbody tr")).toHaveCount(
        unchangedImpact.upstreamConstraints!.items.length,
      );
      for (const item of unchangedImpact.upstreamConstraints!.items) {
        const row = constraintPanel().locator(
          `tr[data-constraint-kind="${item.kind}"]`,
        );
        await expect(row).toContainText(item.frozen!.id);
        await expect(row).toContainText(`v${item.frozen!.version}`);
      }
      await constraintPanel().scrollIntoViewIfNeeded();
      expect(
        await running.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await constraintPanel().screenshot({
        path: test
          .info()
          .outputPath("episode-formal-constraint-observations.png"),
      });
      expect(unchangedImpact).toMatchObject({
        sourceState: "current",
        automaticRedo: false,
        semanticVerification: "unverified",
        blockChanges: [],
        globalReviewReasons: [],
      });
      expect(
        unchangedImpact.shots.every(
          (shot) => shot.associationImpact === "no-observed-change",
        ),
      ).toBe(true);
      expect(await get<RecordEntity[]>(`shots?projectId=${projectId}`)).toEqual(
        adoptedShots,
      );
      expect(fixture.calls.length).toBe(callsBeforeImpact);
      const impactRoute = `**/api/v2/episode-development/${formalStoryboard.id}/impact`;
      let failedImpactReads = 0;
      await running.page.route(impactRoute, async (route) => {
        failedImpactReads++;
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            detail: "Controlled exact impact read failed",
          }),
        });
      });
      await impactPanel()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impactPanel().getByRole("alert")).toContainText(
        "影响清单读取失败，旧缓存不能作为本轮核对结果",
        { timeout: 25_000 },
      );
      await expect(impactPanel()).not.toContainText("0 个稳定块变化");
      await expect(
        impactPanel().getByLabel("实际场景与镜头字段基准", { exact: true }),
      ).toHaveCount(0);
      await expect(constraintPanel()).toHaveCount(0);
      await expect(impactPanel()).not.toContainText(
        unchangedImpact.snapshotHash,
      );
      expect(failedImpactReads).toBe(1);
      await impactPanel().screenshot({
        path: test.info().outputPath("episode-impact-failed-cache-hidden.png"),
      });
      await running.page.unroute(impactRoute);
      await expect(impactPanel()).not.toContainText("0 个稳定块变化");
      let forgedImpactReads = 0;
      await running.page.route(impactRoute, async (route) => {
        forgedImpactReads++;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...unchangedImpact,
            projectId: "92000000-0000-4000-8000-000000000001",
          }),
        });
      });
      await impactPanel()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impactPanel().getByRole("alert")).toContainText(
        "成果、项目、分集或版本不符",
        { timeout: 25_000 },
      );
      await expect(impactPanel()).not.toContainText("0 个稳定块变化");
      expect(forgedImpactReads).toBe(1);
      await running.page.unroute(impactRoute);
      await impactPanel()
        .getByRole("button", { name: "重新核对变化影响", exact: true })
        .click();
      await expect(impactPanel()).toContainText("0 个稳定块变化", {
        timeout: 25_000,
      });
      await expect(impactPanel().getByRole("alert")).toHaveCount(0);
      // Keep a real original GET pending across actual page unmount/remount.
      // Its late reply may populate query history, never reopen an unchecked panel.
      let releaseImpactRead: (() => void) | undefined;
      let lateImpactReads = 0;
      await running.page.route(impactRoute, async (route) => {
        lateImpactReads++;
        if (lateImpactReads === 1) {
          await new Promise<void>((resolve) => {
            releaseImpactRead = resolve;
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(unchangedImpact),
          });
        } else await route.continue();
      });
      try {
        await impactPanel()
          .getByRole("button", { name: "重新核对变化影响", exact: true })
          .click();
        await expect.poll(() => lateImpactReads).toBe(1);
        await openProjectTool(running.page, "质量报告");
        await openProjectTool(running.page, "单集开发");
        await expect(impactPanel()).not.toContainText("0 个稳定块变化");
        releaseImpactRead?.();
        await expect(
          impactPanel().getByRole("button", {
            name: "核对变化影响",
            exact: true,
          }),
        ).toBeEnabled({ timeout: 25_000 });
        await expect(impactPanel()).not.toContainText("0 个稳定块变化");
        await expect(impactPanel()).not.toContainText(
          unchangedImpact.snapshotHash,
        );
        expect(lateImpactReads).toBe(1);
        await impactPanel().screenshot({
          path: test
            .info()
            .outputPath("episode-impact-late-response-closed.png"),
        });
        await impactPanel()
          .getByRole("button", { name: "核对变化影响", exact: true })
          .click();
        await expect(impactPanel()).toContainText("0 个稳定块变化", {
          timeout: 25_000,
        });
        expect(lateImpactReads).toBe(2);
      } finally {
        releaseImpactRead?.();
        await running.page.unroute(impactRoute);
      }
      expect(
        await get<EpisodeDevelopmentImpact>(
          `episode-development/${formalStoryboard.id}/impact`,
        ),
      ).toEqual(unchangedImpact);
      expect(fixture.calls.length).toBe(callsBeforeImpact);
      await impactPanel().screenshot({
        path: test.info().outputPath("episode-impact-unchanged.png"),
      });
      await assertGates(["ready", "ready", "ready", "ready", "pending"]);
      await expect(
        next().getByRole("link", { name: "核验并保存内部试制包", exact: true }),
      ).toBeVisible();
      await cockpit().screenshot({
        path: test.info().outputPath("adaptation-cockpit-formal-chain.png"),
      });
      await openProjectTool(running.page, "质量报告");
      const qualityPanel = () =>
        running!.page.getByLabel("版本绑定质量报告工作台", { exact: true });
      await qualityPanel()
        .getByLabel("质量检查目标", { exact: true })
        .selectOption(`episode-result:${formalScript.id}`);
      await qualityPanel()
        .getByRole("button", { name: "确认本轮质量基准", exact: true })
        .click();
      const qualityWorkbench = () =>
        qualityPanel().getByLabel("AI 版本绑定的质量报告", { exact: true });
      await qualityWorkbench()
        .getByRole("button", {
          name: "生成并检查版本绑定的质量报告",
          exact: true,
        })
        .click();
      await expect(
        qualityWorkbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const scriptQuality = (
        await get<{ items: NarrativeQualityReport[] }>(
          `projects/${projectId}/narrative-quality-reports`,
        )
      ).items[0]!;
      expect(scriptQuality.basis.request.target).toEqual({
        kind: "episode-result",
        id: formalScript.id,
        version: formalScript.version,
      });
      await qualityPanel()
        .getByRole("button", { name: "采用此质量报告", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "采用质量报告", exact: true })
        .getByRole("button", { name: "确认采用报告", exact: true })
        .click();
      await expect(qualityPanel()).toContainText("当前已采用报告");
      expect(
        await get(`scripts/${formalScript.scriptId}/screenplay`),
      ).toMatchObject({ blocks: nativeScript.blocks });
      const savedSourceReports: NarrativeQualityReport[] = [];
      if (independentStrategy) {
        const scene = formalStoryboard.productionRecords!.find(
          (binding) => binding.kind === "scenes",
        )!;
        for (const [kind, id] of [
          ["script", formalScript.scriptId!],
          ["scene", scene.id],
        ] as const) {
          await openProjectTool(running.page, "质量报告");
          await qualityPanel()
            .getByLabel("质量检查目标", { exact: true })
            .selectOption(`${kind}:${id}`);
          await qualityPanel()
            .getByRole("button", { name: "确认本轮质量基准", exact: true })
            .click();
          await qualityWorkbench()
            .getByRole("button", {
              name: "生成并检查版本绑定的质量报告",
              exact: true,
            })
            .click();
          await expect(
            qualityWorkbench().locator("header").getByRole("status"),
          ).toHaveText("等待审阅采用", { timeout: 25_000 });
          const selected = (
            await get<{ items: NarrativeQualityReport[] }>(
              `projects/${projectId}/narrative-quality-reports`,
            )
          ).items.find((value) => value.basis.request.target.id === id)!;
          expect(selected.basis.request.target.kind).toBe(kind);
          expect(selected.basis.request.target.sourceFingerprint).toMatch(
            /^[a-f0-9]{64}$/u,
          );
          await qualityPanel()
            .getByRole("button", { name: "采用此质量报告", exact: true })
            .click();
          await running.page
            .getByRole("dialog", { name: "采用质量报告", exact: true })
            .getByRole("button", { name: "确认采用报告", exact: true })
            .click();
          await expect(qualityPanel()).toContainText("当前已采用报告");
          savedSourceReports.push(
            await get<NarrativeQualityReport>(
              `narrative-quality-reports/${selected.id}`,
            ),
          );
        }
      }
      await openProjectTool(running.page, "单集开发");
      await developmentPanel()
        .getByRole("button", { name: "分镜包", exact: true })
        .click();
      const callsBeforePilot = fixture.calls.length;
      const pilotDialog = () =>
        running!.page.getByRole("dialog", {
          name: "核验并保存内部试制包",
          exact: true,
        });
      const openPilot = async () => {
        await developmentPanel()
          .getByLabel("正式分镜包 v1", { exact: true })
          .getByRole("button", { name: "预览内部试制包", exact: true })
          .click();
        await pilotDialog()
          .getByRole("button", { name: "生成统一试制包预览", exact: true })
          .click();
        await expect(pilotDialog()).toContainText("待明确确认");
      };
      const confirmPilot = async () => {
        await pilotDialog()
          .getByLabel("我确认这些正式版本，并有权导出这份试制包", {
            exact: true,
          })
          .check();
        await pilotDialog()
          .getByLabel("我确认此包仅用于内部试制审阅，不作为发行就绪证明", {
            exact: true,
          })
          .check();
        await pilotDialog()
          .getByLabel("我已知悉质量、授权范围、费用与上述缺失项尚未全部核验", {
            exact: true,
          })
          .check();
      };
      await openPilot();
      await expect(
        pilotDialog().getByLabel("试制交付预检", { exact: true }),
      ).toContainText("未处理错误");
      await expect(
        pilotDialog().locator(
          `[data-delivery-quality-target="${formalScript.id}"]`,
        ),
      ).toContainText(`标准剧本 v${formalScript.version}`);
      await expect(
        pilotDialog().locator(
          `[data-delivery-quality-target="${formalOutline.id}"]`,
        ),
      ).toContainText(`单集大纲 v${formalOutline.version}`);
      await expect(
        pilotDialog().locator(
          `[data-delivery-quality-target="${formalStoryboard.id}"]`,
        ),
      ).toContainText(`分镜方案 v${formalStoryboard.version}`);
      for (const report of savedSourceReports) {
        const target = report.basis.request.target;
        const entry = pilotDialog().locator(
          `[data-delivery-quality-target="${target.id}"]`,
        );
        await expect(entry).toContainText(
          target.kind === "script" ? "实际保存剧本" : "实际保存场景",
        );
        await expect(
          entry.locator("[data-delivery-quality-fingerprint]"),
        ).toHaveAttribute(
          "data-delivery-quality-fingerprint",
          target.sourceFingerprint!,
        );
        await expect(entry.getByRole("link")).toHaveAttribute(
          "href",
          new RegExp(`reportId=${report.id}`),
        );
        await expect(entry).toContainText("1 项未处理错误");
      }
      await confirmPilot();
      await expect(
        pilotDialog().getByRole("button", {
          name: "确认并保存 ZIP 试制包",
          exact: true,
        }),
      ).toBeDisabled();
      await pilotDialog()
        .getByLabel("试制交付预检", { exact: true })
        .scrollIntoViewIfNeeded();
      await running.page.screenshot({
        path: test.info().outputPath("pilot-quality-blocked.png"),
      });
      await pilotDialog()
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await running.page.evaluate(
        ({ projectId, id }) => {
          window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${id}`;
        },
        { projectId, id: scriptQuality.id },
      );
      const qualityIssue = qualityPanel().locator(
        '[data-quality-issue-id="key-return"]',
      );
      await qualityIssue
        .getByLabel("问题 key-return 的处理说明", { exact: true })
        .fill(
          "内部试制由作者明确接受这一模型风险；不是修复，PRIVATE PILOT NOTE 不导出。",
        );
      await qualityIssue
        .getByRole("button", { name: "接受此风险", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "明确接受此风险", exact: true })
        .getByRole("button", { name: "确认记录决定", exact: true })
        .click();
      await expect(qualityIssue).toContainText("已明确接受风险（不是修复）");
      for (const report of savedSourceReports) {
        await running.page.evaluate(
          ({ projectId, id }) => {
            window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${id}`;
          },
          { projectId, id: report.id },
        );
        await expect(
          qualityPanel().locator(`[data-narrative-report-id="${report.id}"]`),
        ).toBeVisible();
        const issue = qualityPanel().locator(
          '[data-quality-issue-id="key-return"]',
        );
        await issue
          .getByLabel("问题 key-return 的处理说明", { exact: true })
          .fill(
            "作者明确接受对应保存版本的风险，PRIVATE SAVED PILOT NOTE 不导出。",
          );
        await issue
          .getByRole("button", { name: "接受此风险", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "明确接受此风险", exact: true })
          .getByRole("button", { name: "确认记录决定", exact: true })
          .click();
        await expect(issue).toContainText("已明确接受风险（不是修复）");
      }
      await openProjectTool(running.page, "单集开发");
      await developmentPanel()
        .getByRole("button", { name: "分镜包", exact: true })
        .click();
      await running.application.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({
          canceled: true,
          filePath: undefined,
        });
      });
      await openPilot();
      await expect(pilotDialog()).toContainText("费用：未知（不是零）");
      await expect(pilotDialog()).toContainText("13 个文件");
      await pilotDialog()
        .getByRole("combobox", { name: "查看实际文件", exact: true })
        .click();
      await running.page
        .getByRole("option", { name: /^source-context\.json · /u })
        .click();
      const actualContextFile = pilotDialog().getByLabel("实际试制文件内容", {
        exact: true,
      });
      await expect(actualContextFile).toContainText(
        '"purpose": "frozen-generation-input-evidence"',
      );
      await expect(actualContextFile).toContainText(
        '"provesParagraphToShotMapping": false',
      );
      await expect(actualContextFile).not.toContainText(source.content);
      await pilotDialog().screenshot({
        path: test.info().outputPath("pilot-frozen-input-evidence.png"),
      });
      await pilotDialog()
        .getByRole("combobox", { name: "查看实际文件", exact: true })
        .click();
      await running.page
        .getByRole("option", { name: /^README\.md · /u })
        .click();
      await expect(
        pilotDialog().getByRole("button", {
          name: "确认并保存 ZIP 试制包",
          exact: true,
        }),
      ).toBeDisabled();
      await confirmPilot();
      if (independentStrategy) {
        const current = (
          await get<{ items: PilotPackagePreview[] }>(
            `projects/${projectId}/pilot-packages`,
          )
        ).items.find((value) => value.status === "awaiting-confirmation")!;
        const exactPath = `**/api/v2/pilot-packages/${current.id}`;
        let failedReads = 0;
        await running.page.route(exactPath, async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          failedReads++;
          await route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "https://dramaip.local/problems/controlled-read",
              title: "Controlled exact pilot read failure",
              status: 503,
            }),
          });
        });
        await pilotDialog()
          .getByRole("button", { name: "刷新同一交付记录", exact: true })
          .click();
        await expect(pilotDialog()).toContainText(
          "已显示的冻结版本仅供历史查看，不能确认保存",
        );
        expect(failedReads).toBeGreaterThan(0);
        await expect(
          pilotDialog().getByRole("button", {
            name: "确认并保存 ZIP 试制包",
            exact: true,
          }),
        ).toBeDisabled();
        await pilotDialog().screenshot({
          path: test.info().outputPath("pilot-saved-source-failed-cache.png"),
        });
        await running.page.unroute(exactPath);
        await pilotDialog()
          .getByRole("button", { name: "刷新同一交付记录", exact: true })
          .click();
        await expect(
          pilotDialog().getByText("当前读取或操作尚未核对", { exact: false }),
        ).toHaveCount(0);
        await expect(
          pilotDialog().getByRole("button", {
            name: "确认并保存 ZIP 试制包",
            exact: true,
          }),
        ).toBeEnabled();
      }
      await pilotDialog()
        .getByRole("button", { name: "确认并保存 ZIP 试制包", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("已取消保存，未记录成功交付");
      const canceledPilot = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items[0]!;
      expect(canceledPilot.status).toBe("canceled");
      expect(canceledPilot.receipt).toBeUndefined();
      await pilotDialog()
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      const pilotPath = join(userData, "actual-internal-pilot.zip");
      await running.application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, pilotPath);
      await openPilot();
      await expect(
        pilotDialog().getByLabel("我确认这些正式版本，并有权导出这份试制包", {
          exact: true,
        }),
      ).not.toBeChecked();
      await running.page.screenshot({
        path: test.info().outputPath("pilot-package-preflight.png"),
      });
      await confirmPilot();
      await pilotDialog()
        .getByRole("button", { name: "确认并保存 ZIP 试制包", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("试制包已保存并核验。");
      const savedPilotSummary = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items.find((item) => item.status === "saved")!;
      const savedPilot = await get<PilotPackagePreview>(
        `pilot-packages/${savedPilotSummary.id}`,
      );
      expect(savedPilot.manifest.adopted.storyboard).toEqual({
        id: formalStoryboard.id,
        version: formalStoryboard.version,
      });
      if (formalStrategy)
        expect(savedPilot.manifest.adopted.strategy).toEqual({
          id: formalStrategy.id,
          version: formalStrategy.version,
          optionId: formalStrategy.selectedOptionId,
        });
      const zipBytes = await readFile(pilotPath);
      const zipHash = createHash("sha256").update(zipBytes).digest("hex");
      expect(savedPilot.receipt).toMatchObject({
        sha256: zipHash,
        byteSize: zipBytes.length,
      });
      expect(savedPilot.archive.sha256).toBe(zipHash);
      const unpackedPilot = unzipSync(zipBytes);
      const originalInputEvidence = JSON.parse(
        strFromU8(unpackedPilot["source-context.json"]!),
      );
      expect(originalInputEvidence.stages).toHaveLength(3);
      for (const stage of originalInputEvidence.stages) {
        expect(stage.inputKind).toBe("episode-originals");
        expect(stage.selection).toBeUndefined();
      }
      expect(
        savedPilot.manifest.qualityEvidence?.find(
          (value) => value.target.id === formalScript.id,
        ),
      ).toMatchObject({
        acceptedRiskCount: 1,
        reports: [{ id: scriptQuality.id, version: scriptQuality.version + 2 }],
      });
      for (const file of savedPilot.files)
        expect(file.content).not.toContain("PRIVATE PILOT NOTE");
      for (const report of savedSourceReports) {
        expect(
          savedPilot.manifest.qualityEvidence!.find(
            (value) => value.target.id === report.basis.request.target.id,
          ),
        ).toMatchObject({
          target: report.basis.request.target,
          acceptedRiskCount: 1,
          reports: [{ id: report.id, version: report.version + 1 }],
        });
      }
      for (const file of savedPilot.files)
        expect(file.content).not.toContain("PRIVATE SAVED PILOT NOTE");
      expect(JSON.parse(strFromU8(unpackedPilot["manifest.json"]!))).toEqual(
        savedPilot.manifest,
      );
      for (const file of savedPilot.files) {
        expect(strFromU8(unpackedPilot[file.fileName]!)).toBe(file.content);
        expect(
          createHash("sha256")
            .update(unpackedPilot[file.fileName]!)
            .digest("hex"),
        ).toBe(file.sha256);
      }
      expect(strFromU8(unpackedPilot["script.fountain"]!)).toContain("林晚");
      expect(savedPilot.manifest.media.generatedByExport).toBe(false);
      expect(fixture.calls.length).toBe(callsBeforePilot);
      await running.page.screenshot({
        path: test.info().outputPath("pilot-package-saved-receipt.png"),
      });
      await pilotDialog()
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await assertGates(["ready", "ready", "ready", "ready", "ready"]);
      await expect(cockpit()).toContainText("内部试制包已保存，发行仍待核验");
      await expect(
        cockpit().getByText("当前正式 Gate", { exact: true }).locator(".."),
      ).toContainText(independentStrategy ? "6/6" : "5/5");
      await cockpit().screenshot({
        path: test.info().outputPath("adaptation-cockpit-saved-receipt.png"),
      });
      await next()
        .getByRole("link", { name: "查看内部试制包回执", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("试制包已保存并核验。");
      await pilotDialog()
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await openProjectTool(running.page, "整季方案");
      await seasonPanel()
        .getByRole("button", {
          name: "方案 v1 · 模型候选 · 待采用",
          exact: true,
        })
        .click();
      await seasonPanel()
        .getByRole("button", { name: "放弃这个季纲草稿", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "放弃这个季纲草稿？", exact: true })
        .getByRole("button", { name: "明确放弃", exact: true })
        .click();
      await seasonPanel()
        .getByRole("button", {
          name: "方案 v2 · 人工重排 · 已采用",
          exact: true,
        })
        .click();
      await seasonPanel()
        .getByRole("button", { name: "上移 stable-episode-0", exact: true })
        .click();
      await seasonPanel()
        .getByRole("button", { name: "保存重排为新草稿", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "保存重排为新草稿？", exact: true })
        .getByRole("button", { name: "保存新草稿", exact: true })
        .click();
      await expect(
        seasonPanel().getByLabel("整季方案 v3", { exact: true }),
      ).toBeVisible();
      const pendingOrder = (
        await get<{ items: SeasonPlan[] }>(`projects/${projectId}/season-plans`)
      ).items.find((item) => item.version === 3)!;
      await running.page
        .getByRole("link", { name: "待确认", exact: true })
        .click();
      const orderItem = running.page.locator(
        `[data-confirmation-key="season-plan:${pendingOrder.id}"]`,
      );
      await expect(orderItem).toContainText("人工重排");
      await orderItem
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(
        seasonPanel().getByLabel("整季方案 v3", { exact: true }),
      ).toBeVisible();
      await seasonPanel()
        .getByRole("link", { name: "核对诊断与策略", exact: true })
        .click();
      await panel()
        .getByRole("button", { name: "确认本轮来源与版本", exact: true })
        .click();
      await generate().click();
      await expect(
        workbench().locator("header").getByRole("status"),
      ).toHaveText("等待审阅采用", { timeout: 25_000 });
      const second = (
        await get<{ items: AdaptationDiagnosis[] }>(
          `projects/${projectId}/diagnoses`,
        )
      ).items.find((item) => item.version === 2)!;
      const diagnosisIdentityCalls = fixture.calls.length;
      await assertCurrentOriginalOwnerRead(
        running.page,
        `diagnoses/${second.id}`,
        `#/projects/${projectId}/tools/adaptation-diagnosis?workflowId=${second.workflowId}&diagnosisId=${second.id}`,
        () =>
          panel().getByLabel(`诊断候选 v${second.version}`, { exact: true }),
        "diagnosis-current-owner-failed-cache.png",
      );
      for (const selectedDiagnosis of [adopted, second, adopted, second]) {
        await running.page.evaluate(
          ({ projectId, workflowId, diagnosisId }) => {
            window.location.hash = `#/projects/${projectId}/tools/adaptation-diagnosis?workflowId=${workflowId}&diagnosisId=${diagnosisId}`;
          },
          {
            projectId,
            workflowId: selectedDiagnosis.workflowId,
            diagnosisId: selectedDiagnosis.id,
          },
        );
        await expect(
          panel().getByLabel(`诊断候选 v${selectedDiagnosis.version}`, {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          workbench().locator("header").getByRole("status"),
        ).toHaveText(
          selectedDiagnosis.status === "adopted" ? "已采用" : "等待审阅采用",
        );
      }
      await running.page.evaluate(
        ({ projectId, workflowId, diagnosisId }) => {
          window.location.hash = `#/projects/${projectId}/tools/adaptation-diagnosis?workflowId=${workflowId}&diagnosisId=${diagnosisId}`;
        },
        { projectId, workflowId: adopted.workflowId, diagnosisId: second.id },
      );
      await expect(panel().getByRole("alert")).toContainText(
        "指定诊断或工作流",
      );
      await expect(
        panel().locator('article[aria-label^="诊断候选 v"]'),
      ).toHaveCount(0);
      await expect(workbench()).toHaveCount(0);
      await running.page.evaluate(
        ({ projectId, workflowId }) => {
          window.location.hash = `#/projects/${projectId}/tools/adaptation-diagnosis?workflowId=${workflowId}`;
        },
        { projectId, workflowId: adopted.workflowId },
      );
      await expect(
        panel().getByLabel("诊断候选 v1", { exact: true }),
      ).toBeVisible();
      await running.page.evaluate(
        ({ projectId, workflowId }) => {
          window.location.hash = `#/projects/${projectId}/tools/adaptation-diagnosis?workflowId=${workflowId}`;
        },
        { projectId, workflowId: randomUUID() },
      );
      await expect(
        panel().getByRole("alert").filter({ hasText: "指定诊断或工作流" }),
      ).toBeVisible();
      await expect(
        panel().locator('article[aria-label^="诊断候选 v"]'),
      ).toHaveCount(0);
      await expect(workbench()).toHaveCount(0);
      expect(fixture.calls).toHaveLength(diagnosisIdentityCalls);
      await running.page
        .getByRole("link", { name: "待确认", exact: true })
        .click();
      const item = running.page.locator(
        `[data-confirmation-key="creation:${second.workflowId}"]`,
      );
      await expect(item).toContainText("改编诊断");
      await expect(
        item.getByRole("link", { name: "返回对应对象", exact: true }),
      ).toHaveAttribute("href", new RegExp(`diagnosisId=${second.id}`));
      await item
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(
        panel().getByLabel("诊断候选 v2", { exact: true }),
      ).toBeVisible();
      await running.page.evaluate(
        ({ projectId, chapterId }) => {
          window.location.hash = `#/projects/${projectId}?chapterId=${chapterId}`;
        },
        { projectId, chapterId: source.id },
      );
      await running.page.getByText("更多操作", { exact: true }).click();
      await running.page
        .getByRole("button", { name: "微调正文", exact: true })
        .click();
      await running.page
        .getByRole("textbox", { name: "章节正文编辑器", exact: true })
        .fill(`${source.content}\n\n作者修订：林晚决定先联系警方。`);
      await expect
        .poll(async () => (await get<Chapter>(`chapters/${source.id}`)).version)
        .toBe(source.version + 1);
      const revised = await get<Chapter>(`chapters/${source.id}`);
      await running.page
        .getByRole("link", { name: "待确认", exact: true })
        .click();
      await running.page.getByRole("tab", { name: /^需要处理/ }).click();
      await expect(orderItem).toContainText("季纲来源冲突");
      await orderItem
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(
        seasonPanel().getByRole("button", {
          name: "采用这个整季方案",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(seasonPanel().getByRole("alert")).toContainText(
        "来源已变化",
      );
      await running.page
        .getByRole("link", { name: "待确认", exact: true })
        .click();
      await running.page.getByRole("tab", { name: /^需要处理/ }).click();
      await expect(item).toContainText("诊断来源冲突");
      await item
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      const stale = panel().getByLabel("诊断候选 v2", { exact: true });
      await expect(stale.getByRole("alert")).toContainText("来源章节");
      await expect(
        stale.getByRole("button", {
          name: "采用诊断，下一步独立策略",
          exact: true,
        }),
      ).toBeDisabled();
      // A real already-issued native adoption can arrive after the source edit.
      // This authenticated probe runs in the isolated test process, never in
      // Renderer business code, and preserves the exact owner idempotency key.
      const bootstrap = await running.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      const nativeKey = randomUUID();
      const rejectNative = () =>
        fetch(`${bootstrap.baseUrl}/api/v2/diagnoses/${second.id}/adopt`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bootstrap.accessToken}`,
            "Content-Type": "application/json",
            "If-Match": `"${second.stateVersion}"`,
            "Idempotency-Key": nativeKey,
          },
          body: JSON.stringify({ confirmed: true }),
        });
      const nativeCalls = fixture.calls.length;
      expect((await rejectNative()).status).toBe(409);
      expect((await rejectNative()).status).toBe(409);
      const nativeRejected = await get<AdaptationDiagnosis>(
        `diagnoses/${second.id}`,
      );
      expect(nativeRejected).toMatchObject({
        status: "conflicted",
        stateVersion: 1,
        version: second.version,
        content: second.content,
      });
      let nativeMeasure:
        CreativeOutcomeSummary["funnel"]["measures"][number] | undefined;
      await expect
        .poll(async () => {
          nativeMeasure = (
            await get<CreativeOutcomeSummary>(
              `projects/${projectId}/creative-outcomes/summary`,
            )
          ).funnel.measures.find(
            (measure) => measure.metric === "adaptation.diagnosis",
          );
          return nativeMeasure?.sourceConflictCandidateCount;
        })
        .toBe(1);
      expect(nativeMeasure).toMatchObject({
        adoptionRejectedCount: 1,
        firstAdopted: 1,
        lastSourceConflict: {
          candidate: {
            id: second.id,
            contentFingerprint: createHash("sha256")
              .update(canonicalCreativeMetricJSON(second.content))
              .digest("hex"),
          },
          ownerRejection: {
            owner: "production",
            aggregateType: "adaptation-diagnosis",
            stateVersion: 1,
          },
          sourceConflict: {
            projectId,
            workflowId: second.workflowId,
            changes: [
              {
                sourceKind: "chapter",
                frozen: { id: source.id, version: source.version },
                current: { id: source.id, version: revised.version },
              },
            ],
          },
        },
      });
      expect(JSON.stringify(nativeMeasure)).not.toContain(source.content);
      expect(fixture.calls).toHaveLength(nativeCalls);
      // The external native request advances the real owner state, not this
      // mounted query synchronously. Wait for its actual rendered CAS basis.
      await expect(stale).toHaveAttribute("data-diagnosis-state-version", "1");
      await expect(
        stale.getByRole("button", { name: "放弃诊断 AI 草稿", exact: true }),
      ).toBeEnabled();
      await stale
        .getByRole("button", { name: "放弃诊断 AI 草稿", exact: true })
        .click();
      await running.page
        .getByRole("dialog", { name: "放弃诊断 AI 草稿", exact: true })
        .getByRole("button", { name: "确认放弃", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await get<AdaptationDiagnosis>(`diagnoses/${second.id}`)).status,
        )
        .toBe("discarded");
      const calls = fixture.calls.length;
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${formalScript.id}`,
          )
        ).sourceState,
      ).toBe("stale");
      const metricsCalls = fixture.calls.length;
      await assertLocalResultLedger(
        running.page,
        projectId,
        {
          正式章节采用版本: 0,
          诊断采用版本: 1,
          季纲采用版本: 1,
          标准剧本采用版本: 1,
          独立改编策略明确单选版本: independentStrategy ? 1 : 0,
          已保存的内部试制包版本集合: 1,
        },
        "adaptation-local-result-ledger.png",
      );
      const nativeCard = running.page.getByLabel("改编诊断首候选", {
        exact: true,
      });
      await nativeCard.locator("details > summary").click();
      await expect(nativeCard).toContainText("已核对来源冲突候选 1");
      await expect(nativeCard).toContainText("专用拒绝所有者 production");
      await expect(nativeCard).toContainText("决定状态版本 1");
      await expect(nativeCard).toContainText(second.id);
      await expect(nativeCard).toContainText(
        `${source.id}@${source.version} → 实际核对 ${source.id}@${revised.version}`,
      );
      await expect(nativeCard).not.toContainText(source.content);
      await nativeCard.screenshot({
        path: test
          .info()
          .outputPath("native-source-conflict-original-candidate.png"),
      });
      const nativeBeforeRestart = (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).funnel;
      expect(fixture.calls).toHaveLength(metricsCalls);
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      const recoveredPilot = await get<PilotPackagePreview>(
        `pilot-packages/${savedPilot.id}`,
      );
      expect(recoveredPilot).toMatchObject({
        status: "saved",
        sourceState: "stale",
        receipt: savedPilot.receipt,
        archive: savedPilot.archive,
        files: savedPilot.files,
      });
      expect(
        createHash("sha256")
          .update(await readFile(pilotPath))
          .digest("hex"),
      ).toBe(zipHash);
      await running.page.evaluate(
        ({ projectId, previewId }) => {
          window.location.hash = `#/projects/${projectId}/tools/episode-development?pilotPackageId=${previewId}`;
        },
        { projectId, previewId: savedPilot.id },
      );
      await expect(pilotDialog()).toContainText("试制包已保存并核验。");
      await expect(pilotDialog()).toContainText(
        "来源已变化，此包只代表历史版本",
      );
      await pilotDialog()
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await assertGates(["ready", "stale", "stale", "stale", "stale"]);
      await expect(next().getByRole("link")).toHaveAttribute(
        "href",
        new RegExp(`diagnosisId=${adopted.id}`),
      );
      await cockpit().screenshot({
        path: test.info().outputPath("adaptation-cockpit-stale-recovered.png"),
      });
      expect(
        await get<EpisodeDevelopmentResult>(
          `episode-development/${formalStoryboard.id}`,
        ),
      ).toMatchObject({
        sourceState: "stale",
        content: formalStoryboard.content,
        productionRecords: formalStoryboard.productionRecords,
        sourceSnapshotId: formalStoryboard.sourceSnapshotId,
      });
      expect(await get<RecordEntity[]>(`shots?projectId=${projectId}`)).toEqual(
        adoptedShots,
      );
      expect(
        await get<EpisodeDevelopmentResult>(
          `episode-development/${formalScript.id}`,
        ),
      ).toMatchObject({
        sourceState: "stale",
        content: formalScript.content,
        sourceSnapshotId: formalScript.sourceSnapshotId,
      });
      expect(
        (
          await get<{ blocks: unknown[] }>(
            `scripts/${formalScript.scriptId}/screenplay`,
          )
        ).blocks,
      ).toEqual(nativeScript.blocks);
      await running.page.evaluate(
        ({ projectId, episodeId }) => {
          window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}`;
        },
        { projectId, episodeId: formalStoryboard.episodeId },
      );
      await impactPanel()
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      await expect(impactPanel()).toContainText(
        "0 个关联受影响 · 0 个未观察到关联变化 · 2 个范围未核全",
      );
      await expect(impactPanel()).toContainText(
        "全包需复核：当前季纲或其诊断/来源已变化",
      );
      const recoveredImpact = await get<EpisodeDevelopmentImpact>(
        `episode-development/${formalStoryboard.id}/impact`,
      );
      expect(recoveredImpact.recordBaselines).toEqual(
        unchangedImpact.recordBaselines,
      );
      expect(recoveredImpact.sourceState).toBe("stale");
      const currentPlan = recoveredImpact.upstreamConstraints!.items.find(
        (item) => item.kind === "season-plan",
      )!;
      const frozenPlan = unchangedImpact.upstreamConstraints!.items.find(
        (item) => item.kind === "season-plan",
      )!;
      expect(currentPlan).toMatchObject({
        frozen: frozenPlan.frozen,
        current: frozenPlan.current,
        change: "same-reference",
        currentSourceState: "stale",
      });
      await expect(
        constraintPanel().locator('tr[data-constraint-kind="season-plan"]'),
      ).toContainText("来源服务报告当前来源失效");
      expect(
        recoveredImpact.shots.every(
          (shot) => shot.associationImpact === "unresolved",
        ),
      ).toBe(true);
      expect(recoveredImpact.snapshotHash).not.toBe(
        unchangedImpact.snapshotHash,
      );
      expect(JSON.stringify(recoveredImpact)).not.toContain(source.content);
      await expect(
        developmentPanel()
          .getByLabel("正式分镜包 v1", { exact: true })
          .getByRole("button", { name: "预览内部试制包", exact: true }),
      ).toBeDisabled();
      await impactPanel().screenshot({
        path: test
          .info()
          .outputPath("episode-impact-upstream-review-after-restart.png"),
      });
      await running.page.evaluate((id) => {
        window.location.hash = `#/projects/${id}/tools/adaptation-diagnosis`;
      }, projectId);
      await expect(
        panel().getByRole("navigation", { name: "诊断版本历史", exact: true }),
      ).toContainText("诊断 v1 · 已采用");
      expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(revised);
      expect(
        await get<AdaptationDiagnosis>(`diagnoses/${pending.id}`),
      ).toMatchObject({
        content: adopted.content,
        isCurrent: true,
        sourceState: "stale",
      });
      expect(
        (await get<AdaptationDiagnosis>(`diagnoses/${pending.id}`))
          .selectedStrategyId,
      ).toBe(adopted.selectedStrategyId);
      expect(
        await get<AdaptationDiagnosis>(`diagnoses/${second.id}`),
      ).toMatchObject({ status: "discarded", basis: second.basis });
      expect(fixture.calls).toHaveLength(calls);
      expect(
        await get<SeasonPlan>(`season-plans/${orderedPlan.id}`),
      ).toMatchObject({
        status: "adopted",
        isCurrent: true,
        sourceState: "stale",
        content: orderedPlan.content,
      });
      await running.page.evaluate(() => {
        window.location.hash = "#/pending?category=attention";
      });
      const formalAttention = running.page.locator(
        `[data-confirmation-key="episode-result:${formalScript.id}"]`,
      );
      await expect(formalAttention).toContainText(
        "已采用单集来源已变化，保留正式快照",
      );
      await expect(formalAttention).not.toContainText(
        nativeScript.blocks.find((block) => block.type === "action")!.text,
      );
      await formalAttention
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(running.page).toHaveURL(
        new RegExp(`resultId=${formalScript.id}`),
      );
      const exactFormal = running.page.getByLabel("指定正式结果来源复核", {
        exact: true,
      });
      await expect(exactFormal).toContainText("来源已变化，保留原正式快照");
      await expect(
        developmentPanel().getByLabel("正式标准剧本 v1", { exact: true }),
      ).toBeVisible();
      await expect(
        developmentPanel().getByLabel("正式分镜包 v1", { exact: true }),
      ).toHaveCount(0);
      await expect(
        developmentPanel().getByRole("button", { name: /生成并检查/ }),
      ).toHaveCount(0);
      await running.page.screenshot({
        path: test.info().outputPath("formal-source-attention-exact.png"),
      });
      expect(
        await get<EpisodeDevelopmentResult>(
          `episode-development/${formalScript.id}`,
        ),
      ).toMatchObject({
        adoptedAt: formalScript.adoptedAt,
        content: formalScript.content,
        sourceSnapshotId: formalScript.sourceSnapshotId,
      });
      expect(fixture.calls).toHaveLength(calls);
      await running.page.evaluate(
        ({ projectId, resultId, episodeId }) => {
          window.location.hash = `#/projects/${projectId}/tools/episode-development?resultId=${resultId}&episodeId=${episodeId}&operation=episode-script`;
        },
        {
          projectId: crypto.randomUUID(),
          resultId: formalScript.id,
          episodeId: formalScript.episodeId,
        },
      );
      await expect(running.page.getByRole("alert")).toContainText(
        "指定项目工具读取失败，未替换为最近项目或原页面对象",
      );
      await expect(
        running.page.getByLabel("正式标准剧本 v1", { exact: true }),
      ).toHaveCount(0);
      expect(fixture.calls).toHaveLength(calls);
      expect(
        await get<SeasonPlan>(`season-plans/${pendingOrder.id}`),
      ).toMatchObject({
        status: "pending",
        sourceState: "stale",
        sourcePlanId: orderedPlan.id,
        content: pendingOrder.content,
      });
      expect(
        fixture.calls.filter((call) => call.kind === "season-plan"),
      ).toHaveLength(1);
      expect(fixture.errors).toEqual([]);
      expect(
        fixture.calls.filter((call) => call.kind === "adaptation-diagnosis"),
      ).toHaveLength(2);
      for (const call of fixture.calls.filter(
        (call) => call.kind === "adaptation-diagnosis",
      )) {
        expect(call.prompt).toContain(source.content);
        expect(call.prompt).not.toContain(
          "雨夜里，林晚在门口发现一封没有寄件人的信。",
        );
      }
      expect(
        (
          await get<CreativeOutcomeSummary>(
            `projects/${projectId}/creative-outcomes/summary`,
          )
        ).funnel,
      ).toEqual(nativeBeforeRestart);
      await assertLocalResultLedger(
        running.page,
        projectId,
        {
          诊断采用版本: 1,
          独立改编策略明确单选版本: independentStrategy ? 1 : 0,
        },
        "adaptation-native-source-recovered-ledger.png",
      );
      const nativeRecoveredCard = running.page.getByLabel("改编诊断首候选", {
        exact: true,
      });
      await nativeRecoveredCard.locator("details > summary").click();
      await expect(nativeRecoveredCard).toContainText(
        "专用拒绝所有者 production",
      );
      await expect(nativeRecoveredCard).toContainText(second.id);
      await expect(nativeRecoveredCard).toContainText("已核对来源冲突候选 1");
      await nativeRecoveredCard.screenshot({
        path: test
          .info()
          .outputPath("native-source-conflict-restored-history.png"),
      });
      expect(fixture.calls).toHaveLength(calls);
    } finally {
      await running?.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

test("独立小说质量报告经真实证据、精确待确认、人工风险和复检解决、来源失效及重启恢复，不改正文或进入改编（受控模型接口）", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-novel-quality-journey-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("独立质量小说");
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    let get = await runtimeReader(running.page);
    const chapters = await get<Chapter[]>(`projects/${projectId}/chapters`);
    const chapterId = chapters[0]!.id;
    await running.page.getByText("更多操作", { exact: true }).click();
    await running.page
      .getByRole("button", { name: "微调正文", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "章节正文编辑器", exact: true })
      .fill(FIRST_TEXT);
    await expect
      .poll(async () => (await get<Chapter>(`chapters/${chapterId}`)).content)
      .toBe(FIRST_TEXT);
    const before = await get<Chapter>(`chapters/${chapterId}`);
    await adoptIntentInUi(running.page, INTENT);
    const panel = () =>
      running!.page.getByLabel("版本绑定质量报告工作台", { exact: true });
    const workbench = () =>
      panel().getByLabel("AI 版本绑定的质量报告", { exact: true });
    await openProjectTool(running.page, "质量报告");
    await panel()
      .getByLabel("质量检查目标", { exact: true })
      .selectOption(`chapter:${chapterId}`);
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await workbench()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const old = (
      await get<{ items: NarrativeQualityReport[] }>(
        `projects/${projectId}/narrative-quality-reports`,
      )
    ).items[0]!;
    expect(old.basis.request.target).toEqual({
      kind: "chapter",
      id: chapterId,
      version: before.version,
    });
    expect(old.content.issues[0]!.evidence[0]!.quote).toBe(FIRST_FACT);
    await expect(panel()).toContainText("引擎 langgraph");
    await running.page
      .getByRole("link", { name: "待确认", exact: true })
      .click();
    const pending = running.page.locator(
      `[data-confirmation-key="narrative-report:${old.id}"]`,
    );
    await expect(pending).toContainText("质量报告 AI 草稿");
    await expect(pending).not.toContainText(FIRST_FACT);
    await pending
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(
      panel().locator(`[data-narrative-report-id="${old.id}"]`),
    ).toBeVisible();
    await panel()
      .getByRole("button", { name: "采用此质量报告", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "采用质量报告", exact: true })
      .getByRole("button", { name: "确认采用报告", exact: true })
      .click();
    await expect(panel()).toContainText("当前已采用报告");
    const issue = () => panel().locator('[data-quality-issue-id="key-return"]');
    await expect(
      issue().getByRole("button", {
        name: "记录已解决（需复检）",
        exact: true,
      }),
    ).toBeDisabled();
    await issue()
      .getByLabel("问题 key-return 的处理说明", { exact: true })
      .fill("作者已核对，这是有意识保留的时序；PRIVATE DECISION 不进入摘要。");
    await issue()
      .getByRole("button", { name: "接受此风险", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "明确接受此风险", exact: true })
      .getByRole("button", { name: "确认记录决定", exact: true })
      .click();
    await expect(issue()).toContainText("已明确接受风险（不是修复）");
    await panel()
      .locator(`[data-narrative-report-id="${old.id}"]`)
      .screenshot({
        path: test.info().outputPath("novel-quality-evidence-and-risk.png"),
      });
    fixture.setQualityClean(true);
    await workbench()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const recheck = (
      await get<{ items: NarrativeQualityReport[] }>(
        `projects/${projectId}/narrative-quality-reports`,
      )
    ).items[0]!;
    expect(recheck.id).not.toBe(old.id);
    await expect(
      panel().locator(`[data-narrative-report-id="${recheck.id}"]`),
    ).toBeVisible();
    await panel()
      .getByRole("button", { name: "采用此质量报告", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "采用质量报告", exact: true })
      .getByRole("button", { name: "确认采用报告", exact: true })
      .click();
    await expect(panel()).toContainText("当前已采用报告");
    await panel()
      .getByRole("button", { name: new RegExp(`报告 ${old.id}`) })
      .click();
    await issue()
      .getByLabel("问题 key-return 的复检报告", { exact: true })
      .selectOption(recheck.id);
    await issue()
      .getByRole("button", { name: "记录已解决（需复检）", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "记录复检后的解决决定", exact: true })
      .getByRole("button", { name: "确认记录决定", exact: true })
      .click();
    await expect(issue()).toContainText("已依据复检记录解决");
    const final = await get<NarrativeQualityReport>(
      `narrative-quality-reports/${old.id}`,
    );
    expect(final.dispositions[0]).toMatchObject({
      state: "resolved",
      recheckReportId: recheck.id,
    });
    const reportIdentityCalls = fixture.calls.length;
    for (const selectedReport of [recheck, old, recheck, old]) {
      await running.page.evaluate(
        ({ projectId, reportId, workflowId }) => {
          window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${reportId}&workflowId=${workflowId}`;
        },
        {
          projectId,
          reportId: selectedReport.id,
          workflowId: selectedReport.workflowId,
        },
      );
      await expect(
        panel().locator(`[data-narrative-report-id="${selectedReport.id}"]`),
      ).toBeVisible();
      await expect(panel().locator("[data-narrative-report-id]")).toHaveCount(
        1,
      );
    }
    await running.page.evaluate(
      ({ projectId, reportId, workflowId }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${reportId}&workflowId=${workflowId}`;
      },
      { projectId, reportId: recheck.id, workflowId: old.workflowId },
    );
    await expect(
      panel().getByRole("alert").filter({ hasText: "指定报告或运行" }),
    ).toBeVisible();
    await expect(panel().locator("[data-narrative-report-id]")).toHaveCount(0);
    await expect(workbench()).toHaveCount(0);
    await running.page.evaluate(
      ({ projectId, workflowId }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?workflowId=${workflowId}`;
      },
      { projectId, workflowId: old.workflowId },
    );
    await expect(
      panel().locator(`[data-narrative-report-id="${old.id}"]`),
    ).toBeVisible();
    expect(fixture.calls).toHaveLength(reportIdentityCalls);
    await assertCurrentOriginalOwnerRead(
      running.page,
      `narrative-quality-reports/${old.id}`,
      `#/projects/${projectId}/tools/quality-review?workflowId=${old.workflowId}&reportId=${old.id}`,
      () => panel().locator(`[data-narrative-report-id="${old.id}"]`),
      "quality-current-owner-failed-cache.png",
    );
    expect(await get<Chapter>(`chapters/${chapterId}`)).toEqual(before);
    expect(await get(`adaptations?projectId=${projectId}`)).toEqual([]);
    for (const kind of [
      "episodes",
      "scripts",
      "scenes",
      "shots",
      "visual-assets",
    ])
      expect(await get(`${kind}?projectId=${projectId}`)).toEqual([]);
    const summaries = JSON.stringify(
      await get(`projects/${projectId}/narrative-quality-summaries`),
    );
    expect(summaries).not.toContain(FIRST_FACT);
    expect(summaries).not.toContain("PRIVATE DECISION");
    await expect
      .poll(
        async () =>
          (
            await get<CreativeOutcomeSummary>(
              `projects/${projectId}/creative-outcomes/summary`,
            )
          ).qualityAssociations.recordedReports,
      )
      .toBe(2);
    const qualityHistory = (
      await get<CreativeOutcomeSummary>(
        `projects/${projectId}/creative-outcomes/summary`,
      )
    ).qualityAssociations;
    expect(qualityHistory).toMatchObject({
      recordedReports: 2,
      reportsWithExactTarget: 0,
      reportsWithScopeMembers: 0,
      reportsWithoutRecordedOutcome: 2,
      linkedResultUnits: 0,
    });
    for (const report of [old, recheck])
      expect(
        qualityHistory.items.find((item) => item.report.id === report.id),
      ).toMatchObject({
        report: { id: report.id, version: 1 },
        target: report.basis.request.target,
        links: [],
        modelEvidence: "unknown",
        qualityState: "unverified",
        currentValidity: "unknown",
      });
    expect(final.version).toBeGreaterThan(1);
    expect(JSON.stringify(qualityHistory)).not.toContain(FIRST_FACT);
    expect(JSON.stringify(qualityHistory)).not.toContain("PRIVATE DECISION");
    const showHistory = async () => {
      await running!.page.evaluate(() => {
        window.location.hash = "#/insights";
      });
      await running!.page
        .getByRole("combobox", { name: "所属项目", exact: true })
        .selectOption(projectId);
      const history = running!.page.getByLabel("质量报告历史关联", {
        exact: true,
      });
      await expect(history).toContainText("已记录报告采用 2");
      await expect(history).toContainText("未关联已记录成果 2");
      await expect(history).toContainText("均不等于文学质量通过");
      const original = history.locator(
        `[data-quality-adoption-report-id="${old.id}"]`,
      );
      await original.locator("summary").click();
      await expect(original).toContainText("采用时版本 1");
      await expect(original).toContainText(chapterId);
      await expect(original).not.toContainText(FIRST_FACT);
      await expect(history).not.toContainText("PRIVATE DECISION");
      return original;
    };
    await (
      await showHistory()
    ).screenshot({
      path: test.info().outputPath("novel-quality-adoption-history.png"),
    });
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await running.page.evaluate(
      ({ projectId, id }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${id}`;
      },
      { projectId, id: old.id },
    );
    await expect(panel()).toContainText("已依据复检记录解决");
    expect(
      await get<NarrativeQualityReport>(`narrative-quality-reports/${old.id}`),
    ).toEqual(final);
    await running.page.evaluate(
      ({ projectId, chapterId }) => {
        window.location.hash = `#/projects/${projectId}?chapterId=${chapterId}`;
      },
      { projectId, chapterId },
    );
    await running.page.getByText("更多操作", { exact: true }).click();
    await running.page
      .getByRole("button", { name: "微调正文", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "章节正文编辑器", exact: true })
      .fill(`${FIRST_TEXT}\n作者明确修改正文，旧报告只保留历史。`);
    await expect
      .poll(async () => (await get<Chapter>(`chapters/${chapterId}`)).version)
      .toBe(before.version + 1);
    await running.page.evaluate(
      ({ projectId, id }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${id}`;
      },
      { projectId, id: old.id },
    );
    await expect(panel()).toContainText("来源已失效（只保留历史）");
    await expect(
      issue().getByRole("button", { name: "接受此风险", exact: true }),
    ).toHaveCount(0);
    const stale = await get<NarrativeQualityReport>(
      `narrative-quality-reports/${old.id}`,
    );
    expect(stale.version).toBe(final.version);
    expect(stale.updatedAt).toBe(final.updatedAt);
    expect(stale.content).toEqual(final.content);
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).qualityAssociations,
    ).toEqual(qualityHistory);
    await (
      await showHistory()
    ).screenshot({
      path: test.info().outputPath("novel-quality-adoption-restored.png"),
    });
    let failedHistoryReads = 0;
    const failedHistoryPath = `**/api/v2/projects/${projectId}/creative-outcomes/summary`;
    await running.page.route(failedHistoryPath, async (route) => {
      failedHistoryReads++;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://dramaip.local/problems/controlled-history-read",
          title: "Controlled original quality history unavailable",
          detail: "Controlled original quality history unavailable",
          status: 503,
          code: "CONTROLLED_HISTORY_READ",
          traceId: crypto.randomUUID(),
        }),
      });
    });
    await running.page
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(
      running.page.getByRole("alert").filter({ hasText: "结果台账读取失败" }),
    ).toBeVisible();
    expect(failedHistoryReads).toBeGreaterThan(0);
    await expect(
      running.page.getByLabel("质量报告历史关联", { exact: true }),
    ).toHaveCount(0);
    await running.page.unroute(failedHistoryPath);
    await running.page
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(
      running.page.getByLabel("质量报告历史关联", { exact: true }),
    ).toContainText("已记录报告采用 2");
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).qualityAssociations,
    ).toEqual(qualityHistory);
    expect(fixture.calls).toHaveLength(reportIdentityCalls);
    expect(
      fixture.calls.filter((call) => call.kind === "quality-review"),
    ).toHaveLength(2);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("创建前解析失败的真实 404 可明确解除未创建绑定，断网不解除，迟到预览与持久创建键保留（后台）", async ({}, testInfo) => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-intake-missing-recovery-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "导入已有剧本", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "开发剧本 · 单季短剧", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("无创建的文件失败恢复");
    const panel = () =>
      running!.page.getByLabel("创建前原生剧本导入", { exact: true });
    const pointer = () =>
      running!.page.evaluate(
        () =>
          JSON.parse(window.localStorage.getItem("dramaip-creation-draft:v1")!)
            .nativeScriptIntake,
      );
    const release = () =>
      panel().getByRole("button", {
        name: "明确解除未开始创建的预览绑定",
        exact: true,
      });
    const pick = async (name: string) =>
      running!.application.evaluate(
        ({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path],
          });
        },
        resolve(`tests/fixtures/lm6/lm6-00/${name}`),
      );
    const chooseInvalid = async () => {
      await pick("invalid-existing-script.json");
      await panel()
        .getByRole("button", { name: "选择原生剧本文件", exact: true })
        .click();
      await expect(panel()).toContainText("文件无法安全解析");
      await expect(release()).toBeEnabled();
    };
    await chooseInvalid();
    const first = await pointer();
    expect(Object.keys(first)).toEqual(["previewId"]);
    let get = await runtimeReader(running.page);
    expect(await get("projects")).toEqual([]);
    const routePath = `**/api/v2/screenplay-intakes/${first.previewId}`;
    await running.page.route(routePath, (route) => route.abort("failed"));
    await release().click();
    await expect(panel()).toContainText("解除前只读核验失败");
    await expect(release()).toHaveCount(0);
    expect(await pointer()).toEqual(first);
    await expect(
      panel().getByRole("button", { name: "选择原生剧本文件", exact: true }),
    ).toHaveCount(0);
    await running.page.unroute(routePath);
    await panel()
      .getByRole("button", { name: "只读恢复同一创建前预览", exact: true })
      .click();
    await expect(release()).toBeEnabled();
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await expect(release()).toBeEnabled();
    expect(await pointer()).toEqual(first);
    expect(await get("projects")).toEqual([]);
    await running.page.screenshot({
      path: testInfo.outputPath("missing-preview-restored.png"),
    });
    const writes: string[] = [];
    running.page.on("request", (request) => {
      if (
        request.url().includes("/screenplay-intakes") &&
        request.method() !== "GET"
      )
        writes.push(request.method());
    });
    await release().click();
    await expect(panel()).toContainText("已明确解除尚无创建键的本地预览绑定");
    expect(await pointer()).toBeUndefined();
    expect(writes).toEqual([]);
    expect(await get("projects")).toEqual([]);
    await chooseInvalid();
    const second = await pointer();
    expect(second.previewId).not.toBe(first.previewId);
    await pick("native-original.json");
    const bootstrap = await running.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const host = await fetch(
      `${bootstrap.baseUrl}/api/v2/system/host/files/pick`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ multiple: false, extensions: ["json"] }),
      },
    );
    expect(host.status, await host.clone().text()).toBe(200);
    const files = (await host.json()) as Array<{ grantId: string }>;
    // Real owner POST materializes a late *preview*, not business rows or a forged response.
    const late = await fetch(`${bootstrap.baseUrl}/api/v2/screenplay-intakes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": second.previewId,
      },
      body: JSON.stringify({
        previewId: second.previewId,
        grantId: files[0]!.grantId,
      }),
    });
    expect(late.status, await late.clone().text()).toBe(201);
    const frozen = (await late.json()) as ScreenplayIntakePreview;
    const beforeRelease = [...writes];
    await release().click();
    await expect(panel()).toContainText("同一预览现已存在，保留原绑定");
    await expect(release()).toHaveCount(0);
    expect(await pointer()).toEqual({ ...second, etag: frozen.etag });
    expect(writes).toEqual(beforeRelease);
    expect(await get(`screenplay-intakes/${second.previewId}`)).toEqual(frozen);
    await expect(
      panel().getByRole("button", {
        name: "确认原生预览并创建剧本项目",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      panel().getByLabel(
        "我确认有权将此原稿导入新项目（声明不等于授权证明）。",
        { exact: true },
      ),
    ).not.toBeChecked();
    await running.page.screenshot({
      path: testInfo.outputPath("late-preview-preserved.png"),
    });
    await panel()
      .getByRole("button", { name: "取消创建前原生预览", exact: true })
      .click();
    await panel()
      .getByRole("button", { name: "清除已取消的原生预览", exact: true })
      .click();
    const keyed = { previewId: randomUUID(), requestKey: randomUUID() };
    // Durable client crash boundary: the key was saved before an unsent write; server really has no row.
    await running.page.evaluate((binding) => {
      const draft = JSON.parse(
        window.localStorage.getItem("dramaip-creation-draft:v1")!,
      );
      draft.nativeScriptIntake = binding;
      window.localStorage.setItem(
        "dramaip-creation-draft:v1",
        JSON.stringify(draft),
      );
    }, keyed);
    await running.page.reload();
    await expect(panel()).toContainText("同一创建前预览尚未核验");
    await expect(release()).toHaveCount(0);
    expect(await pointer()).toEqual(keyed);
    await panel()
      .getByRole("button", { name: "只读恢复同一创建前预览", exact: true })
      .click();
    await expect(panel()).toContainText("只读恢复尚未核验");
    await expect(release()).toHaveCount(0);
    expect(await pointer()).toEqual(keyed);
    expect(await get("projects")).toEqual([]);
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

for (const { entryPath, nativeSource, intakeSource } of [
  { entryPath: "script", nativeSource: undefined, intakeSource: undefined },
  {
    entryPath: "inspiration",
    nativeSource: undefined,
    intakeSource: undefined,
  },
  { entryPath: "script", nativeSource: "fountain", intakeSource: undefined },
  { entryPath: "inspiration", nativeSource: "fdx", intakeSource: undefined },
  { entryPath: "script", nativeSource: undefined, intakeSource: "fountain" },
  { entryPath: "script", nativeSource: undefined, intakeSource: "fdx" },
  { entryPath: "script", nativeSource: undefined, intakeSource: "script-json" },
] as const) {
  test(`独立直写 ${entryPath}${nativeSource ? ` 原生 ${nativeSource}` : ""}${intakeSource ? ` 创建前原生 ${intakeSource}` : ""} 真实入口经正式大纲、稳定剧本、分镜及内部 ZIP 保存，原稿与冻结基准后台重启保留（受控模型接口）`, async ({}, testInfo) => {
    test.setTimeout(
      nativeSource || intakeSource || entryPath === "script"
        ? 360_000
        : 150_000,
    );
    const userData = await mkdtemp(join(tmpdir(), "dramaip-direct-journey-"));
    const fixture = await localModelFixture();
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await configureLocalModel(running, fixture.url);
      await running.page.evaluate(() => {
        window.location.hash = "#/";
      });
      await running.page
        .getByRole("button", {
          name: entryPath === "script" ? "导入已有剧本" : "从创意开始",
          exact: true,
        })
        .click();
      await running.page
        .getByRole("button", { name: "开发剧本 · 单季短剧", exact: true })
        .click();
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill(`真实直写 ${entryPath}`);
      let intake: ScreenplayIntakePreview | undefined;
      if (intakeSource) {
        const native = () =>
          running!.page.getByLabel("创建前原生剧本导入", { exact: true });
        const pointer = () =>
          running!.page.evaluate(
            () =>
              JSON.parse(
                window.localStorage.getItem("dramaip-creation-draft:v1")!,
              ).nativeScriptIntake,
          );
        const rights = () =>
          native().getByLabel(
            "我确认有权将此原稿导入新项目（声明不等于授权证明）。",
            { exact: true },
          );
        const loss = () =>
          native().getByLabel("我已核对完整原稿块及格式损失，接受本次转换。", {
            exact: true,
          });
        await running.application.evaluate(
          ({ dialog }, path) => {
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: [path],
            });
          },
          resolve(
            `tests/fixtures/lm6/lm6-00/native-original.${intakeSource === "script-json" ? "json" : intakeSource}`,
          ),
        );
        let read = await runtimeReader(running.page);
        await native()
          .getByRole("button", { name: "选择原生剧本文件", exact: true })
          .click();
        await expect(native()).toContainText("创建前原稿预览 · 尚未创建项目");
        const canceled = await pointer();
        expect(await read("projects")).toEqual([]);
        await native()
          .getByRole("button", { name: "取消创建前原生预览", exact: true })
          .click();
        await expect(native()).toContainText("创建前原稿预览已取消");
        expect(
          await read(`screenplay-intakes/${canceled.previewId}`),
        ).toMatchObject({ status: "discarded" });
        expect(await read("projects")).toEqual([]);
        await native()
          .getByRole("button", { name: "清除已取消的原生预览", exact: true })
          .click();
        await native()
          .getByRole("button", { name: "选择原生剧本文件", exact: true })
          .click();
        await expect(native()).toContainText("创建前原稿预览 · 尚未创建项目");
        const savedBinding = await pointer();
        expect(Object.keys(savedBinding).sort()).toEqual(["etag", "previewId"]);
        const frozen = await read<ScreenplayIntakePreview>(
          `screenplay-intakes/${savedBinding.previewId}`,
        );
        expect(frozen.sourceFormat).toBe(intakeSource);
        await native()
          .getByLabel("完整原稿块预览", { exact: true })
          .first()
          .locator("summary")
          .click();
        await expect(native()).toContainText("林晚记下姐姐的警告");
        await expect(
          native().getByLabel("格式损失报告", { exact: true }),
        ).toHaveCount(intakeSource === "script-json" ? 3 : 1);
        await expect(
          native().getByLabel("格式损失报告", { exact: true }).first(),
        ).toContainText(
          intakeSource === "fdx"
            ? "未知段落类型（转为注释）：UnsupportedLayout"
            : "未报告（不证明所有专有排版无损）",
        );
        if (intakeSource === "script-json") {
          await expect(
            native().getByLabel("文件分集 2", { exact: true }),
          ).toContainText("拒绝交换");
          await native()
            .getByLabel("文件分集 2", { exact: true })
            .getByLabel("全部原场景资料", { exact: true })
            .locator("summary")
            .click();
          await expect(native()).toContainText("第二集不参与首集正式生成");
          expect(frozen.episodes).toHaveLength(2);
          expect(frozen.blocks).toEqual([]);
        }
        await rights().check();
        await loss().check();
        await expect(
          running.page.getByRole("button", {
            name: "创建单季短剧",
            exact: true,
          }),
        ).toBeDisabled();
        await running.page.screenshot({
          path: testInfo.outputPath(`intake-${intakeSource}-pending.png`),
        });
        expect(await read("projects")).toEqual([]);
        expect(fixture.calls).toHaveLength(0);
        await running.application.close();
        running = await launch(userData);
        read = await runtimeReader(running.page);
        await running.page.evaluate(() => {
          window.location.hash = "#/";
        });
        await expect(native()).toContainText("创建前原稿预览 · 尚未创建项目");
        await expect(rights()).not.toBeChecked();
        await expect(loss()).not.toBeChecked();
        await expect(
          native().getByRole("button", {
            name: "确认原生预览并创建剧本项目",
            exact: true,
          }),
        ).toBeDisabled();
        expect(await pointer()).toEqual(savedBinding);
        expect(
          await read(`screenplay-intakes/${savedBinding.previewId}`),
        ).toEqual(frozen);
        expect(await read("projects")).toEqual([]);
        let commits = 0;
        const routePath = `**/api/v2/screenplay-intakes/${savedBinding.previewId}/commit`;
        if (intakeSource === "fdx")
          await running.page.route(routePath, async (route) => {
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            commits++;
            await route.abort("failed");
          });
        if (intakeSource === "fountain")
          nativeIntakeFault(
            join(userData, "dramaip.db"),
            "CREATE TRIGGER controlled_native_project_receipt_failure BEFORE INSERT ON workspace_project_create_idempotency WHEN NEW.idempotency_key LIKE 'screenplay-intake:%' BEGIN SELECT RAISE(ABORT, 'controlled native project receipt failure'); END;",
          );
        if (intakeSource === "script-json")
          nativeIntakeFault(
            join(userData, "dramaip.db"),
            "CREATE TRIGGER controlled_native_project_receipt_failure BEFORE INSERT ON production_records WHEN NEW.kind = 'episodes' AND json_extract(NEW.payload_json, '$.集数') = 2 BEGIN SELECT RAISE(ABORT, 'controlled second JSON episode failure'); END;",
          );
        await rights().check();
        await loss().check();
        await native()
          .getByRole("button", {
            name: "确认原生预览并创建剧本项目",
            exact: true,
          })
          .click();
        if (intakeSource === "fountain" || intakeSource === "script-json") {
          await expect(native()).toContainText(
            "已明确开始同一次创建 · 初始化尚未完成",
          );
          const interrupted = await read<ScreenplayIntakePreview>(
            `screenplay-intakes/${savedBinding.previewId}`,
          );
          const recoveringBinding = await pointer();
          expect(interrupted).toMatchObject({
            status: "creating",
            requestKey: recoveringBinding.requestKey,
          });
          await expect(
            native().getByRole("button", {
              name: "明确解除未开始创建的预览绑定",
              exact: true,
            }),
          ).toHaveCount(0);
          const projects = await read<Array<{ id: string }>>("projects");
          expect(projects).toHaveLength(intakeSource === "script-json" ? 1 : 0);
          if (intakeSource === "script-json") {
            expect(interrupted.episodes).toEqual(frozen.episodes);
            for (const kind of ["adaptations", "episodes", "scripts", "scenes"])
              expect(
                await read(`${kind}?projectId=${projects[0]!.id}`),
              ).toEqual([]);
          }
          await running.page
            .getByRole("textbox", { name: "项目名称" })
            .fill("后改表单不能替换已确认创建输入");
          await running.page.screenshot({
            path: testInfo.outputPath("intake-fountain-creating.png"),
          });
          await running.application.close();
          nativeIntakeFault(
            join(userData, "dramaip.db"),
            "DROP TRIGGER controlled_native_project_receipt_failure",
          );
          running = await launch(userData);
          read = await runtimeReader(running.page);
          await running.page.evaluate(() => {
            window.location.hash = "#/";
          });
          await expect(native()).toContainText(
            "已明确开始同一次创建 · 初始化尚未完成",
          );
          expect(await pointer()).toEqual(recoveringBinding);
          expect(await read("projects")).toEqual(projects);
          expect(fixture.calls).toHaveLength(0);
          await expect(native()).toContainText(
            `已确认目标：${interrupted.request!.project.title}`,
          );
          await native()
            .getByRole("button", {
              name: "明确继续同一次原生初始化",
              exact: true,
            })
            .click();
        }
        if (intakeSource === "fdx") {
          await expect(native()).toContainText(
            "回复异常后已核验同一实际项目／原稿回执，没有重复创建",
          );
          expect(commits).toBe(1);
          await running.page.unroute(routePath);
          const committedBinding = await pointer();
          expect(Object.keys(committedBinding).sort()).toEqual([
            "etag",
            "previewId",
            "requestKey",
          ]);
          await running.page.screenshot({
            path: testInfo.outputPath("intake-fdx-recovered.png"),
          });
          await running.application.close();
          running = await launch(userData);
          read = await runtimeReader(running.page);
          await running.page.evaluate(() => {
            window.location.hash = "#/";
          });
          await expect(native()).toContainText(
            "原稿已导入实际项目 · 不重复创建",
          );
          expect(await pointer()).toEqual(committedBinding);
          await native()
            .getByRole("button", { name: "打开实际导入原稿", exact: true })
            .click();
        }
        await expect(running.page).toHaveURL(/#\/adapt\?projectId=/);
        intake = await read<ScreenplayIntakePreview>(
          `screenplay-intakes/${savedBinding.previewId}`,
        );
        expect(intake).toMatchObject({
          status: "committed",
          sourceState: "current",
          blocks: frozen.blocks,
          ...(frozen.episodes ? { episodes: frozen.episodes } : {}),
          request: {
            confirmation: { rightsDeclared: true, lossReportReviewed: true },
          },
        });
        expect(await read("projects")).toHaveLength(1);
        expect(
          await read(`projects/${intake.receipt!.projectId}`),
        ).toMatchObject({ title: `真实直写 ${entryPath}`, version: 1 });
        expect(
          await read(`projects/${intake.receipt!.projectId}/chapters`),
        ).toEqual([]);
        expect(
          await read(`scripts/${intake.receipt!.scriptId}/screenplay`),
        ).toMatchObject({
          id: intake.receipt!.documentId,
          version: 0,
          blocks: frozen.episodes?.[0]?.blocks ?? frozen.blocks,
        });
        expect(fixture.calls).toHaveLength(0);
      } else if (entryPath === "script") {
        await running.page
          .getByRole("textbox", { name: "已有剧本内容" })
          .fill(
            "INT. 林晚房间 - NIGHT\n\n林晚记下姐姐的警告，核对屏幕上的号码。\n\nINT. 走廊 - NIGHT\n\n林晚发现线索矛盾，决定出门求证。",
          );
        await running.page
          .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。", {
            exact: true,
          })
          .check();
      } else
        await running.page
          .getByRole("textbox", { name: "故事构思（可选）", exact: true })
          .fill(
            "林晚接到姐姐警告，记录号码后核对矛盾线索并主动出门；轻悬疑，直接开发剧本，不先写小说。",
          );
      if (!intakeSource)
        await running.page
          .getByRole("button", { name: "创建单季短剧", exact: true })
          .click();
      await expect(running.page).toHaveURL(/#\/adapt\?projectId=/);
      const projectId = new URLSearchParams(
        new URL(running.page.url()).hash.split("?")[1],
      ).get("projectId")!;
      let get = await runtimeReader(running.page);
      await expect
        .poll(
          async () =>
            (
              await get<CreativeOutcomeSummary>(
                `projects/${projectId}/creative-outcomes/summary`,
              )
            ).goalConfirmations.recordedProjects,
        )
        .toBe(1);
      const initialGoals = (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).goalConfirmations;
      expect(initialGoals.items).toHaveLength(1);
      expect(initialGoals.items[0]).toMatchObject({
        projectId,
        projectVersion: 0,
        workflowPath: "adaptation",
        goal: "screenplay-first",
        material: entryPath,
        modelEvidence: "unknown",
        qualityState: "unverified",
      });
      if (intake)
        expect(intake.request!.project.goalConfirmation).toEqual({
          confirmed: true,
          goal: "screenplay-first",
          material: entryPath,
        });
      await expect
        .poll(
          async () =>
            (
              await get<CreativeOutcomeSummary>(
                `projects/${projectId}/creative-outcomes/summary`,
              )
            ).sourceConfirmations.recordedConfirmations,
        )
        .toBe(intake ? 1 : 0);
      const creationSources = (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).sourceConfirmations;
      if (intake) {
        const receipt = intake.receipt!;
        const entries = receipt.episodes ?? [
          {
            previewEpisodeId: intake.id,
            scriptId: receipt.scriptId,
            scriptVersion: receipt.scriptVersion,
            documentId: receipt.documentId,
            documentVersion: receipt.documentVersion,
          },
        ];
        expect(creationSources.items[0]).toMatchObject({
          owner: "production",
          sourceId: intake.id,
          projectId,
          projectVersion: receipt.projectVersion,
          workflowPath: "adaptation",
          entry: "native-screenplay-intake",
          sourceFormat: intakeSource,
          lossReportReviewed: true,
          entryCount: entries.length,
          entries: entries.map((entry, sourceIndex) => ({
            kind: "script-document",
            sourceIndex,
            previewEntryId: entry.previewEpisodeId,
            id: entry.documentId,
            version: entry.documentVersion,
            scriptId: entry.scriptId,
            scriptVersion: entry.scriptVersion,
          })),
        });
        expect(JSON.stringify(creationSources)).not.toContain(
          intake.sourceName,
        );
      }
      const initialScripts = await get<RecordEntity[]>(
        `scripts?projectId=${projectId}`,
      );
      const actualEpisodes = await get<RecordEntity[]>(
        `episodes?projectId=${projectId}`,
      );
      expect(actualEpisodes).toHaveLength(
        intakeSource === "script-json" ? 2 : 1,
      );
      const original =
        entryPath === "script"
          ? intake
            ? initialScripts.find(
                (script) => script.id === intake!.receipt!.scriptId,
              )!
            : initialScripts[0]!
          : undefined;
      const otherOriginals =
        intakeSource === "script-json"
          ? await Promise.all(
              initialScripts
                .filter((script) => script.id !== original!.id)
                .map(async (script) => ({
                  script,
                  document: await get(`scripts/${script.id}/screenplay`),
                })),
            )
          : [];
      const originalScenes =
        intakeSource === "script-json"
          ? await get<RecordEntity[]>(`scenes?projectId=${projectId}`)
          : [];
      if (intakeSource === "script-json") {
        expect(intake!.receipt!.episodes).toHaveLength(2);
        expect(originalScenes).toHaveLength(2);
        for (const [index, entry] of intake!.receipt!.episodes!.entries()) {
          expect(entry.previewEpisodeId).toBe(intake!.episodes![index]!.id);
          expect(entry.episodeId).toBe(actualEpisodes[index]!.id);
          expect(await get(`scripts/${entry.scriptId}`)).toMatchObject({
            payload: { 剧本内容: intake!.episodes![index]!.content },
          });
          expect(
            await get(`scripts/${entry.scriptId}/screenplay`),
          ).toMatchObject({
            id: entry.documentId,
            blocks: intake!.episodes![index]!.blocks,
          });
          expect(await get(`scenes/${entry.scenes[0]!.id}`)).toMatchObject({
            payload: { 原场景资料: intake!.episodes![index]!.scenes[0] },
          });
        }
      }
      const originalAst = original
        ? await get(`scripts/${original.id}/screenplay`)
        : undefined;
      let importedOriginal: RecordEntity | undefined;
      let importedAst: ScreenplayDocument | undefined;
      const cockpit = () =>
        running!.page.getByLabel("项目驾驶舱", { exact: true });
      const next = () =>
        cockpit().getByLabel("唯一推荐下一步", { exact: true });
      const assertGates = async (states: string[]) => {
        await openProjectTool(running!.page, "项目驾驶舱");
        const gates = cockpit()
          .getByLabel("直写结果 Gate", { exact: true })
          .getByRole("article");
        await expect(gates).toHaveCount(4);
        for (let index = 0; index < states.length; index++)
          await expect(gates.nth(index)).toHaveAttribute(
            "data-gate-status",
            states[index]!,
          );
        await expect(next().getByRole("link")).toHaveCount(1);
        await expect(cockpit()).not.toContainText("静帧采用");
        await expect(cockpit()).not.toContainText("100%");
      };
      await assertGates(["pending", "pending", "pending", "pending"]);
      await expect(next().getByRole("link")).toHaveText("确认直写作者意图");
      await adoptIntentInUi(running.page, {
        ...INTENT,
        themeStatement: "林晚主动求证",
        mustKeep: ["姐妹信任与姐姐警告"],
        mustAvoid: ["不补小说、诊断或季纲，不覆盖原稿"],
        targetAudience: "轻悬疑短剧观众",
      });
      await assertGates(["pending", "pending", "pending", "pending"]);
      await next()
        .getByRole("link", { name: "采用正式故事圣经", exact: true })
        .click();
      const panel = () =>
        running!.page.getByLabel("单集开发工作台", { exact: true });
      await expect(panel()).toContainText("从作者创意或已有剧本独立开发单集");
      await expect(panel().getByLabel("开发分集", { exact: true })).toHaveValue(
        actualEpisodes[0]!.id,
      );
      await expect(
        panel().getByLabel("实际原剧本", { exact: true }),
      ).toHaveValue(original?.id ?? "");
      if (nativeSource) {
        const native = () =>
          panel().getByLabel("原生剧本导入", { exact: true });
        const filePath = resolve(
          `tests/fixtures/lm6/lm6-00/native-original.${nativeSource}`,
        );
        const controlPicker = () =>
          running!.application.evaluate(({ dialog }, path) => {
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: [path],
            });
          }, filePath);
        const pointer = () =>
          running!.page.evaluate(
            ({ projectId, episodeId }) =>
              JSON.parse(
                window.localStorage.getItem(
                  `dramaip-screenplay-import:${projectId}:${episodeId}`,
                )!,
              ),
            { projectId, episodeId: actualEpisodes[0]!.id },
          );
        const rights = () =>
          native().getByLabel(
            "我确认有权将此稿件导入本项目（声明不等于授权证明）。",
            { exact: true },
          );
        const loss = () =>
          native().getByLabel("我已核对完整剧本块及格式损失，接受本次转换。", {
            exact: true,
          });
        await controlPicker();
        await native()
          .getByRole("button", { name: "选择原生剧本文件", exact: true })
          .click();
        await expect(native()).toContainText("原稿导入预览 · 尚未提交");
        const canceledBinding = await pointer();
        expect(await get(`scripts?projectId=${projectId}`)).toEqual(
          initialScripts,
        );
        await native()
          .getByRole("button", { name: "取消原稿导入预览", exact: true })
          .click();
        await expect(native()).toContainText("原稿导入预览已取消");
        expect(
          await get<ScreenplayImportPreview>(
            `screenplay-import-previews/${canceledBinding.previewId}`,
          ),
        ).toMatchObject({ status: "discarded" });
        expect(await get(`scripts?projectId=${projectId}`)).toEqual(
          initialScripts,
        );
        await native()
          .getByRole("button", { name: "关闭导入记录", exact: true })
          .click();
        await native()
          .getByRole("button", { name: "选择原生剧本文件", exact: true })
          .click();
        await expect(native()).toContainText("原稿导入预览 · 尚未提交");
        const savedBinding = await pointer();
        expect(Object.keys(savedBinding).sort()).toEqual(
          ["previewId", "projectId", "episodeId", "etag", "target"].sort(),
        );
        const frozenPreview = await get<ScreenplayImportPreview>(
          `screenplay-import-previews/${savedBinding.previewId}`,
        );
        expect(frozenPreview.sourceFormat).toBe(nativeSource);
        expect(frozenPreview.parentId).toBe(actualEpisodes[0]!.id);
        await native()
          .getByLabel("完整原稿块预览", { exact: true })
          .locator("summary")
          .click();
        await expect(native()).toContainText("林晚记下姐姐的警告");
        await expect(
          native().getByLabel("格式损失报告", { exact: true }),
        ).toContainText(
          nativeSource === "fdx"
            ? "未知段落类型（转为注释）：UnsupportedLayout"
            : "未报告（不证明所有专有排版无损）",
        );
        await rights().check();
        await loss().check();
        await running.page.screenshot({
          path: testInfo.outputPath(`native-${nativeSource}-pending.png`),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-outline`;
          },
          { projectId, episodeId: actualEpisodes[0]!.id },
        );
        await expect(native()).toContainText("原稿导入预览 · 尚未提交");
        await expect(rights()).not.toBeChecked();
        await expect(loss()).not.toBeChecked();
        await expect(
          native().getByRole("button", {
            name: "明确提交本集原稿",
            exact: true,
          }),
        ).toBeDisabled();
        expect(await pointer()).toEqual(savedBinding);
        expect(
          await get(`screenplay-import-previews/${savedBinding.previewId}`),
        ).toEqual(frozenPreview);
        expect(await get(`scripts?projectId=${projectId}`)).toEqual(
          initialScripts,
        );
        let actualCommits = 0;
        if (nativeSource === "fdx")
          await running.page.route(
            `**/api/v2/screenplay-import-previews/${savedBinding.previewId}/commit`,
            async (route) => {
              // The normal Runtime completes the write; drop only its reply, never
              // replace business state or forge an import response.
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              actualCommits++;
              await route.abort("failed");
            },
          );
        await rights().check();
        await loss().check();
        await native()
          .getByRole("button", { name: "明确提交本集原稿", exact: true })
          .click();
        await expect(native()).toContainText("原稿已提交 · 不重复导入");
        if (nativeSource === "fdx") {
          await expect(native()).toContainText(
            "回复异常后已按同一预览回执确认原稿提交",
          );
          expect(actualCommits).toBe(1);
          await running.page.unroute(
            `**/api/v2/screenplay-import-previews/${savedBinding.previewId}/commit`,
          );
        }
        const committed = await get<ScreenplayImportPreview>(
          `screenplay-import-previews/${savedBinding.previewId}`,
        );
        expect(committed.receipt?.confirmation).toEqual({
          rightsDeclared: true,
          lossReportReviewed: true,
        });
        importedOriginal = await get<RecordEntity>(
          `scripts/${committed.receipt!.scriptId}`,
        );
        importedAst = await get<ScreenplayDocument>(
          `scripts/${committed.receipt!.scriptId}/screenplay`,
        );
        expect(importedOriginal.payload).toEqual({});
        expect(importedAst.blocks).toEqual(frozenPreview.blocks);
        expect(importedAst.sourceFormat).toBe(nativeSource);
        expect(
          (await get<RecordEntity[]>(`scripts?projectId=${projectId}`)).length,
        ).toBe(initialScripts.length + 1);
        await expect(
          panel().getByLabel("实际原剧本", { exact: true }),
        ).toHaveValue("");
        await panel()
          .getByLabel("实际原剧本", { exact: true })
          .selectOption(importedOriginal.id);
        await running.page.screenshot({
          path: testInfo.outputPath(`native-${nativeSource}-committed.png`),
        });
        expect(
          fixture.calls.filter(
            (call) =>
              call.kind === "episode-outline" ||
              call.kind === "episode-script" ||
              call.kind === "storyboard-package",
          ),
        ).toHaveLength(0);
      }
      const bible = panel().getByLabel("AI Story Bible", { exact: true });
      await bible
        .getByRole("button", { name: "生成并检查Story Bible", exact: true })
        .click();
      await expect(bible.locator("header").getByRole("status")).toHaveText(
        "等待审阅采用",
        { timeout: 25_000 },
      );
      await bible.getByRole("button", { name: "采用", exact: true }).click();
      await expect(panel()).toContainText("已批准 Story Bible：1 份");
      await assertGates(["ready", "pending", "pending", "pending"]);
      await expect(next().getByRole("link")).toHaveAttribute(
        "href",
        new RegExp(
          `episodeId=${actualEpisodes[0]!.id}.*operation=episode-outline`,
        ),
      );
      await next()
        .getByRole("link", { name: "开发首集单集大纲", exact: true })
        .click();
      const adopted: EpisodeDevelopmentResult[] = [];
      for (const [operation, tab, label, resultLabel, dialog] of [
        [
          "episode-outline",
          "单集大纲",
          "单集大纲",
          "单集大纲",
          "明确采用单集大纲？",
        ],
        [
          "episode-script",
          "标准剧本",
          "单集标准剧本",
          "标准剧本",
          "明确采用标准剧本？",
        ],
        [
          "storyboard-package",
          "分镜包",
          "单集分镜包",
          "分镜包",
          "明确采用单集分镜包？",
        ],
      ] as const) {
        await panel().getByRole("button", { name: tab, exact: true }).click();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const workbench = () =>
          panel().getByLabel(`AI ${label}`, { exact: true });
        await workbench()
          .getByRole("button", { name: `生成并检查${label}`, exact: true })
          .click();
        await expect(
          workbench().locator("header").getByRole("status"),
        ).toHaveText("等待审阅采用", { timeout: 25_000 });
        const workflow = (
          await get<{ items: CreationWorkflow[] }>(
            `workflows/creation?projectId=${projectId}`,
          )
        ).items.find((item) => item.input.operation === operation)!;
        expect(workflow.episodeDevelopmentBasis?.request.direct).toMatchObject({
          entryPath,
          episode: { id: actualEpisodes[0]!.id },
          durationSeconds: 90,
        });
        expect(workflow.episodeDevelopmentBasis?.diagnosis).toBeUndefined();
        expect(workflow.episodeDevelopmentBasis?.chapters).toEqual([]);
        if (importedOriginal)
          expect(
            workflow.episodeDevelopmentBasis!.request.direct!.sourceScript,
          ).toEqual({
            id: importedOriginal.id,
            version: importedOriginal.version,
            documentVersion: importedAst!.version,
          });
        else if (intakeSource && original)
          expect(
            workflow.episodeDevelopmentBasis!.request.direct!.sourceScript,
          ).toEqual({
            id: original.id,
            version: original.version,
            documentVersion: intake!.receipt!.documentVersion,
          });
        const operationIndex = [
          "episode-outline",
          "episode-script",
          "storyboard-package",
        ].indexOf(operation);
        if (
          operation === "episode-outline" &&
          entryPath === "script" &&
          !nativeSource &&
          !intakeSource
        ) {
          await discardNewerEpisodeCandidate(get, workbench, workflow);
        }
        const callsBeforePendingReturn = fixture.calls.length;
        const pendingStates = ["ready", "pending", "pending", "pending"];
        for (let index = 1; index <= operationIndex; index++)
          pendingStates[index] = "ready";
        pendingStates[operationIndex + 1] = "needs-human";
        await assertGates(pendingStates);
        await expect(next().getByRole("link")).toHaveAttribute(
          "href",
          new RegExp(`workflowId=${workflow.id}`),
        );
        await next()
          .getByRole("link", { name: "审阅并采用本阶段候选", exact: true })
          .click();
        if (operation === "episode-outline") {
          await expect(workbench()).toContainText(
            "实际直写来源（不是小说章节）",
          );
          const frozen = workflow.episodeDevelopmentBasis;
          await running.application.close();
          running = await launch(userData);
          get = await runtimeReader(running.page);
          await running.page.evaluate(
            ({ projectId, workflowId }) => {
              window.location.hash = `#/projects/${projectId}/tools/episode-development?operation=episode-outline&workflowId=${workflowId}`;
            },
            { projectId, workflowId: workflow.id },
          );
          await expect(
            workbench().locator("header").getByRole("status"),
          ).toHaveText("等待审阅采用");
          expect(
            (await get<CreationWorkflow>(`workflows/creation/${workflow.id}`))
              .episodeDevelopmentBasis,
          ).toEqual(frozen);
          await expect(panel()).toContainText("已确认直写简报");
          await assertGates(pendingStates);
          await expect(next().getByRole("link")).toHaveAttribute(
            "href",
            new RegExp(`workflowId=${workflow.id}`),
          );
          expect(fixture.calls).toHaveLength(callsBeforePendingReturn);
          if (entryPath === "script" && !nativeSource && !intakeSource)
            await cockpit().screenshot({
              path: testInfo.outputPath("direct-original-pending-cockpit.png"),
            });
          await next().getByRole("link").click();
        }
        await workbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: dialog, exact: true })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel(`正式${resultLabel} v1`, { exact: true }),
        ).toBeVisible();
        const result = (
          await get<{ items: EpisodeDevelopmentResult[] }>(
            `projects/${projectId}/episode-development`,
          )
        ).items.find((item) => item.operation === operation)!;
        expect(result.sourceState).toBe("current");
        expect(result.basis.request.direct).toEqual(
          workflow.episodeDevelopmentBasis!.request.direct,
        );
        adopted.push(result);
        pendingStates[operationIndex + 1] = "ready";
        if (operation === "storyboard-package") pendingStates[3] = "pending";
        await assertGates(pendingStates);
        await next().getByRole("link").click();
      }
      if (original) {
        expect(await get(`scripts/${original.id}`)).toEqual(original);
        expect(await get(`scripts/${original.id}/screenplay`)).toEqual(
          originalAst,
        );
      }
      for (const { script, document } of otherOriginals) {
        expect(await get(`scripts/${script.id}`)).toEqual(script);
        expect(await get(`scripts/${script.id}/screenplay`)).toEqual(document);
      }
      for (const scene of originalScenes)
        expect(await get(`scenes/${scene.id}`)).toEqual(scene);
      if (importedOriginal) {
        expect(await get(`scripts/${importedOriginal.id}`)).toEqual(
          importedOriginal,
        );
        expect(await get(`scripts/${importedOriginal.id}/screenplay`)).toEqual(
          importedAst,
        );
      }
      expect(await get(`projects/${projectId}/chapters`)).toEqual([]);
      expect(await get(`projects/${projectId}/diagnoses`)).toMatchObject({
        items: [],
      });
      expect(await get(`projects/${projectId}/season-plans`)).toMatchObject({
        items: [],
      });
      expect(await get(`episodes?projectId=${projectId}`)).toHaveLength(
        intakeSource === "script-json" ? 2 : 1,
      );
      const formalScript = adopted[1]!;
      expect(await get(`scripts/${formalScript.scriptId}`)).toMatchObject({
        parentId: actualEpisodes[0]!.id,
      });
      const originalStoryboard = adopted[2]!;
      const callsBeforeConstraints = fixture.calls.length;
      const constraints = await get<EpisodeDevelopmentImpact>(
        `episode-development/${originalStoryboard.id}/impact`,
      );
      expect(
        constraints.upstreamConstraints!.items.map((item) => item.kind),
      ).toEqual([
        "direct-project",
        "author-intent",
        "story-bible",
        "episode-outline",
        "episode-script",
        "direct-episode",
        ...(originalStoryboard.basis.request.direct!.sourceScript
          ? ["direct-source-script"]
          : []),
      ]);
      expect(
        constraints.upstreamConstraints!.items.every(
          (item) => item.change === "same-reference",
        ),
      ).toBe(true);
      const directImpact = panel()
        .getByLabel("正式分镜包 v1", { exact: true })
        .getByLabel("分镜实际变化影响", { exact: true });
      await directImpact
        .getByRole("button", { name: "核对变化影响", exact: true })
        .click();
      await expect(
        directImpact.getByLabel("实际场景与镜头字段基准", { exact: true }),
      ).toContainText("4 个字段基准一致");
      expect(
        constraints.recordBaselines!.records.every(
          (item) => item.state === "unchanged",
        ),
      ).toBe(true);
      const directConstraints = directImpact.getByLabel(
        "上游正式约束版本核对",
        { exact: true },
      );
      await expect(directConstraints.locator("tbody tr")).toHaveCount(
        constraints.upstreamConstraints!.items.length,
      );
      await expect(directConstraints).toContainText(projectId);
      await expect(directConstraints).toContainText(actualEpisodes[0]!.id);
      await expect(directConstraints).not.toContainText("整季方案");
      await expect(directConstraints).not.toContainText("改编诊断");
      await directConstraints.scrollIntoViewIfNeeded();
      expect(
        await running.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await directConstraints.screenshot({
        path: testInfo.outputPath("direct-formal-constraint-observations.png"),
      });
      expect(fixture.calls.length).toBe(callsBeforeConstraints);
      expect(
        (
          await get<EpisodeDevelopmentResult>(
            `episode-development/${originalStoryboard.id}`,
          )
        ).basis,
      ).toEqual(originalStoryboard.basis);
      const callsBefore = fixture.calls.length;
      const pilotPath = join(userData, "actual-direct-internal-pilot.zip");
      await running.application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, pilotPath);
      await panel()
        .getByLabel("正式分镜包 v1", { exact: true })
        .getByRole("button", { name: "预览内部试制包", exact: true })
        .click();
      const pilotDialog = () =>
        running!.page.getByRole("dialog", {
          name: "核验并保存内部试制包",
          exact: true,
        });
      await pilotDialog()
        .getByRole("button", { name: "生成统一试制包预览", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("待明确确认");
      await expect(pilotDialog()).toContainText("没有小说、诊断或季纲版本");
      const preview = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items[0]!;
      await running.page
        .getByRole("button", { name: "关闭试制预览", exact: true })
        .click();
      await assertGates(["ready", "ready", "ready", "needs-human"]);
      await expect(next().getByRole("link")).toHaveAttribute(
        "href",
        new RegExp(`pilotPackageId=${preview.id}`),
      );
      await next()
        .getByRole("link", { name: "核验并保存内部试制包", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("待明确确认");
      // M1: the same owner package is reachable from the unified rights
      // worklist. Listing never saves/authorizes it or creates another preview.
      await running.page
        .getByRole("button", { name: "关闭试制预览", exact: true })
        .click();
      await running.page.evaluate((id) => {
        window.location.hash = `#/pending?projectId=${id}`;
      }, projectId);
      const pendingPilot = running.page.locator(
        `[data-confirmation-key="pilot-package:${preview.id}"]`,
      );
      await expect(pendingPilot).toContainText("范围与权利待确认");
      await expect(pendingPilot).toContainText("不等于授权证明");
      expect(
        (
          await get<{ items: PilotPackagePreview[] }>(
            `projects/${projectId}/pilot-packages`,
          )
        ).items.find((item) => item.id === preview.id)!.status,
      ).toBe("awaiting-confirmation");
      expect(fixture.calls).toHaveLength(callsBefore);
      await pendingPilot
        .getByRole("link", { name: "返回对应对象", exact: true })
        .click();
      await expect(running.page).toHaveURL(
        new RegExp(`pilotPackageId=${preview.id}`),
      );
      await expect(pilotDialog()).toContainText("待明确确认");
      await expect(
        pilotDialog().getByLabel("我确认这些正式版本，并有权导出这份试制包", {
          exact: true,
        }),
      ).not.toBeChecked();
      await pilotDialog().screenshot({
        path: testInfo.outputPath("m1-original-pilot-rights.png"),
      });
      for (const name of [
        "我确认这些正式版本，并有权导出这份试制包",
        "我确认此包仅用于内部试制审阅，不作为发行就绪证明",
        "我已知悉质量、授权范围、费用与上述缺失项尚未全部核验",
      ])
        await pilotDialog().getByLabel(name, { exact: true }).check();
      await pilotDialog()
        .getByRole("button", { name: "确认并保存 ZIP 试制包", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("试制包已保存并核验。");
      const savedSummary = (
        await get<{ items: PilotPackagePreview[] }>(
          `projects/${projectId}/pilot-packages`,
        )
      ).items.find((item) => item.status === "saved")!;
      const saved = await get<PilotPackagePreview>(
        `pilot-packages/${savedSummary.id}`,
      );
      const bytes = await readFile(pilotPath);
      const zip = unzipSync(bytes);
      expect(saved.receipt).toMatchObject({
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
      });
      expect(JSON.parse(strFromU8(zip["manifest.json"]!))).toEqual(
        saved.manifest,
      );
      expect(saved.manifest.adopted.directSource).toEqual(
        adopted[2]!.basis.request.direct,
      );
      expect(saved.manifest.adopted.seasonPlan).toBeUndefined();
      expect(saved.manifest.adopted.diagnosis).toBeUndefined();
      expect(strFromU8(zip["lineage.json"]!)).toContain("sourceReferences");
      const directInputEvidence = JSON.parse(
        strFromU8(zip["source-context.json"]!),
      );
      expect(directInputEvidence.stages).toHaveLength(3);
      for (const stage of directInputEvidence.stages) {
        expect(stage.inputKind).toBe("direct-source");
        expect(stage.contextChapters).toEqual([]);
        expect(stage.episodeChapterMapping).toEqual([]);
        expect(stage.selection).toBeUndefined();
        expect(stage.directSource.entryPath).toBe(entryPath);
      }
      expect(fixture.calls).toHaveLength(callsBefore);
      await running.page.screenshot({
        path: test.info().outputPath(`direct-${entryPath}-saved-receipt.png`),
      });
      await running.page
        .getByRole("button", { name: "关闭试制预览", exact: true })
        .click();
      await assertGates(["ready", "ready", "ready", "ready"]);
      await expect(cockpit()).toContainText("内部试制包已保存，发行仍待核验");
      await expect(next().getByRole("link")).toHaveAttribute(
        "href",
        new RegExp(`pilotPackageId=${saved.id}`),
      );
      await cockpit().screenshot({
        path: test.info().outputPath(`direct-${entryPath}-cockpit-saved.png`),
      });
      await running.page.evaluate(() => {
        window.location.hash = "#/";
      });
      await expect(
        running.page.getByLabel("继续当前项目", { exact: true }),
      ).toContainText("内部试制包已保存，发行仍待核验");
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await running.page.evaluate(() => {
        window.location.hash = "#/";
      });
      await expect(
        running.page.getByLabel("继续当前项目", { exact: true }),
      ).toContainText("内部试制包已保存，发行仍待核验");
      await running.page
        .getByLabel("继续当前项目", { exact: true })
        .getByRole("link", { name: "查看内部试制包回执", exact: true })
        .click();
      await expect(pilotDialog()).toContainText("已保存并核验");
      expect(
        (await get<PilotPackagePreview>(`pilot-packages/${saved.id}`)).receipt,
      ).toEqual(saved.receipt);
      expect(fixture.calls).toHaveLength(callsBefore);
      await running.page
        .getByRole("button", { name: "关闭试制预览", exact: true })
        .click();
      if (entryPath === "script" && !nativeSource && !intakeSource) {
        const originalFormal = adopted.find(
          (item) => item.operation === "episode-script",
        )!;
        const immutableContent = structuredClone(originalFormal.content);
        const sceneRecords = await get(`scenes?projectId=${projectId}`);
        const shotRecords = await get(`shots?projectId=${projectId}`);
        const workflowRecords = await get(
          `workflows/creation?projectId=${projectId}`,
        );
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-script`;
          },
          { projectId, episodeId: originalFormal.episodeId },
        );
        const manual = () =>
          panel().getByLabel("人工剧本修订确认", { exact: true });
        await manual()
          .getByRole("button", { name: "审阅与确认人工修订", exact: true })
          .click();
        const actualText =
          "作者人工修订：林晚先记录号码，再核对雨声中传来的警告。";
        await manual()
          .getByLabel("人工剧本块 2", { exact: true })
          .fill(actualText);
        await manual()
          .getByRole("button", {
            name: "保存实际人工正文（不正式采用）",
            exact: true,
          })
          .click();
        await running.page
          .getByRole("dialog", { name: "保存实际人工剧本？", exact: true })
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await expect(
          manual().getByRole("button", {
            name: "预览实际人工修订正式版本",
            exact: true,
          }),
        ).toBeEnabled();
        const actual = await get<ScreenplayDocument>(
          `scripts/${originalFormal.scriptId}/screenplay`,
        );
        expect(actual.blocks[1]).toMatchObject({ text: actualText });
        expect(
          (
            await get<EpisodeDevelopmentResult>(
              `episode-development/${originalFormal.id}`,
            )
          ).content,
        ).toEqual(immutableContent);
        await manual()
          .getByRole("button", {
            name: "预览实际人工修订正式版本",
            exact: true,
          })
          .click();
        const frozen = () =>
          manual().getByLabel("冻结人工剧本确认预览", { exact: true });
        await expect(frozen()).toContainText(actualText);
        await expect(
          frozen().getByRole("button", {
            name: "确认采用人工修订为新正式剧本",
            exact: true,
          }),
        ).toBeDisabled();
        const revision = (
          await get<{ items: EpisodeScriptRevision[] }>(
            `projects/${projectId}/episode-script-revisions`,
          )
        ).items[0]!;
        expect(revision).toMatchObject({
          status: "pending",
          sourceState: "current",
          document: { version: actual.version },
        });
        expect(await get(`scenes?projectId=${projectId}`)).toEqual(
          sceneRecords,
        );
        expect(await get(`shots?projectId=${projectId}`)).toEqual(shotRecords);
        expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
          workflowRecords,
        );
        expect(fixture.calls).toHaveLength(callsBefore);
        await frozen()
          .getByRole("button", {
            name: "确认采用人工修订为新正式剧本",
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("manual-script-frozen-preview.png"),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page
          .getByRole("link", { name: "待确认", exact: true })
          .click();
        const pending = running.page.locator(
          `[data-confirmation-key="author-script-revision:${revision.id}"]`,
        );
        await expect(pending).toContainText("人工标准剧本修订");
        await pending
          .getByRole("link", { name: "返回对应对象", exact: true })
          .click();
        await expect(frozen()).toContainText(actualText);
        await expect(
          frozen().getByRole("button", {
            name: "确认采用人工修订为新正式剧本",
            exact: true,
          }),
        ).toBeDisabled();
        for (const label of [
          "我已审阅全部冻结实际正文",
          "我已核对实际连续场景映射",
          "我确认本次人工修订仍遵循原作者意图与来源；语义未获独立验证",
        ])
          await frozen().getByLabel(label, { exact: true }).check();
        await frozen()
          .getByRole("button", {
            name: "确认采用人工修订为新正式剧本",
            exact: true,
          })
          .click();
        await running.page
          .getByRole("dialog", { name: "确认新的正式剧本版本？", exact: true })
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await expect(
          panel().getByLabel("正式标准剧本 v2", { exact: true }),
        ).toBeVisible();
        const adoptedRevision = await get<EpisodeScriptRevision>(
          `episode-script-revisions/${revision.id}`,
        );
        const newFormal = await get<EpisodeDevelopmentResult>(
          `episode-development/${adoptedRevision.resultId}`,
        );
        expect(newFormal).toMatchObject({
          origin: "human-script-revision",
          scriptId: originalFormal.scriptId,
          scriptDocumentVersion: actual.version,
          runIds: [],
          sourceState: "current",
        });
        expect(newFormal.workflowId).toBeUndefined();
        expect(newFormal.model).toBeUndefined();
        expect(
          (
            await get<EpisodeDevelopmentResult>(
              `episode-development/${originalFormal.id}`,
            )
          ).content,
        ).toEqual(immutableContent);
        expect(
          await get(`scripts/${originalFormal.scriptId}/screenplay`),
        ).toEqual(actual);
        expect(await get(`scenes?projectId=${projectId}`)).toEqual(
          sceneRecords,
        );
        expect(await get(`shots?projectId=${projectId}`)).toEqual(shotRecords);
        expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
          workflowRecords,
        );
        expect(fixture.calls).toHaveLength(callsBefore);
        expect(
          (await get<PilotPackagePreview>(`pilot-packages/${saved.id}`))
            .sourceState,
        ).toBe("stale");
        await panel()
          .getByLabel("正式标准剧本 v2", { exact: true })
          .locator("h4")
          .first()
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("manual-script-adopted-after-restart.png"),
        });
        await panel()
          .getByRole("button", { name: "分镜包", exact: true })
          .click();
        const selection = panel().getByLabel("局部分镜重做范围", {
          exact: true,
        });
        await selection
          .getByRole("checkbox", { name: /^重做 pilot-shot-0/u })
          .check();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        const redoWorkbench = () =>
          panel().getByLabel("AI 单集分镜包", { exact: true });
        await redoWorkbench()
          .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
          .click();
        await expect(
          redoWorkbench().getByText("等待审阅采用", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(
          redoWorkbench().getByLabel("选中镜头局部候选", { exact: true }),
        ).toContainText("人工确认后局部重做");
        const redoList = await get<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        );
        const redo = redoList.items.find(
          (item) => item.input.episodeDevelopmentRequest?.redoShots?.length,
        )!;
        expect(redo.output?.items[0]?.data).not.toHaveProperty("scenes");
        expect(await get(`shots?projectId=${projectId}`)).toEqual(shotRecords);
        const authorRecord = shotRecords.find(
          (item) => item.payload.stableId === "pilot-shot-0",
        )!;
        const authorBootstrap = await running.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        );
        const authorEdit = await fetch(
          `${authorBootstrap.baseUrl}/api/v2/shots/${authorRecord.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${authorBootstrap.accessToken}`,
              "Content-Type": "application/json",
              "If-Match": `"${authorRecord.version}"`,
            },
            body: JSON.stringify({
              version: authorRecord.version,
              title: "作者字段标题",
              payload: {
                ...authorRecord.payload,
                镜头描述: "人工字段选择保留：先核实警告",
                私有旁注: "此私人字段不得发给模型",
              },
            }),
          },
        );
        expect(authorEdit.status, await authorEdit.clone().text()).toBe(200);
        const recordsBeforeMerge = await get(`shots?projectId=${projectId}`);
        const actualFields = () =>
          redoWorkbench().getByLabel("正式场景镜头字段比较", { exact: true });
        await expect(
          actualFields().getByLabel("实际创作字段三方比较", { exact: true }),
        ).toHaveCount(0);
        const modelCallsBeforeComparison = fixture.calls.length;
        await actualFields()
          .getByRole("button", { name: "比较实际字段", exact: true })
          .click();
        await expect(
          actualFields().getByLabel("实际创作字段三方比较", { exact: true }),
        ).toBeVisible();
        await expect(actualFields()).toContainText("比较不写入");
        await actualFields()
          .locator("summary")
          .filter({ hasText: "镜头描述" })
          .first()
          .click();
        await expect(actualFields()).toContainText("当前人工记录");
        expect(fixture.calls).toHaveLength(modelCallsBeforeComparison);
        expect(await get(`shots?projectId=${projectId}`)).toEqual(
          recordsBeforeMerge,
        );
        expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
          redoList,
        );
        await actualFields().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("storyboard-record-field-comparison.png"),
        });
        await redoWorkbench()
          .getByLabel("选中镜头局部候选", { exact: true })
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("selected-storyboard-redo-preview.png"),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package`;
          },
          { projectId, episodeId: originalFormal.episodeId },
        );
        await expect(
          panel()
            .getByLabel("局部分镜重做范围", { exact: true })
            .getByRole("checkbox", { name: /^重做 pilot-shot-0/u }),
        ).toBeChecked();
        await expect(
          redoWorkbench().getByLabel("选中镜头局部候选", { exact: true }),
        ).toContainText("人工确认后局部重做");
        await expect(
          actualFields().getByLabel("实际创作字段三方比较", { exact: true }),
        ).toHaveCount(0);
        await actualFields()
          .getByRole("button", { name: "比较实际字段", exact: true })
          .click();
        await expect(
          actualFields().getByLabel("实际创作字段三方比较", { exact: true }),
        ).toBeVisible();
        await actualFields()
          .locator("summary")
          .filter({ hasText: "镜头描述" })
          .first()
          .click();
        await actualFields()
          .getByLabel("pilot-shot-0 镜头描述选择", { exact: true })
          .selectOption("main");
        await actualFields().getByRole("checkbox").check();
        let lostMergeId = "";
        await running.page.route("**/record-rebase", async (route) => {
          const response = await route.fetch();
          expect(response.status(), await response.text()).toBe(200);
          lostMergeId = (await response.json()).id;
          await route.abort("failed");
        });
        await actualFields()
          .getByRole("button", { name: "冻结字段选择并复检", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "冻结字段合并并另行复检", exact: true })
          .getByRole("button", { name: "冻结并复检", exact: true })
          .click();
        await expect(actualFields().getByRole("alert")).toBeVisible();
        expect(lostMergeId).not.toBe("");
        const originalFieldRequest = await running.page.evaluate(
          ({ projectId, id }) =>
            JSON.parse(
              localStorage.getItem(
                `dramaip-record-field-merge:${projectId}:${id}`,
              )!,
            ),
          { projectId, id: redo.id },
        );
        expect(JSON.stringify(originalFieldRequest)).not.toContain(
          "人工字段选择保留",
        );
        expect(JSON.stringify(originalFieldRequest)).not.toContain(
          "此私人字段不得发给模型",
        );
        await expect
          .poll(
            async () =>
              (await get<CreationWorkflow>(`workflows/creation/${lostMergeId}`))
                .stage,
          )
          .toBe("awaiting-review");
        const callsAfterMerge = fixture.calls.length;
        expect(callsAfterMerge).toBe(modelCallsBeforeComparison + 1);
        expect(await get(`shots?projectId=${projectId}`)).toEqual(
          recordsBeforeMerge,
        );
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, id }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?operation=storyboard-package&workflowId=${id}`;
          },
          { projectId, id: redo.id },
        );
        await expect(
          actualFields().getByLabel("字段合并原请求恢复", { exact: true }),
        ).toBeVisible();
        expect(fixture.calls).toHaveLength(callsAfterMerge);
        await actualFields()
          .getByRole("button", { name: "重发字段合并原请求", exact: true })
          .click();
        await expect(
          actualFields().getByLabel("字段合并实际回执", { exact: true }),
        ).toContainText(lostMergeId);
        expect(fixture.calls).toHaveLength(callsAfterMerge);
        await actualFields()
          .getByRole("link", { name: "打开字段合并草稿", exact: true })
          .click();
        await expect(
          redoWorkbench().getByLabel("冻结实际字段选择", { exact: true }),
        ).toContainText("人工字段选择保留：先核实警告");
        await redoWorkbench()
          .getByLabel("冻结实际字段选择", { exact: true })
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("storyboard-record-field-merge-frozen.png"),
        });
        await redoWorkbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "明确采用选中镜头局部重做？",
            exact: true,
          })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        const newStoryboard = panel().getByLabel("正式分镜包 v2", {
          exact: true,
        });
        await expect(newStoryboard).toBeVisible();
        const changedShots = await get<
          { id: string; version: number; payload: Record<string, unknown> }[]
        >(`shots?projectId=${projectId}`);
        const oldSelected = shotRecords.find(
          (item) => item.payload.stableId === "pilot-shot-0",
        )!;
        const oldRetained = shotRecords.find(
          (item) => item.payload.stableId === "pilot-shot-1",
        )!;
        expect(changedShots).toHaveLength(shotRecords.length);
        expect(
          changedShots.find((item) => item.id === oldSelected.id),
        ).toMatchObject({
          id: oldSelected.id,
          version: oldSelected.version + 2,
          payload: {
            生成提示: "SELECTED REDO PROMPT: 克制地核实警告",
            镜头描述: "人工字段选择保留：先核实警告",
            私有旁注: "此私人字段不得发给模型",
          },
        });
        expect(changedShots.find((item) => item.id === oldRetained.id)).toEqual(
          oldRetained,
        );
        const changedScenes = await get<
          { id: string; payload: Record<string, unknown> }[]
        >(`scenes?projectId=${projectId}`);
        const untouchedScene = sceneRecords.find(
          (item) => item.payload.stableId === "pilot-scene-1",
        )!;
        expect(
          changedScenes.find((item) => item.id === untouchedScene.id),
        ).toEqual(untouchedScene);
        await newStoryboard.locator("h4").first().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("selected-storyboard-redo-adopted.png"),
        });
        expect(fixture.calls).toHaveLength(callsBefore + 3);
        // Exercise the distinct author-confirmed structural protocol after the
        // legacy fixed-mapping redo, never upgrade that existing candidate.
        await panel()
          .getByRole("button", { name: "标准剧本", exact: true })
          .click();
        await manual()
          .getByRole("button", { name: "审阅与确认人工修订", exact: true })
          .click();
        await manual()
          .getByRole("button", { name: "在人工块 2 后新增动作", exact: true })
          .click();
        const structuralText = "新增动作：林晚将号码和雨声记录交给警员核对。";
        await manual()
          .getByLabel("人工剧本块 3", { exact: true })
          .fill(structuralText);
        await manual()
          .getByRole("button", { name: "上移人工块 3", exact: true })
          .click();
        await manual()
          .getByRole("button", { name: "移除人工块 3", exact: true })
          .click();
        await expect(
          manual().getByLabel("人工剧本块 2", { exact: true }),
        ).toHaveValue(structuralText);
        await manual()
          .getByRole("button", {
            name: "保存实际人工正文（不正式采用）",
            exact: true,
          })
          .click();
        await running.page
          .getByRole("dialog", { name: "保存实际人工剧本？", exact: true })
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await expect(
          manual().getByRole("button", {
            name: "预览实际人工修订正式版本",
            exact: true,
          }),
        ).toBeEnabled();
        await manual()
          .getByRole("button", {
            name: "预览实际人工修订正式版本",
            exact: true,
          })
          .click();
        await expect(frozen()).toContainText(structuralText);
        for (const label of [
          "我已审阅全部冻结实际正文",
          "我已核对实际连续场景映射",
          "我确认本次人工修订仍遵循原作者意图与来源；语义未获独立验证",
        ])
          await frozen().getByLabel(label, { exact: true }).check();
        await frozen()
          .getByRole("button", {
            name: "确认采用人工修订为新正式剧本",
            exact: true,
          })
          .click();
        await running.page
          .getByRole("dialog", { name: "确认新的正式剧本版本？", exact: true })
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await expect(
          panel().getByLabel("正式标准剧本 v3", { exact: true }),
        ).toBeVisible();
        const currentDoc = await get<ScreenplayDocument>(
          `scripts/${originalFormal.scriptId}/screenplay`,
        );
        expect(currentDoc.blocks[1]).toMatchObject({ text: structuralText });
        expect(currentDoc.blocks[1]!.id).not.toBe(actual.blocks[1]!.id);
        await panel()
          .getByRole("button", { name: "分镜包", exact: true })
          .click();
        const structuralChoice = () =>
          panel()
            .getByLabel("局部分镜重做范围", { exact: true })
            .getByRole("checkbox", { name: /^按已正式确认的新块结构重做/u });
        await structuralChoice().check();
        await panel()
          .getByLabel("局部分镜重做范围", { exact: true })
          .getByRole("checkbox", { name: /^重做 pilot-shot-0/u })
          .check();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        await expect(panel()).toContainText("明确使用已确认块结构协议");
        await expect(running.page).not.toHaveURL(/workflowId=/u);
        await redoWorkbench()
          .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
          .click();
        await expect(
          redoWorkbench().getByText("等待审阅采用", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(
          redoWorkbench().getByLabel("冻结块结构映射", { exact: true }),
        ).toContainText(currentDoc.blocks[1]!.id);
        await expect(
          redoWorkbench().getByLabel("选中镜头局部候选", { exact: true }),
        ).toContainText("已确认新块结构接续");
        expect(await get(`shots?projectId=${projectId}`)).toEqual(changedShots);
        await redoWorkbench()
          .getByLabel("冻结块结构映射", { exact: true })
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("confirmed-block-structure-preview.png"),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package`;
          },
          { projectId, episodeId: originalFormal.episodeId },
        );
        await expect(structuralChoice()).toBeChecked();
        await expect(
          redoWorkbench().getByLabel("冻结块结构映射", { exact: true }),
        ).toContainText(currentDoc.blocks[1]!.id);
        const structuralRuns = await get<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        );
        const originalStructure = structuralRuns.items.find(
          (item) =>
            item.stage === "awaiting-review" &&
            item.input.episodeDevelopmentRequest?.redoMode ===
              "confirmed-block-structure" &&
            !item.recordMergeSource,
        )!;
        expect(originalStructure).toBeDefined();
        const currentSelected = (
          await get<
            {
              id: string;
              title: string;
              version: number;
              payload: Record<string, unknown>;
            }[]
          >(`shots?projectId=${projectId}`)
        ).find((item) => item.id === oldSelected.id)!;
        const structuralBootstrap = await running.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        );
        const structuralEdit = await fetch(
          `${structuralBootstrap.baseUrl}/api/v2/shots/${currentSelected.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${structuralBootstrap.accessToken}`,
              "Content-Type": "application/json",
              "If-Match": `"${currentSelected.version}"`,
            },
            body: JSON.stringify({
              version: currentSelected.version,
              title: "结构合并作者标题",
              payload: {
                ...currentSelected.payload,
                镜头描述: "结构候选采用前作者仍保留核实警告",
                生成提示: "作者新生成提示，须明确选择",
                私有字段: "结构私有旁注不发模型",
              },
            }),
          },
        );
        expect(structuralEdit.status).toBe(200);
        const structuralComparison = await get<ProductionRecordMergeComparison>(
          `workflows/creation/${originalStructure.id}/record-merge`,
        );
        expect(structuralComparison.format).toBe(
          "storyboard-record-field-comparison-v2",
        );
        const structuralReview = () =>
          redoWorkbench().getByLabel("正式场景镜头字段比较", { exact: true });
        await structuralReview()
          .getByRole("button", { name: "比较实际字段", exact: true })
          .click();
        await expect(
          structuralReview().getByLabel("字段合并冻结块映射", { exact: true }),
        ).toContainText(currentDoc.blocks[1]!.id);
        expect(
          structuralComparison.units.some(
            (unit) => unit.field === "生成提示" && unit.conflict,
          ),
        ).toBe(true);
        for (const unit of structuralComparison.units.filter(
          (unit) => unit.conflict,
        )) {
          const record = structuralComparison.records.find(
            (item) => item.id === unit.recordId,
          )!;
          const fieldChoice = structuralReview().getByLabel(
            `${record.stableId} ${unit.field}选择`,
            { exact: true },
          );
          await structuralReview()
            .locator("details")
            .filter({
              has: running.page.getByLabel(
                `${record.stableId} ${unit.field}选择`,
                { exact: true },
              ),
            })
            .locator("summary")
            .click();
          await fieldChoice.selectOption(
            unit.field === "生成提示" ? "branch" : "main",
          );
        }
        const callsBeforeStructureMerge = fixture.calls.length;
        await structuralReview()
          .getByRole("checkbox", { name: /^我已逐项核对/u })
          .check();
        await structuralReview()
          .getByRole("button", { name: "冻结字段选择并复检", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "冻结字段合并并另行复检", exact: true })
          .getByRole("button", { name: "冻结并复检", exact: true })
          .click();
        await expect(
          structuralReview().getByLabel("字段合并实际回执", { exact: true }),
        ).toBeVisible();
        const structureMerged = (
          await get<{ items: CreationWorkflow[] }>(
            `workflows/creation?projectId=${projectId}`,
          )
        ).items.find(
          (item) =>
            item.recordMergeSource?.request.workflow.id ===
            originalStructure.id,
        )!;
        expect(structureMerged.recordMergeSource?.format).toBe(
          "storyboard-record-field-merge-v2",
        );
        await expect
          .poll(
            async () =>
              (
                await get<CreationWorkflow>(
                  `workflows/creation/${structureMerged.id}`,
                )
              ).stage,
          )
          .toBe("awaiting-review");
        expect(fixture.calls).toHaveLength(callsBeforeStructureMerge + 1);
        expect(JSON.stringify(fixture.calls)).not.toContain(
          "结构私有旁注不发模型",
        );
        await structuralReview()
          .getByRole("link", { name: "打开字段合并草稿", exact: true })
          .click();
        await expect(
          redoWorkbench().getByLabel("冻结实际字段选择", { exact: true }),
        ).toContainText("结构合并作者标题");
        await expect(
          redoWorkbench().getByLabel("冻结实际字段选择", { exact: true }),
        ).not.toContainText("结构私有旁注不发模型");
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, episodeId, workflowId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package&workflowId=${workflowId}`;
          },
          {
            projectId,
            episodeId: originalFormal.episodeId,
            workflowId: structureMerged.id,
          },
        );
        await expect(
          redoWorkbench().getByLabel("冻结实际字段选择", { exact: true }),
        ).toContainText("结构候选采用前作者仍保留核实警告");
        await expect(
          redoWorkbench().getByLabel("冻结块结构映射", { exact: true }),
        ).toContainText(currentDoc.blocks[1]!.id);
        expect(fixture.calls).toHaveLength(callsBeforeStructureMerge + 1);
        await redoWorkbench()
          .getByLabel("冻结实际字段选择", { exact: true })
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath(
            "confirmed-structure-record-fields-frozen.png",
          ),
        });
        await redoWorkbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "明确采用选中镜头局部重做？",
            exact: true,
          })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel("正式分镜包 v3", { exact: true }),
        ).toBeVisible();
        const structuralShots = await get<
          { id: string; version: number; payload: Record<string, unknown> }[]
        >(`shots?projectId=${projectId}`);
        expect(structuralShots).toHaveLength(changedShots.length);
        expect(
          structuralShots.find((item) => item.id === oldSelected.id),
        ).toMatchObject({
          version: oldSelected.version + 4,
          title: "结构合并作者标题",
          payload: {
            sourceBlockIds: [
              currentDoc.blocks[0]!.id,
              currentDoc.blocks[1]!.id,
            ],
            生成提示: "STRUCTURE REDO PROMPT: 新块映射证据核对",
            镜头描述: "结构候选采用前作者仍保留核实警告",
            私有字段: "结构私有旁注不发模型",
          },
        });
        expect(
          structuralShots.find((item) => item.id === oldRetained.id),
        ).toEqual(oldRetained);
        expect(
          (await get<{ id: string }[]>(`scenes?projectId=${projectId}`)).find(
            (item) => item.id === untouchedScene.id,
          ),
        ).toEqual(untouchedScene);
        await panel()
          .getByLabel("正式分镜包 v3", { exact: true })
          .locator("h4")
          .first()
          .scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("confirmed-block-structure-adopted.png"),
        });
        expect(fixture.calls).toHaveLength(callsBefore + 6);
        // The author changes actual shot topology; the model cannot invent the
        // structure. Both preview and adoption survive a background restart.
        const planChoice = () =>
          panel().getByRole("checkbox", { name: /^按作者场景镜头计划重做/u });
        await planChoice().check();
        const planEditor = () =>
          panel().getByLabel("作者场景镜头计划", { exact: true });
        const plannedScene = () =>
          planEditor().getByLabel("场景 1 镜头计划", { exact: true });
        await plannedScene()
          .getByRole("checkbox", { name: /^纳入场景 1 的全部原镜头/u })
          .check();
        await plannedScene()
          .getByRole("spinbutton", {
            name: "计划镜头 1 时长（秒）",
            exact: true,
          })
          .fill("20");
        await plannedScene()
          .getByRole("button", {
            name: "新增镜头（新身份，初始 1 秒，请调整）",
            exact: true,
          })
          .click();
        await plannedScene()
          .getByRole("spinbutton", {
            name: "计划镜头 2 时长（秒）",
            exact: true,
          })
          .fill("25");
        await plannedScene()
          .getByRole("button", { name: "上移计划镜头 2", exact: true })
          .click();
        await expect(plannedScene()).toContainText("新计划 2 镜头 · 45 秒");
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        await expect(panel()).toContainText("明确冻结作者新镜头计划");
        expect(fixture.calls).toHaveLength(callsBefore + 6);
        await redoWorkbench()
          .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
          .click();
        await expect(
          redoWorkbench().getByText("等待审阅采用", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        const frozenPlan = () =>
          redoWorkbench().getByLabel("冻结作者镜头计划", { exact: true });
        await expect(frozenPlan()).toContainText("新增");
        await expect(frozenPlan()).toContainText("复用");
        await expect(
          redoWorkbench().getByLabel("正式场景镜头字段比较", { exact: true }),
        ).toHaveCount(1);
        const plannedRuns = await get<{ items: CreationWorkflow[] }>(
          `workflows/creation?projectId=${projectId}`,
        );
        const plannedRun = plannedRuns.items.find(
          (item) =>
            item.stage === "awaiting-review" &&
            item.input.episodeDevelopmentRequest?.redoMode ===
              "scene-shot-plan",
        )!;
        const plannedRequest = plannedRun.input.episodeDevelopmentRequest!;
        const newIdentity =
          plannedRequest.redoShotPlan!.scenePlans[0]!.shots[0]!.id;
        expect(newIdentity).toMatch(/^[a-f0-9-]{36}$/u);
        expect(
          plannedRequest.redoShotPlan!.scenePlans[0]!.shots[1]!.retains,
        ).toMatchObject({ recordId: oldSelected.id });
        expect(await get(`shots?projectId=${projectId}`)).toEqual(
          structuralShots,
        );
        const callsAfterPlan = fixture.calls.length;
        expect(callsAfterPlan).toBe(callsBefore + 8);
        expect(
          JSON.stringify(fixture.calls.slice(callsBefore + 6)),
        ).not.toContain("结构私有旁注不发模型");
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, episodeId, workflowId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package&workflowId=${workflowId}`;
          },
          {
            projectId,
            episodeId: originalFormal.episodeId,
            workflowId: plannedRun.id,
          },
        );
        await expect(planChoice()).toBeChecked();
        await expect(frozenPlan()).toContainText(newIdentity);
        await expect(plannedScene()).toContainText("新计划 2 镜头 · 45 秒");
        expect(fixture.calls).toHaveLength(callsAfterPlan);
        await frozenPlan().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("author-shot-plan-frozen.png"),
        });
        await redoWorkbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "明确采用选中镜头局部重做？",
            exact: true,
          })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel("正式分镜包 v4", { exact: true }),
        ).toBeVisible();
        const activePlanShots = await get<
          {
            id: string;
            version: number;
            orderIndex: number;
            title: string;
            payload: Record<string, unknown>;
          }[]
        >(`shots?projectId=${projectId}`);
        const addedShot = activePlanShots.find(
          (shot) => shot.payload.stableId === newIdentity,
        )!;
        expect(activePlanShots).toHaveLength(structuralShots.length + 1);
        expect(addedShot).toMatchObject({
          version: 0,
          orderIndex: 0,
          payload: { 时长: 25 },
        });
        expect(
          activePlanShots.find((shot) => shot.id === oldSelected.id),
        ).toMatchObject({
          version: oldSelected.version + 5,
          orderIndex: 1,
          title: "结构合并作者标题",
          payload: { 时长: 20, 私有字段: "结构私有旁注不发模型" },
        });
        expect(
          activePlanShots.find((shot) => shot.id === oldRetained.id),
        ).toEqual(oldRetained);
        // Remove the newly created UUID in a second explicit author plan. It
        // remains readable as a retired historical row, never a hard delete.
        await planChoice().check();
        await plannedScene()
          .getByRole("checkbox", { name: /^纳入场景 1 的全部原镜头/u })
          .check();
        await plannedScene()
          .getByRole("button", { name: "移除计划镜头 1", exact: true })
          .click();
        await plannedScene()
          .getByRole("spinbutton", {
            name: "计划镜头 1 时长（秒）",
            exact: true,
          })
          .fill("45");
        await expect(plannedScene()).toContainText("将退役 1 个原镜头");
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        await redoWorkbench()
          .getByRole("button", { name: "生成并检查单集分镜包", exact: true })
          .click();
        await expect(
          redoWorkbench().getByText("等待审阅采用", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(frozenPlan()).not.toContainText(newIdentity);
        const retirementRun = (
          await get<{ items: CreationWorkflow[] }>(
            `workflows/creation?projectId=${projectId}`,
          )
        ).items.find(
          (item) =>
            item.stage === "awaiting-review" &&
            item.input.episodeDevelopmentRequest?.redoMode ===
              "scene-shot-plan" &&
            !item.recordMergeSource,
        )!;
        expect(retirementRun).toBeDefined();
        const retirementBootstrap = await running.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        );
        const retirementEdit = await fetch(
          `${retirementBootstrap.baseUrl}/api/v2/shots/${addedShot.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${retirementBootstrap.accessToken}`,
              "Content-Type": "application/json",
              "If-Match": `"${addedShot.version}"`,
            },
            body: JSON.stringify({
              version: addedShot.version,
              title: "退役镜头作者最后标题",
              payload: {
                ...addedShot.payload,
                私有旁注: "退役历史旁注不发模型",
              },
            }),
          },
        );
        expect(retirementEdit.status).toBe(200);
        const retiringActual = await retirementEdit.json();
        const shotPlanReview = () =>
          redoWorkbench().getByLabel("正式场景镜头字段比较", { exact: true });
        await shotPlanReview()
          .getByRole("button", { name: "比较实际字段", exact: true })
          .click();
        const planProof = () =>
          shotPlanReview().getByLabel("字段合并冻结镜头计划", { exact: true });
        await expect(planProof()).toContainText(`退役镜头 ${newIdentity}`);
        await expect(planProof()).toContainText("当前 v1");
        const planComparison = await get<ProductionRecordMergeComparison>(
          `workflows/creation/${retirementRun.id}/record-merge`,
        );
        expect(planComparison.format).toBe(
          "storyboard-record-field-comparison-v3",
        );
        expect(planComparison.units).toHaveLength(10);
        expect(
          planComparison.units.every((unit) => unit.recordId !== addedShot.id),
        ).toBe(true);
        expect(JSON.stringify(planComparison)).not.toContain("退役历史旁注");
        for (const unit of planComparison.units.filter(
          (unit) => unit.conflict,
        )) {
          const record = planComparison.records.find(
            (record) => record.id === unit.recordId,
          )!;
          await shotPlanReview()
            .locator("details")
            .filter({
              has: running.page.getByLabel(
                `${record.stableId} ${unit.field}选择`,
                { exact: true },
              ),
            })
            .locator("summary")
            .click();
          await shotPlanReview()
            .getByLabel(`${record.stableId} ${unit.field}选择`, { exact: true })
            .selectOption("main");
        }
        await planProof().scrollIntoViewIfNeeded();
        await running.page.screenshot({
          path: testInfo.outputPath("author-shot-plan-field-comparison.png"),
        });
        await shotPlanReview()
          .getByRole("checkbox", { name: /^我已逐项核对/u })
          .check();
        let lostPlanMergeId = "";
        await running.page.route("**/record-rebase", async (route) => {
          const response = await route.fetch();
          expect(response.status(), await response.text()).toBe(200);
          lostPlanMergeId = (await response.json()).id;
          await route.abort("failed");
        });
        const callsBeforePlanMerge = fixture.calls.length;
        await shotPlanReview()
          .getByRole("button", { name: "冻结字段选择并复检", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "冻结字段合并并另行复检", exact: true })
          .getByRole("button", { name: "冻结并复检", exact: true })
          .click();
        await expect(shotPlanReview().getByRole("alert")).toBeVisible();
        expect(lostPlanMergeId).not.toBe("");
        const originalPlanMergeRequest = await running.page.evaluate(
          ({ projectId, workflowId }) =>
            JSON.parse(
              localStorage.getItem(
                `dramaip-record-field-merge:${projectId}:${workflowId}`,
              )!,
            ),
          { projectId, workflowId: retirementRun.id },
        );
        expect(originalPlanMergeRequest.input.format).toBe(
          "storyboard-record-field-merge-request-v3",
        );
        expect(JSON.stringify(originalPlanMergeRequest)).not.toContain(
          "scenePlans",
        );
        expect(JSON.stringify(originalPlanMergeRequest)).not.toContain(
          "退役历史旁注",
        );
        await expect
          .poll(
            async () =>
              (
                await get<CreationWorkflow>(
                  `workflows/creation/${lostPlanMergeId}`,
                )
              ).stage,
          )
          .toBe("awaiting-review");
        expect(fixture.calls).toHaveLength(callsBeforePlanMerge + 1);
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, workflowId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?operation=storyboard-package&workflowId=${workflowId}`;
          },
          { projectId, workflowId: retirementRun.id },
        );
        await expect(
          shotPlanReview().getByLabel("字段合并原请求恢复", { exact: true }),
        ).toBeVisible();
        expect(fixture.calls).toHaveLength(callsBeforePlanMerge + 1);
        await shotPlanReview()
          .getByRole("button", { name: "重发字段合并原请求", exact: true })
          .click();
        await expect(
          shotPlanReview().getByLabel("字段合并实际回执", { exact: true }),
        ).toContainText(lostPlanMergeId);
        expect(fixture.calls).toHaveLength(callsBeforePlanMerge + 1);
        await shotPlanReview()
          .getByRole("link", { name: "打开字段合并草稿", exact: true })
          .click();
        await expect(
          redoWorkbench().getByLabel("冻结实际字段选择", { exact: true }),
        ).toBeVisible();
        await redoWorkbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "明确采用选中镜头局部重做？",
            exact: true,
          })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel("正式分镜包 v5", { exact: true }),
        ).toBeVisible();
        const finalShots = await get<
          { id: string; payload: Record<string, unknown> }[]
        >(`shots?projectId=${projectId}`);
        expect(finalShots).toHaveLength(structuralShots.length);
        expect(finalShots.some((shot) => shot.id === addedShot.id)).toBe(false);
        const retiredShot = await get<{
          version: number;
          retirement: { reason: string };
          payload: Record<string, unknown>;
        }>(`shots/${addedShot.id}`);
        expect(retiredShot).toMatchObject({
          version: retiringActual.version + 1,
          retirement: { reason: "author-scene-shot-plan" },
          title: retiringActual.title,
          payload: retiringActual.payload,
        });
        expect(finalShots.find((shot) => shot.id === oldRetained.id)).toEqual(
          oldRetained,
        );
        expect(fixture.calls).toHaveLength(callsBefore + 11);
        expect(JSON.stringify(fixture.calls)).not.toContain(
          "退役历史旁注不发模型",
        );
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package`;
          },
          { projectId, episodeId: originalFormal.episodeId },
        );
        await expect(
          panel().getByLabel("正式分镜包 v5", { exact: true }),
        ).toBeVisible();
        expect(await get(`shots/${addedShot.id}`)).toEqual(retiredShot);
        expect(await get(`shots?projectId=${projectId}`)).toEqual(finalShots);
        expect(fixture.calls).toHaveLength(callsBefore + 11);

        // Exercise the larger topology via normal controls, not API-created
        // formal heads. Replacing a scene keeps its old rows readable; retained
        // creative fields use their own v4 comparison, never structural choices.
        const topologyCalls = fixture.calls.length;
        const workflowsBeforeTopology = await get(
          `workflows/creation?projectId=${projectId}`,
        );
        const topologyScenesBefore = await get<RecordEntity[]>(
          `scenes?projectId=${projectId}`,
        );
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=episode-script`;
          },
          { projectId, episodeId: originalFormal.episodeId },
        );
        await panel()
          .getByRole("button", { name: "标准剧本", exact: true })
          .click();
        const topologyHistory = await get<{
          items: EpisodeDevelopmentResult[];
        }>(`projects/${projectId}/episode-development`);
        const topologyHead = topologyHistory.items.find(
          (result) => result.isCurrent && result.operation === "episode-script",
        );
        expect(topologyHead).toBeDefined();
        await testInfo.attach("topology-current-formal-metadata", {
          body: JSON.stringify(
            topologyHistory.items.map(
              ({ id, operation, version, isCurrent, origin, episodeId }) => ({
                id,
                operation,
                version,
                isCurrent,
                origin,
                episodeId,
              }),
            ),
          ),
          contentType: "application/json",
        });
        const topology = () =>
          panel().getByLabel("作者场景拓扑双正式确认", { exact: true });
        await panel()
          .getByRole("button", {
            name: "作者场景结构修订（新大纲与剧本一起确认）",
            exact: true,
          })
          .click();
        await topology()
          .getByRole("button", {
            name: "从原正式大纲与实际文档开始修订",
            exact: true,
          })
          .click();
        await topology()
          .getByRole("button", { name: "新增场景与实际块", exact: true })
          .click();
        await topology().getByLabel("场景 3 时长", { exact: true }).fill("45");
        for (const [field, value] of [
          ["location", "书店门口"],
          ["goal", "核对当面交还的线索"],
          ["conflict", "记录与口述仍有矛盾"],
          ["outcome", "保留双方说法并约定继续核查"],
        ])
          await topology()
            .getByLabel(`场景 3 ${field}`, { exact: true })
            .fill(value!);
        const newBlocks = topology().getByRole("textbox", {
          name: /^实际拓扑块 /u,
        });
        const newBlockCount = await newBlocks.count();
        await newBlocks.nth(newBlockCount - 2).fill("EXT. 书店门口 - NIGHT");
        await newBlocks
          .nth(newBlockCount - 1)
          .fill("林晚当面核对记录，保留仍未证实的线索。");
        await topology()
          .getByLabel("作者拓扑场景 2", { exact: true })
          .getByRole("button", { name: "移除场景及其实际块", exact: true })
          .click();
        await topology()
          .getByRole("button", { name: "保存实际拓扑正文", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "保存实际场景结构和正文？",
            exact: true,
          })
          .getByRole("button", { name: "确认继续", exact: true })
          .click();
        await topology()
          .getByRole("button", { name: "冻结双正式确认预览", exact: true })
          .click();
        const topologyPreview = () =>
          topology().getByLabel("原场景拓扑确认预览", { exact: true });
        await expect(topologyPreview()).toContainText("林晚当面核对记录");
        const dual = (
          await get<{ items: EpisodeTopologyRevision[] }>(
            `projects/${projectId}/episode-topology-revisions`,
          )
        ).items.find((value) => value.status === "pending")!;
        expect(dual).toBeDefined();
        expect(
          JSON.parse(await topologyPreview().locator("pre").innerText()),
        ).toEqual({
          outline: dual.outlineContent,
          script: dual.scriptContent,
        });
        expect(fixture.calls).toHaveLength(topologyCalls);
        expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
          workflowsBeforeTopology,
        );
        expect(await get(`scenes?projectId=${projectId}`)).toEqual(
          topologyScenesBefore,
        );
        expect(await get(`shots?projectId=${projectId}`)).toEqual(finalShots);
        await topologyPreview().screenshot({
          path: testInfo.outputPath("author-topology-dual-original.png"),
        });
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page
          .getByRole("link", { name: "待确认", exact: true })
          .click();
        await running.page
          .locator(
            `[data-confirmation-key="author-topology-revision:${dual.id}"]`,
          )
          .getByRole("link", { name: "返回对应对象", exact: true })
          .click();
        await expect(topologyPreview()).toContainText(dual.id);
        await expect(topologyPreview()).toContainText("林晚当面核对记录");
        expect(
          JSON.parse(await topologyPreview().locator("pre").innerText()),
        ).toEqual({
          outline: dual.outlineContent,
          script: dual.scriptContent,
        });
        await expect(
          topologyPreview().getByRole("button", {
            name: "明确采用新大纲与剧本",
            exact: true,
          }),
        ).toBeDisabled();
        await topologyPreview().screenshot({
          path: testInfo.outputPath("author-topology-dual-restored.png"),
        });
        const exactTopologyRoute = await running.page.evaluate(
          () => window.location.hash,
        );
        const wrongTopologyRoute = exactTopologyRoute.replace(
          `resultId=${dual.sourceScript.id}`,
          `resultId=${originalFormal.id}`,
        );
        expect(wrongTopologyRoute).not.toBe(exactTopologyRoute);
        await running.page.evaluate((route) => {
          window.location.hash = route;
        }, wrongTopologyRoute);
        await expect(topology().getByRole("alert")).toContainText(
          "不属于原正式剧本",
        );
        await expect(topologyPreview()).toHaveCount(0);
        expect(fixture.calls).toHaveLength(topologyCalls);
        await running.page.evaluate((route) => {
          window.location.hash = route;
        }, exactTopologyRoute);
        await expect(topologyPreview()).toContainText(dual.id);
        const unavailableTopologyPath = `**/api/v2/episode-topology-revisions/${dual.id}`;
        await running.page.route(unavailableTopologyPath, (route) =>
          route.abort("failed"),
        );
        await running.page.evaluate(() => {
          window.location.hash = "#/";
        });
        await expect(topologyPreview()).toHaveCount(0);
        await running.page.evaluate((route) => {
          window.location.hash = route;
        }, exactTopologyRoute);
        await expect(topology().getByRole("alert")).toBeVisible();
        await expect(topologyPreview()).toHaveCount(0);
        expect(fixture.calls).toHaveLength(topologyCalls);
        await running.page.unroute(unavailableTopologyPath);
        await running.page.evaluate(() => {
          window.location.hash = "#/";
        });
        await expect(topologyPreview()).toHaveCount(0);
        await running.page.evaluate((route) => {
          window.location.hash = route;
        }, exactTopologyRoute);
        await expect(topologyPreview()).toContainText(dual.id);
        expect(fixture.calls).toHaveLength(topologyCalls);
        for (const label of [
          "已审阅实际保存正文",
          "已审阅新完整大纲的身份、顺序和时长",
          "已审阅全部实际连续块映射",
          "作者意图与原故事来源保留；语义仅由我声明",
        ])
          await topologyPreview().getByLabel(label, { exact: true }).check();
        await topologyPreview()
          .getByRole("button", { name: "明确采用新大纲与剧本", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "一起确认新正式大纲与剧本？",
            exact: true,
          })
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (
                await get<EpisodeTopologyRevision>(
                  `episode-topology-revisions/${dual.id}`,
                )
              ).status,
          )
          .toBe("adopted");
        const adoptedDual = await get<EpisodeTopologyRevision>(
          `episode-topology-revisions/${dual.id}`,
        );
        const topologyScript = await get<EpisodeDevelopmentResult>(
          `episode-development/${adoptedDual.results!.script.id}`,
        );
        if (topologyScript.content.kind !== "episode-script")
          throw new Error("Actual immutable topology script required");
        fixture.setConfirmedTopologyScript(topologyScript.content.value);
        expect(fixture.calls).toHaveLength(topologyCalls);
        expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
          workflowsBeforeTopology,
        );
        await running.page.evaluate(
          ({ projectId, episodeId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?episodeId=${episodeId}&operation=storyboard-package`;
          },
          { projectId, episodeId: originalFormal.episodeId },
        );
        await expect(
          panel().getByRole("button", {
            name: "明确按新双正式版本建立场景拓扑计划（须核对退役）",
            exact: true,
          }),
        ).toBeVisible();
        await panel()
          .getByRole("button", {
            name: "明确按新双正式版本建立场景拓扑计划（须核对退役）",
            exact: true,
          })
          .click();
        const topologyPlan = () =>
          panel().getByLabel("作者场景拓扑计划", { exact: true });
        await topologyPlan()
          .getByLabel("拓扑场景 1", { exact: true })
          .getByRole("checkbox", { name: /^明确重做此场景全部旧镜头/u })
          .check();
        for (const checkbox of await topologyPlan()
          .getByRole("checkbox", {
            name: /^明确退役旧/u,
          })
          .all())
          await checkbox.check();
        await panel()
          .getByRole("button", { name: "确认本轮单集基准", exact: true })
          .click();
        await redoWorkbench()
          .getByRole("button", {
            name: "生成并检查单集分镜包",
            exact: true,
          })
          .click();
        await expect(
          redoWorkbench().getByText("等待审阅采用", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        const topologyRun = (
          await get<{ items: CreationWorkflow[] }>(
            `workflows/creation?projectId=${projectId}`,
          )
        ).items.find(
          (value) =>
            value.input.episodeDevelopmentRequest?.redoMode ===
            "scene-topology-plan",
        )!;
        expect(topologyRun.episodeDevelopmentBasis!.storyboardRedo!.scope).toBe(
          "author-frozen-scene-topology-plan-v1",
        );
        expect(
          fixture.calls.slice(topologyCalls).map((call) => call.kind),
        ).toEqual(["storyboard-package", "check"]);
        const retainedTopologyShot = finalShots.find(
          (shot) => shot.id === oldSelected.id,
        )!;
        const editBootstrap = await running.page.evaluate(() =>
          window.runtimeBootstrap.resolve(),
        );
        const edit = await fetch(
          `${editBootstrap.baseUrl}/api/v2/shots/${retainedTopologyShot.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${editBootstrap.accessToken}`,
              "Content-Type": "application/json",
              "If-Match": `"${(retainedTopologyShot as RecordEntity).version}"`,
            },
            body: JSON.stringify({
              version: (retainedTopologyShot as RecordEntity).version,
              title: "拓扑候选后作者保留标题",
              payload: {
                ...retainedTopologyShot.payload,
                私有拓扑: "TOPOLOGY_PRIVATE_OWNER_NEVER_MODEL",
              },
            }),
          },
        );
        expect(edit.status, await edit.clone().text()).toBe(200);
        const topologyActual = await edit.json();
        const topologyReview = () =>
          redoWorkbench().getByLabel("正式场景镜头字段比较", { exact: true });
        await topologyReview()
          .getByRole("button", { name: "比较实际字段", exact: true })
          .click();
        const comparison = await get<ProductionRecordMergeComparison>(
          `workflows/creation/${topologyRun.id}/record-merge`,
        );
        expect(comparison.format).toBe("storyboard-record-field-comparison-v4");
        await expect(
          topologyReview().getByLabel("字段合并冻结场景拓扑计划", {
            exact: true,
          }),
        ).toContainText("明确退役场景");
        for (const unit of comparison.units.filter((unit) => unit.conflict)) {
          const record = comparison.records.find(
            (record) => record.id === unit.recordId,
          )!;
          const choice = `${record.stableId} ${unit.field}选择`;
          await topologyReview()
            .locator("details")
            .filter({
              has: running.page.getByLabel(choice, { exact: true }),
            })
            .locator("summary")
            .click();
          await topologyReview()
            .getByLabel(choice, { exact: true })
            .selectOption("main");
        }
        await topologyReview()
          .getByRole("checkbox", { name: /^我已逐项核对/u })
          .check();
        let lostTopologyMergeId = "";
        await running.page.route("**/record-rebase", async (route) => {
          const response = await route.fetch();
          expect(response.status(), await response.text()).toBe(200);
          lostTopologyMergeId = (await response.json()).id;
          await route.abort("failed");
        });
        await topologyReview()
          .getByRole("button", { name: "冻结字段选择并复检", exact: true })
          .click();
        await running.page
          .getByRole("dialog", { name: "冻结字段合并并另行复检", exact: true })
          .getByRole("button", { name: "冻结并复检", exact: true })
          .click();
        await expect(topologyReview().getByRole("alert")).toBeVisible();
        expect(lostTopologyMergeId).not.toBe("");
        await expect
          .poll(
            async () =>
              (
                await get<CreationWorkflow>(
                  `workflows/creation/${lostTopologyMergeId}`,
                )
              ).stage,
          )
          .toBe("awaiting-review");
        expect(
          fixture.calls.slice(topologyCalls).map((call) => call.kind),
        ).toEqual(["storyboard-package", "check", "check"]);
        await running.application.close();
        running = await launch(userData);
        get = await runtimeReader(running.page);
        await running.page.evaluate(
          ({ projectId, workflowId }) => {
            window.location.hash = `#/projects/${projectId}/tools/episode-development?operation=storyboard-package&workflowId=${workflowId}`;
          },
          { projectId, workflowId: topologyRun.id },
        );
        await expect(
          topologyReview().getByLabel("字段合并原请求恢复", { exact: true }),
        ).toBeVisible();
        expect(fixture.calls).toHaveLength(topologyCalls + 3);
        await topologyReview()
          .getByRole("button", { name: "重发字段合并原请求", exact: true })
          .click();
        await expect(
          topologyReview().getByLabel("字段合并实际回执", { exact: true }),
        ).toContainText(lostTopologyMergeId);
        expect(fixture.calls).toHaveLength(topologyCalls + 3);
        await topologyReview()
          .getByRole("link", { name: "打开字段合并草稿", exact: true })
          .click();
        await expect(
          redoWorkbench().getByLabel("冻结作者场景拓扑计划", { exact: true }),
        ).toBeVisible();
        await redoWorkbench().screenshot({
          path: testInfo.outputPath("author-topology-v4-restored.png"),
        });
        await redoWorkbench()
          .getByRole("button", { name: "采用", exact: true })
          .click();
        await running.page
          .getByRole("dialog", {
            name: "明确采用选中镜头局部重做？",
            exact: true,
          })
          .getByRole("button", { name: "明确采用", exact: true })
          .click();
        await expect(
          panel().getByLabel("正式分镜包 v6", { exact: true }),
        ).toBeVisible();
        expect(await get(`shots/${oldSelected.id}`)).toMatchObject({
          title: topologyActual.title,
          payload: { 私有拓扑: "TOPOLOGY_PRIVATE_OWNER_NEVER_MODEL" },
        });
        expect(await get(`shots/${oldRetained.id}`)).toMatchObject({
          retirement: { reason: "author-scene-topology-plan" },
          payload: oldRetained.payload,
        });
        const retiredScene = topologyScenesBefore.find(
          (scene) => scene.payload.stableId === "pilot-scene-1",
        )!;
        expect(await get(`scenes/${retiredScene.id}`)).toMatchObject({
          retirement: { reason: "author-scene-topology-plan" },
          payload: retiredScene.payload,
        });
        expect(
          await get<RecordEntity[]>(`scenes?projectId=${projectId}`),
        ).toHaveLength(2);
        expect(
          await get<RecordEntity[]>(`shots?projectId=${projectId}`),
        ).toHaveLength(2);
        expect(fixture.calls).toHaveLength(topologyCalls + 3);
        expect(JSON.stringify(fixture.calls)).not.toContain(
          "TOPOLOGY_PRIVATE_OWNER_NEVER_MODEL",
        );
        const navigationCalls = fixture.calls.length;
        const navigationWorkflows = await get(
          `workflows/creation?projectId=${projectId}`,
        );
        const openExactEpisode = async (search: string) => {
          await running!.page.evaluate(
            ({ projectId, search }) => {
              window.location.hash = `#/projects/${projectId}/tools/episode-development?${search}`;
            },
            { projectId, search },
          );
        };
        const originalResultSearch = `resultId=${originalFormal.id}&episodeId=${originalFormal.episodeId}&operation=episode-script&workflowId=${originalFormal.workflowId}`;
        const exactOriginal = () =>
          panel().getByLabel("正式标准剧本 v1", { exact: true });
        await openExactEpisode(originalResultSearch);
        await expect(exactOriginal()).toBeVisible();
        await openExactEpisode(
          `resultId=${originalFormal.id}&episodeId=wrong-episode&operation=episode-script`,
        );
        await expect(panel()).toContainText(
          "指定正式结果的项目、分集、操作或工作流不匹配",
        );
        await expect(exactOriginal()).toHaveCount(0);
        const unreadableResult = `**/api/v2/episode-development/${originalFormal.id}`;
        await running.page.route(unreadableResult, (route) =>
          route.abort("failed"),
        );
        await openExactEpisode(originalResultSearch);
        await expect(
          panel()
            .getByLabel("指定正式结果来源复核", { exact: true })
            .getByRole("alert"),
        ).toBeVisible();
        await expect(exactOriginal()).toHaveCount(0);
        await running.page.screenshot({
          path: testInfo.outputPath("episode-exact-owner-error.png"),
        });
        await running.page.unroute(unreadableResult);
        await expect(exactOriginal()).toBeVisible();
        expect(
          await get(`episode-development/${originalFormal.id}`),
        ).toMatchObject({ content: immutableContent });

        const originalRunSearch = `workflowId=${originalFormal.workflowId}&episodeId=${originalFormal.episodeId}&operation=episode-script`;
        const originalWorkbench = () =>
          panel().getByLabel("AI 单集标准剧本", { exact: true });
        await openExactEpisode(originalRunSearch);
        await expect(originalWorkbench()).toBeVisible();
        const unreadableWorkflow = `**/api/v2/workflows/creation/${originalFormal.workflowId}`;
        await running.page.route(unreadableWorkflow, (route) =>
          route.abort("failed"),
        );
        await expect(originalWorkbench()).toContainText(
          "指定原运行或原预览读取失败，未使用可操作旧缓存；创作要求保留，不切换最近运行。",
        );
        await expect(
          originalWorkbench().getByLabel("单集候选完整内容", { exact: true }),
        ).toHaveCount(0);
        await expect(
          originalWorkbench().getByRole("button", {
            name: "生成并检查单集标准剧本",
            exact: true,
          }),
        ).toBeDisabled();
        await running.page.unroute(unreadableWorkflow);
        await expect(
          originalWorkbench().getByLabel("单集候选完整内容", { exact: true }),
        ).toBeVisible();
        await openExactEpisode(
          `workflowId=${originalFormal.workflowId}&episodeId=wrong-episode&operation=episode-script`,
        );
        await expect(panel()).toContainText(
          "指定原单集运行的项目、分集、操作或冻结请求不匹配",
        );
        await expect(originalWorkbench()).toHaveCount(0);
        await running.page.route(unreadableWorkflow, (route) =>
          route.abort("failed"),
        );
        await openExactEpisode(originalRunSearch);
        await expect(panel().getByRole("alert")).toBeVisible();
        await expect(originalWorkbench()).toHaveCount(0);
        await running.page.unroute(unreadableWorkflow);
        // A new mount must read the original owner again, not the cached failure
        // or a different current run. Query order itself does not change scope.
        await openExactEpisode(
          `operation=episode-script&episodeId=${originalFormal.episodeId}`,
        );
        await openExactEpisode(originalRunSearch);
        await expect(originalWorkbench()).toBeVisible();
        await openExactEpisode("operation=unsupported&episodeId=wrong-episode");
        await expect(panel()).toContainText("指定单集操作不受支持");
        await expect(originalWorkbench()).toHaveCount(0);
        expect(await get(`workflows/creation?projectId=${projectId}`)).toEqual(
          navigationWorkflows,
        );
        expect(fixture.calls).toHaveLength(navigationCalls);
      }
      await adoptIntentInUi(running.page, {
        ...INTENT,
        themeStatement: "林晚先核实证据，再公开姐妹警告",
        mustKeep: ["姐妹信任与姐姐警告"],
        mustAvoid: ["不补小说、诊断或季纲，不覆盖原稿"],
        targetAudience: "轻悬疑短剧观众",
      });
      await assertGates(["ready", "stale", "stale", "stale"]);
      await expect(next().getByRole("link")).toHaveText("开发首集单集大纲");
      await expect(cockpit()).not.toContainText("内部包已保存");
      expect(
        (await get<PilotPackagePreview>(`pilot-packages/${saved.id}`))
          .sourceState,
      ).toBe("stale");
      await cockpit().screenshot({
        path: test.info().outputPath(`direct-${entryPath}-cockpit-stale.png`),
      });
      await running.application.close();
      running = await launch(userData);
      get = await runtimeReader(running.page);
      await running.page.evaluate((id) => {
        window.location.hash = `#/projects/${id}/tools/cockpit`;
      }, projectId);
      await expect(
        running.page.getByRole("navigation", {
          name: "项目工具导航",
          exact: true,
        }),
      ).toBeVisible();
      await assertGates(["ready", "stale", "stale", "stale"]);
      expect(
        (await get<PilotPackagePreview>(`pilot-packages/${saved.id}`)).receipt,
      ).toEqual(saved.receipt);
      expect(fixture.calls).toHaveLength(
        callsBefore +
          (entryPath === "script" && !nativeSource && !intakeSource ? 14 : 0),
      );
      expect(fixture.errors).toEqual([]);
    } finally {
      await running?.application.close();
      await fixture.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

test("小说跨章范围明确选择第一与第四章、全书不能漏读，覆盖及预算实际持久化且后台恢复，不修改正文（受控模型接口）", async () => {
  test.setTimeout(150_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-novel-cross-quality-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("跨章明确范围小说");
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    let get = await runtimeReader(running.page);
    const bodies = [
      FIRST_TEXT,
      "第二章未选原文：这里只记账，不处理铜钥匙。",
      "第三章未选原文：客人借走旧书，不涉及钥匙。",
      "第四章铜钥匙仍在阿桥口袋里，尚未归还。",
    ];
    for (let index = 0; index < bodies.length; index++) {
      if (index)
        await running.page
          .getByRole("button", { name: "＋", exact: true })
          .click();
      await expect
        .poll(
          async () =>
            (await get<Chapter[]>(`projects/${projectId}/chapters`)).length,
        )
        .toBe(index + 1);
      const chapter = (await get<Chapter[]>(`projects/${projectId}/chapters`))[
        index
      ]!;
      const editor = running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      });
      if ((await editor.getAttribute("contenteditable")) !== "true") {
        await running.page.getByText("更多操作", { exact: true }).click();
        await running.page
          .getByRole("button", { name: "微调正文", exact: true })
          .click();
      }
      await expect(editor).toHaveAttribute("contenteditable", "true");
      await editor.fill(bodies[index]!);
      await expect
        .poll(
          async () => (await get<Chapter>(`chapters/${chapter.id}`)).content,
        )
        .toBe(bodies[index]);
    }
    await running.page.getByRole("button", { name: "＋", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await get<Chapter[]>(`projects/${projectId}/chapters`)).length,
      )
      .toBe(5);
    const before = await get<Chapter[]>(`projects/${projectId}/chapters`);
    const first = before[0]!;
    const fourth = before[3]!;
    const blank = before[4]!;
    const panel = () =>
      running!.page.getByLabel("版本绑定质量报告工作台", { exact: true });
    const workbench = () =>
      panel().getByLabel("AI 版本绑定的质量报告", { exact: true });
    await openProjectTool(running.page, "质量报告");
    await expect(
      panel().getByLabel("质量检查目标", { exact: true }),
    ).toHaveValue("");
    await panel()
      .getByLabel("质量检查目标", { exact: true })
      .selectOption(`chapter-set:${projectId}`);
    await expect(
      panel().getByLabel(`质量范围章节 ${blank.title}`, { exact: true }),
    ).toBeDisabled();
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await expect(panel()).toContainText("请选择当前非空章节");
    expect(fixture.calls).toHaveLength(0);
    await panel()
      .getByLabel(`质量范围章节 ${first.title}`, { exact: true })
      .check();
    await panel()
      .getByLabel(`质量范围章节 ${fourth.title}`, { exact: true })
      .check();
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await expect(
      panel().locator('[data-quality-chapter-scope="selection"]'),
    ).toContainText("2 章原文");
    await workbench()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const local = (
      await get<{ items: NarrativeQualityReport[] }>(
        `projects/${projectId}/narrative-quality-reports`,
      )
    ).items[0]!;
    expect(local.basis.request.chapterScope).toMatchObject({
      mode: "selection",
      chapters: [
        { id: first.id, version: first.version },
        { id: fourth.id, version: fourth.version },
      ],
    });
    expect(
      local.content.issues[0]!.evidence.map((entry) => entry.sourceId),
    ).toEqual([first.id, fourth.id]);
    expect(local.basis.chapterCoverage).toMatchObject({
      mode: "selection",
      totalChapterCount: 5,
      nonEmptyChapterCount: 4,
    });
    const localPrompts = fixture.calls.map((call) => call.prompt).join("\n");
    expect(localPrompts).toContain(bodies[3]);
    expect(localPrompts).not.toContain(bodies[1]);
    expect(localPrompts).not.toContain(bodies[2]);
    await expect(
      panel().getByLabel("质量报告实际章节覆盖", { exact: true }),
    ).toContainText("本轮实际纳入 2/4 章非空原文");
    await panel()
      .getByRole("heading", { name: "确认本轮质量基准", exact: true })
      .scrollIntoViewIfNeeded();
    await running.page.screenshot({
      path: test.info().outputPath("novel-selected-chapter-quality.png"),
    });
    await panel()
      .getByRole("button", { name: "采用此质量报告", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "采用质量报告", exact: true })
      .getByRole("button", { name: "确认采用报告", exact: true })
      .click();
    await expect(panel()).toContainText("当前已采用报告");
    await panel()
      .getByLabel("跨章检查范围", { exact: true })
      .selectOption("full");
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await expect(panel()).toContainText("全书检查须明确选择全部当前非空章节");
    await expect(
      panel().locator('[data-quality-chapter-scope="selection"]'),
    ).toBeVisible();
    await panel()
      .getByRole("button", { name: "选择全部非空章节", exact: true })
      .click();
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await expect(
      panel().locator('[data-quality-chapter-scope="full"]'),
    ).toContainText("4 章原文");
    await workbench()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const whole = (
      await get<{ items: NarrativeQualityReport[] }>(
        `projects/${projectId}/narrative-quality-reports`,
      )
    ).items[0]!;
    expect(whole.id).not.toBe(local.id);
    expect(whole.content.reviewedChapters).toEqual(
      before.slice(0, 4).map(({ id, version }) => ({ id, version })),
    );
    expect(whole.basis.chapterCoverage).toMatchObject({
      mode: "full",
      included: before
        .slice(0, 4)
        .map(({ id, title, version }) => ({ id, title, version })),
      excluded: [{ id: blank.id, version: blank.version, reason: "empty" }],
    });
    expect(whole.contextBudget).toMatchObject({
      source: "estimate",
      tokenBudget: 64000,
    });
    await expect(panel()).toContainText("这是估算，不是实际 usage 或费用");
    await expect(
      panel().getByLabel("质量报告实际章节覆盖", { exact: true }),
    ).toContainText("本轮实际纳入 4/4 章非空原文");
    await panel()
      .getByRole("button", { name: "采用此质量报告", exact: true })
      .click();
    await running.page
      .getByRole("dialog", { name: "采用质量报告", exact: true })
      .getByRole("button", { name: "确认采用报告", exact: true })
      .click();
    await expect(panel()).toContainText("当前已采用报告");
    const adopted = await get<NarrativeQualityReport>(
      `narrative-quality-reports/${whole.id}`,
    );
    expect(
      (
        await get<NarrativeQualityReport>(
          `narrative-quality-reports/${local.id}`,
        )
      ).blockers,
    ).toEqual(["key-return"]);
    expect(await get<Chapter[]>(`projects/${projectId}/chapters`)).toEqual(
      before,
    );
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
      "visual-assets",
    ])
      expect(await get(`${kind}?projectId=${projectId}`)).toEqual([]);
    const summaries = JSON.stringify(
      await get(`projects/${projectId}/narrative-quality-summaries`),
    );
    expect(summaries).not.toContain(FIRST_FACT);
    expect(summaries).not.toContain(bodies[3]);
    expect(summaries).not.toContain("chapterCoverage");
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
      ),
    ).toBe(true);
    await panel()
      .getByLabel("质量报告实际章节覆盖", { exact: true })
      .scrollIntoViewIfNeeded();
    await running.page.screenshot({
      path: test.info().outputPath("novel-full-chapter-quality.png"),
    });
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await running.page.evaluate(
      ({ projectId, reportId }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${reportId}`;
      },
      { projectId, reportId: whole.id },
    );
    await expect(
      panel().getByLabel("跨章检查范围", { exact: true }),
    ).toHaveValue("full");
    await expect(
      panel().locator('[data-quality-chapter-scope="full"]'),
    ).toContainText("4 章原文");
    expect(
      await get<NarrativeQualityReport>(
        `narrative-quality-reports/${whole.id}`,
      ),
    ).toEqual(adopted);
    await running.page.evaluate(
      ({ projectId, chapterId }) => {
        window.location.hash = `#/projects/${projectId}?chapterId=${chapterId}`;
      },
      { projectId, chapterId: fourth.id },
    );
    await running.page.getByText("更多操作", { exact: true }).click();
    await running.page
      .getByRole("button", { name: "微调正文", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "章节正文编辑器", exact: true })
      .fill(`${bodies[3]}\n作者新版本，不自动重绑旧报告。`);
    await expect
      .poll(async () => (await get<Chapter>(`chapters/${fourth.id}`)).version)
      .toBe(fourth.version + 1);
    await running.page.evaluate(
      ({ projectId, reportId }) => {
        window.location.hash = `#/projects/${projectId}/tools/quality-review?reportId=${reportId}`;
      },
      { projectId, reportId: whole.id },
    );
    await expect(panel()).toContainText("来源已失效（只保留历史）");
    await expect(
      workbench().getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      }),
    ).toBeDisabled();
    const stale = await get<NarrativeQualityReport>(
      `narrative-quality-reports/${whole.id}`,
    );
    expect(stale.version).toBe(adopted.version);
    expect(stale.content).toEqual(adopted.content);
    expect(
      fixture.calls.filter((call) => call.kind === "quality-review"),
    ).toHaveLength(2);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("全书非空章节范围新增后，专用诊断拒绝保留原候选集合凭证且后台重启只读恢复（受控接口）", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-whole-book-collection-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  const body =
    "电话接通时，姐姐只留下“不要相信来电的人”便失去声音。林晚决定先核对姐姐留下的线索，不先替读者解释真相。";
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("全书范围原候选凭证");
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    let get = await runtimeReader(running.page);
    const original = (
      await get<Chapter[]>(`projects/${projectId}/chapters`)
    )[0]!;
    const bootstrap = await running.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const changed = await fetch(
      `${bootstrap.baseUrl}/api/v2/chapters/${original.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          "If-Match": `"${original.version}"`,
        },
        body: JSON.stringify({ version: original.version, content: body }),
      },
    );
    expect(changed.status).toBe(200);
    const chapter = (await changed.json()) as Chapter;
    await adoptIntentInUi(running.page, {
      ...INTENT,
      themeStatement: "姐妹信任与主动求证",
      mustKeep: ["姐姐的电话警告"],
      mustAvoid: ["不虚构未读来源或媒体"],
    });
    await openProjectTool(running.page, "改编诊断");
    const panel = running.page.getByLabel("改编诊断工作台", { exact: true });
    await panel
      .getByLabel("诊断范围", { exact: true })
      .selectOption("whole-book");
    await panel
      .getByLabel(`诊断来源 ${chapter.title}`, { exact: true })
      .check();
    await panel.getByLabel("诊断来源权利声明", { exact: true }).check();
    await panel.getByLabel("诊断目标集数", { exact: true }).fill("2");
    await panel
      .getByRole("button", { name: "确认本轮来源与版本", exact: true })
      .click();
    const workbench = panel.getByLabel("AI 改编诊断", { exact: true });
    await workbench
      .getByRole("button", { name: "生成并检查改编诊断", exact: true })
      .click();
    await expect(workbench.locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const pending = (
      await get<{ items: AdaptationDiagnosis[] }>(
        `projects/${projectId}/diagnoses`,
      )
    ).items[0]!;
    expect(pending).toMatchObject({
      status: "pending",
      stateVersion: 0,
      basis: {
        scope: "whole-book",
        chapters: [{ id: chapter.id, version: chapter.version }],
      },
    });
    const models = fixture.calls.length;
    const addedResponse = await fetch(`${bootstrap.baseUrl}/api/v2/chapters`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        title: "PRIVATE new eligible chapter",
        content: "PRIVATE added source body must not appear in the receipt",
      }),
    });
    expect(addedResponse.status).toBe(201);
    const added = (await addedResponse.json()) as Chapter;
    const candidate = panel.getByLabel(`诊断候选 v${pending.version}`, {
      exact: true,
    });
    await expect(
      candidate.getByRole("button", {
        name: "采用诊断，下一步独立策略",
        exact: true,
      }),
    ).toBeDisabled();
    const key = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const rejection = await fetch(
        `${bootstrap.baseUrl}/api/v2/diagnoses/${pending.id}/adopt`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bootstrap.accessToken}`,
            "Content-Type": "application/json",
            "If-Match": `"${pending.stateVersion}"`,
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      expect(rejection.status).toBe(409);
    }
    await expect(candidate).toHaveAttribute(
      "data-diagnosis-state-version",
      "1",
    );
    const summaryPath = `projects/${projectId}/creative-outcomes/summary`;
    await expect
      .poll(
        async () =>
          (await get<CreativeOutcomeSummary>(summaryPath)).funnel.measures.find(
            (item) => item.metric === "adaptation.diagnosis",
          )!.sourceConflictCandidateCount,
      )
      .toBe(1);
    const saved = await get<CreativeOutcomeSummary>(summaryPath);
    const actual = saved.funnel.measures.find(
      (item) => item.metric === "adaptation.diagnosis",
    )!;
    expect(actual).toMatchObject({
      firstCandidates: 1,
      pendingDecision: 1,
      adoptionRejectedCount: 1,
      sourceConflictCandidateCount: 1,
      lastSourceConflict: {
        candidate: {
          id: pending.id,
          contentFingerprint: createHash("sha256")
            .update(canonicalCreativeMetricJSON(pending.content))
            .digest("hex"),
        },
        ownerRejection: {
          owner: "production",
          aggregateType: "adaptation-diagnosis",
          stateVersion: 1,
        },
        sourceConflict: {
          projectId,
          workflowId: pending.workflowId,
          changes: [],
          chapterCollection: {
            scope: "whole-book",
            inventory: "nonempty-chapters",
            inventoryOwner: "writing",
            completeness: "complete-owner-inventory",
            frozenIds: [chapter.id],
            currentIds: [chapter.id, added.id].sort(),
          },
        },
      },
    });
    const show = async () => {
      await running!.page.evaluate(() => {
        window.location.hash = "#/insights";
      });
      await running!.page
        .getByRole("combobox", { name: "所属项目", exact: true })
        .selectOption(projectId);
      const ledger = running!.page.getByLabel("本地创作结果台账", {
        exact: true,
      });
      const card = ledger.getByLabel("改编诊断首候选", { exact: true });
      await expect(card).toContainText("已核对来源冲突候选 1");
      const proof = card.locator(
        `[data-source-conflict-workflow="${pending.workflowId}"]`,
      );
      await proof.locator("summary").click();
      const collection = proof.getByLabel("全书章节集合变化证据", {
        exact: true,
      });
      await expect(collection).toContainText("冻结 1 项");
      await expect(collection).toContainText("实际核对 2 项（不是目录版本）");
      await expect(collection).toContainText(
        `进入该范围的章节引用：${added.id}`,
      );
      await expect(collection).toContainText("退出该范围的章节引用：无");
      await expect(collection).toContainText("不等于物理删除");
      await expect(proof).toContainText(pending.id);
      await expect(ledger).not.toContainText(body);
      await expect(ledger).not.toContainText(added.content);
      await expect(ledger).not.toContainText(KEY);
      return card;
    };
    await (
      await show()
    ).screenshot({
      path: test.info().outputPath("whole-book-original-candidate.png"),
    });
    expect(await get<Chapter>(`chapters/${chapter.id}`)).toEqual(chapter);
    expect(fixture.calls).toHaveLength(models);
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    expect((await get<CreativeOutcomeSummary>(summaryPath)).funnel).toEqual(
      saved.funnel,
    );
    await (
      await show()
    ).screenshot({
      path: test.info().outputPath("whole-book-restored-history.png"),
    });
    expect(await get<Chapter>(`chapters/${chapter.id}`)).toEqual(chapter);
    expect(await get<Chapter>(`chapters/${added.id}`)).toEqual(added);
    expect(fixture.calls).toHaveLength(models);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("明确段落续写的原章节改稿后只记录准确版本冲突，保留原候选与空目标，台账后台重启只读恢复（受控接口）", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-selected-context-conflict-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("已选段落冲突保留原候选");
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    let get = await runtimeReader(running.page);
    const first = (await get<Chapter[]>(`projects/${projectId}/chapters`))[0]!;
    await running.page.getByText("更多操作", { exact: true }).click();
    await running.page
      .getByRole("button", { name: "微调正文", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "章节正文编辑器", exact: true })
      .fill(FIRST_TEXT);
    await expect
      .poll(async () => (await get<Chapter>(`chapters/${first.id}`)).content)
      .toBe(FIRST_TEXT);
    const source = await get<Chapter>(`chapters/${first.id}`);
    const workbench = () =>
      running!.page.getByLabel("AI 本章正文", { exact: true });
    await workbench()
      .locator("summary")
      .filter({ hasText: "创作设置" })
      .click();
    await workbench()
      .getByRole("spinbutton", { name: "目标字数", exact: true })
      .fill("300");
    await workbench()
      .locator("summary")
      .filter({ hasText: "下一章来源范围" })
      .click();
    const selected = workbench().getByRole("group", {
      name: `前文来源 ${source.title}`,
      exact: true,
    });
    await selected
      .getByRole("button", { name: "读取此章摘要和段落", exact: true })
      .click();
    await selected
      .getByLabel(`前文表达 ${source.title}`, { exact: true })
      .selectOption("paragraphs");
    await selected
      .getByLabel(`上下文段落 ${source.title} 0`, { exact: true })
      .check();
    await workbench()
      .getByRole("button", { name: "续写下一章", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const workflow = (
      await get<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${projectId}`,
      )
    ).items.find((item) => item.input.operation === "chapter")!;
    expect(workflow.narrativeContextBasis?.chapters).toMatchObject([
      { id: source.id, version: source.version, representation: "paragraphs" },
    ]);
    const target = await get<Chapter>(`chapters/${workflow.input.targetId}`);
    expect(target.content).toBe("");
    const calls = fixture.calls.length;
    await running.page.evaluate(
      ({ projectId, chapterId }) => {
        window.location.hash = `#/projects/${projectId}?chapterId=${chapterId}`;
      },
      { projectId, chapterId: source.id },
    );
    await running.page.getByText("更多操作", { exact: true }).click();
    await running.page
      .getByRole("button", { name: "微调正文", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "章节正文编辑器", exact: true })
      .fill(`${FIRST_TEXT}\n作者新增正文，旧候选不得换源采用。`);
    await expect
      .poll(async () => (await get<Chapter>(`chapters/${source.id}`)).version)
      .toBe(source.version + 1);
    const changed = await get<Chapter>(`chapters/${source.id}`);
    await running.page.evaluate(
      ({ projectId, workflowId, chapterId }) => {
        window.location.hash = `#/projects/${projectId}?chapterId=${chapterId}&workflowId=${workflowId}`;
      },
      { projectId, workflowId: workflow.id, chapterId: target.id },
    );
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
    );
    await workbench()
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await get<CreationWorkflow>(`workflows/creation/${workflow.id}`))
            .error,
      )
      .toContain("明确冻结上下文章节");
    const preserved = await get<CreationWorkflow>(
      `workflows/creation/${workflow.id}`,
    );
    expect(preserved).toMatchObject({
      stage: "awaiting-review",
      output: workflow.output,
      narrativeContextBasis: workflow.narrativeContextBasis,
    });
    expect(await get<Chapter>(`chapters/${target.id}`)).toEqual(target);
    expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(changed);
    expect(fixture.calls).toHaveLength(calls);
    const readMeasure = async () =>
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).funnel.measures.find((measure) => measure.metric === "novel.chapter")!;
    const measure = await readMeasure();
    expect(measure).toMatchObject({
      sourceConflictCandidateCount: 1,
      firstAdopted: 0,
      pendingDecision: 1,
      lastSourceConflict: {
        candidate: { id: workflow.previewId },
        sourceConflict: {
          projectId,
          workflowId: workflow.id,
          changes: [
            {
              sourceKind: "chapter",
              frozen: { id: source.id, version: source.version },
              current: { id: changed.id, version: changed.version },
            },
          ],
        },
      },
    });
    const ledgerRequests: string[] = [];
    const showLedger = async () => {
      running!.page.on("request", (request) => {
        if (request.url().includes("/creative-outcomes"))
          ledgerRequests.push(request.method());
      });
      await running!.page.evaluate(() => {
        window.location.hash = "#/insights";
      });
      await running!.page
        .getByRole("combobox", { name: "所属项目", exact: true })
        .selectOption(projectId);
      const card = running!.page
        .getByLabel("本地创作结果台账", { exact: true })
        .getByLabel("小说章节首候选", { exact: true });
      await expect(card).toContainText("已核对来源冲突候选 1");
      const proof = card.locator(
        `[data-source-conflict-workflow="${workflow.id}"]`,
      );
      await proof.locator("summary").click();
      await expect(proof).toContainText(
        `${source.id}@${source.version} → 实际核对 ${changed.id}@${changed.version}`,
      );
      await proof.scrollIntoViewIfNeeded();
      await running!.page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await expect(proof).toBeVisible();
    };
    await showLedger();
    await running.page.screenshot({
      path: info.outputPath("selected-context-conflict-original.png"),
    });
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await showLedger();
    expect(await readMeasure()).toEqual(measure);
    expect(
      await get<CreationWorkflow>(`workflows/creation/${workflow.id}`),
    ).toEqual(preserved);
    expect(await get<Chapter>(`chapters/${target.id}`)).toEqual(target);
    expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(changed);
    expect(ledgerRequests.length).toBeGreaterThan(0);
    expect(ledgerRequests.every((method) => method === "GET")).toBe(true);
    expect(fixture.calls).toHaveLength(calls);
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
      ),
    ).toBe(true);
    await running.page.screenshot({
      path: info.outputPath("selected-context-conflict-restored.png"),
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("明确采用章摘要记录改稿而原章不变，只记原记录准确差异并保留续写候选，后台台账恢复（受控接口）", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-selected-summary-conflict-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("已选摘要记录冲突保留原候选");
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    let get = await runtimeReader(running.page);
    const first = (await get<Chapter[]>(`projects/${projectId}/chapters`))[0]!;
    const initialWorkbench = running.page.getByLabel("AI 本章正文", {
      exact: true,
    });
    await initialWorkbench
      .locator("summary")
      .filter({ hasText: "创作设置" })
      .click();
    await initialWorkbench
      .getByRole("spinbutton", { name: "目标字数", exact: true })
      .fill("300");
    await initialWorkbench
      .getByRole("button", { name: "生成并检查本章正文", exact: true })
      .click();
    await expect(
      initialWorkbench.locator("header").getByRole("status"),
    ).toHaveText("等待审阅采用", { timeout: 25000 });
    const firstWorkflow = (
      await get<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${projectId}`,
      )
    ).items.find((item) => item.input.operation === "chapter")!;
    await initialWorkbench
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await get<CreationWorkflow>(
              `workflows/creation/${firstWorkflow.id}`,
            )
          ).memoryState,
        { timeout: 20000 },
      )
      .toBe("synced");
    const record = (
      await get<RecordEntity[]>(`chapter-memories?projectId=${projectId}`)
    ).find((item) => item.payload.sourceChapterId === first.id)!;
    expect(record.version).toBe(0);
    const source = await get<Chapter>(`chapters/${first.id}`);
    const workbench = () =>
      running!.page.getByLabel("AI 本章正文", { exact: true });
    const creativeSettings = workbench()
      .locator("summary")
      .filter({ hasText: "创作设置" });
    if (
      !(await creativeSettings.evaluate(
        (summary) => summary.closest("details")?.open,
      ))
    )
      await creativeSettings.click();
    await workbench()
      .getByRole("spinbutton", { name: "目标字数", exact: true })
      .fill("300");
    await workbench()
      .locator("summary")
      .filter({ hasText: "下一章来源范围" })
      .click();
    const selected = workbench().getByRole("group", {
      name: `前文来源 ${source.title}`,
      exact: true,
    });
    await selected
      .getByRole("button", { name: "读取此章摘要和段落", exact: true })
      .click();
    await selected
      .getByLabel(`前文表达 ${source.title}`, { exact: true })
      .selectOption(`summary:${record.id}`);
    await workbench()
      .getByRole("button", { name: "续写下一章", exact: true })
      .click();
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 25_000 },
    );
    const workflow = (
      await get<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${projectId}`,
      )
    ).items.find((item) => item.input.operation === "chapter")!;
    expect(workflow.narrativeContextBasis?.chapters).toMatchObject([
      {
        id: source.id,
        version: source.version,
        representation: "summary",
        record: { id: record.id, version: record.version },
      },
    ]);
    const target = await get<Chapter>(`chapters/${workflow.input.targetId}`);
    expect(target.content).toBe("");
    const calls = fixture.calls.length;
    const bootstrap = await running.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const changedResponse = await fetch(
      `${bootstrap.baseUrl}/api/v2/chapter-memories/${record.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          "If-Match": `"${record.version}"`,
        },
        body: JSON.stringify({
          version: record.version,
          payload: {
            ...record.payload,
            章节摘要: "作者明确修改摘要记录，旧候选不能换成最新摘要。",
          },
        }),
      },
    );
    expect(changedResponse.status, await changedResponse.clone().text()).toBe(
      200,
    );
    const changedRecord = (await changedResponse.json()) as RecordEntity;
    expect(changedRecord).toMatchObject({
      id: record.id,
      version: record.version + 1,
    });
    const changed = source;
    await running.page.evaluate(
      ({ projectId, workflowId, chapterId }) => {
        window.location.hash = `#/projects/${projectId}?chapterId=${chapterId}&workflowId=${workflowId}`;
      },
      { projectId, workflowId: workflow.id, chapterId: target.id },
    );
    await expect(workbench().locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
    );
    await workbench()
      .getByRole("button", { name: "采用", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await get<CreationWorkflow>(`workflows/creation/${workflow.id}`))
            .error,
      )
      .toContain("明确选择的采用章摘要");
    const preserved = await get<CreationWorkflow>(
      `workflows/creation/${workflow.id}`,
    );
    expect(preserved).toMatchObject({
      stage: "awaiting-review",
      output: workflow.output,
      narrativeContextBasis: workflow.narrativeContextBasis,
    });
    expect(await get<Chapter>(`chapters/${target.id}`)).toEqual(target);
    expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(changed);
    expect(fixture.calls).toHaveLength(calls);
    expect(await get<RecordEntity>(`chapter-memories/${record.id}`)).toEqual(
      changedRecord,
    );
    const readMeasure = async () =>
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).funnel.measures.find((measure) => measure.metric === "novel.chapter")!;
    const measure = await readMeasure();
    expect(measure).toMatchObject({
      sourceConflictCandidateCount: 1,
      firstAdopted: 1,
      pendingDecision: 1,
      lastSourceConflict: {
        candidate: { id: workflow.previewId },
        sourceConflict: {
          projectId,
          workflowId: workflow.id,
          changes: [
            {
              sourceKind: "knowledge",
              frozen: { id: record.id, version: record.version },
              current: { id: changedRecord.id, version: changedRecord.version },
            },
          ],
        },
      },
    });
    const ledgerRequests: string[] = [];
    const showLedger = async () => {
      running!.page.on("request", (request) => {
        if (request.url().includes("/creative-outcomes"))
          ledgerRequests.push(request.method());
      });
      await running!.page.evaluate(() => {
        window.location.hash = "#/insights";
      });
      await running!.page
        .getByRole("combobox", { name: "所属项目", exact: true })
        .selectOption(projectId);
      const card = running!.page
        .getByLabel("本地创作结果台账", { exact: true })
        .getByLabel("小说章节首候选", { exact: true });
      await expect(card).toContainText("已核对来源冲突候选 1");
      const proof = card.locator(
        `[data-source-conflict-workflow="${workflow.id}"]`,
      );
      await proof.locator("summary").click();
      await expect(proof).toContainText(
        `${record.id}@${record.version} → 实际核对 ${changedRecord.id}@${changedRecord.version}`,
      );
      await proof.scrollIntoViewIfNeeded();
      await running!.page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await expect(proof).toBeVisible();
    };
    await showLedger();
    await running.page.screenshot({
      path: info.outputPath("selected-summary-conflict-original.png"),
    });
    await running.application.close();
    running = await launch(userData);
    get = await runtimeReader(running.page);
    await showLedger();
    expect(await readMeasure()).toEqual(measure);
    expect(
      await get<CreationWorkflow>(`workflows/creation/${workflow.id}`),
    ).toEqual(preserved);
    expect(await get<Chapter>(`chapters/${target.id}`)).toEqual(target);
    expect(await get<Chapter>(`chapters/${source.id}`)).toEqual(changed);
    expect(ledgerRequests.length).toBeGreaterThan(0);
    expect(ledgerRequests.every((method) => method === "GET")).toBe(true);
    expect(fixture.calls).toHaveLength(calls);
    expect(
      await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
      ),
    ).toBe(true);
    await running.page.screenshot({
      path: info.outputPath("selected-summary-conflict-restored.png"),
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("正式作者意图替换后，桌面中的旧小说候选采用冲突且不写正文（受控模型接口）", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-intent-candidate-conflict-"),
  );
  const fixture = await localModelFixture();
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await configureLocalModel(running, fixture.url);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await running.page
      .getByRole("button", { name: "从创意开始", exact: true })
      .click();
    await running.page
      .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
      .click();
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("意图变更不能覆盖原稿");
    await running.page
      .getByRole("button", { name: "创建系列长篇", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    const get = await runtimeReader(running.page);
    await adoptIntentInUi(running.page, INTENT);
    const first = (
      await get<AuthorIntentCurrent>(`projects/${projectId}/author-intent`)
    ).current!;
    const projectBefore = await get(`projects/${projectId}`);
    await running.page.evaluate((id) => {
      window.location.hash = `#/projects/${id}`;
    }, projectId);
    const chapter = (
      await get<Chapter[]>(`projects/${projectId}/chapters`)
    )[0]!;
    const workbench = running.page.getByLabel("AI 本章正文", { exact: true });
    await workbench.locator("summary").filter({ hasText: "创作设置" }).click();
    await workbench
      .getByRole("spinbutton", { name: "目标字数", exact: true })
      .fill("300");
    await workbench
      .getByRole("button", { name: "生成并检查本章正文", exact: true })
      .click();
    await expect(workbench.locator("header").getByRole("status")).toHaveText(
      "等待审阅采用",
      { timeout: 20_000 },
    );
    await workbench.locator("summary").filter({ hasText: "引用资料" }).click();
    await expect(workbench.locator("[data-creation-author-intent]")).toHaveText(
      "作者意图 · v1（冻结版本）",
    );
    const workflow = (
      await get<{ items: Workflow[] }>(
        `workflows/creation?projectId=${projectId}`,
      )
    ).items[0]!;
    expect(workflow.authorIntent).toMatchObject({
      state: "adopted",
      id: first.id,
      version: 1,
    });
    expect(await get<Chapter>(`chapters/${chapter.id}`)).toEqual(chapter);
    await adoptIntentInUi(running.page, {
      ...INTENT,
      themeStatement: "NEW 作者改为主动寻找自己的位置",
    });
    const second = (
      await get<AuthorIntentCurrent>(`projects/${projectId}/author-intent`)
    ).current!;
    expect(second.version).toBe(2);
    expect(await get(`projects/${projectId}`)).toEqual(projectBefore);
    const callsBeforeAdopt = fixture.calls.length;
    await running.page
      .getByRole("link", { name: "待确认", exact: true })
      .click();
    const pending = running.page.locator(
      `[data-confirmation-key="creation:${workflow.id}"]`,
    );
    await expect(pending).toContainText("等待审阅采用");
    await pending
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const exact = running.page.getByLabel("对应待确认对象", { exact: true });
    await expect(exact).toContainText(FIRST_TEXT);
    await exact.getByRole("button", { name: "采用", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await get<Workflow & { error?: string }>(
              `workflows/creation/${workflow.id}`,
            )
          ).error,
      )
      .toContain("作者意图");
    await expect(exact.getByRole("alert")).toContainText("正式作者意图已变化");
    expect(await get<Chapter>(`chapters/${chapter.id}`)).toEqual(chapter);
    expect(
      (await get<Workflow>(`workflows/creation/${workflow.id}`)).stage,
    ).toBe("awaiting-review");
    expect(
      (await get<AuthorIntentCurrent>(`projects/${projectId}/author-intent`))
        .current!.id,
    ).toBe(second.id);
    expect(fixture.calls).toHaveLength(callsBeforeAdopt);
    for (const call of fixture.calls) {
      expect(call.prompt).toContain(`author_intent:${first.id}@1`);
      expect(call.prompt).not.toContain(second.content.themeStatement);
    }
    const observed = (
      await get<CreativeOutcomeSummary>(
        `projects/${projectId}/creative-outcomes/summary`,
      )
    ).funnel.measures.find((measure) => measure.metric === "novel.chapter")!;
    expect(observed).toMatchObject({
      sourceConflictCandidateCount: 1,
      adoptionRejectedCount: 1,
      firstAdopted: 0,
      pendingDecision: 1,
      lastSourceConflict: {
        candidate: { id: workflow.previewId },
        sourceConflict: {
          projectId,
          workflowId: workflow.id,
          changes: [
            {
              sourceKind: "author_intent",
              frozen: { id: first.id, version: first.version },
              current: { id: second.id, version: second.version },
            },
          ],
        },
      },
    });
    const readRequests: Array<{ method: string; url: string }> = [];
    running.page.on("request", (request) => {
      if (request.url().includes("/creative-outcomes"))
        readRequests.push({ method: request.method(), url: request.url() });
    });
    const showSourceLedger = async () => {
      const page = running!.page;
      await page.evaluate(() => {
        window.location.hash = "#/insights";
      });
      await page
        .getByRole("combobox", { name: "所属项目", exact: true })
        .selectOption(projectId);
      const ledger = page.getByLabel("本地创作结果台账", { exact: true });
      const card = ledger.getByLabel("小说章节首候选", { exact: true });
      await expect(card).toContainText("已核对来源冲突候选 1");
      await expect(ledger).toContainText("不是完整冲突率");
      const proof = card.locator(
        `[data-source-conflict-workflow="${workflow.id}"]`,
      );
      await proof.locator("summary").click();
      await expect(proof).toContainText(
        `${first.id}@${first.version} → 实际核对 ${second.id}@${second.version}`,
      );
      await expect(proof).toContainText(workflow.previewId!);
      await expect(ledger).not.toContainText(FIRST_TEXT);
      await expect(ledger).not.toContainText(KEY);
      await expect(ledger).not.toContainText(second.content.themeStatement);
      return { ledger, card };
    };
    const { ledger, card } = await showSourceLedger();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: test.info().outputPath("source-conflict-original-candidate.png"),
    });
    // Another real local project cannot inherit a cached proof from this one.
    const bootstrap = await running.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const foreignResponse = await fetch(
      `${bootstrap.baseUrl}/api/v2/projects`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          title: "独立未记录来源冲突项目",
          mode: "series_longform",
          modeConfig: { mode: "series_longform" },
        }),
      },
    );
    expect(foreignResponse.status, await foreignResponse.clone().text()).toBe(
      201,
    );
    const foreignProjectId = (await foreignResponse.json()).project
      .id as string;
    await running.page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(foreignProjectId);
    await expect(
      running.page.getByLabel("小说章节首候选", { exact: true }),
    ).toContainText("已核对来源冲突候选 0");
    await expect(
      running.page.locator(`[data-source-conflict-workflow="${workflow.id}"]`),
    ).toHaveCount(0);
    await running.page
      .getByRole("combobox", { name: "所属项目", exact: true })
      .selectOption(projectId);
    await expect(card).toContainText("已核对来源冲突候选 1");
    const failedSummary = `**/api/v2/projects/${projectId}/creative-outcomes/summary`;
    await running.page.route(failedSummary, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://dramaip.local/problems/controlled-read-failure",
          title: "受控台账读取失败",
          detail: "受控台账读取失败",
          status: 503,
          code: "CONTROLLED_READ_FAILURE",
          traceId: randomUUID(),
        }),
      }),
    );
    await ledger
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(ledger.getByRole("alert")).toContainText(
      "不能把读取失败当成没有成果",
      { timeout: 20000 },
    );
    await expect(card).toHaveCount(0);
    await expect(ledger.getByRole("listitem")).toHaveCount(0);
    await expect(
      ledger.locator(`[data-source-conflict-workflow="${workflow.id}"]`),
    ).toHaveCount(0);
    await running.page.unroute(failedSummary);
    await ledger
      .getByRole("button", { name: "刷新结果台账", exact: true })
      .click();
    await expect(card).toContainText("已核对来源冲突候选 1");
    expect(
      (
        await get<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).funnel.measures[0],
    ).toEqual(observed);
    expect(readRequests.length).toBeGreaterThan(0);
    expect(readRequests.every((request) => request.method === "GET")).toBe(
      true,
    );
    expect(fixture.calls).toHaveLength(callsBeforeAdopt);
    await running.application.close();
    running = await launch(userData);
    const restored = await runtimeReader(running.page);
    expect(await restored<Chapter>(`chapters/${chapter.id}`)).toEqual(chapter);
    expect(
      (await restored<Workflow>(`workflows/creation/${workflow.id}`))
        .authorIntent,
    ).toEqual(workflow.authorIntent);
    expect(
      (
        await restored<AuthorIntentCurrent>(
          `projects/${projectId}/author-intent`,
        )
      ).current!.id,
    ).toBe(second.id);
    expect(
      (
        await restored<CreativeOutcomeSummary>(
          `projects/${projectId}/creative-outcomes/summary`,
        )
      ).funnel.measures[0],
    ).toEqual(observed);
    const restoredCard = (await showSourceLedger()).card;
    await restoredCard.scrollIntoViewIfNeeded();
    await restoredCard.screenshot({
      path: test.info().outputPath("source-conflict-restored-history.png"),
    });
    expect(fixture.calls).toHaveLength(callsBeforeAdopt);
    expect(fixture.errors).toEqual([]);
  } finally {
    await running?.application.close();
    await fixture.close();
    await rm(userData, { recursive: true, force: true });
  }
});
