import type { ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@dramaip/infra-ui-primitives";
import { messageOf, value } from "../ai-settings.ts";
import type { Translate } from "../task-config/copy.ts";
import { UsageObservations } from "../task-config/UsageObservations.tsx";
import type { InspirationConversionProps } from "./InspirationSpace.tsx";
import css from "./Inspiration.module.css";
import {
  CARD_KINDS,
  searchCorpus,
  type CollectionItem,
  type CorpusItem,
  type CreativeMemory,
  type Experiment,
  type Fingerprint,
  type InspirationCard,
  type InspirationRemotes,
  type MemoryJob,
  type MemorySettings,
  type Outcomes,
} from "./records.ts";
import type { useDialog } from "./useDialog.tsx";

interface SidePanelsProps extends InspirationRemotes {
  t: Translate;
  dialog: ReturnType<typeof useDialog>;
  conversationId: string | undefined;
  conversationTitle: string | undefined;
  draft: string;
  outcomes: Outcomes | undefined;
  patch: (patch: Partial<Outcomes>) => void;
  corpusQuery: string;
  setCorpusQuery: (query: string) => void;
  notify: (message: string) => void;
  renderConversion: (props: InspirationConversionProps) => ReactNode;
}

function percent(value: number) {
  return Math.round(value * 100);
}

function replace<T extends { id: string }>(items: readonly T[], next: T): T[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

/**
 * A memory job's state in words: the model it ran on, or why it waits.
 * @param t - the copy.
 * @param job - the job.
 */
export function memoryJobStatus(t: Translate, job: MemoryJob): string {
  return job.status === "completed"
    ? t("space.memory.status.completed", {
        model: job.model ?? t("space.memory.status.model"),
      })
    : t("space.memory.status.pending", {
        error: job.error ?? t("space.memory.status.waiting"),
      });
}

function PanelHead({
  title,
  lead,
  action,
}: {
  title: string;
  lead: string;
  action: ReactNode;
}) {
  return (
    <div className={css.panelHead}>
      <div className={css.grow}>
        <h2 className={css.panelTitle}>{title}</h2>
        <p className={css.small}>{lead}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * The side panels of the inspiration space: the corpus, the creative lab,
 * the fingerprint, the open conversation's cards with the project conversion
 * under them, and the memory center.
 */
export function SidePanels(props: SidePanelsProps) {
  const { t, dialog, agents, knowledge, quality, outcomes, patch, notify } =
    props;
  const guard = (action: () => Promise<void>) => () =>
    void action().catch((cause) => notify(messageOf(cause)));
  const corpus = outcomes?.corpus ?? [];
  const collections = outcomes?.collections ?? [];
  const experiments = outcomes?.experiments ?? [];
  const fingerprint = outcomes?.fingerprint;
  const cards = outcomes?.cards ?? [];
  const memories = outcomes?.memories ?? [];
  const settings = outcomes?.settings;
  const latestJob = outcomes?.jobs[0];

  const createPrivateEntry = guard(async () => {
    const answer = await dialog.form({
      title: t("space.corpus.add.title"),
      fields: [
        { name: "title", label: t("space.corpus.add.name"), kind: "text" },
        {
          name: "mechanism",
          label: t("space.corpus.add.mechanism"),
          kind: "textarea",
        },
      ],
    });
    if (!answer?.title || !answer.mechanism) return;
    const created = await value<CorpusItem>(
      knowledge.creativeCorpusCreate(
        {
          visibility: "private",
          kind: "comic_device",
          title: answer.title,
          mechanism: answer.mechanism,
          locale: "zh-CN",
          freshness: "stable",
          rightsStatus: "unknown",
        },
        undefined,
        undefined,
      ),
    );
    patch({ corpus: [created, ...corpus] });
  });

  const collect = (item: CorpusItem) =>
    guard(async () => {
      const created = await value<CollectionItem>(
        knowledge.creativeCollectionsCreate(
          {
            corpusItemId: item.id,
            title: item.title,
            mechanism: item.mechanism,
            ...(item.tags ? { tags: item.tags } : {}),
          },
          undefined,
          crypto.randomUUID(),
        ),
      );
      patch({ collections: [created, ...collections] });
      notify(t("space.corpus.collected"));
    });

  const createExperiment = (source?: CorpusItem) =>
    guard(async () => {
      const answer = await dialog.form({
        title: t("space.lab.prompt.title"),
        fields: [
          {
            name: "prompt",
            label: t("space.lab.prompt"),
            kind: "textarea",
            initial:
              source?.mechanism ??
              cards.find((card) => card.adopted)?.content ??
              props.draft,
          },
        ],
      });
      if (!answer?.prompt) return;
      const created = await value<Experiment>(
        quality.creativeExperimentsCreate(
          {
            originType: source ? "corpus" : "inspiration",
            ...(source ? { originId: source.id } : {}),
            prompt: answer.prompt,
          },
          undefined,
          crypto.randomUUID(),
        ),
      );
      patch({ experiments: [created, ...experiments] });
    });

  const review = (
    experiment: Experiment,
    input: { selectedVariantId: string } | { rejected: true },
  ) =>
    guard(async () => {
      const next = await value<Experiment>(
        quality.creativeExperimentsReview(
          experiment.id,
          { version: experiment.version, ...input },
          undefined,
          crypto.randomUUID(),
        ),
      );
      patch({ experiments: replace(experiments, next) });
      if ("selectedVariantId" in input)
        patch({
          fingerprint: await value<Fingerprint>(
            quality.creativeFingerprintGet(),
          ),
        });
    });

  const toggleFingerprint = (enabled: boolean) =>
    guard(async () => {
      if (enabled && !(await dialog.confirm(t("space.fingerprint.consent"))))
        return;
      patch({
        fingerprint: await value<Fingerprint>(
          quality.creativeFingerprintUpdateSettings(
            { enabled },
            undefined,
            undefined,
          ),
        ),
      });
    });

  const clearFingerprint = guard(async () => {
    if (!(await dialog.confirm(t("space.fingerprint.clear.confirm")))) return;
    await value(quality.creativeFingerprintClear(undefined, undefined));
    patch({
      fingerprint: await value<Fingerprint>(quality.creativeFingerprintGet()),
    });
  });

  const createCard = guard(async () => {
    const conversationId = props.conversationId;
    if (!conversationId) return;
    const answer = await dialog.form({
      title: t("space.cards.add.title"),
      fields: [
        {
          name: "content",
          label: t("space.cards.add.content"),
          kind: "textarea",
        },
        {
          name: "kind",
          label: t("space.cards.add.kind"),
          kind: "select",
          initial: "premise",
          options: CARD_KINDS.map((kind) => ({
            value: kind,
            label: t(`space.card.${kind}`),
          })),
        },
      ],
    });
    if (!answer?.content) return;
    const card = await value<InspirationCard>(
      agents.inspirationCardsCreate(
        {
          conversationId,
          kind: answer.kind || "premise",
          title: answer.content.slice(0, 32),
          content: answer.content,
        },
        undefined,
        undefined,
      ),
    );
    patch({ cards: [card, ...cards] });
  });

  const adoptCard = (card: InspirationCard, adopted: boolean) =>
    guard(async () => {
      const next = await value<InspirationCard>(
        agents.inspirationCardsUpdate(
          card.id,
          { adopted, version: card.version },
          `"${card.version}"`,
          undefined,
        ),
      );
      patch({ cards: replace(cards, next) });
    });

  const toggleLearning = (enabled: boolean) =>
    guard(async () => {
      patch({
        settings: await value<MemorySettings>(
          agents.inspirationMemorySettingsUpdate(
            { enabled },
            undefined,
            undefined,
          ),
        ),
      });
    });

  const toggleMemory = (memory: CreativeMemory) =>
    guard(async () => {
      const next = await value<CreativeMemory>(
        agents.inspirationMemoriesUpdate(
          memory.id,
          {
            status: memory.status === "active" ? "disabled" : "active",
            version: memory.version,
          },
          `"${memory.version}"`,
          undefined,
        ),
      );
      patch({ memories: replace(memories, next) });
    });

  const rebuild = guard(async () => {
    if (!props.conversationId) return;
    await value(
      agents.inspirationMemoriesRebuild(
        { conversationId: props.conversationId },
        undefined,
        undefined,
      ),
    );
    notify(t("space.memory.rebuild.done"));
  });

  const clearMemories = guard(async () => {
    if (!(await dialog.confirm(t("space.memory.clear.confirm")))) return;
    await value(
      agents.inspirationMemoriesClear(undefined, undefined, undefined),
    );
    patch({ memories: [] });
  });

  return (
    <aside className={css.side}>
      <section className={css.panel}>
        <PanelHead
          title={t("space.corpus.title")}
          lead={t("space.corpus.lead")}
          action={
            <Button
              size="sm"
              variant="outline"
              className={css.nowrap}
              onClick={createPrivateEntry}
            >
              {t("space.corpus.add")}
            </Button>
          }
        />
        <div className={css.searchRow}>
          <input
            className={css.input}
            value={props.corpusQuery}
            onChange={(event) => props.setCorpusQuery(event.target.value)}
            placeholder={t("space.corpus.search.placeholder")}
            aria-label={t("space.corpus.search.placeholder")}
          />
          <Button
            variant="outline"
            className={css.nowrap}
            onClick={guard(async () =>
              patch({ corpus: await searchCorpus(props, props.corpusQuery) }),
            )}
          >
            {t("space.corpus.search")}
          </Button>
        </div>
        <div className={css.stack}>
          {corpus.slice(0, 8).map((item) => (
            <article key={item.id} className={css.item}>
              <div className={css.itemHead}>
                <strong>{item.title}</strong>
                <span className={css.small}>
                  {t("space.corpus.meta", {
                    visibility:
                      item.visibility === "public"
                        ? t("space.corpus.public")
                        : t("space.corpus.private"),
                    freshness: item.freshness,
                  })}
                </span>
              </div>
              <p className={css.pre}>{item.mechanism}</p>
              <div className={css.row}>
                <button
                  type="button"
                  className={css.link}
                  onClick={collect(item)}
                >
                  {t("space.corpus.collect")}
                </button>
                <button
                  type="button"
                  className={css.link}
                  onClick={createExperiment(item)}
                >
                  {t("space.corpus.experiment")}
                </button>
              </div>
            </article>
          ))}
          {!corpus.length && (
            <p className={css.hint}>{t("space.corpus.empty")}</p>
          )}
        </div>
        <div className={css.footRow}>
          <span>{t("space.corpus.collections")}</span>
          <strong className={css.count}>
            {t("space.corpus.collections.count", {
              count: collections.length,
            })}
          </strong>
        </div>
      </section>

      <section className={css.panel}>
        <PanelHead
          title={t("space.lab.title")}
          lead={t("space.lab.lead")}
          action={
            <Button
              size="sm"
              variant="outline"
              className={css.nowrap}
              onClick={createExperiment()}
            >
              {t("space.lab.new")}
            </Button>
          }
        />
        {experiments.slice(0, 3).map((experiment) => (
          <article key={experiment.id} className={css.item}>
            <p className={css.clamp}>{experiment.prompt}</p>
            <div className={css.stack}>
              {experiment.variants.map((variant) => (
                <div key={variant.id} className={css.variant}>
                  <span className={css.strong}>{variant.title}</span>
                  <span className={css.small}>{variant.content}</span>
                  {experiment.status === "ready" && (
                    <button
                      type="button"
                      className={css.link}
                      onClick={review(experiment, {
                        selectedVariantId: variant.id,
                      })}
                    >
                      {t("space.lab.adopt")}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {experiment.status === "ready" && (
              <button
                type="button"
                className={clsx(css.link, css.danger)}
                onClick={review(experiment, { rejected: true })}
              >
                {t("space.lab.reject")}
              </button>
            )}
          </article>
        ))}
        {!experiments.length && (
          <p className={css.hint}>{t("space.lab.empty")}</p>
        )}
      </section>

      <section className={css.panel}>
        <PanelHead
          title={t("space.fingerprint.title")}
          lead={t("space.fingerprint.lead")}
          action={
            <label className={css.toggle}>
              <input
                type="checkbox"
                checked={fingerprint?.enabled ?? false}
                onChange={(event) => toggleFingerprint(event.target.checked)()}
              />
              {t("space.fingerprint.toggle")}
            </label>
          }
        />
        <div className={css.dimensions}>
          {fingerprint?.dimensions.map((dimension) => (
            <div key={dimension.key} className={css.dimension}>
              <div className={css.itemHead}>
                <span className={css.ellipsis}>
                  {t(`space.dimension.${dimension.key}`)}
                </span>
                <strong className={css.score}>
                  {percent(dimension.score)}
                </strong>
              </div>
              <div className={css.meter}>
                <span
                  className={css.meterFill}
                  style={{ width: `${percent(dimension.score)}%` }}
                />
              </div>
              <p className={css.small}>
                {t("space.fingerprint.confidence", {
                  value: percent(dimension.confidence),
                })}
              </p>
            </div>
          ))}
        </div>
        {fingerprint?.consentedAt && (
          <Button size="sm" className={css.danger} onClick={clearFingerprint}>
            {t("space.fingerprint.clear")}
          </Button>
        )}
      </section>

      <section className={css.panel}>
        <PanelHead
          title={t("space.cards.title")}
          lead={t("space.cards.lead")}
          action={
            <Button
              size="sm"
              variant="outline"
              className={css.nowrap}
              onClick={createCard}
              disabled={!props.conversationId}
            >
              {t("space.cards.add")}
            </Button>
          }
        />
        <div className={css.stack}>
          {cards.map((card) => (
            <article key={card.id} className={css.item}>
              <label className={css.cardLabel}>
                <input
                  type="checkbox"
                  checked={card.adopted}
                  onChange={(event) => adoptCard(card, event.target.checked)()}
                />
                <span>
                  <strong>{card.title}</strong>
                  <span className={css.pre}>{card.content}</span>
                </span>
              </label>
            </article>
          ))}
          {!cards.length && (
            <p className={css.hint}>{t("space.cards.empty")}</p>
          )}
        </div>
        {props.conversationId &&
          props.renderConversion({
            conversationId: props.conversationId,
            conversationTitle: props.conversationTitle,
            cards,
            notify,
          })}
      </section>

      <section className={css.panel}>
        <PanelHead
          title={t("space.memory.title")}
          lead={t("space.memory.lead")}
          action={
            <label className={css.toggle}>
              <input
                type="checkbox"
                checked={settings?.enabled ?? false}
                onChange={(event) => toggleLearning(event.target.checked)()}
              />
              {t("space.memory.toggle")}
            </label>
          }
        />
        <div className={css.stack}>
          {memories.map((memory) => (
            <article
              key={memory.id}
              className={clsx(
                css.item,
                memory.status === "disabled" && css.dimmed,
              )}
            >
              <p className={css.pre}>{memory.content}</p>
              <div className={css.itemHead}>
                <span className={css.small}>
                  {t("space.memory.meta", {
                    kind: memory.kind,
                    value: percent(memory.confidence),
                  })}
                </span>
                <button
                  type="button"
                  className={css.link}
                  onClick={toggleMemory(memory)}
                >
                  {memory.status === "active"
                    ? t("space.memory.disable")
                    : t("space.memory.enable")}
                </button>
              </div>
            </article>
          ))}
          {!memories.length && (
            <p className={css.hint}>{t("space.memory.empty")}</p>
          )}
        </div>
        <div className={css.row}>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.conversationId}
            onClick={rebuild}
          >
            {t("space.memory.rebuild")}
          </Button>
          <Button size="sm" className={css.danger} onClick={clearMemories}>
            {t("space.memory.clear")}
          </Button>
        </div>
        {latestJob && (
          <div className={css.hint}>
            <p className={css.flat}>
              {t("space.memory.latest", {
                status: memoryJobStatus(t, latestJob),
              })}
            </p>
            <p className={css.flat}>{t("space.memory.budget")}</p>
            {latestJob.usageRuns?.map((run) => (
              <UsageObservations
                key={run.runId}
                agents={agents}
                t={t}
                runId={run.runId}
                projectId={run.projectId}
              />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
