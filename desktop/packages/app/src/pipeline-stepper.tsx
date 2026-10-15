import { cn } from "@dramaip/ui-shared";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  HelpCircle,
  Loader2,
  UserCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectCockpit } from "./project-cockpit";

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
  ready: "text-success-strong",
  pending: "text-muted",
  "needs-human": "text-brand",
  working: "text-info-strong",
  stale: "text-warning-strong",
  unverified: "text-muted",
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
      ? "md:grid-cols-2"
      : props.steps.length === 4
        ? "md:grid-cols-2 xl:grid-cols-4"
        : "md:grid-cols-3";
  return (
    <ol
      aria-label={props.label}
      className={cn("grid gap-3", columns, props.className)}
    >
      {props.steps.map((step, index) => {
        const Icon = STATUS_ICON[step.status];
        const current = index === currentIndex;
        return (
          <li key={step.id} className="min-w-0">
            <article
              aria-label={step.label}
              aria-current={current ? "step" : undefined}
              data-gate-status={step.status}
              className={cn(
                "flex h-full flex-col rounded-lg border bg-surface-raised p-3",
                current
                  ? "border-brand/40 ring-1 ring-brand/20"
                  : "border-line",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-semibold tabular-nums text-muted">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">
                    {step.label}
                  </h3>
                  <p
                    className={cn(
                      "mt-1 flex items-center gap-1 text-xs font-medium",
                      STATUS_TONE[step.status],
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 shrink-0",
                        step.status === "working" && "animate-spin",
                      )}
                    />
                    {step.statusLabel}
                  </p>
                </div>
              </div>
              <p className="mt-2 flex-1 text-xs leading-5 text-muted">
                {step.detail}
              </p>
              {props.linkLabel && (
                <Link
                  to={step.to}
                  className="mt-2 self-start text-xs font-medium text-link underline underline-offset-2"
                >
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
