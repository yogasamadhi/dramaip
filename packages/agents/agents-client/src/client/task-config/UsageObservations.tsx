import { useEffect, useRef, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { AgentUsageObservationsListResult } from "@dramaip/agents-agents/types";
import { messageOf, value, type AgentsRemote } from "../ai-settings.ts";
import type { Translate } from "./copy.ts";
import css from "./TaskConfig.module.css";

type UsagePage = AgentUsageObservationsListResult;
type UsageNumber = UsagePage["items"][number]["inputTokens"];

const SCOPES = {
  "response-increment": "usage.scope.response",
  "run-total": "usage.scope.run",
  "session-total": "usage.scope.session",
  unspecified: "usage.scope.unspecified",
} as const;

const ACCOUNTING = {
  "includes-cache": "usage.accounting.includes",
  "excludes-cache": "usage.accounting.excludes",
} as const;

function reported(
  t: Translate,
  number: { status: string; value?: unknown } | { status: string },
  invalid: Parameters<Translate>[0],
  unreported: Parameters<Translate>[0],
  format: (value: never) => string = String,
): string {
  return number.status === "reported" && "value" in number
    ? format(number.value as never)
    : t(number.status === "invalid" ? invalid : unreported);
}

const tokens = (t: Translate, number: UsageNumber) =>
  reported(
    t,
    number,
    "usage.token.invalid",
    "usage.token.unreported",
    (count: number) => count.toLocaleString(),
  );

/** The engine's own usage reports for one run, never billing or totals. */
function UsageView({
  pages,
  t,
}: {
  pages: readonly UsagePage[];
  t: Translate;
}) {
  const current = pages[0]!;
  return (
    <div className={css.stack} aria-label={t("usage.aria")}>
      <p className={css.small}>
        {t("usage.run", {
          runId: current.runId,
          count: current.observationCount,
        })}
      </p>
      <p className={css.small}>
        {t("usage.scopeLine", {
          scope: current.projectId
            ? t("usage.scope.project", { projectId: current.projectId })
            : t("usage.scope.global"),
        })}
      </p>
      {!current.observationCount && (
        <p className={css.small}>{t("usage.empty")}</p>
      )}
      {pages
        .flatMap((page) => page.items)
        .map((item) => (
          <div key={item.cursor} className={css.block}>
            <p className={css.small}>
              {t("usage.item.scope", {
                scope: t(SCOPES[item.measurementScope]),
                cursor: item.cursor,
              })}
            </p>
            <p className={css.small}>
              {t("usage.item.tokens", {
                input: tokens(t, item.inputTokens),
                output: tokens(t, item.outputTokens),
                cached: tokens(t, item.cachedTokens),
              })}
            </p>
            <p className={css.small}>
              {item.costEstimate
                ? t("usage.cost", {
                    amount: reported(
                      t,
                      item.costEstimate.amount,
                      "usage.amount.invalid",
                      "usage.amount.unreported",
                    ),
                    currency: reported(
                      t,
                      item.costEstimate.currency,
                      "usage.currency.invalid",
                      "usage.currency.unreported",
                    ),
                  })
                : t("usage.noCost")}
            </p>
            <p className={css.small}>
              {t("usage.accounting", {
                accounting: t(
                  ACCOUNTING[item.inputAccounting as keyof typeof ACCOUNTING] ??
                    "usage.accounting.unspecified",
                ),
                at: item.recordedAt,
              })}
            </p>
          </div>
        ))}
      <p className={css.small}>{t("usage.note")}</p>
    </div>
  );
}

/**
 * Read one run's usage reports on request, a page at a time. A page whose
 * identity moved stops the read; nothing is retried or swapped for another
 * run.
 */
export function UsageObservations({
  agents,
  t,
  runId,
  projectId,
}: {
  agents: AgentsRemote;
  t: Translate;
  runId: string;
  projectId?: string | undefined;
}) {
  const [pages, setPages] = useState<UsagePage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const scope = `${projectId ?? "global"}:${runId}`;
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
      const page = await value<UsagePage>(
        agents.agentUsageObservationsList(runId, {
          ...(projectId === undefined ? {} : { projectId }),
          ...(cursor === undefined ? {} : { cursor }),
          limit: 25,
        }),
      );
      if (generation.current !== current || currentScope.current !== scope)
        return;
      if (
        cursor !== undefined &&
        (pages.at(-1)?.nextCursor !== cursor ||
          page.items.some((item) =>
            pages.some((old) =>
              old.items.some((saved) => saved.cursor === item.cursor),
            ),
          ))
      ) {
        setError(t("usage.changed"));
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
    <section className={css.stack} aria-label={t("usage.panel")}>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void load()}
      >
        {t(
          pending
            ? "usage.load.pending"
            : pages.length
              ? "usage.load.again"
              : "usage.load.first",
        )}
      </Button>
      {error !== undefined && (
        <p role="alert" className={css.danger}>
          {t("usage.error", { error })}
        </p>
      )}
      {pages.length > 0 &&
        pages[0]!.runId === runId &&
        pages[0]!.projectId === projectId && <UsageView pages={pages} t={t} />}
      {next !== undefined && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void load(next)}
        >
          {t("usage.older")}
        </Button>
      )}
    </section>
  );
}
