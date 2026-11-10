import { useEffect, useRef, useState } from "react";
import type {} from "@dramaip/automation-automation-client/client/contract";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  PropsRenderFactories,
  TranslateNS,
} from "@dramaip/infra-ui-slots";
import type {
  PlatformAdoptVariantResult,
  PlatformCreateVariantResult,
  PlatformExportArchiveResult,
  PlatformListArchivesResult,
  PlatformListProfilesResult,
  PlatformListVariantsResult,
  PlatformPreflightResult,
} from "@dramaip/production-delivery/types";
import clsx from "clsx";
import {
  messageOf,
  saveDocument,
  statusOf,
  value,
  type DeliveryRemote,
  type MediaRemote,
  type SystemRemote,
} from "../remote.ts";
import { Lines } from "./CompliancePreflight.tsx";
import {
  parsePlatformPending,
  pendingStore,
  platformPendingKey,
  type PlatformPending,
} from "./pending.ts";
import css from "./Stages.module.css";
import { useLoad } from "./use-load.ts";

type Translate = TranslateNS<"review">;
type Variant = PlatformListVariantsResult[number];
type Archive = PlatformListArchivesResult[number];
/** What an adoption or an archive answers: the original request, as stored. */
type Receipt = Pick<
  PlatformAdoptVariantResult,
  "requestKey" | "aggregateId" | "operation" | "projectId"
> & { input: unknown };

/**
 * The version a platform write reads, as its `If-Match`: the variant
 * version an adoption saw, or the source fingerprint an archive's preflight
 * passed.
 */
const ifMatchOf = (original: PlatformPending): string =>
  `"${
    original.operation === "adopt"
      ? original.input.variantVersion
      : original.input.sourceFingerprint
  }"`;

/** Props of the platform delivery stage of one episode. */
export interface PlatformDeliveryProps extends PropsRenderFactories {
  projectId: string;
  adaptationId: string;
  episodeId: string;
  delivery: DeliveryRemote;
  media: MediaRemote;
  system: SystemRemote;
  t: Translate;
}

/** A write the stage refuses or answers with, by status, as a definite rejection. */
const REJECTED = [400, 404, 409, 412, 428];

/**
 * The platform delivery of one episode: the delivery copy and localization
 * workbenches, creative variants and their explicit adoption, the metadata
 * preflight and the versioned submission archive. It keeps no platform
 * account, login or upload; an adoption or archive whose outcome is unknown
 * stays on this machine under its original key until the author checks it.
 */
export function PlatformDelivery(props: PlatformDeliveryProps) {
  return (
    <Workbench
      key={`${props.projectId}:${props.adaptationId}:${props.episodeId}`}
      {...props}
    />
  );
}

type Working = "save" | "adopt" | "preflight" | "archive" | "export";

function Workbench(props: PlatformDeliveryProps) {
  const { projectId, adaptationId, episodeId, delivery, system, t } = props;
  const [profileId, setProfileId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [label, setLabel] = useState(() => t("platform.form.label.default"));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [coverAssetId, setCoverAssetId] = useState("");
  const [manualFieldsConfirmed, setManualFieldsConfirmed] = useState(false);
  const [preflight, setPreflight] = useState<PlatformPreflightResult>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState<PlatformPending>();
  const [pendingRejected, setPendingRejected] = useState(false);
  const [working, setWorking] = useState<Working>();
  const pendingRef = useRef<PlatformPending | undefined>(undefined);
  const invalidPending = useRef(false);
  const lease = useRef(0);
  const busy = useRef(false);
  const storageKey = platformPendingKey(projectId, adaptationId, episodeId);
  const scope = `${projectId}:${adaptationId}:${episodeId}`;
  const profiles = useLoad("profiles", () =>
    value<PlatformListProfilesResult>(delivery.platformListProfiles()),
  );
  const variants = useLoad(scope, () =>
    value<PlatformListVariantsResult>(
      delivery.platformListVariants(adaptationId, { projectId }),
    ),
  );
  const archives = useLoad(scope, () =>
    value<PlatformListArchivesResult>(
      delivery.platformListArchives(episodeId, { projectId }),
    ),
  );
  const assets = useLoad(projectId, () =>
    value<Array<{ id: string; title: string }>>(
      props.media.assetsList({ projectId }),
    ),
  );
  const variantList = variants.data ?? [];
  const selectedProfile = profiles.data?.find((item) => item.id === profileId);
  const catalogError = profiles.error ?? variants.error ?? archives.error;
  const reloadCatalog = () => {
    profiles.reload();
    variants.reload();
    archives.reload();
  };

  const remember = (next: PlatformPending | undefined) => {
    pendingStore.write(storageKey, next);
    pendingRef.current = next;
    setPending(next);
    setPendingRejected(false);
  };
  const acceptReceipt = (receipt: Receipt, original: PlatformPending) => {
    if (
      receipt.requestKey !== original.key ||
      receipt.aggregateId !== original.aggregateId ||
      receipt.operation !== original.operation ||
      receipt.projectId !== original.projectId ||
      JSON.stringify(receipt.input) !== JSON.stringify(original.input)
    )
      throw new Error(t("platform.notice.mismatch"));
    remember(undefined);
    setPreflight(undefined);
    setManualFieldsConfirmed(false);
    setNotice(
      t(
        receipt.operation === "adopt"
          ? "platform.notice.adopted"
          : "platform.notice.archived",
      ),
    );
    reloadCatalog();
  };
  /** Take the single write lease; nothing while another write or an invalid record holds it. */
  const start = () => {
    if (busy.current || invalidPending.current) return undefined;
    busy.current = true;
    return ++lease.current;
  };
  const alive = (epoch: number) => epoch === lease.current;
  const finish = (epoch: number) => {
    if (!alive(epoch)) return;
    busy.current = false;
    setWorking(undefined);
  };
  const recover = (original: PlatformPending) =>
    value<Receipt>(
      delivery.platformRecoverRequest(original.key, {
        projectId: original.projectId,
      }),
    );
  /**
   * After a definite rejection, read the original key once: a stored
   * outcome is accepted; none at all lets the author retain the rejection.
   */
  const checkRejected = async (
    cause: unknown,
    original: PlatformPending,
    epoch: number,
  ) => {
    if (!REJECTED.includes(statusOf(cause) ?? 0)) return;
    try {
      const receipt = await recover(original);
      if (alive(epoch)) acceptReceipt(receipt, original);
    } catch (readError) {
      if (alive(epoch) && statusOf(readError) === 404) setPendingRejected(true);
    }
  };
  const resetPreflight = (clearConsent = true) => {
    ++lease.current;
    busy.current = false;
    setWorking(undefined);
    setPreflight(undefined);
    if (clearConsent) setManualFieldsConfirmed(false);
  };
  const retainRejected = () => {
    const original = pendingRef.current;
    if (!original || !pendingRejected) return;
    // Only a definite rejection whose original key reads as absent may be
    // set aside, and only by the author; the record itself is kept.
    pendingStore.write(`${storageKey}:rejected:${original.key}`, original);
    remember(undefined);
    resetPreflight();
    setNotice(t("platform.notice.retained"));
    reloadCatalog();
  };
  const recoverPending = async (original: PlatformPending) => {
    const epoch = start();
    if (epoch === undefined) return;
    setWorking("preflight");
    try {
      const receipt = await recover(original);
      if (alive(epoch)) acceptReceipt(receipt, original);
    } catch (cause) {
      if (alive(epoch))
        setNotice(
          t("platform.notice.unconfirmed", { message: messageOf(cause) }),
        );
    } finally {
      finish(epoch);
    }
  };
  const resendPending = async () => {
    const original = pendingRef.current;
    if (!original) return;
    const epoch = start();
    if (epoch === undefined) return;
    setWorking(original.operation === "adopt" ? "adopt" : "archive");
    try {
      const receipt = await value<Receipt>(
        original.operation === "adopt"
          ? delivery.platformAdoptVariant(
              original.aggregateId,
              original.input,
              ifMatchOf(original),
              original.key,
            )
          : delivery.platformCreateArchive(
              original.aggregateId,
              original.input,
              ifMatchOf(original),
              original.key,
            ),
      );
      if (alive(epoch)) acceptReceipt(receipt, original);
    } catch (cause) {
      if (alive(epoch))
        setNotice(
          t("platform.notice.stillPending", { message: messageOf(cause) }),
        );
      await checkRejected(cause, original, epoch);
    } finally {
      finish(epoch);
    }
  };
  useEffect(() => {
    try {
      const stored = pendingStore.read(storageKey);
      if (stored !== undefined) {
        const original = parsePlatformPending(stored, {
          projectId,
          adaptationId,
          episodeId,
        });
        pendingRef.current = original;
        setPending(original);
        void recoverPending(original);
      }
    } catch {
      invalidPending.current = true;
      busy.current = true;
      setNotice(t("platform.notice.invalidPending"));
    }
    return () => {
      ++lease.current;
    };
    // This keyed instance owns one scope. Recovery only reads; it never
    // restores a choice or consent and never writes on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The guard every write shares; the notice says what blocks it. */
  const blocked = (catalogNotice: Parameters<Translate>[0]) => {
    if (catalogError) {
      setNotice(t(catalogNotice));
      return true;
    }
    if (pendingRef.current) {
      setNotice(t("platform.notice.pendingFirst"));
      return true;
    }
    return false;
  };
  const saveVariant = async () => {
    if (blocked("platform.notice.catalogBlocked")) return;
    const tagList = tags
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !label.trim() ||
      !title.trim() ||
      !description.trim() ||
      !tagList.length
    ) {
      setNotice(t("platform.notice.incomplete"));
      return;
    }
    const epoch = start();
    if (epoch === undefined) return;
    setWorking("save");
    setNotice(undefined);
    try {
      const created = await value<PlatformCreateVariantResult>(
        delivery.platformCreateVariant(
          adaptationId,
          {
            label: label.trim(),
            title: title.trim(),
            description: description.trim(),
            tags: tagList,
            ...(coverAssetId ? { coverAssetId } : {}),
            source: "manual",
          },
          undefined,
          undefined,
        ),
      );
      if (!alive(epoch)) return;
      setVariantId(created.id);
      setTitle("");
      setDescription("");
      setTags("");
      setLabel(
        t("platform.form.label.next", {
          letter: String.fromCharCode(
            65 + Math.min(variantList.length + 1, 25),
          ),
        }),
      );
      setPreflight(undefined);
      setManualFieldsConfirmed(false);
      setNotice(t("platform.notice.saved", { label: created.label }));
      variants.reload();
    } catch (cause) {
      if (alive(epoch)) setNotice(messageOf(cause));
    } finally {
      finish(epoch);
    }
  };
  const adoptVariant = async (variant: Variant) => {
    if (blocked("platform.notice.catalogRefresh")) return;
    const epoch = start();
    if (epoch === undefined) return;
    let attempted: PlatformPending | undefined;
    setWorking("adopt");
    setNotice(undefined);
    try {
      const original: PlatformPending = {
        operation: "adopt",
        aggregateId: variant.id,
        key: crypto.randomUUID(),
        projectId,
        adaptationId,
        episodeId,
        input: {
          projectId,
          adaptationId,
          projectVersion: variant.projectVersion,
          adaptationVersion: variant.adaptationVersion,
          variantVersion: variant.version,
          contentFingerprint: variant.contentFingerprint,
          expectedHeadRevision: variant.headRevision,
        },
      };
      remember(original);
      attempted = original;
      const receipt = await value<Receipt>(
        delivery.platformAdoptVariant(
          variant.id,
          original.input,
          ifMatchOf(original),
          original.key,
        ),
      );
      if (alive(epoch)) acceptReceipt(receipt, original);
    } catch (cause) {
      if (alive(epoch)) setNotice(messageOf(cause));
      if (attempted) await checkRejected(cause, attempted, epoch);
    } finally {
      finish(epoch);
    }
  };
  const runPreflight = async () => {
    if (blocked("platform.notice.catalogRefresh")) return;
    if (!profileId || !variantId) {
      setNotice(t("platform.notice.choose"));
      return;
    }
    const epoch = start();
    if (epoch === undefined) return;
    setPreflight(undefined);
    setWorking("preflight");
    setNotice(undefined);
    try {
      const result = await value<PlatformPreflightResult>(
        delivery.platformPreflight(
          episodeId,
          {
            projectId,
            profileId,
            creativeVariantId: variantId,
            manualFieldsConfirmed,
          },
          undefined,
          undefined,
        ),
      );
      if (!alive(epoch)) return;
      setPreflight(result);
      setNotice(
        result.ok
          ? t("platform.notice.passed")
          : t("platform.notice.blocked", { count: result.blockers.length }),
      );
    } catch (cause) {
      if (alive(epoch)) setNotice(messageOf(cause));
    } finally {
      finish(epoch);
    }
  };
  const createArchive = async () => {
    if (blocked("platform.notice.catalogRefresh")) return;
    if (!preflight?.ok) {
      setNotice(t("platform.notice.preflightFirst"));
      return;
    }
    const passed = preflight;
    const epoch = start();
    if (epoch === undefined) return;
    let attempted: PlatformPending | undefined;
    setWorking("archive");
    setNotice(undefined);
    try {
      const original: PlatformPending = {
        operation: "archive",
        aggregateId: episodeId,
        key: crypto.randomUUID(),
        projectId,
        adaptationId,
        episodeId,
        input: {
          ...passed.input,
          sourceFingerprint: passed.sourceFingerprint,
        },
      };
      remember(original);
      attempted = original;
      const receipt = await value<Receipt>(
        delivery.platformCreateArchive(
          episodeId,
          original.input,
          ifMatchOf(original),
          original.key,
        ),
      );
      if (alive(epoch)) acceptReceipt(receipt, original);
    } catch (cause) {
      if (alive(epoch)) setNotice(messageOf(cause));
      if (attempted) await checkRejected(cause, attempted, epoch);
    } finally {
      finish(epoch);
    }
  };
  const exportArchive = async (archive: Archive) => {
    const epoch = start();
    if (epoch === undefined) return;
    setWorking("export");
    setNotice(undefined);
    try {
      const document = await value<PlatformExportArchiveResult>(
        delivery.platformExportArchive(archive.id, { projectId }),
      );
      if (!alive(epoch)) return;
      const saved = await saveDocument(system, document);
      if (alive(epoch))
        setNotice(t(saved ? "platform.notice.exported" : "notice.cancelled"));
    } catch (cause) {
      if (alive(epoch)) setNotice(messageOf(cause));
    } finally {
      finish(epoch);
    }
  };
  const assetTitle = (id: string | undefined) =>
    assets.data?.find((asset) => asset.id === id)?.title ??
    t("platform.cover.none");
  const text = (
    name: Parameters<Translate>[0],
    current: string,
    change: (next: string) => void,
  ) => (
    <label className={css.field}>
      {t(name)}
      <input
        className={css.input}
        value={current}
        placeholder={t(`${name}.placeholder` as Parameters<Translate>[0])}
        onChange={(event) => change(event.target.value)}
      />
    </label>
  );

  return (
    <section
      data-testid={`platform-metadata-${episodeId}`}
      className={css.panel}
    >
      <div className={css.split}>
        {props.renderFactorySlot("automation.creation-record", {
          projectId,
          targetId: episodeId,
          domain: "episodes",
          operation: "delivery-copy",
        })}
        {props.renderFactorySlot("automation.creation-record", {
          projectId,
          targetId: episodeId,
          domain: "episodes",
          operation: "localization",
        })}
      </div>
      <div>
        <p className={css.eyebrow}>{t("platform.eyebrow")}</p>
        <h2 className={css.title}>{t("platform.title")}</h2>
        <p className={css.muted}>{t("platform.description")}</p>
      </div>
      {catalogError !== undefined && (
        <p role="alert" className={css.danger}>
          {t("platform.catalog.failed", { message: messageOf(catalogError) })}
          <Button size="sm" variant="ghost" onClick={reloadCatalog}>
            {t("platform.catalog.reload")}
          </Button>
        </p>
      )}
      <div className={clsx(css.box, css.sunken, css.grid)}>
        <label className={css.field}>
          {t("platform.profile")}
          <select
            aria-label={t("platform.profile")}
            className={css.select}
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value);
              resetPreflight();
            }}
          >
            <option value="">{t("platform.profile.none")}</option>
            {(profiles.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {t("platform.profile.option", {
                  title: profile.title,
                  width: profile.video.width,
                  height: profile.video.height,
                })}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          {t("platform.variant")}
          <select
            aria-label={t("platform.variant")}
            className={css.select}
            value={variantId}
            onChange={(event) => {
              setVariantId(event.target.value);
              resetPreflight();
            }}
          >
            <option value="">{t("platform.variant.none")}</option>
            {variantList.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {t("platform.variant.option", {
                  label: variant.label,
                  version: variant.versionNumber,
                  title: variant.title,
                })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedProfile && (
        <section className={css.box}>
          <p className={css.heading}>{selectedProfile.title}</p>
          <p className={css.muted}>
            {t("platform.profile.spec", {
              platform: selectedProfile.platform,
              region: selectedProfile.region,
              video: selectedProfile.video.videoCodec,
              audio: selectedProfile.video.audioCodec,
              width: selectedProfile.video.width,
              height: selectedProfile.video.height,
            })}
          </p>
          <p className={clsx(css.muted, css.small)}>
            {t("platform.profile.duration", {
              note: selectedProfile.duration.note,
              margin: selectedProfile.subtitleSafeZone.bottomMarginPx,
            })}
          </p>
          <label className={css.check}>
            <input
              type="checkbox"
              checked={manualFieldsConfirmed}
              onChange={(event) => {
                setManualFieldsConfirmed(event.target.checked);
                resetPreflight(false);
              }}
            />
            <span>
              {t("platform.profile.manual", {
                fields: selectedProfile.manualFields.join("；"),
              })}
            </span>
          </label>
        </section>
      )}
      <section className={clsx(css.box, css.sunken, css.grid)}>
        {text("platform.form.label", label, setLabel)}
        <label className={css.field}>
          {t("platform.form.cover")}
          <select
            className={css.select}
            value={coverAssetId}
            onChange={(event) => setCoverAssetId(event.target.value)}
          >
            <option value="">{t("platform.form.cover.none")}</option>
            {(assets.data ?? []).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
        </label>
        {text("platform.form.title", title, setTitle)}
        {text("platform.form.tags", tags, setTags)}
        <label className={clsx(css.field, css.wide)}>
          {t("platform.form.description")}
          <textarea
            className={css.textarea}
            value={description}
            placeholder={t("platform.form.description.placeholder")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className={css.wide}>
          <Button
            variant="outline"
            disabled={working !== undefined}
            onClick={() => void saveVariant()}
          >
            {t(working === "save" ? "busy.saving" : "platform.form.save")}
          </Button>
        </div>
      </section>
      <section className={css.box}>
        <h3 className={css.heading}>{t("platform.variants.title")}</h3>
        {!variantList.length && (
          <p className={css.muted}>{t("platform.variants.empty")}</p>
        )}
        {variantList.map((variant) => (
          <article
            key={variant.id}
            className={clsx(css.item, variant.id === variantId && css.chosen)}
          >
            <div className={css.row}>
              <span className={css.badge}>
                {t(
                  variant.adoptionVerified
                    ? "platform.variant.adopted"
                    : variant.status === "adopted" ||
                        variant.status === "archived"
                      ? "platform.variant.historic"
                      : "platform.variant.draft",
                )}
              </span>
              <span className={css.heading}>
                {t("platform.variant.option", {
                  label: variant.label,
                  version: variant.versionNumber,
                  title: variant.title,
                })}
              </span>
              {!variant.adoptionVerified && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={working !== undefined}
                  onClick={() => void adoptVariant(variant)}
                >
                  {t(
                    working === "adopt"
                      ? "platform.variant.adopting"
                      : "platform.variant.adopt",
                  )}
                </Button>
              )}
            </div>
            <p>{variant.description}</p>
            <p className={clsx(css.muted, css.small)}>
              {t("platform.variant.meta", {
                tags: variant.tags.join("、"),
                cover: assetTitle(variant.coverAssetId),
              })}
            </p>
          </article>
        ))}
      </section>
      <div className={css.row}>
        <Button
          variant="primary"
          disabled={working !== undefined}
          onClick={() => void runPreflight()}
        >
          {t(
            working === "preflight"
              ? "busy.preflight"
              : "platform.preflight.run",
          )}
        </Button>
        <Button
          variant="outline"
          disabled={working !== undefined || !preflight?.ok}
          onClick={() => void createArchive()}
        >
          {t(
            working === "archive"
              ? "platform.archive.creating"
              : "platform.archive.create",
          )}
        </Button>
      </div>
      {preflight && <PreflightView preflight={preflight} t={t} />}
      {pending && (
        <section
          data-testid="platform-metadata-pending"
          className={clsx(css.box, css.pending)}
        >
          <p className={css.break}>
            {t("platform.pending", {
              operation: t(
                pending.operation === "adopt"
                  ? "platform.pending.adopt"
                  : "platform.pending.archive",
              ),
              key: pending.key,
            })}
          </p>
          <div className={css.row}>
            <Button
              size="sm"
              variant="outline"
              disabled={working !== undefined}
              onClick={() => void recoverPending(pending)}
            >
              {t("platform.pending.recover")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working !== undefined}
              onClick={() => void resendPending()}
            >
              {t("platform.pending.resend")}
            </Button>
            {pendingRejected && (
              <Button
                size="sm"
                variant="outline"
                disabled={working !== undefined}
                onClick={retainRejected}
              >
                {t("platform.pending.retain")}
              </Button>
            )}
          </div>
        </section>
      )}
      {notice && <p className={css.notice}>{notice}</p>}
      <section className={css.box}>
        <h3 className={css.heading}>{t("platform.archives.title")}</h3>
        {!archives.data?.length && (
          <p className={css.muted}>{t("platform.archives.empty")}</p>
        )}
        {(archives.data ?? []).map((archive) => (
          <div key={archive.id} className={clsx(css.item, css.row)}>
            <span>
              {t("platform.archive.version", {
                version: String(archive.deliveryVersion).padStart(3, "0"),
              })}
            </span>
            <span className={css.muted}>
              {t("platform.archive.meta", {
                profile: archive.profileId,
                at: archive.createdAt,
              })}
            </span>
            {archive.scope === "legacy-submission-metadata-unverified" && (
              <span>{t("platform.archive.legacy")}</span>
            )}
            {archive.scope === "submission-metadata-only" && (
              <span className={css.break}>
                {t("platform.archive.frozen", {
                  title: archive.preflight.snapshot?.variant.title ?? "",
                  sha: archive.sourceFingerprint,
                })}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={working !== undefined}
              onClick={() => void exportArchive(archive)}
            >
              {t(
                working === "export"
                  ? "busy.exporting"
                  : "platform.archive.export",
              )}
            </Button>
          </div>
        ))}
      </section>
    </section>
  );
}

/** The metadata preflight of one profile and variant, with its stated scope. */
export function PreflightView({
  preflight,
  t,
}: {
  preflight: PlatformPreflightResult;
  t: Translate;
}) {
  return (
    <section className={clsx(css.box, preflight.ok ? css.passed : css.failed)}>
      <p className={css.heading}>
        {t(preflight.ok ? "platform.result.passed" : "platform.result.failed")}
      </p>
      <p>{t("platform.result.scope")}</p>
      {preflight.snapshot && (
        <p data-testid="platform-metadata-original" className={css.break}>
          {t("platform.result.original", {
            title: preflight.snapshot.variant.title,
            version: preflight.snapshot.variant.version,
            revision: preflight.snapshot.variant.headRevision,
            sha: preflight.sourceFingerprint,
          })}
        </p>
      )}
      {preflight.finalBaseName && (
        <p className={clsx(css.muted, css.small)}>
          {t("platform.result.prefix", { name: preflight.finalBaseName })}
        </p>
      )}
      <Lines items={preflight.blockers} tone={css.danger} />
      <Lines items={preflight.warnings} tone={css.warning} />
      <p className={clsx(css.muted, css.small)}>
        {t("platform.result.files", {
          files: preflight.expectedFiles.join("、"),
        })}
      </p>
    </section>
  );
}
