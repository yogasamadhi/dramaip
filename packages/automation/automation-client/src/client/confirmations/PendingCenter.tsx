import { useRef } from "react";
import clsx from "clsx";
import { Button } from "@dramaip/infra-ui-primitives";
import { usePublishedEvents, type SystemRemote } from "../creation/events.ts";
import { usePoll } from "../creation/remote.ts";
import css from "./Confirmations.module.css";
import type { ConfirmationCategory } from "./derive.ts";
import { loadConfirmations } from "./load.ts";
import { ProviderPreviewCard } from "./PreviewCards.tsx";
import {
  explained,
  type ConfirmationRemotes,
  type Translate,
} from "./remote.ts";

const CATEGORIES: readonly ConfirmationCategory[] = [
  "waiting",
  "running",
  "attention",
];

/** The events after which every source is read again, a second later. */
const PENDING_EVENT =
  /^(automation\.|delivery\.(manuscript|pilot-package)|knowledge\.|workspace\.|writing\.|creative-quality\.(narrative-report-|local-review-changed\.)|production\.(diagnosis-|season-plan-|episode-source-revision-))/;

const TONES: Record<ConfirmationCategory, string> = {
  waiting: "warning",
  running: "info",
  attention: "danger",
};

/**
 * The pending confirmation center: every record waiting for the author,
 * read from its owning domain every 15 seconds and a second after a change
 * event, by category. Nothing from a failed read stays on screen.
 */
export function PendingCenter({
  remotes,
  system,
  t,
  search,
  navigate,
}: {
  remotes: ConfirmationRemotes;
  system: SystemRemote;
  t: Translate;
  search: string;
  navigate: (path: string) => void;
}) {
  const params = new URLSearchParams(search);
  const projectId = params.get("projectId") ?? undefined;
  const providerPreviewId = params.get("providerActionPreviewId") ?? undefined;
  const hasProviderLink = params.has("providerActionPreviewId");
  const invalidProjectScope =
    params.has("projectId") &&
    (params.getAll("projectId").length !== 1 || !projectId?.trim());
  const invalidProviderLink = Boolean(
    hasProviderLink &&
    (!projectId ||
      ["projectId", "providerActionPreviewId"].some(
        (key) => params.getAll(key).length !== 1 || !params.get(key)?.trim(),
      )),
  );
  const requested = params.get("category");
  const category = CATEGORIES.find((item) => item === requested) ?? "waiting";
  const evidence = usePoll(
    `pending:${projectId ?? ""}`,
    explained(t, () => loadConfirmations(remotes, projectId, t)),
    { enabled: !invalidProjectScope, interval: 15_000 },
  );
  const timer = useRef<ReturnType<typeof setTimeout>>();
  usePublishedEvents(system, (event) => {
    // Coalesce status bursts; token streaming must not rescan every project.
    if (!PENDING_EVENT.test(event.type) || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      evidence.refresh();
    }, 1000);
  });
  const update = (key: string, next?: string) => {
    const query = new URLSearchParams(search);
    if (next) query.set(key, next);
    else query.delete(key);
    navigate(`/pending?${query}`);
  };
  const loading = !invalidProjectScope && !evidence.data && !evidence.error;
  const verified =
    !invalidProjectScope && !evidence.error ? evidence.data : undefined;
  const items =
    verified?.items.filter((item) => item.category === category) ?? [];
  const incomplete = Boolean(
    invalidProjectScope || evidence.error || verified?.unavailable.length,
  );
  const tasksHref = projectId
    ? `#/tasks?projectId=${encodeURIComponent(projectId)}`
    : "#/tasks?scope=all";
  return (
    <section className={css.stack}>
      {invalidProjectScope && (
        <p role="alert" className={css.alert}>
          {t("pending.invalidProject")}
        </p>
      )}
      {hasProviderLink &&
        (invalidProviderLink ? (
          <p role="alert" className={css.alert}>
            {t("pending.invalidProvider")}
          </p>
        ) : (
          <section
            aria-label={t("pending.provider")}
            className={clsx(css.card, css.focus)}
          >
            <h2 className={css.heading}>{t("pending.provider")}</h2>
            <ProviderPreviewCard
              key={`${projectId}:${providerPreviewId}`}
              preview={{ id: providerPreviewId! }}
              projectId={projectId}
              remotes={remotes}
              t={t}
              onChanged={evidence.refresh}
            />
          </section>
        ))}
      <div className={css.row}>
        <label className={css.label}>
          {t("pending.scope")}
          <select
            aria-label={t("pending.scope.label")}
            className={css.select}
            value={projectId ?? ""}
            onChange={(event) =>
              update("projectId", event.target.value || undefined)
            }
          >
            <option value="">{t("pending.scope.all")}</option>
            {projectId &&
            !verified?.projects.some((project) => project.id === projectId) ? (
              <option value={projectId}>{t("pending.scope.linked")}</option>
            ) : null}
            {verified?.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={evidence.fetching}
          onClick={evidence.refresh}
        >
          {t("pending.refresh")}
        </Button>
        <a className={css.link} href={tasksHref}>
          {t("pending.tasks")}
        </a>
      </div>
      <div
        role="tablist"
        aria-label={t("pending.tabs")}
        className={css.categories}
      >
        {CATEGORIES.map((tab) => (
          <Button
            key={tab}
            role="tab"
            aria-selected={category === tab}
            variant={category === tab ? "outline" : "ghost"}
            onClick={() => update("category", tab)}
          >
            {t("pending.tab", {
              label: t(`pending.category.${tab}`),
              count: loading
                ? t("pending.count.loading")
                : incomplete
                  ? t("pending.count.incomplete")
                  : (verified?.items.filter((item) => item.category === tab)
                      .length ?? 0),
            })}
          </Button>
        ))}
      </div>
      {evidence.error && (
        <p role="alert" className={css.alert}>
          {t("pending.error", { message: evidence.error })}
        </p>
      )}
      {verified?.unavailable.length ? (
        <div role="alert" className={css.notice}>
          {t("pending.unavailable")}
          <ul className={css.bullets}>
            {verified.unavailable.map((item) => (
              <li key={`${item.source}:${item.projectId ?? "global"}`}>
                {item.projectId
                  ? t("pending.unavailable.project", {
                      source: item.source,
                      project:
                        verified.projects.find(
                          (project) => project.id === item.projectId,
                        )?.title ?? t("project.unavailable"),
                    })
                  : item.source}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div role="tabpanel" aria-label={t("pending.list")} className={css.stack}>
        {items.map((item) => (
          <article
            key={item.key}
            data-confirmation-key={item.key}
            className={css.card}
          >
            <div className={css.cardHeader}>
              <div>
                <h2 className={css.cardTitle}>{item.title}</h2>
                <p className={css.small}>
                  {t("pending.meta", {
                    project: item.projectTitle,
                    time: new Date(item.updatedAt).toLocaleString(
                      t("date.locale"),
                    ),
                  })}
                </p>
              </div>
              <span className={css.badge} data-tone={TONES[category]}>
                {item.status}
              </span>
            </div>
            <p className={css.muted}>{item.detail}</p>
            <a className={css.link} href={`#${item.to}`}>
              {t("pending.open")}
            </a>
          </article>
        ))}
        {loading ? (
          <p className={css.muted}>{t("pending.loading")}</p>
        ) : !incomplete && !items.length ? (
          <p className={css.empty}>{t("pending.empty")}</p>
        ) : null}
      </div>
    </section>
  );
}
