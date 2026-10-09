import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaSourceReview } from "@dramaip/contracts/media";
import { BareButton } from "@dramaip/ui-shared";
import { message, useStudio } from "../../studio-shared";
import { MediaPlaybackPanel } from "./MediaPlaybackPanel";

/** Viewing never adopts, clears a stale flag, or starts paid generation. */
export function MediaSourceReviewPanel(props: {
  recordId: string;
  kind: "shot-stills" | "video" | "assets" | "media-records";
  shotId: string;
  requestedReviewId?: string;
  adopted?: boolean;
  adoptLabel?: string;
  onAdopt?: () => Promise<void>;
}) {
  const client = useStudio();
  const cache = useQueryClient();
  const [opened, setOpened] = useState(Boolean(props.requestedReviewId));
  const [selectedId, setSelectedId] = useState<string | undefined>(
    props.requestedReviewId,
  );
  const [reviewed, setReviewed] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retryKey, setRetryKey] = useState<{
    action: string;
    hash: string;
    key: string;
  }>();
  const keyFor = (action: string, input: unknown) => {
    const hash = JSON.stringify(input);
    if (retryKey?.action === action && retryKey.hash === hash)
      return retryKey.key;
    const key = crypto.randomUUID();
    setRetryKey({ action, hash, key });
    return key;
  };
  const source = useQuery({
    queryKey: ["media-source", props.recordId],
    queryFn: () => client.mediaSources.status(props.recordId),
    refetchInterval: 5000,
  });
  const record = useQuery({
    queryKey: ["media-review-record", props.kind, props.recordId],
    enabled: opened,
    queryFn: () =>
      props.kind === "media-records"
        ? client.mediaSources.record(props.recordId)
        : client.resources.get(props.kind, props.recordId),
    refetchInterval: 5000,
  });
  const shot = useQuery({
    queryKey: ["media-review-shot", props.shotId],
    enabled: opened,
    queryFn: () => client.resources.get("shots", props.shotId),
    refetchInterval: 5000,
  });
  const history = useQuery({
    queryKey: ["media-source-reviews", props.recordId],
    enabled: opened,
    queryFn: async () => {
      const items: MediaSourceReview[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.mediaSources.list(
          props.recordId,
          cursor,
          100,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("复核历史游标重复，未读取完整历史。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const selected = useQuery({
    queryKey: ["media-source-review", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => client.mediaSources.get(selectedId!),
    refetchInterval: 5000,
  });
  useEffect(() => {
    setReviewed([false, false, false]);
  }, [selectedId, selected.data?.stateVersion, selected.data?.sourceState]);
  useEffect(() => {
    if (props.requestedReviewId) {
      setOpened(true);
      setSelectedId(props.requestedReviewId);
      setReviewed([false, false, false]);
    }
  }, [props.requestedReviewId]);
  useEffect(() => {
    if (opened && !selectedId && !props.requestedReviewId)
      setSelectedId(history.data?.find((item) => item.state === "pending")?.id);
  }, [opened, selectedId, history.data, props.requestedReviewId]);
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["media-source"] }),
      cache.invalidateQueries({
        queryKey: ["media-source-reviews", props.recordId],
      }),
      cache.invalidateQueries({ queryKey: ["media-source-review"] }),
      cache.invalidateQueries({ queryKey: ["media-review-record"] }),
      cache.invalidateQueries({ queryKey: ["resource"] }),
      cache.invalidateQueries({ queryKey: ["video-generation"] }),
      cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
    ]);
  };
  const create = async () => {
    if (!record.data || !shot.data) return;
    const input = {
      recordVersion: record.data.version,
      shotId: shot.data.id,
      shotVersion: shot.data.version,
    };
    setBusy(true);
    setError(undefined);
    try {
      const value = await client.mediaSources.preview(
        props.recordId,
        input,
        keyFor("preview", input),
      );
      setSelectedId(value.id);
      setReviewed([false, false, false]);
      setRetryKey(undefined);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const transition = async (action: "adopt" | "discard") => {
    const value = selected.data;
    if (
      !value ||
      value.recordId !== props.recordId ||
      value.shotId !== props.shotId
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const key = keyFor(action, [value.id, value.stateVersion]);
      if (action === "adopt")
        await client.mediaSources.adopt(
          value.id,
          value.stateVersion,
          {
            mediaReviewed: true,
            shotMappingReviewed: true,
            authorIntentReviewed: true,
          },
          key,
        );
      else await client.mediaSources.discard(value.id, value.stateVersion, key);
      setReviewed([false, false, false]);
      setRetryKey(undefined);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const value =
    selected.data?.recordId === props.recordId &&
    selected.data.shotId === props.shotId
      ? selected.data
      : undefined;
  const exact = Boolean(
    value &&
    record.data?.version === value.recordVersion &&
    shot.data?.id === value.shotId &&
    shot.data.version === value.shotVersion,
  );
  const label =
    source.data?.state === "current"
      ? "来源版本一致（机械核对）"
      : source.data?.state === "stale"
        ? "旧素材待复核"
        : source.data?.state === "unverified"
          ? "历史来源未核验"
          : source.data?.state === "unbound"
            ? "未绑定镜头"
            : "核对来源中…";
  return (
    <section
      className="w-full space-y-2 text-xs"
      data-testid={`media-source-${props.recordId}`}
    >
      <p
        className={
          source.data?.state === "current" ? "text-muted" : "text-amber-700"
        }
      >
        {label}
        {props.adopted && source.data?.state !== "current"
          ? " · 原采用记录已失效"
          : ""}
      </p>
      {source.data?.reasons.map((reason, index) => (
        <p key={index} className="text-amber-700">
          {reason}
        </p>
      ))}
      {source.error && <p role="alert">{message(source.error)}</p>}
      <div className="flex flex-wrap gap-2">
        {props.onAdopt &&
          (!props.adopted || source.data?.state !== "current") && (
            <BareButton
              disabled={busy || source.data?.state !== "current"}
              className="rounded border border-brand px-2 py-1 text-brand disabled:opacity-50"
              onClick={() => void props.onAdopt?.()}
            >
              {props.adoptLabel ?? "采用素材"}
            </BareButton>
          )}
        <BareButton
          className="rounded border border-line px-2 py-1"
          onClick={() => setOpened(!opened)}
        >
          {opened ? "收起来源复核" : "查看并复核来源"}
        </BareButton>
        <BareButton
          className="rounded border border-line px-2 py-1"
          onClick={() => void source.refetch()}
        >
          刷新来源状态
        </BareButton>
      </div>
      {opened && (
        <div
          className="space-y-3 rounded border border-line p-3"
          data-testid="media-source-review-panel"
        >
          <p>
            复核只追加来源绑定，不代替质量、作者意图、权利、费用或正式分镜采用；不会生成媒体，也不会自动采用素材。
          </p>
          <p>
            素材版本 {record.data?.version ?? "…"} · 当前镜头版本{" "}
            {shot.data?.version ?? "…"} · 原绑定镜头版本{" "}
            {source.data?.binding?.shotVersion ?? "未核验"}
          </p>
          {record.data &&
          !record.error &&
          !shot.error &&
          !selected.error &&
          typeof record.data.projectId === "string" &&
          shot.data?.projectId === record.data.projectId &&
          (!selectedId || value) ? (
            <MediaPlaybackPanel
              recordId={props.recordId}
              projectId={record.data.projectId}
              version={value?.recordVersion ?? record.data.version}
            />
          ) : (
            <p className="text-amber-700">
              实际身份或冻结版本尚未核对，不能读取其他对象替代原媒体；元数据不代替实际素材审阅。
            </p>
          )}
          {shot.data && (
            <div className="space-y-1 rounded bg-surface-muted p-2">
              <h4 className="font-medium">实际镜头：{shot.data.title}</h4>
              {Object.entries(
                (shot.data.payload ?? {}) as Record<string, unknown>,
              )
                .filter(
                  ([, item]) =>
                    typeof item === "string" || typeof item === "number",
                )
                .map(([key, item]) => (
                  <p key={key} className="break-words">
                    {key}：{String(item)}
                  </p>
                ))}
            </div>
          )}
          <BareButton
            disabled={busy || !record.data || !shot.data}
            className="rounded border border-brand px-2 py-1 text-brand disabled:opacity-50"
            onClick={() => void create()}
          >
            建立来源复核预览
          </BareButton>
          {history.data?.length ? (
            <label className="grid gap-1">
              复核历史
              <select
                className="w-full rounded border border-line p-2"
                value={selectedId ?? ""}
                onChange={(event) =>
                  setSelectedId(event.target.value || undefined)
                }
              >
                <option value="">选择复核预览</option>
                {history.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.createdAt} ·{" "}
                    {item.state === "pending"
                      ? "待确认"
                      : item.state === "adopted"
                        ? "已确认绑定"
                        : "已放弃"}{" "}
                    · 镜头版本 {item.shotVersion}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {value && (
            <div
              className="space-y-2 rounded border border-line p-3"
              data-testid="media-source-review-diff"
            >
              <p>
                冻结素材版本 {value.recordVersion} / 镜头版本{" "}
                {value.shotVersion} ·{" "}
                {value.state === "pending"
                  ? "待确认"
                  : value.state === "adopted"
                    ? "已确认来源绑定，素材仍需另行采用"
                    : "已放弃"}
              </p>
              {value.staleReasons.map((reason, index) => (
                <p key={index} className="text-amber-700">
                  {reason}
                </p>
              ))}
              {value.state === "pending" && (
                <>
                  {!exact && (
                    <p className="text-amber-700">
                      当前内容与冻结版本不一致，不能确认这份旧预览。
                    </p>
                  )}
                  {[
                    "我已审阅实际素材，而不只是元数据",
                    "我已核对该素材与当前实际镜头的对应关系",
                    "我已核对作者意图和正式来源，接受保留该素材",
                  ].map((text, index) => (
                    <label key={text} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={reviewed[index]}
                        onChange={(event) =>
                          setReviewed(
                            reviewed.map((item, i) =>
                              i === index ? event.target.checked : item,
                            ),
                          )
                        }
                      />
                      {text}
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <BareButton
                      disabled={
                        busy ||
                        !exact ||
                        value.sourceState !== "current" ||
                        !reviewed.every(Boolean)
                      }
                      className="rounded bg-brand px-2 py-1 text-white disabled:opacity-50"
                      onClick={() => void transition("adopt")}
                    >
                      确认来源复核
                    </BareButton>
                    <BareButton
                      disabled={busy}
                      className="rounded border border-line px-2 py-1"
                      onClick={() => void transition("discard")}
                    >
                      放弃复核预览
                    </BareButton>
                  </div>
                </>
              )}
            </div>
          )}
          {(error ||
            record.error ||
            shot.error ||
            history.error ||
            selected.error) && (
            <p role="alert" className="text-red-600">
              {error ??
                message(
                  record.error ?? shot.error ?? history.error ?? selected.error,
                )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
