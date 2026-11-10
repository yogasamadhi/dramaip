import { useEffect, useRef, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  PropsRenderFactories,
  TranslateNS,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/production-media-client/client/contract";
import type {
  MediaCreatePackageResult,
  MediaEvidenceResult,
  MediaExportOriginalResult,
  MediaPreviewResult,
} from "@dramaip/production-review/types";
import clsx from "clsx";
import {
  saveDocument,
  statusOf,
  value,
  type ReviewRemote,
  type SystemRemote,
} from "../remote.ts";
import {
  mediaPendingKey,
  parseMediaPending,
  pendingStore,
  type MediaPending,
} from "./pending.ts";
import css from "./Stages.module.css";

type Translate = TranslateNS<"review">;
type SourceBound = Extract<MediaEvidenceResult, { kind: "source-bound" }>;
/** The original package's evidence asset by asset. */
export type OwnerEvidence = SourceBound["mediaOwnerEvidence"];

/** Props of the whole-package media review of one episode. */
export interface MediaReviewProps extends PropsRenderFactories {
  projectId: string;
  episodeId: string;
  /** The review package chosen in the editor; empty when none is. */
  packageId: string;
  /** A package was created or recovered; the editor selects it. */
  onCreated: (id: string) => void;
  review: ReviewRemote;
  system: SystemRemote;
  t: Translate;
}

/**
 * The whole-package review guard: freeze the full timeline, subtitles,
 * clips and source assets into one versioned review package, keep its
 * original request until its outcome is known, and check the chosen
 * package's mechanical review gate. It never reads current files, never
 * judges quality, rights or billing, and never approves a release.
 */
export function MediaReview(props: MediaReviewProps) {
  const { projectId, episodeId, review, t } = props;
  const [preview, setPreview] = useState<MediaPreviewResult>();
  const [evidence, setEvidence] = useState<MediaEvidenceResult>();
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState<MediaPending>();
  const [rejected, setRejected] = useState(false);
  const busy = useRef(false);
  const invalid = useRef(false);
  const epoch = useRef(0);
  const pendingRef = useRef(pending);
  const selectedPackage = useRef(props.packageId);
  const key = mediaPendingKey(projectId, episodeId);
  const remember = (next: MediaPending | undefined) => {
    pendingStore.write(key, next);
    pendingRef.current = next;
    setPending(next);
  };
  /** Run one step under the single lease; a failure is reported once, as unverified. */
  const perform = async (work: (valid: () => boolean) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    const lease = ++epoch.current;
    const valid = () => lease === epoch.current;
    setNotice("");
    try {
      await work(valid);
    } catch {
      if (valid()) setNotice(t("media.notice.failed"));
    } finally {
      if (valid()) {
        busy.current = false;
        setWorking(false);
      }
    }
  };
  const accept = (receipt: MediaCreatePackageResult) => {
    if (receipt.projectId !== projectId || receipt.episodeId !== episodeId)
      throw new Error("scope");
    remember(undefined);
    setPreview(undefined);
    setConfirmed(false);
    setRejected(false);
    props.onCreated(receipt.package.id);
    setNotice(t("media.notice.accepted", { id: receipt.package.id }));
  };
  const read = (original: MediaPending) =>
    value<MediaCreatePackageResult>(
      review.mediaRecoverRequest(original.requestKey, { projectId }),
    );
  const recover = () =>
    perform(async (valid) => {
      const original = pendingRef.current;
      if (!original) return;
      const receipt = await read(original);
      if (valid()) accept(receipt);
    });
  useEffect(() => {
    try {
      const stored = pendingStore.read(key);
      if (stored !== undefined) {
        const original = parseMediaPending(stored, { projectId, episodeId });
        pendingRef.current = original;
        setPending(original);
        void recover();
      }
    } catch {
      invalid.current = true;
      setNotice(t("media.notice.invalid"));
    }
    return () => {
      epoch.current++;
    };
    // The owner keys this instance by project and episode; mounting only
    // reads the original key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (selectedPackage.current === props.packageId) return;
    selectedPackage.current = props.packageId;
    epoch.current++;
    busy.current = false;
    setWorking(false);
    setEvidence(undefined);
  }, [props.packageId]);
  const create = (retry = false) =>
    perform(async (valid) => {
      if (invalid.current) return;
      let original = pendingRef.current;
      if (!retry) {
        if (original || !preview || !confirmed) return;
        original = parseMediaPending(
          {
            requestKey: crypto.randomUUID(),
            episodeId,
            input: { projectId, sourceFingerprint: preview.sourceFingerprint },
          },
          { projectId, episodeId },
        );
        remember(original);
        setConfirmed(false);
      }
      if (!original) return;
      try {
        const receipt = await value<MediaCreatePackageResult>(
          review.mediaCreatePackage(
            original.episodeId,
            original.input,
            // The source fingerprint the preview showed, as `If-Match`.
            `"${original.input.sourceFingerprint}"`,
            original.requestKey,
          ),
        );
        if (valid()) accept(receipt);
      } catch (error) {
        if (!valid()) return;
        const status = statusOf(error);
        if (status !== undefined && status >= 400 && status < 500) {
          try {
            const receipt = await read(original);
            if (valid()) accept(receipt);
            return;
          } catch (readError) {
            if (valid() && statusOf(readError) === 404) setRejected(true);
          }
        }
        if (valid()) setNotice(t("media.notice.unconfirmed"));
      }
    });
  const retain = () => {
    if (!pending) return;
    pendingStore.write(`${key}:rejected:${pending.requestKey}`, pending);
    remember(undefined);
    setRejected(false);
    setPreview(undefined);
    setConfirmed(false);
    setNotice(t("media.notice.retained"));
  };
  return (
    <section className={css.box} data-testid={`media-review-${episodeId}`}>
      <h3 className={css.heading}>{t("media.title")}</h3>
      <p className={css.muted}>{t("media.description")}</p>
      <div className={css.row}>
        <Button
          size="sm"
          variant="outline"
          disabled={working || !!pending || invalid.current}
          onClick={() =>
            void perform(async (valid) => {
              setPreview(undefined);
              setConfirmed(false);
              const next = await value<MediaPreviewResult>(
                review.mediaPreview(episodeId, { projectId }),
              );
              if (valid()) setPreview(next);
            })
          }
        >
          {t("media.preview")}
        </Button>
      </div>
      {preview && (
        <div data-testid="media-review-preview" className={css.field}>
          <p>
            {t("media.preview.timeline", {
              id: preview.snapshot.delivery.timeline.id,
              version: preview.snapshot.delivery.timeline.version,
              tracks: preview.snapshot.delivery.timeline.tracks.length,
              shots: preview.shotIds.length,
              media: preview.snapshot.media.length,
            })}
          </p>
          <p className={css.break}>
            {t("media.preview.fingerprint", { sha: preview.sourceFingerprint })}
          </p>
          <label className={css.check}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={working || !!pending}
            />
            <span>{t("media.preview.confirm")}</span>
          </label>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={
                working ||
                !confirmed ||
                !!pending ||
                invalid.current ||
                preview.shotIds.length === 0
              }
              onClick={() => void create()}
            >
              {t("media.create")}
            </Button>
          </div>
        </div>
      )}
      {pending && (
        <div data-testid="media-review-pending" className={css.field}>
          <p className={css.break}>
            {t("media.pending", {
              key: pending.requestKey,
              sha: pending.input.sourceFingerprint,
            })}
          </p>
          <div className={css.row}>
            <Button
              size="sm"
              variant="outline"
              disabled={working}
              onClick={() => void recover()}
            >
              {t("media.pending.recover")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working || invalid.current}
              onClick={() => void create(true)}
            >
              {t("media.pending.resend")}
            </Button>
            {rejected && (
              <Button
                size="sm"
                variant="outline"
                disabled={working}
                onClick={retain}
              >
                {t("media.pending.retain")}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className={css.row}>
        <Button
          size="sm"
          variant="outline"
          disabled={working || !props.packageId}
          onClick={() =>
            void perform(async (valid) => {
              setEvidence(undefined);
              const selected = props.packageId;
              const next = await value<MediaEvidenceResult>(
                review.mediaEvidence(selected, { projectId, episodeId }),
              );
              if (valid() && selected === selectedPackage.current)
                setEvidence(next);
            })
          }
        >
          {t("media.evidence")}
        </Button>
      </div>
      {evidence && (
        <div data-testid="media-review-evidence" className={css.field}>
          {evidence.kind === "source-bound" && (
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={working}
                onClick={() =>
                  void perform(async (valid) => {
                    const selected = props.packageId;
                    const document = await value<MediaExportOriginalResult>(
                      review.mediaExportOriginal(selected, {
                        projectId,
                        episodeId,
                      }),
                    );
                    if (!valid() || selected !== selectedPackage.current)
                      return;
                    const saved = await saveDocument(props.system, document);
                    if (valid())
                      setNotice(
                        t(
                          saved
                            ? "media.notice.exported"
                            : "media.notice.exportCancelled",
                        ),
                      );
                  })
                }
              >
                {t("media.export")}
              </Button>
            </div>
          )}
          <p className={css.break}>
            {t("media.evidence.package", {
              id: evidence.packageId,
              state: evidence.reviewState,
            })}
          </p>
          {evidence.kind === "legacy-unbound" ? (
            <p>{t("media.evidence.legacy")}</p>
          ) : (
            <>
              <p className={css.break}>
                {t("media.evidence.fingerprint", {
                  sha: evidence.original.sourceFingerprint,
                  state: evidence.sourceState,
                })}
              </p>
              <p>
                {t("media.evidence.counts", {
                  open: evidence.comments.filter((item) => !item.resolved)
                    .length,
                  effective: evidence.decisions.filter((item) => item.effective)
                    .length,
                })}
              </p>
              <p>
                {evidence.blockers.length
                  ? t("media.evidence.blockers", {
                      list: evidence.blockers.join("、"),
                    })
                  : t("media.evidence.blockers.none")}
              </p>
              <p>
                {t("media.evidence.unknowns", {
                  list: evidence.unknowns.join("、"),
                })}
              </p>
              <OwnerEvidenceView
                value={evidence.mediaOwnerEvidence}
                renderFactorySlot={props.renderFactorySlot}
                t={t}
              />
            </>
          )}
          <p>{t("media.evidence.release")}</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

/**
 * The original package's assets one by one: an exact asset shows its
 * delivery evidence, a changed or missing one says so and never shows
 * another version's evidence. A human decision never clears an asset's
 * known blocker.
 */
export function OwnerEvidenceView({
  value: evidence,
  renderFactorySlot,
  t,
}: PropsRenderFactories & { value: OwnerEvidence; t: Translate }) {
  return (
    <section aria-label={t("media.owner.label")} className={css.box}>
      <p>
        {t("media.owner.state", {
          state: evidence.state,
          count: evidence.assets.length,
        })}
      </p>
      <p className={clsx(css.muted, css.small)}>{t("media.owner.boundary")}</p>
      {evidence.blockers.length > 0 && (
        <p role="alert" className={css.danger}>
          {t("media.owner.blockers", {
            list: evidence.blockers
              .map((item) => `${item.recordId}：${item.code}`)
              .join(" · "),
          })}
        </p>
      )}
      {!evidence.assets.length && <p>{t("media.owner.empty")}</p>}
      {evidence.assets.map((asset) => (
        <details key={asset.id}>
          <summary className={css.break}>
            {t("media.owner.asset", {
              id: asset.id,
              version: asset.version,
              binding: t(`media.binding.${asset.binding}`),
            })}
          </summary>
          <p className={css.break}>
            {t("media.owner.fingerprint", { sha: asset.fingerprint })}
          </p>
          {asset.binding === "exact" ? (
            <>
              <p>
                {t("media.owner.archive", { binding: asset.archiveBinding })}
              </p>
              {renderFactorySlot("media.delivery-evidence", {
                value: asset.evidence,
              })}
            </>
          ) : asset.binding === "changed" ? (
            <p className={css.break}>
              {t("media.owner.changed", {
                version: asset.current.version,
                sha: asset.current.fingerprint,
              })}
            </p>
          ) : (
            <p>{t("media.owner.missing")}</p>
          )}
        </details>
      ))}
    </section>
  );
}
