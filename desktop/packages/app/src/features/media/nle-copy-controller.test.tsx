import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioClient } from "@dramaip/client";
import {
  TimelineMediaCopyInputSchema,
  TimelineMediaCopySchema,
  type TimelineMediaCopy,
} from "@dramaip/contracts/timeline-copy";
import { NleCopyReceiptView } from "./NleMediaCopyPanel";
import {
  NleCopyController,
  nleCopyScope,
  nleCopyStorageKeys,
  nleCopyUnavailable,
} from "./nle-copy-controller";

function fixture() {
  const projectId = crypto.randomUUID(),
    episodeId = crypto.randomUUID(),
    timelineId = crypto.randomUUID(),
    assetId = crypto.randomUUID(),
    artifactRef = crypto.randomUUID(),
    now = new Date().toISOString();
  const scope = {
    projectId,
    episodeId,
    timelineId,
    timelineVersion: 4,
    sourceFingerprint: "a".repeat(64),
  };
  const input = TimelineMediaCopyInputSchema.parse({
    manifest: {
      format: "dramaip-timeline-delivery",
      schemaVersion: 3,
      timeline: {
        format: "dramaip-timeline",
        schemaVersion: 2,
        id: timelineId,
        projectId,
        episodeId,
        adaptationId: crypto.randomUUID(),
        version: 4,
        createdAt: now,
        updatedAt: now,
        sourceFingerprint: "original",
        profile: {
          width: 1080,
          height: 1920,
          frameRate: { numerator: 25, denominator: 1, dropFrame: false },
          audioSampleRate: 48000,
          channels: 2,
        },
        timebase: "frames",
        durationFrames: 25,
        migrationWarnings: [],
        tracks: [],
      },
      sourceFingerprint: scope.sourceFingerprint,
      sourceBlockers: [],
      unsupportedFeatures: [],
      warnings: [],
      media: [
        {
          assetId,
          title: "受控原媒体",
          clipIds: [],
          expectedVersions: [2],
          sourceVersion: 2,
          sourceStatus: "current",
          relativePath: `media/${assetId}.mp4`,
          mediaStatus: "unattached",
          rightsStatus: "unknown",
          rightsDeclaration: "not-provided",
          lineage: [assetId],
          archive: {
            artifactRef,
            kind: "video",
            mimeType: "video/mp4",
            extension: ".mp4",
            sizeBytes: 3,
            sha256: "b".repeat(64),
            verification: "owner-metadata-only",
          },
        },
      ],
    },
    directory: {
      scope,
      grant: {
        grantId: crypto.randomUUID(),
        generation: 1,
        permission: "write-directory",
        displayName: "明确交接目录",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
    purpose: "local-nle-handoff",
    acknowledgedLimits: true,
  });
  const pending = TimelineMediaCopySchema.parse({
    id: crypto.randomUUID(),
    version: 0,
    scope,
    requestHash: "c".repeat(64),
    status: "submission-unknown",
    currentBinding: "unchanged-metadata",
    createdAt: now,
    updatedAt: now,
  });
  const packageRef = crypto.randomUUID();
  // Coordinator fixture only. Cryptographic SDK and real Host tests independently verify bytes.
  const done = TimelineMediaCopySchema.parse({
    ...pending,
    version: 1,
    status: "completed",
    copy: {
      artifactRef: packageRef,
      receiptBytes: 1,
      receiptSha256: "d".repeat(64),
      receipt: {
        format: "dramaip-nle-media-copy-receipt",
        schemaVersion: 1,
        packageRef,
        ...scope,
        verifiedAt: now,
        evidence: "complete-copy-and-destination-re-read-at-recorded-time",
        qualityState: "unverified",
        rightsState: "unverified",
        billingState: "unknown",
        files: [
          {
            relativePath: `media/${assetId}.mp4`,
            kind: "media",
            sizeBytes: 3,
            sha256: "b".repeat(64),
            source: { assetId, recordVersion: 2, artifactId: artifactRef },
          },
          ...[
            "timeline.fcpxml",
            "timeline.otio",
            "timeline.edl",
            "subtitles.srt",
            "subtitles.vtt",
            "relink.json",
            "timeline-manifest.json",
          ].map((relativePath) => ({
            relativePath,
            kind: "document",
            sizeBytes: 0,
            sha256: "e".repeat(64),
          })),
        ],
      },
    },
  });
  const saved = new Map<string, string>(),
    calls: { operation: string; args: unknown[] }[] = [];
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
  };
  const called = (operation: string, args: unknown[]) => {
    calls.push({ operation, args });
  };
  const api: StudioClient["timelineMediaCopies"] = {
    chooseDirectory: async (...args) => {
      called("directory", args);
      return input.directory;
    },
    create: async (...args) => {
      called("create", args);
      return { ...pending, id: args[1] };
    },
    recover: async (...args) => {
      called("recover", args);
      return { ...pending, id: args[1] };
    },
    get: async (...args) => {
      called("get", args);
      return { ...pending, id: args[0], scope: args[1] };
    },
    list: async (...args) => {
      called("list", args);
      return {
        projectId,
        timelineId,
        items: [pending],
        nextCursor: "original-cursor",
      };
    },
    refresh: async (...args) => {
      called("refresh", args);
      return { ...done, id: args[0].id };
    },
    cancel: async (...args) => {
      called("cancel", args);
      return {
        ...pending,
        id: args[0].id,
        version: 1,
        status: "canceled",
        failureCode: "COPY_ABORTED",
        scratchState: "cleaned",
      };
    },
    reveal: async (...args) => {
      called("reveal", args);
      return { revealed: true };
    },
  };
  const controller = new NleCopyController(api, input.manifest, () => storage);
  const start = async () => {
    controller.mount();
    controller.acknowledge(true);
    await controller.chooseDirectory();
    await controller.create();
  };
  return {
    input,
    pending,
    done,
    scope,
    saved,
    storage,
    api,
    calls,
    controller,
    start,
  };
}

test("复制构造／挂载／StrictMode再挂载零网络，声明默认关闭，目录取消不提交", async () => {
  const f = fixture();
  expect(f.saved.size).toBe(0);
  f.controller.mount();
  f.controller.dispose();
  f.controller.mount();
  await f.controller.chooseDirectory();
  await f.controller.create();
  expect(f.calls).toEqual([]);
  expect(f.controller.snapshot().acknowledged).toBe(false);
  f.controller.acknowledge(true);
  f.api.chooseDirectory = async () => ({ scope: f.scope, grant: null });
  await f.controller.chooseDirectory();
  await f.controller.create();
  expect(f.controller.snapshot().notice).toContain("已取消");
  expect(f.saved.size).toBe(0);
  expect(f.calls).toEqual([]);
});

test("空字符串也是损坏的原记录，挂载与其他页晚写都不得当不存在并新建复制", async () => {
  for (const kind of ["request", "action"] as const) {
    const f = fixture();
    f.saved.set(f.controller.storageKeys[kind], "");
    f.controller.mount();
    expect(
      kind === "request"
        ? f.controller.snapshot().badRequest
        : f.controller.snapshot().badAction,
    ).toBe(true);
    f.controller.acknowledge(true);
    await f.controller.chooseDirectory();
    await f.controller.create();
    expect(f.calls).toEqual([]);
    await f.controller.history();
    f.controller.clearCorruptLocalRecords();
    expect(f.saved.size).toBe(0);
    f.controller.acknowledge(true);
    await f.controller.chooseDirectory();
    f.saved.set(f.controller.storageKeys[kind], "");
    await f.controller.create();
    expect(f.calls.map((call) => call.operation)).toEqual([
      "list",
      "directory",
    ]);
    expect(f.controller.snapshot().job).toBeUndefined();
  }
});

test("原键／完整原输入写入且读回成功后才创建，明确提交一次且不自动刷新", async () => {
  const f = fixture();
  f.api.create = async (input, key) => {
    expect(JSON.parse(f.saved.get(f.controller.storageKeys.request)!)).toEqual({
      schemaVersion: 1,
      key,
      input,
    });
    expect(input).toEqual(f.input);
    f.calls.push({ operation: "create", args: [input, key] });
    return { ...f.pending, id: key };
  };
  await f.start();
  await f.controller.create();
  expect(f.calls.map((c) => c.operation)).toEqual(["directory", "create"]);
  expect(f.controller.snapshot().job?.id).toBe(
    f.controller.snapshot().pending?.key,
  );
  expect(f.controller.canPrepareNew()).toBe(false);
});

test("存储抛错或静默未保存时零创建POST，未把旧目录视为新任务完成", async () => {
  for (const silent of [true, false]) {
    const f = fixture();
    f.storage.setItem = () => {
      if (!silent) throw Error("denied");
    };
    await f.start();
    expect(f.calls.map((c) => c.operation)).toEqual(["directory"]);
    expect(f.controller.snapshot().job).toBeUndefined();
    expect(f.controller.snapshot().notice).toContain("未取得确定");
  }
});

test("创建响应丢失／重载不自动重发；当前版本变更仍明确恢复原键和原输入", async () => {
  const f = fixture();
  f.api.create = async () => {
    throw Error("response lost");
  };
  await f.start();
  const original = f.controller.snapshot().pending!;
  expect(f.controller.snapshot().job).toBeUndefined();
  f.controller.dispose();
  const current = structuredClone(f.input.manifest);
  current.timeline.version++;
  current.sourceFingerprint = "f".repeat(64);
  const next = new NleCopyController(f.api, current, () => f.storage);
  next.mount();
  expect(f.calls.map((c) => c.operation)).toEqual(["directory"]);
  expect(next.snapshot().pending).toEqual(original);
  expect(next.snapshot().acknowledged).toBe(false);
  await next.recover();
  expect(f.calls.at(-1)?.args.slice(0, 2)).toEqual([
    original.input,
    original.key,
  ]);
  expect(next.snapshot().job?.scope).toEqual(f.scope);
});

test("停止界面等待只中止请求，迟到回执不发布；仍保留原键而不调用Host取消", async () => {
  const f = fixture();
  let release!: (job: TimelineMediaCopy) => void;
  let signal!: AbortSignal;
  f.api.create = (_input, key, value) => {
    signal = value!;
    f.calls.push({ operation: "create", args: [key] });
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  f.controller.mount();
  f.controller.acknowledge(true);
  await f.controller.chooseDirectory();
  const running = f.controller.create(),
    key = f.controller.snapshot().pending!.key;
  f.controller.stop();
  expect(signal.aborted).toBe(true);
  release({ ...f.done, id: key });
  await running;
  expect(f.controller.snapshot().job).toBeUndefined();
  expect(f.controller.snapshot().pending?.key).toBe(key);
  expect(f.controller.snapshot().notice).toContain("不等于取消");
  expect(f.calls.map((c) => c.operation)).toEqual(["directory", "create"]);
  await f.controller.recover();
  expect(f.controller.snapshot().job?.id).toBe(key);
});

test("来源面板卸载再挂载拒绝旧代际迟到结果，原身份保留但不自动网络", async () => {
  const f = fixture();
  let release!: (job: TimelineMediaCopy) => void;
  f.api.create = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.controller.mount();
  f.controller.acknowledge(true);
  await f.controller.chooseDirectory();
  const running = f.controller.create(),
    key = f.controller.snapshot().pending!.key;
  f.controller.dispose();
  f.controller.mount();
  release({ ...f.done, id: key });
  await running;
  expect(f.controller.snapshot().job).toBeUndefined();
  expect(f.controller.snapshot().phase).toBe("idle");
  expect(f.controller.snapshot().pending?.key).toBe(key);
  expect(f.calls).toHaveLength(1);
});

test("刷新／取消各自保存原动作后POST，丢失响应保存旧身份且只读恢复不重发", async () => {
  for (const operation of ["refresh", "cancel"] as const) {
    const f = fixture();
    await f.start();
    const original = f.controller.snapshot().job!;
    f.api[operation] = async (job, key) => {
      expect(JSON.parse(f.saved.get(f.controller.storageKeys.action)!)).toEqual(
        { schemaVersion: 1, key, operation, job },
      );
      expect(job).toEqual(original);
      f.calls.push({ operation, args: [job, key] });
      throw Error("lost reply");
    };
    await f.controller.observe(operation);
    const action = f.controller.snapshot().action!;
    expect(action.job.id).toBe(original.id);
    expect(f.controller.snapshot().job).toBeUndefined();
    f.controller.dispose();
    f.controller.mount();
    const count = f.calls.length;
    await f.controller.recover();
    expect(f.calls).toHaveLength(count + 1);
    expect(f.calls.at(-1)?.operation).toBe("recover");
    expect(f.controller.snapshot().action).toEqual(action);
    expect(f.controller.snapshot().notice).toContain("未重发");
  }
});

test("明确取消真实原任务显示取消而非成功；刷新完成仅明确新请求时清本机绑定", async () => {
  for (const operation of ["refresh", "cancel"] as const) {
    const f = fixture();
    await f.start();
    await f.controller.observe(operation);
    expect(f.controller.snapshot().job?.status).toBe(
      operation === "refresh" ? "completed" : "canceled",
    );
    expect(f.controller.snapshot().action).toBeUndefined();
    expect(f.saved.has(f.controller.storageKeys.request)).toBe(true);
    expect(f.controller.canPrepareNew()).toBe(true);
    f.controller.prepareNew();
    expect(f.saved.size).toBe(0);
    expect(f.controller.snapshot().acknowledged).toBe(false);
    expect(f.controller.snapshot().directory).toBeUndefined();
    expect(f.calls.map((c) => c.operation)).toEqual([
      "directory",
      "create",
      operation,
    ]);
  }
});

test("动作本机持久化失败时零刷新／取消；单独动作重载仅GET原任务且拒绝旧版本", async () => {
  for (const operation of ["refresh", "cancel"] as const) {
    const f = fixture();
    await f.start();
    f.storage.setItem = () => {};
    const count = f.calls.length;
    await f.controller.observe(operation);
    expect(f.calls).toHaveLength(count);
    expect(f.controller.snapshot().job).toBeUndefined();
  }
  const f = fixture(),
    action = {
      schemaVersion: 1 as const,
      key: crypto.randomUUID(),
      operation: "cancel" as const,
      job: { ...f.pending, version: 3 },
    };
  f.saved.set(f.controller.storageKeys.action, JSON.stringify(action));
  f.controller.mount();
  expect(f.calls).toEqual([]);
  await f.controller.recover();
  expect(f.calls.at(-1)?.operation).toBe("get");
  expect(f.calls.at(-1)?.args.slice(0, 2)).toEqual([f.pending.id, f.scope]);
  expect(f.controller.snapshot().job).toBeUndefined();
  f.api.get = async () => ({ ...f.pending, version: 3 });
  await f.controller.recover();
  expect(f.controller.snapshot().job?.version).toBe(3);
  expect(f.controller.snapshot().action).toEqual(action);
  expect(f.calls.every((call) => call.operation === "get")).toBe(true);
});

test("删除本机记录静默失败不解除原绑定，仍须明确只读恢复", async () => {
  const f = fixture();
  await f.start();
  await f.controller.observe("refresh");
  f.storage.removeItem = () => {};
  f.controller.prepareNew();
  expect(f.controller.snapshot().pending).toBeDefined();
  expect(f.controller.snapshot().job?.status).toBe("completed");
  expect(f.controller.snapshot().notice).toContain("未准备新请求");
  expect(f.saved.size).toBe(1);
});

test("错误原身份／作用域／hash／倒退版本拒绝旧回执，原动作仍可恢复", async () => {
  for (const patch of [
    { id: crypto.randomUUID() },
    { scope: { ...fixture().scope } },
    { requestHash: "f".repeat(64) },
    { version: 0 },
  ]) {
    const f = fixture();
    await f.start();
    f.api.recover = async (_input, key) => ({
      ...f.pending,
      id: key,
      version: 2,
    });
    await f.controller.recover();
    f.api.refresh = async (job) => ({ ...job, ...patch });
    await f.controller.observe("refresh");
    expect(f.controller.snapshot().job).toBeUndefined();
    expect(f.controller.snapshot().action).toBeDefined();
  }
});

test("损坏／外域本机缓存不自动网络、不经无关完成历史清除；先显式读历史才允许清本机", async () => {
  const f = fixture(),
    foreign = fixture();
  f.saved.set(
    f.controller.storageKeys.request,
    JSON.stringify({
      schemaVersion: 1,
      key: foreign.pending.id,
      input: foreign.input,
    }),
  );
  f.controller.mount();
  f.controller.acknowledge(true);
  await f.controller.chooseDirectory();
  expect(f.calls).toEqual([]);
  f.controller.clearCorruptLocalRecords();
  expect(f.saved.size).toBe(1);
  f.api.get = async () => f.done;
  await f.controller.select(f.done);
  expect(f.controller.canPrepareNew()).toBe(false);
  f.controller.prepareNew();
  expect(f.saved.size).toBe(1);
  await f.controller.history();
  f.controller.clearCorruptLocalRecords();
  expect(f.saved.size).toBe(0);
  expect(f.controller.snapshot().notice).toContain("没有取消或删除");
});

test("原请求A不能用历史任务B的刷新或取消覆盖持久动作；矛盾缓存明确阻止而不删除", async () => {
  const f = fixture();
  await f.start();
  const other = { ...f.pending, id: crypto.randomUUID() };
  await f.controller.select(other);
  const count = f.calls.length;
  await f.controller.observe("cancel");
  expect(f.calls).toHaveLength(count);
  f.saved.set(
    f.controller.storageKeys.action,
    JSON.stringify({
      schemaVersion: 1,
      key: crypto.randomUUID(),
      operation: "cancel",
      job: other,
    }),
  );
  f.controller.mount();
  expect(f.controller.snapshot().badAction).toBe(true);
  await f.controller.recover();
  expect(f.calls).toHaveLength(count);
  expect(f.saved.size).toBe(2);
  await f.controller.history();
  f.controller.clearCorruptLocalRecords();
  expect(f.controller.snapshot().action).toBeUndefined();
  expect(f.controller.snapshot().pending).toBeDefined();
  expect(f.saved.size).toBe(1);
});

test("损坏缓存确认前被别页修复，不删除新原身份；存储不可读不冒认损坏内容", async () => {
  const f = fixture();
  f.saved.set(f.controller.storageKeys.request, "broken original");
  f.controller.mount();
  await f.controller.history();
  const repaired = JSON.stringify({
    schemaVersion: 1,
    key: f.pending.id,
    input: f.input,
  });
  f.saved.set(f.controller.storageKeys.request, repaired);
  f.controller.clearCorruptLocalRecords();
  expect(f.saved.get(f.controller.storageKeys.request)).toBe(repaired);
  expect(f.controller.snapshot().badRequest).toBe(true);
  f.controller.mount();
  expect(f.controller.snapshot().pending?.key).toBe(f.pending.id);
  const originalGet = f.storage.getItem;
  f.storage.getItem = () => {
    throw Error("denied");
  };
  f.controller.mount();
  f.storage.getItem = originalGet;
  await f.controller.history();
  f.controller.clearCorruptLocalRecords();
  expect(f.saved.get(f.controller.storageKeys.request)).toBe(repaired);
  expect(f.controller.snapshot().badRequest).toBe(true);
});

test("同ID损坏动作hash不被原请求恢复洗白，明确读历史后仅清动作保留原请求", async () => {
  const f = fixture();
  await f.start();
  const pending = f.controller.snapshot().pending!;
  f.saved.set(
    f.controller.storageKeys.action,
    JSON.stringify({
      key: crypto.randomUUID(),
      operation: "cancel",
      schemaVersion: 1,
      job: { ...f.pending, id: pending.key, requestHash: "f".repeat(64) },
    }),
  );
  f.controller.mount();
  await f.controller.recover();
  expect(f.controller.snapshot().job).toBeUndefined();
  expect(f.controller.snapshot().badAction).toBe(true);
  await f.controller.history();
  f.controller.clearCorruptLocalRecords();
  expect(f.controller.snapshot().action).toBeUndefined();
  expect(f.controller.snapshot().pending).toEqual(pending);
  expect(f.saved.size).toBe(1);
  await f.controller.recover();
  expect(f.controller.snapshot().job?.id).toBe(pending.key);
});

test("历史分页仅显式读取，失败清旧列表和游标，重复／外域任务拒绝", async () => {
  const f = fixture();
  f.controller.mount();
  await f.controller.history();
  expect(f.controller.snapshot().history).toEqual([f.pending]);
  const next = { ...f.pending, id: crypto.randomUUID() };
  f.api.list = async (_timeline, _project, options) => {
    expect(options?.cursor).toBe("original-cursor");
    return { ...f.scope, items: [next] };
  };
  await f.controller.history(true);
  expect(f.controller.snapshot().history).toEqual([f.pending, next]);
  f.api.list = async () => {
    throw Error("offline");
  };
  await f.controller.history();
  expect(f.controller.snapshot().history).toBeUndefined();
  expect(f.controller.snapshot().cursor).toBeUndefined();
  for (const items of [[f.pending, f.pending], [fixture().pending]]) {
    f.api.list = async () => ({ ...f.scope, items });
    await f.controller.history();
    expect(f.controller.snapshot().history).toBeUndefined();
  }
});

test("已完成原包只能明确展示，展示失败不回落其他目录；本机被别页改写则不清新记录", async () => {
  const f = fixture();
  await f.start();
  await f.controller.observe("refresh");
  expect(f.calls.map((c) => c.operation)).not.toContain("reveal");
  await f.controller.reveal();
  expect(f.calls.at(-1)?.operation).toBe("reveal");
  f.api.reveal = async () => {
    throw Error("output unavailable");
  };
  await f.controller.reveal();
  expect(f.controller.snapshot().job).toBeUndefined();
  expect(f.controller.snapshot().notice).toContain("不会换成其他目录");
  f.api.recover = async (_input, key) => ({ ...f.done, id: key });
  await f.controller.recover();
  f.saved.set(
    f.controller.storageKeys.request,
    "another panel original request",
  );
  f.controller.prepareNew();
  expect(f.saved.get(f.controller.storageKeys.request)).toBe(
    "another panel original request",
  );
  expect(f.controller.snapshot().pending).toBeDefined();
});

test("可用范围保留小说独立路径并拒绝受限／非P0／超限／不完整来源，恢复键不绑定最新指纹", () => {
  const f = fixture(),
    manifest = structuredClone(f.input.manifest);
  expect(nleCopyUnavailable(manifest)).toEqual([]);
  manifest.media = [];
  expect(nleCopyUnavailable(manifest).join()).toContain(
    "小说和无媒体改编不需要",
  );
  for (const mutate of [
    () => {
      manifest.media = structuredClone(f.input.manifest.media);
      manifest.media[0]!.rightsStatus = "restricted";
    },
    () => {
      manifest.timeline.profile.width = 1920;
    },
    () => {
      manifest.media[0]!.archive!.sizeBytes = 2 * 1024 ** 3 + 1;
    },
    () => {
      manifest.media[0]!.sourceVersion = undefined;
    },
  ]) {
    mutate();
    expect(nleCopyUnavailable(manifest).length).toBeGreaterThan(0);
  }
  manifest.timeline.version++;
  manifest.sourceFingerprint = "f".repeat(64);
  expect(nleCopyStorageKeys(manifest)).toEqual(
    nleCopyStorageKeys(f.input.manifest),
  );
  expect(nleCopyScope(manifest)).not.toEqual(f.scope);
});

test("回执文案严格标历史字节事实／未核质量授权费用，变源和取消不显示成功原包", () => {
  const f = fixture(),
    html = renderToStaticMarkup(
      <NleCopyReceiptView
        job={{ ...f.done, currentBinding: "changed-metadata" }}
      />,
    );
  expect(html).toContain("当前元数据已变");
  expect(html).toContain("仅证明记录时间");
  expect(html).toContain("不证明当前文件持续完整");
  expect(html).toContain("不是正式 Media Gate 通过");
  expect(html).toContain("质量未核验");
  expect(html).toContain(f.done.id);
  const canceled = TimelineMediaCopySchema.parse({
    ...f.pending,
    status: "canceled",
    failureCode: "COPY_ABORTED",
    scratchState: "cleaned",
  });
  const failed = renderToStaticMarkup(<NleCopyReceiptView job={canceled} />);
  expect(failed).toContain("原复制已取消");
  expect(failed).not.toContain("原包凭证");
});
