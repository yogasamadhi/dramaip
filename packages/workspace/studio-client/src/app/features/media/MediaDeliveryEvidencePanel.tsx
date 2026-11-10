import { useEffect, useRef, useState } from "react";
import type { MediaDeliveryEvidence } from "@dramaip/contracts/media";
import { BareButton } from "@dramaip/infra-ui-primitives";
import { message, useStudio } from "../../studio-shared";
import styles from "./MediaDeliveryEvidencePanel.module.css";
import { copyText } from "../../copy";
const sourceLabel = {
  current: "原记录版本一致",
  stale: "原来源已变化",
  unverified: "原来源未核验",
  unbound: "没有来源绑定",
};
const declarationLabel = {
  "user-reported-cleared": "用户声明已核验（不是授权凭证）",
  "user-reported-restricted": "用户声明受限／撤回／过期",
  "user-reported-known": "用户声明已知（不是结算回执）",
  "user-reported-available": "用户声明可用（不是能力核验）",
  "user-reported-unavailable": "用户声明不可用",
  "user-reported-not-required": "用户声明无需服务",
  "not-provided": "未提供声明",
};
const bindingLabel = {
  "matching-archive-metadata": "与当前存档元数据一致（未重读字节）",
  "changed-archive-metadata": "当前存档元数据已变化（不沿用原字节证明）",
  "not-rechecked": "没有核对当前存档字节",
};
const blockerLabel = {
  DECLARED_RIGHTS_RESTRICTED: "用户声明权利受限、撤回或过期",
  DECLARED_PROVIDER_UNAVAILABLE: "用户声明服务不可用",
  SOURCE_STALE: "原来源已变化",
  SOURCE_UNVERIFIED: "原来源尚未核验",
  ARCHIVE_UNAVAILABLE: "缺少指定版本的单一有效存档",
};

export function MediaDeliveryEvidenceView({
  value,
}: {
  value: MediaDeliveryEvidence;
}) {
  return (
    <div className={styles.c1} data-testid="media-delivery-evidence-result">
      <p>
        {copyText("app/features/media/MediaDeliveryEvidencePanel.1")}
        {value.recordId}
        {copyText("app/features/media/MediaDeliveryEvidencePanel.2")}
        {value.recordVersion}
        {copyText("app/features/media/MediaDeliveryEvidencePanel.3")}
      </p>
      <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.4")}</p>
      <p>
        {copyText("app/features/media/MediaDeliveryEvidencePanel.5")}
        {sourceLabel[value.source.state]}
        {copyText("app/features/media/MediaDeliveryEvidencePanel.6")}
        {declarationLabel[value.declarations.rightsDeclaration]}
        {copyText("app/features/media/MediaDeliveryEvidencePanel.7")}
        {declarationLabel[value.declarations.costDeclaration]}
        {copyText("app/features/media/MediaDeliveryEvidencePanel.8")}
        {declarationLabel[value.declarations.providerDeclaration]}。
      </p>
      {value.archive ? (
        <p>
          {copyText("app/features/media/MediaDeliveryEvidencePanel.9")}
          {value.archive.artifactId} · {value.archive.sizeBytes}
          {copyText("app/features/media/MediaDeliveryEvidencePanel.10")}
          {value.archive.sha256}
          {copyText("app/features/media/MediaDeliveryEvidencePanel.11")}
        </p>
      ) : (
        <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.12")}</p>
      )}
      {value.latestByteRead ? (
        <p>
          {copyText("app/features/media/MediaDeliveryEvidencePanel.13")}
          {value.latestByteRead.id} · {value.latestByteRead.verifiedAt}
          {copyText("app/features/media/MediaDeliveryEvidencePanel.14")}{" "}
          {value.latestByteRead.descriptor.sha256} ·{" "}
          {bindingLabel[value.latestByteRead.currentArchiveBinding]}
          {copyText("app/features/media/MediaDeliveryEvidencePanel.15")}
        </p>
      ) : (
        <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.16")}</p>
      )}
      {value.blockers.length ? (
        <p role="alert">
          {copyText("app/features/media/MediaDeliveryEvidencePanel.17")}
          {value.blockers
            .map((code) => `${blockerLabel[code]}（${code}）`)
            .join(" · ")}
        </p>
      ) : (
        <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.18")}</p>
      )}
    </div>
  );
}
export function MediaDeliveryEvidencePanel(props: {
  recordId: string;
  projectId: string;
  version: number;
}) {
  return (
    <Body
      key={JSON.stringify([props.recordId, props.projectId, props.version])}
      {...props}
    />
  );
}
function Body(props: { recordId: string; projectId: string; version: number }) {
  const client = useStudio(),
    active = useRef<AbortController | undefined>(undefined);
  const [value, setValue] = useState<MediaDeliveryEvidence>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = undefined;
    },
    [],
  );
  const stop = () => {
    active.current?.abort();
    active.current = undefined;
    setBusy(false);
    setValue(undefined);
    setError(undefined);
  };
  const read = async () => {
    if (active.current) return;
    const abort = new AbortController();
    active.current = abort;
    setValue(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const result = await client.mediaPlayback.deliveryEvidence(
        props.recordId,
        props.projectId,
        props.version,
        abort.signal,
      );
      if (active.current === abort && !abort.signal.aborted) setValue(result);
    } catch (cause) {
      if (active.current === abort && !abort.signal.aborted)
        setError(message(cause));
    } finally {
      if (active.current === abort) {
        active.current = undefined;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className={styles.c2}
      data-testid={`media-delivery-evidence-${props.recordId}`}
    >
      <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.19")}</p>
      <BareButton
        className={styles.c3}
        disabled={busy}
        onClick={() => void read()}
      >
        {copyText("app/features/media/MediaDeliveryEvidencePanel.20")}
      </BareButton>
      {busy && (
        <BareButton className={styles.c4} onClick={stop}>
          {copyText("app/features/media/MediaDeliveryEvidencePanel.21")}
        </BareButton>
      )}
      {!value && !busy && !error && (
        <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.22")}</p>
      )}
      {busy && (
        <p>{copyText("app/features/media/MediaDeliveryEvidencePanel.23")}</p>
      )}
      {value && <MediaDeliveryEvidenceView value={value} />}
      {error && (
        <p role="alert">
          {copyText("app/features/media/MediaDeliveryEvidencePanel.24")}
          {error}
          {copyText("app/features/media/MediaDeliveryEvidencePanel.25")}
        </p>
      )}
    </section>
  );
}
