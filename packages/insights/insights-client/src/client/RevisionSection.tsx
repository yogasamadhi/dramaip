import { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/automation-automation-client/client/contract";
import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/writing-writing/remote";
import css from "./RevisionSection.module.css";
import type {} from "./contract.ts";

/** The `writing` Remote namespace: the chapters a revision may target. */
type WritingRemote = Context["remote"]["writing"];
/** The `production` Remote namespace: the scripts a revision may target. */
type ProductionRemote = Context["remote"]["production"];

/** One revisable chapter or script. */
interface Target {
  id: string;
  title: string;
  projectId: string;
  version?: number;
}

/** A Remote answer: the value, or the failure. */
type Answer =
  { ok: true; value: unknown } | { ok: false; error: { message: string } };

async function list(answer: Promise<Answer>): Promise<Target[]> {
  const result = await answer;
  if (!result.ok) throw new Error(result.error.message);
  return result.value as Target[];
}

/** Props of the feedback revision section. */
export type RevisionSectionProps = PropsRuntime<"insights.section"> &
  PropsRenderFactories &
  PropsLocale<"insights"> & {
    writing: WritingRemote;
    production: ProductionRemote;
  };

/**
 * The revision workbench of one feedback cluster: the author picks the
 * chapter or script to revise, since feedback carries no reliable location,
 * and the creation workbench drafts the revision. Nothing until a project
 * and a cluster are chosen.
 */
export function RevisionSection(props: RevisionSectionProps) {
  const { projectId, revisionClusterId } = props;
  return projectId && revisionClusterId ? (
    <Revision
      key={`${projectId}:${revisionClusterId}`}
      {...props}
      projectId={projectId}
      clusterId={revisionClusterId}
    />
  ) : null;
}

function Revision({
  projectId,
  clusterId,
  writing,
  production,
  renderFactorySlot,
  t,
}: RevisionSectionProps & { clusterId: string }) {
  const [targetId, setTargetId] = useState("");
  const [targets, setTargets] = useState<{
    chapters: Target[];
    scripts: Target[];
  }>({ chapters: [], scripts: [] });
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    Promise.all([
      list(writing.chaptersList(projectId)),
      list(production.scriptsList({ projectId })),
    ]).then(
      ([chapters, scripts]) => {
        if (!current) return;
        const own = (item: Target) => item.projectId === projectId;
        setTargets({
          chapters: chapters.filter(own),
          scripts: scripts.filter(own),
        });
      },
      (cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [writing, production, projectId]);
  const chapter = targets.chapters.find((item) => item.id === targetId);
  const script = targets.scripts.some((item) => item.id === targetId);
  return (
    <section className={css.card}>
      <h2 className={css.title}>{t("revision.title")}</h2>
      <p className={css.muted}>{t("revision.note")}</p>
      {error && (
        <p role="alert" className={css.danger}>
          {error}
        </p>
      )}
      <select
        aria-label={t("revision.target")}
        className={css.select}
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
      >
        <option value="">{t("revision.choose")}</option>
        {targets.chapters.map((item) => (
          <option key={item.id} value={item.id}>
            {t("revision.chapter", { title: item.title })}
          </option>
        ))}
        {targets.scripts.map((item) => (
          <option key={item.id} value={item.id}>
            {t("revision.script", { title: item.title })}
          </option>
        ))}
      </select>
      {chapter
        ? renderFactorySlot("automation.creation-workbench", {
            projectId,
            operation: "chapter",
            targetId,
            baseVersion: chapter.version,
            feedbackClusterId: clusterId,
            defaultInstruction: t("revision.chapterInstruction"),
          })
        : script
          ? renderFactorySlot("automation.creation-record", {
              projectId,
              domain: "scripts",
              operation: "script-revision",
              targetId,
              feedbackClusterId: clusterId,
              defaultInstruction: t("revision.scriptInstruction"),
            })
          : null}
    </section>
  );
}
