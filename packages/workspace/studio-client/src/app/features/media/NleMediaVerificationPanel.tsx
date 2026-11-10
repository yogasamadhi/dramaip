import { useEffect, useRef, useState } from "react";
import { BareButton } from "@dramaip/infra-ui-primitives";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/product";
import { TimelineDeliveryManifestSchema } from "@dramaip/contracts/timeline";
import {
  verifyNleDeliveryMedia,
  type NleMediaVerification,
} from "../../nle-media-verification";
import { useStudio } from "../../studio-shared";
import { MediaByteReceipts } from "./MediaByteReceipts";
import { NleMediaCopyPanel } from "./NleMediaCopyPanel";
import styles from "./NleMediaVerificationPanel.module.css";
import { copyText } from "../../copy";

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
      <p className={styles.c1}>
        {copyText("app/features/media/NleMediaVerificationPanel.1")}
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
    <div className={styles.c2} data-testid="nle-media-verification">
      <p className={styles.c3}>
        {copyText("app/features/media/NleMediaVerificationPanel.2")}
      </p>
      <div className={styles.c4}>
        <BareButton
          className={styles.c5}
          disabled={working || manifest.media.length === 0}
          onClick={() => void start()}
        >
          {copyText("app/features/media/NleMediaVerificationPanel.3")}
        </BareButton>
        {working && (
          <BareButton className={styles.c6} onClick={stop}>
            {copyText("app/features/media/NleMediaVerificationPanel.4")}
          </BareButton>
        )}
      </div>
      {working && (
        <p role="status">
          {copyText("app/features/media/NleMediaVerificationPanel.5")}
          {done}／{manifest.media.length}
        </p>
      )}
      {results && (
        <div data-testid="nle-media-verification-result">
          <p>
            {copyText("app/features/media/NleMediaVerificationPanel.6")}{" "}
            {results.filter((item) => item.status === "verified").length}／
            {manifest.media.length}
            {copyText("app/features/media/NleMediaVerificationPanel.7")}
          </p>
          {results.map((item) => (
            <p
              key={item.assetId}
              className={item.status === "verified" ? styles.c3 : styles.c1}
            >
              {item.assetId}：{item.message}
            </p>
          ))}
        </div>
      )}
      {notice && (
        <p role="alert" className={styles.c1}>
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
