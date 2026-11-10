import type { DeliveryEvidenceResult } from "@dramaip/production-media/types";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import css from "./Evidence.module.css";

/** What the delivery evidence factory shows: one exact record's evidence. */
export interface DeliveryEvidenceProps {
  value: DeliveryEvidenceResult;
}

/**
 * The read-only delivery evidence of one exact media record version: its
 * source, the user's declarations, its archive and its latest full read.
 * Nothing here verifies a file or releases a delivery.
 */
export function DeliveryEvidence({
  value,
  t,
}: DeliveryEvidenceProps & { t: TranslateNS<"media"> }) {
  const declaration = (key: string) =>
    t(`evidence.declaration.${key}` as Parameters<typeof t>[0]);
  return (
    <div className={css.evidence} data-testid="media-delivery-evidence-result">
      <p>
        {t("evidence.record", {
          recordId: value.recordId,
          version: value.recordVersion,
        })}
      </p>
      <p>{t("evidence.unverified")}</p>
      <p>
        {t("evidence.declarations", {
          source: t(`evidence.source.${value.source.state}`),
          rights: declaration(value.declarations.rightsDeclaration),
          cost: declaration(value.declarations.costDeclaration),
          provider: declaration(value.declarations.providerDeclaration),
        })}
      </p>
      <p>
        {value.archive
          ? t("evidence.archive", {
              artifactId: value.archive.artifactId,
              size: value.archive.sizeBytes,
              sha: value.archive.sha256,
            })
          : t("evidence.archive.none")}
      </p>
      <p>
        {value.latestByteRead
          ? t("evidence.read", {
              id: value.latestByteRead.id,
              at: value.latestByteRead.verifiedAt,
              sha: value.latestByteRead.descriptor.sha256,
              binding: t(
                `evidence.binding.${value.latestByteRead.currentArchiveBinding}`,
              ),
            })
          : t("evidence.read.none")}
      </p>
      {value.blockers.length ? (
        <p role="alert" className={css.alert}>
          {t("evidence.blockers", {
            list: value.blockers
              .map((code) =>
                t("evidence.blocker", {
                  label: t(`evidence.blocker.${code}`),
                  code,
                }),
              )
              .join(" · "),
          })}
        </p>
      ) : (
        <p>{t("evidence.blockers.none")}</p>
      )}
    </div>
  );
}
