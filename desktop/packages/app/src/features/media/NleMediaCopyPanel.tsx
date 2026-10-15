import { useEffect, useState, useSyncExternalStore } from "react";
import { BareButton } from "@dramaip/ui-shared";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/timeline";
import type { TimelineMediaCopy } from "@dramaip/contracts/timeline-copy";
import { useStudio } from "../../studio-shared";
import {
  NleCopyController,
  isNleCopyTerminal,
  nleCopyUnavailable,
} from "./nle-copy-controller";

const button = "rounded border border-line px-2 py-1 disabled:opacity-50";
const status: Record<TimelineMediaCopy["status"], string> = {
  "submission-unknown": "提交结果尚未确定",
  queued: "原任务排队中",
  running: "正在复制原媒体",
  completed: "原包复制已完成（记录时间）",
  failed: "原复制失败",
  canceled: "原复制已取消",
  interrupted: "原复制已中断",
  "source-changed": "原来源已变化，未交付",
};
export function NleCopyReceiptView({ job }: { job: TimelineMediaCopy }) {
  return (
    <div
      data-testid="nle-copy-original-job"
      className="space-y-1 break-words rounded border border-line p-2"
    >
      <p>
        原任务 {job.id} · {status[job.status]} · 时间线版本{" "}
        {job.scope.timelineVersion}
      </p>
      <p>原清单 SHA-256 {job.scope.sourceFingerprint}</p>
      <p>
        {job.currentBinding === "unchanged-metadata"
          ? "当前元数据未变；实际文件没有重新读取。"
          : job.currentBinding === "changed-metadata"
            ? "当前元数据已变；仅保留原任务历史，不自动替换来源。"
            : "当前元数据不可核对；不使用缓存补成有效来源。"}
      </p>
      {job.copy && (
        <>
          <p>
            原复制时间 {new Date(job.copy.receipt.verifiedAt).toLocaleString()}{" "}
            · {job.copy.receipt.files.length} 个原文件
          </p>
          <p>原包凭证 SHA-256 {job.copy.receiptSha256}</p>
          <p>
            仅证明记录时间的完整复制和目的字节重读，不证明当前文件持续完整、NLE实际导入、成片质量、授权或费用。
          </p>
        </>
      )}
      {job.failureCode && (
        <p>
          原失败／中断原因 {job.failureCode} · 临时文件状态 {job.scratchState}
          ；没有成功原包回执。
        </p>
      )}
      <p>质量未核验 · 授权未核验 · 费用未知；不是正式 Media Gate 通过。</p>
    </div>
  );
}

/** Keyed by the parent original scope. Reload restores local identity only, never automatically POSTs or polls. */
export function NleMediaCopyPanel({
  manifest,
}: {
  manifest: TimelineDeliveryManifest;
}) {
  const client = useStudio();
  const [controller] = useState(
    () => new NleCopyController(client.timelineMediaCopies, manifest),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    controller.mount();
    return () => controller.dispose();
  }, [controller]);
  const busy = state.phase !== "idle",
    reasons = nleCopyUnavailable(manifest);
  const canStart =
    !busy &&
    !reasons.length &&
    state.acknowledged &&
    !!state.directory?.grant &&
    !state.pending &&
    !state.action &&
    !state.badRequest &&
    !state.badAction;
  return (
    <section
      aria-label="原媒体包本地复制"
      data-testid="nle-media-copy"
      aria-busy={busy}
      className="mt-4 space-y-2 rounded border border-line bg-surface p-3 text-xs"
    >
      <h4 className="font-medium">原媒体包本地复制</h4>
      <p>
        明确选择目录后，复制本清单的原存档媒体和七种 NLE
        文档。它与上面的只读核验／单文件凭证独立，不上传、不自动播放或打开文件夹。
      </p>
      <p>
        现有配置：1080×1920／25fps／48k立体声；原媒体最多1000个、单文件2
        GiB、合计8 GiB。实际复制仍须 Core 核原来源和 Host
        完整字节核对；不截取超限素材。
      </p>
      {reasons.length > 0 && (
        <div role="note" className="text-warning-strong">
          {reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={state.acknowledged}
          disabled={busy || !!state.pending}
          onChange={(event) => controller.acknowledge(event.target.checked)}
        />
        <span>我仅将原媒体包交给本地剪辑；质量、授权与费用仍未核验</span>
      </label>
      {state.directory?.grant && (
        <p>
          本次写目录：{state.directory.grant.displayName}
          ；只用于此原清单，尚不证明复制成功。
        </p>
      )}
      {state.pending && (
        <p data-testid="nle-copy-pending">
          本机绑定原请求 {state.pending.key} · 原时间线版本{" "}
          {state.pending.input.manifest.timeline.version}
          。原输入已在提交前保存；重载不会自动重发或换最新来源。
        </p>
      )}
      {state.action && (
        <p data-testid="nle-copy-pending-action">
          上次{state.action.operation === "cancel" ? "取消" : "刷新"}原动作{" "}
          {state.action.key} 尚需核对；只读恢复不会重发该动作。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <BareButton
          className={button}
          disabled={
            busy ||
            !state.acknowledged ||
            !!state.pending ||
            !!state.action ||
            !!state.badRequest ||
            !!state.badAction ||
            reasons.length > 0
          }
          onClick={() => void controller.chooseDirectory()}
        >
          明确选择本次写目录
        </BareButton>
        <BareButton
          className={`${button} text-brand`}
          disabled={!canStart}
          onClick={() => void controller.create()}
        >
          复制本清单原媒体包
        </BareButton>
        {(state.pending || state.action) && (
          <BareButton
            className={button}
            disabled={busy || !!state.badAction}
            onClick={() => void controller.recover()}
          >
            只读恢复原复制任务
          </BareButton>
        )}
        <BareButton
          className={button}
          disabled={busy}
          onClick={() => void controller.history()}
        >
          读取此时间线原复制历史
        </BareButton>
        {state.cursor && (
          <BareButton
            className={button}
            disabled={busy}
            onClick={() => void controller.history(true)}
          >
            读取更多原复制历史
          </BareButton>
        )}
        {busy && (
          <BareButton className={button} onClick={() => controller.stop()}>
            停止界面等待（不取消复制）
          </BareButton>
        )}
      </div>
      {busy && (
        <p role="status">
          正在执行原任务界面操作：{state.phase}。停止等待不会取消 Host
          已接受的复制；先只读恢复，再明确取消原任务。
        </p>
      )}
      {state.job && (
        <>
          <NleCopyReceiptView job={state.job} />
          <div className="flex flex-wrap gap-2">
            {!isNleCopyTerminal(state.job) && (
              <>
                <BareButton
                  className={button}
                  disabled={!controller.canObserve()}
                  onClick={() => void controller.observe("refresh")}
                >
                  明确刷新原任务结果
                </BareButton>
                <BareButton
                  className={button}
                  disabled={!controller.canObserve()}
                  onClick={() => void controller.observe("cancel")}
                >
                  明确取消原复制任务
                </BareButton>
              </>
            )}
            {state.job.status === "completed" && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => void controller.reveal()}
              >
                展示这个已完成原包
              </BareButton>
            )}
            {controller.canPrepareNew() && (
              <BareButton
                className={button}
                onClick={() => controller.prepareNew()}
              >
                准备新的复制（保留原任务历史）
              </BareButton>
            )}
          </div>
        </>
      )}
      {state.history && (
        <div data-testid="nle-copy-history" className="space-y-2">
          <p>
            本次只读取得 {state.history.length}{" "}
            条原任务历史；这些旧回执不是当前清单或持续字节完整性证明。
          </p>
          {state.history.map((item) => (
            <div key={item.id} className="rounded border border-line p-2">
              <p className="break-words">
                原任务 {item.id} · 时间线版本 {item.scope.timelineVersion} ·{" "}
                {status[item.status]}
              </p>
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => void controller.select(item)}
              >
                重读这条原历史任务
              </BareButton>
            </div>
          ))}
        </div>
      )}
      {(state.badRequest || state.badAction) && state.history && (
        <BareButton
          className={button}
          disabled={busy}
          onClick={() => controller.clearCorruptLocalRecords()}
        >
          已检查历史，仅清除损坏本机记录（不取消或删除任务）
        </BareButton>
      )}
      {state.notice && (
        <p role="alert" className="break-words text-warning-strong">
          {state.notice}
        </p>
      )}
    </section>
  );
}
