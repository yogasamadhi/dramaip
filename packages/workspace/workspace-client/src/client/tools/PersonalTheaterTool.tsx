import clsx from "clsx";
import { useEffect, useState } from "react";
import type {} from "@dramaip/automation-automation-client/client/contract";
import { Button, Input } from "@dramaip/infra-ui-primitives";
import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type { LikenessSubjectsListResult } from "@dramaip/production-media/types";
import { messageOf, value, type ToolRemotes } from "./remote.ts";
import css from "./Tools.module.css";

/** Full component props of a project tool body. */
export type ToolProps = PropsRuntime<"workspace.tool"> &
  PropsLocale<"workspace"> &
  PropsRenderFactories &
  ToolRemotes;

type Subject = LikenessSubjectsListResult[number];
type Relationship = Subject["relationship"];
type AgeBand = Subject["ageBand"];

const YEAR = 365 * 24 * 60 * 60_000;

/** A notice and whether it reports a failure. */
type Notice = { text: string; failed: boolean };

/**
 * The people of a personal theater project: add one, record each person's
 * consent (with a guardian's for a minor, and a separate one under 14),
 * attach a photo through a Host file grant, revoke consent. The creation
 * workbench opens once every person's consent is active.
 */
export function PersonalTheaterTool(props: ToolProps) {
  const { projectId, media, system, t } = props;
  const [subjects, setSubjects] = useState<readonly Subject[]>([]);
  const [readError, setReadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [relationship, setRelationship] = useState<Relationship>("self");
  const [ageBand, setAgeBand] = useState<AgeBand>("adult");
  const [notice, setNotice] = useState<Notice>();
  useEffect(() => {
    let live = true;
    void value(media.likenessSubjectsList(projectId)).then(
      (items) => {
        if (!live) return;
        setSubjects(items);
        setReadError(undefined);
      },
      (cause: unknown) => live && setReadError(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, [media, projectId, revision]);
  const refresh = () => setRevision((current) => current + 1);
  const run = async (write: () => Promise<unknown>, done?: string) => {
    try {
      await write();
      if (done) setNotice({ text: done, failed: false });
      refresh();
    } catch (cause) {
      setNotice({ text: messageOf(cause), failed: true });
    }
  };
  const create = () => {
    const name = displayName.trim();
    if (!name) return;
    void run(async () => {
      await value(
        media.likenessSubjectsCreate(
          projectId,
          { displayName: name, relationship, ageBand },
          undefined,
          undefined,
        ),
      );
      setDisplayName("");
    }, t("theater.created"));
  };
  const confirmConsent = (subject: Subject) =>
    void run(
      () =>
        value(
          media.likenessSubjectsConsent(
            subject.id,
            {
              purposeScopes: [t("theater.purpose")],
              validUntil: new Date(Date.now() + YEAR).toISOString(),
              participantConfirmed: true,
              ...(subject.ageBand !== "adult"
                ? { guardianConfirmed: true }
                : {}),
              ...(subject.ageBand === "under_14"
                ? { under14SeparateConsentConfirmed: true }
                : {}),
            },
            undefined,
            undefined,
          ),
        ),
      t("theater.consented"),
    );
  const attachPhoto = async (subject: Subject) => {
    try {
      const files = await value(
        system.pickFiles({
          multiple: false,
          extensions: ["png", "jpg", "jpeg", "webp"],
        }),
      );
      const file = files?.[0];
      if (!file) return;
      await run(
        () =>
          value(
            media.likenessSubjectsAttachPhoto(
              subject.id,
              { grantId: file.grantId },
              undefined,
              undefined,
            ),
          ),
        t("theater.photo"),
      );
    } catch (cause) {
      setNotice({ text: messageOf(cause), failed: true });
    }
  };
  const revoke = (subject: Subject) =>
    void run(() =>
      value(media.likenessSubjectsRevoke(subject.id, undefined, undefined)),
    );
  const allConsented =
    subjects.length > 0 &&
    subjects.every((subject) => subject.consentStatus === "active");
  return (
    <section className={css.tool}>
      {allConsented && (
        <details aria-label={t("legacyEpisode.label")} className={css.legacy}>
          <summary>{t("legacyEpisode.summary")}</summary>
          <p className={css.muted}>{t("legacyEpisode.note")}</p>
          {props.renderFactorySlot("automation.creation-workbench", {
            projectId,
            operation: "episode",
            defaultInstruction: t("theater.workbench"),
          })}
        </details>
      )}
      <p className={css.boundary}>{t("theater.boundary")}</p>
      <div className={css.form}>
        <Input
          aria-label={t("theater.name")}
          placeholder={t("theater.name")}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <select
          aria-label={t("theater.relationship")}
          className={css.select}
          value={relationship}
          onChange={(event) => {
            const next = event.target.value as Relationship;
            setRelationship(next);
            setAgeBand(next === "minor" ? "minor_14_to_17" : "adult");
          }}
        >
          {(["self", "adult_relative_or_friend", "minor"] as const).map(
            (option) => (
              <option key={option} value={option}>
                {t(`theater.relationship.${option}`)}
              </option>
            ),
          )}
        </select>
        <select
          aria-label={t("theater.age")}
          className={css.select}
          disabled={relationship !== "minor"}
          value={ageBand}
          onChange={(event) => setAgeBand(event.target.value as AgeBand)}
        >
          {(["adult", "minor_14_to_17", "under_14"] as const).map((option) => (
            <option key={option} value={option}>
              {t(`theater.age.${option}`)}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={create}>
          {t("theater.add")}
        </Button>
      </div>
      {notice && (
        <p
          role={notice.failed ? "alert" : "status"}
          className={notice.failed ? css.danger : css.notice}
        >
          {notice.text}
        </p>
      )}
      {readError && (
        <p role="alert" className={css.danger}>
          {readError}
        </p>
      )}
      <div className={css.list}>
        {subjects.map((subject) => (
          <article key={subject.id} className={css.subject}>
            <div className={css.subjectText}>
              <p className={css.name}>{subject.displayName}</p>
              <p className={clsx(css.muted, css.small)}>
                {t("theater.subject", {
                  relationship: t(
                    `theater.relationship.${subject.relationship}`,
                  ),
                  age: t(`theater.age.${subject.ageBand}`),
                  consent: t(`theater.consent.${subject.consentStatus}`),
                })}
              </p>
            </div>
            {subject.consentStatus !== "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => confirmConsent(subject)}
              >
                {t("theater.confirm")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={subject.consentStatus !== "active"}
              onClick={() => void attachPhoto(subject)}
            >
              {t("theater.attach")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={subject.consentStatus === "revoked"}
              onClick={() => revoke(subject)}
            >
              {t("theater.revoke")}
            </Button>
          </article>
        ))}
        {!subjects.length && (
          <div className={css.empty}>
            <p className={css.name}>{t("theater.empty.title")}</p>
            <p className={css.muted}>{t("theater.empty.description")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
