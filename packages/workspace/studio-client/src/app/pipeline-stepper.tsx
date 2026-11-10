import clsx from "clsx";
import {
  IconWarningTriangleOutlineRegular as AlertTriangle,
  IconCheckCircleOutlineRegular as CheckCircle2,
  IconCircleOutlineRegular as Circle,
  IconQuestionOutlineRegular as HelpCircle,
  IconLoadingOutlineRegular as Loader2,
  IconUserCheckOutlineRegular as UserCheck,
} from "@dramaip/infra-ui-primitives";
import { Link } from "./router";
import type { ProjectCockpit } from "./project-cockpit";
import styles from "./pipeline-stepper.module.css";

export type PipelineStep = NonNullable<ProjectCockpit["gates"]>[number];

const STATUS_ICON = {
  ready: CheckCircle2,
  pending: Circle,
  "needs-human": UserCheck,
  working: Loader2,
  stale: AlertTriangle,
  unverified: HelpCircle,
} satisfies Record<PipelineStep["status"], unknown>;

const STATUS_TONE: Record<PipelineStep["status"], string> = {
  ready: styles.c1,
  pending: styles.c2,
  "needs-human": styles.c3,
  working: styles.c4,
  stale: styles.c5,
  unverified: styles.c2,
};

/**
 * Ordered, numbered view of a project's result gates. Each step stays an
 * `article` labelled by the gate name and carries `data-gate-status`, so the
 * cockpit and adaptation pages share one rendering and one test contract.
 * The first step that is not ready is marked as the current step.
 */
export function PipelineStepper(props: {
  label: string;
  steps: readonly PipelineStep[];
  linkLabel?: string;
  className?: string;
}) {
  const currentIndex = props.steps.findIndex((step) => step.status !== "ready");
  const columns =
    props.steps.length <= 2
      ? styles.c6
      : props.steps.length === 4
        ? styles.c7
        : styles.c8;
  return (
    <ol
      aria-label={props.label}
      className={clsx(styles.c9, columns, props.className)}
    >
      {props.steps.map((step, index) => {
        const Icon = STATUS_ICON[step.status];
        const current = index === currentIndex;
        return (
          <li key={step.id} className={styles.c10}>
            <article
              aria-label={step.label}
              aria-current={current ? "step" : undefined}
              data-gate-status={step.status}
              className={clsx(styles.c11, current ? styles.c12 : styles.c13)}
            >
              <div className={styles.c14}>
                <span className={styles.c15}>{index + 1}</span>
                <div className={styles.c16}>
                  <h3 className={styles.c17}>{step.label}</h3>
                  <p className={clsx(styles.c18, STATUS_TONE[step.status])}>
                    <Icon
                      aria-hidden="true"
                      className={clsx(
                        styles.c19,
                        step.status === "working" && styles.c20,
                      )}
                    />
                    {step.statusLabel}
                  </p>
                </div>
              </div>
              <p className={styles.c21}>{step.detail}</p>
              {props.linkLabel && (
                <Link to={step.to} className={styles.c22}>
                  {props.linkLabel}
                </Link>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
