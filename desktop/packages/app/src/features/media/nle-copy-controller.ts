import { z } from "zod";
import type { StudioClient } from "@dramaip/client";
import {
  TimelineCopyManifestSchema,
  TimelineMediaCopyInputSchema,
  TimelineMediaCopySchema,
  type TimelineCopyDirectorySelection,
  type TimelineMediaCopy,
  type TimelineMediaCopyInput,
  type TimelineCopyScope,
} from "@dramaip/contracts/timeline-copy";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/timeline";

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const nleCopyScope = (
  manifest: TimelineDeliveryManifest,
): TimelineCopyScope => ({
  projectId: manifest.timeline.projectId,
  episodeId: manifest.timeline.episodeId,
  timelineId: manifest.timeline.id,
  timelineVersion: manifest.timeline.version,
  sourceFingerprint: manifest.sourceFingerprint,
});
export const isNleCopyTerminal = (job: TimelineMediaCopy) =>
  !["submission-unknown", "queued", "running"].includes(job.status);
export const nleCopyStorageKeys = (manifest: TimelineDeliveryManifest) => ({
  request: `dramaip:nle-copy-request:${manifest.timeline.projectId}:${manifest.timeline.id}`,
  action: `dramaip:nle-copy-action:${manifest.timeline.projectId}:${manifest.timeline.id}`,
});
export const NleCopyPendingSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string().uuid(),
    input: TimelineMediaCopyInputSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.input.directory.grant ||
      !equal(value.input.directory.scope, nleCopyScope(value.input.manifest))
    )
      ctx.addIssue({
        code: "custom",
        message: "Original copy input scope differs",
      });
  });
export const NleCopyActionSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string().uuid(),
    operation: z.enum(["refresh", "cancel"]),
    job: TimelineMediaCopySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (isNleCopyTerminal(value.job))
      ctx.addIssue({
        code: "custom",
        message: "Only pending original jobs need observation recovery",
      });
  });
type Pending = z.infer<typeof NleCopyPendingSchema>;
type Action = z.infer<typeof NleCopyActionSchema>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Phase =
  | "idle"
  | "directory"
  | "creating"
  | "recovering"
  | "reading"
  | "refreshing"
  | "canceling"
  | "revealing";
export type NleCopyState = {
  phase: Phase;
  acknowledged: boolean;
  directory?: TimelineCopyDirectorySelection;
  pending?: Pending;
  action?: Action;
  job?: TimelineMediaCopy;
  history?: readonly TimelineMediaCopy[];
  cursor?: string;
  notice?: string;
  badRequest?: boolean;
  badAction?: boolean;
};

export function nleCopyUnavailable(
  manifest: TimelineDeliveryManifest,
): string[] {
  const profile = manifest.timeline.profile,
    reasons: string[] = [];
  if (!manifest.media.length)
    reasons.push("没有可复制的原媒体；小说和无媒体改编不需要此步骤。");
  if (
    manifest.sourceBlockers.length ||
    manifest.media.some(
      (item) =>
        item.sourceStatus !== "current" ||
        item.sourceVersion === undefined ||
        !item.archive ||
        item.expectedVersions.length !== 1 ||
        item.expectedVersions[0] !== item.sourceVersion,
    )
  )
    reasons.push(
      "存在未能完整核对的原素材／存档／版本，请先重新读取清单并解决来源问题。",
    );
  if (manifest.media.some((item) => item.rightsStatus === "restricted"))
    reasons.push("存在受限声明素材，不能沿此清单复制。");
  if (
    profile.width !== 1080 ||
    profile.height !== 1920 ||
    profile.frameRate.numerator !== 25 ||
    profile.frameRate.denominator !== 1 ||
    profile.frameRate.dropFrame ||
    profile.audioSampleRate !== 48000 ||
    profile.channels !== 2
  )
    reasons.push(
      "本地复制暂仅支持现有导出器的1080×1920／25fps／48k立体声配置。",
    );
  if (
    manifest.media.length > 1000 ||
    manifest.media.some(
      (item) => (item.archive?.sizeBytes ?? 0) > 2 * 1024 ** 3,
    ) ||
    manifest.media.reduce(
      (sum, item) => sum + (item.archive?.sizeBytes ?? 0),
      0,
    ) >
      8 * 1024 ** 3
  )
    reasons.push(
      "复制限额为1000个原媒体、单文件2 GiB、合计8 GiB；不会截取或跳过超限素材。",
    );
  return reasons;
}

/** UI request coordinator. No timer, automatic network request, Host access or latest-source fallback. */
export class NleCopyController {
  private state: NleCopyState = { phase: "idle", acknowledged: false };
  private lease?: AbortController;
  private disposed = true;
  private badRequestRaw?: string | null;
  private badActionRaw?: string | null;
  private readonly listeners = new Set<() => void>();
  readonly manifest: TimelineDeliveryManifest;
  readonly storageKeys: ReturnType<typeof nleCopyStorageKeys>;
  constructor(
    private readonly api: StudioClient["timelineMediaCopies"],
    manifest: TimelineDeliveryManifest,
    private readonly storage: () => Storage = () => localStorage,
  ) {
    this.manifest = TimelineCopyManifestSchema.parse(manifest);
    this.storageKeys = nleCopyStorageKeys(this.manifest);
  }
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<NleCopyState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private sameTimeline(scope: TimelineCopyScope) {
    return (
      scope.projectId === this.manifest.timeline.projectId &&
      scope.timelineId === this.manifest.timeline.id
    );
  }
  mount() {
    this.disposed = false;
    this.badRequestRaw = undefined;
    this.badActionRaw = undefined;
    this.state = { phase: "idle", acknowledged: false };
    for (const kind of ["request", "action"] as const) {
      let raw: string | null | undefined;
      try {
        raw = this.storage().getItem(this.storageKeys[kind]);
        if (raw === null) continue;
        if (kind === "request") {
          const value = NleCopyPendingSchema.parse(JSON.parse(raw));
          if (!this.sameTimeline(value.input.directory.scope))
            throw Error("Foreign request");
          this.set({ pending: value });
        } else {
          this.badActionRaw = raw;
          const value = NleCopyActionSchema.parse(JSON.parse(raw));
          if (!this.sameTimeline(value.job.scope))
            throw Error("Foreign action");
          this.set({ action: value });
        }
      } catch {
        if (kind === "request") this.badRequestRaw = raw;
        else this.badActionRaw = raw;
        this.set(
          kind === "request" ? { badRequest: true } : { badAction: true },
        );
      }
    }
    if (
      this.state.pending &&
      this.state.action &&
      (this.state.pending.key !== this.state.action.job.id ||
        !equal(
          this.state.pending.input.directory.scope,
          this.state.action.job.scope,
        ))
    ) {
      this.set({ badAction: true });
    }
    this.set({
      notice:
        this.state.badRequest || this.state.badAction
          ? "本机恢复记录无法核对；不会自动复制。先读取原历史，再明确处理损坏的本机记录。"
          : undefined,
    });
  }
  dispose() {
    this.disposed = true;
    this.lease?.abort();
    this.lease = undefined;
    this.listeners.clear();
  }
  acknowledge(value: boolean) {
    if (this.state.phase === "idle") this.set({ acknowledged: value });
  }
  private save(kind: "request" | "action", value: Pending | Action) {
    const raw = JSON.stringify(value);
    const store = this.storage();
    store.setItem(this.storageKeys[kind], raw);
    if (store.getItem(this.storageKeys[kind]) !== raw)
      throw Error("Recovery record was not saved");
    if (kind === "action") this.badActionRaw = raw;
  }
  private remove(kind: "request" | "action", expected?: Pending | Action) {
    const store = this.storage(),
      key = this.storageKeys[kind];
    if (expected && store.getItem(key) !== JSON.stringify(expected))
      throw Error("Original local record changed");
    store.removeItem(key);
    if (store.getItem(key) !== null)
      throw Error("Original local record was not removed");
  }
  private checked(
    job: TimelineMediaCopy,
    original: TimelineCopyScope,
    id: string,
    hash?: string,
  ) {
    const value = TimelineMediaCopySchema.parse(job);
    if (
      !this.sameTimeline(value.scope) ||
      !equal(value.scope, original) ||
      value.id !== id ||
      (hash !== undefined && value.requestHash !== hash)
    )
      throw Error("Original task differs");
    return value;
  }
  private async run(
    phase: Phase,
    work: (signal: AbortSignal) => Promise<Partial<NleCopyState>>,
    failure: string,
  ) {
    if (this.disposed || this.lease) return;
    const lease = new AbortController();
    this.lease = lease;
    this.set({
      phase,
      notice: undefined,
      ...(phase === "directory" ? { directory: undefined } : {}),
      ...([
        "creating",
        "recovering",
        "reading",
        "refreshing",
        "canceling",
        "revealing",
      ].includes(phase)
        ? { job: undefined }
        : {}),
    });
    try {
      const patch = await work(lease.signal);
      if (this.lease === lease && !lease.signal.aborted && !this.disposed)
        this.set(patch);
    } catch {
      if (this.lease === lease && !lease.signal.aborted && !this.disposed)
        this.set({ notice: failure });
    } finally {
      if (this.lease === lease) {
        this.lease = undefined;
        this.set({ phase: "idle" });
      }
    }
  }
  stop() {
    this.lease?.abort();
    this.lease = undefined;
    this.set({
      phase: "idle",
      job: undefined,
      notice:
        "界面等待已停止，不等于取消复制或撤回已发送动作。原身份保留，请先只读恢复原任务。",
    });
  }
  chooseDirectory() {
    if (
      !this.state.acknowledged ||
      this.state.pending ||
      this.state.action ||
      this.state.badRequest ||
      this.state.badAction ||
      nleCopyUnavailable(this.manifest).length
    )
      return Promise.resolve();
    return this.run(
      "directory",
      async (signal) => {
        const directory = await this.api.chooseDirectory(this.manifest, signal);
        if (!equal(directory.scope, nleCopyScope(this.manifest)))
          throw Error("Directory scope changed");
        return {
          directory,
          notice: directory.grant
            ? "目录仅获本次原清单写授权；还没有开始复制。"
            : "目录选择已取消，没有创建复制请求。",
        };
      },
      "原清单目录选择未完成；未取得可用的新写授权，请明确重新核对。",
    );
  }
  create() {
    if (
      !this.state.acknowledged ||
      !this.state.directory?.grant ||
      this.state.pending ||
      this.state.action ||
      this.state.badRequest ||
      this.state.badAction ||
      nleCopyUnavailable(this.manifest).length
    )
      return Promise.resolve();
    const directory = this.state.directory;
    return this.run(
      "creating",
      async (signal) => {
        if (
          this.storage().getItem(this.storageKeys.request) !== null ||
          this.storage().getItem(this.storageKeys.action) !== null
        )
          throw Error("An original request already exists locally");
        const input: TimelineMediaCopyInput =
          TimelineMediaCopyInputSchema.parse({
            manifest: this.manifest,
            directory,
            purpose: "local-nle-handoff",
            acknowledgedLimits: true,
          });
        const pending = NleCopyPendingSchema.parse({
          schemaVersion: 1,
          key: crypto.randomUUID(),
          input,
        });
        this.save("request", pending);
        this.set({ pending }); // Must succeed before the only create POST.
        signal.throwIfAborted();
        const job = this.checked(
          await this.api.create(input, pending.key, signal),
          input.directory.scope,
          pending.key,
        );
        return { job };
      },
      "未取得确定原回执，或本机恢复信息未能保存。若已提交，原键／原输入仍保留；先只读恢复，不自动换键或重抄。",
    );
  }
  recover() {
    const pending = this.state.pending,
      action = this.state.action;
    if ((!pending && !action) || this.state.badAction) return Promise.resolve();
    return this.run(
      "recovering",
      async (signal) => {
        const original = pending
          ? pending.input.directory.scope
          : action!.job.scope;
        const id = pending?.key ?? action!.job.id;
        const job = pending
          ? await this.api.recover(pending.input, pending.key, signal)
          : await this.api.get(id, original, signal);
        const checked = this.checked(
          job,
          original,
          id,
          !pending ? action!.job.requestHash : undefined,
        );
        if (action && checked.requestHash !== action.job.requestHash) {
          this.set({ badAction: true });
          throw Error("Original action hash differs");
        }
        if (action && checked.version < action.job.version)
          throw Error("Original observation moved backwards");
        return {
          job: checked,
          notice: action
            ? "只读重查了原任务，未重发上次刷新／取消，也不据此声称该旧动作成功。"
            : undefined,
        };
      },
      "原请求本次读取失败或尚无确定记录；旧回执不当本次结果，不换源、不自动重发。",
    );
  }
  select(item: TimelineMediaCopy) {
    return this.run(
      "reading",
      async (signal) => ({
        job: this.checked(
          await this.api.get(item.id, item.scope, signal),
          item.scope,
          item.id,
          item.requestHash,
        ),
      }),
      "选中的原历史任务未能重读，未改用其他任务或缓存回执。",
    );
  }
  observe(operation: "refresh" | "cancel") {
    const job = this.state.job;
    if (!job || !this.canObserve()) return Promise.resolve();
    return this.run(
      operation === "refresh" ? "refreshing" : "canceling",
      async (signal) => {
        const action = NleCopyActionSchema.parse({
          schemaVersion: 1,
          key: crypto.randomUUID(),
          operation,
          job,
        });
        this.save("action", action);
        this.set({ action });
        signal.throwIfAborted();
        const value = this.checked(
          await this.api[operation](job, action.key, signal),
          job.scope,
          job.id,
          job.requestHash,
        );
        if (value.version < job.version)
          throw Error("Original version moved backwards");
        signal.throwIfAborted();
        this.remove("action", action);
        return { job: value, action: undefined };
      },
      "原动作结果未确定；任务／动作标识已保留。先只读恢复，不自动重发取消、换键或把旧状态当成功。",
    );
  }
  canObserve() {
    const job = this.state.job;
    return !(
      this.disposed ||
      this.state.phase !== "idle" ||
      !job ||
      isNleCopyTerminal(job) ||
      this.state.badRequest ||
      this.state.badAction ||
      (this.state.pending && this.state.pending.key !== job.id) ||
      (this.state.action &&
        (this.state.action.job.id !== job.id ||
          this.state.action.job.requestHash !== job.requestHash))
    );
  }
  reveal() {
    const job = this.state.job;
    if (!job?.copy || job.status !== "completed") return Promise.resolve();
    return this.run(
      "revealing",
      async (signal) => {
        await this.api.reveal(job, signal);
        return {
          job,
          notice: "已请求展示这个原包；展示不是重新核验当前字节或授权。",
        };
      },
      "这个原输出未能展示或等待已中断；不会换成其他目录。",
    );
  }
  async history(more = false) {
    if (this.disposed || this.lease || (more && !this.state.cursor)) return;
    const prior = this.state.history ?? [],
      cursor = more ? this.state.cursor : undefined;
    this.set({ history: undefined, cursor: undefined });
    return this.run(
      "reading",
      async (signal) => {
        const page = await this.api.list(
          this.manifest.timeline.id,
          this.manifest.timeline.projectId,
          { cursor, limit: 25 },
          signal,
        );
        const history = more ? [...prior, ...page.items] : page.items;
        if (
          new Set(history.map((item) => item.id)).size !== history.length ||
          history.some((item) => !this.sameTimeline(item.scope))
        )
          throw Error("History scope or cursor differs");
        return { history, cursor: page.nextCursor };
      },
      "本次原包历史读取失败，旧列表和游标已清除；请明确重新读取，不把缓存当本次证据。",
    );
  }
  canPrepareNew() {
    const { job, pending, action } = this.state;
    return (
      !this.disposed &&
      this.state.phase === "idle" &&
      !this.state.badRequest &&
      !this.state.badAction &&
      !!job &&
      isNleCopyTerminal(job) &&
      (!pending || pending.key === job.id) &&
      (!action || action.job.id === job.id)
    );
  }
  prepareNew() {
    if (!this.canPrepareNew()) return;
    try {
      this.remove("request", this.state.pending);
      this.remove("action", this.state.action);
      this.set({
        pending: undefined,
        action: undefined,
        job: undefined,
        directory: undefined,
        acknowledged: false,
        notice:
          "原任务仍保存在历史中。新复制须另行声明用途、选择目录和提交；没有自动复制。",
      });
    } catch {
      this.set({ notice: "本机原绑定未能清除，未准备新请求。" });
    }
  }
  clearCorruptLocalRecords() {
    if (
      this.disposed ||
      this.state.phase !== "idle" ||
      this.state.history === undefined ||
      (!this.state.badRequest && !this.state.badAction)
    )
      return;
    try {
      const { badRequest, badAction } = this.state;
      for (const kind of ["request", "action"] as const) {
        if (kind === "request" ? !badRequest : !badAction) continue;
        const original =
          kind === "request" ? this.badRequestRaw : this.badActionRaw;
        if (
          original === undefined ||
          this.storage().getItem(this.storageKeys[kind]) !== original
        )
          throw Error("Damaged local record changed; reload before clearing");
      }
      if (badRequest) this.remove("request");
      if (badAction) this.remove("action");
      this.badRequestRaw = undefined;
      this.badActionRaw = undefined;
      this.set({
        badRequest: false,
        badAction: false,
        ...(badRequest ? { pending: undefined } : {}),
        ...(badAction ? { action: undefined } : {}),
        directory: undefined,
        acknowledged: false,
        notice:
          "仅清除本机损坏记录，没有取消或删除原任务。清除不证明旧请求未提交，请核对原历史再决定新复制。",
      });
    } catch {
      this.set({ notice: "本机损坏记录未能清除；没有发起新复制。" });
    }
  }
}
