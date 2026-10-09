import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  MediaReviewCreateInputSchema,
  type MediaReviewEvidence,
  type MediaReviewPreview,
  type MediaReviewReceipt,
  type MediaReviewOwnerEvidence,
} from "@dramaip/contracts/review";
import { useStudio } from "../../studio-shared";
import { MediaDeliveryEvidenceView } from "../media/MediaDeliveryEvidencePanel";

const bindingLabels = {
  exact: "与原包完整素材记录一致",
  changed: "原素材已变化，不换用新版本证据",
  missing: "原素材已缺失或不再属于本项目",
  "owner-unavailable": "原素材证据读取能力不可用",
};
export function MediaReviewOwnerEvidenceView({
  value,
}: {
  value: MediaReviewOwnerEvidence;
}) {
  return (
    <section
      aria-label="原包逐素材owner证据"
      className="space-y-2 rounded border border-line p-2"
    >
      <p>
        原包素材证据：{value.state} · {value.assets.length} 个原素材
      </p>
      <p className="text-xs text-muted">
        人工审片决定与素材证据分别记录；声明受限、服务不可用或缺少归档不能被人工
        approve
        擦除。正面声明不是合法授权或账单，历史读取不是当前文件核验；这里不批准发行。
      </p>
      {value.blockers.length > 0 && (
        <p role="alert">
          素材已知阻断：
          {value.blockers.map((b) => `${b.recordId}：${b.code}`).join(" · ")}
        </p>
      )}
      {!value.assets.length && (
        <p>原包没有绑定媒体素材；不强制补媒体，也不声明文件或质量已通过。</p>
      )}
      {value.assets.map((a) => (
        <details key={a.id}>
          <summary className="break-all">
            原素材 {a.id} · v{a.version} · {bindingLabels[a.binding]}
          </summary>
          <p className="break-all">原素材指纹：{a.fingerprint}</p>
          {a.binding === "exact" ? (
            <>
              <p>原包存档绑定：{a.archiveBinding}（只核元数据，不重读文件）</p>
              <MediaDeliveryEvidenceView value={a.evidence} />
            </>
          ) : a.binding === "changed" ? (
            <p className="break-all">
              当前元数据 v{a.current.version} · 指纹 {a.current.fingerprint}
              ；不把它绑定为原包素材。
            </p>
          ) : (
            <p>没有可用于原包的精确版本证据；不显示另一素材或最新成功记录。</p>
          )}
        </details>
      ))}
    </section>
  );
}

export const MediaReviewPendingSchema = z
  .object({
    requestKey: z.string().uuid(),
    episodeId: z.string().uuid(),
    input: MediaReviewCreateInputSchema,
  })
  .strict();
export function MediaReviewPanel(props: {
  projectId: string;
  episodeId: string;
  packageId: string;
  onCreated: (id: string) => void;
}) {
  const client = useStudio(),
    [preview, setPreview] = useState<MediaReviewPreview>(),
    [evidence, setEvidence] = useState<MediaReviewEvidence>(),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState(""),
    [working, setWorking] = useState(false),
    [pending, setPending] =
      useState<z.infer<typeof MediaReviewPendingSchema>>(),
    [rejected, setRejected] = useState(false);
  const busy = useRef(false),
    invalid = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController | undefined>(undefined),
    pendingRef = useRef(pending),
    selectedPackage = useRef(props.packageId);
  const key = `dramaip:media-review:${props.projectId}:${props.episodeId}`;
  const remember = (value: typeof pending) => {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
    pendingRef.current = value;
    setPending(value);
  };
  const perform = async (
    work: (signal: AbortSignal, valid: () => boolean) => Promise<void>,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const lease = ++epoch.current;
    const valid = () => lease === epoch.current && !c.signal.aborted;
    setNotice("");
    try {
      await work(c.signal, valid);
    } catch {
      if (valid())
        setNotice(
          "原审片请求或资料未能核对；未改用最新包、重新提交或批准发行。",
        );
    } finally {
      if (valid()) {
        busy.current = false;
        setWorking(false);
      }
    }
  };
  const accept = (r: MediaReviewReceipt) => {
    if (r.projectId !== props.projectId || r.episodeId !== props.episodeId)
      throw Error("scope");
    remember(undefined);
    setPreview(undefined);
    setConfirmed(false);
    setRejected(false);
    props.onCreated(r.package.id);
    setNotice(`已核对原整包 ${r.package.id}；尚需明确审阅与决定。`);
  };
  const recover = () =>
    perform(async (signal, valid) => {
      const p = pendingRef.current;
      if (!p) return;
      const r = await client.mediaReview.recoverRequest(
        p.requestKey,
        props.projectId,
        signal,
      );
      if (valid()) accept(r);
    });
  useEffect(() => {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const p = MediaReviewPendingSchema.parse(JSON.parse(raw));
        if (
          p.episodeId !== props.episodeId ||
          p.input.projectId !== props.projectId
        )
          throw Error("scope");
        pendingRef.current = p;
        setPending(p);
        void recover();
      } catch {
        invalid.current = true;
        setNotice("原待核记录损坏，已保留且阻断新创建；请先处理原记录。");
      }
    }
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
    // The parent keys this instance by project/episode; reload only reads the original key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (selectedPackage.current === props.packageId) return;
    selectedPackage.current = props.packageId;
    epoch.current++;
    controller.current?.abort();
    busy.current = false;
    setWorking(false);
    setEvidence(undefined);
  }, [props.packageId]);
  const create = (retry = false) =>
    perform(async (signal, valid) => {
      if (invalid.current) return;
      let p = pendingRef.current;
      if (!retry) {
        if (p || !preview || !confirmed) return;
        p = MediaReviewPendingSchema.parse({
          requestKey: crypto.randomUUID(),
          episodeId: props.episodeId,
          input: {
            projectId: props.projectId,
            sourceFingerprint: preview.sourceFingerprint,
          },
        });
        remember(p);
        setConfirmed(false);
      }
      if (!p) return;
      try {
        const r = await client.mediaReview.createPackage(
          p.episodeId,
          p.input,
          p.requestKey,
          signal,
        );
        if (valid()) accept(r);
      } catch (error) {
        if (!valid()) return;
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? error.status
            : undefined;
        if (typeof status === "number" && status >= 400 && status < 500) {
          try {
            const r = await client.mediaReview.recoverRequest(
              p.requestKey,
              props.projectId,
              signal,
            );
            if (valid()) accept(r);
            return;
          } catch (e) {
            if (
              valid() &&
              typeof e === "object" &&
              e !== null &&
              "status" in e &&
              e.status === 404
            )
              setRejected(true);
          }
        }
        if (valid())
          setNotice(
            "原创建结果未能核对。保留原键与输入，可只读核对或明确重发原请求。",
          );
      }
    });
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-surface p-4"
      data-testid={`media-review-${props.episodeId}`}
    >
      <h3 className="font-medium">整包审片的原版本保护</h3>
      <p className="text-sm text-muted">
        冻结完整 NLE
        轨道、字幕、片段、原素材和归档元数据。审片决定只适用于原包；不读取当前文件，不核验文学质量、合法授权或账单，也不批准成片／字体／发行。旧审片包不自动升级。
      </p>
      <button
        disabled={working || !!pending || invalid.current}
        onClick={() =>
          void perform(async (signal, valid) => {
            setPreview(undefined);
            setConfirmed(false);
            const r = await client.mediaReview.preview(
              props.episodeId,
              props.projectId,
              signal,
            );
            if (valid()) setPreview(r);
          })
        }
      >
        核对本轮整包来源
      </button>
      {preview && (
        <div data-testid="media-review-preview">
          <p>
            原时间线 {preview.snapshot.delivery.timeline.id} · v
            {preview.snapshot.delivery.timeline.version} ·{" "}
            {preview.snapshot.delivery.timeline.tracks.length} 轨／
            {preview.shotIds.length} 镜头／{preview.snapshot.media.length} 素材
          </p>
          <p className="break-all">原来源指纹：{preview.sourceFingerprint}</p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={working || !!pending}
            />
            我已核对本轮原来源，明确创建此版本审片包；不表示审片通过或发行批准
          </label>
          <button
            disabled={
              working ||
              !confirmed ||
              !!pending ||
              invalid.current ||
              preview.shotIds.length === 0
            }
            onClick={() => void create()}
          >
            创建原版本整包审片包
          </button>
        </div>
      )}
      {pending && (
        <div data-testid="media-review-pending">
          <p className="break-all">
            原待核请求：{pending.requestKey} · {pending.input.sourceFingerprint}
          </p>
          <button disabled={working} onClick={() => void recover()}>
            只读核对原审片请求
          </button>
          <button
            disabled={working || invalid.current}
            onClick={() => void create(true)}
          >
            明确重发原审片请求
          </button>
          {rejected && (
            <button
              disabled={working}
              onClick={() => {
                localStorage.setItem(
                  `${key}:rejected:${pending.requestKey}`,
                  JSON.stringify(pending),
                );
                remember(undefined);
                setRejected(false);
                setPreview(undefined);
                setConfirmed(false);
                setNotice("已保留原拒绝记录；请重新核对来源，不沿用原勾选。");
              }}
            >
              保留原拒绝记录，重新核对审片来源
            </button>
          )}
        </div>
      )}
      <button
        disabled={working || !props.packageId}
        onClick={() =>
          void perform(async (signal, valid) => {
            setEvidence(undefined);
            const selected = props.packageId;
            const r = await client.mediaReview.evidence(
              selected,
              { projectId: props.projectId, episodeId: props.episodeId },
              signal,
            );
            if (valid() && selected === selectedPackage.current) setEvidence(r);
          })
        }
      >
        核对当前包审片门
      </button>
      {evidence && (
        <div data-testid="media-review-evidence">
          {evidence.kind === "source-bound" && (
            <button
              disabled={working}
              onClick={() =>
                void perform(async (signal, valid) => {
                  const selected = props.packageId;
                  const document = await client.mediaReview.exportOriginal(
                    selected,
                    { projectId: props.projectId, episodeId: props.episodeId },
                    signal,
                  );
                  if (!valid() || selected !== selectedPackage.current) return;
                  const result = await client.host.saveTextFile({
                    suggestedName: document.fileName,
                    content: document.content,
                  });
                  if (valid())
                    setNotice(
                      result.saved
                        ? "已导出原 NLE 审片资料；不是当前文件或发行证明。"
                        : "已取消原审片资料导出。",
                    );
                })
              }
            >
              导出原整包审片资料 JSON
            </button>
          )}
          <p>
            原包：{evidence.packageId} · 审片状态：{evidence.reviewState}
          </p>
          {evidence.kind === "legacy-unbound" ? (
            <p>旧包未绑定完整 NLE 原来源；历史决定不认证当前版本。</p>
          ) : (
            <>
              <p className="break-all">
                原包指纹：{evidence.original.sourceFingerprint} · 来源：
                {evidence.sourceState}
              </p>
              <p>
                未解决意见：
                {evidence.comments.filter((c) => !c.resolved).length} ·
                有效决定：{evidence.decisions.filter((d) => d.effective).length}
              </p>
              <p>
                阻断：
                {evidence.blockers.join("、") ||
                  "当前原包机械审片门无阻断；不是内容质量或发行批准"}
              </p>
              <p>仍未知：{evidence.unknowns.join("、")}</p>
              <MediaReviewOwnerEvidenceView
                value={evidence.mediaOwnerEvidence}
              />
            </>
          )}
          <p>releaseReady=false</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
