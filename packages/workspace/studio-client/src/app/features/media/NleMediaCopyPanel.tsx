import { useEffect, useState, useSyncExternalStore } from "react";
import { BareButton } from "@dramaip/infra-ui-primitives";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/timeline";
import type { TimelineMediaCopy } from "@dramaip/contracts/timeline-copy";
import { useStudio } from "../../studio-shared";
import {
  NleCopyController,
  isNleCopyTerminal,
  nleCopyUnavailable,
} from "./nle-copy-controller";
import styles from "./NleMediaCopyPanel.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

const button = styles.c1;
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
    <div data-testid="nle-copy-original-job" className={styles.c2}>
      <p>
        {copyText("app/features/media/NleMediaCopyPanel.1")}
        {job.id} · {status[job.status]}
        {copyText("app/features/media/NleMediaCopyPanel.2")}{" "}
        {job.scope.timelineVersion}
      </p>
      <p>
        {copyText("app/features/media/NleMediaCopyPanel.3")}
        {job.scope.sourceFingerprint}
      </p>
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
            {copyText("app/features/media/NleMediaCopyPanel.4")}
            {new Date(job.copy.receipt.verifiedAt).toLocaleString()} ·{" "}
            {job.copy.receipt.files.length}
            {copyText("app/features/media/NleMediaCopyPanel.5")}
          </p>
          <p>
            {copyText("app/features/media/NleMediaCopyPanel.6")}
            {job.copy.receiptSha256}
          </p>
          <p>{copyText("app/features/media/NleMediaCopyPanel.7")}</p>
        </>
      )}
      {job.failureCode && (
        <p>
          {copyText("app/features/media/NleMediaCopyPanel.8")}
          {job.failureCode}
          {copyText("app/features/media/NleMediaCopyPanel.9")}
          {job.scratchState}
          {copyText("app/features/media/NleMediaCopyPanel.10")}
        </p>
      )}
      <p>{copyText("app/features/media/NleMediaCopyPanel.11")}</p>
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
      aria-label={copyText("app/features/media/NleMediaCopyPanel.12")}
      data-testid="nle-media-copy"
      aria-busy={busy}
      className={styles.c3}
    >
      <h4 className={styles.c4}>
        {copyText("app/features/media/NleMediaCopyPanel.12")}
      </h4>
      <p>{copyText("app/features/media/NleMediaCopyPanel.13")}</p>
      <p>{copyText("app/features/media/NleMediaCopyPanel.14")}</p>
      {reasons.length > 0 && (
        <div role="note" className={styles.c5}>
          {reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      <label className={styles.c6}>
        <input
          type="checkbox"
          checked={state.acknowledged}
          disabled={busy || !!state.pending}
          onChange={(event) => controller.acknowledge(event.target.checked)}
        />
        <span>{copyText("app/features/media/NleMediaCopyPanel.15")}</span>
      </label>
      {state.directory?.grant && (
        <p>
          {copyText("app/features/media/NleMediaCopyPanel.16")}
          {state.directory.grant.displayName}
          {copyText("app/features/media/NleMediaCopyPanel.17")}
        </p>
      )}
      {state.pending && (
        <p data-testid="nle-copy-pending">
          {copyText("app/features/media/NleMediaCopyPanel.18")}
          {state.pending.key}
          {copyText("app/features/media/NleMediaCopyPanel.19")}{" "}
          {state.pending.input.manifest.timeline.version}
          {copyText("app/features/media/NleMediaCopyPanel.20")}
        </p>
      )}
      {state.action && (
        <p data-testid="nle-copy-pending-action">
          {copyText("app/features/media/NleMediaCopyPanel.21")}
          {state.action.operation === "cancel" ? "取消" : "刷新"}
          {copyText("app/features/media/NleMediaCopyPanel.22")}{" "}
          {state.action.key}
          {copyText("app/features/media/NleMediaCopyPanel.23")}
        </p>
      )}
      <div className={styles.c7}>
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
          {copyText("app/features/media/NleMediaCopyPanel.24")}
        </BareButton>
        <BareButton
          className={clsx(button, styles.c8)}
          disabled={!canStart}
          onClick={() => void controller.create()}
        >
          {copyText("app/features/media/NleMediaCopyPanel.25")}
        </BareButton>
        {(state.pending || state.action) && (
          <BareButton
            className={button}
            disabled={busy || !!state.badAction}
            onClick={() => void controller.recover()}
          >
            {copyText("app/features/media/NleMediaCopyPanel.26")}
          </BareButton>
        )}
        <BareButton
          className={button}
          disabled={busy}
          onClick={() => void controller.history()}
        >
          {copyText("app/features/media/NleMediaCopyPanel.27")}
        </BareButton>
        {state.cursor && (
          <BareButton
            className={button}
            disabled={busy}
            onClick={() => void controller.history(true)}
          >
            {copyText("app/features/media/NleMediaCopyPanel.28")}
          </BareButton>
        )}
        {busy && (
          <BareButton className={button} onClick={() => controller.stop()}>
            {copyText("app/features/media/NleMediaCopyPanel.29")}
          </BareButton>
        )}
      </div>
      {busy && (
        <p role="status">
          {copyText("app/features/media/NleMediaCopyPanel.30")}
          {state.phase}
          {copyText("app/features/media/NleMediaCopyPanel.31")}
        </p>
      )}
      {state.job && (
        <>
          <NleCopyReceiptView job={state.job} />
          <div className={styles.c7}>
            {!isNleCopyTerminal(state.job) && (
              <>
                <BareButton
                  className={button}
                  disabled={!controller.canObserve()}
                  onClick={() => void controller.observe("refresh")}
                >
                  {copyText("app/features/media/NleMediaCopyPanel.32")}
                </BareButton>
                <BareButton
                  className={button}
                  disabled={!controller.canObserve()}
                  onClick={() => void controller.observe("cancel")}
                >
                  {copyText("app/features/media/NleMediaCopyPanel.33")}
                </BareButton>
              </>
            )}
            {state.job.status === "completed" && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => void controller.reveal()}
              >
                {copyText("app/features/media/NleMediaCopyPanel.34")}
              </BareButton>
            )}
            {controller.canPrepareNew() && (
              <BareButton
                className={button}
                onClick={() => controller.prepareNew()}
              >
                {copyText("app/features/media/NleMediaCopyPanel.35")}
              </BareButton>
            )}
          </div>
        </>
      )}
      {state.history && (
        <div data-testid="nle-copy-history" className={styles.c9}>
          <p>
            {copyText("app/features/media/NleMediaCopyPanel.36")}
            {state.history.length}{" "}
            {copyText("app/features/media/NleMediaCopyPanel.37")}
          </p>
          {state.history.map((item) => (
            <div key={item.id} className={styles.c10}>
              <p className={styles.c11}>
                {copyText("app/features/media/NleMediaCopyPanel.1")}
                {item.id}
                {copyText("app/features/media/NleMediaCopyPanel.38")}
                {item.scope.timelineVersion} · {status[item.status]}
              </p>
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => void controller.select(item)}
              >
                {copyText("app/features/media/NleMediaCopyPanel.39")}
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
          {copyText("app/features/media/NleMediaCopyPanel.40")}
        </BareButton>
      )}
      {state.notice && (
        <p role="alert" className={styles.c12}>
          {state.notice}
        </p>
      )}
    </section>
  );
}
