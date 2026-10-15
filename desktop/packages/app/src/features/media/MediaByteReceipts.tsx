import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BareButton } from "@dramaip/ui-shared";
import {
  MediaPlaybackDescriptorSchema,
  type MediaByteVerification,
  type MediaPlaybackDescriptor,
} from "@dramaip/contracts/media";
import { useStudio } from "../../studio-shared";

const pendingSchema = z
  .object({ key: z.string().uuid(), descriptor: MediaPlaybackDescriptorSchema })
  .strict();
type Pending = z.infer<typeof pendingSchema>;
export const byteReceiptStorageKey = (descriptor: MediaPlaybackDescriptor) =>
  `dramaip:byte-verification:${descriptor.projectId}:${descriptor.recordId}:${descriptor.recordVersion}:${descriptor.artifactRef ?? "embedded"}:${descriptor.sha256}`;
export const matchesByteReceipt = (
  value: MediaByteVerification,
  descriptor: MediaPlaybackDescriptor,
  key?: string,
) =>
  JSON.stringify(value.descriptor) === JSON.stringify(descriptor) &&
  (key === undefined || value.requestKey === key);

export function MediaByteReceiptView({
  items,
}: {
  items: readonly MediaByteVerification[];
}) {
  return (
    <div data-testid="media-byte-receipts-history" className="space-y-2">
      <p>
        已读取原字节凭证 {items.length} 条；不是本次完整清单核验或当前文件通过。
      </p>
      {items.map((item) => (
        <div key={item.id} className="rounded border border-line p-2">
          <p>
            原凭证 {item.id} · 素材版本 {item.descriptor.recordVersion} ·{" "}
            {new Date(item.verifiedAt).toLocaleString()}
          </p>
          <p>
            完整读取 {item.descriptor.sizeBytes} 字节 · SHA-256{" "}
            {item.descriptor.sha256}
          </p>
          <p>
            {item.currentBinding === "unchanged-metadata"
              ? "当前元数据未变，实际文件字节未重新读取。"
              : item.currentBinding === "changed-metadata"
                ? "当前元数据已变；仅保留原读取历史，不替换来源。"
                : "当前元数据不可核对；不使用缓存补成有效来源。"}
          </p>
          <p>
            只证明记录时间的一次完整读取；不证明持续文件完整性、质量、授权、费用或交付通过。
          </p>
        </div>
      ))}
    </div>
  );
}

/** Explicit per-file durable observation. No auto-read, model, playback, copy or consent. */
export function MediaByteReceipts({
  descriptor,
}: {
  descriptor: MediaPlaybackDescriptor;
}) {
  const client = useStudio();
  const lease = useRef<AbortController | undefined>(undefined);
  const storageKey = byteReceiptStorageKey(descriptor);
  const [pending, setPending] = useState<Pending>();
  const [working, setWorking] = useState(false);
  const [items, setItems] = useState<MediaByteVerification[]>();
  const [cursor, setCursor] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const value = pendingSchema.safeParse(raw ? JSON.parse(raw) : undefined);
      if (
        value.success &&
        JSON.stringify(value.data.descriptor) === JSON.stringify(descriptor)
      )
        setPending(value.data);
    } catch {
      setNotice("本机原请求恢复记录不可读取；不会自动发起核验。");
    }
    return () => {
      lease.current?.abort();
      lease.current = undefined;
    };
  }, [storageKey]);
  const remember = (value?: Pending) => {
    setPending(value);
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      setNotice(
        "本机恢复记录未保存；请保留原请求标识，结果不确定时先只读恢复。",
      );
    }
  };
  const run = async (action: "verify" | "recover" | "history" | "more") => {
    if (lease.current) return;
    const controller = new AbortController();
    lease.current = controller;
    setWorking(true);
    setNotice(undefined);
    const prior = items;
    setItems(undefined); // An actual read failure must never render previous cache as current evidence.
    setCursor(undefined); // A failed page read must restart from the first page, not a stale continuation.
    try {
      if (action === "history" || action === "more") {
        const page = await client.mediaPlayback.byteVerifications(
          descriptor.recordId,
          descriptor.projectId,
          descriptor.recordVersion,
          action === "more" ? cursor : undefined,
          controller.signal,
        );
        if (lease.current !== controller || controller.signal.aborted) return;
        const result =
          action === "more" ? [...(prior ?? []), ...page.items] : page.items;
        if (new Set(result.map((item) => item.id)).size !== result.length)
          throw new Error("重复的原字节凭证");
        setItems(result);
        setCursor(page.nextCursor);
      } else {
        if (action === "recover" && !pending) return;
        const original = pending ?? { key: crypto.randomUUID(), descriptor };
        if (action === "verify") remember(original);
        const receipt =
          action === "recover"
            ? await client.mediaPlayback.recoverByteVerification(
                descriptor.recordId,
                descriptor.projectId,
                original.key,
                controller.signal,
              )
            : await client.mediaPlayback.verifyBytes(
                original.descriptor,
                original.key,
                controller.signal,
              );
        if (lease.current !== controller || controller.signal.aborted) return;
        if (!matchesByteReceipt(receipt, original.descriptor, original.key))
          throw new Error("原请求与原字节凭证不一致");
        remember(undefined);
        setItems([receipt]);
        setCursor(undefined);
      }
    } catch {
      if (lease.current === controller && !controller.signal.aborted)
        setNotice(
          action === "history" || action === "more"
            ? "本次凭证历史读取失败，旧列表不当作本次读取；请明确重新读取。"
            : "未取得匹配的原字节凭证；不推定成功或失败。原请求保留，先只读恢复，不自动重读文件或换最新来源。",
        );
    } finally {
      if (lease.current === controller) {
        lease.current = undefined;
        setWorking(false);
      }
    }
  };
  return (
    <section
      aria-label={`持久字节凭证-${descriptor.recordId}`}
      className="mt-3 space-y-2 rounded border border-line p-2"
    >
      <p>
        素材 {descriptor.recordId} @ {descriptor.recordVersion}{" "}
        的独立持久字节凭证
      </p>
      <p>
        明确核验后由 Media
        完整读取原版本并保存凭证；历史读取不会重读文件。仅本文件，不是 NLE
        整包或授权确认。
      </p>
      {pending && (
        <p data-testid="media-byte-receipts-pending">
          原请求 {pending.key} 等待核对；不会自动重发。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <BareButton
          disabled={working}
          onClick={() => void run("verify")}
          className="rounded border border-line px-2 py-1 text-brand"
        >
          {pending ? "明确继续原请求字节核验" : "核验并保存字节凭证"}
        </BareButton>
        {pending && (
          <BareButton
            disabled={working}
            onClick={() => void run("recover")}
            className="rounded border border-line px-2 py-1"
          >
            只读恢复原字节凭证
          </BareButton>
        )}
        <BareButton
          disabled={working}
          onClick={() => void run("history")}
          className="rounded border border-line px-2 py-1"
        >
          读取本版本字节凭证
        </BareButton>
        {cursor && (
          <BareButton
            disabled={working}
            onClick={() => void run("more")}
            className="rounded border border-line px-2 py-1"
          >
            读取更多字节凭证
          </BareButton>
        )}
        {working && (
          <BareButton
            onClick={() => {
              lease.current?.abort();
              lease.current = undefined;
              setWorking(false);
              setItems(undefined);
              setNotice(
                "本次读取已停止；若原请求已提交，凭证仍保留，需按原请求只读核对。",
              );
            }}
            className="rounded border border-line px-2 py-1"
          >
            停止字节凭证操作
          </BareButton>
        )}
      </div>
      {working && <p role="status">正在核对原字节凭证…</p>}
      {items && <MediaByteReceiptView items={items} />}
      {notice && (
        <p role="alert" className="text-warning-strong">
          {notice}
        </p>
      )}
    </section>
  );
}
