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

test("人工时间线换源／移除在后台逐片段确认，重启清空声明并保留锁定分割参数及撤销后的来源拦截", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-audio-resolution-ui-"),
  );
  let application: ElectronApplication | undefined;
  let page: Page;
  let client: StudioClient;
  let manager: ServerConnectionManager | undefined;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "实际人工片段换源（仅文本，不声明声音质量）",
    });
    const records = [];
    let parentId: string | undefined;
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ]) {
      const record = await client!.resources.create(kind, {
        projectId: project.id,
        parentId,
        title: `人工来源 ${kind}`,
        payload: { 动作: "实际镜头", 时长: 8 },
      });
      records.push(record);
      parentId = record.id;
    }
    const draft = await client!.episodeMedia.createAudioTrack({
      projectId: project.id,
      episodeId: records[1]!.id,
      kind: "narration",
      label: "原实际旁白轨",
      clips: [
        {
          shotId: records[4]!.id,
          startSeconds: 0,
          durationSeconds: 4,
          text: "原作者旁白（需明确字幕选择）",
        },
        {
          shotId: records[4]!.id,
          startSeconds: 4,
          durationSeconds: 1,
          text: "明确移除旧句，原轨保留",
        },
      ],
    });
    const original = await client!.episodeMedia.adoptAudioTrack(
      draft.id,
      draft.version,
      crypto.randomUUID(),
    );
    const timeline = await client!.timeline.get(records[1]!.id);
    const assembly = await client!.timeline.audioAssemblyPreview(
      records[1]!.id,
    );
    const assembled = await client!.timeline.applyAudioAssembly(
      records[1]!.id,
      {
        timelineId: timeline.id,
        timelineVersion: assembly.timelineVersion,
        sourceFingerprint: assembly.sourceFingerprint,
        audioTrackIds: [original.id],
        includeSubtitles: true,
      },
      crypto.randomUUID(),
    );
    const first = assembled.tracks.find((track) => track.kind === "narration")!
      .clips[0]!;
    let manual = await client!.timeline.command(timeline.id, {
      version: assembled.version,
      command: { type: "split", clipId: first.id, atFrame: 40 },
    });
    manual = await client!.timeline.command(timeline.id, {
      version: manual.version,
      command: { type: "move", clipId: first.id, startFrame: 7 },
    });
    manual = await client!.timeline.command(timeline.id, {
      version: manual.version,
      command: {
        type: "set-clip-audio",
        clipId: first.id,
        volume: 0.35,
        locked: true,
      },
    });
    const revision = await client!.audioRevisions.preview(
      original.id,
      {
        sourceVersion: original.version,
        kind: original.kind,
        label: "明确采用的新实际旁白轨",
        clips: [
          {
            previousClipId: original.clips[0]!.id,
            shotId: records[4]!.id,
            startSeconds: 0,
            durationSeconds: 4,
            text: "人工确认的新作者旁白",
          },
        ],
      },
      crypto.randomUUID(),
    );
    await client!.audioRevisions.confirm(
      revision.id,
      revision.stateVersion,
      {
        contentReviewed: true,
        mappingsReviewed: true,
        authorIntentAndRightsReviewed: true,
      },
      crypto.randomUUID(),
    );
    const adopted = await client!.episodeMedia.adoptAudioTrack(
      revision.candidate.id,
      revision.candidate.version,
      crypto.randomUUID(),
    );
    const mediaBefore = await client!.episodeMedia.listAudioTracks(
      records[1]!.id,
    );
    await expect(
      client!.timeline.exportDelivery(records[1]!.id, "srt"),
    ).rejects.toMatchObject({ status: 409 });
    const navigate = () =>
      page!.evaluate(
        (path) => {
          window.location.hash = path;
        },
        `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, scriptId: records[2]!.id, sceneId: records[3]!.id, shotId: records[4]!.id, stage: "timeline" })}`,
      );
    const panel = () => page!.getByTestId(`audio-resolution-${timeline.id}`);
    await navigate();
    await panel()
      .getByRole("button", { name: "审查人工片段来源", exact: true })
      .click();
    const options = await client!.audioResolutions.options(timeline.id);
    expect(options.items).toHaveLength(5);
    for (const item of options.items) {
      const fieldset = panel().getByTestId(
        `audio-resolution-clip-${item.clip.id}`,
      );
      if (item.clip.sourceClipId === original.clips[1]!.id) {
        await fieldset
          .getByLabel("片段处理方式", { exact: true })
          .selectOption("remove");
        await fieldset
          .getByLabel("明确移除理由", { exact: true })
          .fill("明确移除不再使用的旧引用，原文件不删");
      } else {
        await fieldset
          .getByLabel("片段处理方式", { exact: true })
          .selectOption("replace");
        await fieldset
          .getByLabel("明确替换片段", { exact: true })
          .selectOption(`${adopted.id}:${adopted.clips[0]!.id}`);
        if (item.kind === "subtitle")
          await fieldset
            .getByLabel("字幕文本选择", { exact: true })
            .selectOption("replacement");
      }
    }
    await panel()
      .getByRole("button", { name: "冻结人工换源差异预览", exact: true })
      .click();
    await expect(panel().getByTestId("audio-resolution-diff")).toContainText(
      "明确处理 5 个片段",
    );
    await expect(panel().getByTestId("audio-resolution-diff")).toContainText(
      "锁定保留",
    );
    await expect(panel().getByTestId("audio-resolution-diff")).toContainText(
      "明确使用新源文本",
    );
    const history = await client!.audioResolutions.list(timeline.id);
    expect(history.items).toHaveLength(1);
    const review = history.items[0]!;
    expect(await client!.timeline.get(records[1]!.id)).toEqual(manual);
    await expect(
      panel().getByRole("button", {
        name: "确认所选人工片段换源／移除",
        exact: true,
      }),
    ).toBeDisabled();
    for (const checkbox of await panel().getByRole("checkbox").all())
      await checkbox.check();
    await expect(
      panel().getByRole("button", {
        name: "确认所选人工片段换源／移除",
        exact: true,
      }),
    ).toBeEnabled();
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate();
    await panel()
      .getByRole("button", { name: "审查人工片段来源", exact: true })
      .click();
    await expect(panel().getByTestId("audio-resolution-diff")).toContainText(
      review.id,
    );
    for (const checkbox of await panel().getByRole("checkbox").all())
      await expect(checkbox).not.toBeChecked();
    await expect(
      panel().getByRole("button", {
        name: "确认所选人工片段换源／移除",
        exact: true,
      }),
    ).toBeDisabled();
    await panel()
      .getByTestId("audio-resolution-diff")
      .screenshot({
        path: info.outputPath("audio-resolution-frozen-manual-diff.png"),
      });
    // A tall element screenshot can be clipped by the independent main scroll
    // surface. Capture each actual difference and the unchecked declarations
    // separately; no baseline refresh or business-state change is involved.
    const parts = await panel()
      .getByTestId("audio-resolution-diff")
      .locator(":scope > div")
      .all();
    expect(parts).toHaveLength(7);
    for (const [index, part] of parts.entries()) {
      await part.scrollIntoViewIfNeeded();
      await part.screenshot({
        path: info.outputPath(`audio-resolution-diff-part-${index + 1}.png`),
      });
    }
    expect(
      await page!.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const checkbox of await panel().getByRole("checkbox").all())
      await checkbox.check();
    await panel()
      .getByRole("button", { name: "确认所选人工片段换源／移除", exact: true })
      .click();
    await expect(panel().getByRole("status")).toHaveText(
      "已确认所选片段换源／移除，人工参数与选择外片段保留；可以撤销。源轨和原文件未修改。",
    );
    const resolved = await client!.timeline.get(records[1]!.id);
    const confirmed = await client!.audioResolutions.get(review.id);
    expect(confirmed).toMatchObject({
      state: "confirmed",
      isCurrent: true,
      after: resolved,
    });
    expect(resolved.tracks.find((track) => track.kind === "video")).toEqual(
      manual.tracks.find((track) => track.kind === "video"),
    );
    expect(
      resolved.tracks
        .find((track) => track.kind === "narration")!
        .clips.find((clip) => clip.id === first.id),
    ).toMatchObject({
      startFrame: 7,
      durationFrames: 40,
      sourceOffsetFrame: 0,
      volume: 0.35,
      locked: true,
      audioTrackId: adopted.id,
    });
    expect(
      resolved.tracks
        .find((track) => track.kind === "narration")!
        .clips.find((clip) => clip.id !== first.id),
    ).toMatchObject({ sourceOffsetFrame: 40, audioTrackId: adopted.id });
    expect(
      resolved.tracks.find((track) => track.kind === "subtitle")!.clips[0]!
        .text,
    ).toBe("人工确认的新作者旁白");
    expect(await client!.episodeMedia.listAudioTracks(records[1]!.id)).toEqual(
      mediaBefore,
    );
    await client!.timeline.exportDelivery(records[1]!.id, "srt");
    await page!.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await client!.timeline.get(records[1]!.id)).tracks)
      .toEqual(manual.tracks);
    await expect(
      client!.timeline.exportDelivery(records[1]!.id, "srt"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await client!.audioResolutions.get(review.id)).toMatchObject({
      state: "confirmed",
      sourceState: "stale",
      isCurrent: false,
    });
    await page!.getByRole("button", { name: "重做", exact: true }).click();
    await expect
      .poll(async () => (await client!.timeline.get(records[1]!.id)).tracks)
      .toEqual(resolved.tracks);
    await client!.timeline.exportDelivery(records[1]!.id, "srt");
    const windows = await application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
  } finally {
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("音轨人工修订在后台冻结完整差异、重启清空声明、生成草稿后另行采用且保留时间线人工片段", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-audio-revision-ui-"));
  let application: ElectronApplication | undefined;
  let page: Page;
  let client: StudioClient;
  let manager: ServerConnectionManager | undefined;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "实际音轨修订（仅手工文本）",
    });
    const records = [];
    let parentId: string | undefined;
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ]) {
      const record = await client!.resources.create(kind, {
        projectId: project.id,
        parentId,
        title: `修订 ${kind}`,
        payload: { 动作: "原镜头动作", 时长: 8 },
      });
      records.push(record);
      parentId = record.id;
    }
    const originalDraft = await client!.episodeMedia.createAudioTrack({
      projectId: project.id,
      episodeId: records[1]!.id,
      kind: "narration",
      label: "UI 原音轨",
      clips: [
        {
          shotId: records[4]!.id,
          startSeconds: 0,
          durationSeconds: 3,
          text: "明确删除的旧句（只在候选移除）",
        },
        {
          shotId: records[4]!.id,
          startSeconds: 3,
          durationSeconds: 3,
          text: "原作者旁白",
        },
      ],
    });
    const original = await client!.episodeMedia.adoptAudioTrack(
      originalDraft.id,
      originalDraft.version,
      crypto.randomUUID(),
    );
    const timeline = await client!.timeline.get(records[1]!.id);
    const assembly = await client!.timeline.audioAssemblyPreview(
      records[1]!.id,
    );
    const assembled = await client!.timeline.applyAudioAssembly(
      records[1]!.id,
      {
        timelineId: timeline.id,
        timelineVersion: assembly.timelineVersion,
        sourceFingerprint: assembly.sourceFingerprint,
        audioTrackIds: [original.id],
        includeSubtitles: true,
      },
      crypto.randomUUID(),
    );
    const oldClip = assembled.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.audioTrackId === original.id)!;
    const manual = await client!.timeline.command(timeline.id, {
      version: assembled.version,
      command: { type: "move", clipId: oldClip.id, startFrame: 10 },
    });
    await client!.resources.update("shots", records[4]!.id, {
      version: records[4]!.version,
      payload: { 动作: "新镜头动作", 时长: 8 },
    });
    const navigate = () =>
      page!.evaluate(
        (path) => {
          window.location.hash = path;
        },
        `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, scriptId: records[2]!.id, sceneId: records[3]!.id, shotId: records[4]!.id, stage: "audio" })}`,
      );
    const panel = () => page!.getByTestId(`audio-revision-${original.id}`);
    await navigate();
    await panel()
      .getByRole("button", { name: "审查并修订此音轨", exact: true })
      .click();
    await panel().getByLabel("修订音轨名称", { exact: true }).fill("UI 新音轨");
    await panel()
      .getByRole("button", { name: "从草稿移除此片段", exact: true })
      .first()
      .click();
    await panel()
      .getByLabel("修订文本", { exact: true })
      .fill("明确映射的人工新旁白");
    await panel()
      .getByRole("button", { name: "新增草稿片段", exact: true })
      .click();
    await panel()
      .getByLabel("修订文本", { exact: true })
      .last()
      .fill("明确新增的纯文本片段");
    await panel()
      .getByRole("button", { name: "冻结音轨修订预览", exact: true })
      .click();
    await expect(
      panel().getByText("旧→新映射 1 项 · 明确删除 1 项 · 新增 1 项", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel().getByRole("button", {
        name: "确认修订并生成新草稿",
        exact: true,
      }),
    ).toBeDisabled();
    const history = await client!.audioRevisions.list(original.id);
    expect(history.items).toHaveLength(1);
    const review = history.items[0]!;
    expect(review).toMatchObject({
      state: "pending",
      removedClipIds: [original.clips[0]!.id],
      clipLinks: [
        {
          previousClipId: original.clips[1]!.id,
          nextClipId: review.candidate.clips[0]!.id,
        },
      ],
      candidate: {
        clips: [
          {
            sourceVersions: [{ kind: "shot", id: records[4]!.id, version: 1 }],
          },
          { text: "明确新增的纯文本片段" },
        ],
      },
    });
    expect(
      await client!.episodeMedia.listAudioTracks(records[1]!.id),
    ).toHaveLength(1);
    expect(await client!.timeline.get(records[1]!.id)).toEqual(manual);
    for (const checkbox of await panel().getByRole("checkbox").all())
      await checkbox.check();
    await expect(
      panel().getByRole("button", {
        name: "确认修订并生成新草稿",
        exact: true,
      }),
    ).toBeEnabled();
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate();
    await panel()
      .getByRole("button", { name: "审查并修订此音轨", exact: true })
      .click();
    await expect(panel().getByTestId("audio-revision-diff")).toContainText(
      review.id,
    );
    for (const checkbox of await panel().getByRole("checkbox").all())
      await expect(checkbox).not.toBeChecked();
    await expect(
      panel().getByRole("button", {
        name: "确认修订并生成新草稿",
        exact: true,
      }),
    ).toBeDisabled();
    await panel()
      .getByTestId("audio-revision-diff")
      .screenshot({
        path: info.outputPath("audio-revision-frozen-diff-restored.png"),
      });
    for (const checkbox of await panel().getByRole("checkbox").all())
      await checkbox.check();
    await panel()
      .getByRole("button", { name: "确认修订并生成新草稿", exact: true })
      .click();
    await expect(panel().getByRole("status")).toHaveText(
      "已明确确认并生成独立新草稿；请另行采用。旧轨与时间线均未改动。",
    );
    const tracks = await client!.episodeMedia.listAudioTracks(records[1]!.id);
    const candidate = tracks.find((track) => track.id === review.candidate.id)!;
    expect(candidate).toMatchObject({
      status: "draft",
      version: 0,
      clips: review.candidate.clips,
      revision: { reviewId: review.id, sourceTrackId: original.id },
    });
    expect(await client!.timeline.get(records[1]!.id)).toEqual(manual);
    const newCard = () =>
      page!.locator("article").filter({ hasText: "UI 新音轨 · 旁白 · 草案" });
    await newCard()
      .getByRole("button", { name: "采用此音轨", exact: true })
      .click();
    await expect(
      panel().getByText("另行采用的新轨：", { exact: false }),
    ).toBeVisible();
    expect(
      (await client!.episodeMedia.listAudioTracks(records[1]!.id)).find(
        (track) => track.id === original.id,
      ),
    ).toMatchObject({
      clips: original.clips,
      version: 1,
      status: "adopted",
      supersededBy: candidate.id,
      sourceState: "stale",
    });
    expect(await client!.timeline.get(records[1]!.id)).toEqual(manual);
    await expect(
      client!.timeline.exportDelivery(records[1]!.id, "srt"),
    ).rejects.toMatchObject({ status: 409 });
    const windows = await application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
  } finally {
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("真实媒体来源复核在后台冻结版本、重启恢复并另行采用，旧预览不能确认新内容", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-media-source-ui-"));
  let application: ElectronApplication | undefined;
  let page: Page;
  let client: StudioClient;
  let manager: ServerConnectionManager | undefined;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "实际媒体来源复核",
      synopsis: "机械来源验证，不调用模型或服务商",
    });
    const records = [];
    let parentId: string | undefined;
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ]) {
      const record = await client!.resources.create(kind, {
        projectId: project.id,
        parentId,
        title: `来源 ${kind}`,
        payload: { 动作: "原镜头保留铜钥匙", 时长: 5 },
      });
      records.push(record);
      parentId = record.id;
    }
    let shot = records[4]!;
    const preview =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5sAAAAASUVORK5CYII=";
    const still = await client!.resources.create("shot-stills", {
      projectId: project.id,
      parentId: shot.id,
      title: "实际旧静帧",
      payload: { 预览类型: "image", 预览数据: preview, 采用状态: "已采用" },
    });
    expect(await client!.mediaSources.status(still.id)).toMatchObject({
      state: "current",
      binding: { origin: "manual-record", shotVersion: 0 },
    });
    shot = await client!.resources.update("shots", shot.id, {
      version: shot.version,
      payload: { ...shot.payload, 动作: "新镜头归还铜钥匙" },
    });
    const path = `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, scriptId: records[2]!.id, sceneId: records[3]!.id, shotId: shot.id, stage: "image" })}`;
    const navigate = async () => {
      await page!.evaluate((path) => {
        window.location.hash = path;
      }, path);
    };
    await navigate();
    const panel = () => page!.getByTestId(`media-source-${still.id}`);
    await expect(
      panel().getByText("旧素材待复核", { exact: false }),
    ).toBeVisible();
    await expect(
      panel().getByRole("button", { name: "采用此静帧", exact: true }),
    ).toBeDisabled();
    await panel()
      .getByRole("button", { name: "查看并复核来源", exact: true })
      .click();
    await expect(
      panel().getByText("动作：新镜头归还铜钥匙", { exact: true }),
    ).toBeVisible();
    await panel()
      .getByRole("button", { name: "建立来源复核预览", exact: true })
      .click();
    await expect(
      panel().getByText("冻结素材版本 0 / 镜头版本 1", { exact: false }),
    ).toBeVisible();
    await expect(
      panel().getByRole("button", { name: "确认来源复核", exact: true }),
    ).toBeDisabled();
    const pending = (await client!.mediaSources.list(still.id)).items[0]!;
    expect(pending.state).toBe("pending");
    await panel().screenshot({
      path: info.outputPath("media-source-frozen-preview.png"),
    });
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate();
    await panel()
      .getByRole("button", { name: "查看并复核来源", exact: true })
      .click();
    await expect(
      panel().getByText("冻结素材版本 0 / 镜头版本 1", { exact: false }),
    ).toBeVisible();
    expect((await client!.mediaSources.get(pending.id)).id).toBe(pending.id);
    await expect(panel().getByRole("checkbox").first()).not.toBeChecked();
    for (const label of [
      "我已审阅实际素材，而不只是元数据",
      "我已核对该素材与当前实际镜头的对应关系",
      "我已核对作者意图和正式来源，接受保留该素材",
    ])
      await panel().getByRole("checkbox", { name: label, exact: true }).check();
    await panel()
      .getByRole("button", { name: "确认来源复核", exact: true })
      .click();
    await expect(
      panel().getByText("已确认来源绑定，素材仍需另行采用", { exact: false }),
    ).toBeVisible();
    expect(await client!.mediaSources.status(still.id)).toMatchObject({
      state: "current",
      binding: { origin: "human-review", version: 2, shotVersion: 1 },
    });
    expect(
      (await client!.resources.get("shot-stills", still.id)).payload,
    ).toMatchObject({ 采用状态: "未采用", 预览数据: preview });
    await panel()
      .getByRole("button", { name: "采用此静帧", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await client!.resources.get("shot-stills", still.id)).payload[
            "采用状态"
          ],
      )
      .toBe("已采用");
    await panel().screenshot({
      path: info.outputPath("media-source-confirmed-adopted.png"),
    });
    // The open review reads actual records every five seconds; wait for its
    // post-adoption record version rather than asserting against cached data.
    await expect(
      panel().getByText("素材版本 2 · 当前镜头版本 1", { exact: false }),
    ).toBeVisible({ timeout: 15000 });
    await panel()
      .getByRole("button", { name: "建立来源复核预览", exact: true })
      .click();
    await expect(
      panel().getByRole("button", { name: "确认来源复核", exact: true }),
    ).toBeDisabled();
    const actual = await client!.resources.get("shot-stills", still.id);
    await client!.resources.update("shot-stills", still.id, {
      version: actual.version,
      payload: { ...actual.payload, 说明: "确认期间实际内容改动" },
    });
    await panel()
      .getByRole("button", { name: "刷新来源状态", exact: true })
      .click();
    await expect(
      panel().getByText("旧素材待复核", { exact: false }),
    ).toBeVisible();
    await expect(
      panel().getByText("素材已变化，原复核预览不可采用。", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    for (const checkbox of await panel().getByRole("checkbox").all())
      await checkbox.check();
    await expect(
      panel().getByRole("button", { name: "确认来源复核", exact: true }),
    ).toBeDisabled();
    await panel()
      .getByRole("button", { name: "放弃复核预览", exact: true })
      .click();
    await expect(
      panel()
        .locator("p")
        .filter({ hasText: /冻结素材版本.*已放弃/u }),
    ).toBeVisible();
    expect((await client!.mediaSources.status(still.id)).binding?.version).toBe(
      2,
    );
    const windows = await application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
  } finally {
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("真实逐轨来源与时间线装配在后台确认、排除过期轨并保留重启后的旧片段", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-audio-source-ui-"));
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
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "真实逐轨版本（不调用模型）",
    });
    let parentId: string | undefined;
    const records = [];
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ]) {
      const record = await client!.resources.create(kind, {
        projectId: project.id,
        parentId,
        title: `逐轨 ${kind}`,
        payload: { 动作: "原动作", 时长: 5 },
      });
      records.push(record);
      parentId = record.id;
    }
    const navigate = (stage: string) =>
      page!.evaluate(
        (path) => {
          window.location.hash = path;
        },
        `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, scriptId: records[2]!.id, sceneId: records[3]!.id, shotId: records[4]!.id, stage })}`,
      );
    await navigate("audio");
    await page!
      .getByPlaceholder("音轨名称", { exact: true })
      .fill("实际冻结逐轨样本");
    await page!
      .getByPlaceholder("对白、旁白或制作说明（可选）", { exact: true })
      .fill("只是手工文本轨，不冒充可播放音频");
    await page!
      .getByRole("button", { name: "另存音轨草案", exact: true })
      .click();
    const card = () =>
      page!.locator("article").filter({ hasText: "实际冻结逐轨样本" });
    await expect(
      card().getByText("实际来源版本一致", { exact: false }),
    ).toBeVisible();
    await expect(card().getByText(/片段来源：shot.*v0/u)).toBeVisible();
    const draft = (
      await client!.episodeMedia.listAudioTracks(records[1]!.id)
    )[0]!;
    await card()
      .getByRole("button", { name: "采用此音轨", exact: true })
      .click();
    await expect(
      card().getByText("已采用", { exact: false }).first(),
    ).toBeVisible();
    const track = (
      await client!.episodeMedia.listAudioTracks(records[1]!.id)
    )[0]!;
    expect(track).toMatchObject({
      status: "adopted",
      sourceState: "current",
      version: 1,
    });
    await navigate("timeline");
    await page!
      .getByRole("button", { name: "审查自动编排", exact: true })
      .click();
    await expect(page!.getByText("候选 1 段", { exact: false })).toBeVisible();
    await page!
      .getByRole("button", { name: "采用选中的自动编排", exact: true })
      .click();
    await expect(
      page!.getByText("已采用选中的自动编排", { exact: false }),
    ).toBeVisible();
    const timeline = await client!.timeline.get(records[1]!.id);
    expect(
      timeline.tracks
        .flatMap((item) => item.clips)
        .filter((clip) => clip.audioTrackId === track.id)
        .every(
          (clip) =>
            clip.audioTrackVersion === 1 &&
            clip.audioSourceFingerprint === track.sourceFingerprint,
        ),
    ).toBe(true);
    expect(
      timeline.tracks
        .flatMap((item) => item.clips)
        .filter((clip) => clip.audioTrackId === track.id).length,
    ).toBeGreaterThan(0);
    await client!.resources.update("shots", records[4]!.id, {
      version: records[4]!.version,
      payload: { 动作: "实际镜头新动作", 时长: 5 },
    });
    await navigate("audio");
    await expect(card().getByText("已过期", { exact: false })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      card().getByRole("button", { name: "采用此音轨", exact: true }),
    ).toHaveCount(0);
    await card().screenshot({
      path: info.outputPath("audio-source-stale-retained.png"),
    });
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate("audio");
    await expect(card().getByText("已过期", { exact: false })).toBeVisible();
    const retained = (
      await client!.episodeMedia.listAudioTracks(records[1]!.id)
    )[0]!;
    expect(retained).toMatchObject({
      id: draft.id,
      version: 1,
      clips: draft.clips,
      sourceState: "stale",
      status: "adopted",
    });
    expect((await client!.timeline.get(records[1]!.id)).tracks).toEqual(
      timeline.tracks,
    );
    const preview = await client!.timeline.audioAssemblyPreview(records[1]!.id);
    expect(preview.staleTrackIds).toContain(track.id);
    expect(preview.clips).toEqual([]);
    await expect(
      client!.timeline.exportDelivery(records[1]!.id, "srt"),
    ).rejects.toMatchObject({ status: 409 });
    const windows = await application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
  } finally {
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
