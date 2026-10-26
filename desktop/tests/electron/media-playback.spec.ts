import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { openProductionStage } from "./project-tools";
import type { TimelineMediaCopyInput } from "@dramaip/contracts/timeline-copy";

// Locally generated 3s blue H.264 fixture, not provider output or a rights/quality claim.
const mp4 =
  "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";
function wav() {
  const bytes = Buffer.alloc(44 + 8000 * 2 * 3);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
function seedControlledArchive(
  userData: string,
  value: Record<string, unknown>,
) {
  // Controlled owner fixture only; does not claim provider download/probe/import or production provenance.
  const child = spawnSync(
    "node",
    [
      "scripts/run-node.mjs",
      "--input-type=module",
      "--eval",
      "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); const v=JSON.parse(process.argv[2]); db.prepare(\"INSERT INTO media_artifacts(artifact_id,media_record_id,project_id,media_ref,kind,mime_type,extension,size_bytes,sha256,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'archived',?)\").run(v.artifactId,v.recordId,v.projectId,v.mediaRef,v.kind,v.mimeType,v.extension,v.sizeBytes,v.sha256,new Date().toISOString());db.close();",
      join(userData, "dramaip.db"),
      JSON.stringify(value),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
}

test("实际受控媒体与冻结 Timeline 同步播放／seek；同页重查、重启、取消和失败不伪造审阅", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-playback-ui-"));
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
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  };
  const navigate = (path: string) =>
    page.evaluate((value) => {
      window.location.hash = value;
    }, path);
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "实际媒体读播（受控静音，不是内容质量）",
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
        title: `实际媒体 ${kind}`,
        payload: { 动作: "真实 UI 媒体读取", 时长: 3 },
      });
      records.push(record);
      parentId = record.id;
    }
    const video = await client!.resources.create("video", {
      projectId: project.id,
      parentId,
      title: "本地蓝色视频",
      payload: {
        预览类型: "video",
        mediaRef: crypto.randomUUID(), // Deliberately not the actual archived file ref.
      },
    });
    const audio = await client!.resources.create("assets", {
      projectId: project.id,
      parentId,
      title: "本地静音音频",
      payload: { 预览类型: "audio" },
    });
    await mkdir(join(userData, "media-library"), { recursive: true });
    const files: string[] = [];
    for (const [record, bytes, kind, mimeType, extension] of [
      [video, Buffer.from(mp4, "base64"), "video", "video/mp4", ".mp4"],
      [audio, wav(), "audio", "audio/wav", ".wav"],
    ] as const) {
      const mediaRef = crypto.randomUUID();
      const file = join(userData, "media-library", `${mediaRef}${extension}`);
      files.push(file);
      await writeFile(file, bytes, { mode: 0o600 });
      seedControlledArchive(userData, {
        artifactId: crypto.randomUUID(),
        recordId: record.id,
        projectId: project.id,
        mediaRef,
        kind,
        mimeType,
        extension,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const source = await client!.mediaSources.preview(
      video.id,
      {
        recordVersion: video.version,
        shotId: records[4]!.id,
        shotVersion: records[4]!.version,
      },
      crypto.randomUUID(),
    );
    const sourcePath = `/produce?${new URLSearchParams({ projectId: project.id, mediaSourceReviewId: source.id })}`;
    const player = () => page!.getByTestId(`media-playback-${video.id}`);
    await navigate(sourcePath);
    await expect(player()).toBeVisible();
    await expect(player().locator("video")).toHaveCount(0);
    const stored = await client!.mediaSources.get(source.id);
    const recordBefore = await client!.mediaSources.record(video.id);
    await player()
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect
      .poll(() =>
        player()
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await player()
        .locator("video")
        .evaluate((node: HTMLVideoElement) => ({
          duration: node.duration,
          width: node.videoWidth,
          height: node.videoHeight,
          paused: node.paused,
          src: node.currentSrc.startsWith("blob:"),
        })),
    ).toEqual({ duration: 3, width: 96, height: 64, paused: true, src: true });
    await player()
      .locator("video")
      .evaluate(async (node: HTMLVideoElement) => {
        node.muted = true;
        node.currentTime = 1.5;
        await node.play();
      });
    await expect
      .poll(() =>
        player()
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeGreaterThan(1.6);
    await player()
      .locator("video")
      .evaluate((node: HTMLVideoElement) => node.pause());
    for (const check of await page!
      .getByTestId("media-source-review-diff")
      .getByRole("checkbox")
      .all())
      await expect(check).not.toBeChecked();
    await expect(
      page!.getByRole("button", { name: "确认来源复核", exact: true }),
    ).toBeDisabled();
    expect(await client!.mediaSources.get(source.id)).toEqual(stored);
    expect(await client!.mediaSources.record(video.id)).toEqual(recordBefore);
    await player().screenshot({
      path: info.outputPath("actual-archive-video.png"),
    });
    const blobUrl = await player()
      .locator("video")
      .evaluate((node: HTMLVideoElement) => node.currentSrc);
    await player()
      .getByRole("button", { name: "停止并释放媒体", exact: true })
      .click();
    await expect(player().locator("video")).toHaveCount(0);
    expect(
      await page!.evaluate(async (url) => {
        try {
          await fetch(url);
          return true;
        } catch {
          return false;
        }
      }, blobUrl),
    ).toBe(false);
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const routePattern = `**/api/v2/media-records/${video.id}/playback/content?**`;
    await page!.route(routePattern, async (route) => {
      await blocked;
      await route.continue().catch(() => {});
    });
    await player()
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect(player()).toContainText("完整读取中…");
    await player()
      .getByRole("button", { name: "停止并释放媒体", exact: true })
      .click();
    unblock();
    await page!.unroute(routePattern);
    await expect(player().locator("video")).toHaveCount(0);
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate(sourcePath);
    await expect(player().locator("video")).toHaveCount(0);
    await player()
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect
      .poll(() =>
        player()
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    // The actual Timeline never reads payload.mediaRef or falls back to timeline.preview.
    const narrationDraft = await client!.episodeMedia.createAudioTrack({
      projectId: project.id,
      episodeId: records[1]!.id,
      kind: "narration",
      label: "同步实际旁白",
      clips: [
        {
          shotId: records[4]!.id,
          assetId: audio.id,
          startSeconds: 0,
          durationSeconds: 3,
          text: "同步字幕明确保留",
        },
      ],
    });
    const narration = await client!.episodeMedia.adoptAudioTrack(
      narrationDraft.id,
      narrationDraft.version,
      crypto.randomUUID(),
    );
    const bgmDraft = await client!.episodeMedia.createAudioTrack({
      projectId: project.id,
      episodeId: records[1]!.id,
      kind: "bgm",
      label: "同步实际配乐",
      clips: [{ assetId: audio.id, startSeconds: 0, durationSeconds: 3 }],
    });
    const bgm = await client!.episodeMedia.adoptAudioTrack(
      bgmDraft.id,
      bgmDraft.version,
      crypto.randomUUID(),
    );
    let timeline = await client!.timeline.get(records[1]!.id);
    const videoClipId = timeline.tracks[0]!.clips[0]!.id;
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: { type: "relink", clipId: videoClipId, assetId: video.id },
    });
    expect(timeline.tracks[0]!.clips[0]!.assetVersion).toBe(video.version);
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: { type: "trim", clipId: videoClipId, durationFrames: 75 },
    });
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: { type: "split", clipId: videoClipId, atFrame: 25 },
    });
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "set-track-audio",
        trackId: timeline.tracks[0]!.id,
        muted: true,
      },
    });
    const assembly = await client!.timeline.audioAssemblyPreview(
      records[1]!.id,
    );
    timeline = await client!.timeline.applyAudioAssembly(
      records[1]!.id,
      {
        timelineId: timeline.id,
        timelineVersion: timeline.version,
        sourceFingerprint: assembly.sourceFingerprint,
        audioTrackIds: [narration.id, bgm.id],
        includeSubtitles: true,
      },
      crypto.randomUUID(),
    );
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "set-clip-audio",
        clipId: timeline.tracks.find((item) => item.kind === "bgm")!.clips[0]!
          .id,
        volume: 1.8,
      },
    });
    const frozenTimeline = timeline;
    await navigate(`/produce?projectId=${project.id}`);
    await openProductionStage(page!, "多轨时间线");
    const timelinePlayer = page!.getByTestId("timeline-actual-preview");
    const transport = timelinePlayer.locator("..");
    await expect(timelinePlayer).toHaveCount(1);
    await expect(timelinePlayer.locator("video, audio")).toHaveCount(0);
    await expect(
      transport.getByRole("button", { name: "播放", exact: true }),
    ).toBeDisabled();
    await timelinePlayer
      .getByRole("checkbox", { name: "静音预览（不修改轨道）" })
      .check();
    await timelinePlayer
      .getByRole("button", { name: "加载实际同步预览", exact: true })
      .click();
    await expect(timelinePlayer.getByRole("status")).toContainText(
      "全部实际媒体已解码",
      { timeout: 20_000 },
    );
    await expect(timelinePlayer.locator("video")).toHaveCount(2);
    await expect(timelinePlayer.locator("audio")).toHaveCount(2);
    const secondClip = frozenTimeline.tracks[0]!.clips[1]!;
    const secondVideo = timelinePlayer.getByTestId(
      `timeline-preview-clip-${secondClip.id}`,
    );
    const narrationClip = frozenTimeline.tracks.find(
      (item) => item.kind === "narration",
    )!.clips[0]!;
    const timelineAudio = timelinePlayer.getByTestId(
      `timeline-preview-clip-${narrationClip.id}`,
    );
    const seek = async (seconds: number) => {
      await transport
        .getByRole("slider", { name: "播放头定位" })
        .evaluate((node: HTMLInputElement, value) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(node, String(value));
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }, seconds);
    };
    await seek(1.25);
    await expect
      .poll(() =>
        secondVideo.evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeCloseTo(1.25, 1);
    await expect
      .poll(() =>
        timelineAudio.evaluate((node: HTMLAudioElement) => node.currentTime),
      )
      .toBeCloseTo(1.25, 1);
    await expect(secondVideo).toBeVisible();
    await expect(
      timelinePlayer.getByTestId("timeline-preview-subtitles"),
    ).toHaveText("同步字幕明确保留");
    await seek(0); // Actually cross the split boundary rather than only starting mid-clip.
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await expect
      .poll(() =>
        secondVideo.evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeGreaterThan(1.35);
    expect(
      await secondVideo.evaluate((node: HTMLVideoElement) => node.paused),
    ).toBe(false);
    expect(
      await timelineAudio.evaluate((node: HTMLAudioElement) => node.paused),
    ).toBe(false);
    expect(
      await timelinePlayer
        .locator("audio")
        .evaluateAll((nodes) =>
          nodes.every((node) => !(node as HTMLAudioElement).paused),
        ),
    ).toBe(true);
    expect(
      await timelinePlayer.evaluate((node) => {
        const video = [...node.querySelectorAll("video")].find(
          (item) => !item.classList.contains("hidden"),
        )!;
        return Math.max(
          ...[...node.querySelectorAll("audio")].map((audio) =>
            Math.abs(video.currentTime - audio.currentTime),
          ),
        );
      }),
    ).toBeLessThan(0.2);
    await transport.getByRole("button", { name: "暂停", exact: true }).click();
    await seek(1.75);
    await expect(
      transport.getByRole("button", { name: "播放", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        secondVideo.evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeCloseTo(1.75, 1);
    expect(
      await timelineAudio.evaluate((node: HTMLAudioElement) => node.paused),
    ).toBe(true);
    await transport.screenshot({
      path: info.outputPath("actual-timeline-sync.png"),
    });
    expect(await client!.timeline.get(records[1]!.id)).toEqual(frozenTimeline);
    expect(await client!.mediaSources.record(video.id)).toEqual(recordBefore);
    const timelineUrl = await secondVideo.getAttribute("src");
    await secondVideo.evaluate((node: HTMLVideoElement) => {
      node.play = () => Promise.reject(new Error("受控 native 播放拒绝"));
    });
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await expect(timelinePlayer.getByRole("alert")).toContainText(
      "受控 native 播放拒绝",
    );
    await expect(timelinePlayer.locator("video, audio")).toHaveCount(0);
    await expect(
      transport.getByRole("button", { name: "播放", exact: true }),
    ).toBeDisabled();
    expect(
      await page!.evaluate(async (url) => {
        try {
          await fetch(url!);
          return true;
        } catch {
          return false;
        }
      }, timelineUrl),
    ).toBe(false);
    await timelinePlayer
      .getByRole("button", { name: "加载实际同步预览", exact: true })
      .click();
    await expect(timelinePlayer.getByRole("status")).toContainText(
      "全部实际媒体已解码",
    );
    await timelinePlayer
      .getByRole("button", { name: "停止并释放预览", exact: true })
      .click();
    await expect(timelinePlayer.locator("video, audio")).toHaveCount(0);
    await expect(
      transport.getByRole("button", { name: "播放", exact: true }),
    ).toBeDisabled();
    // Decode succeeds, but an explicit trim beyond the real file must still fail closed.
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: { type: "trim", clipId: secondClip.id, durationFrames: 75 },
    });
    const timelinePath = `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, stage: "timeline" })}`;
    await navigate(timelinePath);
    await page!.reload();
    await expect(timelinePlayer).toBeVisible();
    await timelinePlayer
      .getByRole("button", { name: "加载实际同步预览", exact: true })
      .click();
    await expect(timelinePlayer.getByRole("alert")).toContainText(
      "超过实际媒体时长",
    );
    await expect(timelinePlayer.locator("video, audio")).toHaveCount(0);
    await expect(
      transport.getByRole("button", { name: "播放", exact: true }),
    ).toBeDisabled();
    expect(await client!.timeline.get(records[1]!.id)).toEqual(timeline);
    await timelinePlayer.screenshot({
      path: info.outputPath("actual-timeline-duration-rejected.png"),
    });
    timeline = await client!.timeline.undo(timeline.id);
    await page!.reload();
    await expect(timelinePlayer).toBeVisible();
    // A real Timeline write while controlled content is waiting invalidates the final plan read.
    let releaseTimelineRead!: () => void, reachedTimelineRead!: () => void;
    const waitForTimelineRead = new Promise<void>((resolve) => {
      releaseTimelineRead = resolve;
    });
    const timelineReadReached = new Promise<void>((resolve) => {
      reachedTimelineRead = resolve;
    });
    const timelineContentPattern = `**/api/v2/media-records/${video.id}/playback/content?**`;
    await page!.route(timelineContentPattern, async (route) => {
      reachedTimelineRead();
      await waitForTimelineRead;
      await route.continue().catch(() => {});
    });
    await timelinePlayer
      .getByRole("button", { name: "加载实际同步预览", exact: true })
      .click();
    await timelineReadReached;
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: { type: "move", clipId: videoClipId, startFrame: 1 },
    });
    releaseTimelineRead();
    await expect(timelinePlayer.getByRole("alert")).toContainText(
      "时间线版本已变化",
    );
    await page!.unroute(timelineContentPattern);
    await expect(timelinePlayer.locator("video, audio")).toHaveCount(0);
    await expect(
      transport.getByRole("button", { name: "播放", exact: true }),
    ).toBeDisabled();
    expect(await client!.timeline.get(records[1]!.id)).toEqual(timeline);
    const track = await client!.episodeMedia.createAudioTrack({
      projectId: project.id,
      episodeId: records[1]!.id,
      kind: "narration",
      label: "实际音频冻结轨",
      clips: [
        {
          shotId: records[4]!.id,
          assetId: audio.id,
          startSeconds: 0,
          durationSeconds: 3,
          text: "静音文件不代表声音质量",
        },
      ],
    });
    const revision = await client!.audioRevisions.preview(
      track.id,
      {
        sourceVersion: track.version,
        label: "实际音频候选",
        kind: track.kind,
        clips: track.clips.map(
          ({
            id,
            sourceVersions: _versions,
            sourceFingerprint: _fingerprint,
            ...clip
          }) => ({ ...clip, previousClipId: id }),
        ),
      },
      crypto.randomUUID(),
    );
    await navigate(
      `/produce?${new URLSearchParams({ projectId: project.id, audioRevisionId: revision.id })}`,
    );
    const audioPlayer = page!.getByTestId(`media-playback-${audio.id}`).first();
    await audioPlayer
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect
      .poll(() =>
        audioPlayer
          .locator("audio")
          .evaluate((node: HTMLAudioElement) => node.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await audioPlayer
        .locator("audio")
        .evaluate((node: HTMLAudioElement) => node.duration),
    ).toBe(3);
    await audioPlayer
      .locator("audio")
      .evaluate(async (node: HTMLAudioElement) => {
        node.muted = true;
        node.currentTime = 1.5;
        await node.play();
      });
    await expect
      .poll(() =>
        audioPlayer
          .locator("audio")
          .evaluate((node: HTMLAudioElement) => node.currentTime),
      )
      .toBeGreaterThan(1.6);
    await audioPlayer
      .locator("audio")
      .evaluate((node: HTMLAudioElement) => node.pause());
    await audioPlayer.screenshot({
      path: info.outputPath("actual-archive-audio.png"),
    });
    for (const check of await page!
      .getByTestId("audio-revision-diff")
      .getByRole("checkbox")
      .all())
      await expect(check).not.toBeChecked();
    expect((await client!.audioRevisions.get(revision.id)).state).toBe(
      "pending",
    );
    await client!.resources.update("assets", audio.id, {
      title: "新版本不能替代旧冻结音频",
      version: audio.version,
    });
    await expect(page!.getByTestId("audio-revision-diff")).toContainText(
      "没有与项目归属及冻结版本一致的实际音频",
      { timeout: 15_000 },
    );
    await expect(page!.getByTestId(`media-playback-${audio.id}`)).toHaveCount(
      0,
    );
    await navigate(sourcePath);
    await player()
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect(player().locator("video")).toHaveCount(1);
    await player()
      .getByRole("button", { name: "停止并释放媒体", exact: true })
      .click();
    const corrupt = await readFile(files[0]!);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(files[0]!, corrupt);
    await player()
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect(player().getByRole("alert")).toContainText(
      "存档文件不可用、已变化或未完整读取",
    );
    await expect(player().locator("video")).toHaveCount(0);
    await expect(player()).not.toContainText(userData);
    await player().screenshot({
      path: info.outputPath("actual-corrupt-rejected.png"),
    });
    const image = await client!.resources.create("visual-assets", {
      projectId: project.id,
      title: "实际内嵌图像",
      payload: {
        预览类型: "image",
        资产版本: "展示标签 v999，不是实际版本",
        预览数据:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAu0lEQVR4nO3OMQ0AIAAEsXeOdRyw9gaSCuh29r34QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlB2wV9auimybeC/wAAAABJRU5ErkJggg==",
      },
    });
    await navigate(`/produce?projectId=${project.id}`);
    await openProductionStage(page!, "资产中心");
    const card = page!
      .getByRole("region", { name: "资产中心" })
      .locator("article")
      .filter({ hasText: "实际内嵌图像" });
    await card
      .getByRole("button", { name: "打开本地预览", exact: true })
      .click();
    const imagePlayer = card.getByTestId(`media-playback-${image.id}`);
    await expect(imagePlayer).toContainText("冻结版本 0");
    await expect(imagePlayer.locator("img")).toHaveCount(0);
    await imagePlayer
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect
      .poll(() =>
        imagePlayer
          .locator("img")
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      )
      .toBe(96);
    expect(
      await imagePlayer
        .locator("img")
        .evaluate((node: HTMLImageElement) => node.naturalHeight),
    ).toBe(64);
    await expect(imagePlayer.getByRole("status")).toContainText(
      "浏览器已解码实际图像",
    );
    await imagePlayer.screenshot({
      path: info.outputPath("actual-embedded-image.png"),
    });
    const oldImageUrl = await imagePlayer.locator("img").getAttribute("src");
    const updatedImage = await client!.resources.update(
      "visual-assets",
      image.id,
      {
        title: image.title,
        version: image.version,
        payload: { ...image.payload, 资产版本: "仍是展示标签 v999" },
      },
    );
    await card
      .getByRole("button", { name: "重新核对本地记录", exact: true })
      .click();
    await expect(imagePlayer).toContainText(`冻结版本 ${updatedImage.version}`);
    await expect(imagePlayer.locator("img")).toHaveCount(0);
    expect(
      await page!.evaluate(async (url) => {
        try {
          await fetch(url!);
          return true;
        } catch {
          return false;
        }
      }, oldImageUrl),
    ).toBe(false);
    await imagePlayer
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect(imagePlayer.getByRole("status")).toContainText(
      "浏览器已解码实际图像",
    );
    // Same-version rechecks also release the file immediately, including a failed owner read.
    const currentImageUrl = await imagePlayer
      .locator("img")
      .getAttribute("src");
    let finishRecord!: () => void;
    const pendingRecord = new Promise<void>((resolve) => {
      finishRecord = resolve;
    });
    const recordPattern = `**/api/v2/media-records/${image.id}`;
    await page!.route(recordPattern, async (route) => {
      await pendingRecord;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          status: 503,
          code: "MEDIA_UNAVAILABLE",
          title: "本次实际记录无法核对",
          traceId: crypto.randomUUID(),
        }),
      });
    });
    await card
      .getByRole("button", { name: "重新核对本地记录", exact: true })
      .click();
    await expect(card).toContainText("旧媒体已释放");
    await expect(imagePlayer).toHaveCount(0);
    expect(
      await page!.evaluate(async (url) => {
        try {
          await fetch(url!);
          return true;
        } catch {
          return false;
        }
      }, currentImageUrl),
    ).toBe(false);
    finishRecord();
    await expect(card.getByRole("alert")).toContainText("本次实际记录无法核对");
    await expect(imagePlayer).toHaveCount(0);
    await page!.unroute(recordPattern);
    // A wrong-project response cannot revive the old file either.
    const actualImageRecord = await client!.mediaSources.record(image.id);
    await page!.route(recordPattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...actualImageRecord,
          projectId: crypto.randomUUID(),
        }),
      }),
    );
    await card
      .getByRole("button", { name: "重新核对本地记录", exact: true })
      .click();
    await expect(card.getByRole("alert")).toContainText(
      "实际素材身份、项目归属或版本无法核对",
    );
    await expect(imagePlayer).toHaveCount(0);
    await page!.unroute(recordPattern);
    await card
      .getByRole("button", { name: "重新核对本地记录", exact: true })
      .click();
    await expect(imagePlayer).toContainText(`冻结版本 ${updatedImage.version}`);
    await expect(imagePlayer.locator("img")).toHaveCount(0);
    expect(await client!.mediaSources.record(image.id)).toEqual(
      actualImageRecord,
    );
    await card.screenshot({
      path: info.outputPath("actual-asset-same-page-recheck.png"),
    });
    const invalid = await client!.resources.create("visual-assets", {
      projectId: project.id,
      title: "无法解码不应视为审阅",
      payload: {
        预览类型: "audio",
        预览数据: "data:audio/wav;base64,YWN0dWFsLWJ5dGVzLW5vdC1hdWRpbw==",
      },
    });
    await page!.reload();
    await expect(page!.locator("main")).toBeVisible();
    await openProductionStage(page!, "资产中心");
    const invalidCard = page!
      .getByRole("region", { name: "资产中心" })
      .locator("article")
      .filter({ hasText: "无法解码不应视为审阅" });
    await invalidCard
      .getByRole("button", { name: "打开本地预览", exact: true })
      .click();
    const invalidPlayer = invalidCard.getByTestId(
      `media-playback-${invalid.id}`,
    );
    await invalidPlayer
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect(invalidPlayer.getByRole("alert")).toContainText(
      "浏览器无法解码",
    );
    await expect(invalidPlayer.locator("audio")).toHaveCount(0);
    await invalidPlayer.screenshot({
      path: info.outputPath("actual-decode-error.png"),
    });
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    manager?.disconnect();
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("NLE SDK／Core／真实Host后台复制原媒体与七文档，重启只恢复原包，展示使用隔离native桩（非普通界面）", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-nle-copy-e2e-")),
    output = join(userData, "controlled-copy-output");
  await mkdir(output);
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined,
    client: StudioClient;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: userData,
        DRAMAIP_E2E_NLE_COPY_DIRECTORY: output,
      },
    });
    const page = await application.firstWindow();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    // Only this isolated test instance. Never open Finder or replace ordinary app guards.
    await application.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & {
        controlledNleReveals: string[];
      };
      state.controlledNleReveals = [];
      shell.showItemInFolder = (path) => {
        state.controlledNleReveals.push(path);
      };
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
    await application?.close();
    application = undefined;
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "受控真实NLE交接，不是内容质量或授权证明",
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
        title: `原NLE ${kind}`,
        payload: { 动作: "冻结原动作", 时长: 3 },
      });
      records.push(record);
      parentId = record.id;
    }
    const asset = await client!.resources.create("video", {
      projectId: project.id,
      parentId,
      title: "冻结受控MP4",
      payload: { mediaRef: crypto.randomUUID() },
    });
    const mediaRef = crypto.randomUUID(),
      bytes = Buffer.from(mp4, "base64"),
      file = join(userData, "media-library", `${mediaRef}.mp4`);
    await mkdir(join(userData, "media-library"), { recursive: true });
    await writeFile(file, bytes, { mode: 0o600 });
    seedControlledArchive(userData, {
      artifactId: crypto.randomUUID(),
      recordId: asset.id,
      projectId: project.id,
      mediaRef,
      kind: "video",
      mimeType: "video/mp4",
      extension: ".mp4",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    let timeline = await client!.timeline.get(records[1]!.id);
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "relink",
        clipId: timeline.tracks[0]!.clips[0]!.id,
        assetId: asset.id,
      },
    });
    const manifest = await client!.timeline.deliveryManifest(records[1]!.id),
      directory = await client!.timelineMediaCopies.chooseDirectory(manifest);
    expect(directory.grant?.permission).toBe("write-directory");
    expect(JSON.stringify(directory)).not.toContain(output);
    const input = {
        manifest,
        directory,
        purpose: "local-nle-handoff" as const,
        acknowledgedLimits: true as const,
      },
      key = crypto.randomUUID();
    let job = await client!.timelineMediaCopies.create(input, key);
    await expect
      .poll(
        async () => {
          job = await client!.timelineMediaCopies.refresh(
            job,
            crypto.randomUUID(),
          );
          return job.status;
        },
        { timeout: 15_000 },
      )
      .toBe("completed");
    const done = job;
    expect(done.copy!.receipt.files).toHaveLength(8);
    const folders = await readdir(output);
    expect(folders).toHaveLength(1);
    const folder = join(output, folders[0]!);
    for (const item of done.copy!.receipt.files) {
      const copied = await readFile(join(folder, item.relativePath));
      expect(copied.length).toBe(item.sizeBytes);
      expect(createHash("sha256").update(copied).digest("hex")).toBe(
        item.sha256,
      );
    }
    expect(await readFile(join(folder, `media/${asset.id}.mp4`))).toEqual(
      bytes,
    );
    const receipt = await readFile(join(folder, "copied-media.json"));
    expect(createHash("sha256").update(receipt).digest("hex")).toBe(
      done.copy!.receiptSha256,
    );
    expect(done.copy!.receipt).toMatchObject({
      qualityState: "unverified",
      rightsState: "unverified",
      billingState: "unknown",
    });
    for (const privateValue of [
      userData,
      output,
      mediaRef,
      directory.grant!.grantId,
    ])
      expect(JSON.stringify(done)).not.toContain(privateValue);
    await close();
    await launch();
    expect(await client!.timelineMediaCopies.recover(input, key)).toEqual(done);
    expect(await client!.timelineMediaCopies.create(input, key)).toEqual(done);
    expect(
      (await client!.timelineMediaCopies.list(timeline.id, project.id)).items,
    ).toEqual([done]);
    expect(await readdir(output)).toEqual(folders);
    expect(await readFile(join(folder, "copied-media.json"))).toEqual(receipt);
    expect(await client!.timelineMediaCopies.reveal(done)).toEqual({
      revealed: true,
    });
    expect(
      await application!.evaluate(
        () =>
          (globalThis as typeof globalThis & { controlledNleReveals: string[] })
            .controlledNleReveals,
      ),
    ).toEqual([folder]);
    // Historical Core reads do not upgrade equal-length corruption into current byte integrity.
    await writeFile(file, Buffer.alloc(bytes.length, 0x22));
    expect(await client!.timelineMediaCopies.recover(input, key)).toEqual(done);
    const freshDirectory =
      await client!.timelineMediaCopies.chooseDirectory(manifest);
    let failed = await client!.timelineMediaCopies.create(
      { ...input, directory: freshDirectory },
      crypto.randomUUID(),
    );
    await expect
      .poll(
        async () => {
          failed = await client!.timelineMediaCopies.refresh(
            failed,
            crypto.randomUUID(),
          );
          return failed.status;
        },
        { timeout: 15_000 },
      )
      .toBe("failed");
    expect(failed.copy).toBeUndefined();
    expect(failed.failureCode).toBe("COPY_FAILED");
    expect(await readdir(output)).toEqual(folders);
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

test("普通NLE复制界面：提交前持久绑定、真实响应丢失／停止／重载／重启只读恢复，原包展示与变源隔离（全后台）", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-nle-copy-ui-")),
    output = join(userData, "controlled-copy-output");
  await mkdir(output);
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined,
    client: StudioClient,
    page: Page;
  const calls: { method: string; path: string }[] = [];
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: userData,
        DRAMAIP_E2E_NLE_COPY_DIRECTORY: output,
      },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/media-cop(?:y-directory|ies)/.test(path))
        calls.push({ method: request.method(), path });
    });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    await application.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & {
        controlledNleReveals: string[];
      };
      state.controlledNleReveals = [];
      shell.showItemInFolder = (path) => {
        state.controlledNleReveals.push(path);
      };
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
    await application?.close();
    application = undefined;
  };
  try {
    await launch();
    const { project } = await client!.projects.create({
      title: "普通界面原NLE交接（受控媒体，非质量授权）",
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
        title: `普通原NLE ${kind}`,
        payload: { 动作: "冻结原动作", 时长: 3 },
      });
      records.push(record);
      parentId = record.id;
    }
    const asset = await client!.resources.create("video", {
      projectId: project.id,
      parentId,
      title: "原受控MP4",
      payload: { mediaRef: crypto.randomUUID() },
    });
    const mediaRef = crypto.randomUUID(),
      bytes = Buffer.from(mp4, "base64");
    await mkdir(join(userData, "media-library"), { recursive: true });
    await writeFile(join(userData, "media-library", `${mediaRef}.mp4`), bytes, {
      mode: 0o600,
    });
    seedControlledArchive(userData, {
      artifactId: crypto.randomUUID(),
      recordId: asset.id,
      projectId: project.id,
      mediaRef,
      kind: "video",
      mimeType: "video/mp4",
      extension: ".mp4",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    let timeline = await client!.timeline.get(records[1]!.id);
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "relink",
        clipId: timeline.tracks[0]!.clips[0]!.id,
        assetId: asset.id,
      },
    });
    const path = `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, stage: "timeline" })}`;
    const navigate = async () => {
      await page!.evaluate((value) => {
        window.location.hash = value;
      }, path);
      await expect(page!.getByTestId("nle-media-copy")).toBeVisible();
    };
    await navigate();
    const panel = page!.getByTestId("nle-media-copy");
    const copyPosts = () =>
      calls.filter(
        (call) => call.method === "POST" && call.path.endsWith("/media-copies"),
      );
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
    await expect(
      panel.getByRole("button", { name: "复制本清单原媒体包", exact: true }),
    ).toBeDisabled();
    expect(calls).toEqual([]);
    await panel.getByRole("checkbox").check();
    await panel
      .getByRole("button", { name: "明确选择本次写目录", exact: true })
      .click();
    await expect(panel).toContainText("本次写目录");
    expect(copyPosts()).toHaveLength(0);
    const requestKey = `dramaip:nle-copy-request:${project.id}:${timeline.id}`;
    let original!: {
      schemaVersion: 1;
      key: string;
      input: TimelineMediaCopyInput;
    };
    const createPattern = `**/api/v2/timelines/${timeline.id}/media-copies`;
    await page!.route(createPattern, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      original = await page!.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        requestKey,
      );
      expect(original.key).toBe(route.request().headers()["idempotency-key"]);
      expect(original.input).toEqual(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      // Actual Core and Host accepted the original; deliberately lose only its UI response.
      await route.abort("failed");
    });
    await panel
      .getByRole("button", { name: "复制本清单原媒体包", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("未取得确定原回执");
    await expect(panel.getByTestId("nle-copy-original-job")).toHaveCount(0);
    await expect(panel.getByTestId("nle-copy-pending")).toContainText(
      original.key,
    );
    expect(copyPosts()).toHaveLength(1);
    await page!.unroute(createPattern);
    const beforeReload = calls.length;
    await page!.reload();
    await navigate();
    expect(calls).toHaveLength(beforeReload);
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
    await expect(panel.getByTestId("nle-copy-pending")).toContainText(
      original.key,
    );
    await panel
      .getByRole("button", { name: "只读恢复原复制任务", exact: true })
      .click();
    await expect(panel.getByTestId("nle-copy-original-job")).toContainText(
      original.key,
    );
    // The Host really finished, while Core still has the unobserved original queue state.
    // A late explicit cancel must report that completion, not invent a canceled package.
    await expect
      .poll(async () => {
        const journal = JSON.parse(
          await readFile(
            join(userData, "nle-copy-jobs", `${original.key}.json`),
            "utf8",
          ),
        );
        return journal.record.job.status;
      })
      .toBe("completed");
    const actionKey = `dramaip:nle-copy-action:${project.id}:${timeline.id}`;
    const cancelPattern = `**/api/v2/timeline-media-copies/${original.key}/cancel`;
    let originalActionKey!: string;
    await page!.route(cancelPattern, async (route) => {
      const action = await page!.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        actionKey,
      );
      originalActionKey = action.key;
      expect(action.operation).toBe("cancel");
      expect(action.job.id).toBe(original.key);
      expect(action.job.scope).toEqual(original.input.directory.scope);
      expect(action.key).toBe(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await response.json()).status).toBe("completed");
      await route.abort("failed");
    });
    await panel
      .getByRole("button", { name: "明确取消原复制任务", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("原动作结果未确定");
    await expect(panel.getByTestId("nle-copy-pending-action")).toContainText(
      originalActionKey,
    );
    await expect(panel.getByTestId("nle-copy-original-job")).toHaveCount(0);
    await page!.unroute(cancelPattern);
    const beforeActionReload = calls.length;
    await page!.reload();
    await navigate();
    expect(calls).toHaveLength(beforeActionReload);
    await expect(panel.getByTestId("nle-copy-pending-action")).toContainText(
      originalActionKey,
    );
    await panel
      .getByRole("button", { name: "只读恢复原复制任务", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "未重发上次刷新／取消",
    );
    await expect
      .poll(async () => {
        if (
          await panel
            .getByRole("button", { name: "明确刷新原任务结果", exact: true })
            .count()
        ) {
          await panel
            .getByRole("button", { name: "明确刷新原任务结果", exact: true })
            .click();
          await expect(panel).toHaveAttribute("aria-busy", "false");
        }
        return panel.getByTestId("nle-copy-original-job").textContent();
      })
      .toContain("原包复制已完成");
    expect(copyPosts()).toHaveLength(1);
    const done = await client!.timelineMediaCopies.recover(
      original.input,
      original.key,
    );
    expect(done.status).toBe("completed");
    expect(done.copy!.receipt.files).toHaveLength(8);
    const folders = await readdir(output);
    expect(folders).toHaveLength(1);
    const folder = join(output, folders[0]!);
    for (const item of done.copy!.receipt.files) {
      const copied = await readFile(join(folder, item.relativePath));
      expect(copied.length).toBe(item.sizeBytes);
      expect(createHash("sha256").update(copied).digest("hex")).toBe(
        item.sha256,
      );
    }
    await expect(panel).toContainText("质量未核验 · 授权未核验 · 费用未知");
    await panel
      .getByRole("button", { name: "展示这个已完成原包", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("已请求展示这个原包");
    expect(
      await application!.evaluate(
        () =>
          (globalThis as typeof globalThis & { controlledNleReveals: string[] })
            .controlledNleReveals,
      ),
    ).toEqual([folder]);
    await panel
      .getByRole("button", { name: "读取此时间线原复制历史", exact: true })
      .click();
    await expect(panel.getByTestId("nle-copy-history")).toContainText(
      "1 条原任务历史",
    );
    await panel
      .getByRole("button", { name: "重读这条原历史任务", exact: true })
      .click();
    await expect(panel.getByTestId("nle-copy-original-job")).toContainText(
      original.key,
    );
    await panel.screenshot({
      path: info.outputPath("ordinary-nle-copy-original-completed.png"),
    });

    // Stop waiting for a real GET. It must not invoke cancellation or clear the original key.
    const getPattern = `**/api/v2/timeline-media-copies/${original.key}?**`;
    let reached!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => {
        reached = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    await page!.route(getPattern, async (route) => {
      const response = await route.fetch();
      reached();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await panel
      .getByRole("button", { name: "只读恢复原复制任务", exact: true })
      .click();
    await held;
    await panel
      .getByRole("button", { name: "停止界面等待（不取消复制）", exact: true })
      .click();
    release();
    await expect(panel.getByRole("alert")).toContainText("不等于取消复制");
    await expect(panel.getByTestId("nle-copy-original-job")).toHaveCount(0);
    await page!.unroute(getPattern);
    expect(calls.filter((call) => call.path.endsWith("/cancel"))).toHaveLength(
      1,
    );
    await close();
    await launch();
    await navigate();
    expect(copyPosts()).toHaveLength(1);
    await expect(page!.getByTestId("nle-copy-pending")).toContainText(
      original.key,
    );
    const restartedPanel = page!.getByTestId("nle-media-copy");
    await restartedPanel
      .getByRole("button", { name: "只读恢复原复制任务", exact: true })
      .click();
    await expect(
      restartedPanel.getByTestId("nle-copy-original-job"),
    ).toContainText("原包复制已完成");
    expect(await readdir(output)).toEqual(folders);
    timeline = await client!.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "trim",
        clipId: timeline.tracks[0]!.clips[0]!.id,
        durationFrames: 50,
      },
    });
    await page!.reload();
    await navigate();
    await expect(
      restartedPanel.getByTestId("nle-copy-original-job"),
    ).toHaveCount(0);
    await expect(restartedPanel.getByTestId("nle-copy-pending")).toContainText(
      `原时间线版本 ${original.input.manifest.timeline.version}`,
    );
    await restartedPanel
      .getByRole("button", { name: "只读恢复原复制任务", exact: true })
      .click();
    await expect(
      restartedPanel.getByTestId("nle-copy-original-job"),
    ).toContainText("当前元数据已变");
    expect(copyPosts()).toHaveLength(1);
    expect(await readdir(output)).toEqual(folders);
    expect(
      await page!.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        requestKey,
      ),
    ).toEqual(original);
    await restartedPanel.screenshot({
      path: info.outputPath(
        "ordinary-nle-copy-original-after-source-change.png",
      ),
    });
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
