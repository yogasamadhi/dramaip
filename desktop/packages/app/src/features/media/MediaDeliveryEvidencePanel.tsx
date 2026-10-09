import { useEffect, useRef, useState } from "react";
import type { MediaDeliveryEvidence } from "@dramaip/contracts/media";
import { BareButton } from "@dramaip/ui-shared";
import { message, useStudio } from "../../studio-shared";
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
    <div
      className="space-y-1 break-all"
      data-testid="media-delivery-evidence-result"
    >
      <p>
        原素材 {value.recordId} · v{value.recordVersion}
        ；只读元数据，不是整包交付验收。
      </p>
      <p>
        内容质量未核验 · 合法授权未核验 · 实际结算未知 ·
        当前文件未读取；不能据此放行发行。
      </p>
      <p>
        实际来源：{sourceLabel[value.source.state]}；可编辑权利声明：
        {declarationLabel[value.declarations.rightsDeclaration]}；费用声明：
        {declarationLabel[value.declarations.costDeclaration]}；服务声明：
        {declarationLabel[value.declarations.providerDeclaration]}。
      </p>
      {value.archive ? (
        <p>
          原素材存档 {value.archive.artifactId} · {value.archive.sizeBytes} 字节
          · SHA {value.archive.sha256}（不是本次字节验证）
        </p>
      ) : (
        <p>
          没有当前精确版本的单一有效素材 存档，不使用内嵌预览或可编辑路径替代。
        </p>
      )}
      {value.latestByteRead ? (
        <p>
          最近原版本完整读取凭证 {value.latestByteRead.id} ·{" "}
          {value.latestByteRead.verifiedAt} · SHA{" "}
          {value.latestByteRead.descriptor.sha256} ·{" "}
          {bindingLabel[value.latestByteRead.currentArchiveBinding]}
          ；只证明记录时间，不证明现在完整、可解码或已审阅。
        </p>
      ) : (
        <p>没有已记录的原版本完整读取凭证；不把加载成功或任务成功补成凭证。</p>
      )}
      {value.blockers.length ? (
        <p role="alert">
          已知阻断：
          {value.blockers
            .map((code) => `${blockerLabel[code]}（${code}）`)
            .join(" · ")}
        </p>
      ) : (
        <p>本次元数据没有已知负面标记；未知项仍未通过，不等于可交付。</p>
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
      className="space-y-2 rounded border border-line p-2 text-xs"
      data-testid={`media-delivery-evidence-${props.recordId}`}
    >
      <p>原素材交付证据（只读）；不会读文件、写声明、调用模型或授权费用。</p>
      <BareButton
        className="rounded border border-line px-3 py-2 disabled:opacity-50"
        disabled={busy}
        onClick={() => void read()}
      >
        核对原素材交付证据
      </BareButton>
      {busy && (
        <BareButton
          className="ml-2 rounded border border-line px-3 py-2"
          onClick={stop}
        >
          停止证据读取
        </BareButton>
      )}
      {!value && !busy && !error && <p>尚未核对，不显示旧缓存或自动读取。</p>}
      {busy && <p>正在读取指定原版本；旧证据已隐藏。</p>}
      {value && <MediaDeliveryEvidenceView value={value} />}
      {error && (
        <p role="alert">原证据未核全：{error}；不展示旧结果或换最新版本。</p>
      )}
    </section>
  );
}
