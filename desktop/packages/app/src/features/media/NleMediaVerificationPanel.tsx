import { useEffect, useRef, useState } from "react";
import { BareButton } from "@dramaip/ui-shared";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/product";
import { TimelineDeliveryManifestSchema } from "@dramaip/contracts/timeline";
import {
  verifyNleDeliveryMedia,
  type NleMediaVerification,
} from "../../nle-media-verification";
import { useStudio } from "../../studio-shared";
import { MediaByteReceipts } from "./MediaByteReceipts";
import { NleMediaCopyPanel } from "./NleMediaCopyPanel";

export function NleMediaVerificationPanel(props: {
  manifest: TimelineDeliveryManifest;
  projectId: string;
  episodeId: string;
  timelineId: string;
  timelineVersion: number;
}) {
  const manifest = props.manifest;
  if (
    manifest.timeline.projectId !== props.projectId ||
    manifest.timeline.episodeId !== props.episodeId ||
    manifest.timeline.id !== props.timelineId ||
    manifest.timeline.version !== props.timelineVersion
  )
    return (
      <p className="text-warning-strong">
        交付清单尚未对应当前时间线；不能沿旧清单核验。
      </p>
    );
  return (
    <Verification
      key={`${props.projectId}:${props.episodeId}:${props.timelineId}:${props.timelineVersion}:${manifest.sourceFingerprint}`}
      manifest={manifest}
    />
  );
}
function Verification({ manifest }: { manifest: TimelineDeliveryManifest }) {
  const client = useStudio();
  const lease = useRef<AbortController | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<NleMediaVerification[]>();
  const [notice, setNotice] = useState<string>();
  useEffect(
    () => () => {
      lease.current?.abort();
      lease.current = undefined;
    },
    [],
  );
  const start = async () => {
    if (lease.current) return;
    const controller = new AbortController();
    lease.current = controller;
    setWorking(true);
    setResults(undefined);
    setNotice(undefined);
    setDone(0);
    try {
      const output = await verifyNleDeliveryMedia(
        TimelineDeliveryManifestSchema.parse(manifest),
        client,
        controller.signal,
        (count) => {
          if (lease.current === controller && !controller.signal.aborted)
            setDone(count);
        },
      );
      if (lease.current === controller && !controller.signal.aborted)
        setResults(output);
    } catch (cause) {
      if (lease.current === controller && !controller.signal.aborted)
        setNotice(
          cause instanceof Error
            ? cause.message
            : "本次核验未完成；请重新读取实际清单。",
        );
    } finally {
      if (lease.current === controller) {
        lease.current = undefined;
        setWorking(false);
      }
    }
  };
  const stop = () => {
    lease.current?.abort();
    lease.current = undefined;
    setWorking(false);
    setResults(undefined);
    setNotice("本次核验已停止，没有保存部分通过结论。");
  };
  return (
    <div
      className="mt-3 space-y-2 text-xs"
      data-testid="nle-media-verification"
    >
      <p className="text-muted">
        明确点击后只读核验清单媒体的完整字节：最多 50 个文件、合计 256
        MiB、单文件 128
        MiB。不复制、上传或自动播放；结果只属于本次来源快照，不保存授权／费用结论。
      </p>
      <div className="flex gap-2">
        <BareButton
          className="rounded-md border border-line px-2 py-1 text-brand disabled:opacity-50"
          disabled={working || manifest.media.length === 0}
          onClick={() => void start()}
        >
          核验清单媒体完整字节
        </BareButton>
        {working && (
          <BareButton
            className="rounded-md border border-line px-2 py-1"
            onClick={stop}
          >
            停止核验
          </BareButton>
        )}
      </div>
      {working && (
        <p role="status">
          正在只读核验 {done}／{manifest.media.length}
        </p>
      )}
      {results && (
        <div data-testid="nle-media-verification-result">
          <p>
            本次完整字节核验{" "}
            {results.filter((item) => item.status === "verified").length}／
            {manifest.media.length}；不是 NLE 媒体包或质量／授权通过。
          </p>
          {results.map((item) => (
            <p
              key={item.assetId}
              className={
                item.status === "verified"
                  ? "text-muted"
                  : "text-warning-strong"
              }
            >
              {item.assetId}：{item.message}
            </p>
          ))}
        </div>
      )}
      {notice && (
        <p role="alert" className="text-warning-strong">
          {notice}
        </p>
      )}
      {manifest.media
        .filter(
          (item) =>
            item.archive &&
            item.sourceStatus === "current" &&
            item.sourceVersion !== undefined,
        )
        .map((item) => (
          <MediaByteReceipts
            key={`${item.assetId}:${item.sourceVersion}:${item.archive!.artifactRef}:${item.archive!.sha256}`}
            descriptor={{
              recordId: item.assetId,
              projectId: manifest.timeline.projectId,
              recordVersion: item.sourceVersion!,
              kind: item.archive!.kind,
              mimeType: item.archive!.mimeType,
              sizeBytes: item.archive!.sizeBytes,
              sha256: item.archive!.sha256,
              origin: "managed-archive",
              artifactRef: item.archive!.artifactRef,
              verification: "owner-metadata-only",
            }}
          />
        ))}
      <NleMediaCopyPanel manifest={manifest} />
    </div>
  );
}
