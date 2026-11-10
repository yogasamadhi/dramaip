import clsx from "clsx";
import css from "./Cockpit.module.css";
import type { ProjectCockpit } from "./derive.ts";

export type PipelineStep = NonNullable<ProjectCockpit["gates"]>[number];

const STATUS_TONE: Record<PipelineStep["status"], string | undefined> = {
  ready: css.ready,
  pending: css.pending,
  "needs-human": css.needsHuman,
  working: css.working,
  stale: css.stale,
  unverified: css.unverified,
};

/**
 * Ordered, numbered view of a project's result gates. Each step stays an
 * `article` labelled by the gate name and carries `data-gate-status`; the
 * first step that is not ready is marked as the current step.
 */
export function PipelineStepper(props: {
  label: string;
  steps: readonly PipelineStep[];
  linkLabel?: string;
}) {
  const currentIndex = props.steps.findIndex((step) => step.status !== "ready");
  const columns =
    props.steps.length <= 2
      ? css.steps2
      : props.steps.length === 4
        ? css.steps4
        : css.steps3;
  return (
    <ol aria-label={props.label} className={clsx(css.steps, columns)}>
      {props.steps.map((step, index) => {
        const current = index === currentIndex;
        return (
          <li key={step.id} className={css.step}>
            <article
              aria-label={step.label}
              aria-current={current ? "step" : undefined}
              data-gate-status={step.status}
              className={clsx(css.gate, current && css.current)}
            >
              <div className={css.gateHead}>
                <span className={css.index}>{index + 1}</span>
                <div>
                  <h3 className={css.gateName}>{step.label}</h3>
                  <p className={clsx(css.state, STATUS_TONE[step.status])}>
                    <span aria-hidden="true" className={css.dot} />
                    {step.statusLabel}
                  </p>
                </div>
              </div>
              <p className={css.detail}>{step.detail}</p>
              {props.linkLabel && (
                <a className={css.gateLink} href={`#${step.to}`}>
                  {props.linkLabel}
                </a>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
