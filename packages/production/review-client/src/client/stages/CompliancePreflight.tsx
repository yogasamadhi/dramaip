import { useEffect, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import clsx from "clsx";
import { messageOf, value, type ReviewRemote } from "../remote.ts";
import type {
  CompliancePreflight as Preflight,
  ComplianceProfile,
} from "./answers.ts";
import css from "./Stages.module.css";
import { useLoad } from "./use-load.ts";

/** Props of the compliance stage of one episode. */
export interface CompliancePreflightProps {
  episodeId: string;
  episodeTitle: string;
  review: ReviewRemote;
  t: TranslateNS<"review">;
}

const INTEGRITY = {
  verified: "compliance.integrity.verified",
  invalid: "compliance.integrity.invalid",
  unchecked: "compliance.integrity.unverified",
} as const;

/**
 * The versioned rule profiles, the author's declarations and the episode's
 * compliance preflight. A profile is local evidence, not legal advice; the
 * preflight forges no compliant cut, watermark or platform verdict.
 */
export function CompliancePreflight({
  episodeId,
  episodeTitle,
  review,
  t,
}: CompliancePreflightProps) {
  const [title, setTitle] = useState(episodeTitle);
  const [language, setLanguage] = useState(() =>
    t("compliance.form.language.default"),
  );
  const [platform, setPlatform] = useState("");
  const [region, setRegion] = useState(() =>
    t("compliance.form.region.default"),
  );
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [aigcDeclared, setAigcDeclared] = useState(false);
  const [manualReview, setManualReview] = useState(false);
  const [result, setResult] = useState<Preflight>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!title && episodeTitle) setTitle(episodeTitle);
  }, [episodeTitle, title]);
  const profiles = useLoad("profiles", () =>
    value<ComplianceProfile[]>(review.complianceListProfiles()),
  );
  const activate = async (id: string) => {
    setWorking(true);
    setNotice(undefined);
    try {
      const profile = await value<ComplianceProfile>(
        review.complianceActivateProfile(id, undefined, undefined),
      );
      setNotice(t("compliance.notice.activated", { title: profile.title }));
      profiles.reload();
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(false);
    }
  };
  const preflight = async () => {
    if (!title.trim() || !language.trim() || !date) {
      setNotice(t("compliance.notice.incomplete"));
      return;
    }
    setWorking(true);
    setNotice(undefined);
    try {
      const next = await value<Preflight>(
        review.compliancePreflight(
          episodeId,
          {
            title: title.trim(),
            subtitleLanguage: language.trim(),
            ...(platform.trim() ? { targetPlatform: platform.trim() } : {}),
            ...(region.trim() ? { targetRegion: region.trim() } : {}),
            deliveryDate: date,
            aigcDeclared,
            manualContentReviewConfirmed: manualReview,
          },
          undefined,
          undefined,
        ),
      );
      setResult(next);
      setNotice(
        t(next.ok ? "compliance.notice.passed" : "compliance.notice.blocked"),
      );
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(false);
    }
  };
  const text = (
    label: string,
    current: string,
    change: (next: string) => void,
    type = "text",
  ) => (
    <label className={css.field}>
      {label}
      <input
        className={css.input}
        type={type}
        value={current}
        onChange={(event) => change(event.target.value)}
      />
    </label>
  );
  return (
    <section className={css.panel}>
      <div>
        <p className={css.eyebrow}>{t("compliance.eyebrow")}</p>
        <h2 className={css.title}>{t("compliance.title")}</h2>
        <p className={css.muted}>{t("compliance.description")}</p>
      </div>
      <section className={css.box}>
        <h3 className={css.heading}>{t("compliance.profiles")}</h3>
        {(profiles.data ?? []).map((profile) => (
          <div key={profile.id} className={css.item}>
            <div className={css.row}>
              <span className={css.heading}>{profile.title}</span>
              <span className={css.muted}>{profile.version}</span>
              <span className={css.badge}>
                {t(
                  profile.active
                    ? "compliance.profile.active"
                    : profile.sourceStatus === "official"
                      ? "compliance.profile.official"
                      : "compliance.profile.reference",
                )}
              </span>
              {!profile.active &&
                profile.sourceStatus === "official" &&
                profile.integrityStatus === "verified" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={working}
                    onClick={() => void activate(profile.id)}
                  >
                    {t("compliance.profile.activate")}
                  </Button>
                )}
            </div>
            <p className={clsx(css.muted, css.small)}>
              {t("compliance.profile.meta", {
                date: profile.publishedAt.slice(0, 10),
                integrity: t(INTEGRITY[profile.integrityStatus]),
                regions:
                  profile.regions.join("、") || t("compliance.regions.none"),
              })}
            </p>
          </div>
        ))}
      </section>
      <section className={clsx(css.box, css.sunken, css.grid)}>
        {text(t("compliance.form.title"), title, setTitle)}
        {text(t("compliance.form.language"), language, setLanguage)}
        {text(t("compliance.form.platform"), platform, setPlatform)}
        {text(t("compliance.form.region"), region, setRegion)}
        {text(t("compliance.form.date"), date, setDate, "date")}
        <div className={css.field}>
          <label className={css.check}>
            <input
              type="checkbox"
              checked={aigcDeclared}
              onChange={(event) => setAigcDeclared(event.target.checked)}
            />
            <span>{t("compliance.form.aigc")}</span>
          </label>
          <label className={css.check}>
            <input
              type="checkbox"
              checked={manualReview}
              onChange={(event) => setManualReview(event.target.checked)}
            />
            <span>{t("compliance.form.manual")}</span>
          </label>
        </div>
        <div className={css.wide}>
          <Button
            variant="primary"
            disabled={working}
            onClick={() => void preflight()}
          >
            {t(working ? "busy.preflight" : "compliance.run")}
          </Button>
        </div>
      </section>
      {result && (
        <section className={clsx(css.box, result.ok ? css.passed : css.failed)}>
          <p className={css.heading}>
            {t(
              result.ok
                ? "compliance.result.passed"
                : "compliance.result.failed",
            )}
            {result.visibleLabel
              ? t("compliance.result.label", { label: result.visibleLabel })
              : ""}
          </p>
          <Lines items={result.blockers} tone={css.danger} />
          <Lines items={result.warnings} tone={css.warning} />
          <p className={clsx(css.muted, css.small, css.break)}>
            {t("compliance.result.fingerprint", {
              sha: result.sourceFingerprint,
            })}
          </p>
        </section>
      )}
      {notice && <p className={css.notice}>{notice}</p>}
    </section>
  );
}

/** A list of blockers or warnings in their tone; nothing when empty. */
export function Lines({
  items,
  tone,
}: {
  items: readonly string[];
  tone: string | undefined;
}) {
  return items.length ? (
    <ul className={clsx(css.list, tone)}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : null;
}
