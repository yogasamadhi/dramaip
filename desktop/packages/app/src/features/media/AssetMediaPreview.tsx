import { useEffect, useRef, useState } from "react";
import type { AssetCenterAsset } from "@dramaip/contracts/media";
import { BareButton } from "@dramaip/ui-shared";
import { readAssetPreviewRecord } from "../../asset-preview-record";
import { message, useStudio } from "../../studio-shared";
import { MediaPlaybackPanel } from "./MediaPlaybackPanel";
import { MediaDeliveryEvidencePanel } from "./MediaDeliveryEvidencePanel";

/** The parent keys this component by project and asset; leaving invalidates late reads. */
export function AssetMediaPreview(props: {
  asset: AssetCenterAsset;
  projectId: string;
}) {
  const client = useStudio();
  const active = useRef<AbortController | undefined>(undefined);
  const [record, setRecord] = useState<{
    projectId: string;
    version: number;
  }>();
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => () => active.current?.abort(), []);
  const recheck = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    // Unmount the old player before awaiting anything: even same-version checks release it.
    setRecord(undefined);
    setOpened(true);
    setChecking(true);
    setError(undefined);
    try {
      const current = await readAssetPreviewRecord(
        client,
        props.asset.id,
        props.projectId,
        controller.signal,
      );
      if (
        current &&
        active.current === controller &&
        !controller.signal.aborted
      )
        setRecord(current);
    } catch (cause) {
      if (active.current === controller && !controller.signal.aborted)
        setError(message(cause));
    } finally {
      if (active.current === controller && !controller.signal.aborted)
        setChecking(false);
    }
  };
  return (
    <div className="mt-3 rounded-xl bg-canvas p-3 text-sm">
      <p className="font-medium">
        {props.asset.preview.kind === "audio" ? "音频预览" : "视觉预览"}
      </p>
      {record ? (
        <>
          <MediaDeliveryEvidencePanel
            recordId={props.asset.id}
            projectId={record.projectId}
            version={record.version}
          />
          <MediaPlaybackPanel
            recordId={props.asset.id}
            projectId={record.projectId}
            version={record.version}
          />
        </>
      ) : (
        <p className="mt-1 text-muted">
          {checking
            ? "正在重新读取实际记录；旧媒体已释放。"
            : opened
              ? "未载入媒体；核对成功后仍需明确加载实际文件。"
              : props.asset.preview.status === "available"
                ? `本地归档可用：${props.asset.preview.label ?? "已附加媒体"}`
                : props.asset.preview.status === "missing"
                  ? "本地归档文件缺失；不会伪造预览。"
                  : (props.asset.preview.label ??
                    "尚未附加本地媒体；可先保留为文字候选。")}
        </p>
      )}
      <BareButton
        className="mt-2 rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
        disabled={checking}
        onClick={() => void recheck()}
      >
        {checking
          ? "核对实际记录中…"
          : opened
            ? "重新核对本地记录"
            : "打开本地预览"}
      </BareButton>
      {opened && (
        <p className="mt-1 text-xs text-muted">
          重新核对会释放旧文件，明确读取当前实际版本；不自动加载、播放、采用或确认，也不改变冻结音轨的来源。
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-warning-strong">
          {error}
        </p>
      )}
    </div>
  );
}
