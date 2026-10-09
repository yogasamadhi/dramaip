import { useEffect, useRef, useState } from "react";
import { StudioClientError } from "@dramaip/client";
import type {
  TimelineRenderCatalog,
  TimelineRenderJob,
  TimelineRenderPreflight,
} from "@dramaip/contracts/timeline";
import { BareButton } from "@dramaip/ui-shared";
import { message, useStudio } from "../../studio-shared";
import {
  findRenderReceipt,
  freezeRenderRequest,
  parseRenderRequest,
  readRenderHistory,
  RenderSelectionSchema,
  type RenderRequest,
} from "../../timeline-render-recovery";
import { MediaPlaybackPanel } from "./MediaPlaybackPanel";
import { MediaDeliveryEvidencePanel } from "./MediaDeliveryEvidencePanel";
import {
  TimelineRenderSubtitleControls,
  TimelineRenderSubtitlePolicyView,
} from "./TimelineRenderSubtitleControls";
import {
  selectedRenderSubtitlePolicy,
  explicitRenderReady,
  exactRenderRetryReady,
  type RenderFontRef,
  type RenderSubtitleMode,
} from "../../timeline-render-subtitle-selection";
const button =
  "rounded border border-line px-3 py-2 text-xs disabled:opacity-50";
const statusLabel = {
  queued: "已排队",
  running: "执行中",
  succeeded: "渲染文件已归档",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
};

export function TimelineRenderPanel(props: {
  projectId: string;
  episodeId: string;
}) {
  return (
    <RenderPanelBody key={`${props.projectId}:${props.episodeId}`} {...props} />
  );
}
function RenderPanelBody({
  projectId,
  episodeId,
}: {
  projectId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const [catalog, setCatalog] = useState<TimelineRenderCatalog>();
  const [job, setJob] = useState<TimelineRenderJob>();
  const [preflight, setPreflight] = useState<TimelineRenderPreflight>();
  const [subtitleMode, setSubtitleMode] = useState<RenderSubtitleMode>();
  const [subtitleFont, setSubtitleFont] = useState<RenderFontRef>();
  const [subtitleFonts, setSubtitleFonts] =
    useState<TimelineRenderPreflight["subtitleFonts"]>();
  const [subtitleAvailable, setSubtitleAvailable] = useState<boolean>();
  const [pending, setPending] = useState<RenderRequest>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [corruptRecovery, setCorruptRecovery] = useState(false);
  const mounted = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const busyLease = useRef<AbortController | undefined>(undefined);
  const selectedEpoch = useRef(0);
  const storage = `dramaip.timeline-render:${projectId}:${episodeId}`;
  const selection = `${storage}:selected`;
  const acceptJob = (value: TimelineRenderJob) => {
    if (value.outputRecord && value.outputRecord.projectId !== projectId)
      throw new Error("输出记录不属于本项目。");
    selectedEpoch.current++;
    setJob(value);
    setConfirmed(false);
    setPreflight(undefined);
    try {
      localStorage.setItem(
        selection,
        JSON.stringify({ timelineId: value.timelineId, jobId: value.jobId }),
      );
    } catch {
      setNotice("实际任务已核对，但本机无法保存选择；可从 SQL 历史重新打开。");
    }
  };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (busyLease.current && !busyLease.current.signal.aborted) return;
    const abort = new AbortController();
    busyLease.current = abort;
    requests.current.add(abort);
    setBusy(true);
    setError(undefined);
    try {
      await action(abort.signal);
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) setError(message(cause));
    } finally {
      requests.current.delete(abort);
      if (mounted.current && busyLease.current === abort) {
        busyLease.current = undefined;
        setBusy(false);
      }
    }
  };
  const history = async (signal: AbortSignal) => {
    setCatalog(undefined);
    setPreflight(undefined);
    setConfirmed(false);
    const value = await readRenderHistory(
      client.timelineRenders,
      projectId,
      episodeId,
      signal,
    );
    if (mounted.current && !signal.aborted) setCatalog(value);
    return value;
  };
  const recover = async (request: RenderRequest, signal: AbortSignal) => {
    const receipt = await findRenderReceipt(
      client.timelineRenders,
      request,
      signal,
    );
    if (!mounted.current || signal.aborted) return;
    if (!receipt) {
      setNotice("尚未找到原请求回执：保留原键和输入，不自动重发或另建任务。");
      return;
    }
    localStorage.removeItem(storage);
    setPending(undefined);
    acceptJob(receipt);
    setNotice("已找回同一原请求；只读取状态，没有重发、重试或加载文件。");
  };
  useEffect(() => {
    mounted.current = true;
    void run(async (signal) => {
      const value = await history(signal);
      let saved: RenderRequest | undefined;
      try {
        saved = parseRenderRequest(
          localStorage.getItem(storage),
          projectId,
          episodeId,
        );
      } catch (cause) {
        setCorruptRecovery(true);
        throw cause;
      }
      if (saved) {
        setPending(saved);
        await recover(saved, signal);
        return;
      }
      const raw = localStorage.getItem(selection);
      if (!raw) return;
      const selected = RenderSelectionSchema.parse(JSON.parse(raw));
      if (selected.timelineId !== value.timeline?.id)
        throw new Error("旧选择不属于本分集实际时间线，不自动选择其他任务。");
      const result = await client.timelineRenders.get(
        selected.jobId,
        selected.timelineId,
        signal,
      );
      if (mounted.current && !signal.aborted) acceptJob(result);
    });
    return () => {
      mounted.current = false;
      for (const abort of requests.current) abort.abort();
      requests.current.clear();
      busyLease.current = undefined;
      selectedEpoch.current++;
    };
  }, [client, projectId, episodeId]);
  // Poll only a known active task. Unmount aborts reads, never cancels the durable render.
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const original = job;
    const epoch = selectedEpoch.current;
    const abort = new AbortController();
    requests.current.add(abort);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const value = await client.timelineRenders.get(
          original.jobId,
          original.timelineId,
          abort.signal,
        );
        if (!stopped && mounted.current && selectedEpoch.current === epoch)
          setJob(value);
      } catch (cause) {
        if (!stopped && mounted.current && selectedEpoch.current === epoch) {
          setJob(undefined);
          setError(`任务状态未核验：${message(cause)}。可从原历史重新打开。`);
        }
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      abort.abort();
      requests.current.delete(abort);
    };
  }, [client, job?.jobId, job?.status]);
  const submit = async (
    request: RenderRequest,
    replay: boolean,
    signal: AbortSignal,
  ) => {
    try {
      const value = request.retryJobId
        ? await client.timelineRenders.retry(
            request.retryJobId,
            request.timelineId,
            request.version,
            request.input,
            request.key,
            signal,
          )
        : await client.timelineRenders.create(
            request.timelineId,
            request.version,
            request.input,
            request.key,
            signal,
          );
      if (!mounted.current || signal.aborted) return;
      localStorage.removeItem(storage);
      setPending(undefined);
      acceptJob(value);
      await history(signal);
      setNotice(
        "已核对实际任务回执；本地混音输出不代表正式发行或质量／授权通过。",
      );
    } catch (cause) {
      if (!mounted.current || signal.aborted) return;
      if (
        !replay &&
        cause instanceof StudioClientError &&
        [400, 409, 412, 428].includes(cause.status)
      ) {
        localStorage.removeItem(storage);
        setPending(undefined);
      } else
        setNotice(
          "请求结果未能核对，保留原键与输入；先查回执，不自动另建任务。",
        );
      throw cause;
    }
  };
  const start = (retry: boolean) =>
    void run(async (signal) => {
      if (
        !preflight ||
        !confirmed ||
        pending ||
        corruptRecovery ||
        !explicitRenderReady(preflight, subtitleMode, subtitleFont)
      )
        return;
      if (
        retry &&
        !exactRenderRetryReady(job, preflight, subtitleMode, subtitleFont)
      )
        throw new Error("原来源／策略／字体或工具版本不一致，不能换输入重试。");
      const request = freezeRenderRequest(
        projectId,
        episodeId,
        preflight,
        retry ? job : undefined,
      );
      // If safe persistence fails, do not dispatch the write.
      localStorage.setItem(storage, JSON.stringify(request));
      setPending(request);
      setConfirmed(false);
      setPreflight(undefined);
      await submit(request, false, signal);
    });
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-surface p-4"
      data-testid="timeline-render-panel"
    >
      <h2 className="font-semibold">本地实验混音渲染</h2>
      <p className="text-sm text-muted">
        1080×1920／25 fps；按冻结来源与音量／淡入淡出／降配乐控制合成
        AAC，muted／solo
        排除的音轨不参与。没有实际可听来源时才输出已知静音；混音超幅会拒绝，不自动改音量。字幕必须明确选择不烧录，或选择原字体烧录完整原文；不证明内容质量、人物／声音／字体发行权或费用。只读打开不创建时间线、不自动选择策略、渲染或播放。
      </p>
      <TimelineRenderSubtitleControls
        mode={subtitleMode}
        font={subtitleFont}
        fonts={subtitleFonts}
        available={subtitleAvailable}
        disabled={busy || Boolean(pending) || corruptRecovery}
        onMode={(mode) => {
          setSubtitleMode(mode);
          setSubtitleFont(undefined);
          setPreflight(undefined);
          setConfirmed(false);
        }}
        onFont={(font) => {
          setSubtitleFont(font);
          setPreflight(undefined);
          setConfirmed(false);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <BareButton
          className={button}
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              await history(signal);
            })
          }
        >
          重新核对渲染历史
        </BareButton>
        <BareButton
          className={button}
          disabled={
            busy || !catalog?.timeline || Boolean(pending) || corruptRecovery
          }
          onClick={() =>
            void run(async (signal) => {
              setPreflight(undefined);
              setConfirmed(false);
              const actual = await history(signal);
              if (!actual.timeline)
                throw new Error("没有既有时间线，请先明确编辑和保存。");
              const value = await client.timelineRenders.preflight(
                actual.timeline.id,
                actual.timeline.version,
                signal,
                subtitleMode === "burn-in" && !subtitleFont
                  ? undefined
                  : selectedRenderSubtitlePolicy(subtitleMode, subtitleFont),
              );
              if (mounted.current && !signal.aborted) {
                setPreflight(value);
                setSubtitleFonts(value.subtitleFonts ?? []);
                setSubtitleAvailable(value.subtitleBurnInAvailable ?? false);
              }
            })
          }
        >
          核对实际来源与渲染能力
        </BareButton>
      </div>
      {!catalog && (
        <p className="text-xs text-muted">
          渲染历史尚未核全；读取失败不代表没有任务。
        </p>
      )}
      {catalog && !catalog.timeline && (
        <p className="text-sm">
          没有既有时间线；请先在“多轨时间线”明确编辑和保存，此处不会自动初始化。
        </p>
      )}
      {catalog?.timeline && (
        <p className="break-all text-xs">
          当前时间线 v{catalog.timeline.version} · {catalog.timeline.id} ·
          已读历史 {catalog.items.length} 项
        </p>
      )}
      {preflight && (
        <div
          className="space-y-2 rounded border border-line p-3 text-xs"
          data-testid="timeline-render-preflight"
        >
          <p>
            {explicitRenderReady(preflight, subtitleMode, subtitleFont)
              ? "冻结输入预检通过（元数据，不是文件／质量证明）"
              : preflight.ready && !preflight.subtitlePolicy
                ? "尚未明确字幕策略／原字体：选择后须重新预检，不创建任务"
                : "渲染预检未通过"}{" "}
            · 时间线 v{preflight.timelineVersion}
          </p>
          <p className="break-all">
            来源指纹：{preflight.sourceFingerprint ?? "无证明"}
          </p>
          <TimelineRenderSubtitlePolicyView policy={preflight.subtitlePolicy} />
          {[...preflight.blockers, ...preflight.warnings].map((item, index) => (
            <p key={index}>{item}</p>
          ))}
        </div>
      )}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={
            busy ||
            !explicitRenderReady(preflight, subtitleMode, subtitleFont) ||
            Boolean(pending) ||
            corruptRecovery
          }
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        已核对本次冻结来源、混音控制和明确字幕策略／原字体，发起本地编码；知道不代表正式发行、质量或授权通过
      </label>
      <div className="flex flex-wrap gap-2">
        <BareButton
          className={button}
          disabled={
            busy ||
            !confirmed ||
            !explicitRenderReady(preflight, subtitleMode, subtitleFont) ||
            Boolean(pending) ||
            corruptRecovery
          }
          onClick={() => start(false)}
        >
          {subtitleMode === "burn-in"
            ? "创建本次字幕混音渲染"
            : "创建本次混音渲染"}
        </BareButton>
        {job && ["failed", "canceled", "interrupted"].includes(job.status) && (
          <BareButton
            className={button}
            disabled={
              busy ||
              !confirmed ||
              !exactRenderRetryReady(
                job,
                preflight,
                subtitleMode,
                subtitleFont,
              ) ||
              Boolean(pending) ||
              corruptRecovery
            }
            onClick={() => start(true)}
          >
            明确重试原任务来源
          </BareButton>
        )}
      </div>
      {pending && (
        <div
          className="space-y-2 rounded border border-amber-300 p-3 text-xs"
          data-testid="timeline-render-pending-request"
        >
          <p>
            原请求待核对 · 时间线 v{pending.version}
            ；重启不恢复勾选，不自动发送。
          </p>
          <TimelineRenderSubtitlePolicyView
            policy={pending.input.subtitlePolicy}
          />
          <BareButton
            className={button}
            disabled={busy}
            onClick={() => void run((signal) => recover(pending, signal))}
          >
            查找原请求回执
          </BareButton>
          <BareButton
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                const found = await findRenderReceipt(
                  client.timelineRenders,
                  pending,
                  signal,
                );
                if (found) {
                  await recover(pending, signal);
                  return;
                }
                await submit(pending, true, signal);
              })
            }
          >
            明确重发原键与原输入
          </BareButton>
        </div>
      )}
      {catalog?.items.length === 0 && (
        <p className="text-xs text-muted">本次实际历史扫描没有渲染任务。</p>
      )}
      <div className="flex max-h-48 flex-col gap-2 overflow-auto">
        {catalog?.items.map((item) => (
          <BareButton
            key={item.jobId}
            className={`${button} break-all text-left`}
            disabled={busy || Boolean(pending)}
            onClick={() =>
              void run(async (signal) => {
                setJob(undefined);
                setPreflight(undefined);
                setConfirmed(false);
                const value = await client.timelineRenders.get(
                  item.jobId,
                  item.timelineId,
                  signal,
                );
                if (mounted.current && !signal.aborted) acceptJob(value);
              })
            }
          >
            时间线 v{item.timelineVersion} · {statusLabel[item.status]} ·{" "}
            {item.jobId}
          </BareButton>
        ))}
      </div>
      {job && (
        <div
          className="space-y-2 rounded border border-line p-3 text-xs"
          data-testid="timeline-render-job"
        >
          <p className="break-all">
            指定任务 {job.jobId} · 原时间线 v{job.timelineVersion} ·{" "}
            {statusLabel[job.status]} · {Math.round(job.progress * 100)}%
          </p>
          <p>
            原输出策略：{job.timelineProfileVersion}；历史任务不改用当前策略。
          </p>
          <TimelineRenderSubtitlePolicyView policy={job.subtitlePolicy} />
          {job.timelineProfileVersion === "1080x1920-25-48000-stereo-v1" && (
            <p>
              此为旧版静音输出；不能通过重试切换为混音，需重新预检并创建独立新任务。
            </p>
          )}
          {catalog?.timeline &&
            catalog.timeline.version !== job.timelineVersion && (
              <p>历史冻结任务，不代表当前时间线成片；不会自动替换来源。</p>
            )}
          {!job.sourceFingerprint && (
            <p>历史任务没有冻结来源证明，不按最新来源补齐或重试。</p>
          )}
          {job.failureCode && <p>实际失败：{job.failureCode}</p>}
          {["queued", "running"].includes(job.status) && (
            <BareButton
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  const value = await client.timelineRenders.cancel(
                    job.jobId,
                    job.timelineId,
                    signal,
                  );
                  if (mounted.current && !signal.aborted) acceptJob(value);
                  await history(signal);
                })
              }
            >
              明确取消此任务
            </BareButton>
          )}
          {job.status === "succeeded" &&
            (job.outputRecord ? (
              <>
                <MediaDeliveryEvidencePanel
                  recordId={job.outputRecord.id}
                  projectId={projectId}
                  version={job.outputRecord.version}
                />
                <MediaPlaybackPanel
                  key={`${job.jobId}:${job.outputRecord.id}:${job.outputRecord.version}`}
                  recordId={job.outputRecord.id}
                  projectId={projectId}
                  version={job.outputRecord.version}
                  expectedKind="video"
                />
              </>
            ) : (
              <p>
                历史输出没有冻结结果记录身份，不能推测最新素材或提供替代播放器。
              </p>
            ))}
        </div>
      )}
      {notice && (
        <p className="text-xs" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="break-words text-xs text-amber-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
