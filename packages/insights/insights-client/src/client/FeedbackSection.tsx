import { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { Button } from "@dramaip/infra-ui-primitives";
import type { JsonValue } from "@dramaip/infra-values";
import type {
  FeedbackDashboard,
  FeedbackPreview,
} from "@dramaip/insights-insights/types";
import type {} from "@dramaip/insights-insights/remote";
import type {} from "@dramaip/system-system/remote";
import css from "./FeedbackSection.module.css";

type FeedbackKind = FeedbackPreview["kind"];

/** Props of the feedback section: one project's imports and clusters. */
export interface FeedbackSectionProps {
  projectId: string;
  insights: Context["remote"]["insights"];
  system: Context["remote"]["system"];
  t: TranslateNS<"insights">;
  /** The author chose to revise from one cluster. */
  onRevise: (clusterId: string) => void;
}

/** One preview sample row, as the author reads it before committing. */
export function sampleText(
  value: JsonValue,
  kind: FeedbackKind,
  t: TranslateNS<"insights">,
): string {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return t("feedback.sample.other");
  const field = (name: string, fallback: string) => {
    const item = value[name];
    return item === undefined || item === null ? fallback : String(item);
  };
  return kind === "metrics"
    ? t("feedback.sample.metric", {
        name: field("name", t("feedback.sample.unnamed")),
        value: field("value", t("feedback.sample.missing")),
      })
    : t("feedback.sample.comment", {
        content: field("content", t("feedback.sample.missing")).slice(0, 100),
      });
}

/**
 * Import metrics or comments through a preview the author confirms, list the
 * project's batches, organise comment batches into clusters and hand a
 * cluster to the revision workbench.
 */
export function FeedbackSection({
  projectId,
  insights,
  system,
  t,
  onRevise,
}: FeedbackSectionProps) {
  const [dashboard, setDashboard] = useState<FeedbackDashboard>();
  const [loadError, setLoadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<FeedbackPreview>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    let live = true;
    void insights.feedbackDashboard(projectId).then((result) => {
      if (!live) return;
      if (result.ok) {
        setDashboard(result.value);
        setLoadError(undefined);
      } else setLoadError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [insights, projectId, revision]);
  const kindText = (kind: FeedbackKind) =>
    t(kind === "metrics" ? "feedback.kind.metrics" : "feedback.kind.comments");
  const run = async (action: () => Promise<string | undefined>) => {
    setWorking(true);
    setNotice(undefined);
    try {
      setNotice(await action());
    } finally {
      setWorking(false);
    }
  };
  const failed = (message: string) => t("feedback.failed", { message });
  const choose = (kind: FeedbackKind) =>
    run(async () => {
      const picked = await system.pickFiles({
        multiple: false,
        extensions: ["csv", "json"],
      });
      if (!picked.ok) return failed(picked.error.message);
      const file = picked.value?.[0];
      if (file === undefined) return undefined;
      const result = await insights.feedbackPreview(
        {
          projectId,
          kind,
          capabilityToken: file.grantId,
        },
        undefined,
        crypto.randomUUID(),
      );
      if (!result.ok) return failed(result.error.message);
      setPreview(result.value);
      return undefined;
    });
  const commit = (value: FeedbackPreview) =>
    run(async () => {
      const result = await insights.feedbackCommit(
        value.importId,
        { projectId: value.projectId },
        undefined,
        crypto.randomUUID(),
      );
      if (!result.ok) return failed(result.error.message);
      setPreview(undefined);
      setRevision((current) => current + 1);
      return t("feedback.committed", {
        count: result.value.rowCount,
        kind: kindText(result.value.kind),
      });
    });
  const cluster = (batchId: string) =>
    run(async () => {
      const result = await insights.feedbackCluster(
        { projectId, batchId },
        undefined,
        crypto.randomUUID(),
      );
      if (!result.ok) return failed(result.error.message);
      setRevision((current) => current + 1);
      return t("feedback.clustered", { count: result.value.length });
    });
  const batches = dashboard?.batches ?? [];
  const status = notice ?? (loadError && failed(loadError));
  return (
    <>
      <div className={css.actions}>
        <Button
          variant="primary"
          size="sm"
          disabled={working}
          onClick={() => void choose("metrics")}
        >
          {t("feedback.importMetrics")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => void choose("comments")}
        >
          {t("feedback.importComments")}
        </Button>
      </div>
      {preview && (
        <section className={css.preview}>
          <div className={css.head}>
            <div>
              <h2 className={css.title}>
                {t("feedback.preview.title", { source: preview.sourceName })}
              </h2>
              <p className={css.muted}>
                {t("feedback.preview.count", {
                  count: preview.validCount,
                  kind: kindText(preview.kind),
                })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={() => setPreview(undefined)}
            >
              {t("feedback.preview.cancel")}
            </Button>
          </div>
          {preview.warnings.map((warning) => (
            <p key={warning} className={css.warning}>
              {/[A-Za-z]{3,}/u.test(warning)
                ? t("feedback.preview.review")
                : warning}
            </p>
          ))}
          <div className={css.samples}>
            {preview.sample.map((item, index) => (
              <p key={index} className={css.sample}>
                {sampleText(item, preview.kind, t)}
              </p>
            ))}
          </div>
          <div className={css.end}>
            <Button
              variant="primary"
              size="sm"
              disabled={working}
              onClick={() => void commit(preview)}
            >
              {t(
                working
                  ? "feedback.preview.committing"
                  : "feedback.preview.commit",
              )}
            </Button>
          </div>
        </section>
      )}
      {working && <p className={css.muted}>{t("feedback.working")}</p>}
      {status && <p className={css.notice}>{status}</p>}
      <div className={css.columns}>
        <article className={css.card}>
          <h2 className={css.title}>{t("feedback.batches")}</h2>
          <div className={css.list}>
            {batches.map((batch) => (
              <div key={batch.id} className={css.row}>
                <div>
                  <p className={css.strong}>{batch.sourceName}</p>
                  <p className={css.small}>
                    {t("feedback.batch.rows", {
                      kind: kindText(batch.kind),
                      count: batch.rowCount,
                    })}
                  </p>
                </div>
                {batch.kind === "comments" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => void cluster(batch.id)}
                  >
                    {t("feedback.batch.cluster")}
                  </Button>
                )}
              </div>
            ))}
            {batches.length === 0 && (
              <p className={css.muted}>{t("feedback.batches.empty")}</p>
            )}
          </div>
        </article>
        <article className={css.card}>
          <h2 className={css.title}>{t("feedback.summary")}</h2>
          <dl className={css.counts}>
            <div className={css.count}>
              <dt className={css.small}>{t("feedback.summary.metrics")}</dt>
              <dd className={css.figure}>{dashboard?.metrics.length ?? 0}</dd>
            </div>
            <div className={css.count}>
              <dt className={css.small}>{t("feedback.summary.comments")}</dt>
              <dd className={css.figure}>{dashboard?.comments.length ?? 0}</dd>
            </div>
            <div className={css.count}>
              <dt className={css.small}>{t("feedback.summary.clusters")}</dt>
              <dd className={css.figure}>{dashboard?.clusters.length ?? 0}</dd>
            </div>
          </dl>
          <div className={css.list}>
            {(dashboard?.clusters ?? []).map((item) => (
              <article key={item.id} className={css.cluster}>
                <div className={css.head}>
                  <p className={css.strong}>
                    {t("feedback.cluster.title", {
                      title: item.title,
                      count: item.commentCount,
                    })}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => onRevise(item.id)}
                  >
                    {t("feedback.cluster.revise")}
                  </Button>
                </div>
                <p className={css.small}>{item.summary}</p>
              </article>
            ))}
            {dashboard?.comments.slice(0, 3).map((comment) => (
              <p key={comment.id} className={css.comment}>
                <span className={css.category}>{comment.category}</span>
                {comment.content}
              </p>
            ))}
          </div>
        </article>
      </div>
    </>
  );
}
