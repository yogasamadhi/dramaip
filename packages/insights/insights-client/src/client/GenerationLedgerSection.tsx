import { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import { Button } from "@dramaip/infra-ui-primitives";
import type {} from "@dramaip/infra-ui-settings/client";
import type {
  GenerationCostObservationPage,
  GenerationRecord,
} from "@dramaip/insights-insights/types";
import type {} from "@dramaip/insights-insights/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import { generationCostLabel, humanCostPatch } from "./generation-cost.ts";
import css from "./GenerationLedgerSection.module.css";

/** Injected face: the ledger's namespace and the project list's. */
export interface GenerationLedgerSectionInjected {
  insights: Context["remote"]["insights"];
  workspace: Context["remote"]["workspace"];
}

/** Full component props of the generation ledger settings section. */
export type GenerationLedgerSectionProps = PropsRuntime<"settings.section"> &
  PropsLocale<"insights"> &
  GenerationLedgerSectionInjected;

type Translate = GenerationLedgerSectionProps["t"];

/**
 * The generation ledger: a project's task summaries, configured unit
 * estimates and unverified cost declarations, one record at a time. Amounts
 * are never added up; real settlement needs its own receipts.
 */
export function GenerationLedgerSection({
  insights,
  workspace,
  t,
}: GenerationLedgerSectionProps) {
  const [projects, setProjects] = useState<
    readonly { id: string; title: string }[]
  >([]);
  const [projectId, setProjectId] = useState("");
  const [records, setRecords] = useState<readonly GenerationRecord[]>([]);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void workspace.projectsList().then((result) => {
      if (live && result.ok)
        setProjects(
          result.value.map(({ id, title }) => ({ id, title: String(title) })),
        );
    });
    return () => {
      live = false;
    };
  }, [workspace]);
  useEffect(() => {
    // A project change never shows the previous project's records.
    setRecords([]);
    setError(undefined);
    if (!projectId) return;
    let live = true;
    void insights.generationList(projectId).then((result) => {
      if (!live) return;
      if (result.ok) setRecords(result.value);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [insights, projectId, revision]);
  const shown = records.filter((record) => record.projectId === projectId);
  return (
    <section className={css.card}>
      <div className={css.head}>
        <div>
          <h2 className={css.title}>{t("ledger.title")}</h2>
          <p className={css.muted}>{t("ledger.description")}</p>
        </div>
        <label className={css.field}>
          {t("ledger.project")}
          <select
            className={css.select}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">{t("ledger.project.none")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error !== undefined && (
        <p className={css.danger}>{t("ledger.failed", { message: error })}</p>
      )}
      <div className={css.list}>
        {error === undefined &&
          shown.map((record) => (
            <div key={`${projectId}:${record.id}`}>
              <LedgerEntry
                record={record}
                t={t}
                save={async (patch) => {
                  const result = await insights.generationUpdate(
                    record.id,
                    patch,
                    undefined,
                    crypto.randomUUID(),
                  );
                  if (!result.ok) throw new Error(result.error.message);
                  setRevision((value) => value + 1);
                }}
              />
              <CostHistory
                key={`${record.id}:${record.updatedAt}`}
                record={record}
                insights={insights}
                t={t}
              />
            </div>
          ))}
        {error === undefined && projectId && !shown.length && (
          <p className={css.muted}>{t("ledger.empty")}</p>
        )}
      </div>
    </section>
  );
}

/** One record, and the form declaring its cost by hand. */
function LedgerEntry({
  record,
  save,
  t,
}: {
  record: GenerationRecord;
  save: (
    patch: Exclude<ReturnType<typeof humanCostPatch>, { refused: unknown }>,
  ) => Promise<void>;
  t: Translate;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState(record.costNote ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <article className={css.entry}>
      <p className={css.strong}>{record.title}</p>
      <p className={css.clamp}>{record.summary}</p>
      <p className={css.small}>{generationCostLabel(t, record)}</p>
      <p className={css.small}>
        {t("ledger.observations", {
          count: record.costObservationCount ?? t("ledger.unknown"),
        })}
        {record.costNote}
      </p>
      {!editing ? (
        <Button
          variant="outline"
          size="sm"
          className={css.action}
          onClick={() => {
            setAmount("");
            setUnit("");
            setNote(record.costNote ?? "");
            setEditing(true);
            setNotice("");
          }}
        >
          {t("ledger.declare")}
        </Button>
      ) : (
        <form
          className={css.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            const patch = humanCostPatch(amount, unit, note);
            if ("refused" in patch) {
              setNotice(t(patch.refused));
              return;
            }
            setPending(true);
            void save(patch)
              .then(() => {
                setEditing(false);
                setNotice(t("ledger.declare.saved"));
              })
              .catch((failure: unknown) => {
                setNotice(
                  failure instanceof Error
                    ? failure.message
                    : t("ledger.declare.failed"),
                );
              })
              .finally(() => setPending(false));
          }}
        >
          <p className={css.small}>
            {t("ledger.declare.hint", { id: record.id })}
          </p>
          <label className={css.inline}>
            {t("ledger.declare.amount")}
            <input
              aria-label={t("ledger.declare.amount")}
              className={css.input}
              value={amount}
              disabled={pending}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className={css.inline}>
            {t("ledger.declare.unit")}
            <input
              aria-label={t("ledger.declare.unit")}
              className={css.input}
              value={unit}
              disabled={pending}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>
          <label className={css.stack}>
            {t("ledger.declare.note")}
            <textarea
              aria-label={t("ledger.declare.note")}
              className={css.textarea}
              value={note}
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className={css.row}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={pending}
            >
              {t(pending ? "ledger.declare.saving" : "ledger.declare.save")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              {t("ledger.cancel")}
            </Button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className={css.small}>
          {notice}
        </p>
      )}
    </article>
  );
}

/**
 * A record's cost observations, read only, a page at a time and never from
 * an earlier read: a failed read shows no figures.
 */
function CostHistory({
  record,
  insights,
  t,
}: {
  record: GenerationRecord;
  insights: GenerationLedgerSectionInjected["insights"];
  t: Translate;
}) {
  const [opened, setOpened] = useState(false);
  const [cursor, setCursor] = useState<number>();
  const [page, setPage] = useState<GenerationCostObservationPage>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setPage(undefined);
    setError(undefined);
    if (!opened) return;
    let live = true;
    setLoading(true);
    void insights
      .generationCostObservations(record.id, {
        projectId: record.projectId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 25,
      })
      .then((result) => {
        if (!live) return;
        if (result.ok) setPage(result.value);
        else setError(result.error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [insights, record.id, record.projectId, opened, cursor]);
  return (
    <section className={css.history}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpened((value) => !value)}
      >
        {t(opened ? "ledger.history.close" : "ledger.history.open")}
      </Button>
      {opened && (
        <div className={css.list}>
          <p>{t("ledger.history.hint", { id: record.id })}</p>
          {loading && <p>{t("ledger.history.loading")}</p>}
          {error !== undefined && (
            <p role="alert">{t("ledger.history.failed", { message: error })}</p>
          )}
          {error === undefined && !loading && page && (
            <>
              <p>
                {t("ledger.history.count", { count: page.observationCount })}
              </p>
              {page.legacyObservation && (
                <p>
                  {t("ledger.history.legacy", {
                    cost: generationCostLabel(t, {
                      ...record,
                      costObservation: page.legacyObservation,
                    }),
                  })}
                </p>
              )}
              {page.items.map((item) => (
                <p key={item.sequence}>
                  {t("ledger.history.item", {
                    sequence: item.sequence,
                    cost: generationCostLabel(t, {
                      ...record,
                      costObservation: item.observation,
                    }),
                    recordedAt:
                      item.observation.recordedAt ?? t("ledger.unknown"),
                  })}
                </p>
              ))}
              {page.nextCursor !== undefined && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(page.nextCursor)}
                >
                  {t("ledger.history.older")}
                </Button>
              )}
              {cursor !== undefined && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(undefined)}
                >
                  {t("ledger.history.latest")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
