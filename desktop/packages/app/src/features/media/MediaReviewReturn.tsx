import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { BareButton } from "@dramaip/ui-shared";
import { useStudio, message } from "../../studio-shared";
import { readMediaReviewReturn } from "./media-review-return";
import { MediaSourceReviewPanel } from "./MediaSourceReviewPanel";
import { AudioRevisionPanel } from "./AudioRevisionPanel";
import { AudioResolutionPanel } from "./AudioResolutionPanel";

export function MediaReviewReturn() {
  const client = useStudio();
  const cache = useQueryClient();
  const { search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const query = useQuery({
    queryKey: ["media-review-return", search],
    queryFn: () => readMediaReviewReturn(client, search),
    refetchInterval: 5000,
    retry: false,
  });
  // Do not show formerly valid cached private details after identity/read failure.
  const value = query.error ? undefined : query.data;
  const adopt = async () => {
    if (
      value?.kind !== "revision" ||
      !value.target ||
      value.target.status !== "draft" ||
      value.review.state !== "confirmed" ||
      !value.review.isCurrent ||
      value.review.sourceState !== "current"
    )
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      const identity = `${value.target.id}:${value.target.version}`;
      let key = keys.current.get(identity);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(identity, key);
      }
      await client.episodeMedia.adoptAudioTrack(
        value.target.id,
        value.target.version,
        key,
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["media-review-return"] }),
        cache.invalidateQueries({ queryKey: ["audio-revision"] }),
        cache.invalidateQueries({ queryKey: ["audio-tracks"] }),
        cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
      ]);
      setNotice(
        "已另行采用这个实际新草稿；旧轨、素材与时间线未改动，换源仍是独立决策。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 p-4" aria-label="对应媒体待确认对象">
      <h1 className="text-xl font-semibold">媒体待确认对象</h1>
      <p className="text-sm text-muted">
        只返回指定身份的实际记录。打开不确认、不采用、不调用模型、不初始化时间线；审阅声明每次重新勾选。
      </p>
      <Link className="text-brand underline" to="/pending">
        返回待确认中心
      </Link>
      {query.isLoading && <p>正在核对指定项目与对象……</p>}
      {query.error && <p role="alert">{message(query.error)}</p>}
      {value && (
        <p className="break-words text-sm">
          指定记录 {value.review.id} · 状态版本 v{value.review.stateVersion}
        </p>
      )}
      {value?.kind === "source" && (
        <MediaSourceReviewPanel
          key={value.review.id}
          kind="media-records"
          recordId={value.review.recordId}
          shotId={value.review.shotId}
          requestedReviewId={value.review.id}
        />
      )}
      {value?.kind === "revision" && (
        <>
          <AudioRevisionPanel
            key={value.review.id}
            track={value.track}
            requestedReviewId={value.review.id}
          />
          {value.review.state === "confirmed" && (
            <div className="space-y-2 rounded border border-line p-3">
              <p>
                差异确认只创建新草稿。实际新轨 {value.target?.id ?? "不可用"} ·
                v{value.target?.version ?? "未核验"} ·{" "}
                {value.target?.status ?? "缺失"}；采用不修改旧轨或时间线。
              </p>
              <BareButton
                className="rounded border border-line px-3 py-2 disabled:opacity-50"
                disabled={
                  busy ||
                  !value.review.isCurrent ||
                  value.review.sourceState !== "current" ||
                  value.target?.status !== "draft"
                }
                onClick={() => void adopt()}
              >
                另行采用此新草稿
              </BareButton>
              {(!value.review.isCurrent ||
                value.review.sourceState !== "current") && (
                <p className="text-warning-strong">
                  实际确认头或来源已变化，不能沿用旧确认采用这个草稿。
                </p>
              )}
            </div>
          )}
        </>
      )}
      {value?.kind === "resolution" && (
        <AudioResolutionPanel
          key={value.review.id}
          timeline={value.review.before}
          requestedReviewId={value.review.id}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
