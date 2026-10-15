import { useEffect, useRef, useState } from "react";
import type { MediaPlaybackDescriptor } from "@dramaip/contracts/media";
import { BareButton } from "@dramaip/ui-shared";
import { message, useStudio } from "../../studio-shared";

/** Explicit file load only. No autoplay, adoption, consent persistence or direct business fetch. */
export function MediaPlaybackPanel(props: {
  recordId: string;
  projectId: string;
  version: number;
  expectedKind?: "image" | "audio" | "video";
}) {
  const client = useStudio();
  const identity = JSON.stringify([
    props.recordId,
    props.projectId,
    props.version,
    props.expectedKind,
  ]);
  const lease = useRef<{ abort: AbortController; url?: string } | undefined>(
    undefined,
  );
  const [loaded, setLoaded] = useState<{
    identity: string;
    descriptor: MediaPlaybackDescriptor;
    url: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const release = () => {
    lease.current?.abort.abort();
    if (lease.current?.url) URL.revokeObjectURL(lease.current.url);
    lease.current = undefined;
  };
  useEffect(() => {
    setLoaded(undefined);
    setLoading(false);
    setNotice(undefined);
    setError(undefined);
    return release;
  }, [identity]);
  const value = loaded?.identity === identity ? loaded : undefined;
  useEffect(() => {
    if (!value) return;
    const active = lease.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const current = await client.mediaPlayback.describe(
          props.recordId,
          props.projectId,
          props.version,
          active.abort.signal,
        );
        if (JSON.stringify(current) !== JSON.stringify(value.descriptor))
          throw new Error("媒体归属、版本或存档已变化，请重新加载。");
      } catch (cause) {
        if (!stopped && lease.current === active) {
          release();
          setLoaded(undefined);
          setError(message(cause));
        }
      }
      if (!stopped && lease.current === active) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [value, client, props.recordId, props.projectId, props.version]);
  const load = async () => {
    release();
    setLoaded(undefined);
    setError(undefined);
    setNotice(undefined);
    setLoading(true);
    const active = {
      abort: new AbortController(),
      url: undefined as string | undefined,
    };
    lease.current = active;
    try {
      if (!client.mediaPlayback)
        throw new Error("当前连接尚不支持受控文件播放。");
      const result = await client.mediaPlayback.open(
        props.recordId,
        props.projectId,
        props.version,
        active.abort.signal,
      );
      if (lease.current !== active || active.abort.signal.aborted) return;
      if (props.expectedKind && result.descriptor.kind !== props.expectedKind)
        throw new Error("实际媒体类型与冻结片段不一致，不能代替原素材。");
      active.url = URL.createObjectURL(result.blob);
      setLoaded({ identity, descriptor: result.descriptor, url: active.url });
      setNotice(
        "完整字节已读取并校验；尚未确认浏览器可解码，也不代表已审阅内容。",
      );
    } catch (cause) {
      if (lease.current === active) {
        release();
        setError(message(cause));
      }
    } finally {
      if (lease.current === active || !lease.current) setLoading(false);
    }
  };
  const decodeError = () => {
    release();
    setLoaded(undefined);
    setNotice(undefined);
    setError(
      "实际文件已读取，但浏览器无法解码。请核对格式或另行审阅；不要据此确认质量或权利。",
    );
  };
  return (
    <section
      className="space-y-2 rounded border border-line p-2 text-xs"
      data-testid={`media-playback-${props.recordId}`}
    >
      <p>实际媒体 · 冻结版本 {props.version}（不是质量、权利或已审阅声明）</p>
      <div className="flex flex-wrap gap-2">
        <BareButton
          className="rounded border border-line px-2 py-1 disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading
            ? "完整读取中…"
            : value
              ? "重新加载实际媒体"
              : "加载实际媒体"}
        </BareButton>
        {(loading || value) && (
          <BareButton
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              release();
              setLoaded(undefined);
              setLoading(false);
              setNotice(undefined);
            }}
          >
            停止并释放媒体
          </BareButton>
        )}
      </div>
      <p className="text-muted">
        只支持安全内嵌媒体或本项目受控存档，单文件最多 128
        MiB；全文件读取后播放，较大文件需要等待。不会自动播放或勾选审阅。
      </p>
      {value && (
        <>
          <p>
            {value.descriptor.origin === "managed-archive" ? "归档" : "内嵌"} ·{" "}
            {value.descriptor.mimeType} · {value.descriptor.sizeBytes} 字节
          </p>
          {value.descriptor.kind === "image" ? (
            <img
              className="max-h-72 max-w-full rounded object-contain"
              src={value.url}
              alt="待人工审阅的实际媒体"
              onLoad={() =>
                setNotice(
                  "浏览器已解码实际图像；请自行审阅内容、作者意图和权利限制。",
                )
              }
              onError={decodeError}
            />
          ) : value.descriptor.kind === "audio" ? (
            <audio
              className="max-w-full"
              controls
              preload="metadata"
              src={value.url}
              aria-label={`实际音频 ${props.recordId}`}
              onCanPlay={() =>
                setNotice(
                  "实际音频已可播放；请自行试听，不代表质量或授权结论。",
                )
              }
              onError={decodeError}
            />
          ) : (
            <video
              className="max-h-72 max-w-full"
              controls
              playsInline
              preload="metadata"
              src={value.url}
              aria-label={`实际视频 ${props.recordId}`}
              onCanPlay={() =>
                setNotice(
                  "实际视频已可播放；请自行审阅，不代表质量或授权结论。",
                )
              }
              onError={decodeError}
            />
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-warning-strong">
          {error}
        </p>
      )}
    </section>
  );
}
