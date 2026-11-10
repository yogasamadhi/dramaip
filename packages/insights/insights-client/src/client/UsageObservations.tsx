import { useEffect, useRef, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  AgentUsageNumber,
  AgentUsageObservationPage,
} from "@dramaip/insights-insights/types";
import {
  messageOf,
  value,
  type AgentsRemote,
  type Translate,
} from "./outcome-reads.ts";
import css from "./Outcomes.module.css";

const SCOPES = {
  "response-increment": "outcomes.usage.scope.response",
  "run-total": "outcomes.usage.scope.run",
  "session-total": "outcomes.usage.scope.session",
  unspecified: "outcomes.usage.scope.unspecified",
} as const;

const ACCOUNTING = {
  "includes-cache": "outcomes.usage.accounting.includes",
  "excludes-cache": "outcomes.usage.accounting.excludes",
} as const;

function reported(
  t: Translate,
  number: { status: string; value?: unknown },
  invalid: Parameters<Translate>[0],
  unreported: Parameters<Translate>[0],
  format: (value: never) => string = String,
): string {
  return number.status === "reported"
    ? format(number.value as never)
    : t(number.status === "invalid" ? invalid : unreported);
}

const tokens = (t: Translate, number: AgentUsageNumber) =>
  reported(
    t,
    number,
    "outcomes.usage.token.invalid",
    "outcomes.usage.token.unreported",
    (count: number) => count.toLocaleString(),
  );

/** The engine's own usage reports for one run, never billing or totals. */
export function UsageObservationView({
  pages,
  t,
}: {
  pages: readonly AgentUsageObservationPage[];
  t: Translate;
}) {
  const current = pages[0]!;
  return (
    <div className={css.compact} aria-label={t("outcomes.usage.aria")}>
      <p className={css.small}>
        {t("outcomes.usage.run", {
          runId: current.runId,
          count: current.observationCount,
        })}
      </p>
      <p className={css.small}>
        {t("outcomes.usage.scopeLine", {
          scope: current.projectId
            ? t("outcomes.usage.scope.project", {
                projectId: current.projectId,
              })
            : t("outcomes.usage.scope.global"),
        })}
      </p>
      {!current.observationCount && (
        <p className={css.text}>{t("outcomes.usage.empty")}</p>
      )}
      {pages
        .flatMap((page) => page.items)
        .map((item) => (
          <div key={item.cursor} className={css.item}>
            <p className={css.text}>
              {t("outcomes.usage.item.scope", {
                scope: t(SCOPES[item.measurementScope]),
                cursor: item.cursor,
              })}
            </p>
            <p className={css.text}>
              {t("outcomes.usage.item.tokens", {
                input: tokens(t, item.inputTokens),
                output: tokens(t, item.outputTokens),
                cached: tokens(t, item.cachedTokens),
              })}
            </p>
            <p className={css.text}>
              {item.costEstimate
                ? t("outcomes.usage.cost", {
                    amount: reported(
                      t,
                      item.costEstimate.amount,
                      "outcomes.usage.amount.invalid",
                      "outcomes.usage.amount.unreported",
                    ),
                    currency: reported(
                      t,
                      item.costEstimate.currency,
                      "outcomes.usage.currency.invalid",
                      "outcomes.usage.currency.unreported",
                    ),
                  })
                : t("outcomes.usage.noCost")}
            </p>
            <p className={css.small}>
              {t("outcomes.usage.accounting", {
                accounting: t(
                  ACCOUNTING[item.inputAccounting as keyof typeof ACCOUNTING] ??
                    "outcomes.usage.accounting.unspecified",
                ),
                at: item.recordedAt,
              })}
            </p>
          </div>
        ))}
      <p className={css.small}>{t("outcomes.usage.note")}</p>
    </div>
  );
}

/** Props of one run's usage reports. */
export interface UsageObservationsProps {
  agents: AgentsRemote;
  t: Translate;
  runId: string;
  projectId?: string;
  /** The stage's session; a report from another one is refused. */
  expectedSessionId?: string;
  /** The stage's engine; a report from another one is refused. */
  expectedEngineKind?: "pi";
}

/**
 * Read one run's usage reports on request, a page at a time. A report from
 * another session or engine, or a page whose identity moved, stops the read.
 */
export function UsageObservations(props: UsageObservationsProps) {
  const { agents, t } = props;
  const [pages, setPages] = useState<AgentUsageObservationPage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const scope = `${props.projectId ?? "global"}:${props.runId}:${props.expectedSessionId ?? ""}:${props.expectedEngineKind ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  useEffect(() => {
    setPages([]);
    setError(undefined);
    setPending(false);
    return () => {
      generation.current += 1;
    };
  }, [scope]);
  const load = async (cursor?: number) => {
    const current = ++generation.current;
    setPending(true);
    setError(undefined);
    try {
      const page = await value<AgentUsageObservationPage>(
        agents.agentUsageObservationsList(props.runId, {
          ...(props.projectId === undefined
            ? {}
            : { projectId: props.projectId }),
          ...(cursor === undefined ? {} : { cursor }),
          limit: 25,
        }),
      );
      if (generation.current !== current || currentScope.current !== scope)
        return;
      if (
        page.items.some(
          (item) =>
            (props.expectedSessionId !== undefined &&
              item.sessionId !== props.expectedSessionId) ||
            (props.expectedEngineKind !== undefined &&
              item.engineKind !== props.expectedEngineKind),
        )
      ) {
        setError(t("outcomes.usage.foreign"));
        return;
      }
      if (
        cursor !== undefined &&
        (pages.at(-1)?.nextCursor !== cursor ||
          page.items.some((item) =>
            pages.some((old) =>
              old.items.some((saved) => saved.cursor === item.cursor),
            ),
          ))
      ) {
        setError(t("outcomes.usage.changed"));
        return;
      }
      setPages(cursor === undefined ? [page] : [...pages, page]);
    } catch (cause) {
      if (generation.current === current && currentScope.current === scope)
        setError(messageOf(cause));
    } finally {
      if (generation.current === current && currentScope.current === scope)
        setPending(false);
    }
  };
  const next = pages.at(-1)?.nextCursor;
  return (
    <section className={css.flat} aria-label={t("outcomes.usage.panel")}>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void load()}
      >
        {t(
          pending
            ? "outcomes.usage.load.pending"
            : pages.length
              ? "outcomes.usage.load.again"
              : "outcomes.usage.load.first",
        )}
      </Button>
      {error && (
        <p role="alert" className={css.alert}>
          {t("outcomes.usage.error", { error })}
        </p>
      )}
      {pages.length > 0 &&
        pages[0]!.runId === props.runId &&
        pages[0]!.projectId === props.projectId && (
          <UsageObservationView pages={pages} t={t} />
        )}
      {next !== undefined && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void load(next)}
        >
          {t("outcomes.usage.older")}
        </Button>
      )}
    </section>
  );
}
