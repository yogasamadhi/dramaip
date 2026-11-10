import { useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { WorkflowsRunEpisodeInput } from "@dramaip/automation-automation/types";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import clsx from "clsx";
import type {} from "../contract.ts";
import { messageOf, value, type AutomationRemote } from "../remote.ts";
import css from "./Stages.module.css";

type WorkflowKind = WorkflowsRunEpisodeInput["kind"];

/** The checks of the checklist, in the order the work goes. */
const KINDS = [
  "compliance-check",
  "review-package",
  "minimal-redo-plan",
  "animatic-draft",
  "render-preflight",
  "delivery-preflight",
] as const satisfies readonly WorkflowKind[];

/** Props of the episode workflow section. */
export type EpisodeWorkflowProps = PropsRuntime<"review.section"> &
  PropsLocale<"review"> & { automation: AutomationRemote };

/**
 * The episode's delivery checklist: each check runs as a traceable task and
 * reports; none changes a script, shot or delivery. Nothing until a project
 * and an episode are chosen.
 */
export function EpisodeWorkflow(props: EpisodeWorkflowProps) {
  return props.projectId && props.episodeId ? (
    <Checklist key={`${props.projectId}:${props.episodeId}`} {...props} />
  ) : null;
}

function Checklist({
  projectId,
  episodeId,
  automation,
  t,
}: EpisodeWorkflowProps) {
  const [notice, setNotice] = useState<string>();
  const [running, setRunning] = useState<WorkflowKind>();
  const [results, setResults] = useState<
    Partial<Record<WorkflowKind, "done" | "failed">>
  >({});
  const run = async (kind: WorkflowKind) => {
    setRunning(kind);
    try {
      const result = await value<{ summary: string }>(
        automation.workflowsRunEpisode(
          { projectId, episodeId, kind },
          undefined,
          crypto.randomUUID(),
        ),
      );
      setNotice(result.summary);
      setResults((current) => ({ ...current, [kind]: "done" }));
    } catch (cause) {
      setNotice(messageOf(cause));
      setResults((current) => ({ ...current, [kind]: "failed" }));
    } finally {
      setRunning(undefined);
    }
  };
  return (
    <section className={css.panel}>
      <div>
        <h2 className={css.heading}>{t("workflow.title")}</h2>
        <p className={clsx(css.muted, css.small)}>
          {t("workflow.description")}
        </p>
      </div>
      <p className={css.muted}>
        {t("workflow.legacy")}
        <a
          className={css.link}
          href={`#/projects/${encodeURIComponent(projectId)}/tools/quality-review`}
        >
          {t("workflow.quality")}
        </a>
      </p>
      <ol aria-label={t("workflow.list")} className={css.steps}>
        {KINDS.map((kind, index) => {
          const result = results[kind];
          const label = t(`workflow.kind.${kind}`);
          return (
            <li key={kind} className={css.step}>
              <span className={css.stepNumber}>{index + 1}</span>
              <div className={css.grow}>
                <p className={css.heading}>{label}</p>
                <p className={clsx(css.muted, css.small)}>
                  {t(`workflow.kind.${kind}.description`)}
                </p>
              </div>
              <span
                className={clsx(
                  css.small,
                  result === "done"
                    ? css.success
                    : result === "failed"
                      ? css.danger
                      : css.muted,
                )}
              >
                {t(
                  running === kind
                    ? "workflow.state.running"
                    : result === "done"
                      ? "workflow.state.done"
                      : result === "failed"
                        ? "workflow.state.failed"
                        : "workflow.state.idle",
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label={label}
                disabled={running !== undefined}
                onClick={() => void run(kind)}
              >
                {t("workflow.run")}
              </Button>
            </li>
          );
        })}
      </ol>
      {running && <p className={css.muted}>{t("workflow.running")}</p>}
      {notice && <p className={css.notice}>{notice}</p>}
    </section>
  );
}
